# CellxCensus TF-IDF Search

A lightweight search stack for discovering CellxCensus single-cell datasets. The service builds a TF-IDF index over dataset summaries, retrieves the most relevant records, and optionally blends in small keyword heuristics. No PyTorch or transformer models are required.

## 🎯 What You Get

- **Fast retrieval** of CellxCensus metadata using scikit-learn's TF-IDF
- **Async FastAPI** backend (`backend.api`) with streaming support
- **CLI utilities** for ad-hoc searches (`python -m backend.cli ...`)
- **Optional LLM helpers** (query rewriting, intent detection) for product integration

## 🚀 Quick Start

### Install dependencies

```bash
pip install -r requirements.txt
```

### Command line search

```bash
# Top 10 datasets for a query
python -m backend.cli search "lung cancer t cell" --limit 10

# Run the API locally
python -m backend.cli serve --port 8000
```

### Python usage

```python
import asyncio
from backend.cellxcensus_search import SimpleCellxCensusClient

async def main():
    client = SimpleCellxCensusClient()
    results = await client.find_similar_datasets(
        query="lung cancer t cell",
        limit=5,
        organism="Homo sapiens",
    )
    for ds in results:
        print(ds["id"], ds["title"], ds["similarity_score"])
    await client.cleanup()

asyncio.run(main())
```

### HTTP API

```bash
# Start server
python -m backend.cli serve

# JSON search request
curl -X POST "http://localhost:8000/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "lung cancer t cell", "limit": 5}'

# Server-sent events progress stream
curl -N -X POST "http://localhost:8000/search/stream" \
  -H "Content-Type: application/json" \
  -d '{"query": "lung cancer t cell", "limit": 5}'
```

## 📁 Key Files

- `api.py` – FastAPI application and endpoints
- `cellxcensus_search.py` – TF-IDF search implementation
- `cli.py` – Command line interface
- `llm_service.py` – Optional LLM utilities (query rewrites, intent, etc.)

## 🔍 How It Works

1. **Metadata loading** – CellxCensus metadata is cached in memory/pandas.
2. **TF-IDF index** – Summaries are vectorised (1–2 grams, sublinear TF) and cached.
3. **Candidate selection** – Top results by cosine similarity are retrieved.
4. **Keyword boosts** – Simple heuristics reward exact or partial term matches.
5. **Response** – Results include similarity score, metadata, and provenance.

## ✅ Example Output

```
🔍 Searching CellxCensus for 'lung cancer t cell'

1. Dataset XYZ123 - High-resolution single-cell atlas of lung cancer T cells
   Organism: Homo sapiens
   Cells/Samples: 154,321
   Platform: 10x Chromium scRNA-seq
   Similarity: 0.812
```

## 🛠 Tips

- Results are cached in-memory; rerunning the same query is instantaneous.
- Set `CELLXCENSUS_AVAILABLE=0` (or uninstall the package) to surface the runtime error path quickly.
- The backend retains LLM endpoints, but dataset ranking no longer depends on them.
