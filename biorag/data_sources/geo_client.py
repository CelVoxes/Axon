"""GEO (Gene Expression Omnibus) client for biological data retrieval."""

import re
import asyncio
import xml.etree.ElementTree as ET
from typing import Dict, List, Any, Optional
from urllib.parse import urlencode
from bs4 import BeautifulSoup

from .base_client import BaseDataSource
from ..config import settings


class GEOClient(BaseDataSource):
    """Client for accessing GEO (Gene Expression Omnibus) data."""
    
    def __init__(self):
        """Initialize GEO client."""
        super().__init__(settings.geo_api_base)
        self.esearch_url = f"{settings.pubmed_api_base}esearch.fcgi"
        self.efetch_url = f"{settings.pubmed_api_base}efetch.fcgi"
    
    async def search(
        self, 
        query: str, 
        limit: int = 10, 
        dataset_type: str = "gse",
        **kwargs
    ) -> List[Dict[str, Any]]:
        """Search GEO datasets.
        
        Args:
            query: Search query
            limit: Maximum number of results
            dataset_type: Type of dataset (gse, gds, gpl, gsm)
            **kwargs: Additional search parameters
            
        Returns:
            List of GEO dataset metadata
        """
        # Search for GEO IDs using NCBI E-utilities
        search_params = {
            "db": "gds",
            "term": f"{query}[text] AND {dataset_type.upper()}[entry type]",
            "retmax": limit,
            "retmode": "xml",
            "usehistory": "y"
        }
        
        if settings.ncbi_api_key:
            search_params["api_key"] = settings.ncbi_api_key
        
        search_url = f"{self.esearch_url}?{urlencode(search_params)}"
        response = await self._make_request("GET", search_url)
        
        # Parse search results
        root = ET.fromstring(response.text)
        id_list = root.find("IdList")
        
        if id_list is None or len(id_list) == 0:
            return []
        
        geo_ids = [id_elem.text for id_elem in id_list.findall("Id")]
        
        # Get detailed information for each ID with rate limiting
        results = []
        for i, geo_id in enumerate(geo_ids):
            try:
                # Add delay between requests to avoid rate limiting
                if i > 0:
                    await asyncio.sleep(0.5)  # 500ms delay between requests
                
                details = await self.get_details(geo_id)
                if details:
                    results.append(details)
            except Exception as e:
                # Continue with other results if one fails
                print(f"Failed to get details for GEO ID {geo_id}: {e}")
                continue
        
        return results
    
    async def get_details(self, identifier: str) -> Dict[str, Any]:
        """Get detailed information for a specific GEO dataset.
        
        Args:
            identifier: GEO ID (e.g., GSE12345)
            
        Returns:
            Detailed dataset information
        """
        # Fetch from NCBI GDS database
        fetch_params = {
            "db": "gds",
            "id": identifier,
            "retmode": "xml"
        }
        
        if settings.ncbi_api_key:
            fetch_params["api_key"] = settings.ncbi_api_key
        
        fetch_url = f"{self.efetch_url}?{urlencode(fetch_params)}"
        response = await self._make_request("GET", fetch_url)
        
        # Parse XML response
        try:
            root = ET.fromstring(response.text)
            docsum = root.find(".//DocSum")
            
            if docsum is None:
                return {}
            
            # Extract metadata
            result = {
                "id": identifier,
                "source": "GEO",
                "type": "dataset"
            }
            
            # Extract key information from XML
            for item in docsum.findall("Item"):
                name = item.get("Name", "")
                value = item.text or ""
                
                if name == "title":
                    result["title"] = value
                elif name == "summary":
                    result["description"] = value
                elif name == "GPL":
                    result["platform"] = value
                elif name == "taxon":
                    result["organism"] = value
                elif name == "entryType":
                    result["entry_type"] = value
                elif name == "PDAT":
                    result["publication_date"] = value
                elif name == "n_samples":
                    result["sample_count"] = value
            
            # Also try to get additional info from GEO directly
            await self._enrich_geo_details(result)
            
            return result
            
        except ET.ParseError:
            return {}
    
    async def _enrich_geo_details(self, result: Dict[str, Any]):
        """Enrich dataset details by fetching from GEO directly.
        
        Args:
            result: Dataset result to enrich
        """
        geo_id = result.get("id", "")
        if not geo_id:
            return
        
        # Try to extract GSE ID if needed
        gse_match = re.search(r'GSE\d+', geo_id)
        if gse_match:
            gse_id = gse_match.group()
        else:
            gse_id = geo_id
        
        try:
            # Fetch from GEO webpage
            geo_url = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={gse_id}"
            response = await self._make_request("GET", geo_url)
            
            # Parse HTML to extract additional information
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract title if not already present
            if not result.get("title"):
                title_elem = soup.find('td', text='Title')
                if title_elem and title_elem.find_next_sibling('td'):
                    result["title"] = title_elem.find_next_sibling('td').get_text(strip=True)
            
            # Extract summary if not already present
            if not result.get("description"):
                summary_elem = soup.find('td', text='Summary')
                if summary_elem and summary_elem.find_next_sibling('td'):
                    result["description"] = summary_elem.find_next_sibling('td').get_text(strip=True)
            
            # Extract organism
            organism_elem = soup.find('td', text='Organism')
            if organism_elem and organism_elem.find_next_sibling('td'):
                result["organism"] = organism_elem.find_next_sibling('td').get_text(strip=True)
            
            # Extract design information
            design_elem = soup.find('td', text='Experiment type')
            if design_elem and design_elem.find_next_sibling('td'):
                result["experiment_type"] = design_elem.find_next_sibling('td').get_text(strip=True)
            
        except Exception as e:
            # Don't fail the whole request if enrichment fails
            print(f"Failed to enrich GEO details for {geo_id}: {e}")
    
    async def search_datasets(
        self, 
        query: str, 
        limit: int = 10,
        organism: Optional[str] = None,
        experiment_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for GEO datasets with additional filters.
        
        Args:
            query: Search query
            limit: Maximum number of results
            organism: Filter by organism (e.g., "Homo sapiens")
            experiment_type: Filter by experiment type
            
        Returns:
            List of filtered dataset results
        """
        # Build enhanced search query
        search_terms = [query]
        
        if organism:
            search_terms.append(f'"{organism}"[organism]')
        
        if experiment_type:
            search_terms.append(f'"{experiment_type}"[DataSet Type]')
        
        full_query = " AND ".join(search_terms)
        
        return await self.search(full_query, limit=limit)
    
    async def get_series_matrix(self, gse_id: str) -> Optional[str]:
        """Get the series matrix file URL for a GEO series.
        
        Args:
            gse_id: GEO series ID (e.g., GSE12345)
            
        Returns:
            URL to series matrix file or None if not found
        """
        try:
            # Construct series matrix URL
            matrix_url = f"ftp://ftp.ncbi.nlm.nih.gov/geo/series/{gse_id[:-3]}nnn/{gse_id}/matrix/{gse_id}_series_matrix.txt.gz"
            
            # Verify the file exists
            response = await self._make_request("HEAD", matrix_url)
            if response.status_code == 200:
                return matrix_url
                
        except Exception:
            pass
        
        return None 