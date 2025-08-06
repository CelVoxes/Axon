/**
 * Dependency-free Code Quality Orchestrator
 * Eliminates circular dependencies by using interfaces and event-driven validation
 */

import { 
	ICodeQualityValidator, 
	IBackendClient,
	CodeQualityOptions,
	CodeValidationResult
} from "./types";

export class CodeQualityOrchestrator implements ICodeQualityValidator {
	private backendClient: IBackendClient;
	private statusCallback?: (status: string) => void;
	
	constructor(backendClient: IBackendClient) {
		this.backendClient = backendClient;
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
	 * Pure syntax and structure validation without external dependencies
	 */
	async validateSyntaxAndStructure(code: string): Promise<{
		isValid: boolean;
		errors: string[];
		warnings: string[];
		suggestions: string[];
	}> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];
		
		try {
			// Basic syntax checks
			if (!code.trim()) {
				errors.push("Code is empty");
				return { isValid: false, errors, warnings, suggestions };
			}
			
			// Check for common Python syntax issues
			const lines = code.split('\n');
			let indentationLevel = 0;
			let inTripleQuote = false;
			let hasImports = false;
			
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimmedLine = line.trim();
				
				// Skip empty lines and comments
				if (!trimmedLine || trimmedLine.startsWith('#')) continue;
				
				// Track triple quotes
				if (trimmedLine.includes('"""') || trimmedLine.includes("'''")) {
					inTripleQuote = !inTripleQuote;
					continue;
				}
				if (inTripleQuote) continue;
				
				// Check for imports
				if (trimmedLine.startsWith('import ') || trimmedLine.startsWith('from ')) {
					hasImports = true;
				}
				
				// Basic indentation check
				const leadingSpaces = line.length - line.trimLeft().length;
				if (line.includes('\t')) {
					warnings.push(`Line ${i + 1}: Mixed tabs and spaces detected`);
				}
				
				// Skip colon validation - too many false positives with valid Python constructs
				// (dictionary comprehensions, lambda expressions, type hints, etc.)
				
				// Check for missing imports
				if (trimmedLine.includes('plt.') && !code.includes('matplotlib')) {
					suggestions.push("Consider importing matplotlib.pyplot as plt");
				}
				if (trimmedLine.includes('pd.') && !code.includes('pandas')) {
					suggestions.push("Consider importing pandas as pd");
				}
				if (trimmedLine.includes('np.') && !code.includes('numpy')) {
					suggestions.push("Consider importing numpy as np");
				}
			}
			
			// Structural suggestions
			if (!hasImports && code.includes('.')) {
				suggestions.push("Consider adding necessary imports at the top");
			}
			
			if (!code.includes('try:') && code.length > 200) {
				suggestions.push("Consider adding error handling with try-except blocks");
			}
			
