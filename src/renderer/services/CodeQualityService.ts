import { BackendClient } from "./BackendClient";
import { CellExecutionService } from "./CellExecutionService";
import { CodeGenerationService } from "./CodeGenerationService";
import {
	extractImports as sharedExtractImports,
	getExistingImports as sharedGetExistingImports,
	removeDuplicateImports as sharedRemoveDuplicateImports,
} from "../utils/ImportUtils";

export interface CodeQualityResult {
	isValid: boolean;
	executionPassed: boolean;
	validationErrors: string[];
	validationWarnings: string[];
	executionOutput?: string;
	executionError?: string;
	lintedCode: string;
	originalCode: string;
	cleanedCode: string;
}

export interface CodeQualityPipelineOptions {
	skipValidation?: boolean;
	skipExecution?: boolean;
	skipCleaning?: boolean;
	stepTitle?: string;
	addImports?: boolean;
	addErrorHandling?: boolean;
	addDirectoryCreation?: boolean;
	stepDescription?: string;
	globalCodeContext?: string;
}

export interface BatchTestResult {
	results: CodeQualityResult[];
	summary: {
		totalTests: number;
		validationPassed: number;
		executionPassed: number;
		totalErrors: number;
		totalWarnings: number;
		report: string;
	};
}

/**
 * Unified CodeQualityService handles all aspects of code quality:
 * - Validation and linting
 * - Code cleaning and enhancement
 * - Execution testing
 * - Error fixing with LLM
 * - Comprehensive reporting
 */
export class CodeQualityService {
	private backendClient: BackendClient;
	private cellExecutionService: CellExecutionService;
	private codeGenerationService: CodeGenerationService;
	private statusCallback?: (status: string) => void;

	constructor(
		backendClient: BackendClient,
		cellExecutionService: CellExecutionService,
		codeGenerationService: CodeGenerationService
	) {
		this.backendClient = backendClient;
		this.cellExecutionService = cellExecutionService;
		this.codeGenerationService = codeGenerationService;
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	private normalizePythonCode(rawCode: string): string {
		if (!rawCode) return "";
		let code = String(rawCode);
		// Normalize newlines and strip BOM/zero-width no-break spaces
		code = code
			.replace(/\r\n/g, "\n")
			.replace(/^\ufeff/, "")
			.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
		// Remove surrounding markdown code fences if present
		code = code
			.replace(/```\s*python\s*/gi, "")
			.replace(/```/g, "")
			.trim();

		const lines = code.split("\n");
		// Convert leading tabs to 4 spaces to avoid mixed-indentation errors
		for (let i = 0; i < lines.length; i++) {
			lines[i] = lines[i].replace(/^\t+/, (m) => " ".repeat(4 * m.length));
		}
		const nonEmpty = lines.filter((l) => l.trim().length > 0);
		if (nonEmpty.length === 0) return code;
		const anyAtCol0 = nonEmpty.some((l) => !/^\s/.test(l));
		if (!anyAtCol0) {
			const leading = nonEmpty.map((l) => l.match(/^[\t ]*/)?.[0] ?? "");
			let common = leading[0] || "";
			for (let i = 1; i < leading.length && common.length > 0; i++) {
				const s = leading[i];
				let j = 0;
				const max = Math.min(common.length, s.length);
				while (j < max && common[j] === s[j]) j++;
				common = common.slice(0, j);
			}
			if (common) {
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.startsWith(common)) lines[i] = line.slice(common.length);
				}
				code = lines.join("\n");
			}
		}

