"""CLI utilities for CellxCensus TF-IDF search."""

from __future__ import annotations

import asyncio
from typing import Optional

import typer

from .api import run_server
from .cellxcensus_search import SimpleCellxCensusClient

app = typer.Typer(help="CellxCensus TF-IDF search tools")


def _print_dataset(dataset: dict, index: int) -> None:
    """Pretty-print a single dataset entry."""
    title = str(dataset.get("title", ""))
    typer.echo(f"{index}. {title}")
    typer.echo(f"   ID: {dataset.get('id', '')}")
    typer.echo(f"   Organism: {dataset.get('organism', 'Unknown')}")
    typer.echo(f"   Cells/Samples: {dataset.get('sample_count', '0')}")
    typer.echo(f"   Platform: {dataset.get('platform', 'Unknown')}")
    score = float(dataset.get("similarity_score", 0.0) or 0.0)
    typer.echo(f"   Similarity: {score:.3f}")
    description = str(dataset.get("description", ""))
    if description:
        snippet = description if len(description) < 160 else description[:157] + "…"
        typer.echo(f"   Description: {snippet}")
    url = dataset.get("url")
    if url:
        typer.echo(f"   URL: {url}")
    typer.echo()


@app.command()
def search(
    query: str = typer.Argument(..., help="Free-text query"),
    limit: int = typer.Option(25, help="Maximum number of results to return"),
    organism: Optional[str] = typer.Option(None, help="Optional organism filter"),
) -> None:
    """Search CellxCensus datasets using TF-IDF retrieval."""

    async def _run() -> None:
        client = SimpleCellxCensusClient()
        try:
            typer.echo(f"🔍 Searching CellxCensus for '{query}'")
            if organism:
                typer.echo(f"   Organism filter: {organism}")
            results = await client.find_similar_datasets(query=query, limit=limit, organism=organism)
            if not results:
                typer.echo("❌ No datasets found")
                return
            typer.echo(f"\n✅ Found {len(results)} datasets:\n")
            for idx, dataset in enumerate(results, start=1):
                _print_dataset(dataset, idx)
        finally:
            await client.cleanup()

    try:
        asyncio.run(_run())
    except RuntimeError as exc:
        typer.echo(f"❌ CellxCensus unavailable: {exc}")
    except Exception as exc:  # pragma: no cover - guardrail for CLI
        typer.echo(f"❌ Search failed: {exc}")


@app.command()
def serve(host: str = typer.Option("0.0.0.0", help="Bind host"), port: int = typer.Option(8000, help="HTTP port")) -> None:
    """Run the FastAPI service."""
    run_server(host=host, port=port)


@app.command()
def version() -> None:
    """Show CLI version metadata."""
    typer.echo("CellxCensus Search CLI 1.1.0")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    app()
