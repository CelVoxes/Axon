import init, { Workspace, Diagnostic } from "@astral-sh/ruff-wasm-web";
import { isIndentationDiagnostic } from "./IndentationUtils";

export interface RuffDiagnostic {
	kind: "error" | "warning";
	code: string;
	message: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	fixable: boolean;
}

export interface RuffResult {
	isValid: boolean;
	diagnostics: RuffDiagnostic[];
	formattedCode?: string;
	fixedCode?: string;
}

/**
 * Frontend Ruff linter service for Python code validation
 * Replaces backend validation calls with WebAssembly Ruff
 */
export class RuffLinter {
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private workspace: Workspace | null = null;
	private readonly indentWidth = 4;

	constructor() {
		// Start initialization immediately when instance is created
		console.log(
			"RuffLinter: Constructor called, starting proactive initialization"
		);
		this.initPromise = this.initializeRuff();
	}

	/**
	 * Initialize Ruff WebAssembly module
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized && this.workspace) {
			return;
		}

		if (!this.initPromise) {
			this.initPromise = this.initializeRuff();
		}

		await this.initPromise;

		if (!this.workspace || !this.initialized) {
			throw new Error("Ruff initialization failed - workspace not ready");
		}
	}

	private async initializeRuff(): Promise<void> {
		try {
			// Simplified WASM initialization without excessive logging/delays
			const initPromise = init();

			if (initPromise && typeof initPromise.then === "function") {
				await initPromise;
				// Minimal delay for WASM readiness
				await new Promise((resolve) => setTimeout(resolve, 50));
			} else {
				// Synchronous init
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			// Create workspace with settings optimized for data science notebooks
			this.workspace = new Workspace({
				"line-length": 88,
				"indent-width": 4,
				format: {
					"indent-style": "space",
					"quote-style": "double",
				},
				lint: {
					select: [
						"E4", // Import formatting
						"E7", // Statement formatting
						"E9", // Runtime errors
						"F", // Pyflakes errors
						"W", // Warnings
					],
				},
			});
			this.initialized = true;
		} catch (error) {
			console.error("Failed to initialize Ruff WebAssembly:", error);
			throw new Error("Ruff initialization failed");
		}
	}

	/**
	 * Lint Python code using Ruff
	 */
	async lintCode(
		code: string,
		options: {
			enableFixes?: boolean;
			filename?: string;
			formatCode?: boolean; // default false for speed
		} = {}
	): Promise<RuffResult> {
		await this.ensureInitialized();

		if (!this.workspace) {
			throw new Error("Ruff workspace not initialized");
		}

		const enableFixes = options.enableFixes ?? true;
		const doFormat = options.formatCode ?? false;

		try {
			// Run Ruff check on the code - returns Diagnostic[]
			const ruffDiagnostics: Diagnostic[] = this.workspace.check(code);
			let currentRuffDiagnostics = ruffDiagnostics;

			// Convert Ruff diagnostics to our format
			let diagnostics = this.parseRuffOutput(currentRuffDiagnostics);

			let formattedCode: string | undefined;
			let fixedCode: string | undefined;

			// Format code (optional)
			if (doFormat) {
				try {
					formattedCode = this.workspace.format(code);
				} catch (formatError) {
					if (
						formatError instanceof Error &&
						/expected an indented block/i.test(formatError.message)
					) {
						// Keep Ruff diagnostics for accurate locations; formatter couldn't recover
						console.warn(
							"Ruff formatter could not fix indentation issues, continuing with lint diagnostics."
						);
					} else if (
						formatError instanceof Error &&
						/line \d+/i.test(formatError.message)
					) {
						// Capture formatter error details only when Ruff had no diagnostics
						if (!diagnostics.length) {
							const match = formatError.message.match(/line (\d+)(?:, column (\d+))?/i);
							const line = match ? parseInt(match[1], 10) : 1;
							const column =
								match && match[2] ? parseInt(match[2], 10) : 1;
							diagnostics.push({
								kind: "error",
								code: "E999",
								message: `Syntax error: ${formatError.message}`,
								startLine: line,
								startColumn: column,
								endLine: line,
								endColumn: column,
								fixable: false,
							});
						}
					} else {
						console.error("Ruff formatting failed:", formatError);
						if (!diagnostics.length) {
							diagnostics.push({
								kind: "error",
								code: "E999",
								message: `Syntax error: ${
									formatError instanceof Error
										? formatError.message
										: "Unknown formatting error"
								}`,
								startLine: 1,
								startColumn: 1,
								endLine: 1,
								endColumn: 1,
								fixable: false,
							});
						}
					}
					}
				}

				let isValid =
					diagnostics.filter((d) => d.kind === "error").length === 0;

			// Apply fixes if available and requested
			const fixableDiagnostics = diagnostics.filter((d) => d.fixable);
			if (enableFixes && fixableDiagnostics.length > 0) {
				try {
					fixedCode = this.applyRuffFixes(code, currentRuffDiagnostics);
				} catch (fixError) {
					// Fallback to formatted code
					fixedCode = formattedCode;
				}
			}

			let bestCandidate = fixedCode || formattedCode || code;

			if (enableFixes && diagnostics.some(isIndentationDiagnostic)) {
				const indentationFixed = this.tryFixIndentationIssues(
					bestCandidate,
					diagnostics
				);
				if (indentationFixed && indentationFixed !== bestCandidate) {
					try {
						const indentationDiagnosticsRaw =
							this.workspace.check(indentationFixed);
						const indentationDiagnostics = this.parseRuffOutput(
							indentationDiagnosticsRaw
						);
						const indentationFixable = indentationDiagnostics.filter(
							(d) => d.fixable
						);
						let indentationFixedCode = indentationFixed;
						if (indentationFixable.length > 0) {
							indentationFixedCode = this.applyRuffFixes(
								indentationFixed,
								indentationDiagnosticsRaw
							);
						}
						diagnostics = indentationDiagnostics;
						currentRuffDiagnostics = indentationDiagnosticsRaw;
						bestCandidate = indentationFixedCode;
						fixedCode = indentationFixedCode;
						isValid =
							diagnostics.filter((d) => d.kind === "error").length === 0;
					} catch (indentationError) {
						console.warn(
							"Indentation heuristic fix failed:",
							indentationError
						);
					}
				}
			}

			return {
				isValid,
				diagnostics,
				formattedCode,
				fixedCode,
			};
		} catch (error) {
			console.error("Ruff linting failed:", error);

			// Return basic validation result on error
			return {
				isValid: false,
				diagnostics: [
					{
						kind: "error",
						code: "RUFF001",
						message: `Ruff linting failed: ${
							error instanceof Error ? error.message : "Unknown error"
						}`,
						startLine: 1,
						startColumn: 1,
						endLine: 1,
						endColumn: 1,
						fixable: false,
					},
				],
			};
		}
	}

