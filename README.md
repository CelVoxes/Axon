# Axon

![Axon Logo](src/png/axon-very-rounded-150.png)

AI-powered biological analysis platform that combines LLM-driven code generation with intelligent dataset discovery.

## Features

- **🤖 LLM-Driven Analysis**: AI generates custom Python code for your research questions
- **🔬 Smart Dataset Search**: Finds relevant biological datasets from GEO, PubMed, UniProt
- **📊 Jupyter Integration**: Seamless notebook execution with virtual environments
- **💬 Natural Language Interface**: Ask questions like "Find transcriptional subtypes of B-ALL"

## Quick Start

1. **Install Dependencies**

   ```bash
   pip install -r requirements.txt
   npm install
   ```

2. **Set API Keys**

   ```bash
   cp .env.example .env
   # Add your OPENAI_API_KEY
   ```

3. **Start Application**

   ```bash
   npm run dev
   ```

4. **Ask Questions**
   - "Compare AML vs ALL gene expression patterns"
   - "Find biomarkers for breast cancer subtypes"
   - "Analyze Alzheimer's disease gene expression data"

## Architecture

- **Backend**: Python FastAPI with LLM integration
- **Frontend**: Electron app with React/TypeScript
- **Analysis**: Jupyter notebooks with virtual environments

## License

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
