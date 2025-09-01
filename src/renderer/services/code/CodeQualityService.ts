import { BackendClient } from "../backend/BackendClient";
import { CellExecutionService } from "../notebook/CellExecutionService";
import { CodeGenerationService } from "./CodeGenerationService";
import { autoFixWithRuffAndLLM } from "../chat/LintAutoFixService";
import { normalizePythonCode } from "../../utils/CodeTextUtils";
import {
	getExistingImports as sharedGetExistingImports,
	removeDuplicateImports as sharedRemoveDuplicateImports,
} from "../../utils/ImportUtils";

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
	validationEventData?: {
		isValid: boolean;
		errors: string[];
		warnings: string[];
		wasFixed: boolean;
		originalCode: string;
		lintedCode: string;
	};
}

export interface CodeQualityPipelineOptions {
	skipValidation?: boolean;
	skipExecution?: boolean; // Default: true (execution disabled for performance)
	skipCleaning?: boolean;
	stepTitle?: string;
	addImports?: boolean;
	addErrorHandling?: boolean;
	addDirectoryCreation?: boolean;
	stepDescription?: string;
	globalCodeContext?: string;
	skipValidationEvents?: boolean; // Skip emitting validation events (for manual emission)
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

	// Duplicate helpers removed: using shared utils instead