			return {
				isValid: errors.length === 0,
				errors,
				warnings,
				suggestions
			};
			
		} catch (error) {
			errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
			return { isValid: false, errors, warnings, suggestions };
		}
	}
	
	/**
	 * Validate code using LLM through backend client
	 */
	async validateWithLLM(code: string, context: string): Promise<{
		isValid: boolean;
		fixedCode?: string;
		suggestions: string[];
	}> {
		try {
			this.updateStatus("Validating code with AI...");
			
			const response = await this.backendClient.validateCode({
				code,
				language: "python",
				context
			});
			
			return {
				isValid: response.is_valid || false,
				fixedCode: response.fixed_code,
				suggestions: response.suggestions || []
			};
			
		} catch (error) {
			console.error("LLM validation failed:", error);
			return {
				isValid: false,
				suggestions: ["LLM validation unavailable - proceeding with basic validation"]
			};
		}
	}
	
	/**
	 * Orchestrate the complete validation pipeline
	 */
	async orchestrateValidation(
		code: string,
		stepId: string,
		options: CodeQualityOptions = {}
	): Promise<CodeValidationResult> {
		const maxRetries = options.maxRetries || 2;
		let retryCount = 0;
		let bestCode = code;
		let allErrors: string[] = [];
		let allWarnings: string[] = [];
		let allImprovements: string[] = [];
		
		console.log(`🔍 CodeQualityOrchestrator: Starting validation for ${stepId}`);
		console.log(`🔍 Code length: ${code.length}`);
		console.log(`🔍 Code preview: ${code.substring(0, 200)}...`);
		
		this.updateStatus(`Validating code for ${options.stepTitle || stepId}...`);
		
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				// Step 1: Basic syntax validation
				const syntaxResult = await this.validateSyntaxAndStructure(bestCode);
				allWarnings.push(...syntaxResult.warnings);
				allImprovements.push(...syntaxResult.suggestions);
				
				console.log(`🔍 Syntax validation result: isValid=${syntaxResult.isValid}, errors=${syntaxResult.errors.length}, warnings=${syntaxResult.warnings.length}`);
				
				if (!syntaxResult.isValid) {
					console.log(`🔍 Syntax validation failed with errors:`, syntaxResult.errors);
					allErrors.push(...syntaxResult.errors);
					
					// If basic validation fails, try to fix with LLM
					if (attempt < maxRetries) {
						this.updateStatus(`Attempting to fix syntax errors (attempt ${attempt + 1})...`);
						
						const llmResult = await this.validateWithLLM(
							bestCode,
							`Fix these syntax errors: ${syntaxResult.errors.join(', ')}`
						);
						
						if (llmResult.fixedCode) {
							bestCode = llmResult.fixedCode;
							retryCount++;
							continue;
						}
					}
					
					// If we can't fix it, return the validation result
					return {
						isValid: false,
						originalCode: code,
						validatedCode: bestCode,
						errors: allErrors,
						warnings: allWarnings,
						improvements: allImprovements,
						retryCount,
						success: false
					};
				}
				
				// Step 2: LLM enhancement (optional)
				if (attempt === 0) { // Only try LLM enhancement on first attempt
					const llmResult = await this.validateWithLLM(
						bestCode,
						`Improve this code: ${options.stepTitle || 'analysis step'}`
					);
					
					allImprovements.push(...llmResult.suggestions);
					
					// If LLM suggests improvements, validate them
					if (llmResult.fixedCode && llmResult.fixedCode !== bestCode) {
						const improvedSyntaxResult = await this.validateSyntaxAndStructure(llmResult.fixedCode);
						
						if (improvedSyntaxResult.isValid) {
							bestCode = llmResult.fixedCode;
							this.updateStatus("Code improved with AI suggestions");
						}
					}
				}
				
				// Validation successful
				console.log(`🔍 Validation successful! Final code length: ${bestCode.length}`);
				this.updateStatus("Code validation completed successfully");
				
				return {
					isValid: true,
					originalCode: code,
					validatedCode: bestCode,
					errors: allErrors,
					warnings: allWarnings,
					improvements: allImprovements,
					retryCount,
					success: true
				};
				
			} catch (error) {
				const errorMsg = `Validation attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : String(error)}`;
				allErrors.push(errorMsg);
				retryCount++;
				
				if (attempt === maxRetries) {
					return {
						isValid: false,
						originalCode: code,
						validatedCode: bestCode,
						errors: allErrors,
						warnings: allWarnings,
						improvements: allImprovements,
						retryCount,
						success: false
					};
				}
			}
		}
		
		// Fallback return (should not reach here)
		return {
			isValid: false,
			originalCode: code,
			validatedCode: bestCode,
			errors: ["Maximum validation attempts exceeded"],
			warnings: allWarnings,
			improvements: allImprovements,
			retryCount,
			success: false
		};
	}
	
	/**
	 * Get the best available code from validation result
	 */
	getBestCode(result: CodeValidationResult): string {
		const bestCode = result.validatedCode || result.originalCode;
		console.log(`🔍 getBestCode: validatedCode length=${result.validatedCode?.length || 0}, originalCode length=${result.originalCode?.length || 0}, returning length=${bestCode.length}`);
		return bestCode;
	}
	
	/**
	 * Quick validation for simple cases
	 */
	async validateOnly(code: string, stepId: string): Promise<CodeValidationResult> {
		return this.orchestrateValidation(code, stepId, {
			maxRetries: 1,
			stepTitle: `Quick validation for ${stepId}`
		});
	}

	/**
	 * Full validation and testing
	 */
	async validateAndTest(
		code: string,
		stepId: string,
		options?: CodeQualityOptions
	): Promise<CodeValidationResult> {
		return this.orchestrateValidation(code, stepId, {
			maxRetries: options?.maxRetries || 2,
			stepTitle: options?.stepTitle || `Validation and test for ${stepId}`,
			timeoutMs: options?.timeoutMs || 30000
		});
	}
}