export interface CodeGenerationRequest {
	stepDescription: string;
	originalQuestion: string;
	datasets: any[];
	workingDir: string;
	stepIndex: number;
}

export interface CodeGenerationResult {
	code: string;
	success: boolean;
	error?: string;
}

export class CodeGenerationService {
	private backendClient: any;
	private selectedModel: string;

	constructor(backendClient: any, selectedModel: string = "gpt-4o-mini") {
		this.backendClient = backendClient;
		this.selectedModel = selectedModel;
	}

	setModel(model: string) {
		this.selectedModel = model;
	}

	async generateDataDrivenStepCode(
		request: CodeGenerationRequest
	): Promise<CodeGenerationResult> {
		try {
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/code/stream`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						task_description: request.stepDescription,
						language: "python",
						context: `Original question: ${
							request.originalQuestion
						}\nWorking directory: ${
							request.workingDir
						}\nAvailable datasets: ${request.datasets
							.map((d) => d.id)
							.join(", ")}`,
					}),
				}
			);

			if (response.ok && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fullCode = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value);
					const lines = chunk.split("\n");

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							try {
								const data = JSON.parse(line.slice(6));
								if (data.chunk) {
									fullCode += data.chunk;
								}
							} catch (e) {
								console.warn(
									"CodeGenerationService: Failed to parse streaming chunk:",
									e
								);
							}
						}
					}
				}

				console.log(
					"CodeGenerationService: Streaming code generation completed:",
					fullCode
				);
				return {
					code:
						fullCode ||
						this.generateBasicStepCode(
							request.stepDescription,
							request.stepIndex
						),
					success: true,
				};
			} else {
				const errorText = await response.text();
				console.error(
					"CodeGenerationService: Code generation failed:",
					errorText
				);
				return {
					code: this.generateBasicStepCode(
						request.stepDescription,
						request.stepIndex
					),
					success: false,
					error: errorText,
				};
			}
		} catch (error) {
			console.error("CodeGenerationService: Error generating code:", error);
			return {
				code: this.generateBasicStepCode(
					request.stepDescription,
					request.stepIndex
				),
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async generateDataDrivenStepCodeStream(
		request: CodeGenerationRequest,
		onChunk: (chunk: string) => void
	): Promise<CodeGenerationResult> {
		try {
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/code/stream`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						task_description: request.stepDescription,
						language: "python",
						context: `Original question: ${
							request.originalQuestion
						}\nWorking directory: ${
							request.workingDir
						}\nAvailable datasets: ${request.datasets
							.map((d) => d.id)
							.join(", ")}`,
					}),
				}
			);

			if (response.ok && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fullCode = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value);
					const lines = chunk.split("\n");

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							try {
								const data = JSON.parse(line.slice(6));
								if (data.chunk) {
									fullCode += data.chunk;
									onChunk(data.chunk);
								}
							} catch (e) {
								console.warn(
									"CodeGenerationService: Failed to parse streaming chunk:",
									e
								);
							}
						}
					}
				}

				console.log(
					"CodeGenerationService: Streaming code generation completed:",
					fullCode
				);
				return {
					code:
						fullCode ||
						this.generateBasicStepCode(
							request.stepDescription,
							request.stepIndex
						),
					success: true,
				};
			} else {
				const errorText = await response.text();
				console.error(
					"CodeGenerationService: Code generation failed:",
					errorText
				);
				return {
					code: this.generateBasicStepCode(
						request.stepDescription,
						request.stepIndex
					),
					success: false,
					error: errorText,
				};
			}
		} catch (error) {
			console.error("CodeGenerationService: Error generating code:", error);
			return {
				code: this.generateBasicStepCode(
					request.stepDescription,
					request.stepIndex
				),
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
