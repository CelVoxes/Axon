import { BackendClient } from "./BackendClient";
import { EventManager } from "../utils/EventManager";
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
} from "./types";
import { ConfigManager } from "./ConfigManager";

export class CodeGenerationService implements ICodeGenerator {
	private backendClient: BackendClient;
	private selectedModel: string;
	private activeGenerations = new Map<
		string,
		{ accumulatedCode: string; startTime: number }
	>();

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
		console.log(
			"🎯 CodeGenerationService: generateCode for:",
			request.stepDescription
		);

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
	 */
	private generateFallbackCode(request: CodeGenerationRequest): string {
		const existingImports = this.getExistingImports(request.globalCodeContext);

		switch (request.fallbackMode) {
			case "basic":
				return this.generateBasicStepCode(
					request.stepDescription,
					request.stepIndex,
					existingImports
				);
			case "timeout-safe":
				return this.generateTimeoutSafeCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex,
					existingImports
				);
			case "data-aware":
			default:
				return this.generateDataAwareBasicStepCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex,
					existingImports
				);
		}
	}

	/**
	 * @deprecated Use generateCode() instead
	 * Main method for generating code with event-driven streaming
	 * This replaces all the complex callback management
	 */
	async generateCodeWithEvents(
		request: CodeGenerationRequest,
		stepId: string
	): Promise<CodeGenerationResult> {
		console.log(
			"🎯 CodeGenerationService: generateCodeWithEvents for:",
			request.stepDescription
		);

		return await this.generateDataDrivenStepCodeWithEvents(request, stepId);
	}

	/**
	 * Extract imports from code string
	 */
	private extractImports(code: string): Set<string> {
		const imports = new Set<string>();
		const lines = code.split("\n");

		for (const line of lines) {
			const trimmedLine = line.trim();
			// Match various import patterns
			if (
				trimmedLine.startsWith("import ") ||
				trimmedLine.startsWith("from ") ||
				trimmedLine.match(/^import\s+\w+/)
			) {
				imports.add(trimmedLine);
			}
		}

		return imports;
	}

	/**
	 * Get all imports from global code context
	 */
	private getExistingImports(globalCodeContext?: string): Set<string> {
		const allImports = new Set<string>();

		if (globalCodeContext) {
			const imports = this.extractImports(globalCodeContext);
			imports.forEach((imp) => allImports.add(imp));
		}

		return allImports;
	}

	/**
	 * Remove duplicate imports from code
	 */
	private removeDuplicateImports(
		code: string,
		existingImports: Set<string>
	): string {
		const lines = code.split("\n");
		const filteredLines: string[] = [];

		for (const line of lines) {
			const trimmedLine = line.trim();
			// Check if this line is an import
			if (
				trimmedLine.startsWith("import ") ||
				trimmedLine.startsWith("from ") ||
				trimmedLine.match(/^import\s+\w+/)
			) {
				// Only add if this import doesn't already exist
				if (!existingImports.has(trimmedLine)) {
					filteredLines.push(line);
					existingImports.add(trimmedLine); // Track this new import
				}
			} else {
				// Non-import line, always include
				filteredLines.push(line);
			}
		}

		return filteredLines.join("\n");
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
		const existingImports = this.getExistingImports(request.globalCodeContext);
		const existingImportsList = Array.from(existingImports).join("\n");

		let context = `Original question: ${request.originalQuestion}
Working directory: ${request.workingDir}
Step index: ${request.stepIndex}

Available datasets (use ONLY these, do NOT invent links):
${datasetInfo}

Dataset handling constraints:
		- Data files are already downloaded to ./data by a previous step. Do NOT re-download; only load existing files.
		- Use ONLY the provided dataset URLs above if present. If a dataset has no URL, print a clear message and skip it.
- Create a local data directory (./data) and download files there before loading.
- For format=h5ad: use anndata.read_h5ad on the downloaded file.
- For format=csv/tsv/txt: use pandas read_csv with the appropriate separator.
- Validate HTTP status codes, content-type, and file size before saving.
- Add robust error handling; continue if a specific dataset fails.

Local datasets:
- If localPath is provided, prefer loading from that path instead of downloading.
- For localPath directories that look like 10x MTX (matrix.mtx, barcodes.tsv, features.tsv), use scanpy.read_10x_mtx.

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
		console.log(
			"🎯 CodeGenerationService: Starting streaming for step:",
			request.stepDescription,
			"stepId:",
			stepId
		);

		try {
			// Prepare enhanced context with more detailed information
			const enhancedContext = this.buildEnhancedContext(request);

			console.log(
				"🎯 Enhanced context prepared, length:",
				enhancedContext.length
			);
			console.log(
				"🎯 Making streaming API call to:",
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

				// Update accumulated code
				generation.accumulatedCode += chunk;

				// Emit chunk event
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

			console.log("🎯 Streaming completed!");
			console.log("🎯 Total chunks received:", chunkCount);
			console.log(
				"🎯 Generated code length:",
				generation.accumulatedCode.length
			);
			console.log("🎯 Backend result:", result);

			// Use the accumulated code from chunks, not the result
			const finalGeneratedCode =
				generation.accumulatedCode || result.code || "";

			if (!finalGeneratedCode) {
				console.warn("🎯 WARNING: No code generated from streaming!");
				throw new Error("No code generated from streaming");
			}

			// Clean up any duplicate imports before returning
			const existingImports = this.getExistingImports(
				request.globalCodeContext
			);
			const finalCode = finalGeneratedCode
				? this.removeDuplicateImports(finalGeneratedCode, existingImports)
				: this.generateDataAwareBasicStepCode(
						request.stepDescription,
						request.datasets,
						request.stepIndex,
						existingImports
				  );

			console.log("🎯 Final code length after cleaning:", finalCode.length);

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
			console.error(
				"🎯 CodeGenerationService: Error in streaming method:",
				error
			);
			const message = error instanceof Error ? error.message : String(error);
			console.error("🎯 Error details:", {
				message,
				stack: error instanceof Error ? error.stack : undefined,
				stepDescription: request.stepDescription,
			});

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
			console.log("🎯 Falling back to non-streaming method");
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
		console.log(
			"CodeGenerationService: Using fallback method for step:",
			request.stepDescription
		);

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
		stepIndex: number,
		existingImports?: Set<string>
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

		// Remove duplicate imports if existing imports are provided
		if (existingImports && existingImports.size > 0) {
			code = this.removeDuplicateImports(code, new Set(existingImports));
		}

		return code;
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number,
		existingImports?: Set<string>
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");

		// Simplified: minimal download by dataset id (use provided URL only; never derive)
		let datasetLoadingCode = [
			"from pathlib import Path",
			"import requests",
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
					const filename = url.toLowerCase().endsWith(".h5ad")
						? `${dataset.id}.h5ad`
						: `${dataset.id}.data`;
					return `from pathlib import Path\n_title = "${title}"\n_dest = data_dir / "${filename}"\nif Path(_dest).exists():\n    print("Using existing:", str(_dest))\nelse:\n    print("Downloading:", _title)\n    resp = requests.get("${url}", headers={"User-Agent": "Mozilla/5.0"}, timeout=60)\n    resp.raise_for_status()\n    open(_dest, 'wb').write(resp.content)\n    print("Saved:", str(_dest))`;
				})
				.filter(Boolean),
		].join("\n");

		let code = `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os

print(f"Executing step ${stepIndex + 1}: ${stepDescription}")
print(f"Working with datasets: ${datasetIds}")

${datasetLoadingCode}

# TODO: Implement ${stepDescription} with loaded datasets
# This is a placeholder implementation

print("Step completed successfully!")
`;

		// Remove duplicate imports if existing imports are provided
		if (existingImports && existingImports.size > 0) {
			code = this.removeDuplicateImports(code, new Set(existingImports));
		}

		return code;
	}

	/**
	 * @deprecated Use generateCode() instead
	 * Generate single step code with events (main public method)
	 */
	async generateSingleStepCode(
		request: CodeGenerationRequest,
		stepId?: string
	): Promise<CodeGenerationResult> {
		return this.generateCode({ ...request, stepId });
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

	extractPythonCode(response: string): string | null {
		// Extract Python code from LLM response
		const codeBlockRegex = /```(?:python)?\s*([\s\S]*?)```/;
		const match = response.match(codeBlockRegex);

		if (match) {
			return match[1].trim();
		}

		// If no code block, check if the entire response looks like code
		const lines = response.split("\n");
		const codeIndicators = [
			"import ",
			"def ",
			"class ",
			"print(",
			"pd.",
			"np.",
			"plt.",
		];
		const hasCodeIndicators = codeIndicators.some((indicator) =>
			lines.some((line) => line.trim().startsWith(indicator))
		);

		if (hasCodeIndicators) {
			return response.trim();
		}

		return null;
	}

	/**
	 * Generate extra-safe minimal code for timeout scenarios
	 */
	private generateTimeoutSafeCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number,
		existingImports?: Set<string>
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

		// Remove duplicate imports if existing imports are provided
		if (existingImports && existingImports.size > 0) {
			code = this.removeDuplicateImports(code, new Set(existingImports));
		}

		return code;
	}

	// @deprecated - Use generateCode() instead
	// Public wrapper methods for fallback code generation
	public generateBasicStepCodePublic(
		stepDescription: string,
		stepIndex: number,
		globalCodeContext?: string
	): string {
		const existingImports = this.getExistingImports(globalCodeContext);
		return this.generateBasicStepCode(
			stepDescription,
			stepIndex,
			existingImports
		);
	}

	// @deprecated - Use generateCode() instead
	public generateDataAwareBasicStepCodePublic(
		stepDescription: string,
		datasets: any[],
		stepIndex: number,
		globalCodeContext?: string
	): string {
		const existingImports = this.getExistingImports(globalCodeContext);
		return this.generateDataAwareBasicStepCode(
			stepDescription,
			datasets,
			stepIndex,
			existingImports
		);
	}

	// @deprecated - Use generateCode() instead
	public generateTimeoutSafeCodePublic(
		stepDescription: string,
		datasets: any[],
		stepIndex: number,
		globalCodeContext?: string
	): string {
		const existingImports = this.getExistingImports(globalCodeContext);
		return this.generateTimeoutSafeCode(
			stepDescription,
			datasets,
			stepIndex,
			existingImports
		);
	}
}
