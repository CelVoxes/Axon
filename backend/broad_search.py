"""Broad Institute Single Cell Portal search system.

IMPORTANT: This client interfaces with the Broad Institute Single Cell Portal (SCP) 
and is subject to their Terms of Service. Users must comply with all applicable 
terms, including but not limited to:

- Authentication requirements (Google-managed identity)
- Data usage restrictions (research purposes only, not for medical decisions)
- Data retention policies (1 year for private studies, 200GB soft cap)
- Prohibited activities (no unauthorized access, no IP violations)

For complete terms: https://singlecell.broadinstitute.org/single_cell/terms

DISCLAIMER: The content hosted on SCP is experimental/academic in nature and 
should only be used for research purposes. It should NOT be used to make or 
inform any medical, clinical or diagnostic decisions.
"""

import asyncio
import numpy as np
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
import aiohttp
import json
import time
from functools import lru_cache
try:
    from .config import SearchConfig
except ImportError:
    from config import SearchConfig


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


class BroadSingleCellSearch:
    """Search system for Broad Institute Single Cell Portal."""
    
    def __init__(self, embedding_model: str = "all-MiniLM-L6-v2"):
        """Initialize Broad Single Cell search.
        
        Args:
            embedding_model: Sentence transformer model for embeddings
        """
        self.model = None
        self.model_name = embedding_model
        self._lock = asyncio.Lock()
        self._session = None
        self._last_request_time = 0
        self._min_request_interval = 0.5  # Rate limiting
        self._cache = {}  # Simple in-memory cache
        self._cache_ttl = 3600  # Cache TTL in seconds (1 hour)
        self.monitor = PerformanceMonitor()
        self.progress_callback = None
        self.base_url = "https://singlecell.broadinstitute.org/single_cell/api/v1"
    
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
    
    async def _get_cached_response(self, url: str) -> Optional[Dict]:
        """Get cached response if available and valid."""
        cache_key = self._get_cache_key(url)
        cache_entry = self._cache.get(cache_key)
        
        if cache_entry and self._is_cache_valid(cache_entry):
            return cache_entry['data']
        return None
    
    def _cache_response(self, url: str, data: Dict):
        """Cache response data."""
        cache_key = self._get_cache_key(url)
        self._cache[cache_key] = {
            'data': data,
            'timestamp': time.time()
        }
    
    async def _rate_limited_request(self, url: str) -> Optional[Dict]:
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
        max_retries = 2
        base_delay = 2.0
        
        for attempt in range(max_retries):
            try:
                headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'Axon-Search-Client/1.0'
                }
                
                async with session.get(url, headers=headers) as response:
                    self._last_request_time = time.time()
                    if response.status == 200:
                        response_json = await response.json()
                        # Cache the response
                        self._cache_response(url, response_json)
                        return response_json
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
    
    async def search_studies(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None,
        facets: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Search for single-cell studies.
        
        Args:
            query: Search query describing desired dataset
            limit: Maximum number of results
            organism: Filter by organism
            facets: Additional facet filters
            
        Returns:
            List of similar studies with similarity scores
        """
        limit = SearchConfig.get_search_limit(limit)
        self.monitor.start("total")
        
        # Initial progress update
        await self._send_progress_update({
            'step': 'init',
            'progress': 10,
            'message': 'Initializing Broad Single Cell search...',
            'datasetsFound': 0
        })
        
        # Step 1: Search for studies
        self.monitor.start("search")
        
        await self._send_progress_update({
            'step': 'search',
            'progress': 20,
            'message': 'Searching Broad Single Cell Portal...',
            'datasetsFound': 0
        })
        
        # Build search parameters
        search_params = {
            'q': query,
            'size': limit * 2,  # Get more results for better selection
            'from': 0
        }
        
        if organism:
            search_params['organism'] = organism
        
        if facets:
            search_params.update(facets)
        
        # Build search URL
        search_url = f"{self.base_url}/search"
        if search_params:
            param_strings = []
            for key, value in search_params.items():
                if isinstance(value, (list, tuple)):
                    for v in value:
                        param_strings.append(f"{key}={v}")
                else:
                    param_strings.append(f"{key}={value}")
            search_url += "?" + "&".join(param_strings)
        
        response_data = await self._rate_limited_request(search_url)
        
        if not response_data:
            self.monitor.end("total")
            return []
        
        # Extract studies from response
        studies = response_data.get('studies', [])
        
        await self._send_progress_update({
            'step': 'search_results',
            'progress': 30,
            'message': f'Found {len(studies)} candidate studies',
            'datasetsFound': len(studies)
        })
        
        self.monitor.end("search")
        
        if not studies:
            self.monitor.end("total")
            return []
        
        # Step 2: Get detailed information for each study
        print(f"🔍 Fetching details for {len(studies)} candidate studies...")
        
        batch_size = SearchConfig.get_batch_size()
        all_studies = []
        total_batches = (len(studies) + batch_size - 1) // batch_size
        
        for i in range(0, len(studies), batch_size):
            batch = studies[i:i + batch_size]
            current_batch = i // batch_size + 1
            
            progress = min(30 + (current_batch / total_batches) * 60, 90)
            await self._send_progress_update({
                'step': 'processing',
                'progress': int(progress),
                'message': f'Processing batch {current_batch}/{total_batches}',
                'datasetsFound': len(all_studies)
            })
            
            batch_tasks = [self._get_study_details(study) for study in batch]
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            # Filter out None results and exceptions
            valid_results = []
            for j, result in enumerate(batch_results):
                if isinstance(result, dict) and result is not None:
                    valid_results.append(result)
                elif isinstance(result, Exception):
                    print(f"❌ Exception in batch {current_batch}, item {j}: {result}")
            
            all_studies.extend(valid_results)
            
            # Add delay between batches
            if i + batch_size < len(studies):
                await asyncio.sleep(SearchConfig.get_request_interval())
        
        print(f"✅ Found {len(all_studies)} valid studies with details")
        
        # Step 3: Calculate semantic similarity scores
        if all_studies:
            await self._send_progress_update({
                'step': 'similarity',
                'progress': 95,
                'message': 'Calculating semantic similarity scores...',
                'datasetsFound': len(all_studies)
            })
            
            # Create text representations for all studies
            study_texts = []
            for study in all_studies:
                text = self._create_study_text(study)
                study_texts.append(text)
            
            # Encode query and study texts
            query_embedding = await self._encode_text(query)
            study_embeddings = await self._encode_texts_batch(study_texts)
            
            # Calculate similarity scores
            for i, study in enumerate(all_studies):
                similarity_score = self._cosine_similarity(query_embedding, study_embeddings[i])
                study['similarity_score'] = similarity_score
            
            # Sort by similarity score (highest first)
            all_studies.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
        
        # Final progress update
        await self._send_progress_update({
            'step': 'complete',
            'progress': 100,
            'message': f'Search complete! Found {len(all_studies)} studies',
            'datasetsFound': len(all_studies)
        })
        
        self.monitor.end("total")
        return all_studies[:limit]
    
    async def _get_study_details(self, study: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Get detailed information for a study.
        
        Args:
            study: Basic study information from search
            
        Returns:
            Detailed study information or None if not found
        """
        try:
            study_id = study.get('id') or study.get('accession')
            if not study_id:
                return None
            
            # Try to get detailed study information (may require authentication)
            detail_url = f"{self.base_url}/studies/{study_id}"
            detail_response = await self._rate_limited_request(detail_url)
            
            # If we can't get detailed info, use the basic search result
            if not detail_response:
                # Extract information from the basic search result
                return {
                    'id': study_id,
                    'title': study.get('name', study.get('title', 'Unknown')),
                    'description': study.get('description', 'No description available'),
                    'organism': study.get('organism', 'Unknown'),
                    'sample_count': str(study.get('cell_count', study.get('n_cells', 0))),
                    'platform': study.get('technology', study.get('library_preparation_protocol', 'Unknown')),
                    'source': 'Broad Single Cell Portal',
                    'accession': study_id,
                    'publication': study.get('publication', {}),
                    'data_types': study.get('data_types', []),
                    'cell_count': study.get('cell_count', study.get('n_cells', 0)),
                    'gene_count': study.get('gene_count', study.get('n_genes', 0)),
                    'technology': study.get('technology', study.get('library_preparation_protocol', 'Unknown')),
                    'disease': study.get('disease', 'Unknown'),
                    'tissue': study.get('tissue', study.get('organ', 'Unknown')),
                    'cell_types': study.get('cell_types', []),
                    'study_url': f"https://singlecell.broadinstitute.org/single_cell/study/{study_id}"
                }
            
            # Merge basic and detailed information
            merged_study = {**study, **detail_response}
            
            # Extract key information
            return {
                'id': study_id,
                'title': merged_study.get('name', merged_study.get('title', 'Unknown')),
                'description': merged_study.get('description', 'No description available'),
                'organism': merged_study.get('organism', 'Unknown'),
                'sample_count': str(merged_study.get('cell_count', merged_study.get('n_cells', 0))),
                'platform': merged_study.get('technology', merged_study.get('library_preparation_protocol', 'Unknown')),
                'source': 'Broad Single Cell Portal',
                'accession': study_id,
                'publication': merged_study.get('publication', {}),
                'data_types': merged_study.get('data_types', []),
                'cell_count': merged_study.get('cell_count', merged_study.get('n_cells', 0)),
                'gene_count': merged_study.get('gene_count', merged_study.get('n_genes', 0)),
                'technology': merged_study.get('technology', merged_study.get('library_preparation_protocol', 'Unknown')),
                'disease': merged_study.get('disease', 'Unknown'),
                'tissue': merged_study.get('tissue', merged_study.get('organ', 'Unknown')),
                'cell_types': merged_study.get('cell_types', []),
                'study_url': f"https://singlecell.broadinstitute.org/single_cell/study/{study_id}"
            }
            
        except Exception as e:
            print(f"❌ Error getting details for study {study.get('id', 'unknown')}: {e}")
            return None
    
    async def check_terra_tos_acceptance(self) -> bool:
        """Check if user has accepted current Terra Terms of Service.
        
        Returns:
            True if user has accepted TOS, False otherwise
        """
        try:
            url = f"{self.base_url}/site/check_terra_tos_acceptance"
            response = await self._rate_limited_request(url)
            return response.get('accepted', False) if response else False
        except Exception as e:
            print(f"❌ Error checking TOS acceptance: {e}")
            return False
    
    async def get_available_facets(self) -> Dict[str, Any]:
        """Get available search facets.
        
        Returns:
            Dictionary of available facets and their options
        """
        try:
            facets_url = f"{self.base_url}/search/facets"
            response = await self._rate_limited_request(facets_url)
            return response or {}
        except Exception as e:
            print(f"❌ Error getting facets: {e}")
            return {}
    
    async def get_study_files(self, study_accession: str) -> List[Dict[str, Any]]:
        """Get list of files available for a study.
        
        Args:
            study_accession: Study accession ID
            
        Returns:
            List of study files with metadata
        """
        try:
            url = f"{self.base_url}/site/studies/{study_accession}"
            study_data = await self._rate_limited_request(url)
            
            if not study_data:
                return []
            
            # Extract file information from study data
            files = study_data.get('study_files', [])
            return files
        except Exception as e:
            print(f"❌ Error getting study files: {e}")
            return []
    
    async def download_study_file(
        self, 
        study_accession: str, 
        file_id: str, 
        output_path: str,
        progress_callback=None
    ) -> bool:
        """Download a specific file from a study.
        
        Args:
            study_accession: Study accession ID
            file_id: File ID to download
            output_path: Local path to save the file
            progress_callback: Optional callback for download progress
            
        Returns:
            True if download successful, False otherwise
        """
        try:
            # Get download URL
            download_url = f"{self.base_url}/site/studies/{study_accession}/download"
            params = {'file_id': file_id}
            
            session = await self._get_session()
            
            async with session.get(download_url, params=params) as response:
                if response.status != 200:
                    print(f"❌ Download failed with status {response.status}")
                    return False
                
                # Get file size for progress tracking
                total_size = int(response.headers.get('content-length', 0))
                downloaded_size = 0
                
                with open(output_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(8192):
                        f.write(chunk)
                        downloaded_size += len(chunk)
                        
                        if progress_callback and total_size > 0:
                            progress = (downloaded_size / total_size) * 100
                            progress_callback({
                                'type': 'download_progress',
                                'file': file_id,
                                'progress': progress,
                                'downloaded': downloaded_size,
                                'total': total_size
                            })
                
                print(f"✅ Downloaded {file_id} to {output_path}")
                return True
                
        except Exception as e:
            print(f"❌ Download error: {e}")
            return False
    
    async def get_study_manifest(self, study_accession: str) -> Optional[Dict[str, Any]]:
        """Get study manifest file.
        
        Args:
            study_accession: Study accession ID
            
        Returns:
            Study manifest data or None if not available
        """
        try:
            url = f"{self.base_url}/studies/{study_accession}/manifest"
            return await self._rate_limited_request(url)
        except Exception as e:
            print(f"❌ Error getting study manifest: {e}")
            return None
    
    async def create_bulk_download_auth(self, study_accessions: List[str]) -> Optional[str]:
        """Create one-time auth code for bulk downloads.
        
        Args:
            study_accessions: List of study accession IDs
            
        Returns:
            Auth code for bulk download or None if failed
        """
        try:
            url = f"{self.base_url}/bulk_download/auth_code"
            payload = {
                'study_accessions': study_accessions
            }
            
            session = await self._get_session()
            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get('auth_code')
                else:
                    print(f"❌ Bulk download auth failed with status {response.status}")
                    return None
        except Exception as e:
            print(f"❌ Bulk download auth error: {e}")
            return None
    
    async def get_bulk_download_summary(self, auth_code: str) -> Optional[Dict[str, Any]]:
        """Get summary information for bulk download.
        
        Args:
            auth_code: Auth code from create_bulk_download_auth
            
        Returns:
            Summary information or None if failed
        """
        try:
            url = f"{self.base_url}/bulk_download/summary"
            params = {'auth_code': auth_code}
            return await self._rate_limited_request(url, params=params)
        except Exception as e:
            print(f"❌ Error getting bulk download summary: {e}")
            return None
    
    async def generate_curl_config(self, auth_code: str, output_path: str) -> bool:
        """Generate curl command file for bulk download.
        
        Args:
            auth_code: Auth code from create_bulk_download_auth
            output_path: Path to save the curl config file
            
        Returns:
            True if successful, False otherwise
        """
        try:
            url = f"{self.base_url}/bulk_download/generate_curl_config"
            params = {'auth_code': auth_code}
            
            session = await self._get_session()
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    content = await response.text()
                    with open(output_path, 'w') as f:
                        f.write(content)
                    print(f"✅ Generated curl config at {output_path}")
                    return True
                else:
                    print(f"❌ Curl config generation failed with status {response.status}")
                    return False
        except Exception as e:
            print(f"❌ Curl config generation error: {e}")
            return False
    
    async def search_by_organism(
        self, 
        organism: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by organism.
        
        Args:
            organism: Organism name (e.g., 'Homo sapiens', 'Mus musculus')
            limit: Maximum number of results
            
        Returns:
            List of studies for the organism
        """
        limit = SearchConfig.get_search_limit(limit)
        return await self.search_studies("", limit, organism=organism)
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by disease.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            
        Returns:
            List of studies for the disease
        """
        limit = SearchConfig.get_search_limit(limit)
        facets = {'disease': disease}
        return await self.search_studies("", limit, facets=facets)
    
    async def search_by_tissue(
        self, 
        tissue: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by tissue type.
        
        Args:
            tissue: Tissue name
            limit: Maximum number of results
            
        Returns:
            List of studies for the tissue
        """
        limit = SearchConfig.get_search_limit(limit)
        facets = {'tissue': tissue}
        return await self.search_studies("", limit, facets=facets)
    
    async def search_by_technology(
        self, 
        technology: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by technology.
        
        Args:
            technology: Technology name (e.g., '10x', 'Smart-seq2')
            limit: Maximum number of results
            
        Returns:
            List of studies using the technology
        """
        limit = SearchConfig.get_search_limit(limit)
        facets = {'technology': technology}
        return await self.search_studies("", limit, facets=facets)
    
    def _create_study_text(self, study: Dict[str, Any]) -> str:
        """Create a text representation of a study for embedding.
        
        Args:
            study: Study metadata
            
        Returns:
            Text representation for embedding
        """
        text_parts = []
        
        if study.get("title"):
            text_parts.append(study["title"])
        
        if study.get("description"):
            text_parts.append(study["description"])
        
        if study.get("organism"):
            text_parts.append(f"Organism: {study['organism']}")
        
        if study.get("disease"):
            text_parts.append(f"Disease: {study['disease']}")
        
        if study.get("tissue"):
            text_parts.append(f"Tissue: {study['tissue']}")
        
        if study.get("technology"):
            text_parts.append(f"Technology: {study['technology']}")
        
        if study.get("cell_count"):
            text_parts.append(f"Cells: {study['cell_count']}")
        
        if study.get("gene_count"):
            text_parts.append(f"Genes: {study['gene_count']}")
        
        if study.get("cell_types"):
            cell_types = ", ".join(study["cell_types"][:5])  # Limit to first 5
            text_parts.append(f"Cell types: {cell_types}")
        
        return " ".join(text_parts)
    
    async def _encode_text(self, text: str) -> np.ndarray:
        """Encode text to embedding vector.
        
        Args:
            text: Input text
            
        Returns:
            Embedding vector
        """
        await self._ensure_model_loaded()
        
        if self.model is None:
            raise RuntimeError("Model not loaded")
        
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
        
        if self.model is None:
            raise RuntimeError("Model not loaded")
        
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


class SimpleBroadClient:
    """Simple client for Broad Single Cell Portal search operations."""
    
    def __init__(self):
        self.search_client = BroadSingleCellSearch()
    
    def set_progress_callback(self, callback):
        """Set the progress callback function."""
        self.search_client.set_progress_callback(callback)
    
    async def find_similar_studies(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find similar studies using semantic search."""
        limit = SearchConfig.get_search_limit(limit)
        try:
            return await self.search_client.search_studies(query, limit, organism)
        finally:
            await self.search_client.close_session()
    
    async def search_by_organism(
        self, 
        organism: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by organism."""
        limit = SearchConfig.get_search_limit(limit)
        try:
            return await self.search_client.search_by_organism(organism, limit)
        finally:
            await self.search_client.close_session()
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by disease."""
        limit = SearchConfig.get_search_limit(limit)
        try:
            return await self.search_client.search_by_disease(disease, limit)
        finally:
            await self.search_client.close_session()
    
    async def search_by_tissue(
        self, 
        tissue: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by tissue type."""
        limit = SearchConfig.get_search_limit(limit)
        try:
            return await self.search_client.search_by_tissue(tissue, limit)
        finally:
            await self.search_client.close_session()
    
    async def search_by_technology(
        self, 
        technology: str, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search studies by technology."""
        limit = SearchConfig.get_search_limit(limit)
        try:
            return await self.search_client.search_by_technology(technology, limit)
        finally:
            await self.search_client.close_session()
    
    async def check_terra_tos_acceptance(self) -> bool:
        """Check if user has accepted current Terra Terms of Service."""
        try:
            return await self.search_client.check_terra_tos_acceptance()
        finally:
            await self.search_client.close_session()
    
    async def get_available_facets(self) -> Dict[str, Any]:
        """Get available search facets."""
        try:
            return await self.search_client.get_available_facets()
        finally:
            await self.search_client.close_session()
    
    async def get_study_files(self, study_accession: str) -> List[Dict[str, Any]]:
        """Get list of files available for a study."""
        try:
            return await self.search_client.get_study_files(study_accession)
        finally:
            await self.search_client.close_session()
    
    async def download_study_file(
        self, 
        study_accession: str, 
        file_id: str, 
        output_path: str,
        progress_callback=None
    ) -> bool:
        """Download a specific file from a study."""
        try:
            return await self.search_client.download_study_file(
                study_accession, file_id, output_path, progress_callback
            )
        finally:
            await self.search_client.close_session()
    
    async def get_study_manifest(self, study_accession: str) -> Optional[Dict[str, Any]]:
        """Get study manifest file."""
        try:
            return await self.search_client.get_study_manifest(study_accession)
        finally:
            await self.search_client.close_session()
    
    async def create_bulk_download_auth(self, study_accessions: List[str]) -> Optional[str]:
        """Create one-time auth code for bulk downloads."""
        try:
            return await self.search_client.create_bulk_download_auth(study_accessions)
        finally:
            await self.search_client.close_session()
    
    async def get_bulk_download_summary(self, auth_code: str) -> Optional[Dict[str, Any]]:
        """Get summary information for bulk download."""
        try:
            return await self.search_client.get_bulk_download_summary(auth_code)
        finally:
            await self.search_client.close_session()
    
    async def generate_curl_config(self, auth_code: str, output_path: str) -> bool:
        """Generate curl command file for bulk download."""
        try:
            return await self.search_client.generate_curl_config(auth_code, output_path)
        finally:
            await self.search_client.close_session()
    
    async def cleanup(self):
        """Clean up resources."""
        await self.search_client.close_session()


# Example usage
if __name__ == "__main__":
    async def main():
        client = SimpleBroadClient()
        
        # Example searches
        print("🔍 Searching for cancer studies...")
        cancer_studies = await client.search_by_disease("cancer", limit=5)
        for study in cancer_studies:
            print(f"  {study['id']}: {study['title']} (Score: {study['similarity_score']:.3f})")
        
        print("\n🔍 Searching for human brain studies...")
        brain_studies = await client.search_studies("brain", limit=5, organism="Homo sapiens")
        for study in brain_studies:
            print(f"  {study['id']}: {study['title']} (Score: {study['similarity_score']:.3f})")
        
        print("\n🔍 Searching for 10x technology studies...")
        tech_studies = await client.search_by_technology("10x", limit=5)
        for study in tech_studies:
            print(f"  {study['id']}: {study['title']} (Score: {study['similarity_score']:.3f})")
    
    asyncio.run(main()) 