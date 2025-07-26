"""Local retriever that downloads biological data files to user's computer."""

from typing import List, Dict, Any, Optional
from .query_processor import QueryProcessor, ProcessedQuery
from ..storage.local_store import LocalStore


class LocalRetriever:
    """Retriever that downloads and processes biological data files locally."""
    
    def __init__(
        self,
        local_store: LocalStore = None,
        query_processor: QueryProcessor = None,
        download_dir: str = "biorag_downloads",
        workspace_dir: str = None
    ):
        """Initialize local retriever.
        
        Args:
            local_store: Local storage backend for downloads
            query_processor: Query processing service
            download_dir: Directory for downloading files (deprecated)
            workspace_dir: User's workspace directory where downloads should go
        """
        if local_store:
            self.local_store = local_store
        elif workspace_dir:
            self.local_store = LocalStore(workspace_dir=workspace_dir)
        else:
            self.local_store = LocalStore(base_dir=download_dir)
        self.query_processor = query_processor or QueryProcessor()
        
    async def retrieve(
        self, 
        query: str,
        limit: int = 10,
        source_types: List[str] = None,
        max_items_per_source: int = 3,
        **kwargs
    ) -> Dict[str, Any]:
        """Retrieve relevant documents by downloading files locally.
        
        Args:
            query: Search query
            limit: Maximum number of results to return
            source_types: List of source types to search (GEO, PubMed, UniProt)
            max_items_per_source: Maximum items to download per source
            **kwargs: Additional search parameters
            
        Returns:
            Retrieval results with metadata
        """
        # Process the query to understand intent and extract entities
        processed_query = await self.query_processor.process_query(query)
        
        # Determine source types based on query if not specified
        if source_types is None:
            source_types = self._determine_source_types(processed_query)
        
        print(f"🔍 Searching and downloading from: {', '.join(source_types)}")
        
        # Download files from external sources
        documents = await self.local_store.fetch_and_download(
            query=processed_query.processed_query,
            source_types=source_types,
            max_items_per_source=max_items_per_source
        )
        
        print(f"📥 Downloaded and processed {len(documents)} documents")
        
        # Search for most relevant documents from downloaded files
        if documents:
            relevant_docs = await self.local_store.search_local(
                query_text=processed_query.processed_query,
                limit=limit
            )
        else:
            relevant_docs = []
        
        # Get download summary
        download_summary = self.local_store.get_download_summary()
        
        # Return structured results
        return {
            "query": query,
            "processed_query": processed_query.processed_query,
            "entities": processed_query.entities,
            "context_type": processed_query.context_type,
            "search_strategy": processed_query.search_strategy,
            "documents": relevant_docs,
            "document_count": len(relevant_docs),
            "total_downloaded": len(documents),
            "sources_used": source_types,
            "metadata": {
                "download_summary": download_summary,
                "max_items_per_source": max_items_per_source,
                "download_directory": str(self.local_store.download_manager.base_dir)
            }
        }
    
    def _determine_source_types(self, processed_query: ProcessedQuery) -> List[str]:
        """Determine which sources to search based on query characteristics.
        
        Args:
            processed_query: Processed query object
            
        Returns:
            List of source types to search
        """
        sources = []
        
        # Always include PubMed for literature
        sources.append("PubMed")
        
        # Add GEO for gene expression and dataset queries
        if (processed_query.entities["genes"] or 
            any(term in processed_query.processed_query.lower() for term in 
                ["expression", "dataset", "microarray", "rna-seq", "gene", "differential"])):
            sources.append("GEO")
        
        # Add UniProt for protein queries
        if (processed_query.entities["proteins"] or 
            any(term in processed_query.processed_query.lower() for term in 
                ["protein", "enzyme", "function", "structure", "uniprot"])):
            sources.append("UniProt")
        
        # If no specific sources determined, use all
        if len(sources) == 1:  # Only PubMed
            sources.extend(["GEO", "UniProt"])
        
        return sources
    
    async def search_by_gene(
        self,
        gene: str,
        organism: str = None,
        limit: int = 15
    ) -> List[Dict[str, Any]]:
        """Search for documents related to a specific gene and download files.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name (optional)
            limit: Maximum number of results
            
        Returns:
            List of relevant documents from downloaded files
        """
        # Construct gene-specific query
        if organism:
            query = f"{gene} gene {organism}"
        else:
            query = f"{gene} gene"
        
        # Focus on gene-relevant sources
        source_types = ["PubMed", "GEO", "UniProt"]
        
        result = await self.retrieve(
            query=query,
            limit=limit,
            source_types=source_types,
            max_items_per_source=5
        )
        
        return result["documents"]
    
    async def search_by_disease(
        self,
        disease: str,
        limit: int = 12
    ) -> List[Dict[str, Any]]:
        """Search for documents related to a specific disease and download files.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            
        Returns:
            List of relevant documents from downloaded files
        """
        query = f"{disease} disease pathology genetics"
        
        # Focus on literature and expression data
        source_types = ["PubMed", "GEO"]
        
        result = await self.retrieve(
            query=query,
            limit=limit,
            source_types=source_types,
            max_items_per_source=6
        )
        
        return result["documents"]
    
    async def search_by_pathway(
        self,
        pathway: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for documents related to a specific pathway and download files.
        
        Args:
            pathway: Pathway name
            limit: Maximum number of results
            
        Returns:
            List of relevant documents from downloaded files
        """
        query = f"{pathway} pathway genes proteins"
        
        # Use all sources for comprehensive pathway information
        source_types = ["PubMed", "GEO", "UniProt"]
        
        result = await self.retrieve(
            query=query,
            limit=limit,
            source_types=source_types,
            max_items_per_source=4
        )
        
        return result["documents"]
    
    def get_download_summary(self) -> Dict[str, Any]:
        """Get summary of downloaded files.
        
        Returns:
            Download summary with file counts and location
        """
        summary = self.local_store.get_download_summary()
        summary["retrieval_type"] = "local_file_download"
        return summary
    
    def clear_downloads(self, older_than_days: int = None):
        """Clear downloaded files.
        
        Args:
            older_than_days: Only clear files older than this many days
        """
        self.local_store.clear_downloads(older_than_days)
    
    def get_download_location(self) -> str:
        """Get the base directory where files are downloaded.
        
        Returns:
            Path to download directory
        """
        return str(self.local_store.download_manager.base_dir) 