	/**
	 * Parse Ruff check output into structured diagnostics
	 */
	private parseRuffOutput(diagnostics: Diagnostic[]): RuffDiagnostic[] {
		const result: RuffDiagnostic[] = [];

		if (!Array.isArray(diagnostics)) {
			return result;
		}

		for (const diagnostic of diagnostics) {
			const ruffDiagnostic: RuffDiagnostic = {
				kind: this.getKindFromRuffCode(diagnostic.code || "UNKNOWN"),
				code: diagnostic.code || "UNKNOWN",
				message: diagnostic.message || "Unknown error",
				startLine: diagnostic.start_location?.row || 1,
				startColumn: diagnostic.start_location?.column || 1,
				endLine:
					diagnostic.end_location?.row || diagnostic.start_location?.row || 1,
				endColumn:
					diagnostic.end_location?.column ||
					diagnostic.start_location?.column ||
					1,
				fixable: diagnostic.fix ? true : false,
			};

			result.push(ruffDiagnostic);
		}

		return result;
	}

	private tryFixIndentationIssues(
		code: string,
		diagnostics: RuffDiagnostic[]
	): string | null {
		const indentationDiagnostics = diagnostics.filter(isIndentationDiagnostic);
		if (indentationDiagnostics.length === 0) {
			return null;
		}

		const lines = code.split("\n");
		let changed = false;

		for (const diagnostic of indentationDiagnostics) {
			const message = (diagnostic.message || "").toLowerCase();

			if (message.includes("expected an indented block")) {
				changed = this.fixExpectedIndentBlock(lines, diagnostic) || changed;
				continue;
			}

			if (
				message.includes("unexpected indent") ||
				message.includes("unexpected indentation")
			) {
				changed = this.fixUnexpectedIndent(lines, diagnostic) || changed;
			}
		}

		return changed ? lines.join("\n") : null;
	}

	private fixExpectedIndentBlock(
		lines: string[],
		diagnostic: RuffDiagnostic
	): boolean {
		const targetLineIndex = this.findFirstContentLine(lines, diagnostic.startLine - 1);
		if (targetLineIndex === -1) {
			return false;
		}

		const baseLineIndex = Math.max(
			0,
			Math.min(lines.length - 1, diagnostic.startLine - 1)
		);
		const baseIndent = this.getIndentation(lines[baseLineIndex]);
		const indentUnit = " ".repeat(this.indentWidth);
		const trimmed = lines[targetLineIndex].trimStart();
		const currentIndent = this.getIndentation(lines[targetLineIndex]);

		if (currentIndent.length > baseIndent.length) {
			return false;
		}

		const replacement = baseIndent + indentUnit + trimmed;
		if (lines[targetLineIndex] === replacement) {
			return false;
		}

		lines[targetLineIndex] = replacement;
		return true;
	}

