"""FastAPI application for BioRAG system."""

from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .schemas import *
from ..generation import RAGPipeline
from ..storage import DocumentStore
from ..retrieval import BioRetriever
from ..config import settings
from .. import __version__


# Global components
rag_pipeline: Optional[RAGPipeline] = None
document_store: Optional[DocumentStore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global rag_pipeline, document_store
    
    # Startup
    try:
        # Initialize components
        document_store = DocumentStore()
        retriever = BioRetriever(document_store=document_store)
        rag_pipeline = RAGPipeline(retriever=retriever)
        
        print("BioRAG system initialized successfully")
        yield
        
    except Exception as e:
        print(f"Failed to initialize BioRAG system: {e}")
        raise
    
    finally:
        # Shutdown
        if rag_pipeline:
            await rag_pipeline.close()
        if document_store:
            await document_store.close()
        print("BioRAG system shutdown complete")


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""
    
    app = FastAPI(
        title="BioRAG API",
        description="Biological Retrieval-Augmented Generation System",
        version=__version__,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Dependency to get RAG pipeline
    def get_rag_pipeline() -> RAGPipeline:
        if rag_pipeline is None:
            raise HTTPException(status_code=503, detail="RAG pipeline not initialized")
        return rag_pipeline
    
    # Dependency to get document store
    def get_document_store() -> DocumentStore:
        if document_store is None:
            raise HTTPException(status_code=503, detail="Document store not initialized")
        return document_store
    
    @app.get("/", response_model=Dict[str, str])
    async def root():
        """Root endpoint."""
        return {
            "name": "BioRAG API",
            "version": __version__,
            "description": "Biological Retrieval-Augmented Generation System"
        }
    
    @app.get("/health", response_model=HealthResponse)
    async def health_check():
        """Health check endpoint."""
        components = {}
        
        # Check components
        if rag_pipeline:
            components["rag_pipeline"] = "healthy"
        else:
            components["rag_pipeline"] = "unhealthy"
        
        if document_store:
            components["document_store"] = "healthy"
        else:
            components["document_store"] = "unhealthy"
        
        status = "healthy" if all(v == "healthy" for v in components.values()) else "unhealthy"
        
        return HealthResponse(
            status=status,
            version=__version__,
            timestamp=datetime.utcnow(),
            components=components
        )
    
    @app.post("/query", response_model=QueryResponse)
    async def query_rag(
        request: QueryRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Process a biological query through the RAG pipeline."""
        try:
            result = await pipeline.query(
                question=request.question,
                max_documents=request.max_documents,
                retrieve_from_sources=request.retrieve_from_sources,
                response_type=request.response_type,
                system_prompt=request.system_prompt
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/search/gene", response_model=QueryResponse)
    async def search_gene(
        request: GeneSearchRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Search for information about a specific gene."""
        try:
            result = await pipeline.search_by_gene(
                gene=request.gene,
                organism=request.organism,
                question=request.question,
                response_type=request.response_type
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/search/disease", response_model=QueryResponse)
    async def search_disease(
        request: DiseaseSearchRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Search for information about a specific disease."""
        try:
            result = await pipeline.search_by_disease(
                disease=request.disease,
                question=request.question,
                response_type=request.response_type
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/compare", response_model=QueryResponse)
    async def compare_entities(
        request: ComparisonRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Compare multiple biological entities."""
        try:
            result = await pipeline.compare_entities(
                entities=request.entities,
                entity_type=request.entity_type,
                comparison_aspect=request.comparison_aspect
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/explore/pathway", response_model=QueryResponse)
    async def explore_pathway(
        request: PathwayRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Explore a biological pathway."""
        try:
            result = await pipeline.explore_pathway(
                pathway=request.pathway,
                focus=request.focus
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/research/recommendations", response_model=QueryResponse)
    async def get_research_recommendations(
        request: ResearchRecommendationRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Get research recommendations for a biological area."""
        try:
            result = await pipeline.get_research_recommendations(
                research_area=request.research_area,
                current_knowledge=request.current_knowledge
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/research/experimental-design", response_model=QueryResponse)
    async def get_experimental_design_suggestions(
        request: ExperimentalDesignRequest,
        pipeline: RAGPipeline = Depends(get_rag_pipeline)
    ):
        """Get experimental design suggestions for a research question."""
        try:
            result = await pipeline.get_experimental_design_suggestions(
                research_question=request.research_question,
                organism=request.organism
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/documents/search", response_model=SearchResponse)
    async def search_documents(
        request: DocumentSearchRequest,
        store: DocumentStore = Depends(get_document_store)
    ):
        """Search documents in the knowledge base."""
        try:
            documents = await store.search(
                query=request.query,
                limit=request.limit,
                filters=request.filters,
                source_types=request.source_types
            )
            
            # Convert to response format
            doc_responses = []
            for doc in documents:
                doc_response = DocumentResponse(
                    id=doc.get("id", ""),
                    title=doc.get("title"),
                    description=doc.get("description"),
                    source=doc.get("source"),
                    type=doc.get("type"),
                    organism=doc.get("organism"),
                    gene_names=doc.get("gene_names"),
                    keywords=doc.get("keywords", doc.get("mesh_terms")),
                    publication_date=doc.get("publication_date"),
                    similarity_score=doc.get("similarity_score"),
                    metadata={k: v for k, v in doc.items() if k not in [
                        "id", "title", "description", "source", "type", "organism",
                        "gene_names", "keywords", "mesh_terms", "publication_date", "similarity_score"
                    ]}
                )
                doc_responses.append(doc_response)
            
            return SearchResponse(
                query=request.query,
                documents=doc_responses,
                document_count=len(doc_responses),
                metadata={"filters": request.filters, "source_types": request.source_types}
            )
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/documents/{document_id}", response_model=DocumentResponse)
    async def get_document(
        document_id: str,
        store: DocumentStore = Depends(get_document_store)
    ):
        """Get a specific document by ID."""
        try:
            doc = await store.get_document(document_id)
            
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            return DocumentResponse(
                id=doc.get("id", ""),
                title=doc.get("title"),
                description=doc.get("description"),
                source=doc.get("source"),
                type=doc.get("type"),
                organism=doc.get("organism"),
                gene_names=doc.get("gene_names"),
                keywords=doc.get("keywords", doc.get("mesh_terms")),
                publication_date=doc.get("publication_date"),
                similarity_score=doc.get("similarity_score"),
                metadata={k: v for k, v in doc.items() if k not in [
                    "id", "title", "description", "source", "type", "organism",
                    "gene_names", "keywords", "mesh_terms", "publication_date", "similarity_score"
                ]}
            )
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/stats", response_model=StatsResponse)
    async def get_stats(store: DocumentStore = Depends(get_document_store)):
        """Get system statistics."""
        try:
            stats = await store.get_stats()
            
            # Count documents by source (simplified)
            # In a real implementation, you might want to query the vector store for this
            sources = {}
            
            return StatsResponse(
                document_count=stats.get("document_count", 0),
                collection_name=stats.get("name", ""),
                persist_directory=stats.get("persist_directory", ""),
                embedding_model=settings.embedding_model,
                sources=sources
            )
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.exception_handler(Exception)
    async def global_exception_handler(request, exc):
        """Global exception handler."""
        return ErrorResponse(
            error=str(exc),
            detail="An unexpected error occurred",
            timestamp=datetime.utcnow()
        )
    
    return app 