import { BackendClient } from "../backend/BackendClient";
import { EventManager } from "../../utils/EventManager";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationErrorEvent,
	CodeValidationSuccessEvent,
	CodeValidationTimings,
	CodeGenerationRequest,
	CodeGenerationResult,
	Dataset,
	ICodeGenerator,
} from "../types";
import { ConfigManager } from "../backend/ConfigManager";
import {
	getExistingImports as sharedGetExistingImports,
	removeDuplicateImports as sharedRemoveDuplicateImports,
} from "../../utils/ImportUtils";
import { Logger } from "../../utils/Logger";
import { ScanpyDocsService } from "../backend/ScanpyDocsService";
import {
	extractPythonCode as extractPythonCodeUtil,
	stripCodeFences,
} from "../../utils/CodeTextUtils";
import { buildDatasetSnapshot } from "../tools/DataSnapshotService";

export class CodeGenerationService implements ICodeGenerator {
	private backendClient: BackendClient;
	private selectedModel: string;
	private sessionOverride?: string;
	private activeGenerations = new Map<
		string,
		{ accumulatedCode: string; startTime: number }
	>();
	private log = Logger.createLogger("codeGenerationService");
	private static HEAVY_CTX_KEY_PREFIX = "axon.codegen.heavyctx.seeded.";

	private isHeavyContextSeeded(sessionId: string): boolean {
		try {
			const key = CodeGenerationService.HEAVY_CTX_KEY_PREFIX + sessionId;
			return localStorage.getItem(key) === "1";
		} catch (_) {
			return false;
		}
	}

	private markHeavyContextSeeded(sessionId: string): void {
		try {
			const key = CodeGenerationService.HEAVY_CTX_KEY_PREFIX + sessionId;
			localStorage.setItem(key, "1");
		} catch (_) {}
	}

	constructor(
		backendClient: BackendClient,
		selectedModel: string = ConfigManager.getInstance().getDefaultModel(),
		sessionOverride?: string
	) {
		this.backendClient = backendClient;
		this.selectedModel = selectedModel;
		this.sessionOverride = sessionOverride;
	}

	public getSessionIdForPath(workingDir?: string): string {
		if (this.sessionOverride && this.sessionOverride.trim()) {
			const scoped = this.backendClient.scopeSessionId(
				this.sessionOverride
			);
			if (scoped) return scoped;
		}
		const wd = (workingDir || "").trim();
		return this.backendClient.buildSessionId(wd || undefined);
	}

	private buildSessionId(request: CodeGenerationRequest): string {
		const scopedOverride =
			this.sessionOverride && this.sessionOverride.trim()
				? this.backendClient.scopeSessionId(this.sessionOverride)
				: undefined;
		const sessionId =
			scopedOverride ||
			this.backendClient.buildSessionId(
				(request.workingDir || "").trim() || undefined
			);
		console.log(`🔧 CodeGenerationService: Using session ID: ${sessionId}`);
		return sessionId;
	}

	// --- Path utilities for robust data_dir resolution ---
	private normalizePath(p?: string | null): string {
		if (!p) return "";
		let s = String(p);
		// Normalize slashes and trim
		s = s.replace(/\\/g, "/");
		s = s.replace(/\/+$/g, "");
		return s;
	}

	private dirname(p: string): string {
		const s = this.normalizePath(p);
		const idx = s.lastIndexOf("/");
		return idx > 0 ? s.slice(0, idx) : s;
	}

	private commonAncestor(paths: string[]): string | null {
		if (!paths || paths.length === 0) return null;
		const parts = paths
			.map((p) => this.normalizePath(p).split("/").filter(Boolean))
			.filter((arr) => arr.length > 0);
		if (parts.length === 0) return null;
		let i = 0;
		while (true) {
			const token = parts[0][i];
			if (!token) break;
			if (!parts.every((arr) => arr[i] === token)) break;
			i++;
		}
		if (i === 0) return "/"; // no common prefix beyond root
		return parts[0].slice(0, i).join("/") || "/";
	}

