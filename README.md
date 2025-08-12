# Axon

![Axon Logo](src/png/axon-very-rounded-150.png)

AI-powered biological analysis platform that combines LLM-driven code generation with intelligent dataset discovery.

## Features

- **🤖 LLM-Driven Analysis**: AI generates custom Python code for your research questions
- **🔬 Smart Dataset Search**: Finds relevant single-cell datasets from CellxCensus, with GEO and PubMed fallback
- **📊 Jupyter Integration**: Seamless notebook execution with virtual environments
- **💬 Natural Language Interface**: Ask questions like "Find transcriptional subtypes of B-ALL"
- **🔄 Auto-Execution Pipeline**: Cells execute automatically with output analysis and refactoring
- **📜 Smart Autoscroll**: Real-time scrolling during code generation and execution
- **🔧 Intelligent Refactoring**: Failed cells are automatically refactored and retried

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

## Auto-Execution Features

The platform now includes intelligent auto-execution capabilities:

- **🔄 Sequential Execution**: Cells execute one by one, analyzing outputs before proceeding
- **📊 Output Analysis**: Each cell's output is analyzed for success indicators
- **🔧 Automatic Refactoring**: Failed cells are automatically refactored and retried
- **📜 Real-time Scrolling**: Interface automatically scrolls during code generation and execution
- **🤖 Dynamic Step Generation**: Next analysis steps are generated based on previous outputs
- **🔍 Code Validation & Linting**: All generated code is validated and linted before execution
- **🛠️ Automatic Error Fixing**: Validation errors are automatically fixed using AI
- **📋 Enhanced Error Reporting**: Detailed validation errors and warnings are displayed

## Architecture

- **Backend**: Python FastAPI with LLM integration
- **Frontend**: Electron app with React/TypeScript
- **Analysis**: Jupyter notebooks with virtual environments

## Cloud backend and database

- Deploy the FastAPI backend (`backend/`) to your server (e.g., DigitalOcean). Set environment variables:
  - `OPENAI_API_KEY` (and optional `ANTHROPIC_API_KEY`)
  - `DATABASE_URL` (Postgres connection string)
  - `BACKEND_JWT_SECRET` (used for issuing/verifying backend JWTs)
- Database uses Prisma (Python) with Postgres. After installing backend requirements:
  - `pip install -r backend/requirements.txt`
  - `pip install prisma`
  - `prisma generate`
  - `prisma migrate deploy`

### Google Sign-In

- Backend exposes `POST /auth/google` with body `{ id_token: string }` from Google Sign-In.
- On success, backend upserts user and returns `{ access_token, email, name }`.
- Send `Authorization: Bearer <access_token>` in subsequent requests; usage and messages are logged per user.

## License

Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
