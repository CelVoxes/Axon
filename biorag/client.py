"""Client interface for BioRAG system."""

from typing import Dict, List, Any, Optional

from .generation import RAGPipeline
from .retrieval import LocalRetriever


class BioRAGClient:
    """Client interface for biological RAG operations."""
    
    def __init__(
        self,
        retriever: LocalRetriever = None,
        download_dir: str = "biorag_downloads"
    ):
        """Initialize BioRAG client.
        
        Args:
            retriever: Document retriever
            download_dir: Directory for downloading files
        """
        self.retriever = retriever or LocalRetriever(download_dir=download_dir)
        self.pipeline = RAGPipeline(retriever=self.retriever)
    
    async def query(
        self, 
        question: str, 
        max_documents: int = 10,
        response_type: str = "answer"
    ) -> Dict[str, Any]:
        """Ask a biological question.
        
        Args:
            question: The biological question
            max_documents: Maximum documents to retrieve
            response_type: Type of response (answer, summary, insights)
            
        Returns:
            Query response with answer and sources
        """
        return await self.pipeline.query(
            question=question,
            max_documents=max_documents,
            response_type=response_type
        )
    
    async def search_gene(
        self, 
        gene: str, 
        organism: str = None,
        question: str = None
    ) -> Dict[str, Any]:
        """Search for information about a gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name (optional)
            question: Specific question about the gene
            
        Returns:
            Gene search results
        """
        if question is None:
            question = f"What is {gene}?"
        
        return await self.pipeline.search_by_gene(
            gene=gene,
            organism=organism,
            question=question
        )
    
    async def search_disease(
        self, 
        disease: str,
        question: str = None
    ) -> Dict[str, Any]:
        """Search for information about a disease.
        
        Args:
            disease: Disease name
            question: Specific question about the disease
            
        Returns:
            Disease search results
        """
        if question is None:
            question = f"What causes {disease}?"
        
        return await self.pipeline.search_by_disease(
            disease=disease,
            question=question
        )
    
    def get_download_summary(self) -> Dict[str, Any]:
        """Get summary of downloaded files.
        
        Returns:
            Download summary
        """
        return self.retriever.get_download_summary()
    
    def clear_downloads(self, older_than_days: int = None):
        """Clear downloaded files.
        
        Args:
            older_than_days: Only clear files older than this many days
        """
        self.retriever.clear_downloads(older_than_days) 