	/**
	 * Comprehensive code quality check: validation + cleaning (execution disabled by default)
	 */
	async validateAndTest(
		code: string,
		stepId: string,
		options: CodeQualityPipelineOptions = {}
	): Promise<CodeQualityResult> {
		console.log(`CodeQualityService: validateAndTest called for stepId: ${stepId}, code length: ${code.length}`);
		const {
			skipValidation = false,
			skipExecution = true, // Default to skipping execution for performance
			skipCleaning = false,
			stepTitle = stepId,
			addImports = true, // Add imports when needed, but respect global context
			addErrorHandling = false, // Keep conservative - only add when explicitly requested
			addDirectoryCreation = true, // Add directory creation when needed, but respect global context
			stepDescription,
			skipValidationEvents = false, // Skip emitting validation events (for manual emission)
		} = options;

		// Detect package-install or non-analytical utility cells and avoid mutating them
        const isInstallCell =
            /package\s*install|package-install|pip\s+install|%pip|%conda|conda\s+install/i.test(
                `${stepTitle}\n${code}`
            );

        // Detect data download cells and skip linting similar to install cells
        // Heuristics: keywords in title, presence of common download libs/APIs, or URLs
        const isDataDownloadCell =
            /\b(download|fetch|retrieve)\b/i.test(`${stepTitle}`) ||
            /requests\s*\.|urllib\s*\.|gdown\b|wget\b|curl\b/i.test(code) ||
            /(https?:\/\/|ftp:\/\/)/i.test(code);
		
		console.log(`CodeQualityService: isInstallCell check for "${stepTitle}" - result: ${isInstallCell}`);

		const result: CodeQualityResult = {
			isValid: true,
			executionPassed: true,
			validationErrors: [],
			validationWarnings: [],
			lintedCode: code,
			originalCode: code,
			cleanedCode: code,
		};

        if (isInstallCell || isDataDownloadCell) {
            // For install cells, keep code as-is (only normalize whitespace minimally)
            this.updateStatus(
                isInstallCell
                    ? `Skipping lint/fix for install cell: ${stepTitle}`
                    : `Skipping lint/fix for data download cell: ${stepTitle}`
            );
            result.cleanedCode = normalizePythonCode(code);
            result.lintedCode = result.cleanedCode;
            result.isValid = true;

            // Emit a validation success event so the UI doesn't wait for a timeout
            try {
                this.codeGenerationService.emitValidationSuccess(
                    stepId,
                    isInstallCell
                        ? `Skipped linting for install cell: ${stepTitle}`
                        : `Skipped linting for data download cell: ${stepTitle}`,
                    result.lintedCode
                );
            } catch (_) {}

            return result;
        }

		// Step 1: Single comprehensive code enhancement (if not skipped)
		if (!skipCleaning) {
			this.updateStatus(`Enhancing code for ${stepTitle}...`);
			result.cleanedCode = this.enhanceCode(code, {
				addImports,
				addErrorHandling,
				addDirectoryCreation,
				stepDescription,
				globalCodeContext: options.globalCodeContext,
			});
		}

		// Step 2: Code Validation (if not skipped) - Using optimized Ruff+LLM service
		if (!skipValidation) {
			this.updateStatus(`Validating code for ${stepTitle}...`);

			try {
				const fixResult = await autoFixWithRuffAndLLM(
					this.backendClient,
					result.cleanedCode,
					{
						filename: `${stepTitle.replace(/\s+/g, "_").toLowerCase()}.py`,
						stepTitle
					}
				);

				// Post-process undefined-name errors that are satisfied by prior cells' imports
				const globalCtx = options.globalCodeContext || "";
				const aliasToImport = new Map<string, string>([
					["plt", "import matplotlib.pyplot as plt"],
					["pd", "import pandas as pd"],
					["np", "import numpy as np"],
					["sns", "import seaborn as sns"],
					["sc", "import scanpy as sc"],
					["ad", "import anndata as ad"],
					["Path", "from pathlib import Path"],
					["os", "import os"],
					["sys", "import sys"],
				]);
				const undefRe = /^F821: Undefined name `([^`]+)`/;
				const filteredErrors: string[] = [];
				const promotedWarnings: string[] = [...fixResult.warnings];
				for (const err of fixResult.issues) {
					// 1) Pure style: imported but unused → warning (do not block cell)
					if (err.startsWith("F401:")) {
						promotedWarnings.push(`${err} — Style warning (non-blocking)`);
						continue;
					}
					const m = err.match(undefRe);
					if (m) {
						const name = m[1];
						const expected = aliasToImport.get(name);
						if (expected && globalCtx.includes(expected)) {
							promotedWarnings.push(
								`${err} — Tip: '${name}' is imported in a previous cell. Run that cell before this step.`
							);
							continue; // do not keep as an error
						}
						// 2) Variable defined earlier in notebook (e.g., adata) → warning with tip
						try {
							const assignRe = new RegExp(`(^|\\n)\\s*${name}\\s*=`, "m");
							if (assignRe.test(globalCtx)) {
								promotedWarnings.push(
									`${err} — Tip: '${name}' is defined in a previous cell. Run that cell before this step.`
								);
								continue;
							}
						} catch (_) {}
					}
					filteredErrors.push(err);
				}

				result.lintedCode = fixResult.fixedCode;
				result.isValid = filteredErrors.length === 0; // Only remaining errors matter for validity
				result.validationErrors = filteredErrors; // These are errors only
				result.validationWarnings = promotedWarnings; // These are warnings only

				// Emit validation events (existing UI will handle the display)

				if (!result.isValid) {
					console.warn(
						`Code validation failed for ${stepTitle}:`,
						result.validationErrors,
						`(${result.validationWarnings.length} warnings also found)`
					);

					// Emit validation error event (will show in chat) - unless skipped
					if (!skipValidationEvents) {
						this.codeGenerationService.emitValidationErrors(
							stepId,
							result.validationErrors,
							result.validationWarnings,
							result.originalCode,
							result.lintedCode
						);
					}
					
					// Store validation data for manual emission if events are skipped
					if (skipValidationEvents) {
						result.validationEventData = {
							isValid: false,
							errors: result.validationErrors,
							warnings: result.validationWarnings,
							wasFixed: fixResult.wasFixed,
							originalCode: result.originalCode,
							lintedCode: result.lintedCode
						};
					}

					this.updateStatus(
						`⚠️ Code validation completed with remaining issues for ${stepTitle}`
					);
				} else {
					// Emit validation success event - unless skipped
					if (!skipValidationEvents) {
						// Only show success message if there were warnings or fixes applied
						if (result.validationWarnings.length > 0 || fixResult.wasFixed) {
							const usedLLMFallback = (fixResult as any).ruffSucceeded === false;
							const base = usedLLMFallback
								? `Code validation passed via LLM fallback (Ruff unavailable)`
								: `Code validation passed${fixResult.wasFixed ? ' (fixes applied)' : ''}`;
							const msg = `${base}${result.validationWarnings.length > 0 ? ` with ${result.validationWarnings.length} warning(s)` : ''}`;

							this.codeGenerationService.emitValidationSuccess(
								stepId,
								msg,
								result.lintedCode
							);
						}
					}
					
					// Store validation data for manual emission if events are skipped
					if (skipValidationEvents) {
						result.validationEventData = {
							isValid: true,
							errors: result.validationErrors,
							warnings: result.validationWarnings,
							wasFixed: fixResult.wasFixed,
							originalCode: result.originalCode,
							lintedCode: result.lintedCode
						};
					}
					this.updateStatus(`✅ Code validation passed for ${stepTitle}`);
				}

				if (fixResult.wasFixed) {
					this.updateStatus(`🔧 Code improvements applied for ${stepTitle}`);
				}
			} catch (error) {
				result.isValid = false;
				result.validationErrors.push(
					error instanceof Error ? error.message : "Unknown validation error"
				);
				console.error(`Validation error for ${stepTitle}:`, error);
			}
		}

		// Step 3: Execution Testing (disabled by default for performance)
		if (!skipExecution) {
			this.updateStatus(`Testing execution for ${stepTitle}...`);

			try {
				const executionResult = await this.cellExecutionService.executeCell(
					`test-${stepId}`,
					result.lintedCode,
					undefined
				);

				result.executionPassed = executionResult.status !== "failed";
				result.executionOutput = executionResult.output;

				if (executionResult.status === "failed") {
					result.executionError =
						executionResult.output || "Unknown execution error";
					this.updateStatus(`⚠️ Code execution failed for ${stepTitle}`);
				} else {
					this.updateStatus(`✅ Code execution passed for ${stepTitle}`);
				}
			} catch (error) {
				result.executionPassed = false;
				result.executionError =
					error instanceof Error ? error.message : "Unknown execution error";
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
	 * Simplified single-step code enhancement method
	 */
	enhanceCode(
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
			return "";
		}

		// Step 1: Normalize and clean
		let enhancedCode = normalizePythonCode(code);

		// Step 2: Only add imports if they're actually needed and missing from global context
		if (options.addImports) {
			enhancedCode = this.smartAddImports(
				enhancedCode,
				options.globalCodeContext
			);
		}

		// Step 3: Only add directory creation if needed and missing from global context
		if (
			options.addDirectoryCreation &&
			!this.hasDirectoryCreation(enhancedCode, options.globalCodeContext)
		) {
			enhancedCode = this.addDirectoryCreation(enhancedCode);
		}

		// Step 4: Add error handling only if explicitly requested
		if (options.addErrorHandling && !this.hasErrorHandling(enhancedCode)) {
			enhancedCode = this.addErrorHandling(
				enhancedCode,
				options.stepDescription
			);
		}

		return enhancedCode;
	}

	/**
	 * Smart import addition - only adds what's actually needed and missing
	 */
	private smartAddImports(code: string, globalCodeContext?: string): string {
		// Only add critical imports that are actually used in the code
		return this.ensureCriticalImports(code, globalCodeContext);
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
	private ensureCriticalImports(
		code: string,
		globalCodeContext?: string
	): string {
		const newImports: string[] = [];
		const codeImports = sharedGetExistingImports(code);
		const globalImports = sharedGetExistingImports(globalCodeContext || "");
		const existingImports = new Set([...codeImports, ...globalImports]);

		const needs = (pattern: RegExp | string) =>
			typeof pattern === "string" ? code.includes(pattern) : pattern.test(code);

		const missing = (importStatement: string) => {
			// Check if import exists in global context OR current code
			const combinedCode = `${globalCodeContext || ""}\n${code}`;
			return (
				!existingImports.has(importStatement) &&
				!combinedCode.includes(importStatement)
			);
		};

		// pathlib.Path
		if (
			(needs(/\bPath\s*\(/) || needs(/\.mkdir\s*\(/)) &&
			missing("from pathlib import Path")
		) {
			newImports.push("from pathlib import Path");
		}

		// requests
		if (needs(/\brequests\./) && missing("import requests")) {
			newImports.push("import requests");
		}

		// urlparse
		if (
			needs(/\burlparse\s*\(/) &&
			missing("from urllib.parse import urlparse")
		) {
			newImports.push("from urllib.parse import urlparse");
		}

		// os
		if (needs(/\bos\./) && missing("import os")) {
			newImports.push("import os");
		}

		// pandas
		if (needs(/\bpd\./) && missing("import pandas as pd")) {
			newImports.push("import pandas as pd");
		}

		// numpy
		if (needs(/\bnp\./) && missing("import numpy as np")) {
			newImports.push("import numpy as np");
		}

		// matplotlib
		if (needs(/\bplt\./) && missing("import matplotlib.pyplot as plt")) {
			newImports.push("import matplotlib.pyplot as plt");
		}

		// seaborn
		if (needs(/\bsns\./) && missing("import seaborn as sns")) {
			newImports.push("import seaborn as sns");
		}

		// scanpy (alias sc)
		if (
			(needs(/\bsc\./) || needs(/\bscanpy\./)) &&
			missing("import scanpy as sc")
		) {
			newImports.push("import scanpy as sc");
		}

		// anndata
		if (needs(/\banndata\./) && missing("import anndata")) {
			newImports.push("import anndata");
		}
		// anndata alias (ad)
		if (needs(/\bad\./) && missing("import anndata as ad")) {
			newImports.push("import anndata as ad");
		}

		if (newImports.length === 0) return code;

		// Use the shared utility to properly deduplicate
		const codeWithImports = `${newImports.join("\n")}\n\n${code}`;
		return sharedRemoveDuplicateImports(codeWithImports, new Set<string>());
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

	// fixValidationErrors method removed - now handled by LintAutoFixService

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

			// Minimal delay between tests
			if (i < codeSnippets.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, 25));
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
	private hasBasicImports(code: string, globalCodeContext?: string): boolean {
		const combinedCode = `${globalCodeContext || ""}\n${code}`;
		return (
			combinedCode.includes("import pandas") ||
			combinedCode.includes("import numpy") ||
			combinedCode.includes("import matplotlib") ||
			combinedCode.includes("import seaborn")
		);
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
			const existingImports = sharedGetExistingImports(globalCodeContext);
			return sharedRemoveDuplicateImports(basicImportsCode, existingImports);
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

	private hasDirectoryCreation(
		code: string,
		globalCodeContext?: string
	): boolean {
		const combinedCode = `${globalCodeContext || ""}\n${code}`;
		return (
			combinedCode.includes("mkdir") ||
			combinedCode.includes("results_dir") ||
			combinedCode.includes("figures_dir") ||
			combinedCode.includes("Path('results')") ||
			combinedCode.includes("Path('figures')")
		);
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
