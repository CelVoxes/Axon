"""Minimal CLI for GEO semantic search."""

import asyncio
import typer
from typing import Optional

from .geo_search import SimpleGEOClient
from .cellxcensus_search import SimpleCellxCensusClient

app = typer.Typer(help="Minimal GEO and CellxCensus Semantic Search CLI")


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


# CellxCensus commands
@app.command()
def cellx_search(
    query: str = typer.Argument(..., help="Search query"),
    limit: int = typer.Option(25, help="Maximum number of results"),
    organism: str = typer.Option("Homo sapiens", help="Organism ('Homo sapiens' or 'Mus musculus')")
):
    """Search for single-cell datasets in CellxCensus similar to the query."""
    async def run_search():
        try:
            client = SimpleCellxCensusClient()
            
            typer.echo(f"🔍 Searching CellxCensus for: '{query}'")
            typer.echo(f"   Organism: {organism}")
            
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
                typer.echo(f"   Cells: {dataset['sample_count']}")
                typer.echo(f"   Platform: {dataset['platform']}")
                typer.echo(f"   Similarity: {dataset.get('similarity_score', 0):.3f}")
                if dataset.get('description'):
                    desc = dataset['description'][:150] + "..." if len(dataset['description']) > 150 else dataset['description']
                    typer.echo(f"   Description: {desc}")
                typer.echo()
            
            await client.cleanup()
            
        except ImportError:
            typer.echo("❌ CellxCensus not available. Install with: pip install cellxgene-census")
        except Exception as e:
            typer.echo(f"❌ Error: {e}")
    
    asyncio.run(run_search())


@app.command()
def cellx_cell_type(
    cell_type: str = typer.Argument(..., help="Cell type name (e.g., 'B cell', 'T cell')"),
    organism: str = typer.Option("Homo sapiens", help="Organism ('Homo sapiens' or 'Mus musculus')"),
    limit: int = typer.Option(25, help="Maximum number of results")
):
    """Search for CellxCensus datasets by cell type."""
    async def run_search():
        try:
            client = SimpleCellxCensusClient()
            
            typer.echo(f"🔍 Searching CellxCensus for cell type: {cell_type}")
            typer.echo(f"   Organism: {organism}")
            
            datasets = await client.search_by_cell_type(
                cell_type=cell_type,
                organism=organism,
                limit=limit
            )
            
            if not datasets:
                typer.echo("❌ No datasets found")
                return
            
            typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
            
            for i, dataset in enumerate(datasets, 1):
                typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
                typer.echo(f"   Cells: {dataset['sample_count']}")
                typer.echo(f"   Similarity: {dataset.get('similarity_score', 0):.3f}")
                # Show cell types if available
                if dataset.get('cell_types'):
                    types = ', '.join(dataset['cell_types'][:5])
                    typer.echo(f"   Cell types: {types}")
                typer.echo()
            
            await client.cleanup()
            
        except ImportError:
            typer.echo("❌ CellxCensus not available. Install with: pip install cellxgene-census")
        except Exception as e:
            typer.echo(f"❌ Error: {e}")
    
    asyncio.run(run_search())


@app.command()
def cellx_tissue(
    tissue: str = typer.Argument(..., help="Tissue name (e.g., 'lung', 'brain', 'liver')"),
    organism: str = typer.Option("Homo sapiens", help="Organism ('Homo sapiens' or 'Mus musculus')"),
    limit: int = typer.Option(25, help="Maximum number of results")
):
    """Search for CellxCensus datasets by tissue type."""
    async def run_search():
        try:
            client = SimpleCellxCensusClient()
            
            typer.echo(f"🔍 Searching CellxCensus for tissue: {tissue}")
            typer.echo(f"   Organism: {organism}")
            
            datasets = await client.search_by_tissue(
                tissue=tissue,
                organism=organism,
                limit=limit
            )
            
            if not datasets:
                typer.echo("❌ No datasets found")
                return
            
            typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
            
            for i, dataset in enumerate(datasets, 1):
                typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
                typer.echo(f"   Cells: {dataset['sample_count']}")
                typer.echo(f"   Similarity: {dataset.get('similarity_score', 0):.3f}")
                # Show tissues if available
                if dataset.get('tissues'):
                    tissues = ', '.join(dataset['tissues'][:3])
                    typer.echo(f"   Tissues: {tissues}")
                typer.echo()
            
            await client.cleanup()
            
        except ImportError:
            typer.echo("❌ CellxCensus not available. Install with: pip install cellxgene-census")
        except Exception as e:
            typer.echo(f"❌ Error: {e}")
    
    asyncio.run(run_search())


@app.command()
def cellx_disease(
    disease: str = typer.Argument(..., help="Disease name (e.g., 'COVID-19', 'cancer')"),
    organism: str = typer.Option("Homo sapiens", help="Organism ('Homo sapiens' or 'Mus musculus')"),
    limit: int = typer.Option(25, help="Maximum number of results")
):
    """Search for CellxCensus datasets by disease."""
    async def run_search():
        try:
            client = SimpleCellxCensusClient()
            
            typer.echo(f"🔍 Searching CellxCensus for disease: {disease}")
            typer.echo(f"   Organism: {organism}")
            
            datasets = await client.search_by_disease(
                disease=disease,
                organism=organism,
                limit=limit
            )
            
            if not datasets:
                typer.echo("❌ No datasets found")
                return
            
            typer.echo(f"\n✅ Found {len(datasets)} datasets:\n")
            
            for i, dataset in enumerate(datasets, 1):
                typer.echo(f"{i}. {dataset['id']} - {dataset['title']}")
                typer.echo(f"   Cells: {dataset['sample_count']}")
                typer.echo(f"   Similarity: {dataset.get('similarity_score', 0):.3f}")
                # Show diseases if available
                if dataset.get('diseases'):
                    diseases = ', '.join([d for d in dataset['diseases'] if d != 'normal'][:3])
                    if diseases:
                        typer.echo(f"   Diseases: {diseases}")
                typer.echo()
            
            await client.cleanup()
            
        except ImportError:
            typer.echo("❌ CellxCensus not available. Install with: pip install cellxgene-census")
        except Exception as e:
            typer.echo(f"❌ Error: {e}")
    
    asyncio.run(run_search())


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to bind to")
):
    """Start the API server with GEO, Broad, and CellxCensus support."""
    typer.echo(f"🚀 Starting API server with GEO, Broad, and CellxCensus support on {host}:{port}")
    typer.echo(f"📖 API Documentation: http://{host}:{port}/docs")
    
    from .api import run_server
    run_server(host=host, port=port)


if __name__ == "__main__":
    app() 