import init, { Workspace, Diagnostic } from '@astral-sh/ruff-wasm-web';

export interface RuffDiagnostic {
	kind: 'error' | 'warning';
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

	/**
	 * Initialize Ruff WebAssembly module
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		
		if (!this.initPromise) {
			this.initPromise = this.initializeRuff();
		}
		
		await this.initPromise;
	}

	private async initializeRuff(): Promise<void> {
		try {
			await init();
			// Create workspace with settings optimized for data science notebooks
			this.workspace = new Workspace({
				'line-length': 88,
				'indent-width': 4,
				format: {
					'indent-style': 'space',
					'quote-style': 'double',
				},
				lint: {
					select: [
						'E4',  // Import formatting
						'E7',  // Statement formatting  
						'E9',  // Runtime errors
						'F',   // Pyflakes errors
						'W'    // Warnings
					],
				},
			});
			this.initialized = true;
			console.log('Ruff WebAssembly initialized successfully');
		} catch (error) {
			console.error('Failed to initialize Ruff WebAssembly:', error);
			throw new Error('Ruff initialization failed');
		}
	}

	/**
	 * Lint Python code using Ruff
	 */
	async lintCode(code: string, options: {
		enableFixes?: boolean;
		filename?: string;
	} = {}): Promise<RuffResult> {
		await this.ensureInitialized();

		if (!this.workspace) {
			throw new Error('Ruff workspace not initialized');
		}

		const enableFixes = options.enableFixes ?? true;

		try {
			// Run Ruff check on the code - returns Diagnostic[]
			const ruffDiagnostics: Diagnostic[] = this.workspace.check(code);

			// Convert Ruff diagnostics to our format
			const diagnostics = this.parseRuffOutput(ruffDiagnostics);
			const isValid = diagnostics.filter(d => d.kind === 'error').length === 0;

			let formattedCode: string | undefined;
			let fixedCode: string | undefined;

			// Format code
			try {
				formattedCode = this.workspace.format(code);
			} catch (formatError) {
				console.warn('Ruff formatting failed:', formatError);
				// If formatting fails due to syntax issues, mark as invalid
				if (formatError instanceof Error && formatError.message.includes('Expected an indented block')) {
					return {
						isValid: false,
						diagnostics: [{
							kind: 'error',
							code: 'E999',
							message: `Syntax error: ${formatError.message}`,
							startLine: 1,
							startColumn: 1,
							endLine: 1,
							endColumn: 1,
							fixable: false,
						}],
						formattedCode: undefined,
						fixedCode: undefined,
					};
				}
			}

			// Apply fixes if available and requested
			if (enableFixes && diagnostics.some(d => d.fixable)) {
				try {
					console.log('🔧 Attempting to apply fixes for', diagnostics.filter(d => d.fixable).length, 'fixable issues');
					fixedCode = this.applyRuffFixes(code, ruffDiagnostics);
					console.log('🔧 Fixed code length:', fixedCode.length, 'vs original:', code.length);
					console.log('🔧 Code changed:', fixedCode !== code);
				} catch (fixError) {
					console.warn('Ruff fix application failed:', fixError);
					// Fallback to formatted code
					fixedCode = formattedCode;
				}
			}

			return {
				isValid,
				diagnostics,
				formattedCode,
				fixedCode,
			};

		} catch (error) {
			console.error('Ruff linting failed:', error);
			
			// Return basic validation result on error
			return {
				isValid: false,
				diagnostics: [{
					kind: 'error',
					code: 'RUFF001',
					message: `Ruff linting failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
					startLine: 1,
					startColumn: 1,
					endLine: 1,
					endColumn: 1,
					fixable: false,
				}],
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
				kind: this.getKindFromRuffCode(diagnostic.code || 'UNKNOWN'),
				code: diagnostic.code || 'UNKNOWN',
				message: diagnostic.message || 'Unknown error',
				startLine: diagnostic.start_location?.row || 1,
				startColumn: diagnostic.start_location?.column || 1,
				endLine: diagnostic.end_location?.row || diagnostic.start_location?.row || 1,
				endColumn: diagnostic.end_location?.column || diagnostic.start_location?.column || 1,
				fixable: diagnostic.fix ? true : false,
			};

			result.push(ruffDiagnostic);
		}

		return result;
	}

	/**
	 * Apply Ruff fixes to code
	 */
	private applyRuffFixes(code: string, diagnostics: Diagnostic[]): string {
		console.log('🔧 applyRuffFixes: Total diagnostics:', diagnostics.length);
		
		const lines = code.split('\n');
		
		// Sort fixes by position (end to start) to avoid offset issues
		const fixesToApply = diagnostics
			.filter(d => d.fix && d.fix.edits.length > 0)
			.flatMap(d => d.fix!.edits)
			.sort((a, b) => {
				// Sort by line (descending), then by column (descending)
				if (a.location.row !== b.location.row) {
					return b.location.row - a.location.row;
				}
				return b.location.column - a.location.column;
			});

		console.log('🔧 applyRuffFixes: Fixes to apply:', fixesToApply.length);
		
		if (fixesToApply.length === 0) {
			console.log('🔧 applyRuffFixes: No fixes to apply');
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
				lines[startLine] = before + (edit.content || '') + after;
			} else {
				// Multi-line edit
				const firstLine = lines[startLine];
				const lastLine = lines[endLine];
				const before = firstLine.substring(0, startCol);
				const after = lastLine.substring(endCol);
				
				// Replace the range with the fix content
				const replacement = [before + (edit.content || '') + after];
				lines.splice(startLine, endLine - startLine + 1, ...replacement);
			}
		}
		
		return lines.join('\n');
	}

	/**
	 * Determine diagnostic kind based on Ruff rule code
	 */
	private getKindFromRuffCode(code: string): 'error' | 'warning' {
		if (!code) return 'error';

		// Most Ruff rules are errors except for some specific categories
		const warningPrefixes = ['W', 'C90', 'N8'];
		const isWarning = warningPrefixes.some(prefix => code.startsWith(prefix));
		
		return isWarning ? 'warning' : 'error';
	}

	/**
	 * Format Python code using Ruff formatter
	 */
	async formatCode(code: string, filename = 'cell.py'): Promise<string> {
		await this.ensureInitialized();

		if (!this.workspace) {
			throw new Error('Ruff workspace not initialized');
		}

		try {
			return this.workspace.format(code);
		} catch (error) {
			console.error('Ruff formatting failed:', error);
			// Return original code if formatting fails
			return code;
		}
	}

	/**
	 * Quick syntax validation (lightweight check)
	 */
	async validateSyntax(code: string): Promise<{ isValid: boolean; error?: string }> {
		try {
			const result = await this.lintCode(code, { enableFixes: false });
			const syntaxErrors = result.diagnostics.filter(d => 
				d.code.startsWith('E') || d.code.startsWith('F')
			);

			return {
				isValid: syntaxErrors.length === 0,
				error: syntaxErrors[0]?.message,
			};
		} catch (error) {
			return {
				isValid: false,
				error: error instanceof Error ? error.message : 'Syntax validation failed',
			};
		}
	}
}

// Export singleton instance
export const ruffLinter = new RuffLinter();