"""Main application entry point for BioRAG system."""

import uvicorn
import typer
from typing import Optional

from .config import settings
from .api.app import create_app


app_cli = typer.Typer(help="BioRAG - Biological Retrieval-Augmented Generation System")


@app_cli.command()
def serve(
    host: str = typer.Option(None, help="Host to bind to"),
    port: int = typer.Option(None, help="Port to bind to"),
    reload: bool = typer.Option(None, help="Enable auto-reload")
):
    """Start the BioRAG API server."""
    # Use settings defaults if not provided
    host = host or settings.api_host
    port = port or settings.api_port
    reload = reload if reload is not None else settings.api_reload
    
    typer.echo(f"Starting BioRAG API server on {host}:{port}")
    typer.echo(f"Auto-reload: {reload}")
    typer.echo("Access the API documentation at: http://localhost:8000/docs")
    
    # Create FastAPI app
    fastapi_app = create_app()
    
    # Run with uvicorn
    uvicorn.run(
        fastapi_app,
        host=host,
        port=port,
        reload=reload,
        log_level=settings.log_level.lower()
    )


@app_cli.command()
def info():
    """Show system information."""
    from . import __version__
    
    typer.echo(f"BioRAG Version: {__version__}")
    typer.echo(f"Embedding Model: {settings.embedding_model}")
    typer.echo(f"ChromaDB Directory: {settings.chroma_persist_directory}")
    typer.echo(f"OpenAI Model: {settings.openai_model}")
    typer.echo(f"Rate Limit: {settings.rate_limit_per_second} requests/second")


@app_cli.command()
def test_query(
    question: str = typer.Argument(..., help="Biological question to ask"),
    max_docs: int = typer.Option(5, help="Maximum documents to retrieve")
):
    """Test a biological query."""
    import asyncio
    from .client import BioRAGClient
    
    async def run_query():
        async with BioRAGClient() as client:
            typer.echo(f"Question: {question}")
            typer.echo("Processing...")
            
            result = await client.query(
                question=question,
                max_documents=max_docs
            )
            
            typer.echo(f"\nAnswer: {result['answer']}")
            typer.echo(f"\nRetrieved {result['retrieval']['documents_found']} documents")
            typer.echo(f"Context type: {result['retrieval']['context_type']}")
            typer.echo(f"Search strategy: {result['retrieval']['search_strategy']}")
            
            if result['retrieval']['documents']:
                typer.echo("\nTop sources:")
                for i, doc in enumerate(result['retrieval']['documents'][:3], 1):
                    typer.echo(f"  {i}. {doc.get('title', 'Untitled')} ({doc.get('source', 'Unknown')})")
    
    try:
        asyncio.run(run_query())
    except Exception as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)


@app_cli.command()
def search_gene(
    gene: str = typer.Argument(..., help="Gene name or symbol"),
    organism: Optional[str] = typer.Option(None, help="Organism name")
):
    """Search for information about a gene."""
    import asyncio
    from .client import BioRAGClient
    
    async def run_search():
        async with BioRAGClient() as client:
            typer.echo(f"Searching for gene: {gene}")
            if organism:
                typer.echo(f"Organism: {organism}")
            typer.echo("Processing...")
            
            result = await client.search_gene(
                gene=gene,
                organism=organism
            )
            
            typer.echo(f"\nAnswer: {result['answer']}")
            typer.echo(f"\nFound {result['retrieval']['documents_found']} relevant documents")
    
    try:
        asyncio.run(run_search())
    except Exception as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)


@app_cli.command()
def query(
    question: str = typer.Argument(..., help="Biological question to ask")
):
    """Ask a biological question."""
    import asyncio
    from .client import BioRAGClient
    
    async def run_query():
        async with BioRAGClient() as client:
            typer.echo(f"Question: {question}")
            typer.echo("Processing...")
            
            result = await client.query(question=question)
            
            typer.echo(f"\nAnswer: {result['answer']}")
            
            if result['retrieval']['documents']:
                typer.echo(f"\nBased on {result['retrieval']['documents_found']} relevant documents")
    
    try:
        asyncio.run(run_query())
    except Exception as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)


@app_cli.command()
def stats():
    """Show system statistics."""
    import asyncio
    from .client import BioRAGClient
    
    async def get_stats():
        async with BioRAGClient() as client:
            stats = await client.get_stats()
            
            typer.echo("BioRAG System Statistics:")
            typer.echo(f"  Documents in knowledge base: {stats.get('document_count', 0)}")
            typer.echo(f"  Collection name: {stats.get('name', 'Unknown')}")
            typer.echo(f"  Storage directory: {stats.get('persist_directory', 'Unknown')}")
    
    try:
        asyncio.run(get_stats())
    except Exception as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)


if __name__ == "__main__":
    app_cli() 