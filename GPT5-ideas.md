Reliability and performance
Increase Jupyter/WebSocket resilience controls in Settings (timeouts, retries, backoff) instead of env-only
File indexing: background indexer + watcher for workspace mentions (debounced, cancellable) to remove synchronous scans
Streamlined rendering: virtualize long chat/message lists and lazy-load heavy blocks
Caching: memoize CellxCensus metadata and search results with TTL; warm cache on idle

Dataset search and curation
Faceted filters in dataset modal (organism, tissue, disease, platform, size)
Quick preview: sample counts, variables, small schema, and a link to open in a viewer
Favorites/pins and recent searches; export/import selected dataset sets
Multi-source search (SRA/ENA, ArrayExpress, Synapse, UCSC Cell Browser) via a pluggable datasource API

Notebook and code UX
Safe “Apply edit” flow with one-click Undo; inline diff viewer for cells
Execution status per cell with elapsed time, run queue, and a “Run all/next” control strip
Inline rich outputs (plots, tables) with expand/collapse and export to file
Code templates/snippets for common workflows (QC, clustering, DE, enrichment)

Environment and reproducibility
Deterministic envs (uv/pip-tools/conda-lock) and one-click “Rebuild exact environment”
GPU support detection and optional CUDA toolchain setup
Workspace manifest (datasets, versions, env lockfile) for fully reproducible exports
Optional Docker runner backend for fully isolated execution

Integrations and analysis
Built-in scanpy/Seurat pipelines with parameter forms and generated notebooks
Gene set enrichment and ontology-backed annotations (HGNC, DOID, Cell Ontology)
Interactive embeddings/cluster viewer (UMAP/TSNE) and cell-type labeling aids
Lightweight “open in cellxgene” or panel for exploring h5ad

Collaboration and versioning
Git integration: commit notebooks, diffs, and env files; branch per analysis
Shareable analysis bundle (zip) with manifest and a small viewer
Comment threads on messages/cells; export transcripts with code blocks
Security and privacy
Sandboxed code execution with workspace-scoped file permissions
Secrets management for tokens/keys; redact in logs by default
Network policy toggles (offline mode, allowlist)

Configuration and observability
Settings UI for timeouts, retry/backoff, search limits, logging levels
Opt-in telemetry/crash reporting; local logs viewer with “copy diagnostics”
Health panel for backend/Jupyter/kernel status and quick fixes

UI/UX polish
Command Palette (⌘K) for actions (search, run, open, settings)
Onboarding tour and “sample project” workspace
Accessibility: high-contrast theme, font scaling, keyboard-first navigation

Testing and release
E2E tests (Playwright) for search → select → generate → run flow
CI for lint/test/build on all platforms; auto-update with notarized builds
Load/perf tests for large workspaces and long chats
These additions will improve stability, speed, clarity, and trust—and make common analyses far faster for users.
