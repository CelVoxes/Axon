"""Minimal GEO semantic search system."""

import asyncio
import numpy as np
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
import aiohttp
from bs4 import BeautifulSoup
import re


class MinimalGEOSearch:
    """Minimal system for finding similar GEO datasets using semantic search."""
    
    def __init__(self, embedding_model: str = "all-MiniLM-L6-v2"):
        """Initialize minimal GEO search.
        
        Args:
            embedding_model: Sentence transformer model for embeddings
        """
        self.model = None
        self.model_name = embedding_model
        self._lock = asyncio.Lock()
    
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
        limit: int = 10,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find GEO datasets most similar to the query.
        
        Args:
            query: Search query describing desired dataset
            limit: Maximum number of results
            organism: Filter by organism
            
        Returns:
            List of similar datasets with similarity scores
        """
        # Step 1: Search GEO for candidate datasets
        print(f"🔍 Searching GEO for: '{query}'")
        candidate_datasets = await self._search_geo_datasets(query, limit * 3, organism)
        
        if not candidate_datasets:
            return []
        
        print(f"📊 Found {len(candidate_datasets)} candidate datasets")
        
        # Step 2: Create embeddings and calculate similarities
        await self._ensure_model_loaded()
        
        # Encode query
        query_embedding = await self._encode_text(query)
        
        # Calculate similarities
        similarities = []
        for dataset in candidate_datasets:
            # Create text representation of dataset
            dataset_text = self._create_dataset_text(dataset)
            
            # Encode dataset
            dataset_embedding = await self._encode_text(dataset_text)
            
            # Calculate cosine similarity
            similarity = self._cosine_similarity(query_embedding, dataset_embedding)
            
            similarities.append((dataset, similarity))
        
        # Step 3: Sort by similarity and return top results
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        results = []
        for dataset, score in similarities[:limit]:
            result = dataset.copy()
            result["similarity_score"] = float(score)
            results.append(result)
        
        print(f"✅ Returning top {len(results)} most similar datasets")
        return results
    
    async def _search_geo_datasets(
        self, 
        query: str, 
        limit: int = 30,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search GEO database for datasets.
        
        Args:
            query: Search query
            limit: Maximum results
            organism: Organism filter
            
        Returns:
            List of dataset metadata
        """
        try:
            # Build search query
            search_terms = [query]
            if organism:
                search_terms.append(f'"{organism}"[organism]')
            
            full_query = " AND ".join(search_terms)
            
            # Search using NCBI E-utilities - search in GEO database for series
            search_params = {
                "db": "gds",
                "term": f"{full_query}[text]",
                "retmax": limit,
                "retmode": "xml",
                "usehistory": "y"
            }
            
            search_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?{self._build_query_string(search_params)}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(search_url) as response:
                    if response.status != 200:
                        print(f"Search failed: {response.status}")
                        return []
                    
                    xml_text = await response.text()
                    
                    # Parse XML to get GEO IDs
                    geo_ids = self._parse_geo_ids(xml_text)
                    
                    if not geo_ids:
                        return []
                    
                    # Get details for each dataset
                    datasets = []
                    for i, geo_id in enumerate(geo_ids):
                        try:
                            if i > 0:
                                await asyncio.sleep(0.5)  # Rate limiting
                            
                            details = await self._get_dataset_details(geo_id)
                            if details:
                                datasets.append(details)
                        except Exception as e:
                            print(f"Failed to get details for {geo_id}: {e}")
                            continue
                    
                    return datasets
                    
        except Exception as e:
            print(f"Error searching GEO: {e}")
            return []
    
    def _parse_geo_ids(self, xml_text: str) -> List[str]:
        """Parse GEO IDs from XML response."""
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(xml_text)
            id_list = root.find("IdList")
            
            if id_list is None:
                return []
            
            # For now, let's try a different approach - use the numeric IDs
            # and construct GEO URLs directly
            numeric_ids = [id_elem.text for id_elem in id_list.findall("Id")]
            
            # Try to get actual GEO accessions using a different method
            geo_accessions = []
            for numeric_id in numeric_ids:
                try:
                    # Use esummary to get more details
                    summary_params = {
                        "db": "gds",
                        "id": numeric_id,
                        "retmode": "xml"
                    }
                    
                    import requests
                    summary_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?{self._build_query_string(summary_params)}"
                    response = requests.get(summary_url)
                    
                    if response.status_code == 200:
                        # Parse the XML to get the accession
                        summary_root = ET.fromstring(response.text)
                        
                        # Try to get the GEO series ID from the summary
                        series_elem = summary_root.find(".//Item[@Name='GSE']")
                        if series_elem is not None and series_elem.text:
                            geo_accessions.append(f"GSE{series_elem.text}")
                        else:
                            # Try to get the accession
                            accession_elem = summary_root.find(".//Item[@Name='Accession']")
                            if accession_elem is not None and accession_elem.text:
                                geo_accessions.append(accession_elem.text)
                            else:
                                # If we can't get the accession, use the numeric ID as fallback
                                geo_accessions.append(f"GDS{numeric_id}")
                except Exception as e:
                    print(f"Error fetching summary for ID {numeric_id}: {e}")
                    # Use numeric ID as fallback
                    geo_accessions.append(f"GDS{numeric_id}")
            
            return geo_accessions
            
        except Exception as e:
            print(f"Error parsing XML: {e}")
            return []
    
    async def _get_dataset_details(self, geo_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed information for a GEO dataset.
        
        Args:
            geo_id: GEO accession ID
            
        Returns:
            Dataset metadata
        """
        try:
            geo_url = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={geo_id}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(geo_url) as response:
                    if response.status != 200:
                        return None
                    
                    html_text = await response.text()
                    
                    # Parse HTML to extract information
                    soup = BeautifulSoup(html_text, 'html.parser')
                    
                    result = {
                        "id": geo_id,
                        "title": f"Dataset {geo_id}",
                        "description": f"GEO dataset {geo_id}",
                        "organism": "Unknown",
                        "sample_count": "0",
                        "platform": "Unknown",
                        "source": "GEO"
                    }
                    
                    # Extract title
                    title_elem = soup.find('td', text='Title')
                    if title_elem and title_elem.find_next_sibling('td'):
                        result["title"] = title_elem.find_next_sibling('td').get_text(strip=True)
                    
                    # Extract summary
                    summary_elem = soup.find('td', text='Summary')
                    if summary_elem and summary_elem.find_next_sibling('td'):
                        result["description"] = summary_elem.find_next_sibling('td').get_text(strip=True)
                    
                    # Extract organism
                    organism_elem = soup.find('td', text='Organism')
                    if organism_elem and organism_elem.find_next_sibling('td'):
                        organism_text = organism_elem.find_next_sibling('td').get_text(strip=True)
                        # Clean up organism text (remove links)
                        if organism_text:
                            result["organism"] = organism_text
                    
                    # Extract sample count from "Samples (X)" format
                    import re
                    # Search for "Samples (X)" pattern in the entire HTML
                    sample_match = re.search(r'Samples\s*\((\d+)\)', html_text)
                    if sample_match:
                        result["sample_count"] = sample_match.group(1)
                    
                    # Extract platform from "Platforms (X)" section
                    platform_elem = soup.find('td', text=lambda x: x and 'Platforms' in x)
                    if platform_elem and platform_elem.find_next_sibling('td'):
                        platform_text = platform_elem.find_next_sibling('td').get_text(strip=True)
                        if platform_text:
                            result["platform"] = platform_text
                    
                    return result
                    
        except Exception as e:
            print(f"Error getting details for {geo_id}: {e}")
            return None
    
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
    """Simple client for GEO semantic search."""
    
    def __init__(self):
        """Initialize simple GEO client."""
        self.search = MinimalGEOSearch()
    
    async def find_similar_datasets(
        self, 
        query: str, 
        limit: int = 10,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find GEO datasets most similar to the query.
        
        Args:
            query: Search query
            limit: Maximum results
            organism: Organism filter
            
        Returns:
            List of similar datasets with similarity scores
        """
        return await self.search.search_datasets(
            query=query,
            limit=limit,
            organism=organism
        )
    
    async def search_by_gene(
        self, 
        gene: str, 
        organism: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Find GEO datasets related to a specific gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism filter
            limit: Maximum results
            
        Returns:
            Gene-related datasets
        """
        query = f"{gene} gene expression"
        return await self.find_similar_datasets(query, limit, organism)
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Find GEO datasets related to a specific disease.
        
        Args:
            disease: Disease name
            limit: Maximum results
            
        Returns:
            Disease-related datasets
        """
        query = f"{disease} disease gene expression"
        return await self.find_similar_datasets(query, limit)


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