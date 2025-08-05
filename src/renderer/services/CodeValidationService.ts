import { BackendClient } from "./BackendClient";

export interface ValidationResult {
	isValid: boolean;
	lintedCode: string;
	errors: string[];
	warnings: string[];
}

export interface CodeCleaningOptions {
	addImports?: boolean;
	addErrorHandling?: boolean;
	addDirectoryCreation?: boolean;
	stepDescription?: string;
}

export class CodeValidationService {
	private backendClient: BackendClient;

	constructor(backendClient: BackendClient) {
		this.backendClient = backendClient;
	}

	/**
	 * Comprehensive code validation and cleaning
	 */
	async validateAndLintCode(code: string): Promise<ValidationResult> {
		try {
			const result = await this.backendClient.validateCode({
				code: code,
			});
			return {
				isValid: result.is_valid,
				lintedCode: result.linted_code || code,
				errors: result.errors || [],
				warnings: result.warnings || [],
			};
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

	/**
	 * Basic code cleaning and preparation (moved from CodeGenerationService)
	 */
	cleanAndPrepareCode(code: string, options: CodeCleaningOptions = {}): string {
		if (!code || !code.trim()) {
			return "";
		}

		// Remove markdown code blocks if present
		let cleanedCode = code
			.replace(/```python\s*/g, "")
			.replace(/```\s*$/g, "")
			.trim();

		// Add imports if requested and missing
		if (options.addImports && !this.hasBasicImports(cleanedCode)) {
			cleanedCode = this.addBasicImports(cleanedCode);
		}

		// Add error handling if requested and missing
		if (options.addErrorHandling && !this.hasErrorHandling(cleanedCode)) {
			cleanedCode = this.addErrorHandling(cleanedCode, options.stepDescription);
		}

		// Add directory creation if requested and missing
		if (
			options.addDirectoryCreation &&
			!this.hasDirectoryCreation(cleanedCode)
		) {
			cleanedCode = this.addDirectoryCreation(cleanedCode);
		}

		return cleanedCode;
	}

	/**
	 * Fix validation errors using LLM
	 */
	async fixValidationErrors(code: string, errors: string[]): Promise<string> {
		if (errors.length === 0) {
			return code;
		}

		try {
			let fixedCode = "";
			await this.backendClient.generateCodeStream(
				{
					task_description: `Fix the following Python code validation errors:\n\nErrors:\n${errors.join(
						"\n"
					)}\n\nCode:\n${code}\n\nProvide only the corrected code, no explanations.`,
					language: "python",
					context: "Code validation error fixing",
				},
				(chunk: string) => {
					fixedCode += chunk;
				}
			);

			console.log(
				"CodeValidationService: Code validation error fixing completed:",
				fixedCode
			);
			return this.cleanAndPrepareCode(fixedCode.trim());
		} catch (error) {
			console.error(
				"CodeValidationService: Error fixing validation errors:",
				error
			);
			return code;
		}
	}

	/**
	 * Generate refactored code based on error output
	 */
	async generateRefactoredCode(
		originalCode: string,
		errorOutput: string,
		cellTitle: string,
		workspacePath: string
	): Promise<string> {
		try {
			let refactoredCode = "";
			await this.backendClient.generateCodeStream(
				{
					task_description: `Refactor the following Python code to fix the execution error:\n\nError Output:\n${errorOutput}\n\nOriginal Code:\n${originalCode}\n\nCell Title: ${cellTitle}\nWorkspace: ${workspacePath}\n\nProvide only the corrected code, no explanations.`,
					language: "python",
					context: "Code refactoring based on error output",
				},
				(chunk: string) => {
					refactoredCode += chunk;
				}
			);

			console.log(
				"CodeValidationService: Code refactoring completed:",
				refactoredCode
			);
			return refactoredCode || originalCode;
		} catch (error) {
			console.error("CodeValidationService: Error refactoring code:", error);
			return originalCode;
		}
	}

	// Helper methods for code analysis
	private hasBasicImports(code: string): boolean {
		return (
			code.includes("import pandas") ||
			code.includes("import numpy") ||
			code.includes("import matplotlib") ||
			code.includes("import seaborn")
		);
	}

	private addBasicImports(code: string): string {
		return `import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
from pathlib import Path

${code}`;
	}

	private hasErrorHandling(code: string): boolean {
		return code.includes("try:") || code.includes("except:");
	}

	private addErrorHandling(code: string, stepDescription?: string): string {
		const description = stepDescription || "this step";
		return `try:
${code
	.split("\n")
	.map((line) => `    ${line}`)
	.join("\n")}
except Exception as e:
    print(f"Error in ${description}: {{e}}")
    raise`;
	}

	private hasDirectoryCreation(code: string): boolean {
		return code.includes("mkdir") || code.includes("Path(");
	}

	private addDirectoryCreation(code: string): string {
		return `# Create output directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)

${code}`;
	}
}
