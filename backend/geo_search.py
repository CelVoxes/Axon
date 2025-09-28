"""Minimal GEO semantic search system."""

import asyncio
from typing import Any, Dict, List, Optional
import numpy as np
import aiohttp
from bs4 import BeautifulSoup
import re
import time
from functools import lru_cache
import textwrap

try:
    from .config import SearchConfig
except ImportError:
    from config import SearchConfig

from .llm_similarity import score_items_with_llm


class PerformanceMonitor:
    """Simple performance monitoring utility."""
    
    def __init__(self):
        self.start_time = None
        self.steps = {}
    
    def start(self, step_name: str = "total"):
        """Start timing a step."""
        if step_name not in self.steps:
            self.steps[step_name] = {"start": time.time()}
        else:
            self.steps[step_name]["start"] = time.time()
    
    def end(self, step_name: str = "total"):
        """End timing a step."""
        if step_name in self.steps:
            self.steps[step_name]["end"] = time.time()
            self.steps[step_name]["duration"] = (
                self.steps[step_name]["end"] - self.steps[step_name]["start"]
            )
    
    def get_summary(self) -> str:
        """Get performance summary."""
        summary = []
        for step, data in self.steps.items():
            if "duration" in data:
                summary.append(f"{step}: {data['duration']:.2f}s")
        return " | ".join(summary)


