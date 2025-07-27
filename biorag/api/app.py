"""BioRAG FastAPI Application."""

import os
import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from .schemas import QueryRequest, QueryResponse
from ..generation.rag_pipeline import RAGPipeline
from ..config import settings

# Import dataset endpoints
from .dataset_endpoints import router as dataset_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for the FastAPI app."""
    # Startup
    print("🚀 Starting BioRAG API server...")
    yield
    # Shutdown
    print("🛑 Shutting down BioRAG API server...")

def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="BioRAG API",
        description="AI-powered biomedical research assistant with retrieval-augmented generation",
        version=__version__,
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
    
    # Initialize RAG pipeline
    rag_pipeline = RAGPipeline()
    
    # Include dataset management router
    app.include_router(dataset_router)
    
    @app.get("/")
    async def root():
        """Root endpoint."""
        return {
            "message": "BioRAG API",
            "version": __version__,
            "docs": "/docs"
        }
    
    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "version": __version__}
    
    @app.post("/query", response_model=QueryResponse)
    async def query_biorag(request: QueryRequest) -> QueryResponse:
        """Main BioRAG query endpoint."""
        try:
            # Process the query through the RAG pipeline
            result = await rag_pipeline.query(
                question=request.question,
                max_documents=request.max_documents,
                retrieve_from_sources=request.retrieve_from_sources,
                response_type=request.response_type,
                system_prompt=request.system_prompt,
                model=request.model
            )
            
            return QueryResponse(**result)
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/stats")
    async def get_stats():
        """Get system statistics."""
        try:
            # Simple stats for now
            stats = {
                "status": "healthy",
                "version": __version__,
                "timestamp": datetime.utcnow().isoformat()
            }
            return stats
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app

# Create the app instance
app = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "biorag.api.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    ) 