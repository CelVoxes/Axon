"""Main client interface for the BioRAG system."""

from typing import Dict, List, Any, Optional
import asyncio

from .generation import RAGPipeline
from .storage import DocumentStore
from .retrieval import BioRetriever


class BioRAGClient:
    """Main client interface for the BioRAG system."""
    
    def __init__(
        self,
        document_store: DocumentStore = None,
        retriever: BioRetriever = None,
        rag_pipeline: RAGPipeline = None
    ):
        """Initialize BioRAG client.
        
        Args:
            document_store: Document storage backend
            retriever: Document retriever
            rag_pipeline: RAG pipeline
        """
        self.document_store = document_store or DocumentStore()
        self.retriever = retriever or BioRetriever(document_store=self.document_store)
        self.rag_pipeline = rag_pipeline or RAGPipeline(retriever=self.retriever)
    
    async def query(
        self,
        question: str,
        max_documents: int = 10,
        response_type: str = "answer",
        **kwargs
    ) -> Dict[str, Any]:
        """Ask a biological question.
        
        Args:
            question: The biological question
            max_documents: Maximum documents to retrieve
            response_type: Type of response (answer, summary, insights)
            **kwargs: Additional parameters
            
        Returns:
            Complete response with answer and context
        """
        return await self.rag_pipeline.query(
            question=question,
            max_documents=max_documents,
            response_type=response_type,
            **kwargs
        )
    
    def query_sync(
        self,
        question: str,
        max_documents: int = 10,
        response_type: str = "answer",
        **kwargs
    ) -> Dict[str, Any]:
        """Synchronous version of query method.
        
        Args:
            question: The biological question
            max_documents: Maximum documents to retrieve
            response_type: Type of response (answer, summary, insights)
            **kwargs: Additional parameters
            
        Returns:
            Complete response with answer and context
        """
        return asyncio.run(self.query(question, max_documents, response_type, **kwargs))
    
    async def search_gene(
        self,
        gene: str,
        organism: Optional[str] = None,
        question: Optional[str] = None
    ) -> Dict[str, Any]:
        """Search for information about a gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name
            question: Specific question about the gene
            
        Returns:
            Gene information response
        """
        return await self.rag_pipeline.search_by_gene(
            gene=gene,
            organism=organism,
            question=question
        )
    
    async def search_disease(
        self,
        disease: str,
        question: Optional[str] = None
    ) -> Dict[str, Any]:
        """Search for information about a disease.
        
        Args:
            disease: Disease name
            question: Specific question about the disease
            
        Returns:
            Disease information response
        """
        return await self.rag_pipeline.search_by_disease(
            disease=disease,
            question=question
        )
    
    async def compare_genes(
        self,
        genes: List[str],
        aspect: str = "function"
    ) -> Dict[str, Any]:
        """Compare multiple genes.
        
        Args:
            genes: List of gene names
            aspect: Aspect to compare (function, expression, etc.)
            
        Returns:
            Gene comparison response
        """
        return await self.rag_pipeline.compare_entities(
            entities=genes,
            entity_type="gene",
            comparison_aspect=aspect
        )
    
    async def explore_pathway(
        self,
        pathway: str,
        focus: str = "overview"
    ) -> Dict[str, Any]:
        """Explore a biological pathway.
        
        Args:
            pathway: Pathway name
            focus: Focus area (overview, genes, diseases, drugs)
            
        Returns:
            Pathway exploration response
        """
        return await self.rag_pipeline.explore_pathway(
            pathway=pathway,
            focus=focus
        )
    
    async def get_research_insights(
        self,
        research_area: str,
        current_knowledge: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get research insights for a biological area.
        
        Args:
            research_area: Area of research
            current_knowledge: Current state of knowledge
            
        Returns:
            Research insights response
        """
        return await self.rag_pipeline.get_research_recommendations(
            research_area=research_area,
            current_knowledge=current_knowledge
        )
    
    async def design_experiment(
        self,
        research_question: str,
        organism: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get experimental design suggestions.
        
        Args:
            research_question: The research question
            organism: Target organism
            
        Returns:
            Experimental design suggestions
        """
        return await self.rag_pipeline.get_experimental_design_suggestions(
            research_question=research_question,
            organism=organism
        )
    
    async def search_documents(
        self,
        query: str,
        limit: int = 10,
        source_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Search documents in the knowledge base.
        
        Args:
            query: Search query
            limit: Maximum number of results
            source_types: Filter by source types
            
        Returns:
            List of matching documents
        """
        return await self.document_store.search(
            query=query,
            limit=limit,
            source_types=source_types
        )
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]]
    ) -> List[str]:
        """Add documents to the knowledge base.
        
        Args:
            documents: List of documents to add
            
        Returns:
            List of document IDs
        """
        return await self.document_store.add_documents(documents)
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get system statistics.
        
        Returns:
            System statistics
        """
        return await self.document_store.get_stats()
    
    async def close(self):
        """Close connections."""
        await self.rag_pipeline.close()
    
    def __enter__(self):
        """Context manager entry (sync)."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit (sync)."""
        asyncio.run(self.close())
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close() 