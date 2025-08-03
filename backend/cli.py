"""Minimal CLI for GEO semantic search."""

import asyncio
import typer
from typing import Optional

from .geo_search import SimpleGEOClient

app = typer.Typer(help="Minimal GEO Semantic Search CLI")


@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    limit: int = typer.Option(50, help="Maximum number of results"),  # Increased from 25 to 50
    organism: Optional[str] = typer.Option(None, help="Filter by organism")
):
    """Search for GEO datasets similar to the query."""
    async def run_search():
        client = SimpleGEOClient()
        
        typer.echo(f"🔍 Searching for: '{query}'")
        if organism:
            typer.echo(f"   Organism filter: {organism}")
        
        datasets = await client.find_similar_datasets(
            query=query,
            limit=limit,
            organism=organism
        )
        
        if not datasets:
            typer.echo("❌ No datasets found")
            return
        
        typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
        
        for i, dataset in enumerate(datasets, 1):
            typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
            typer.echo(f"   Organism: {dataset['organism']}")
            typer.echo(f"   Samples: {dataset['sample_count']}")
            typer.echo(f"   Platform: {dataset['platform']}")
            typer.echo(f"   Similarity: {dataset['similarity_score']:.3f}")
            if dataset.get('description'):
                desc = dataset['description'][:100] + "..." if len(dataset['description']) > 100 else dataset['description']
                typer.echo(f"   Description: {desc}")
            typer.echo(f"   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={dataset['id']}")
            typer.echo()
        
        await client.cleanup()
    
    asyncio.run(run_search())


@app.command()
def gene(
    gene: str = typer.Argument(..., help="Gene name or symbol"),
    organism: Optional[str] = typer.Option(None, help="Filter by organism"),
    limit: int = typer.Option(50, help="Maximum number of results")  # Increased from 25 to 50
):
    """Search for GEO datasets related to a specific gene."""
    async def run_gene_search():
        client = SimpleGEOClient()
        
        typer.echo(f"🔍 Searching for gene: {gene}")
        if organism:
            typer.echo(f"   Organism filter: {organism}")
        
        datasets = await client.search_by_gene(
            gene=gene,
            organism=organism,
            limit=limit
        )
        
        if not datasets:
            typer.echo("❌ No datasets found")
            return
        
        typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
        
        for i, dataset in enumerate(datasets, 1):
            typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
            typer.echo(f"   Organism: {dataset['organism']}")
            typer.echo(f"   Samples: {dataset['sample_count']}")
            typer.echo(f"   Similarity: {dataset['similarity_score']:.3f}")
            typer.echo(f"   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={dataset['id']}")
            typer.echo()
    
    asyncio.run(run_gene_search())


@app.command()
def disease(
    disease: str = typer.Argument(..., help="Disease name"),
    limit: int = typer.Option(25, help="Maximum number of results")  # Increased from 10 to 25
):
    """Search for GEO datasets related to a specific disease."""
    async def run_disease_search():
        client = SimpleGEOClient()
        
        typer.echo(f"🔍 Searching for disease: {disease}")
        
        datasets = await client.search_by_disease(
            disease=disease,
            limit=limit
        )
        
        if not datasets:
            typer.echo("❌ No datasets found")
            return
        
        typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
        
        for i, dataset in enumerate(datasets, 1):
            typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
            typer.echo(f"   Organism: {dataset['organism']}")
            typer.echo(f"   Samples: {dataset['sample_count']}")
            typer.echo(f"   Similarity: {dataset['similarity_score']:.3f}")
            typer.echo(f"   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={dataset['id']}")
            typer.echo()
    
    asyncio.run(run_disease_search())


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to bind to")
):
    """Start the minimal API server."""
    typer.echo(f"🚀 Starting Minimal GEO Semantic Search API on {host}:{port}")
    typer.echo(f"📖 API Documentation: http://{host}:{port}/docs")
    
    from .api import run_server
    run_server(host=host, port=port)


if __name__ == "__main__":
    app() 