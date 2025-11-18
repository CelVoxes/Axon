# Axon (Work in Progress)

![Axon Logo](src/png/axon-very-rounded-150.png)

Axon is an experimental Electron application that tries to couple an LLM-guided analysis workflow with local Jupyter notebooks and a Python FastAPI backend that can search CellxCensus data. This repository contains prototypes of those pieces, but the end-to-end experience is **not** complete yet.

> **Important:** Large areas of the project are unfinished: the backend is only partially wired up, Docker/production deployment assets are placeholders, there's no polished onboarding flow, and most of the advertised features are still stubs. Treat this repo as a workbench rather than a production-ready product.

## Project Status

- **Renderer / Electron shell:** The React UI, workspace management, file explorer, and Jupyter integration run locally, but many UI panels still depend on backend responses that are not yet implemented. `window.electronAPI.bioragQuery` currently returns a hard-coded "not implemented" message.
- **Backend (`backend/`):** The FastAPI service exposes many endpoints and a CLI for CellxCensus search, yet authentication, database logging, and several LLM flows are not tested end-to-end. Prisma migrations need to be run manually and the optional Postgres layer can be disabled through `AXON_DISABLE_DB`.
- **Deployment:** `backend/Dockerfile` builds dependencies but references a non-existent `entrypoint.sh` (you must provide your own). `deploy/do` only contains a DigitalOcean prototype (Caddy + API container) and does not deploy the Electron app or handle TLS/secret management beyond placeholders.
- **Testing:** `npm test` runs Vitest suites under `tests/`, focused on workspace/dataset utilities only. There are no backend tests, no integration tests, and no automation around Docker images.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/main/` | Electron main process, IPC handlers, BioRAG/Jupyter process management. |
| `src/renderer/` | React/TypeScript renderer, context providers, analysis orchestration, chat UI. |
| `backend/` | FastAPI application, CellxCensus TF-IDF search helpers, PM2 scripts, Dockerfile. |
| `prisma/` | Prisma schema for the optional Postgres logging/auth database. |
| `tests/` | Vitest suites covering `DatasetManager`, `EnvironmentManager`, and workspace helpers. |
| `deploy/do/` | Prototype DigitalOcean App Platform manifest (`app.yaml`), `Caddyfile`, and `docker-compose.yml`. |
| `environment.yml` | A very large Conda environment definition for reproducible backend installs (optional). |
| `requirements.txt` / `backend/requirements.txt` | Python dependency lists for the backend pieces. |
| `dist/` and `release/` | Generated output directories used by Webpack and `electron-builder`. |

## Requirements

- **Node.js 18+** (Electron 25 is bundled; Node 18/20 have been tested).
- **npm 9+** (scripts rely on `concurrently`, `wait-on`, and `electron-builder`).
- **Python 3.11** with `pip`, `venv`, and `jupyter`. The backend uses packages that are only published for 3.10/3.11 and requires `libgomp1` (Linux) or Xcode CLT (macOS) for `tiledb`.
- **cellxgene-census dependencies**: installing `backend/requirements.txt` or `environment.yml` pulls in `cellxgene-census`, `tiledbsoma`, and `scanpy`. Expect long install times and significant disk usage.
- **Postgres 14+ (optional)** if you intend to run Prisma models for authentication/usage logs.
- **OpenAI API key** (and optionally Anthropic) to exercise any of the LLM endpoints.
- macOS or Linux development environment. Windows support is untested and the main process invokes Unix utilities such as `lsof`.

## Configuration

Create a `.env` file at the repo root (you can adapt `deploy/do/env.example` for a starting point). Important keys:

- `OPENAI_API_KEY` (required) and `ANTHROPIC_API_KEY` (optional) for the backend LLM client in `backend/llm_service.py`.
- `BACKEND_URL`, `BACKEND_TIMEOUT`, and `DEFAULT_MODEL` influence the renderer's `ConfigManager`. During `npm run dev`, `SPLIT_BACKEND=true` so the UI expects the backend at `http://localhost:8001`.
- `SPLIT_BACKEND=true` keeps the Electron app from trying to spawn the backend. `SKIP_BIORAG=true` skips even the placeholder BioRAG server during development.
- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID` enable the Firebase auth flow. Without these values, the renderer silently skips auth.
- `GOOGLE_CLIENT_ID` is used by `backend/api.py` to validate Google ID tokens when Firebase is not configured.
- `DATABASE_URL` (Postgres connection string) plus `AXON_DISABLE_DB=1` to bypass it when unavailable.
- `AXON_AVAILABLE_MODELS`, `AXON_OPENAI_SERVICE_TIER`, `AXON_DEFAULT_CONTEXT_TOKENS`, and other `AXON_*` vars tune backend model selection and context window limits (see `backend/config.py`).
- `ENABLE_LLM_INTENT`, `LLM_INTENT_TIMEOUT_MS`, and `LLM_INTENT_MIN_CONFIDENCE` gate unfinished intent-detection features in the renderer.
- `JUPYTER_STARTUP_TIMEOUT_MS`, `DEFAULT_MODEL`, and `MAX_ANALYSIS_STEPS` can be set to override renderer defaults.
- `DOMAIN` (used by `deploy/do/Caddyfile`) and TLS cert material are not provisioned automatically.

## Local Development Workflow

1. **Python environment (recommended)**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install -r backend/requirements.txt
   pip install prisma
   prisma generate
   # Optional: prisma migrate dev --name init
   ```
   If you prefer Conda/Mamba, `mamba env create -f environment.yml` reproduces the heavy backend stack.