	private relativePath(from: string, to: string): string {
		const fromParts = this.normalizePath(from).split("/").filter(Boolean);
		const toParts = this.normalizePath(to).split("/").filter(Boolean);
		let i = 0;
		while (
			i < fromParts.length &&
			i < toParts.length &&
			fromParts[i] === toParts[i]
		) {
			i++;
		}
		const up = fromParts.slice(i).map(() => "..");
		const down = toParts.slice(i);
		const rel = [...up, ...down].join("/") || ".";
		return rel.startsWith(".") ? rel : `./${rel}`;
	}

	private computeRecommendedDataDir(
		datasets: any[],
		workingDir?: string
	): { path?: string; isRelative?: boolean } {
		try {
			const dirs: string[] = [];
			for (const d of datasets || []) {
				const lp: string | undefined = (d as any)?.localPath;
				if (!lp) continue;
				const norm = this.normalizePath(lp);
				// If it's a file, use its parent directory; else assume directory
				const dir = /\.[A-Za-z0-9]+$/.test(norm) ? this.dirname(norm) : norm;
				dirs.push(dir);
			}
			if (dirs.length === 0) return {};
			const common = this.commonAncestor(dirs) || dirs[0];
			if (workingDir) {
				const rel = this.relativePath(workingDir, common);
				return { path: rel, isRelative: true };
			}
			return { path: common, isRelative: false };
		} catch (_) {
			return {};
		}
	}

	setModel(model: string) {
		this.selectedModel = model;
	}

