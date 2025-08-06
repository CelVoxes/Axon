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

export class CodeGenerationService implements ICodeGenerator {
	private backendClient: BackendClient;
	private selectedModel: string;
	private activeGenerations = new Map<
		string,
		{ accumulatedCode: string; startTime: number }
	>();

	constructor(
		backendClient: BackendClient,
		selectedModel: string = "gpt-4o-mini"
	) {
		this.backendClient = backendClient;
		this.selectedModel = selectedModel;
	}

	setModel(model: string) {
		this.selectedModel = model;
	}

	/**
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

	private buildEnhancedContext(request: CodeGenerationRequest): string {
		const datasetInfo = request.datasets
			.map(
				(d) =>
					`- ${d.id}: ${d.title || "Unknown"} (${
						d.organism || "Unknown organism"
					})`
			)
			.join("\n");

		let context = `Original question: ${request.originalQuestion}
Working directory: ${request.workingDir}
Step index: ${request.stepIndex}

Available datasets:
${datasetInfo}

Requirements:
- Use proper error handling with try-except blocks
- Include all necessary imports
- Add progress print statements
- Save outputs to appropriate directories (results/, figures/)
- Handle missing or corrupted data gracefully
- Use robust data validation
- Follow Python best practices`;

		// Add previously generated code as context if available
		if (request.previousCode) {
			context += `\n\nPreviously generated code (DO NOT REPEAT IMPORTS OR SETUP):
\`\`\`python
${request.previousCode}
\`\`\`

IMPORTANT: Do not repeat imports or setup code that was already generated. Focus only on the new functionality for this step.`;
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

			// Return the generated code as-is (cleaning handled by CodeQualityService)
			const finalCode =
				finalGeneratedCode ||
				this.generateDataAwareBasicStepCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex
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
			console.error("🎯 Error details:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				stepDescription: request.stepDescription,
			});

			// Emit failure event
			EventManager.dispatchEvent("code-generation-failed", {
				stepId,
				stepDescription: request.stepDescription,
				error: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			} as CodeGenerationFailedEvent);

			// Clean up tracking
			this.activeGenerations.delete(stepId);

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
		stepIndex: number
	): string {
		// Fallback code generation when LLM is not available
		return `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

print(f"Executing step {stepIndex + 1}: {stepDescription}")

# TODO: Implement ${stepDescription}
# This is a placeholder implementation

print("Step completed successfully!")
`;
	}

	private generateDataAwareBasicStepCode(
		stepDescription: string,
		datasets: any[],
		stepIndex: number
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");

		return `# Step ${stepIndex + 1}: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os

print(f"Executing step {stepIndex + 1}: {stepDescription}")
print(f"Working with datasets: {datasetIds}")

# Check available data files
data_dir = "."
data_files = [f for f in os.listdir(data_dir) if f.endswith(('.csv', '.txt', '.tsv'))]
print(f"Available data files: {data_files}")

# TODO: Implement ${stepDescription} with available datasets
# This is a placeholder implementation

print("Step completed successfully!")
`;
	}

	/**
	 * Generate single step code with events (main public method)
	 */
	async generateSingleStepCode(
		request: CodeGenerationRequest,
		stepId?: string
	): Promise<CodeGenerationResult> {
		const actualStepId =
			stepId ||
			`single-step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		return this.generateCodeWithEvents(request, actualStepId);
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
		stepIndex: number
	): string {
		const datasetIds = datasets.map((d) => d.id).join(", ");
		return `# Step ${stepIndex + 1}: ${stepDescription} (Safe Mode)
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
	}

	// Public wrapper methods for fallback code generation
	public generateBasicStepCodePublic(
		stepDescription: string,
		stepIndex: number
	): string {
		return this.generateBasicStepCode(stepDescription, stepIndex);
	}

	public generateDataAwareBasicStepCodePublic(
		stepDescription: string,
		datasets: any[],
		stepIndex: number
	): string {
		return this.generateDataAwareBasicStepCode(
			stepDescription,
			datasets,
			stepIndex
		);
	}

	public generateTimeoutSafeCodePublic(
		stepDescription: string,
		datasets: any[],
		stepIndex: number
	): string {
		return this.generateTimeoutSafeCode(
			stepDescription,
			datasets,
			stepIndex
		);
	}
}
