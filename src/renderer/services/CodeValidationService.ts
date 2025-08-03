export interface ValidationResult {
	isValid: boolean;
	lintedCode: string;
	errors: string[];
	warnings: string[];
}

export class CodeValidationService {
	private backendClient: any;

	constructor(backendClient: any) {
		this.backendClient = backendClient;
	}

	async validateAndLintCode(code: string): Promise<ValidationResult> {
		try {
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/validate-code`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						code: code,
					}),
				}
			);

			if (response.ok) {
				const result = await response.json();
				return {
					isValid: result.is_valid,
					lintedCode: result.linted_code || code,
					errors: result.errors || [],
					warnings: result.warnings || [],
				};
			} else {
				console.error("CodeValidationService: Validation request failed");
				return {
					isValid: true, // Assume valid if validation fails
					lintedCode: code,
					errors: [],
					warnings: [],
				};
			}
		} catch (error) {
			console.error("CodeValidationService: Error validating code:", error);
			return {
				isValid: true, // Assume valid if validation fails
				lintedCode: code,
				errors: [],
				warnings: [],
			};
		}
	}

	async fixValidationErrors(code: string, errors: string[]): Promise<string> {
		if (errors.length === 0) {
			return code;
		}

		try {
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/code/stream`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						task_description: `Fix the following Python code validation errors:\n\nErrors:\n${errors.join(
							"\n"
						)}\n\nCode:\n${code}\n\nProvide only the corrected code, no explanations.`,
						language: "python",
						context: "Code validation error fixing",
					}),
				}
			);

			if (response.ok && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fixedCode = "";

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
									fixedCode += data.chunk;
								}
							} catch (e) {
								console.warn(
									"CodeValidationService: Failed to parse streaming chunk:",
									e
								);
							}
						}
					}
				}

				console.log(
					"CodeValidationService: Code validation error fixing completed:",
					fixedCode
				);
				return fixedCode || code;
			}
		} catch (error) {
			console.error(
				"CodeValidationService: Error fixing validation errors:",
				error
			);
		}

		return code; // Return original code if fixing fails
	}

	async generateRefactoredCode(
		originalCode: string,
		errorOutput: string,
		cellTitle: string,
		workspacePath: string
	): Promise<string> {
		try {
			const response = await fetch(
				`${this.backendClient.getBaseUrl()}/llm/code/stream`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						task_description: `Refactor the following Python code to fix the execution error:\n\nError:\n${errorOutput}\n\nCode:\n${originalCode}\n\nCell Title: ${cellTitle}\nWorking Directory: ${workspacePath}\n\nProvide only the corrected code, no explanations.`,
						language: "python",
						context: `Error: ${errorOutput}\nOriginal Code: ${originalCode}`,
					}),
				}
			);

			if (response.ok && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let refactoredCode = "";

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
									refactoredCode += data.chunk;
								}
							} catch (e) {
								console.warn(
									"CodeValidationService: Failed to parse streaming chunk:",
									e
								);
							}
						}
					}
				}

				console.log(
					"CodeValidationService: Code refactoring completed:",
					refactoredCode
				);
				return refactoredCode || originalCode;
			}
		} catch (error) {
			console.error("CodeValidationService: Error refactoring code:", error);
		}

		return originalCode; // Return original code if refactoring fails
	}
}
