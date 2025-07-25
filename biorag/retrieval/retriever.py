"""Biological retriever combining query processing and document retrieval."""

from typing import List, Dict, Any, Optional
from .query_processor import QueryProcessor, ProcessedQuery
from ..storage import DocumentStore


class BioRetriever:
    """Biological retriever with intelligent query processing and context-aware search."""
    
    def __init__(
        self,
        document_store: DocumentStore = None,
        query_processor: QueryProcessor = None
    ):
        """Initialize biological retriever.
        
        Args:
            document_store: Document storage backend
            query_processor: Query processing service
        """
        self.document_store = document_store or DocumentStore()
        self.query_processor = query_processor or QueryProcessor()
    
    async def retrieve(
        self, 
        query: str,
        limit: int = 10,
        retrieve_from_sources: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """Retrieve relevant documents for a query.
        
        Args:
            query: Search query
            limit: Maximum number of results
            retrieve_from_sources: Whether to search external sources
            **kwargs: Additional search parameters
            
        Returns:
            Retrieval results with metadata
        """
        # Process the query
        processed_query = await self.query_processor.process_query(query)
        
        # Get search parameters based on processed query
        search_params = self.query_processor.get_search_parameters(processed_query)
        search_params.update(kwargs)
        search_params["limit"] = limit
        
        # Determine retrieval method based on query characteristics
        if processed_query.search_strategy in ["gene_specific", "disease_specific", "protein_specific"]:
            documents = await self._retrieve_specific_entity(processed_query, search_params)
        elif processed_query.search_strategy == "multi_entity":
            documents = await self._retrieve_multi_entity(processed_query, search_params)
        else:
            documents = await self._retrieve_general(processed_query, search_params, retrieve_from_sources)
        
        # Prepare result
        result = {
            "query": query,
            "processed_query": processed_query.processed_query,
            "entities": processed_query.entities,
            "context_type": processed_query.context_type,
            "search_strategy": processed_query.search_strategy,
            "documents": documents,
            "document_count": len(documents)
        }
        
        return result
    
    async def _retrieve_specific_entity(
        self, 
        processed_query: ProcessedQuery, 
        search_params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Retrieve documents for specific entity queries."""
        strategy = processed_query.search_strategy
        entities = processed_query.entities
        
        if strategy == "gene_specific" and entities["genes"]:
            gene = entities["genes"][0]
            organism = entities["organisms"][0] if entities["organisms"] else None
            return await self.document_store.search_by_gene(
                gene, 
                organism=organism, 
                limit=search_params.get("limit", 15)
            )
        
        elif strategy == "disease_specific" and entities["diseases"]:
            disease = entities["diseases"][0]
            return await self.document_store.search_by_disease(
                disease, 
                limit=search_params.get("limit", 12)
            )
        
        elif strategy == "protein_specific" and entities["proteins"]:
            # Use general search but with protein context
            return await self.document_store.search(
                processed_query.processed_query,
                limit=search_params.get("limit", 10),
                filters=search_params.get("filters"),
                source_types=search_params.get("source_types", ["UniProt", "PubMed"]),
                context_type="protein"
            )
        
        # Fallback to general search
        return await self._retrieve_general(processed_query, search_params, True)
    
    async def _retrieve_multi_entity(
        self, 
        processed_query: ProcessedQuery, 
        search_params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Retrieve documents for multi-entity queries."""
        # Use search_and_retrieve for comprehensive results
        return await self.document_store.search_and_retrieve(
            processed_query.processed_query,
            retrieve_from_sources=True,
            max_new_docs=5,
            limit=search_params.get("limit", 20),
            filters=search_params.get("filters"),
            context_type=processed_query.context_type
        )
    
    async def _retrieve_general(
        self, 
        processed_query: ProcessedQuery, 
        search_params: Dict[str, Any],
        retrieve_from_sources: bool
    ) -> List[Dict[str, Any]]:
        """Retrieve documents for general queries."""
        if retrieve_from_sources:
            return await self.document_store.search_and_retrieve(
                processed_query.processed_query,
                retrieve_from_sources=True,
                max_new_docs=3,
                limit=search_params.get("limit", 10),
                filters=search_params.get("filters"),
                source_types=search_params.get("source_types"),
                context_type=processed_query.context_type
            )
        else:
            return await self.document_store.search(
                processed_query.processed_query,
                limit=search_params.get("limit", 10),
                filters=search_params.get("filters"),
                source_types=search_params.get("source_types"),
                context_type=processed_query.context_type
            )
    
    async def retrieve_by_gene(
        self, 
        gene: str,
        organism: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Retrieve documents for a specific gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name
            limit: Maximum number of results
            
        Returns:
            Gene-related documents
        """
        return await self.document_store.search_by_gene(gene, organism, limit)
    
    async def retrieve_by_disease(
        self, 
        disease: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Retrieve documents for a specific disease.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            
        Returns:
            Disease-related documents
        """
        return await self.document_store.search_by_disease(disease, limit)
    
    async def retrieve_similar(
        self, 
        document_id: str,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Retrieve documents similar to a given document.
        
        Args:
            document_id: ID of the reference document
            limit: Maximum number of results
            
        Returns:
            Similar documents
        """
        # Get the reference document
        ref_doc = await self.document_store.get_document(document_id)
        if not ref_doc:
            return []
        
        # Create query from document content
        query_parts = []
        for field in ["title", "description", "function"]:
            if field in ref_doc and ref_doc[field]:
                query_parts.append(ref_doc[field])
        
        if not query_parts:
            return []
        
        query = " ".join(query_parts)
        
        # Search for similar documents
        results = await self.document_store.search(
            query,
            limit=limit + 1,  # +1 to account for the reference document itself
            context_type=ref_doc.get("type")
        )
        
        # Filter out the reference document
        similar_docs = [doc for doc in results if doc.get("id") != document_id]
        return similar_docs[:limit]
    
    async def get_context_summary(
        self, 
        query: str,
        documents: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Get a summary of the context from retrieved documents.
        
        Args:
            query: Original query
            documents: Retrieved documents
            
        Returns:
            Context summary
        """
        if not documents:
            return {"summary": "No relevant documents found."}
        
        # Process query to understand context
        processed_query = await self.query_processor.process_query(query)
        
        # Analyze document sources
        sources = {}
        for doc in documents:
            source = doc.get("source", "Unknown")
            sources[source] = sources.get(source, 0) + 1
        
        # Extract key entities from documents
        entities = {
            "genes": set(),
            "diseases": set(),
            "organisms": set(),
            "types": set()
        }
        
        for doc in documents:
            if "gene_names" in doc and doc["gene_names"]:
                if isinstance(doc["gene_names"], list):
                    entities["genes"].update(doc["gene_names"])
                else:
                    entities["genes"].add(doc["gene_names"])
            
            if "organism" in doc and doc["organism"]:
                entities["organisms"].add(doc["organism"])
            
            if "type" in doc and doc["type"]:
                entities["types"].add(doc["type"])
            
            if "associated_diseases" in doc and doc["associated_diseases"]:
                if isinstance(doc["associated_diseases"], list):
                    entities["diseases"].update(doc["associated_diseases"])
                else:
                    entities["diseases"].add(doc["associated_diseases"])
        
        # Convert sets to lists
        for key in entities:
            entities[key] = list(entities[key])[:5]  # Limit to top 5
        
        summary = {
            "query_context": processed_query.context_type,
            "document_count": len(documents),
            "sources": sources,
            "entities": entities,
            "top_similarity_score": max([doc.get("similarity_score", 0) for doc in documents]) if documents else 0
        }
        
        return summary
    
    async def close(self):
        """Close connections."""
        await self.document_store.close() 