		return code.trimEnd();
	}

	/**
	 * Comprehensive code quality check: validation + cleaning + execution
	 */
	async validateAndTest(
		code: string,
		stepId: string,
		options: CodeQualityPipelineOptions = {}
	): Promise<CodeQualityResult> {
		const {
			skipValidation = false,
			skipExecution = false,
			skipCleaning = false,
			stepTitle = stepId,
			addImports = true,
			addErrorHandling = true,
			addDirectoryCreation = true,
			stepDescription,
		} = options;

		const result: CodeQualityResult = {
			isValid: true,
			executionPassed: true,
			validationErrors: [],
			validationWarnings: [],
			lintedCode: code,
			originalCode: code,
			cleanedCode: code,
		};

		// Step 1: Code Cleaning (if not skipped)
		if (!skipCleaning) {
			this.updateStatus(`Cleaning code for ${stepTitle}...`);
			result.cleanedCode = this.cleanAndPrepareCode(code, {
				addImports,
				addErrorHandling,
				addDirectoryCreation,
				stepDescription,
				globalCodeContext: options.globalCodeContext,
			});
		}

		// Step 2: Code Validation (if not skipped)
		if (!skipValidation) {
			this.updateStatus(`Validating code for ${stepTitle}...`);

			try {
				const validationResult = await this.backendClient.validateCode({
					code: result.cleanedCode,
				});

				result.isValid = !!validationResult.is_valid;
				// Normalize backend response to arrays
				const msg = validationResult.message || "";
				const respErrors: string[] = Array.isArray(validationResult.errors)
					? validationResult.errors
					: msg
					? [String(msg)]
					: [];
				result.validationErrors = respErrors;
				result.validationWarnings = validationResult.warnings || [];
				result.lintedCode = validationResult.linted_code || result.cleanedCode;

				if (!result.isValid) {
					console.warn(
						`Code validation failed for ${stepTitle}:`,
						result.validationErrors
					);

					// Emit validation error event
					this.codeGenerationService.emitValidationErrors(
						stepId,
						result.validationErrors,
						result.validationWarnings,
						result.originalCode,
						result.lintedCode
					);

					// Attempt to auto-fix linting/validation errors via LLM
					try {
						this.updateStatus(
							`Attempting to fix linting errors for ${stepTitle}...`
						);
						const fixed = await this.fixValidationErrors(
							result.lintedCode || result.cleanedCode,
							result.validationErrors
						);

						// Re-validate the fixed code
						const revalidation = await this.backendClient.validateCode({
							code: fixed,
						});
						const reIsValid = !!revalidation.is_valid;
						result.isValid = reIsValid;
						result.validationErrors = Array.isArray(revalidation.errors)
							? revalidation.errors
							: revalidation.message
							? [String(revalidation.message)]
							: [];
						result.lintedCode = fixed;

						if (reIsValid) {
							this.updateStatus(`✅ Linting issues fixed for ${stepTitle}`);
						} else {
							this.updateStatus(
								`⚠️ Auto-fix attempted but issues remain for ${stepTitle}`
							);
						}
					} catch (fixErr) {
						console.warn(`Auto-fix failed for ${stepTitle}:`, fixErr as any);
					}
				} else {
					this.updateStatus(`✅ Code validation passed for ${stepTitle}`);
					// Emit a success event so UI can display a green banner like in the screenshot
					try {
						this.codeGenerationService.emitValidationSuccess(
							stepId,
							`No linter errors found in ${stepTitle}`
						);
					} catch (_) {}
				}
			} catch (error) {
				result.isValid = false;
				result.validationErrors.push(
					error instanceof Error ? error.message : "Unknown validation error"
				);
				console.error(`Validation error for ${stepTitle}:`, error);
			}
		}

		// Step 3: Execution Testing (if not skipped)
		if (!skipExecution) {
			this.updateStatus(`Testing code execution for ${stepTitle}...`);

			try {
				const executionResult = await this.cellExecutionService.executeCell(
					`test-${stepId}`,
					result.lintedCode,
					undefined
				);

				// minimal log

				result.executionPassed = executionResult.status !== "failed";
				result.executionOutput = executionResult.output;

				if (executionResult.status === "failed") {
					result.executionError =
						executionResult.output || "Unknown execution error";
					console.warn(
						`Code execution failed for ${stepTitle}:`,
						executionResult.output
					);

					// Check if this is a timeout error and suggest timeout-safe code
					const isTimeoutError = result.executionError
						.toLowerCase()
						.includes("timeout");
					if (isTimeoutError) {
						this.updateStatus(
							`⚠️ Code execution timed out for ${stepTitle} - consider using safer code patterns`
						);
						console.warn(
							"CodeQualityService: Timeout detected - code may be too complex or have infinite loops"
						);
					} else {
						this.updateStatus(
							`⚠️ Code execution failed for ${stepTitle}, but test completed`
						);
					}
				} else {
					this.updateStatus(`✅ Code execution passed for ${stepTitle}`);
				}
			} catch (error) {
				result.executionPassed = false;
				result.executionError =
					error instanceof Error ? error.message : "Unknown execution error";
				console.error(`Execution test error for ${stepTitle}:`, error);
				this.updateStatus(`⚠️ Error testing code execution for ${stepTitle}`);
			}
		}

		return result;
	}

	/**
	 * Validation-only convenience method
	 */
	async validateOnly(
		code: string,
		stepId: string,
		options?: CodeQualityPipelineOptions
	): Promise<CodeQualityResult> {
		return this.validateAndTest(code, stepId, {
			...options,
			skipExecution: true,
		});
	}

	/**
	 * Execution-only convenience method
	 */
	async executeOnly(
		code: string,
		stepId: string,
		options?: CodeQualityPipelineOptions
	): Promise<CodeQualityResult> {
		return this.validateAndTest(code, stepId, {
			...options,
			skipValidation: true,
		});
	}

	/**
	 * Cleaning-only convenience method
	 */
	cleanAndPrepareCode(
		code: string,
		options: {
			addImports?: boolean;
			addErrorHandling?: boolean;
			addDirectoryCreation?: boolean;
			stepDescription?: string;
			globalCodeContext?: string;
		} = {}
	): string {
		if (!code || !code.trim()) {
			console.warn(
				"CodeQualityService: Empty code provided to cleanAndPrepareCode"
			);
			return "";
		}

		console.log(`CodeQualityService: Original code length: ${code.length}`);
		console.log(
			`CodeQualityService: Original code preview: ${code.substring(0, 100)}...`
		);

		// Normalize and strip code-fence artifacts first
		let cleanedCode = this.normalizePythonCode(code);

		console.log(
			`CodeQualityService: Cleaned code length: ${cleanedCode.length}`
		);
		console.log(
			`CodeQualityService: Cleaned code preview: ${cleanedCode.substring(
				0,
				100
			)}...`
		);

		// If cleaning resulted in empty code, return a basic comment
		if (!cleanedCode || !cleanedCode.trim()) {
			console.warn(
				"CodeQualityService: Code cleaning resulted in empty code, returning placeholder"
			);
			cleanedCode = `# Code cleaning resulted in empty content
# Original code length: ${code.length}
print("Code placeholder - original code was empty or only contained markdown")`;
		}

		// Add basic imports if requested and clearly missing
		if (options.addImports && !this.hasBasicImports(cleanedCode)) {
			cleanedCode = this.addBasicImports(
				cleanedCode,
				options.globalCodeContext
			);
		}

		// Ensure critical imports based on code usage (Path, requests, urlparse, etc.)
		cleanedCode = this.ensureCriticalImports(cleanedCode);

		// We no longer derive dataset URLs automatically; rely strictly on provided URLs from selection

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

		// Check for potentially problematic code patterns
		cleanedCode = this.addSafetyChecks(cleanedCode);

		return cleanedCode;
	}

	/**
	 * Insert a snippet immediately after a `datasets = [...]` or `datasets = {...}` literal.
	 * If no literal is found, append the snippet at the end.
	 */
	private insertAfterDatasetsDefinition(code: string, snippet: string): string {
		// Match a simple datasets assignment with a list or dict literal, possibly across lines
		const listRegex =
			/(\bdatasets\s*=\s*\[)([\s\S]*?\])(?![\s\S]*\bdatasets\s*=)/m;
		const dictRegex =
			/(\bdatasets\s*=\s*\{)([\s\S]*?\})(?![\s\S]*\bdatasets\s*=)/m;

		if (listRegex.test(code)) {
			return code.replace(listRegex, (match) => `${match}\n${snippet}`);
		}
		if (dictRegex.test(code)) {
			return code.replace(dictRegex, (match) => `${match}\n${snippet}`);
		}
		// Fallback: append
		return `${code}\n${snippet}`;
	}

	/**
	 * Ensure critical imports exist when corresponding symbols are used
	 */
	private ensureCriticalImports(code: string): string {
		const lines: string[] = [];

		const needs = (pattern: RegExp | string) =>
			typeof pattern === "string" ? code.includes(pattern) : pattern.test(code);

		const missing = (snippet: string) => !code.includes(snippet);

		// pathlib.Path
		if (
			(needs(/\bPath\s*\(/) || needs(/\.mkdir\s*\(/)) &&
			missing("from pathlib import Path")
		) {
			lines.push("from pathlib import Path");
		}

		// requests
		if (needs(/\brequests\./) && missing("import requests")) {
			lines.push("import requests");
		}

		// urlparse
		if (
			needs(/\burlparse\s*\(/) &&
			missing("from urllib.parse import urlparse")
		) {
			lines.push("from urllib.parse import urlparse");
		}

		// os
		if (needs(/\bos\./) && missing("import os")) {
			lines.push("import os");
		}

		// pandas
		if (needs(/\bpd\./) && missing("import pandas as pd")) {
			lines.push("import pandas as pd");
		}

		// numpy
		if (needs(/\bnp\./) && missing("import numpy as np")) {
			lines.push("import numpy as np");
		}

		// matplotlib
		if (needs(/\bplt\./) && missing("import matplotlib.pyplot as plt")) {
			lines.push("import matplotlib.pyplot as plt");
		}

		// seaborn
		if (needs(/\bsns\./) && missing("import seaborn as sns")) {
			lines.push("import seaborn as sns");
		}

		// scanpy (alias sc)
		if (
			(needs(/\bsc\./) || needs(/\bscanpy\./)) &&
			missing("import scanpy as sc")
		) {
			lines.push("import scanpy as sc");
		}

		// anndata
		if (needs(/\banndata\./) && missing("import anndata")) {
			lines.push("import anndata");
		}
		// anndata alias (ad)
		if (needs(/\bad\./) && missing("import anndata as ad")) {
			lines.push("import anndata as ad");
		}

		if (lines.length === 0) return code;

		return `${lines.join("\n")}\n\n${code}`;
	}

	/**
	 * Add safety checks to prevent infinite loops and other issues
	 */
	private addSafetyChecks(code: string): string {
		// Check for common infinite loop patterns
		const hasWhileLoop = /while\s+True:|while\s+1:/.test(code);
		const hasForLoop = /for\s+\w+\s+in\s+range\s*\(\s*\d+\s*\)/.test(code);
		const hasInfiniteRange = /range\s*\(\s*\d{6,}\s*\)/.test(code); // Very large ranges

		if (hasWhileLoop && !code.includes("break")) {
			console.warn(
				"CodeQualityService: Detected potential infinite while loop, adding safety break"
			);
			code = `# Safety: Added loop counter to prevent infinite loops
loop_counter = 0
max_iterations = 1000

${code.replace(/while\s+(True|1):/g, (match) => {
	return `${match}
    loop_counter += 1
    if loop_counter > max_iterations:
        print("Loop terminated to prevent infinite execution")
        break`;
})}`;
		}

		if (hasInfiniteRange) {
			console.warn(
				"CodeQualityService: Detected very large range, limiting to prevent timeout"
			);
			code = code.replace(
				/range\s*\(\s*(\d{6,})\s*\)/g,
				"range(min($1, 10000))"
			);
		}

		return code;
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
				"CodeQualityService: Code validation error fixing completed:",
				fixedCode
			);
			return this.cleanAndPrepareCode(fixedCode.trim());
		} catch (error) {
			console.error(
				"CodeQualityService: Error fixing validation errors:",
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
				"CodeQualityService: Code refactoring completed:",
				refactoredCode
			);
			return refactoredCode || originalCode;
		} catch (error) {
			console.error("CodeQualityService: Error refactoring code:", error);
			return originalCode;
		}
	}

	/**
	 * Batch test multiple code snippets
	 */
	async testMultipleCode(
		codeSnippets: { code: string; stepId: string; title?: string }[],
		options: CodeQualityPipelineOptions = {}
	): Promise<BatchTestResult> {
		this.updateStatus(`Testing ${codeSnippets.length} code snippets...`);

		const results: CodeQualityResult[] = [];

		for (let i = 0; i < codeSnippets.length; i++) {
			const snippet = codeSnippets[i];
			const testOptions = {
				...options,
				stepTitle: snippet.title || snippet.stepId,
			};

			this.updateStatus(
				`Testing snippet ${i + 1}/${codeSnippets.length}: ${
					testOptions.stepTitle
				}`
			);

			const result = await this.validateAndTest(
				snippet.code,
				snippet.stepId,
				testOptions
			);
			results.push(result);

			// Small delay between tests to avoid overwhelming the system
			if (i < codeSnippets.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		const summary = this.generateTestSummary(results);
		this.updateStatus(`Completed testing ${codeSnippets.length} code snippets`);

		return { results, summary };
	}

	/**
	 * Generate test summary report
	 */
	private generateTestSummary(results: CodeQualityResult[]) {
		const totalTests = results.length;
		const validationPassed = results.filter((r) => r.isValid).length;
		const executionPassed = results.filter((r) => r.executionPassed).length;
		const totalErrors = results.reduce(
			(sum, r) => sum + r.validationErrors.length,
			0
		);
		const totalWarnings = results.reduce(
			(sum, r) => sum + r.validationWarnings.length,
			0
		);

		let report = `Code Quality Report:\n`;
		report += `- Total tests: ${totalTests}\n`;
		report += `- Validation passed: ${validationPassed}/${totalTests}\n`;
		report += `- Execution passed: ${executionPassed}/${totalTests}\n`;
		report += `- Total errors: ${totalErrors}\n`;
		report += `- Total warnings: ${totalWarnings}`;

		if (
			totalErrors === 0 &&
			validationPassed === totalTests &&
			executionPassed === totalTests
		) {
			report += `\n✅ All tests passed successfully!`;
		} else if (totalErrors > 0) {
			report += `\n❌ Some tests failed with errors`;
		} else {
			report += `\n⚠️ Tests completed with warnings`;
		}

		return {
			totalTests,
			validationPassed,
			executionPassed,
			totalErrors,
			totalWarnings,
			report,
		};
	}

	/**
	 * Get the best code version (linted if validation passed, cleaned otherwise)
	 */
	getBestCode(result: CodeQualityResult): string {
		if (result.isValid && result.lintedCode) {
			return result.lintedCode;
		}
		if (result.cleanedCode) {
			return result.cleanedCode;
		}
		return result.originalCode;
	}

	/**
	 * Check if code is safe to use based on test results
	 */
	isCodeSafe(
		result: CodeQualityResult,
		requireExecution: boolean = false
	): boolean {
		if (requireExecution) {
			return result.isValid && result.executionPassed;
		}
		// At minimum, code should validate without critical errors
		return result.isValid || result.validationErrors.length === 0;
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

	/**
	 * Extract imports from code string
	 */
	private extractImports(code: string): Set<string> {
		return sharedExtractImports(code);
	}

	/**
	 * Get all imports from global code context
	 */
	private getExistingImports(globalCodeContext?: string): Set<string> {
		return sharedGetExistingImports(globalCodeContext);
	}

	/**
	 * Remove duplicate imports from code
	 */
	private removeDuplicateImports(
		code: string,
		existingImports: Set<string>
	): string {
		return sharedRemoveDuplicateImports(code, existingImports);
	}

	private addBasicImports(code: string, globalCodeContext?: string): string {
		const basicImportsCode = `import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os
from pathlib import Path

${code}`;

		// If we have global context, deduplicate imports
		if (globalCodeContext) {
			const existingImports = this.getExistingImports(globalCodeContext);
			return this.removeDuplicateImports(basicImportsCode, existingImports);
		}

		return basicImportsCode;
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
    print(f"Error in ${description}: {e}")
    raise`;
	}

	private hasDirectoryCreation(code: string): boolean {
		return code.includes("mkdir") || code.includes("Path(");
	}

	private addDirectoryCreation(code: string): string {
		// Prepare the directory creation snippet (unindented core)
		const directorySnippetCore = `# Create output directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)`;

		// Split code into lines for controlled insertion
		const lines = code.split("\n");

		// Identify the insertion point right AFTER the import block
		// Import block includes:
		// - blank lines
		// - comments
		// - lines starting with "import " or "from "
		let insertIndex = 0;
		let detectedIndent = "";
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (
				trimmed === "" ||
				trimmed.startsWith("#") ||
				trimmed.startsWith("import ") ||
				trimmed.startsWith("from ")
			) {
				insertIndex = i + 1;
				// Capture indentation of the first import line to preserve block scope
				if (
					detectedIndent === "" &&
					(trimmed.startsWith("import ") || trimmed.startsWith("from "))
				) {
					const match = lines[i].match(/^(\s*)/);
					detectedIndent = match ? match[1] : "";
				}
				continue;
			}
			break;
		}

		// Ensure pathlib import exists since the snippet uses Path
		const hasPathImport = code.includes("from pathlib import Path");
		const updatedLines = [...lines];
		if (!hasPathImport) {
			// Insert the import at the end of the import block, respecting current indentation
			const pathImportLine = `${detectedIndent}from pathlib import Path`;
			updatedLines.splice(insertIndex, 0, pathImportLine);
			insertIndex += 1; // Maintain insertion order for the snippet
		}

		// Insert the directory snippet right after imports and add a spacer line, respecting indentation
		const directorySnippet = directorySnippetCore
			.split("\n")
			.map((line) => (line ? `${detectedIndent}${line}` : line))
			.join("\n");
		updatedLines.splice(
			insertIndex,
			0,
			directorySnippet,
			detectedIndent ? detectedIndent : ""
		);

		return updatedLines.join("\n");
	}
}
