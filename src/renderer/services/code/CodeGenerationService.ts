import { BackendClient } from "../backend/BackendClient";
import { EventManager } from "../../utils/EventManager";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationErrorEvent,
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
import { extractPythonCode as extractPythonCodeUtil } from "../../utils/CodeTextUtils";

export class CodeGenerationService implements ICodeGenerator {
	private backendClient: BackendClient;
	private selectedModel: string;
	private activeGenerations = new Map<
		string,
		{ accumulatedCode: string; startTime: number }
	>();
	private log = Logger.createLogger("codeGenerationService");

	constructor(
		backendClient: BackendClient,
		selectedModel: string = ConfigManager.getInstance().getDefaultModel()
	) {
		this.backendClient = backendClient;
		this.selectedModel = selectedModel;
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
					request.stepIndex
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

		// Get existing imports from global context
		const existingImports = sharedGetExistingImports(request.globalCodeContext);
		const existingImportsList = Array.from(existingImports).join("\n");

		// Build data access context for the analysis step
		const dataAccessContext = this.buildDataAccessContext(request.datasets);

		let context = `Original question: ${request.originalQuestion}
Working directory: ${request.workingDir}
Step index: ${request.stepIndex}

Available datasets (use ONLY these, do NOT invent links):
${datasetInfo}

DATA ACCESS CONTEXT - IMPORTANT:
${dataAccessContext}

Dataset handling constraints:
- Data files should already exist from previous loading steps
- Use the data loading helpers provided below to access datasets consistently
- For missing data, print clear messages and continue with available datasets
- Add robust error handling with try-except blocks

General requirements:
- Use proper error handling with try-except blocks
- Add progress print statements
- Save outputs to appropriate directories (results/, figures/)
- Handle missing or corrupted data gracefully
- Use robust data validation
- Follow Python best practices`;

		// Add global code context from entire conversation if available
		if (request.globalCodeContext && request.globalCodeContext.trim()) {
			context += `\n\n⚠️  CRITICAL: The following code has already been generated. DO NOT repeat any of it! ⚠️\n\nPREVIOUSLY GENERATED CODE FROM ENTIRE CONVERSATION:\n\n\`\`\`python\n${request.globalCodeContext}\n\`\`\`\n\nIMPORTANT: Do not repeat imports or setup code that was already generated. Focus only on the new functionality for this step.`;
		}

		if (request.previousCode && request.previousCode.trim()) {
			context += `\n\nPreviously generated code (DO NOT REPEAT IMPORTS OR SETUP):\n\`\`\`python\n${request.previousCode}\n\`\`\`\n\nIMPORTANT: Do not repeat imports or setup code that was already generated. Focus only on the new functionality for this step.`;
		}

		return context;
	}

	/**
	 * Build enhanced context and augment with Scanpy RAG snippets (version-aware docstrings)
	 */
	private async buildEnhancedContextWithDocs(
		request: CodeGenerationRequest
	): Promise<string> {
		let context = this.buildEnhancedContext(request);
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

		// Emit generation started event
		EventManager.dispatchEvent("code-generation-started", {
			stepId,
			stepDescription: request.stepDescription,
			timestamp,
		} as CodeGenerationStartedEvent);

		return await this.generateDataDrivenStepCodeStream(request, stepId);
	}

