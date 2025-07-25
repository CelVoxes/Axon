# BioRAG Cursor - Biological Data Analysis Interface

A Cursor-like Electron application for biological data analysis powered by the BioRAG system. This interface provides an AI-powered workspace where researchers can interactively analyze biological data with autonomous agent assistance.

## Features

🧬 **AI-Powered Biological Analysis**

- Natural language queries for biological questions
- Autonomous analysis pipeline execution
- Integration with GEO, PubMed, and UniProt databases

🔬 **Interactive Jupyter Environment**

- Embedded Jupyter Lab for data analysis
- Support for Python and R notebooks
- Real-time collaboration with AI assistant

📁 **Cursor-like Interface**

- File explorer and project management
- Side-by-side chat with AI assistant
- TODO list management for analysis tasks
- Monaco code editor with syntax highlighting

🤖 **Autonomous Agent System**

- Automatic dataset discovery and download
- Preprocessing pipeline execution
- Differential expression analysis
- Results visualization and interpretation

## Prerequisites

- Node.js 18+ and npm
- Python 3.8+ with the BioRAG dependencies installed
- Jupyter Lab (`pip install jupyterlab`)
- Git

## Installation

1. **Clone the repository and navigate to the project:**

   ```bash
   cd BioRAG  # Assuming you're in the main BioRAG directory
   ```

2. **Install Electron app dependencies:**

   ```bash
   npm install
   ```

3. **Ensure BioRAG Python environment is set up:**

   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables:**
   Create a `.env` file in the BioRAG root directory:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   NCBI_API_KEY=your_ncbi_api_key_here  # Optional but recommended
   ```

## Development

1. **Start the development environment:**

   ```bash
   npm run dev
   ```

   This will:

   - Build the TypeScript files
   - Start webpack in watch mode
   - Launch the Electron app with hot reload
   - Automatically start the BioRAG API server

2. **For production build:**
   ```bash
   npm run build
   npm start
   ```

## Usage

### Getting Started

1. **Launch the Application:**
   The app will automatically start the BioRAG API server in the background

2. **Open a Workspace:**

   - Click "Open Folder" in the sidebar
   - Select your project directory
   - The file explorer will show your project structure

3. **Start Jupyter Lab:**
   - Click "Start Jupyter" in the main content area
   - Jupyter Lab will launch and be embedded in the interface
   - You can create and edit notebooks directly

### AI-Powered Analysis

1. **Ask Biological Questions:**

   ```
   "What is the function of the TP53 gene?"
   "Tell me about breast cancer subtypes"
   "Compare BRCA1 and BRCA2 genes"
   ```

2. **Request Data Analysis:**

   ```
   "Can you compare different AML subtypes and give me the top 10 DEGs?"
   "Find datasets related to Alzheimer's disease and perform pathway analysis"
   "Download gene expression data for lung cancer and identify biomarkers"
   ```

3. **Autonomous Pipeline Execution:**
   When you request analysis, the AI will:
   - Create a TODO list with analysis steps
   - Search biological databases automatically
   - Generate and execute analysis code
   - Provide results and visualizations
   - Suggest follow-up analyses

### Example Workflow

1. **Open the app and create/open a workspace**
2. **Chat with the AI assistant:**
   ```
   User: "I want to analyze AML subtypes. Can you find relevant datasets and identify the top 10 differentially expressed genes between FAB M1 and M2 subtypes?"
   ```
3. **The system will:**

   - Create a TODO list with analysis steps
   - Search GEO database for AML datasets
   - Filter for datasets with M1/M2 subtype information
   - Download and preprocess the data
   - Perform differential expression analysis
   - Generate visualizations (heatmaps, volcano plots)
   - Provide interpretation and biological insights

4. **Review results in Jupyter notebooks**
5. **Ask follow-up questions or request additional analyses**

## Key Components

### Main Interface

- **Sidebar:** File explorer and workspace management
- **Main Content:** Jupyter Lab integration and file editing
- **Chat Panel:** AI assistant interaction
- **TODO Panel:** Task tracking and pipeline progress
- **Status Bar:** System status and connection indicators

### AI Assistant Features

- Natural language biological queries
- Automatic TODO list generation
- Database search and data retrieval
- Code generation and execution
- Results interpretation

### Jupyter Integration

- Embedded Jupyter Lab interface
- Automatic environment setup
- Real-time collaboration with AI
- Support for multiple programming languages

## Configuration

### Python Environment

The app will use the Python installation in your PATH by default. To specify a different Python:

1. Open the app
2. The Python path is stored in electron-store and can be modified through the settings

### API Keys

Required for full functionality:

- `OPENAI_API_KEY`: For AI assistant functionality
- `NCBI_API_KEY`: For enhanced PubMed/GEO access (optional)

### Jupyter Configuration

Jupyter Lab starts on port 8889 by default. The app handles token management automatically.

## Troubleshooting

### Common Issues

1. **BioRAG Server Won't Start:**

   - Ensure Python dependencies are installed: `pip install -r requirements.txt`
   - Check the console logs for Python errors
   - Verify your Python path in electron-store

2. **Jupyter Lab Not Loading:**

   - Ensure Jupyter Lab is installed: `pip install jupyterlab`
   - Check if port 8889 is available
   - Review the Jupyter logs in the console

3. **AI Assistant Not Responding:**

   - Verify your OpenAI API key is set correctly
   - Check network connectivity
   - Review the BioRAG server logs

4. **File Operations Failing:**
   - Ensure the workspace directory has proper permissions
   - Check if the files exist and are readable

### Debug Mode

Run in development mode to see detailed logs:

```bash
npm run dev
```

### Logs Location

- Electron main process logs: Console output
- BioRAG server logs: Displayed in chat panel and console
- Jupyter logs: Console output

## Development Notes

### Architecture

- **Main Process:** Electron main process manages windows, file system, and subprocess spawning
- **Renderer Process:** React app with the UI components
- **BioRAG Server:** Python FastAPI server running as subprocess
- **Jupyter Lab:** Separate Python process embedded via iframe

### Key Directories

```
src/
├── main/           # Electron main process
├── renderer/       # React frontend
│   ├── components/ # UI components
│   ├── context/    # React context for state management
│   ├── services/   # API clients and services
│   └── styles/     # CSS styles
└── global.d.ts     # TypeScript definitions
```

### Building for Production

```bash
npm run build        # Build TypeScript and React
npm run package      # Create distributable package
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the console logs for error messages
3. Create an issue in the GitHub repository
4. Provide system information and reproduction steps
