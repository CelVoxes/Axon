"""PubMed client for scientific literature retrieval."""

import xml.etree.ElementTree as ET
from typing import Dict, List, Any, Optional
from urllib.parse import urlencode
from datetime import datetime

from .base_client import BaseDataSource
from ..config import settings


class PubMedClient(BaseDataSource):
    """Client for accessing PubMed literature database."""
    
    def __init__(self):
        """Initialize PubMed client."""
        super().__init__(settings.pubmed_api_base)
        self.esearch_url = f"{self.base_url}esearch.fcgi"
        self.efetch_url = f"{self.base_url}efetch.fcgi"
        self.elink_url = f"{self.base_url}elink.fcgi"
    
    async def search(
        self, 
        query: str, 
        limit: int = 10, 
        **kwargs
    ) -> List[Dict[str, Any]]:
        """Search PubMed articles.
        
        Args:
            query: Search query
            limit: Maximum number of results
            **kwargs: Additional search parameters
            
        Returns:
            List of PubMed article metadata
        """
        # Search for PMIDs
        search_params = {
            "db": "pubmed",
            "term": query,
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
        
        pmids = [id_elem.text for id_elem in id_list.findall("Id")]
        
        # Fetch detailed information for all PMIDs
        return await self._fetch_article_details(pmids)
    
    async def get_details(self, identifier: str) -> Dict[str, Any]:
        """Get detailed information for a specific PubMed article.
        
        Args:
            identifier: PubMed ID (PMID)
            
        Returns:
            Detailed article information
        """
        articles = await self._fetch_article_details([identifier])
        return articles[0] if articles else {}
    
    async def _fetch_article_details(self, pmids: List[str]) -> List[Dict[str, Any]]:
        """Fetch detailed information for multiple PMIDs.
        
        Args:
            pmids: List of PubMed IDs
            
        Returns:
            List of article details
        """
        if not pmids:
            return []
        
        # Fetch article details
        fetch_params = {
            "db": "pubmed",
            "id": ",".join(pmids),
            "retmode": "xml"
        }
        
        if settings.ncbi_api_key:
            fetch_params["api_key"] = settings.ncbi_api_key
        
        fetch_url = f"{self.efetch_url}?{urlencode(fetch_params)}"
        response = await self._make_request("GET", fetch_url)
        
        # Parse XML response
        articles = []
        try:
            root = ET.fromstring(response.text)
            
            for article_elem in root.findall(".//PubmedArticle"):
                article_data = self._parse_article_xml(article_elem)
                if article_data:
                    articles.append(article_data)
        
        except ET.ParseError:
            pass
        
        return articles
    
    def _parse_article_xml(self, article_elem: ET.Element) -> Dict[str, Any]:
        """Parse a single PubMed article XML element.
        
        Args:
            article_elem: XML element containing article data
            
        Returns:
            Parsed article data
        """
        try:
            # Basic article information
            medline_citation = article_elem.find("MedlineCitation")
            article = medline_citation.find("Article")
            
            result = {
                "source": "PubMed",
                "type": "article"
            }
            
            # PMID
            pmid_elem = medline_citation.find("PMID")
            if pmid_elem is not None:
                result["id"] = pmid_elem.text
                result["pmid"] = pmid_elem.text
            
            # Title
            title_elem = article.find(".//ArticleTitle")
            if title_elem is not None:
                result["title"] = title_elem.text or ""
            
            # Abstract
            abstract_elem = article.find(".//AbstractText")
            if abstract_elem is not None:
                result["abstract"] = abstract_elem.text or ""
                result["description"] = result["abstract"]  # For consistency
            
            # Authors
            authors = []
            author_list = article.find(".//AuthorList")
            if author_list is not None:
                for author_elem in author_list.findall("Author"):
                    last_name = author_elem.find("LastName")
                    first_name = author_elem.find("ForeName")
                    
                    if last_name is not None:
                        author_name = last_name.text or ""
                        if first_name is not None:
                            author_name = f"{first_name.text or ''} {author_name}"
                        authors.append(author_name.strip())
            
            result["authors"] = authors
            
            # Journal
            journal_elem = article.find(".//Journal/Title")
            if journal_elem is not None:
                result["journal"] = journal_elem.text or ""
            
            # Publication date
            pub_date_elem = article.find(".//PubDate")
            if pub_date_elem is not None:
                year_elem = pub_date_elem.find("Year")
                month_elem = pub_date_elem.find("Month")
                day_elem = pub_date_elem.find("Day")
                
                if year_elem is not None:
                    result["year"] = year_elem.text
                    
                    # Construct full date if available
                    try:
                        year = int(year_elem.text)
                        month = int(month_elem.text) if month_elem is not None and month_elem.text.isdigit() else 1
                        day = int(day_elem.text) if day_elem is not None and day_elem.text.isdigit() else 1
                        
                        result["publication_date"] = datetime(year, month, day).isoformat()
                    except (ValueError, TypeError):
                        result["publication_date"] = year_elem.text
            
            # Keywords/MeSH terms
            keywords = []
            mesh_list = medline_citation.find(".//MeshHeadingList")
            if mesh_list is not None:
                for mesh_elem in mesh_list.findall("MeshHeading"):
                    descriptor = mesh_elem.find("DescriptorName")
                    if descriptor is not None:
                        keywords.append(descriptor.text or "")
            
            result["keywords"] = keywords
            result["mesh_terms"] = keywords  # Alias for biological context
            
            # DOI
            article_id_list = article_elem.find(".//PubmedData/ArticleIdList")
            if article_id_list is not None:
                for article_id in article_id_list.findall("ArticleId"):
                    id_type = article_id.get("IdType")
                    if id_type == "doi":
                        result["doi"] = article_id.text
                    elif id_type == "pmc":
                        result["pmc"] = article_id.text
            
            return result
            
        except Exception as e:
            print(f"Error parsing article XML: {e}")
            return {}
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: int = 10,
        years: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search PubMed articles by disease name.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            years: Limit to articles from last N years
            
        Returns:
            List of relevant articles
        """
        query = f'"{disease}"[MeSH Terms] OR "{disease}"[Title/Abstract]'
        
        if years:
            current_year = datetime.now().year
            start_year = current_year - years
            query += f" AND {start_year}:{current_year}[pdat]"
        
        return await self.search(query, limit=limit)
    
    async def search_by_gene(
        self, 
        gene: str, 
        limit: int = 10,
        organism: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search PubMed articles by gene name.
        
        Args:
            gene: Gene name or symbol
            limit: Maximum number of results
            organism: Organism name (e.g., "Homo sapiens")
            
        Returns:
            List of relevant articles
        """
        query = f'"{gene}"[Gene Name] OR "{gene}"[Title/Abstract]'
        
        if organism:
            query += f' AND "{organism}"[MeSH Terms]'
        
        return await self.search(query, limit=limit)
    
    async def get_related_articles(self, pmid: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Get articles related to a specific PMID.
        
        Args:
            pmid: PubMed ID
            limit: Maximum number of related articles
            
        Returns:
            List of related articles
        """
        # Use elink to find related articles
        link_params = {
            "dbfrom": "pubmed",
            "db": "pubmed",
            "id": pmid,
            "cmd": "neighbor",
            "retmode": "xml"
        }
        
        if settings.ncbi_api_key:
            link_params["api_key"] = settings.ncbi_api_key
        
        link_url = f"{self.elink_url}?{urlencode(link_params)}"
        response = await self._make_request("GET", link_url)
        
        # Parse linked PMIDs
        try:
            root = ET.fromstring(response.text)
            link_set = root.find(".//LinkSet")
            
            if link_set is not None:
                link_set_db = link_set.find(".//LinkSetDb")
                if link_set_db is not None:
                    linked_pmids = []
                    for link in link_set_db.findall("Link"):
                        id_elem = link.find("Id")
                        if id_elem is not None and id_elem.text != pmid:
                            linked_pmids.append(id_elem.text)
                    
                    # Get details for the first few related articles
                    return await self._fetch_article_details(linked_pmids[:limit])
        
        except ET.ParseError:
            pass
        
        return [] 