	private async generateDataDrivenStepCodeStream(
		request: CodeGenerationRequest,
		stepId: string
	): Promise<CodeGenerationResult> {
		this.log.debug("stream: start %s (%s)", request.stepDescription, stepId);

		try {
			// Prepare enhanced context with more detailed information + Scanpy RAG
			const enhancedContext = await this.buildEnhancedContextWithDocs(request);

			this.log.debug(
				"stream: enhanced context length=%d",
				enhancedContext.length
			);
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

				// Emit chunk event (include cleaned accumulatedCode)
				EventManager.dispatchEvent("code-generation-chunk", {
					stepId,
					stepDescription: request.stepDescription,
					chunk,
					accumulatedCode: generation.accumulatedCode,
					timestamp: Date.now(),
				} as CodeGenerationChunkEvent);
			};

			const result = await this.backendClient.generateCodeStream(
				{
					task_description: request.stepDescription,
					language: "python",
					context: enhancedContext,
					model: ConfigManager.getInstance().getDefaultModel(),
				},
				chunkCallback
			);

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
					request.stepIndex
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
			return this.generateDataDrivenStepCodeFallback(request, stepId);
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
			const result = await this.backendClient.generateCodeFix({
				prompt: request.stepDescription,
				model: this.selectedModel,
				max_tokens: 2000,
				temperature: 0.1,
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
				request.stepIndex
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
		// Fallback code generation when LLM is not available
		let code = `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

print(f"Executing step ${stepIndex + 1}: ${stepDescription}")

# TODO: Implement ${stepDescription}
# This is a placeholder implementation

print("Step completed successfully!")
`;

		// Let CodeQualityService handle import deduplication

		return code;
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");

		// Respect constraint: do NOT download in this step; prefer localPath if provided
		let datasetLoadingCode = [
			"from pathlib import Path",
			"data_dir = Path('data')",
			"data_dir.mkdir(exist_ok=True)",
			...datasets
				.map((dataset) => {
					const url: string | undefined = (dataset as any).url;
					const localPath: string | undefined = (dataset as any).localPath;
					const title = dataset.title || dataset.id;
					if (localPath) {
						return `print(f"Using local dataset: ${title} -> ${localPath}")\nlocal_path = Path(r"${localPath}")\nif not local_path.exists():\n    print(f"Warning: local path not found for ${title}: ${localPath}")`;
					}
					if (!url) {
						return `print("No URL or localPath for dataset: ${title}")`;
					}
					return `# URL provided for ${title} but downloads are disabled in this step\nprint("Skipping download for ${title}; use localPath if available.")`;
				})
				.filter(Boolean),
		].join("\n");

		let code = `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os

print(f"Executing step ${stepIndex + 1}: ${stepDescription}")
print(f"Working with datasets: ${datasetIds}")

${datasetLoadingCode}

# TODO: Implement ${stepDescription} with loaded datasets
# This is a placeholder implementation

print("Step completed successfully!")
`;

		// Let CodeQualityService handle import deduplication

		return code;
	}

	/**
	 * Build context about how to access previously loaded data
	 */
	private buildDataAccessContext(datasets: Dataset[]): string {
		const lines: string[] = [];
		
		// Check for remote datasets (downloaded to data_dir)
		const remoteDatasets = datasets.filter((d: any) => 
			Boolean((d as any).url) && !Boolean((d as any).localPath)
		);
		
		// Check for local datasets (referenced via localPath)
		const localDatasets = datasets.filter((d: any) => 
			Boolean((d as any).localPath)
		);

		lines.push("Previous data loading steps have prepared the following data access patterns:");
		lines.push("");

		if (remoteDatasets.length > 0) {
			lines.push("## DOWNLOADED DATA (from URLs):");
			lines.push("- Location: data_dir = Path('data')");
			lines.push("- Access pattern:");
			lines.push("  ```python");
			lines.push("  from pathlib import Path");
			lines.push("  data_dir = Path('data')");
			lines.push("  ");
			
			remoteDatasets.forEach(dataset => {
				const datasetId = dataset.id;
				const url = (dataset as any).url || "";
				const format = this.detectDataFormat(url);
				const filename = this.generateFilename(url, datasetId);
				
				lines.push(`  # Dataset: ${dataset.title || datasetId}`);
				lines.push(`  ${datasetId}_path = data_dir / '${filename}'`);
				lines.push(`  if ${datasetId}_path.exists():`);
				
				if (format === 'h5ad') {
					lines.push(`      import anndata`);
					lines.push(`      ${datasetId} = anndata.read_h5ad(${datasetId}_path)`);
				} else if (format === 'csv') {
					lines.push(`      import pandas as pd`);
					lines.push(`      ${datasetId} = pd.read_csv(${datasetId}_path)`);
				} else if (format === 'tsv') {
					lines.push(`      import pandas as pd`);
					lines.push(`      ${datasetId} = pd.read_csv(${datasetId}_path, sep='\\t')`);
				} else {
					lines.push(`      import pandas as pd`);
					lines.push(`      ${datasetId} = pd.read_csv(${datasetId}_path)  # Auto-detect format`);
				}
				lines.push(`  else:`);
				lines.push(`      print(f"Warning: {datasetId} not found at {${datasetId}_path}")`);
				lines.push("  ");
			});
			
			lines.push("  ```");
			lines.push("");
		}

		if (localDatasets.length > 0) {
			lines.push("## LOCAL DATA - ALREADY LOADED IN VARIABLES:");
			lines.push("- Previous cells have already loaded local datasets directly into variables");
			lines.push("- Data is immediately available for analysis - no path manipulation needed");
			lines.push("- SIMPLY USE the dataset variables that are already loaded");
			lines.push("");
			lines.push("### AVAILABLE DATASET VARIABLES:");
			lines.push("  ```python");
			lines.push("  # These variables are already loaded and ready to use:");
			
			localDatasets.forEach(dataset => {
				const datasetId = dataset.id;
				lines.push(`  # ${dataset.title || datasetId} -> variable: ${datasetId}`);
				lines.push(`  # Type: AnnData object (for single-cell) or DataFrame (for tabular)`);
				lines.push(`  print(f"Dataset {datasetId} shape: {${datasetId}.shape if ${datasetId} is not None else 'Not loaded'}")`);
				lines.push("  ");
			});
			
			lines.push("  ```");
			lines.push("");
			lines.push("### CRITICAL INSTRUCTIONS:");
			lines.push("- Dataset variables are already loaded - just use them directly");
			lines.push("- No need to load data again or construct paths");
			lines.push("- Check if variable is not None before using");
			lines.push("- Example: Use `example_data.obs` instead of loading from paths");
			lines.push("");
		}

		if (datasets.length > 0) {
			const hasLocal = localDatasets.length > 0;
			const hasRemote = remoteDatasets.length > 0;
			lines.push("CRITICAL REQUIREMENTS:");
			if (hasLocal) {
				lines.push("1. LOCAL DATA: Dataset variables are already loaded and ready to use directly");
			}
			if (hasRemote) {
				lines.push("2. REMOTE DATA: Use ONLY data_dir / filename pattern for downloaded data (do not re-download)");
				lines.push("   If a file is missing, print a clear warning and continue.");
				lines.push("   Do NOT assume variables exist for remote data unless CONTEXT says so.");
			}
			lines.push("3. FORBIDDEN: Any path construction like 'data/local-*' or hardcoded absolute paths");
			if (hasLocal) {
				lines.push("4. FORBIDDEN: Trying to load local datasets again — they're already loaded");
				lines.push("5. REQUIRED: Use the dataset variables that are already available (local only)");
				lines.push("6. REMINDER: Previous cells already loaded your local datasets into variables");
			}
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
		fixedCode?: string
	): void {
		EventManager.dispatchEvent("code-validation-error", {
			stepId,
			errors,
			warnings,
			originalCode,
			fixedCode,
			timestamp: Date.now(),
		} as CodeValidationErrorEvent);
	}

	/**
	 * Method to emit validation success as an event
	 */
	emitValidationSuccess(stepId: string, message?: string, code?: string): void {
		EventManager.dispatchEvent("code-validation-success", {
			stepId,
			message: message || "No linter errors found",
			code,
			timestamp: Date.now(),
		});
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
