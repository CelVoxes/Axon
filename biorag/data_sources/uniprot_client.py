"""UniProt client for protein information retrieval."""

import json
from typing import Dict, List, Any, Optional
from urllib.parse import urlencode

from .base_client import BaseDataSource
from ..config import settings


class UniProtClient(BaseDataSource):
    """Client for accessing UniProt protein database."""
    
    def __init__(self):
        """Initialize UniProt client."""
        super().__init__(settings.uniprot_api_base)
        self.search_url = f"{self.base_url}/uniprotkb/search"
        self.retrieve_url = f"{self.base_url}/uniprotkb"
    
    async def search(
        self, 
        query: str, 
        limit: int = 10, 
        **kwargs
    ) -> List[Dict[str, Any]]:
        """Search UniProt entries.
        
        Args:
            query: Search query
            limit: Maximum number of results
            **kwargs: Additional search parameters
            
        Returns:
            List of UniProt entry metadata
        """
        # Clean and validate the query
        clean_query = self._clean_uniprot_query(query)
        if not clean_query:
            return []
        
        # Build search parameters
        search_params = {
            "query": clean_query,
            "size": min(limit, 25),  # Limit to prevent large requests
            "format": "json",
            "fields": "accession,id,protein_name,gene_names,organism_name,length"  # Simplified fields
        }
        
        search_url = f"{self.search_url}?{urlencode(search_params)}"
        
        try:
            response = await self._make_request("GET", search_url)
            
            # Parse JSON response
            data = response.json()
            results = []
            
            for entry in data.get("results", []):
                result = self._parse_uniprot_entry(entry)
                if result:
                    results.append(result)
            
            return results
            
        except (json.JSONDecodeError, KeyError, Exception) as e:
            print(f"UniProt search failed for query '{clean_query}': {e}")
            return []

    def _clean_uniprot_query(self, query: str) -> str:
        """Clean and format query for UniProt API."""
        if not query or not query.strip():
            return ""
        
        # Remove problematic characters and terms
        clean_query = query.strip()
        
        # Remove invalid UniProt operators
        invalid_terms = ["ONLY", "AND", "OR", "NOT"]
        for term in invalid_terms:
            clean_query = clean_query.replace(f" {term} ", " ")
            clean_query = clean_query.replace(f"{term} ", "")
            clean_query = clean_query.replace(f" {term}", "")
        
        # Replace spaces with proper UniProt query format
        clean_query = clean_query.replace(" ", " AND ")
        
        # Remove extra whitespace
        clean_query = " ".join(clean_query.split())
        
        # Validate final query length
        if len(clean_query) > 200:
            # Truncate to first few terms
            terms = clean_query.split(" AND ")[:3]
            clean_query = " AND ".join(terms)
        
        return clean_query if clean_query else ""
    
    async def get_details(self, identifier: str) -> Dict[str, Any]:
        """Get detailed information for a specific UniProt entry.
        
        Args:
            identifier: UniProt accession or ID
            
        Returns:
            Detailed protein information
        """
        url = f"{self.retrieve_url}/{identifier}.json"
        
        try:
            response = await self._make_request("GET", url)
            data = response.json()
            return self._parse_uniprot_entry(data)
            
        except (json.JSONDecodeError, Exception):
            return {}
    
    def _parse_uniprot_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a UniProt entry into standardized format.
        
        Args:
            entry: Raw UniProt entry data
            
        Returns:
            Parsed entry data
        """
        try:
            result = {
                "source": "UniProt",
                "type": "protein"
            }
            
            # Basic identifiers
            result["id"] = entry.get("primaryAccession", "")
            result["accession"] = entry.get("primaryAccession", "")
            result["entry_name"] = entry.get("uniProtkbId", "")
            
            # Protein names
            protein_description = entry.get("proteinDescription", {})
            recommended_name = protein_description.get("recommendedName", {})
            if recommended_name:
                full_name = recommended_name.get("fullName", {})
                result["protein_name"] = full_name.get("value", "") if full_name else ""
                result["title"] = result["protein_name"]  # For consistency
            
            # Gene names
            genes = entry.get("genes", [])
            gene_names = []
            primary_gene = None
            
            for gene in genes:
                gene_name = gene.get("geneName", {})
                if gene_name:
                    name_value = gene_name.get("value", "")
                    if name_value:
                        gene_names.append(name_value)
                        if not primary_gene:
                            primary_gene = name_value
            
            result["gene_names"] = gene_names
            result["primary_gene"] = primary_gene
            
            # Organism
            organism = entry.get("organism", {})
            if organism:
                result["organism"] = organism.get("scientificName", "")
                result["organism_id"] = organism.get("taxonId", "")
            
            # Sequence information
            sequence = entry.get("sequence", {})
            if sequence:
                result["length"] = sequence.get("length", 0)
                result["sequence"] = sequence.get("value", "")
            
            # Function annotation
            comments = entry.get("comments", [])
            for comment in comments:
                comment_type = comment.get("commentType", "")
                
                if comment_type == "FUNCTION":
                    texts = comment.get("texts", [])
                    if texts:
                        result["function"] = texts[0].get("value", "")
                        if not result.get("description"):
                            result["description"] = result["function"]
                
                elif comment_type == "DISEASE":
                    disease_info = comment.get("disease", {})
                    if disease_info:
                        disease_name = disease_info.get("diseaseId", "")
                        result["associated_diseases"] = result.get("associated_diseases", [])
                        result["associated_diseases"].append(disease_name)
                
                elif comment_type == "SUBCELLULAR LOCATION":
                    subcell_locations = comment.get("subcellularLocations", [])
                    locations = []
                    for location in subcell_locations:
                        loc = location.get("location", {})
                        if loc:
                            locations.append(loc.get("value", ""))
                    result["subcellular_location"] = locations
            
            # Features (domains, etc.)
            features = entry.get("features", [])
            domains = []
            for feature in features:
                if feature.get("type") == "Domain":
                    domain_desc = feature.get("description", "")
                    if domain_desc:
                        domains.append(domain_desc)
            
            result["domains"] = domains
            
            # Gene Ontology terms
            go_terms = []
            references = entry.get("uniProtKBCrossReferences", [])
            for ref in references:
                if ref.get("database") == "GO":
                    go_id = ref.get("id", "")
                    properties = ref.get("properties", [])
                    go_term = ""
                    for prop in properties:
                        if prop.get("key") == "GoTerm":
                            go_term = prop.get("value", "")
                            break
                    
                    if go_id and go_term:
                        go_terms.append({"id": go_id, "term": go_term})
            
            result["go_terms"] = go_terms
            
            # PubMed references
            pubmed_ids = []
            for ref in references:
                if ref.get("database") == "PubMed":
                    pubmed_ids.append(ref.get("id", ""))
            
            result["pubmed_refs"] = pubmed_ids
            
            return result
            
        except Exception as e:
            print(f"Error parsing UniProt entry: {e}")
            return {}
    
    async def search_by_gene(
        self, 
        gene: str, 
        organism: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search UniProt entries by gene name.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name (e.g., "Homo sapiens")
            limit: Maximum number of results
            
        Returns:
            List of protein entries
        """
        query = f"gene:{gene}"
        
        if organism:
            query += f" AND organism_name:{organism}"
        
        return await self.search(query, limit=limit)
    
    async def search_by_disease(
        self, 
        disease: str, 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search UniProt entries associated with a disease.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            
        Returns:
            List of disease-associated proteins
        """
        query = f"cc_disease:{disease}"
        return await self.search(query, limit=limit)
    
    async def search_by_function(
        self, 
        function: str, 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search UniProt entries by protein function.
        
        Args:
            function: Function description or keyword
            limit: Maximum number of results
            
        Returns:
            List of proteins with specified function
        """
        query = f"cc_function:{function}"
        return await self.search(query, limit=limit)
    
    async def get_protein_interactions(
        self, 
        accession: str, 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get protein interaction data (if available).
        
        Args:
            accession: UniProt accession
            limit: Maximum number of interactions
            
        Returns:
            List of protein interactions
        """
        # This is a simplified implementation
        # In practice, you might want to integrate with STRING DB or other interaction databases
        
        # For now, we'll search for proteins that mention this protein in their function
        entry = await self.get_details(accession)
        primary_gene = entry.get("primary_gene", "")
        
        if primary_gene:
            query = f"cc_function:{primary_gene} AND NOT accession:{accession}"
            return await self.search(query, limit=limit)
        
        return [] 