# Node - AI-Powered Biological Analysis Platform

A comprehensive AI-driven system for biological data analysis that combines retrieval-augmented generation (RAG) with intelligent code generation for bioinformatics research.

## 🧬 AI-Powered Biological Analysis Agent

Node provides an **intelligent Electron desktop application** that acts as "Cursor for Bioinformatics" - delivering autonomous biological data analysis through natural language interaction powered by Large Language Models.

### ✨ What Makes This Revolutionary

- **🤖 LLM-Driven Analysis Planning**: AI analyzes your research question and creates custom analysis workflows
- **💻 Dynamic Code Generation**: Generates Python code specifically tailored to your biological question (no templates!)
- **🔬 Intelligent Dataset Discovery**: Uses RAG to find and acquire real biological datasets from GEO, PubMed, UniProt
- **📊 Jupyter Integration**: Seamlessly integrates with Jupyter Lab for interactive analysis
- **🗣️ Natural Language Interface**: Simply describe your research question in plain English

### 🚀 How It Works

1. **Ask any biological research question**:

   ```
   "Compare AML vs ALL gene expression patterns"
   "Find transcriptional subtypes of B-cell leukemia"
   "Identify biomarkers for breast cancer subtypes"
   ```

2. **AI automatically**:
   - **Understands** your specific biological context using LLM analysis
   - **Plans** appropriate analysis steps tailored to your question
   - **Searches** biological databases for relevant datasets
   - **Generates** production-ready Python code for each analysis step
   - **Executes** code sequentially in Jupyter Lab
   - **Creates** visualizations, statistical analyses, and biological interpretations

### 💡 Key Innovations

#### 🧠 LLM-Based Analysis Planning

- **No Hardcoded Workflows**: Every analysis plan is generated fresh by AI
- **Question-Specific**: Understands the difference between differential expression, clustering, subtyping, biomarker discovery, etc.
- **Biologically Informed**: AI has deep knowledge of bioinformatics methods and best practices

#### 💻 Dynamic Code Generation

- **Custom Python Code**: Generates specific code for your exact research question
- **Real Bioinformatics**: Uses proper libraries (pandas, scikit-learn, matplotlib, seaborn, GEOparse)
- **Production Ready**: Includes error handling, proper imports, and biological interpretation

#### 🔬 Intelligent Data Integration

- **Smart Dataset Search**: Extracts meaningful search terms from complex queries
- **Real Data Sources**: Connects to GEO, PubMed, UniProt APIs
- **Rate Limiting**: Respects API limits and handles errors gracefully

### 💻 Desktop Application Features

- **🤖 AI Chat Interface**: Specialized biological research assistant
- **📁 File Management**: Organize analysis files and datasets
- **📓 Jupyter Integration**: Embedded Jupyter Lab with proper CSP handling
- **📊 Real-time Analysis**: Watch your analysis execute step-by-step
- **🧬 Biological Context**: AI understands cancer types, gene expression, pathways, etc.

## Architecture

### Backend (Python)

- **🔍 Node Server**: Intelligent retrieval-augmented generation for biological queries
- **🗄️ Vector Database**: ChromaDB for efficient biological document storage
- **🌐 API Integration**: Connects to GEO, PubMed, UniProt, and other databases
- **⚡ FastAPI**: High-performance REST API

### Frontend (TypeScript/Electron)

- **🎨 Modern UI**: Clean, professional interface built with React
- **🔧 Autonomous Agent**: LLM-powered analysis orchestration
- **📓 Jupyter Viewer**: Embedded notebook interface with webview
- **💬 Chat System**: Natural language interaction with the AI

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

## License

**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**

This work is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](http://creativecommons.org/licenses/by-nc-sa/4.0/).

You are free to:

- **Share** — copy and redistribute the material in any medium or format
- **Adapt** — remix, transform, and build upon the material

Under the following terms:

- **Attribution** — You must give appropriate credit, provide a link to the license, and indicate if changes were made
- **NonCommercial** — You may not use the material for commercial purposes
- **ShareAlike** — If you remix, transform, or build upon the material, you must distribute your contributions under the same license

For commercial licensing inquiries, please contact the project maintainer.
