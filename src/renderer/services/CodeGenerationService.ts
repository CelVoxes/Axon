import { BackendClient } from "./BackendClient";
import { CodeValidationService } from "./CodeValidationService";

export interface CodeGenerationRequest {
	stepDescription: string;
	originalQuestion: string;
	datasets: any[];
	workingDir: string;
	stepIndex: number;
	previousCode?: string; // Add previously generated code as context
}

export interface CodeGenerationResult {
	code: string;
	success: boolean;
	error?: string;
}

export class CodeGenerationService {
	private backendClient: BackendClient;
	private selectedModel: string;
	private codeValidationService: CodeValidationService;
	private codeGenerationCallback?: (code: string, step: string) => void;
	private streamingCodeCallback?: (chunk: string, step: string) => void;

	constructor(
		backendClient: BackendClient,
		selectedModel: string = "gpt-4o-mini"
	) {
		this.backendClient = backendClient;
		this.selectedModel = selectedModel;
		this.codeValidationService = new CodeValidationService(backendClient);
	}

	setModel(model: string) {
		this.selectedModel = model;
	}

	setCodeGenerationCallback(callback: (code: string, step: string) => void) {
		this.codeGenerationCallback = callback;
	}

	setStreamingCodeCallback(callback: (chunk: string, step: string) => void) {
		this.streamingCodeCallback = callback;
	}

	async generateDataDrivenStepCode(
		request: CodeGenerationRequest
	): Promise<CodeGenerationResult> {
		console.log(
			"CodeGenerationService: generateDataDrivenStepCode called for:",
			request.stepDescription
		);

		// Use the streaming method internally to provide real-time updates
		const result = await this.generateDataDrivenStepCodeStream(
			request,
			(chunk: string) => {
				// Trigger streaming callback if available
				if (this.streamingCodeCallback) {
					this.streamingCodeCallback(chunk, request.stepDescription);
				}
			}
		);
		return result;
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

	// Note: Code cleaning and validation is now handled by CodeValidationService

	async generateDataDrivenStepCodeStream(
		request: CodeGenerationRequest,
		onChunk: (chunk: string) => void
	): Promise<CodeGenerationResult> {
		try {
			console.log(
				"CodeGenerationService: Starting streaming for step:",
				request.stepDescription
			);

			// Prepare enhanced context with more detailed information
			const enhancedContext = this.buildEnhancedContext(request);

			console.log(
				"CodeGenerationService: Making streaming API call to:",
				`${this.backendClient.getBaseUrl()}/llm/code/stream`
			);

			let generatedCode = "";
			const result = await this.backendClient.generateCodeStream(
				{
					task_description: request.stepDescription,
					language: "python",
					context: enhancedContext,
				},
				(chunk: string) => {
					generatedCode += chunk;
					onChunk(chunk);
				}
			);

			console.log(
				"CodeGenerationService: Streaming completed, final code length:",
				generatedCode.length
			);

			// Streaming code generation completed

			// Validate and clean the generated code
			const cleanedCode = this.codeValidationService.cleanAndPrepareCode(
				generatedCode,
				{
					addImports: true,
					addErrorHandling: true,
					addDirectoryCreation: true,
					stepDescription: request.stepDescription,
				}
			);

			const finalCode =
				cleanedCode ||
				this.generateDataAwareBasicStepCode(
					request.stepDescription,
					request.datasets,
					request.stepIndex
				);

			// Trigger callback if available
			if (this.codeGenerationCallback) {
				console.log(
					"CodeGenerationService: Calling final code generation callback"
				);
				this.codeGenerationCallback(finalCode, request.stepDescription);
			}

			// Dispatch completion event for chat panel
			const completeEvent = new CustomEvent("llm-code-complete", {
				detail: { 
					code: finalCode, 
					step: request.stepDescription 
				}
			});
			window.dispatchEvent(completeEvent);

			return {
				code: finalCode,
				success: true,
			};
		} catch (error) {
			console.error("CodeGenerationService: Error in streaming method:", error);
			// Fallback to non-streaming method
			return this.generateDataDrivenStepCodeFallback(request);
		}
	}

	/**
	 * Fallback method when streaming fails
	 */
	private async generateDataDrivenStepCodeFallback(
		request: CodeGenerationRequest
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

			// Trigger callback if available
			if (this.codeGenerationCallback) {
				this.codeGenerationCallback(code, request.stepDescription);
			}

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

			// Trigger callback if available
			if (this.codeGenerationCallback) {
				this.codeGenerationCallback(fallbackCode, request.stepDescription);
			}

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

	async generateSingleStepCode(
		request: CodeGenerationRequest
	): Promise<CodeGenerationResult> {
		return this.generateDataDrivenStepCode(request);
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
}
