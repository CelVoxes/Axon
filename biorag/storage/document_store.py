"""Document store manager for biological data."""

import asyncio
from typing import List, Dict, Any, Optional, Union
from datetime import datetime

from .chroma_store import ChromaStore
from ..embeddings import BioEmbeddingService
from ..data_sources import GEOClient, PubMedClient, UniProtClient


class DocumentStore:
    """High-level document store manager for biological data."""
    
    def __init__(
        self,
        vector_store: ChromaStore = None,
        embedding_service: BioEmbeddingService = None
    ):
        """Initialize document store.
        
        Args:
            vector_store: Vector storage backend
            embedding_service: Embedding service
        """
        self.vector_store = vector_store or ChromaStore()
        self.embedding_service = embedding_service or BioEmbeddingService()
        
        # Data source clients
        self.geo_client = GEOClient()
        self.pubmed_client = PubMedClient()
        self.uniprot_client = UniProtClient()
    
    async def add_documents(
        self, 
        documents: List[Dict[str, Any]],
        compute_embeddings: bool = True
    ) -> List[str]:
        """Add documents to the store.
        
        Args:
            documents: Documents to add
            compute_embeddings: Whether to compute embeddings
            
        Returns:
            List of document IDs
        """
        if not documents:
            return []
        
        # Add timestamps
        current_time = datetime.utcnow().isoformat()
        for doc in documents:
            doc["indexed_at"] = current_time
        
        # Compute embeddings if requested
        if compute_embeddings:
            documents = await self.embedding_service.encode_biological_documents(documents)
        
        # Store in vector database
        return await self.vector_store.add_documents(documents)
    
    async def search(
        self, 
        query: str,
        limit: int = 10,
        filters: Optional[Dict[str, Any]] = None,
        source_types: Optional[List[str]] = None,
        context_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search documents with biological context.
        
        Args:
            query: Search query
            limit: Maximum number of results
            filters: Metadata filters
            source_types: Filter by source types (e.g., ["GEO", "PubMed"])
            context_type: Biological context type (gene, disease, protein, etc.)
            
        Returns:
            List of relevant documents
        """
        # Build metadata filters
        where_filter = filters or {}
        
        if source_types:
            where_filter["source"] = {"$in": source_types}
        
        # Use biological embedding service for context-aware search
        query_embedding = await self.embedding_service.encode(
            self.embedding_service.preprocess_biological_text(query)
        )
        
        # Search vector store
        results = await self.vector_store.search(
            query_embedding=query_embedding[0],
            limit=limit,
            where=where_filter if where_filter else None
        )
        
        return results
    
    async def search_and_retrieve(
        self, 
        query: str,
        retrieve_from_sources: bool = True,
        max_new_docs: int = 5,
        **search_kwargs
    ) -> List[Dict[str, Any]]:
        """Search existing documents and optionally retrieve new ones.
        
        Args:
            query: Search query
            retrieve_from_sources: Whether to retrieve new documents from sources
            max_new_docs: Maximum new documents to retrieve per source
            **search_kwargs: Additional search arguments
            
        Returns:
            Combined search results
        """
        # Search existing documents
        existing_docs = await self.search(query, **search_kwargs)
        
        if not retrieve_from_sources:
            return existing_docs
        
        # Retrieve new documents from sources
        new_docs = []
        
        # Search sources sequentially to avoid rate limiting
        try:
            geo_results = await self._search_geo(query, max_new_docs)
            new_docs.extend(geo_results)
        except Exception as e:
            print(f"GEO search failed: {e}")
        
        try:
            pubmed_results = await self._search_pubmed(query, max_new_docs)
            new_docs.extend(pubmed_results)
        except Exception as e:
            print(f"PubMed search failed: {e}")
        
        try:
            uniprot_results = await self._search_uniprot(query, max_new_docs)
            new_docs.extend(uniprot_results)
        except Exception as e:
            print(f"UniProt search failed: {e}")
        
        # Store new documents and get their combined results
        if new_docs:
            await self.add_documents(new_docs)
        
        # Combine and re-rank all documents
        all_docs = existing_docs + new_docs
        
        # Re-rank using biological context if we have new documents
        if new_docs and all_docs:
            all_docs = await self.embedding_service.search_biological_context(
                query, 
                all_docs, 
                top_k=search_kwargs.get("limit", 10)
            )
        
        return all_docs
    
    async def _search_geo(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Search GEO datasets."""
        try:
            # Extract meaningful search terms for GEO
            geo_query = self._extract_geo_terms(query)
            if not geo_query:
                return []
            
            # Add delay to avoid rate limiting
            await asyncio.sleep(0.5)
            
            return await self.geo_client.search(geo_query, limit=limit)
        except Exception as e:
            print(f"Error searching GEO: {e}")
            return []
    
    async def _search_pubmed(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Search PubMed articles."""
        try:
            # Extract meaningful search terms for PubMed
            pubmed_query = self._extract_pubmed_terms(query)
            if not pubmed_query:
                return []
            
            # Add delay to avoid rate limiting
            await asyncio.sleep(0.5)
            
            return await self.pubmed_client.search(pubmed_query, limit=limit)
        except Exception as e:
            print(f"Error searching PubMed: {e}")
            return []
    
    async def _search_uniprot(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Search UniProt proteins."""
        try:
            # Extract meaningful search terms for UniProt
            uniprot_query = self._extract_uniprot_terms(query)
            if not uniprot_query:
                return []
            
            # Add delay to avoid rate limiting
            await asyncio.sleep(0.5)
            
            return await self.uniprot_client.search(uniprot_query, limit=limit)
        except Exception as e:
            print(f"Error searching UniProt: {e}")
            return []
    
    def _extract_uniprot_terms(self, query: str) -> str:
        """Extract UniProt-appropriate search terms from a natural language query."""
        import re
        
        # Convert to lowercase for processing
        query_lower = query.lower()
        
        # Extract meaningful terms for UniProt protein search
        search_terms = []
        
        # Disease names for protein searches
        disease_patterns = [
            r"\b(aml|acute myeloid leukemia)\b",
            r"\b(all|acute lymphoblastic leukemia)\b",
            r"\b(b-all|b-cell all)\b",
            r"\b(alzheimer'?s?)\b",
            r"\b(parkinson'?s?)\b",
            r"\b(diabetes)\b",
            r"\b(cancer)\b",
            r"\b(carcinoma)\b",
            r"\b(lymphoma)\b",
            r"\b(leukemia)\b"
        ]
        
        for pattern in disease_patterns:
            matches = re.findall(pattern, query_lower)
            search_terms.extend(matches)
        
        # Gene symbols and protein names
        gene_patterns = [
            r"\b([A-Z][A-Z0-9]{2,})\b",  # Gene symbols like TP53, BRCA1
            r"\bprotein[s]?\s+([a-z0-9]+)\b",
            r"\bgene[s]?\s+([a-z0-9]+)\b"
        ]
        
        for pattern in gene_patterns:
            matches = re.findall(pattern, query)
            search_terms.extend(matches)
        
        # Protein function terms
        function_terms = ["kinase", "phosphatase", "transcription", "enzyme", "receptor", "antibody"]
        for term in function_terms:
            if term in query_lower:
                search_terms.append(term)
        
        # Remove duplicates and empty strings
        search_terms = list(set([term for term in search_terms if term.strip()]))
        
        # Create appropriate UniProt query
        if search_terms:
            # Use the first few most relevant terms
            return " ".join(search_terms[:3])
        else:
            return "protein"

    def _extract_geo_terms(self, query: str) -> str:
        """Extract GEO-appropriate search terms from a natural language query."""
        import re
        
        # Convert to lowercase for processing
        query_lower = query.lower()
        
        # Extract biological terms
        bio_terms = []
        
        # Cancer/disease terms
        cancer_patterns = [
            r"\b(aml|acute myeloid leukemia)\b",
            r"\b(all|acute lymphoblastic leukemia)\b", 
            r"\b(b-all|b-cell all)\b",
            r"\b(cml|chronic myeloid leukemia)\b",
            r"\b(cll|chronic lymphoblastic leukemia)\b",
            r"\b([a-z]+\s+cancer)\b",
            r"\b([a-z]+\s+carcinoma)\b",
            r"\b([a-z]+\s+tumor)\b",
            r"\b([a-z]+\s+lymphoma)\b",
            r"\b([a-z]+\s+leukemia)\b"
        ]
        
        for pattern in cancer_patterns:
            matches = re.findall(pattern, query_lower)
            bio_terms.extend(matches)
        
        # Gene/protein terms
        gene_patterns = [
            r"\bgene[s]?\s+([a-z0-9]+)\b",
            r"\bprotein[s]?\s+([a-z0-9]+)\b",
            r"\b([A-Z][A-Z0-9]{2,})\b"  # Gene symbols from original query
        ]
        
        for pattern in gene_patterns:
            matches = re.findall(pattern, query)
            bio_terms.extend(matches)
        
        # Transcriptional/expression terms
        expression_terms = ["gene expression", "transcription", "rna-seq", "microarray", "expression profiling"]
        for term in expression_terms:
            if term in query_lower:
                bio_terms.append(term.replace(" ", "+"))
        
        # Subtype/classification terms
        if "subtype" in query_lower or "classification" in query_lower:
            bio_terms.append("subtype")
        
        # Remove duplicates and join
        bio_terms = list(set(bio_terms))
        
        # Limit length and return top terms
        return " ".join(bio_terms[:5]) if bio_terms else "gene expression"

    def _extract_pubmed_terms(self, query: str) -> str:
        """Extract PubMed-appropriate search terms from a natural language query."""
        import re
        
        query_lower = query.lower()
        
        # Extract key biological terms
        terms = []
        
        # Disease terms
        disease_patterns = [
            r"\b(aml|acute myeloid leukemia)\b",
            r"\b(all|acute lymphoblastic leukemia)\b",
            r"\b(b-all|b-cell all)\b",
            r"\b([a-z]+\s+cancer)\b",
            r"\b([a-z]+\s+carcinoma)\b",
            r"\b([a-z]+\s+lymphoma)\b"
        ]
        
        for pattern in disease_patterns:
            matches = re.findall(pattern, query_lower)
            terms.extend(matches)
        
        # Research terms
        research_terms = ["transcriptional", "subtype", "expression", "biomarker", "pathway"]
        for term in research_terms:
            if term in query_lower:
                terms.append(term)
        
        # Remove duplicates
        terms = list(set(terms))
        
        # Create PubMed query
        if terms:
            return " AND ".join(f'"{term}"' for term in terms[:3])
        else:
            return "gene expression"
    
    async def search_by_gene(
        self, 
        gene: str,
        organism: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for information about a specific gene.
        
        Args:
            gene: Gene name or symbol
            organism: Organism name
            limit: Maximum number of results
            
        Returns:
            Gene-related documents
        """
        # Search existing documents
        query = f"gene {gene}"
        if organism:
            query += f" {organism}"
        
        existing_docs = await self.search(
            query, 
            limit=limit,
            context_type="gene"
        )
        
        # Search sources for additional data
        search_tasks = [
            self.geo_client.search(f"{gene} expression", limit=3),
            self.pubmed_client.search_by_gene(gene, limit=3, organism=organism),
            self.uniprot_client.search_by_gene(gene, organism, limit=3)
        ]
        
        source_results = await asyncio.gather(*search_tasks, return_exceptions=True)
        
        new_docs = []
        for result in source_results:
            if isinstance(result, list):
                new_docs.extend(result)
        
        # Add new documents and combine results
        if new_docs:
            await self.add_documents(new_docs)
            all_docs = existing_docs + new_docs
            # Re-rank with biological context
            return await self.embedding_service.search_biological_context(
                query, all_docs, context_type="gene", top_k=limit
            )
        
        return existing_docs
    
    async def search_by_disease(
        self, 
        disease: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search for information about a specific disease.
        
        Args:
            disease: Disease name
            limit: Maximum number of results
            
        Returns:
            Disease-related documents
        """
        query = f"disease {disease}"
        
        existing_docs = await self.search(
            query, 
            limit=limit,
            context_type="disease"
        )
        
        # Search sources
        search_tasks = [
            self.geo_client.search(f"{disease} study", limit=3),
            self.pubmed_client.search_by_disease(disease, limit=3),
            self.uniprot_client.search_by_disease(disease, limit=3)
        ]
        
        source_results = await asyncio.gather(*search_tasks, return_exceptions=True)
        
        new_docs = []
        for result in source_results:
            if isinstance(result, list):
                new_docs.extend(result)
        
        if new_docs:
            await self.add_documents(new_docs)
            all_docs = existing_docs + new_docs
            return await self.embedding_service.search_biological_context(
                query, all_docs, context_type="disease", top_k=limit
            )
        
        return existing_docs
    
    async def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            Document if found
        """
        return await self.vector_store.get_document(doc_id)
    
    async def update_document(
        self, 
        doc_id: str, 
        document: Dict[str, Any]
    ) -> bool:
        """Update an existing document.
        
        Args:
            doc_id: Document ID
            document: Updated document data
            
        Returns:
            True if successful
        """
        # Recompute embedding if content changed
        embedding = None
        if any(field in document for field in ["title", "description", "abstract", "function"]):
            docs_with_embeddings = await self.embedding_service.encode_biological_documents([document])
            if docs_with_embeddings:
                embedding = docs_with_embeddings[0]["embedding"]
        
        return await self.vector_store.update_document(doc_id, document, embedding)
    
    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document.
        
        Args:
            doc_id: Document ID
            
        Returns:
            True if successful
        """
        return await self.vector_store.delete_document(doc_id)
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get store statistics.
        
        Returns:
            Statistics dictionary
        """
        return await self.vector_store.get_collection_stats()
    
    async def close(self):
        """Close connections to data sources."""
        await self.geo_client.close()
        await self.pubmed_client.close()
        await self.uniprot_client.close() 