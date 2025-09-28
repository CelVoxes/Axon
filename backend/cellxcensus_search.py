"""Simplified CellxCensus single-cell data search system."""

import asyncio
import json
import time
import textwrap
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

import pandas as pd

try:
    from .config import SearchConfig
except ImportError:
    from config import SearchConfig
from .llm_similarity import score_items_with_llm

try:
    import cellxgene_census
    import anndata as ad
    CELLXCENSUS_AVAILABLE = True
except ImportError:
    CELLXCENSUS_AVAILABLE = False
    print("⚠️ cellxgene_census not available. Install with: pip install cellxgene-census")


class CellxCensusSearch:
    """Simplified system for finding single-cell datasets using CellxCensus API with LLM-guided search."""

    def __init__(self):
        if not CELLXCENSUS_AVAILABLE:
            raise ImportError("cellxgene_census is required. Install with: pip install cellxgene-census")

        self.census: Any = None
        self.progress_callback: Optional[Callable[[Dict[str, Any]], Union[None, Awaitable[None]]]] = None
        # In-memory caches
        self._metadata_cache: Dict[str, Any] = {}
        self._search_cache: Dict[str, Any] = {}
    
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
    
    async def _ensure_census_open(self):
        """Ensure the census is opened."""
        if self.census is None:
            loop = asyncio.get_event_loop()

            # TODO: Dataset IDs are changed in every version. So, we need to fix this in later versions.
            versions_to_try = ["2025-01-30", "2024-07-01", "2023-07-25", None]
            
            for version in versions_to_try:
                try:
                    if version:
                        self.census = await loop.run_in_executor(
                            None, 
                            lambda v=version: cellxgene_census.open_soma(census_version=v)
                        )
                        print(f"✅ Census opened successfully with version {version}")
                    else:
                        self.census = await loop.run_in_executor(
                            None, 
                            cellxgene_census.open_soma
                        )
                        print("✅ Census opened successfully with latest version")
                    break
                except Exception as e:
                    print(f"⚠️ Failed to open census with version {version}: {e}")
                    if version == versions_to_try[-1]:
                        raise e
                    continue
    
    async def search_datasets(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find single-cell datasets using LLM-guided search."""
        limit = SearchConfig.get_search_limit(limit)
        # Cache lookup for search
        try:
            now = time.time()
            cache_ttl = SearchConfig.get_cache_search_ttl_seconds()
            key = f"q::{(query or '').strip().lower()}|org::{(organism or '').strip().lower()}|lim::{limit}"
            cached = self._search_cache.get(key)
            if cached and (now - cached['ts'] < cache_ttl):
                await self._send_progress_update({
                    'step': 'cache_hit',
                    'progress': 90,
                    'message': 'Returning cached results',
                    'datasetsFound': len(cached['value'])
                })
                return (cached['value'] or [])[:limit]
        except Exception:
            pass
        
        await self._send_progress_update({
            'step': 'init',
            'progress': 5,
            'message': 'Initializing CellxCensus search...',
            'datasetsFound': 0
        })
        
        await self._send_progress_update({
            'step': 'preparing',
            'progress': 15,
            'message': f'Preparing semantic search for: "{query}"',
            'datasetsFound': 0
        })
        
        try:
            await self._ensure_census_open()
            
            await self._send_progress_update({
                'step': 'census_ready',
                'progress': 25,
                'message': 'Census ready, searching...',
                'datasetsFound': 0
            })
            
            # Use direct semantic search on metadata
            datasets = await self._search_datasets_core(query, limit, organism)
            
            if datasets:
                await self._send_progress_update({
                    'step': 'similarity',
                    'progress': 80,
                    'message': 'Scoring datasets with LLM...',
                    'datasetsFound': len(datasets)
                })
                
                # Calculate similarity scores using original query
                enhanced_datasets = await self._calculate_similarity_scores(query, datasets)
                enhanced_datasets.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
                
                await self._send_progress_update({
                    'step': 'complete',
                    'progress': 100,
                    'message': f'Found {len(enhanced_datasets)} datasets!',
                    'datasetsFound': len(enhanced_datasets)
                })
                
                # Store search results
                try:
                    key = f"q::{(query or '').strip().lower()}|org::{(organism or '').strip().lower()}|lim::{limit}"
                    self._search_cache[key] = {'ts': now, 'value': enhanced_datasets}
                    # Trim cache if needed
                    try:
                        max_entries = SearchConfig.get_cache_max_search_entries()
                        if len(self._search_cache) > max_entries:
                            oldest_key = min(self._search_cache.items(), key=lambda kv: kv[1]['ts'])[0]
                            self._search_cache.pop(oldest_key, None)
                    except Exception:
                        pass
                except Exception:
                    pass
                return enhanced_datasets[:limit]
            else:
                await self._send_progress_update({
                    'step': 'complete',
                    'progress': 100,
                    'message': 'No matching datasets found',
                    'datasetsFound': 0
                })
                return []
                
        except Exception as e:
            print(f"❌ Error in CellxCensus search: {e}")
            return []
    
    async def _search_datasets_core(
        self,
        query: str,
        limit: int,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Core dataset search using semantic search on metadata."""
        try:
            await self._send_progress_update({
                'step': 'loading_metadata',
                'progress': 30,
                'message': 'Loading dataset metadata...',
                'datasetsFound': 0
            })
            
            # Load all dataset metadata (with cache)
            loop = asyncio.get_event_loop()
            census = self.census
            assert census is not None, "Census must be initialized"
            
            now = time.time()
            md_ttl = SearchConfig.get_cache_metadata_ttl_seconds()
            cached_md = self._metadata_cache.get('datasets_df')
            if cached_md and (now - cached_md['ts'] < md_ttl):
                datasets_df = cached_md['value']
            else:
                datasets_df = await loop.run_in_executor(
                    None,
                    lambda: census['census_info']['datasets'].read().concat().to_pandas()
                )
                self._metadata_cache['datasets_df'] = {'ts': now, 'value': datasets_df}
            
            # Debug: Print available columns to understand metadata structure
            # if len(datasets_df) > 0:
            #     print(f"🔍 Available CellxCensus columns: {list(datasets_df.columns)}")
            #     print(f"🔍 Sample row data (first few fields): {dict(list(datasets_df.iloc[0].items())[:10])}")
            
            await self._send_progress_update({
                'step': 'semantic_search',
                'progress': 50,
                'message': f'Performing semantic search on {len(datasets_df)} datasets...',
                'datasetsFound': 0
            })
            
            # Convert dataset metadata to searchable format (cache by organism)
            conv_key = f"convert::{str(organism or '').lower()}"
            cached_conv = self._metadata_cache.get(conv_key)
            if cached_conv and (now - cached_conv['ts'] < md_ttl):
                datasets = cached_conv['value']
            else:
                datasets = await self._convert_metadata_to_datasets(datasets_df, organism)
                self._metadata_cache[conv_key] = {'ts': now, 'value': datasets}
            
            await self._send_progress_update({
                'step': 'processing',
                'progress': 75,
                'message': f'Processed {len(datasets)} datasets for similarity',
                'datasetsFound': len(datasets)
            })
            
            return datasets
            
        except Exception as e:
            print(f"❌ Error in metadata search: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    async def _convert_metadata_to_datasets(
        self, 
        datasets_df: pd.DataFrame, 
        organism: Optional[str]
    ) -> List[Dict[str, Any]]:
        """Convert dataset metadata DataFrame to our standard dataset format."""
        datasets = []
        
        for _, row in datasets_df.iterrows():
            # Use the rich metadata fields directly
            collection_name = str(row.get('collection_name', ''))
            dataset_title = str(row.get('dataset_title', ''))
            citation = str(row.get('citation', ''))
            
            # Use collection_name as the main title (it's more descriptive)
            title = collection_name if collection_name and collection_name != 'nan' else "Unknown Study"
            
            # Create comprehensive description from available fields
            description_parts = []
            
            # Add dataset-specific title if different from collection
            if dataset_title and dataset_title != 'nan' and dataset_title != collection_name:
                description_parts.append(f"Dataset: {dataset_title}")
            
            # Add cell count
            cell_count = row.get('dataset_total_cell_count', 0)
            description_parts.append(f"{cell_count:,} cells")
            
            # Infer platform from citation and collection metadata
            platform = self._infer_platform_from_metadata(citation, collection_name, dataset_title)
            
            # Create dataset entry with rich searchable content
            generated_url = f"https://datasets.cellxgene.cziscience.com/{row['dataset_version_id']}.h5ad"
            
            dataset = {
                'id': row['dataset_id'],
                'version_id': row['dataset_version_id'],
                'title': title,
                'description': " | ".join(description_parts),
                'organism': organism or "Unknown", 
                'sample_count': cell_count,
                'platform': platform,
                'source': 'CellxCensus',
                'collection_name': collection_name,
                'dataset_title': dataset_title,
                'citation': citation,
                'url': generated_url,
                'similarity_score': 0.0  # Will be calculated later
            }
            
            datasets.append(dataset)

        print(f"✅ Converted {len(datasets)} datasets with extracted keywords")
        return datasets
    
    def _infer_platform_from_metadata(self, citation: str, collection_name: str, dataset_title: str) -> str:
        """Infer the sequencing platform from metadata text."""
        # Combine all text for analysis
        text = f"{citation} {collection_name} {dataset_title}".lower()
        
        # Check for specific technologies
        if any(tech in text for tech in ['10x', '10×', 'chromium']):
            return "10x Chromium scRNA-seq"
        elif any(tech in text for tech in ['smart-seq', 'smartseq', 'smart seq']):
            return "Smart-seq scRNA-seq"
        elif any(tech in text for tech in ['drop-seq', 'dropseq']):
            return "Drop-seq scRNA-seq"
        elif any(tech in text for tech in ['seq-well', 'seqwell']):
            return "Seq-Well scRNA-seq"
        elif any(tech in text for tech in ['cite-seq', 'citeseq']):
            return "CITE-seq (scRNA + protein)"
        elif any(tech in text for tech in ['multiome', 'multi-ome']):
            return "10x Multiome (scRNA + ATAC)"
        elif any(tech in text for tech in ['spatial', 'visium']):
            return "Spatial transcriptomics"
        elif any(tech in text for tech in ['single-nucleus', 'single nucleus', 'sn-rna', 'snrna']):
            return "Single-nucleus RNA-seq"
        elif any(tech in text for tech in ['bulk rna', 'bulk-rna', 'bulk sequencing']):
            return "Bulk RNA-seq"
        elif any(tech in text for tech in ['microarray']):
            return "Microarray"
        elif any(tech in text for tech in ['proteomics', 'mass spec']):
            return "Proteomics"
        else:
            # Default for CellxCensus data
            return "scRNA-seq"


    async def _calculate_similarity_scores(
        self,
        query: str,
        datasets: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Calculate semantic similarity scores using the shared LLM service."""

        try:
            dataset_texts: List[str] = [self._summarize_dataset(d) for d in datasets]
            indexed_summaries = list(enumerate(dataset_texts))

            llm_scores = await score_items_with_llm(query, indexed_summaries, batch_size=10)
            query_lower = query.lower()

            for idx, dataset in enumerate(datasets):
                semantic_similarity = llm_scores.get(idx, 0.35)
                semantic_similarity = max(0.0, min(1.0, semantic_similarity))

                dataset_text = dataset_texts[idx].lower()
                exact_match_bonus = 0.0

                if query_lower and query_lower in dataset_text:
                    exact_match_bonus += 0.3

                query_words = [w for w in query_lower.split() if w]
                for query_word in query_words:
                    if query_word in dataset_text:
                        exact_match_bonus += 0.15
                        continue
                    for dataset_word in dataset_text.split():
                        if len(query_word) < 3:
                            continue
                        if query_word in dataset_word:
                            exact_match_bonus += 0.08
                            break
                        if dataset_word in query_word and len(dataset_word) >= 3:
                            exact_match_bonus += 0.08
                            break

                query_upper = query.upper()
                if query_upper and query_upper in dataset_text.upper():
                    exact_match_bonus += 0.2

                final_similarity = min(1.0, max(0.0, semantic_similarity + exact_match_bonus))
                dataset['similarity_score'] = final_similarity

            return datasets

        except Exception as e:
            print(f"❌ Error calculating similarity: {e}")
            for dataset in datasets:
                dataset['similarity_score'] = 0.0
            return datasets

    async def close_census(self):
        """Close the census connection."""
        if self.census:
            try:
                await asyncio.get_event_loop().run_in_executor(None, self.census.close)
                self.census = None
            except Exception as e:
                print(f"Warning: Error closing census: {e}")

    def _summarize_dataset(self, dataset: Dict[str, Any]) -> str:
        """Build a concise textual summary for LLM scoring."""
        parts: List[str] = []
        title = dataset.get('dataset_title') or dataset.get('title') or dataset.get('collection_name')
        if title:
            parts.append(f"Title: {title}")
        disease = dataset.get('disease') or dataset.get('disease_name')
        if disease:
            if isinstance(disease, (list, tuple)):
                disease_str = ", ".join(str(d) for d in disease if d)
            else:
                disease_str = str(disease)
            if disease_str:
                parts.append(f"Disease: {disease_str}")
        organism = dataset.get('organism') or dataset.get('donor_species')
        if organism:
            parts.append(f"Organism: {organism}")
        technology = dataset.get('technology') or dataset.get('technology_name')
        if technology:
            parts.append(f"Technology: {technology}")
        summary = (
            dataset.get('description')
            or dataset.get('collection_description')
            or dataset.get('summary')
            or dataset.get('dataset_description')
        )
        if summary:
            parts.append(f"Summary: {summary}")
        text = " | ".join(parts) if parts else "No description available."
        return textwrap.shorten(" ".join(text.split()), width=500, placeholder="…")


class SimpleCellxCensusClient:
    """Simple client interface for CellxCensus operations."""
    
    def __init__(self):
        # Initialize CellxCensus search if available; otherwise, fall back to GEO at call time
        try:
            self.search_client = CellxCensusSearch()
            self._init_error: Optional[Exception] = None
        except Exception as e:
            # Defer to GEO fallback when CellxCensus is not available or fails to init
            print(f"⚠️ CellxCensus unavailable, will fall back to GEO search when called: {e}")
            self.search_client = None
            self._init_error = e
        self._progress_callback: Optional[Callable[[Dict[str, Any]], Union[None, Awaitable[None]]]] = None
    
    def set_progress_callback(self, callback):
        """Set the progress callback function."""
        self._progress_callback = callback
        if self.search_client:
            self.search_client.set_progress_callback(callback)
    
    async def find_similar_datasets(
        self, 
        query: str, 
        limit: Optional[int] = None,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find similar datasets using intelligent search."""
        limit = SearchConfig.get_search_limit(limit)
        # If CellxCensus search client is not available, gracefully fall back to GEO
        if not self.search_client:
            try:
                try:
                    from .geo_search import SimpleGEOClient  # type: ignore
                except ImportError:
                    from geo_search import SimpleGEOClient  # type: ignore
                geo_client = SimpleGEOClient()
                if self._progress_callback:
                    geo_client.set_progress_callback(self._progress_callback)
                return await geo_client.find_similar_datasets(query, limit, organism)
            except Exception as fallback_error:
                print(f"❌ GEO fallback failed: {fallback_error}")
                return []
        # Normal CellxCensus path
        try:
            return await self.search_client.search_datasets(query, limit, organism)
        finally:
            await self.search_client.close_census()
    
    async def cleanup(self):
        """Clean up resources."""
        if self.search_client:
            await self.search_client.close_census()