2. **Install Node/Electron dependencies**
   ```bash
   npm install
   ```

3. **Run the backend manually** (required because `npm run dev` sets `SPLIT_BACKEND=true`)
   ```bash
   # Terminal A
   npm run backend
   # or
   python -m backend.cli serve --host 0.0.0.0 --port 8001
   ```
   The service listens on `http://localhost:8001`. On first boot you may need to authenticate with OpenAI, configure dataset cache directories, and set `AXON_DISABLE_DB=1` if Postgres is unavailable.

4. **Start the renderer**
   ```bash
   # Terminal B
   npm run dev
   ```
   This runs TypeScript in watch mode, rebuilds Webpack bundles, waits for `dist/main/main.js`, and launches Electron. The UI will prompt you to open a workspace folder; Axon will create `.axon` metadata and manage a per-workspace virtual environment/Jupyter server.

5. **Packaging (optional)**
   ```bash
   npm run build      # type-check + production webpack
   npm run package    # electron-builder -> release/
   npm start          # run packaged app using dist/main/main.js
   ```

6. **Tests**
   ```bash
   npm test
   ```
   Only a subset of renderer services have unit tests. There are currently no backend or integration tests.

7. **Backend CLI quick check**
   ```bash
   python -m backend.cli search "acute myeloid leukemia" --limit 5
   python -m backend.cli serve --port 8001
   ```
   The CLI wraps `SimpleCellxCensusClient`, so it requires the same environment variables and datasets.

## Backend Service (Experimental)

- Defined in `backend/api.py` and launched via `python -m backend.cli serve` or PM2 (`backend/pm2-start.sh`).
- Provides endpoints under `/search`, `/llm/*`, and `/cellxcensus/*`. Many of them call into `backend/llm_service.py`, which expects valid OpenAI credentials and will otherwise throw 401/429 errors.
- Database logging and authentication use Prisma models from `prisma/schema.prisma`. Set `DATABASE_URL` and run `prisma generate && prisma migrate deploy` before starting the server; otherwise set `AXON_DISABLE_DB=1`.
- `SimpleCellxCensusClient` (`backend/cellxcensus_search.py`) loads the `cellxgene-census` SOMA store on demand. Initializing the census can take minutes and consumes several GB of RAM; make sure the machine has enough disk and memory.
- Docker: `backend/Dockerfile` bakes dependencies into `/opt/venv` but references `/app/backend/entrypoint.sh`, which is not committed. Supply your own entrypoint (for example, copy `backend/pm2-start.sh`) before attempting to build images.
- Deployment helpers under `deploy/do/` (Caddy reverse proxy + docker-compose) are examples only. They do not provision TLS certificates, secrets, or database migrations.

## Electron Renderer, Workspaces, and Analysis Flow

- The renderer lives under `src/renderer/` and is organized by service (`services/analysis`, `services/backend`, `services/notebook`, etc.), contexts (`context/AppContext.tsx`), and components (`components/Chat`, `components/MainContent`, `components/Sidebar`).
- Workspaces: when you select a folder, Axon watches it for file changes, manages `.axon` metadata, and spins up a Jupyter server inside a per-workspace virtual environment (see `src/main/main.ts` and `JupyterService`).
- Jupyter execution happens through `window.electronAPI.executeJupyterCode` and `src/main/services/JupyterService.ts`. Kernels are created on-demand; at the moment there is no persistence across app launches.
- Analysis/LLM orchestration (e.g., `AutonomousAgent`, `AnalysisOrchestrationService`) largely depends on backend endpoints for search, planning, and code generation. Until those endpoints return real data, the chat/analysis panel is primarily UI scaffolding.
- Authentication via Firebase is optional and only partially wired: the renderer checks env vars, but the backend route `POST /auth/google` is untested in production.

## Deployment & Packaging Status

- **Electron builds:** `npm run package` uses `electron-builder` to emit DMG/ZIP (macOS), NSIS/ZIP (Windows), and AppImage/DEB (Linux) into `release/`. Codesigning, auto-update hosting, and notarization are out of scope.
- **Backend containers:** `deploy/do/docker-compose.yml` runs the API container plus Caddy for TLS termination. There is no image for the renderer, no worker scaling, and secrets must be injected manually.
- **PM2:** `backend/pm2-ecosystem.config.js` + `backend/pm2-start.sh` are handy for a single VM, but you must manage Python virtual environments, `.env`, and Prisma migrations yourself.

## Known Gaps / TODOs

- Wire the renderer's backend client (`src/renderer/services/backend/BackendClient.ts`) to the FastAPI server in a way that does not rely on placeholder APIs like `bioragQuery`.
- Add a real backend entrypoint for the Dockerfile, publish versioned images, and document how to deploy both Electron (packaged installers) and backend (container/VM).
- Provide a checked-in `.env.example` (currently missing) and document all env vars in one place.
- Implement authentication + authorization end to end (Firebase in renderer, `POST /auth/google` + Prisma `User` model in backend).
- Expand test coverage (backend unit tests, renderer integration tests, smoke tests for the CLI and FastAPI routes).
- Automate CellxCensus dataset caching, error handling, and version pinning (currently `TODO` in `cellxcensus_search.py`).

## License

This project is distributed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license. See `LICENSE` for details, including the non-commercial and share-alike requirements. Contact the maintainers if you require a commercial license.