	private fixUnexpectedIndent(
		lines: string[],
		diagnostic: RuffDiagnostic
	): boolean {
		const targetIndex = diagnostic.startLine - 1;
		if (targetIndex < 0 || targetIndex >= lines.length) {
			return false;
		}

		const trimmed = lines[targetIndex].trimStart();
		const expectedIndent = this.findPreviousIndent(lines, targetIndex);
		const replacement = expectedIndent + trimmed;

		if (lines[targetIndex] === replacement) {
			return false;
		}

		lines[targetIndex] = replacement;
		return true;
	}

	private findFirstContentLine(lines: string[], startIndex: number): number {
		for (let i = Math.max(0, startIndex + 1); i < lines.length; i++) {
			if (lines[i].trim().length === 0) {
				continue;
			}
			return i;
		}
		return -1;
	}

	private findPreviousIndent(lines: string[], index: number): string {
		for (let i = index - 1; i >= 0; i--) {
			const trimmed = lines[i].trim();
			if (trimmed.length === 0) {
				continue;
			}
			return this.getIndentation(lines[i]);
		}
		return "";
	}

	private getIndentation(line: string): string {
		const match = line.match(/^\s*/);
		return match ? match[0] : "";
	}

	/**
	 * Apply Ruff fixes to code
	 */
	private applyRuffFixes(code: string, diagnostics: Diagnostic[]): string {
		const lines = code.split("\n");

		// Sort fixes by position (end to start) to avoid offset issues
		const fixesToApply = diagnostics
			.filter((d) => {
				if (!d.fix || d.fix.edits.length === 0) return false;
				// Avoid auto-removing imports that appear unused (e.g., scanpy alias)
				return d.code !== "F401";
			})
			.flatMap((d) => d.fix!.edits)
			.sort((a, b) => {
				// Sort by line (descending), then by column (descending)
				if (a.location.row !== b.location.row) {
					return b.location.row - a.location.row;
				}
				return b.location.column - a.location.column;
			});

		if (fixesToApply.length === 0) {
			return code;
		}

		for (const edit of fixesToApply) {
			const startLine = edit.location.row - 1; // Convert to 0-based
			const startCol = edit.location.column - 1;
			const endLine = edit.end_location.row - 1;
			const endCol = edit.end_location.column - 1;

			if (startLine < 0 || startLine >= lines.length) continue;

			if (startLine === endLine) {
				// Single line edit
				const line = lines[startLine];
				const before = line.substring(0, startCol);
				const after = line.substring(endCol);
				lines[startLine] = before + (edit.content || "") + after;
			} else {
				// Multi-line edit
				const firstLine = lines[startLine];
				const lastLine = lines[endLine];
				const before = firstLine.substring(0, startCol);
				const after = lastLine.substring(endCol);

				// Replace the range with the fix content
				const replacement = [before + (edit.content || "") + after];
				lines.splice(startLine, endLine - startLine + 1, ...replacement);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Determine diagnostic kind based on Ruff rule code
	 */
	private getKindFromRuffCode(code: string): "error" | "warning" {
		if (!code) return "error";

		// Most Ruff rules are errors except for some specific categories
		const warningPrefixes = ["W", "C90", "N8"];
		const isWarning = warningPrefixes.some((prefix) => code.startsWith(prefix));

		return isWarning ? "warning" : "error";
	}

	/**
	 * Format Python code using Ruff formatter
	 */
	async formatCode(code: string, filename = "cell.py"): Promise<string> {
		await this.ensureInitialized();

		if (!this.workspace) {
			throw new Error("Ruff workspace not initialized");
		}

		try {
			return this.workspace.format(code);
		} catch (error) {
			console.error("Ruff formatting failed:", error);
			// Return original code if formatting fails
			return code;
		}
	}

	/**
	 * Quick syntax validation (lightweight check)
	 */
	async validateSyntax(
		code: string
	): Promise<{ isValid: boolean; error?: string }> {
		try {
			const result = await this.lintCode(code, { enableFixes: false });
			const syntaxErrors = result.diagnostics.filter(
				(d) => d.code.startsWith("E") || d.code.startsWith("F")
			);

			return {
				isValid: syntaxErrors.length === 0,
				error: syntaxErrors[0]?.message,
			};
		} catch (error) {
			return {
				isValid: false,
				error:
					error instanceof Error ? error.message : "Syntax validation failed",
			};
		}
	}
}

// Export singleton instance
export const ruffLinter = new RuffLinter();
