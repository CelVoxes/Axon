import { BackendClient } from "./BackendClient";
import { CellExecutionService } from "./CellExecutionService";
import { CodeGenerationService } from "./CodeGenerationService";

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

export interface CodeQualityOptions {
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

	/**
	 * Comprehensive code quality check: validation + cleaning + execution
	 */
	async validateAndTest(
		code: string,
		stepId: string,
		options: CodeQualityOptions = {}
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
			console.log(`CodeQualityService: About to execute code for ${stepTitle}`);
			console.log(
				`CodeQualityService: Code to execute length: ${result.lintedCode.length}`
			);
			console.log(
				`CodeQualityService: First 150 chars of code to execute:`,
				result.lintedCode.substring(0, 150)
			);

			try {
				const executionResult = await this.cellExecutionService.executeCell(
					`test-${stepId}`,
					result.lintedCode,
					undefined
				);

				console.log(
					`CodeQualityService: Execution completed for ${stepTitle}`,
					{
						status: executionResult.status,
						outputLength: executionResult.output?.length || 0,
						hasOutput: !!executionResult.output,
					}
				);

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
		options?: CodeQualityOptions
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
		options?: CodeQualityOptions
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

		// Remove markdown code blocks if present
		let cleanedCode = code
			.replace(/```python\s*/gi, "") // Remove ```python (case insensitive)
			.replace(/```/g, "") // Remove ALL ``` occurrences
			.trim();

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

		// If code defines a `datasets` list/dict without URLs, inject safe URL derivation
		if (/\bdatasets\s*=\s*\[/m.test(cleanedCode) || /\bdatasets\s*=\s*\{/m.test(cleanedCode)) {
			const derivationPrelude = `\n# --- Auto-derivation of dataset URLs when missing ---\ntry:\n    datasets  # ensure variable exists\n    def _axon_derive_url(rec):\n        try:\n            url = rec.get('url') if isinstance(rec, dict) else None\n            if url:\n                return url\n            idv = rec.get('id', '') if isinstance(rec, dict) else ''\n            src = (rec.get('source') or '').strip() if isinstance(rec, dict) else ''\n            # Derive CellxCensus by UUID-like id or explicit source\n            if src == 'CellxCensus' or ('-' in idv and len(idv) >= 8):\n                rec['url'] = f"https://datasets.cellxgene.cziscience.com/{idv}.h5ad"\n                rec['format'] = rec.get('format') or 'h5ad'\n                return rec['url']\n            # Derive GEO page links for GSE/GSM ids\n            if idv.startswith('GSE') or idv.startswith('GSM'):\n                rec['url'] = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={idv}"\n                rec['format'] = rec.get('format') or 'unknown'\n                return rec['url']\n        except Exception:\n            return None\n        return None\n\n    try:\n        for _d in datasets:\n            if isinstance(_d, dict):\n                _axon_derive_url(_d)\n    except Exception:\n        pass\n# --- End auto-derivation ---\n`;
			cleanedCode = derivationPrelude + cleanedCode;
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

		// Check for potentially problematic code patterns
		cleanedCode = this.addSafetyChecks(cleanedCode);

		return cleanedCode;
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
		options: CodeQualityOptions = {}
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

	private addBasicImports(code: string, globalCodeContext?: string): string {
		const basicImportsCode = `import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
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
		return `# Create output directories
results_dir = Path('results')
figures_dir = Path('figures')
results_dir.mkdir(exist_ok=True)
figures_dir.mkdir(exist_ok=True)

${code}`;
	}
}
