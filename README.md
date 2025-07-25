# BioRAG - Biological Retrieval-Augmented Generation System

A comprehensive RAG system designed specifically for biological data retrieval and analysis from GEO (Gene Expression Omnibus) and other biological databases.

## 🧬 New! Autonomous Biological Analysis Agent

BioRAG now includes an **intelligent Electron desktop application** that acts as a "Cursor for bioinformatics" - providing autonomous biological data analysis through natural language interaction.

### ✨ What Makes This Special

- **RAG-Powered Dataset Discovery**: Uses retrieval-augmented generation to find real GEO datasets
- **Autonomous Code Generation**: Generates and executes Python analysis code automatically
- **Jupyter Integration**: Seamlessly integrates with Jupyter Lab for interactive analysis
- **Natural Language Interface**: Simply describe what you want to analyze

### 🚀 Example Workflow

1. **Ask a biological question**:

   ```
   "Can you compare different AML subtypes and give me the top 10 DEGs?"
   ```

2. **The agent automatically**:
   - Creates a TODO pipeline for the analysis
   - Searches GEO database using RAG for relevant datasets
   - Downloads real biological data
   - Starts Jupyter Lab automatically
   - Generates analysis code (quality control, differential expression, visualization)
   - Executes code in Jupyter and shows results
   - Provides biological interpretation of findings

### 💻 Desktop Application Features

- **Chat Interface**: AI assistant specialized for biological queries
- **File Explorer**: Manage analysis files and notebooks
- **Jupyter Viewer**: Embedded Jupyter Lab interface
- **TODO Tracking**: Automatic pipeline management
- **Real-time Logs**: Monitor analysis progress

## Features

- **Multi-database Support**: Retrieve data from GEO, PubMed, UniProt, and other biological databases
- **Intelligent Embeddings**: Specialized embeddings for biological text and data
- **Vector Storage**: Efficient storage and retrieval using ChromaDB
- **RAG Pipeline**: Advanced retrieval-augmented generation for biological queries
- **API Interface**: FastAPI-based REST API for easy integration
- **Data Processing**: Specialized preprocessing for biological documents and metadata

## Quick Start

### Desktop Application (Recommended)

1. **Install Dependencies**

   ```bash
   # Python dependencies
   pip install -r requirements.txt

   # Node.js dependencies
   npm install
   ```

2. **Start the Application**

   ```bash
   npm start
   ```

3. **Try the Autonomous Agent**
   - Open the chat panel on the right
   - Ask questions like:
     - "Compare different cancer subtypes and find biomarkers"
     - "Analyze Alzheimer's disease gene expression data"
     - "Find differentially expressed genes in breast cancer"

### Command Line Usage

1. **Install Dependencies**

   ```bash
   pip install -r requirements.txt
   ```

2. **Set Environment Variables**

   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run the System**

   ```bash
   python -m biorag.main
   ```

4. **Access API Documentation**
   Open http://localhost:8000/docs

## Configuration

Create a `.env` file with:

```
OPENAI_API_KEY=your_openai_api_key
GEO_API_BASE=https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi
PUBMED_API_BASE=https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
CHROMA_PERSIST_DIRECTORY=./chroma_db
```

## Usage Examples

### Desktop Agent Examples

```
🧬 Try these biological analysis queries:

"Can you compare different AML subtypes and give me the top 10 DEGs?"
"Find lung cancer biomarkers using RNA-seq data"
"Compare Alzheimer's brain samples to controls and find pathway changes"
"Analyze breast cancer metastasis genes"
```

### Programmatic API Usage

```python
from biorag.client import BioRAGClient

client = BioRAGClient()
response = client.query("What are the effects of p53 mutations in cancer?")
print(response.answer)
```

### Retrieve GEO Datasets

```python
from biorag.data_sources import GEOClient

geo = GEOClient()
datasets = geo.search_datasets("breast cancer", limit=10)
```

## Troubleshooting

### Jupyter Integration Issues

If you encounter Jupyter authentication errors:

1. **Check Python Installation**: The app will try to find Python automatically
2. **Install Jupyter Lab**: `pip install jupyterlab`
3. **Check Logs**: Look at the console for detailed error messages

The application now includes improved Jupyter authentication handling and should work seamlessly with most Python environments.

## Architecture

- `biorag/data_sources/`: Database clients for GEO, PubMed, etc.
- `biorag/embeddings/`: Embedding services and models
- `biorag/storage/`: Vector database management
- `biorag/retrieval/`: Retrieval engine and search
- `biorag/generation/`: RAG pipeline and response generation
- `biorag/api/`: FastAPI endpoints and schemas
- `biorag/utils/`: Utilities and helpers
- `src/`: Electron desktop application
  - `main/`: Main process (Node.js backend)
  - `renderer/`: Renderer process (React frontend)
  - `services/`: Autonomous agent and BioRAG client

## License

MIT License
