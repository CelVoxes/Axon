# Minimal GEO Semantic Search

A simplified system for finding similar GEO datasets using semantic search. This is the minimal version that focuses only on GEO dataset discovery without the complexity of RAG or AI code generation.

## 🎯 Purpose

Find the most similar GEO datasets to a user query using semantic search with embeddings.

## 🚀 Quick Start

### Installation

```bash
pip install -r requirements.txt
```

### Command Line Usage

```bash
# Search for datasets
python -m backend.cli search "breast cancer gene expression" --limit 5

# Search by gene
python -m backend.cli gene TP53 --organism "Homo sapiens" --limit 5

# Search by disease
python -m backend.cli disease "breast cancer" --limit 5

# Start API server
python -m backend.cli serve --port 8000
```

### API Usage

```python
import asyncio
from backend.geo_search import SimpleGEOClient

async def main():
    client = SimpleGEOClient()

    # Search for datasets
    datasets = await client.find_similar_datasets(
        query="breast cancer gene expression",
        limit=5,
        organism="Homo sapiens"
    )

    for dataset in datasets:
        print(f"{dataset['id']}: {dataset['title']} (Score: {dataset['similarity_score']:.3f})")

asyncio.run(main())
```

### HTTP API

```bash
# Start server
python -m backend.cli serve

# Search datasets
curl -X POST "http://localhost:8000/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "breast cancer gene expression", "limit": 5}'

# Search by gene
curl "http://localhost:8000/search/gene/TP53?organism=Homo%20sapiens&limit=5"

# Search by disease
curl "http://localhost:8000/search/disease/breast%20cancer?limit=5"
```

## 📁 Files

- `simple_geo_search.py` - Core semantic search functionality
- `api.py` - FastAPI application
- `cli.py` - Command line interface
- `requirements.txt` - Minimal dependencies

## 🔧 How It Works

1. **Search GEO**: Uses NCBI E-utilities to find candidate datasets
2. **Create Embeddings**: Converts query and dataset descriptions to vectors
3. **Calculate Similarity**: Uses cosine similarity to rank datasets
4. **Return Results**: Returns top similar datasets with scores

## 📊 Example Output

```
🔍 Searching for: 'breast cancer gene expression'
📊 Found 15 candidate datasets
✅ Returning top 5 most similar datasets

1. GSE12345 - Breast Cancer Gene Expression Analysis
   Organism: Homo sapiens
   Samples: 120
   Similarity: 0.892
   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345

2. GSE67890 - Transcriptional Profiling of Breast Cancer Subtypes
   Organism: Homo sapiens
   Samples: 85
   Similarity: 0.845
   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE67890
```

## 🎯 Key Features

- **Semantic Search**: Understands meaning, not just keywords
- **GEO Integration**: Direct access to GEO database
- **Similarity Scoring**: Ranked results with similarity scores
- **Multiple Interfaces**: CLI, API, and Python client
- **Minimal Dependencies**: Only essential packages

## 🔍 Search Methods

- **General Search**: Find datasets by description
- **Gene Search**: Find datasets related to specific genes
- **Disease Search**: Find datasets related to specific diseases
- **Organism Filtering**: Filter by organism (e.g., "Homo sapiens")

## 📈 Performance

- **Fast**: Direct GEO API access with minimal processing
- **Accurate**: Semantic similarity using state-of-the-art embeddings
- **Scalable**: Async processing for multiple requests
- **Reliable**: Error handling and rate limiting

## 🚀 Next Steps

This minimal system can be extended with:

- More advanced filtering options
- Caching for improved performance
- Integration with analysis workflows