class MinimalGEOSearch:
    """Minimal system for finding similar GEO datasets using semantic search."""

    def __init__(self):
        """Initialize minimal GEO search.
        """
        self._lock = asyncio.Lock()
        self._session = None
        self._last_request_time = 0
        self._min_request_interval = 0.5  # Increased to 0.5 seconds to reduce rate limiting
        self._cache = {}  # Simple in-memory cache
        self._cache_ttl = 3600  # Cache TTL in seconds (1 hour)
        self.monitor = PerformanceMonitor()
        self.progress_callback = None
    
    def set_progress_callback(self, callback):
        """Set the progress callback function."""
        self.progress_callback = callback
    
    async def _send_progress_update(self, progress_data):
        """Send progress update asynchronously."""
        if self.progress_callback:
            try:
                if asyncio.iscoroutinefunction(self.progress_callback):
                    await self.progress_callback(progress_data)
                else:
                    self.progress_callback(progress_data)
            except Exception as e:
                print(f"Progress callback error: {e}")
    
    async def _get_session(self):
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=30)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session
    
    async def close_session(self):
        """Close the aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None
    
    def _get_cache_key(self, url: str) -> str:
        """Generate cache key for URL."""
        return f"url:{url}"
    
    def _is_cache_valid(self, cache_entry: Dict) -> bool:
        """Check if cache entry is still valid."""
        return time.time() - cache_entry.get('timestamp', 0) < self._cache_ttl
    
    async def _get_cached_response(self, url: str) -> Optional[str]:
        """Get cached response if available and valid."""
        cache_key = self._get_cache_key(url)
        cache_entry = self._cache.get(cache_key)
        
        if cache_entry and self._is_cache_valid(cache_entry):
            return cache_entry['data']
        return None
    
    def _cache_response(self, url: str, data: str):
        """Cache response data."""
        cache_key = self._get_cache_key(url)
        self._cache[cache_key] = {
            'data': data,
            'timestamp': time.time()
        }
    
    async def _rate_limited_request(self, url: str) -> Optional[str]:
        """Make a rate-limited HTTP request with caching."""
        # Check cache first
        cached_response = await self._get_cached_response(url)
        if cached_response:
            return cached_response
        
        # Ensure minimum interval between requests
        current_time = time.time()
        time_since_last = current_time - self._last_request_time
        if time_since_last < self._min_request_interval:
            await asyncio.sleep(self._min_request_interval - time_since_last)
        
        session = await self._get_session()
        max_retries = 1  # Reduced from 2 to 1 to avoid overwhelming the API
        base_delay = 3.0  # Increased from 2.0 to 3.0 seconds
        
        for attempt in range(max_retries):
            try:
                async with session.get(url) as response:
                    self._last_request_time = time.time()
                    if response.status == 200:
                        response_text = await response.text()
                        # Cache the response
                        self._cache_response(url, response_text)
                        return response_text
                    elif response.status == 429:
                        # Rate limited - wait with exponential backoff
                        delay = base_delay * (2 ** attempt)
                        print(f"Rate limited (429), waiting {delay}s before retry {attempt + 1}/{max_retries}")
                        await asyncio.sleep(delay)
                        continue
                    else:
                        print(f"Request failed: {response.status} for {url}")
                        return None
            except Exception as e:
                print(f"Request error for {url}: {e}")
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                return None
        
        return None
    
    async def _ensure_model_loaded(self):
        """Ensure the embedding model is loaded."""
        if self.model is None:
            async with self._lock:
                if self.model is None:
                    loop = asyncio.get_event_loop()
                    self.model = await loop.run_in_executor(
                        None, 
                        SentenceTransformer, 
                        self.model_name
                    )
    
    async def search_datasets(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        # Use centralized configuration
        limit = SearchConfig.get_search_limit(limit)
        """Find GEO datasets most similar to the query.
        
        Args:
            query: Search query describing desired dataset
            limit: Maximum number of results
            organism: Filter by organism
            
        Returns:
            List of similar datasets with similarity scores
        """
        self.monitor.start("total")
        
        # Initial progress update
        if hasattr(self, 'progress_callback') and self.progress_callback:
            try:
                asyncio.create_task(self._send_progress_update({
                    'step': 'init',
                    'progress': 10,
                    'message': 'Initializing search...',
                    'datasetsFound': 0
                }))
            except Exception as e:
                print(f"Progress callback error: {e}")
        
        # Step 1: Search GEO for candidate datasets
        self.monitor.start("search")
        
        # Update progress for search initiation
        if hasattr(self, 'progress_callback') and self.progress_callback:
            try:
                asyncio.create_task(self._send_progress_update({
                    'step': 'search',
                    'progress': 20,
                    'message': 'Searching GEO database...',
                    'datasetsFound': 0
                }))
            except Exception as e:
                print(f"Progress callback error: {e}")
        
        candidate_datasets = await self._search_geo_datasets(query, limit * 2, organism)  # Reduced multiplier for faster searches
        
        # Update progress after search
        if hasattr(self, 'progress_callback') and self.progress_callback:
            try:
                asyncio.create_task(self._send_progress_update({
                    'step': 'search_results',
                    'progress': 30,
                    'message': f'Found {len(candidate_datasets)} candidate datasets',
                    'datasetsFound': len(candidate_datasets)
                }))
            except Exception as e:
                print(f"Progress callback error: {e}")
        
        self.monitor.end("search")
        
        if not candidate_datasets:
            self.monitor.end("total")
            return []
        
        # Get detailed information for each dataset
        print(f"🔍 Fetching details for {len(candidate_datasets)} candidate datasets...")
        
        # Process in smaller batches to avoid overwhelming the API
        batch_size = SearchConfig.get_batch_size()
        all_datasets = []
        total_batches = (len(candidate_datasets) + batch_size - 1) // batch_size
        
        for i in range(0, len(candidate_datasets), batch_size):
            batch = candidate_datasets[i:i + batch_size]
            current_batch = i // batch_size + 1
            print(f"🔍 Processing batch {current_batch}/{total_batches}: {batch}")
            
            # Update progress for each batch
            progress = min(30 + (current_batch / total_batches) * 60, 90)  # 30% to 90%
            if hasattr(self, 'progress_callback') and self.progress_callback:
                try:
                    asyncio.create_task(self._send_progress_update({
                        'step': 'search_results',
                        'progress': int(progress),
                        'message': f'Processing batch {current_batch}/{total_batches}',
                        'datasetsFound': len(all_datasets)
                    }))
                    # Small delay to ensure progress update is processed
                    await asyncio.sleep(0.1)
                except Exception as e:
                    print(f"Progress callback error: {e}")
            
            batch_tasks = [self._get_dataset_details(gds_id) for gds_id in batch]
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            # Filter out None results and exceptions
            valid_results = []
            for j, result in enumerate(batch_results):
                if isinstance(result, dict) and result is not None:
                    valid_results.append(result)
                elif isinstance(result, Exception):
                    print(f"❌ Exception in batch {i//batch_size + 1}, item {j}: {result}")
            
            all_datasets.extend(valid_results)
            
                    # Add delay between batches to avoid rate limiting
        if i + batch_size < len(candidate_datasets):
            await asyncio.sleep(SearchConfig.get_request_interval())
        
        print(f"✅ Found {len(all_datasets)} valid datasets with details")
        
        # Step 3: Calculate semantic similarity scores
        if all_datasets:
            await self._send_progress_update({
                'step': 'similarity',
                'progress': 95,
                'message': 'Calculating semantic similarity scores...',
                'datasetsFound': len(all_datasets)
            })
            
            # Create text representations for all datasets
            dataset_texts = []
            for dataset in all_datasets:
                text = self._create_dataset_text(dataset)
                dataset_texts.append(text)
            
            # Encode query and dataset texts
            query_embedding = await self._encode_text(query)
            dataset_embeddings = await self._encode_texts_batch(dataset_texts)
            
            # Calculate similarity scores
            for i, dataset in enumerate(all_datasets):
                similarity_score = self._cosine_similarity(query_embedding, dataset_embeddings[i])
                dataset['similarity_score'] = similarity_score
            
            # Sort by similarity score (highest first)
            all_datasets.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
        
        # Final progress update
        if hasattr(self, 'progress_callback') and self.progress_callback:
            try:
                asyncio.create_task(self._send_progress_update({
                    'step': 'complete',
                    'progress': 100,
                    'message': f'Search complete! Found {len(all_datasets)} datasets',
                    'datasetsFound': len(all_datasets)
                }))
            except Exception as e:
                print(f"Progress callback error: {e}")
        
        return all_datasets[:limit]
    
    async def _search_geo_datasets(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[str]:
        # Use centralized configuration
        limit = SearchConfig.get_search_limit(limit)
        """Search GEO database for datasets.
        
        Args:
            query: Search query
            limit: Maximum results
            organism: Organism filter
            
        Returns:
            List of dataset metadata
        """
        try:
            # Update progress for search start
            if hasattr(self, 'progress_callback') and self.progress_callback:
                try:
                    asyncio.create_task(self._send_progress_update({
                        'step': 'search',
                        'progress': 22,
                        'message': 'Building search query...',
                        'datasetsFound': 0
                    }))
                except Exception as e:
                    print(f"Progress callback error: {e}")
            
            # Build search URL
            search_params = {
                "db": "gds",  # Back to gds - this is the correct database name
                "term": query,  # Remove the [text] field specification
                "retmax": SearchConfig.get_retmax(limit),
                "retmode": "xml",
                "usehistory": "y"
            }
            
            # Update progress for API request
            if hasattr(self, 'progress_callback') and self.progress_callback:
                try:
                    asyncio.create_task(self._send_progress_update({
                        'step': 'search',
                        'progress': 25,
                        'message': 'Querying GEO database...',
                        'datasetsFound': 0
                    }))
                except Exception as e:
                    print(f"Progress callback error: {e}")
            
            # Search using NCBI E-utilities
            search_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{self._build_query_string(search_params)}"
            
            response_text = await self._rate_limited_request(search_url)
            
            if not response_text:
                print("❌ No response from search API")
                return []
            
            # Check if response contains an error
            if "ERROR" in response_text.upper() or "INVALID" in response_text.upper():
                print(f"❌ API returned an error: {response_text}")
                return []
            
            # Update progress for parsing
            if hasattr(self, 'progress_callback') and self.progress_callback:
                try:
                    asyncio.create_task(self._send_progress_update({
                        'step': 'search',
                        'progress': 28,
                        'message': 'Parsing search results...',
                        'datasetsFound': 0
                    }))
                except Exception as e:
                    print(f"Progress callback error: {e}")
            
            # Parse the search results
            try:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(response_text)
                
                # Extract numeric IDs from the search results
                numeric_ids = []
                for id_elem in root.findall('.//Id'):
                    numeric_id = id_elem.text
                    if numeric_id:
                        try:
                            # Convert to integer and validate range
                            num_id = int(numeric_id)
                            if 1000 <= num_id <= 999999999:  # Much wider range for GDS IDs
                                numeric_ids.append(num_id)
                            else:
                                print(f"⚠️ Skipping numeric ID outside reasonable range: {numeric_id}")
                        except ValueError:
                            print(f"⚠️ Skipping non-numeric ID: {numeric_id}")
                            continue
                
                print(f"🔍 Found {len(numeric_ids)} valid numeric IDs in search results")
                
                # Convert numeric IDs to GDS IDs
                gds_ids = [f"GDS{num_id}" for num_id in numeric_ids]
                print(f"🔍 Converted to {len(gds_ids)} GDS IDs")
                
                return gds_ids
                    
            except Exception as e:
                print(f"❌ Error parsing search results: {e}")
                print(f"XML content: {response_text[:1000]}")
                return []
            
            # Parse XML to get GEO IDs
            # geo_ids = await self._parse_geo_ids_async(xml_text)
            
            # if not geo_ids:
            #     print("❌ No GEO IDs found in XML response")
            #     return []
            
            # Get detailed information for each dataset
            print(f"🔍 Fetching details for {len(candidate_datasets)} candidate datasets...")
            
            # Create dataset objects
            dataset_objects = []
            for i, gds_id in enumerate(candidate_datasets):
                dataset_objects.append({
                    'id': gds_id
                })
            
            print(f"🔍 Created {len(dataset_objects)} dataset objects")
            print(f"🔍 First dataset object: {dataset_objects[0] if dataset_objects else 'None'}")
            
            # Process in smaller batches to avoid overwhelming the API
            batch_size = SearchConfig.get_batch_size(3)  # Use config with fallback
            all_datasets = []
            
            for i in range(0, len(dataset_objects), batch_size):
                batch = dataset_objects[i:i + batch_size]
                print(f"🔍 Processing batch {i//batch_size + 1}: {[d['id'] for d in batch]}")
                batch_tasks = [self._get_dataset_details(dataset['id']) for dataset in batch]
                batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
                
                # Filter out None results and exceptions
                valid_results = []
                for j, result in enumerate(batch_results):
                    if isinstance(result, dict) and result is not None:
                        # Merge the original dataset info with the fetched details
                        merged_dataset = {**batch[j], **result}
                        valid_results.append(merged_dataset)
                    elif isinstance(result, Exception):
                        print(f"❌ Exception in batch {i//batch_size + 1}, item {j}: {result}")
                
                all_datasets.extend(valid_results)
                
                # Add delay between batches to avoid rate limiting
                if i + batch_size < len(dataset_objects):
                    await asyncio.sleep(SearchConfig.get_request_interval())
            
            # Filter out invalid datasets
            print(f"🔍 Validating {len(all_datasets)} datasets...")
            print(f"🔍 First dataset type: {type(all_datasets[0]) if all_datasets else 'None'}")
            print(f"🔍 First dataset: {all_datasets[0] if all_datasets else 'None'}")
            valid_datasets = await self._filter_valid_datasets(all_datasets)
            print(f"✅ Found {len(valid_datasets)} valid datasets")
            
            return valid_datasets[:limit]
                    
        except Exception as e:
            print(f"❌ Error searching GEO: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    async def _parse_geo_ids_async(self, xml_text: str) -> List[str]:
        """Parse GEO IDs from XML response with async processing."""
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(xml_text)
            id_list = root.find("IdList")
            
            if id_list is None:
                return []
            
            numeric_ids = [id_elem.text for id_elem in id_list.findall("Id")]
            
            # Use esummary to get GEO accessions concurrently
            tasks = [self._get_geo_accession(numeric_id) for numeric_id in numeric_ids]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            geo_accessions = []
            for result in results:
                if isinstance(result, str):
                    geo_accessions.append(result)
                elif isinstance(result, Exception):
                    print(f"Error getting accession: {result}")
            
            return geo_accessions
            
        except Exception as e:
            print(f"Error parsing XML: {e}")
            return []
    
    async def _get_geo_accession(self, numeric_id: str) -> str:
        """Convert numeric ID to GEO accession ID."""
        # For GDS datasets, the numeric ID becomes GDS ID
        return f"GDS{numeric_id}"
    
    async def _get_dataset_details(self, geo_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed information for a GEO dataset using NCBI E-utilities.
        
        Args:
            geo_id: GEO dataset ID (e.g., GDS1234)
            
        Returns:
            Dataset metadata dictionary or None if not found
        """
        try:
            # Extract numeric ID from GDS ID
            if geo_id.startswith('GDS'):
                numeric_id = geo_id[3:]
            else:
                numeric_id = geo_id
            
            # Use NCBI E-utilities esummary API to get dataset details
            summary_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gds&id={numeric_id}&retmode=xml"
            response_text = await self._rate_limited_request(summary_url)
            
            if not response_text:
                print(f"❌ No response from esummary API for {geo_id}")
                return None
            
            # Check if response contains an error
            if "ERROR" in response_text.upper():
                print(f"❌ esummary API returned an error for {geo_id}: {response_text}")
                return None
            
            # Parse XML response
            import xml.etree.ElementTree as ET
            root = ET.fromstring(response_text)
            
            # Extract dataset information
            doc_sum = root.find('.//DocSum')
            if doc_sum is None:
                print(f"❌ No DocSum found in esummary response for {geo_id}")
                return None
            
            # Extract fields from XML
            title = "Unknown"
            description = "Unknown"
            organism = "Unknown"
            sample_count = "0"
            platform = "Unknown"
            accession = geo_id
            gse_id = None
            
            for item in doc_sum.findall('.//Item'):
                name = item.get('Name')
                if name == 'title':
                    title = item.text or "Unknown"
                elif name == 'summary':
                    description = item.text or "Unknown"
                elif name == 'taxon':
                    organism = item.text or "Unknown"
                elif name == 'n_samples':
                    sample_count = str(item.text) if item.text else "0"
                elif name == 'GPL':
                    platform = f"GPL{item.text}" if item.text else "Unknown"
                elif name == 'Accession':
                    accession = item.text or geo_id
                elif name == 'GSE':
                    gse_id = f"GSE{item.text}" if item.text else None
            
            # If we have a GSE ID, use it as the primary ID
            if gse_id:
                geo_id = gse_id
            
            return {
                'id': geo_id,
                'title': title,
                'description': description,
                'organism': organism,
                'sample_count': sample_count,
                'platform': platform,
                'source': 'GEO',
                'accession': accession
            }
            
        except Exception as e:
            print(f"❌ Error getting details for {geo_id}: {e}")
            return None

    async def _get_gds_details_via_api(self, gds_id: str) -> Optional[Dict[str, Any]]:
        """Get GDS dataset details using NCBI E-utilities API as fallback."""
        try:
            # Extract numeric ID from GDS ID
            numeric_id = gds_id.replace('GDS', '')
            
            # Use esummary to get GDS details
            summary_params = {
                "db": "gds",
                "id": numeric_id,
                "retmode": "xml"
            }
            
            summary_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?{self._build_query_string(summary_params)}"
            response_text = await self._rate_limited_request(summary_url)
            
            if response_text:
                import xml.etree.ElementTree as ET
                summary_root = ET.fromstring(response_text)
                
                result = {
                    "id": gds_id,
                    "title": f"Dataset {gds_id}",
                    "description": f"GEO dataset {gds_id}",
                    "organism": "Unknown",
                    "sample_count": "0",
                    "platform": "Unknown",
                    "source": "GEO"
                }
                
                # Extract title
                title_elem = summary_root.find(".//Item[@Name='Title']")
                if title_elem is not None and title_elem.text:
                    result["title"] = title_elem.text
                
                # Extract description
                desc_elem = summary_root.find(".//Item[@Name='Summary']")
                if desc_elem is not None and desc_elem.text:
                    result["description"] = desc_elem.text
                
                # Extract organism
                org_elem = summary_root.find(".//Item[@Name='Organism']")
                if org_elem is not None and org_elem.text:
                    result["organism"] = org_elem.text
                
                # Extract sample count
                sample_elem = summary_root.find(".//Item[@Name='Samples']")
                if sample_elem is not None and sample_elem.text:
                    result["sample_count"] = sample_elem.text
                
                # Extract platform
                platform_elem = summary_root.find(".//Item[@Name='Platform']")
                if platform_elem is not None and platform_elem.text:
                    result["platform"] = platform_elem.text
                
                return result
            
            return None
            
        except Exception as e:
            print(f"❌ Error getting GDS details via API for {gds_id}: {e}")
            return None

    async def _validate_dataset_exists(self, geo_id: str) -> bool:
        """Check if a GEO dataset actually exists by trying to fetch its details."""
        try:
            if geo_id.startswith('GDS'):
                # For GDS datasets, try the API first
                details = await self._get_gds_details_via_api(geo_id)
                if details and details.get('title') and not details['title'].startswith('Dataset GDS'):
                    return True
                
                # Fallback to web scraping
                details = await self._get_dataset_details(geo_id)
                if details and details.get('title') and not details['title'].startswith('Dataset GDS'):
                    return True
            else:
                # For GSE datasets, try web scraping
                details = await self._get_dataset_details(geo_id)
                if details and details.get('title') and not details['title'].startswith('Dataset GSE'):
                    return True
            
            return False
        except Exception as e:
            print(f"❌ Error validating {geo_id}: {e}")
            return False

    async def _filter_valid_datasets(self, datasets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter out datasets that don't actually exist."""
        valid_datasets = []
        
        for dataset in datasets:
            geo_id = dataset.get('id', '')
            if not geo_id:
                continue
                
            # Quick validation: check if ID format is reasonable
            if geo_id.startswith('GDS'):
                # GDS IDs should be in format GDSxxxx where xxxx is a reasonable number
                try:
                    numeric_part = int(geo_id[3:])
                    if numeric_part < 1000 or numeric_part > 999999999:  # Much wider range for GDS IDs
                        print(f"⚠️ Skipping invalid GDS ID format: {geo_id}")
                        continue
                except ValueError:
                    print(f"⚠️ Skipping malformed GDS ID: {geo_id}")
                    continue
            
            # For now, let's do a quick existence check
            # We'll validate a subset to avoid too many API calls
            if len(valid_datasets) < 20:  # Only validate first 20 to avoid rate limiting
                if await self._validate_dataset_exists(geo_id):
                    valid_datasets.append(dataset)
                else:
                    print(f"⚠️ Dataset {geo_id} does not exist, skipping")
            else:
                # For the rest, just add them but mark for later validation
                valid_datasets.append(dataset)
        
        return valid_datasets

    def _create_dataset_text(self, dataset: Dict[str, Any]) -> str:
        """Create a text representation of a dataset for embedding.
        
        Args:
            dataset: Dataset metadata
            
        Returns:
            Text representation for embedding
        """
        text_parts = []
        
        if dataset.get("title"):
            text_parts.append(dataset["title"])
        
        if dataset.get("description"):
            text_parts.append(dataset["description"])
        
        if dataset.get("organism"):
            text_parts.append(f"Organism: {dataset['organism']}")
        
        if dataset.get("sample_count"):
            text_parts.append(f"Samples: {dataset['sample_count']}")
        
        if dataset.get("platform"):
            text_parts.append(f"Platform: {dataset['platform']}")
        
        return " ".join(text_parts)
    
    async def _encode_text(self, text: str) -> np.ndarray:
        """Encode text to embedding vector.
        
        Args:
            text: Input text
            
        Returns:
            Embedding vector
        """
        await self._ensure_model_loaded()
        
        loop = asyncio.get_event_loop()
        embedding = await loop.run_in_executor(
            None,
            lambda: self.model.encode([text], convert_to_numpy=True)
        )
        
        return embedding[0]
    
    async def _encode_texts_batch(self, texts: List[str]) -> List[np.ndarray]:
        """Encode multiple texts to embedding vectors in batch.
        
        Args:
            texts: List of input texts
            
        Returns:
            List of embedding vectors
        """
        await self._ensure_model_loaded()
        
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None,
            lambda: self.model.encode(texts, convert_to_numpy=True)
        )
        
        return list(embeddings)
    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors.
        
        Args:
            vec1: First vector
            vec2: Second vector
            
        Returns:
            Cosine similarity score
        """
        # Normalize vectors
        vec1_norm = vec1 / np.linalg.norm(vec1)
        vec2_norm = vec2 / np.linalg.norm(vec2)
        
        # Calculate cosine similarity
        return float(np.dot(vec1_norm, vec2_norm))
    
    def _build_query_string(self, params: Dict[str, Any]) -> str:
        """Build URL query string from parameters."""
        from urllib.parse import urlencode
        return urlencode(params)


# Simple client interface
class SimpleGEOClient:
    """Simple client for GEO search operations."""
    
    def __init__(self):
        self.search_client = MinimalGEOSearch()
    
    def set_progress_callback(self, callback):
        """Set the progress callback function."""
        self.search_client.set_progress_callback(callback)
    
    async def find_similar_datasets(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        # Use centralized configuration
        limit = SearchConfig.get_search_limit(limit)
        """Find similar datasets using semantic search."""
        try:
            return await self.search_client.search_datasets(query, limit, organism)
        finally:
            # Ensure session is closed after search
            await self.search_client.close_session()
    
    async def search_by_gene(
        self, 
        gene: str, 
        organism: Optional[str] = None,
        limit: int = None
    ) -> List[Dict[str, Any]]:
        # Use centralized configuration
        limit = SearchConfig.get_search_limit(limit)
        """Search datasets by gene name."""
        try:
            return await self.search_client.search_datasets(f'"{gene}"[Gene Name]', limit, organism)
        finally:
            await self.search_client.close_session()
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: int = None
    ) -> List[Dict[str, Any]]:
        # Use centralized configuration
        limit = SearchConfig.get_search_limit(limit)
        """Search datasets by disease name."""
        try:
            return await self.search_client.search_datasets(f'"{disease}"[Disease]', limit)
        finally:
            await self.search_client.close_session()
    
    async def cleanup(self):
        """Clean up resources."""
        await self.search_client.close_session()


# Example usage
if __name__ == "__main__":
    async def main():
        client = SimpleGEOClient()
        
        # Example searches
        print("🔍 Searching for breast cancer datasets...")
        cancer_datasets = await client.search_by_disease("breast cancer", limit=5)
        for dataset in cancer_datasets:
            print(f"  {dataset['id']}: {dataset['title']} (Score: {dataset['similarity_score']:.3f})")
        
        print("\n🔍 Searching for TP53 gene datasets...")
        gene_datasets = await client.search_by_gene("TP53", limit=5)
        for dataset in gene_datasets:
            print(f"  {dataset['id']}: {dataset['title']} (Score: {dataset['similarity_score']:.3f})")
    
    asyncio.run(main())