	/**
	 * UNIFIED CODE GENERATION METHOD
	 * Handles all code generation scenarios with proper import deduplication
	 */
	async generateCode(
		request: CodeGenerationRequest
	): Promise<CodeGenerationResult> {
		this.log.info("generateCode: %s", request.stepDescription);

		const stepId =
			request.stepId ||
			`step-${request.stepIndex}-${Date.now()}-${Math.random()
				.toString(36)
				.substr(2, 9)}`;

		try {
			// Try LLM-based generation first (unless fallback mode is specified)
			if (!request.fallbackMode) {
				const result = await this.generateDataDrivenStepCodeWithEvents(
					request,
					stepId
				);
				return result;
			}

			// Use fallback mode
			const fallbackCode = this.generateFallbackCode(request);
			return {
				code: fallbackCode,
				success: true,
			};
		} catch (error) {
			console.error("🎯 LLM generation failed, using fallback:", error);

			// Determine appropriate fallback mode
			const isTimeoutRelated =
				error instanceof Error &&
				error.message.toLowerCase().includes("timeout");
			const effectiveFallbackMode =
				request.fallbackMode ||
				(isTimeoutRelated ? "timeout-safe" : "data-aware");

			const fallbackCode = this.generateFallbackCode({
				...request,
				fallbackMode: effectiveFallbackMode,
			});

			return {
				code: fallbackCode,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Generate fallback code based on the specified mode
	 * CodeQualityService will handle import deduplication and enhancements
	 */
	private generateFallbackCode(request: CodeGenerationRequest): string {
		switch (request.fallbackMode) {
			case "basic":
				return this.generateBasicStepCode(
					request.stepDescription,
					request.stepIndex
				);
			case "timeout-safe":
				return this.generateTimeoutSafeCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex
				);
			case "data-aware":
			default:
				return this.generateDataAwareBasicStepCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex,
					request.workingDir
				);
		}
	}

	private buildEnhancedContext(request: CodeGenerationRequest): string {
		// Provide rich, actionable dataset context (IDs, titles, organisms, sources, URLs, formats)
		const datasetInfo = request.datasets
			.map((d) => {
				const url = (d as any).url || "";
				const source = (d as any).source || "Unknown";
				const localPath = (d as any).localPath || "";
				const isLocal = !!localPath;
				const format = url
					? url.toLowerCase().endsWith(".h5ad")
						? "h5ad"
						: url.toLowerCase().endsWith(".csv")
						? "csv"
						: url.toLowerCase().endsWith(".tsv")
						? "tsv"
						: url.toLowerCase().endsWith(".txt")
						? "txt"
						: "unknown"
					: (d as any).fileFormat || (isLocal ? "local" : "unknown");
				const sampleCount = (d as any).sample_count;
				const sampleStr =
					sampleCount !== undefined && sampleCount !== null
						? `, samples/cells: ${sampleCount}`
						: "";
				return `- id: ${d.id}
  title: ${d.title || "Unknown"}
  organism: ${d.organism || "Unknown"}
  source: ${source}
  url: ${url || "(none provided)"}
  localPath: ${localPath || "(none)"}
  format: ${format}${sampleStr}`;
			})
			.join("\n\n");

		// Get existing imports from global context (or empty if not provided)
		const existingImports = sharedGetExistingImports(
			request.globalCodeContext || ""
		);
		const existingImportsList = Array.from(existingImports).join("\n");

		// Build data access context for the analysis step
		const dataAccessContext = this.buildDataAccessContext(request.datasets);

		let context = `Original question: ${request.originalQuestion}
Working directory: ${request.workingDir}
Step index: ${request.stepIndex}

Available datasets (use ONLY these, do NOT invent links):
${datasetInfo}

DATA ACCESS CONTEXT - IMPORTANT (concise):
${dataAccessContext}

Dataset handling constraints:
- Data files should already exist from previous loading steps
- Use data_dir consistently; do not re-download
- If a needed file is missing, raise FileNotFoundError with a short message (do not add broad try/except)

General requirements (concise):
- Keep code short and readable; minimal comments
- Limit prints to at most 1–2 lines
- Save outputs to results/ and figures/
- Avoid boilerplate and unnecessary wrappers
- Follow Python best practices`;

		// Will optionally add global scaling guidance later for non single-cell tasks

		// Runtime budget guidance to prevent timeouts on large datasets
		context += `\n\nRUNTIME AND CHUNKING (prevent timeouts on large data):\n- Keep each cell under ~60–90 seconds of runtime; if work exceeds this, split into additional cells.\n- Process large folders/files in CHUNKS/BATCHES (e.g., per-file loops with intermediate CSV/parquet outputs under results/tmp/).\n- For CSV bundles: sample first to profile; then batch-process files (e.g., 2–4 at a time), writing partial outputs and a manifest to resume.\n- For UMAP: fit on a subset (50k–200k), then transform the rest in batches; persist embeddings to disk.\n- Always save intermediate artifacts (results/) so subsequent cells resume instead of redoing heavy work.`;

		// Don't add massive global code context - let Responses API handle memory
		// Only add minimal import context if available
		if (request.globalCodeContext && request.globalCodeContext.trim()) {
			// Extract just the imports instead of sending all code
			const existingImports = sharedGetExistingImports(
				request.globalCodeContext
			);
			if (existingImports.size > 0) {
				const importList = Array.from(existingImports).join("\n");
				context += `\n\n⚠️  NOTE: Previously used imports from conversation context:\n\n\`\`\`python\n${importList}\n\`\`\`\n\nDo not repeat these imports unless absolutely necessary.`;
			}
		}

		if (request.previousCode && request.previousCode.trim()) {
			context += `\n\nPreviously generated code (for reference):\n\`\`\`python\n${request.previousCode}\n\`\`\`\n\nInclude minimal required imports at the top of this cell; do not rely on prior cells being executed.`;
		}

		return context;
	}

	/**
	 * Build enhanced context and augment with Scanpy RAG snippets (version-aware docstrings)
	 */
	private async buildEnhancedContextWithDocs(
		request: CodeGenerationRequest,
		lean: boolean = false
	): Promise<string> {
		let context = this.buildEnhancedContext(request);

		// Detect spectral flow cytometry datasets
		const isSpectralFlow =
			Array.isArray(request.datasets) &&
			request.datasets.some(
				(d: any) =>
					String(d?.dataType || "").toLowerCase() === "spectral_flow_cytometry"
			);

		// Append a concise snapshot of local datasets (data_dir) to inform loader choice (first heavy seed only)
		if (!lean) {
			try {
				const localDatasets = (request.datasets || []).filter((d: any) =>
					Boolean((d as any).localPath)
				);
				if (localDatasets.length > 0) {
					const snapshot = await buildDatasetSnapshot(
						localDatasets as any,
						request.workingDir
					);
					if (snapshot && snapshot.trim()) {
						context += `\n\nFolder snapshot (for local mentions; use data_dir):\n${snapshot}`;
						context += `\n\nGuidance: Decide how to load based on snapshot and file extensions/markers. For *.csv/*.tsv bundles, iterate files via a glob, add a 'sample' column and concatenate into one table. Do not assume pre-defined helpers.`;
						context += `\n\nIf a directory contains multiple CSV/TSV files: iterate them (use glob), load appropriately (R: readr::read_csv/read_tsv; Python: pandas.read_csv), align columns, add a 'sample' column from filename, and concatenate into one table.`;
						if (!isSpectralFlow) {
							context += `\nFor flow/spectral cytometry-like data: First detect existing scaling and compensation.\n- Detect arcsinh/logicle/z-scored data by inspecting column names (e.g., 'arcsinh', 'asinh', 'logicle', 'normalized') and value distributions.\n  Heuristics: if many values are negative and 95th percentile < ~20 per marker, likely already arcsinh/logicle; if 99th percentile >> 1e4 and non-negative, likely raw.\n- Only apply arcsinh (cofactor≈5) if raw intensities; otherwise skip.\n- Respect existing compensation/unmixing; if absent and sidecar matrix present (spill/unmix CSV or FCS $SPILLOVER keyword), apply it before scaling.\n- Then standardize (skip if already standardized), compute neighbors + UMAP (umap-learn), cluster (e.g., DBSCAN/HDBSCAN/KMeans), and plot UMAP colored by cluster and sample.`;
						}
					}
				}
			} catch (_) {
				// Best-effort; snapshot is optional
			}
		}
		// Append tool-specific guidance
		// Spectral flow cytometry will use DatasetManager's implementation details
		if (isSpectralFlow) {
			context += `\n\nSpectral flow cytometry detected - use implementation details provided.`;
		} else {
			// Scanpy RAG guidance for Python single-cell workflows
			if (!lean) {
				try {
					const rag =
						await ScanpyDocsService.getInstance().buildRagContextForRequest(
							request.stepDescription,
							request.originalQuestion,
							request.workingDir
						);
					if (rag && rag.trim()) {
						context += `\n\nAuthoritative Scanpy references (from installed environment):\n${rag}\n\nStrict rules:\n- Prefer APIs present above; do not invent parameters.\n- If an API is not present, adapt to available alternatives.\n- Cite the function names you used.`;
					}
				} catch (e) {
					// Best-effort; silently continue without RAG if unavailable
				}
			}
		}

		// Recommend exact data_dir based on detected local dataset roots vs analysis working directory
		try {
			const rec = this.computeRecommendedDataDir(
				request.datasets || [],
				request.workingDir
			);
			if (rec && rec.path) {
				const wd = String(request.workingDir || "");
				context += `\n\nDATA_DIR RESOLUTION:\n- Analysis working directory: ${wd}\n- Local dataset root: ${
					rec.path
				} ${
					rec.isRelative ? "(relative)" : "(absolute)"
				}\n- Use appropriate data loading functions for the detected file formats.`;
			}
		} catch (_) {}

		// Domain-specific constraints to reduce brittle code paths (concise style)
		try {
			const text = `${request.stepDescription || ""}\n${
				request.originalQuestion || ""
			}`.toLowerCase();
			// Heuristic detection of single-cell RNA-seq
			// 1) Text-based cues (user question/step)
			let isSingleCell =
				/\b(single\s*-?cell|scrna|scanpy|anndata|h5ad|cellxgene|census|10x|matrix\.mtx)\b/.test(
					text
				);
			const textCue = isSingleCell;
			// 2) Dataset-based cues (URLs, directory metadata, dataset fields)
			try {
				if (Array.isArray(request.datasets)) {
					const ds = request.datasets as any[];
					const hasH5ad = ds.some(
						(d) =>
							typeof (d as any)?.url === "string" &&
							(d as any).url.toLowerCase().endsWith(".h5ad")
					);
					const hasTenxMeta = ds.some((d) => {
						const dir = (d as any)?.directory;
						const contains: string[] | undefined = Array.isArray(dir?.contains)
							? dir.contains
							: undefined;
						const tenx = dir?.tenx;
						const containsTenx =
							Array.isArray(contains) &&
							contains.some((name) =>
								/matrix\.mtx|features\.(tsv|gz)|genes\.tsv|barcodes\.(tsv|gz)/i.test(
									String(name)
								)
							);
						const tenxFlags =
							tenx && (tenx.matrix_mtx || tenx.features_genes || tenx.barcodes);
						// Path hints (common 10x folder names)
						const p = String((d as any)?.localPath || "");
						const pathHint = /filtered_feature_bc_matrix/i.test(p);
						return Boolean(containsTenx || tenxFlags || pathHint);
					});
					const dataTypeFlag = ds.some((d) => {
						const t = String((d as any)?.dataType || "").toLowerCase();
						return (
							t.includes("single_cell") ||
							t.includes("singlecell") ||
							t.includes("scrna")
						);
					});
					const platform10x = ds.some((d) =>
						String((d as any)?.platform || "")
							.toLowerCase()
							.includes("10x")
					);
					const fileFormat10x = ds.some((d) =>
						String((d as any)?.fileFormat || "")
							.toLowerCase()
							.includes("10x")
					);
					isSingleCell =
						isSingleCell ||
						hasH5ad ||
						hasTenxMeta ||
						dataTypeFlag ||
						platform10x ||
						fileFormat10x;
					try {
						(this as any).log?.debug?.("scRNA-seq detection", {
							textCue,
							hasH5ad,
							hasTenxMeta,
							dataTypeFlag,
							platform10x,
							fileFormat10x,
							result: isSingleCell,
						});
					} catch (_) {}
				}
			} catch (_) {}
			const isFlow = /\b(flow|cytometry|fcs|spillover|unmix|compensat)\b/.test(
				text
			);
			const isSpectralFlow =
				Array.isArray(request.datasets) &&
				request.datasets.some(
					(d: any) =>
						String(d?.dataType || "").toLowerCase() ===
						"spectral_flow_cytometry"
				);

			// Check if we have implementation details from DatasetManager plan
			if (request.implementation) {
				// Use implementation details from DatasetManager plan
				context += `\n\nIMPLEMENTATION PLAN FROM DATASET ANALYSIS:
- ${request.stepDescription}: ${request.implementation}

Convert this implementation step into executable Python code.`;
			} else {
				// No implementation details available - let LLM decide based on data types
				context += `\n\nANALYSIS GUIDANCE:
- Use appropriate libraries for the detected data type
- Follow standard analysis practices for this data type
- Ensure reproducible results`;
			}
		} catch {
			/* noop */
		}
		return context;
	}

	// Note: Code cleaning and validation is now handled by CodeQualityService

	private async generateDataDrivenStepCodeWithEvents(
		request: CodeGenerationRequest,
		stepId: string
	): Promise<CodeGenerationResult> {
		const timestamp = Date.now();

		// Initialize tracking for this generation
		this.activeGenerations.set(stepId, {
			accumulatedCode: "",
			startTime: timestamp,
		});

		return await this.generateDataDrivenStepCodeStream(request, stepId);
	}

	private async generateDataDrivenStepCodeStream(
		request: CodeGenerationRequest,
		stepId: string
	): Promise<CodeGenerationResult> {
		this.log.debug("stream: start %s (%s)", request.stepDescription, stepId);
		const sessionId = this.buildSessionId(request);
		const useDirectEdit = Boolean(request.isDirectEdit);

		try {
			// Prepare context and stream request
			this.log.debug(
				"stream: POST %s",
				`${this.backendClient.getBaseUrl()}/llm/code/stream`
			);

			let chunkCount = 0;
			const generation = this.activeGenerations.get(stepId);
			if (!generation) {
				throw new Error(`Generation tracking not found for stepId: ${stepId}`);
			}

			// Create event-based chunk handler
			const chunkCallback = (chunk: string) => {
				chunkCount++;

				// Update accumulated code without aggressive deduplication during streaming
				generation.accumulatedCode += chunk;
				// Sanitize code fences so streamed display and final code are plain Python
				try {
					const cleaned = stripCodeFences(
						generation.accumulatedCode,
						/* preserveWhitespace */ true
					);
					if (cleaned && cleaned !== generation.accumulatedCode) {
						generation.accumulatedCode = cleaned;
					}
				} catch (_) {}

				// Emit chunk event (include cleaned accumulatedCode)
				EventManager.dispatchEvent("code-generation-chunk", {
					stepId,
					stepDescription: request.stepDescription,
					chunk,
					accumulatedCode: generation.accumulatedCode,
					timestamp: Date.now(),
				} as CodeGenerationChunkEvent);
			};

			// Emit generation started event and begin streaming code (reasoning may interleave via code stream)
			EventManager.dispatchEvent("code-generation-started", {
				stepId,
				stepDescription: request.stepDescription,
				timestamp: Date.now(),
			} as CodeGenerationStartedEvent);

			// Removed fallback planning stream: rely solely on model-emitted reasoning

			// Decide target language (R for spectral flow cytometry; Python otherwise)
			const targetLanguage: "python" | "r" =
				Array.isArray(request.datasets) &&
				request.datasets.some(
					(d: any) =>
						String(d?.dataType || "").toLowerCase() ===
						"spectral_flow_cytometry"
				)
					? "r"
					: request.language || "python";

			// Use lean context after the first heavy seed for this session
			const heavySeeded = useDirectEdit
				? true
				: this.isHeavyContextSeeded(sessionId);
			const enhancedContext = useDirectEdit
				? request.globalCodeContext || ""
				: await this.buildEnhancedContextWithDocs(request, heavySeeded);

			const result = await this.backendClient.generateCodeStream(
				{
					task_description: request.stepDescription,
					language: targetLanguage,
					context: enhancedContext,
					model: ConfigManager.getInstance().getDefaultModel(),
					session_id: sessionId,
					...(useDirectEdit ? { direct_edit: true } : {}),
				},
				chunkCallback,
				(reasoningDelta: string) => {
					try {
						EventManager.dispatchEvent("code-generation-reasoning", {
							stepId,
							delta: reasoningDelta,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				},
				(summaryText: string) => {
					try {
						EventManager.dispatchEvent("code-generation-summary", {
							stepId,
							summary: summaryText,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				}
			);

			// Mark heavy context as seeded after first successful generation
			if (!useDirectEdit && !heavySeeded) {
				this.markHeavyContextSeeded(sessionId);
			}

			// Emit a session stats update so UI refreshes immediately
			try {
				const { SessionStatsService } = await import(
					"../backend/SessionStatsService"
				);
				await SessionStatsService.update(this.backendClient, sessionId);
			} catch (_) {}

			this.log.debug(
				"stream: completed, chunks=%d codeLen=%d",
				chunkCount,
				generation.accumulatedCode.length
			);

			// Use the accumulated code from chunks, not the result
			const finalGeneratedCode =
				generation.accumulatedCode || result.code || "";

			if (!finalGeneratedCode) {
				console.warn("🎯 WARNING: No code generated from streaming!");
				throw new Error("No code generated from streaming");
			}

			// Use generated code as-is, let CodeQualityService handle all enhancements
			let finalCode =
				finalGeneratedCode ||
				this.generateDataAwareBasicStepCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex,
					request.workingDir
				);

			this.log.debug("final code length after cleaning=%d", finalCode.length);

			// Emit completion event
			EventManager.dispatchEvent("code-generation-completed", {
				stepId,
				stepDescription: request.stepDescription,
				finalCode,
				success: true,
				timestamp: Date.now(),
			} as CodeGenerationCompletedEvent);

			// Clean up tracking
			this.activeGenerations.delete(stepId);

			return {
				code: finalCode,
				success: true,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.error("stream error: %s", message);

			// Detect user cancellation and avoid fallback generation
			const isAborted =
				(error instanceof Error && error.name === "AbortError") ||
				/abort|aborted|cancel/i.test(message);

			// Emit failure or cancellation event
			EventManager.dispatchEvent("code-generation-failed", {
				stepId,
				stepDescription: request.stepDescription,
				error: isAborted ? "Cancelled by user" : message,
				timestamp: Date.now(),
			} as CodeGenerationFailedEvent);

			// Clean up tracking
			this.activeGenerations.delete(stepId);

			if (isAborted) {
				// Respect user stop; do not attempt fallback
				return { code: "", success: false, error: "Cancelled" };
			}

			// Fallback to non-streaming method
			this.log.warn("falling back to non-streaming method");
			const fb = await this.generateDataDrivenStepCodeFallback(request, stepId);
			try {
				const { SessionStatsService } = await import(
					"../backend/SessionStatsService"
				);
				await SessionStatsService.update(this.backendClient, sessionId);
			} catch (_) {}
			return fb;
		}
	}

	/**
	 * Fallback method when streaming fails
	 */
	private async generateDataDrivenStepCodeFallback(
		request: CodeGenerationRequest,
		stepId: string
	): Promise<CodeGenerationResult> {
		try {
			const isSpectralFlow =
				Array.isArray(request.datasets) &&
				request.datasets.some(
					(d: any) =>
						String(d?.dataType || "").toLowerCase() ===
						"spectral_flow_cytometry"
				);
			const result = await this.backendClient.generateCodeFix({
				prompt: request.stepDescription,
				model: this.selectedModel,
				max_tokens: 2000,
				temperature: 0.1,
				session_id: this.buildSessionId(request),
				...(isSpectralFlow ? { language: "r" } : {}),
			});

			const code = result.code || result.response || "";

			// Emit completion event for fallback
			EventManager.dispatchEvent("code-generation-completed", {
				stepId,
				stepDescription: request.stepDescription,
				finalCode: code,
				success: true,
				timestamp: Date.now(),
			} as CodeGenerationCompletedEvent);

			return {
				code,
				success: true,
			};
		} catch (error) {
			console.error("CodeGenerationService: Error in fallback method:", error);
			const fallbackCode = this.generateDataAwareBasicStepCode(
				request.stepDescription,
				request.datasets,
				request.stepIndex,
				request.workingDir
			);

			// Emit completion event for fallback (still successful, but with fallback code)
			EventManager.dispatchEvent("code-generation-completed", {
				stepId,
				stepDescription: request.stepDescription,
				finalCode: fallbackCode,
				success: false,
				timestamp: Date.now(),
			} as CodeGenerationCompletedEvent);

			return {
				code: fallbackCode,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private generateBasicStepCode(
		stepDescription: string,
		stepIndex: number
	): string {
		// Minimal fallback code when LLM is not available
		let code = `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

print(f"Step ${stepIndex + 1}: ${stepDescription}")
`;

		// Let CodeQualityService handle import deduplication

		return code;
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number,
		workingDir?: string
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");

		// Prefer a recommended data_dir pointing to local dataset roots
		const rec = this.computeRecommendedDataDir(datasets || [], workingDir);
		const recommendedPath = rec && rec.path ? rec.path : "data";
		// Respect constraint: do NOT download in this step; use resolved data_dir
		let datasetLoadingCode = [
			"from pathlib import Path",
			"try:\n    data_dir\nexcept NameError:\n    data_dir = Path('" +
				recommendedPath.replace(/'/g, "\\'") +
				"')",
			"# Only create a directory if using a local 'data' folder",
			"try:\n    if data_dir.name == 'data' and not data_dir.exists():\n        data_dir.mkdir(parents=True, exist_ok=True)\nexcept Exception:\n    pass",
			"print('Using data_dir:', str(data_dir))",
		].join("\n");

		let code = `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os
${datasetLoadingCode}

`;

		// Let CodeQualityService handle import deduplication

		return code;
	}

	/**
	 * Build context about how to access previously loaded data
	 */
	private buildDataAccessContext(datasets: Dataset[]): string {
		const lines: string[] = [];
		const hasRemote = datasets.some(
			(d: any) => Boolean((d as any).url) && !Boolean((d as any).localPath)
		);
		const hasLocal = datasets.some((d: any) => Boolean((d as any).localPath));

		lines.push(
			"Use data_dir as your base path. Decide loaders dynamically from extensions or 10x markers."
		);
		if (hasRemote) {
			lines.push("- Downloaded data is under data_dir = Path('data').");
		}
		if (hasLocal) {
			lines.push(
				"- Local data: set data_dir = Path('<MENTIONED_PATH>') and choose the appropriate loader."
			);
		}
		lines.push("");
		lines.push("CRITICAL REQUIREMENTS:");
		lines.push("1. Use data_dir consistently for all file access.");
		if (hasRemote) {
			lines.push(
				"2. Do not re-download; warn and continue if files are missing."
			);
			lines.push(
				"3. Load once into a variable (e.g., data) and reuse in later cells."
			);
			lines.push("4. Avoid absolute paths; always build from data_dir.");
		} else {
			lines.push(
				"2. Load once into a variable (e.g., data) and reuse in later cells."
			);
			lines.push("3. Avoid absolute paths; always build from data_dir.");
		}

		return lines.join("\n");
	}

	/**
	 * Detect data format from URL
	 */
	private detectDataFormat(url: string | undefined): string {
		const urlLower = (url || "").toLowerCase();
		if (urlLower.endsWith(".h5ad")) return "h5ad";
		if (urlLower.endsWith(".csv")) return "csv";
		if (urlLower.endsWith(".tsv")) return "tsv";
		if (urlLower.endsWith(".txt")) return "txt";
		return "csv"; // default
	}

	/**
	 * Generate consistent filename for downloaded data
	 */
	private generateFilename(url: string | undefined, datasetId: string): string {
		const urlLower = (url || "").toLowerCase();
		if (urlLower.endsWith(".h5ad")) return `${datasetId}.h5ad`;
		if (urlLower.endsWith(".csv")) return `${datasetId}.csv`;
		if (urlLower.endsWith(".tsv")) return `${datasetId}.tsv`;
		if (urlLower.endsWith(".txt")) return `${datasetId}.txt`;
		return `${datasetId}.data`;
	}

	/**
	 * Method to emit validation errors as events
	 */
	emitValidationErrors(
		stepId: string,
		errors: string[],
		warnings: string[],
		originalCode: string,
		fixedCode?: string,
		timings?: CodeValidationTimings
	): void {
		EventManager.dispatchEvent("code-validation-error", {
			stepId,
			errors,
			warnings,
			originalCode,
			fixedCode,
			timings,
			timestamp: Date.now(),
		} as CodeValidationErrorEvent);
	}

	emitValidationPrecheck(
		stepId: string,
		errors: string[],
		warnings: string[],
		code: string,
		timings?: CodeValidationTimings
	): void {
		EventManager.dispatchEvent("code-validation-precheck", {
			stepId,
			errors,
			warnings,
			code,
			timings,
			timestamp: Date.now(),
		});
	}

	/**
	 * Method to emit validation success as an event
	 */
	emitValidationSuccess(
		stepId: string,
		message?: string,
		code?: string,
		warnings?: string[],
		timings?: CodeValidationTimings
	): void {
		const detail: CodeValidationSuccessEvent = {
			stepId,
			message: message || "No linter errors found",
			code,
			warnings: Array.isArray(warnings) ? warnings : [],
			timings,
			timestamp: Date.now(),
		};
		EventManager.dispatchEvent("code-validation-success", detail);
	}

	extractPythonCode(response: string): string | null {
		// Delegate to shared util to avoid duplication
		return extractPythonCodeUtil(response);
	}

	/**
	 * Generate extra-safe minimal code for timeout scenarios
	 */
	private generateTimeoutSafeCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");
		let code = `# Step ${stepIndex + 1}: ${stepDescription} (Safe Mode)
import os
import sys

print(f"Executing step ${stepIndex + 1} in safe mode: ${stepDescription}")

try:
    # Minimal safe implementation
    print("Current working directory:", os.getcwd())
    print("Python version:", sys.version)
    print("Available datasets: ${datasetIds}")
    
    # Just print basic info without complex processing
    print("This step has been simplified to prevent execution timeout")
    print("Step description: ${stepDescription}")
    
except Exception as e:
    print(f"Error: {e}")

print("Safe step completed!")
`;

		// Let CodeQualityService handle import deduplication

		return code;
	}
}
