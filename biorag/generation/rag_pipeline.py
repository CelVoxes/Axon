"""Main RAG pipeline combining retrieval and generation."""

from typing import Dict, List, Any, Optional, Union
from datetime import datetime

from .llm_client import LLMClient
from ..retrieval import LocalRetriever


class RAGPipeline:
    """Main RAG pipeline for biological question answering."""
    
    def __init__(
        self,
        retriever: Union[LocalRetriever, Any] = None,
        llm_client: LLMClient = None,
        workspace_dir: str = None
    ):
        """Initialize RAG pipeline.
        
        Args:
            retriever: Document retriever (LocalRetriever)
            llm_client: Language model client
            workspace_dir: User's workspace directory for downloads
        """
        self.workspace_dir = workspace_dir
        self.retriever = retriever or LocalRetriever(workspace_dir=workspace_dir)
        self.llm_client = llm_client or LLMClient()
    
    async def query(
        self,
        question: str,
        max_documents: int = 10,
        retrieve_from_sources: bool = True,
        response_type: str = "answer",
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Process a biological query through the RAG pipeline.
        
        Args:
            question: User question
            max_documents: Maximum documents to retrieve
            retrieve_from_sources: Whether to search external sources
            response_type: Type of response (answer, summary, insights)
            **kwargs: Additional parameters
            
        Returns:
            Complete RAG response
        """
        start_time = datetime.utcnow()
        
        # Step 1: Retrieve relevant documents
        retrieval_result = await self.retriever.retrieve(
            question,
            limit=max_documents,
            retrieve_from_sources=retrieve_from_sources,
            **kwargs
        )
        
        documents = retrieval_result["documents"]
        retrieval_time = datetime.utcnow()
        
        # Step 2: Generate response based on retrieved documents
        if response_type == "summary":
            response = await self._generate_summary(documents, kwargs.get("focus_area"), model)
        elif response_type == "insights":
            response = await self._generate_insights(question, documents, model)
        else:  # Default to answer
            response = await self._generate_answer(question, documents, system_prompt, model)
        
        generation_time = datetime.utcnow()
        
        # Step 3: Compile complete response
        complete_response = {
            "question": question,
            "answer": response.get("answer", response.get("insights", response)),
            "response_type": response_type,
            "retrieval": {
                "query": retrieval_result["query"],
                "processed_query": retrieval_result["processed_query"],
                "entities": retrieval_result["entities"],
                "context_type": retrieval_result["context_type"],
                "search_strategy": retrieval_result["search_strategy"],
                "documents_found": retrieval_result["document_count"],
                "documents": documents
            },
            "generation": {
                "model": response.get("model"),
                "usage": response.get("usage", {}),
                "context_used": response.get("context_used", len(documents))
            },
            "timing": {
                "retrieval_time_ms": int((retrieval_time - start_time).total_seconds() * 1000),
                "generation_time_ms": int((generation_time - retrieval_time).total_seconds() * 1000),
                "total_time_ms": int((generation_time - start_time).total_seconds() * 1000)
            },
            "metadata": {
                "timestamp": start_time.isoformat(),
                "retrieve_from_sources": retrieve_from_sources,
                "max_documents": max_documents
            }
        }
        
        # Add error information if present
        if "error" in response:
            complete_response["error"] = response["error"]
        
        return complete_response
    
    async def _generate_answer(
        self,
        question: str,
        documents: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate an answer to the question."""
        return await self.llm_client.generate_response(
            query=question,
            context_documents=documents,
            system_prompt=system_prompt,
            model=model
        )
    
    async def _generate_summary(
        self,
        documents: List[Dict[str, Any]],
        focus_area: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate a summary of documents."""
        summary = await self.llm_client.generate_summary(
            documents=documents,
            focus_area=focus_area,
            model=model
        )
        
        return {
            "answer": summary,
            "context_used": len(documents),
            "model": self.llm_client.model
        }
    
    async def _generate_insights(
        self,
        question: str,
        documents: List[Dict[str, Any]],
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate research insights."""
        return await self.llm_client.generate_research_insights(
            query=question,
            documents=documents,
            model=model
        )
    
    async def search_by_gene(
        self,
        gene: str,
        organism: Optional[str] = None,
        question: Optional[str] = None,
        response_type: str = "answer"
    ) -> Dict[str, Any]:
        """Search for information about a specific gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name
            question: Specific question about the gene
            response_type: Type of response to generate
            
        Returns:
            Gene-specific RAG response
        """
        # Build query
        if question:
            query = f"{question} {gene}"
        else:
            query = f"What is known about {gene} gene?"
        
        if organism:
            query += f" in {organism}"
        
        return await self.query(
            question=query,
            response_type=response_type,
            max_documents=15
        )
    
    async def search_by_disease(
        self,
        disease: str,
        question: Optional[str] = None,
        response_type: str = "answer"
    ) -> Dict[str, Any]:
        """Search for information about a specific disease.
        
        Args:
            disease: Disease name
            question: Specific question about the disease
            response_type: Type of response to generate
            
        Returns:
            Disease-specific RAG response
        """
        # Build query
        if question:
            query = f"{question} {disease}"
        else:
            query = f"What is known about {disease}?"
        
        return await self.query(
            question=query,
            response_type=response_type,
            max_documents=12
        )
    
    async def compare_entities(
        self,
        entities: List[str],
        entity_type: str = "gene",
        comparison_aspect: str = "function"
    ) -> Dict[str, Any]:
        """Compare multiple biological entities.
        
        Args:
            entities: List of entities to compare
            entity_type: Type of entities (gene, protein, disease)
            comparison_aspect: Aspect to compare (function, structure, etc.)
            
        Returns:
            Comparison RAG response
        """
        entities_str = ", ".join(entities)
        query = f"Compare the {comparison_aspect} of {entity_type}s: {entities_str}"
        
        return await self.query(
            question=query,
            response_type="insights",
            max_documents=20,
            retrieve_from_sources=True
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
        focus_queries = {
            "overview": f"Provide an overview of the {pathway} pathway",
            "genes": f"What genes are involved in the {pathway} pathway?",
            "diseases": f"What diseases are associated with the {pathway} pathway?",
            "drugs": f"What drugs target the {pathway} pathway?"
        }
        
        query = focus_queries.get(focus, f"Tell me about the {pathway} pathway")
        
        return await self.query(
            question=query,
            response_type="answer",
            max_documents=15,
            retrieve_from_sources=True
        )
    
    async def get_research_recommendations(
        self,
        research_area: str,
        current_knowledge: str = None
    ) -> Dict[str, Any]:
        """Get research recommendations for a biological area.
        
        Args:
            research_area: Area of research interest
            current_knowledge: Current state of knowledge
            
        Returns:
            Research recommendations
        """
        if current_knowledge:
            query = f"Given that we know {current_knowledge}, what are the key research questions and approaches for studying {research_area}?"
        else:
            query = f"What are the current research questions and approaches in {research_area}?"
        
        return await self.query(
            question=query,
            response_type="insights",
            max_documents=20,
            retrieve_from_sources=True
        )
    
    async def get_experimental_design_suggestions(
        self,
        research_question: str,
        organism: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get experimental design suggestions for a research question.
        
        Args:
            research_question: The research question
            organism: Target organism
            
        Returns:
            Experimental design suggestions
        """
        query = f"What experimental approaches would be suitable for investigating: {research_question}"
        
        if organism:
            query += f" in {organism}"
        
        return await self.query(
            question=query,
            response_type="insights",
            max_documents=15,
            retrieve_from_sources=True,
            system_prompt="""You are an experimental design consultant for biological research. 
            Focus on providing practical, feasible experimental approaches including:
            1. Appropriate methodologies and techniques
            2. Controls and validation approaches
            3. Sample size considerations
            4. Potential limitations and confounding factors
            5. Alternative approaches if the primary method fails"""
        )
    
    async def close(self):
        """Close connections."""
        await self.retriever.close() 