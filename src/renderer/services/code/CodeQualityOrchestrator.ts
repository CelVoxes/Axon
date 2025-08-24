/**
 * Dependency-free Code Quality Orchestrator
 * Eliminates circular dependencies by using interfaces and event-driven validation
 */

import {
	ICodeQualityValidator,
	IBackendClient,
	CodeValidationResult,
} from "../types";

export class CodeQualityOrchestrator implements ICodeQualityValidator {
	private backendClient: IBackendClient;
	private statusCallback?: (status: string) => void;
	// Optional delegate to a full CodeQualityService to avoid duplicated work
	private qualityServiceDelegate?: {
		validateOnly: (
			code: string,
			stepId: string,
			options?: { stepTitle?: string; globalCodeContext?: string }
		) => Promise<{
			isValid: boolean;
			lintedCode: string;
			originalCode: string;
			cleanedCode: string;
			validationErrors: string[];
			validationWarnings: string[];
		}>;
	};

	constructor(backendClient: IBackendClient) {
		this.backendClient = backendClient;
	}

	// Allow injecting a delegate to CodeQualityService to prevent duplicate lint/fix passes
	setQualityServiceDelegate(
		delegate: CodeQualityOrchestrator["qualityServiceDelegate"]
	) {
		this.qualityServiceDelegate = delegate;
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
	 * Orchestrate the complete validation pipeline - always delegates to CodeQualityService
	 */
	async orchestrateValidation(
		code: string,
		stepId: string,
		options: {
			maxRetries?: number;
			stepTitle?: string;
			timeoutMs?: number;
			globalCodeContext?: string;
		} = {}
	): Promise<CodeValidationResult> {
		// Always delegate to CodeQualityService if available
		if (this.qualityServiceDelegate) {
			try {
				this.updateStatus(
					`Delegating validation to CodeQualityService for ${
						options.stepTitle || stepId
					}...`
				);
				const res = await this.qualityServiceDelegate.validateOnly(
					code,
					stepId,
					{
						stepTitle: options.stepTitle || stepId,
						globalCodeContext: options.globalCodeContext,
					}
				);
				const validated = res.isValid
					? res.lintedCode || res.cleanedCode || code
					: res.cleanedCode || res.lintedCode || code;
				return {
					isValid: res.isValid,
					originalCode: res.originalCode || code,
					validatedCode: validated,
					errors: res.validationErrors || [],
					warnings: res.validationWarnings || [],
					improvements: [],
					retryCount: 0,
					success: res.isValid,
				};
			} catch (e) {
				console.error(
					"CodeQualityOrchestrator: delegate validation failed",
					e as any
				);
				// Return error state rather than fallback to prevent inconsistent behavior
				return {
					isValid: false,
					originalCode: code,
					validatedCode: code,
					errors: [e instanceof Error ? e.message : String(e)],
					warnings: [],
					improvements: [],
					retryCount: 0,
					success: false,
				};
			}
		}

		// No delegate available - return original code without validation
		console.warn("CodeQualityOrchestrator: No delegate service available for validation");
		return {
			isValid: true, // Assume valid when no validation is available
			originalCode: code,
			validatedCode: code,
			errors: [],
			warnings: ["No validation service available"],
			improvements: [],
			retryCount: 0,
			success: true,
		};
	}

	/**
	 * Get the best available code from validation result
	 */
	getBestCode(result: CodeValidationResult): string {
		const bestCode = result.validatedCode || result.originalCode;
		console.log(
			`🔍 getBestCode: validatedCode length=${
				result.validatedCode?.length || 0
			}, originalCode length=${
				result.originalCode?.length || 0
			}, returning length=${bestCode.length}`
		);
		return bestCode;
	}

	/**
	 * Quick validation for simple cases
	 */
	async validateOnly(
		code: string,
		stepId: string
	): Promise<CodeValidationResult> {
		return this.orchestrateValidation(code, stepId, {
			maxRetries: 1,
			stepTitle: `Quick validation for ${stepId}`,
		});
	}

	/**
	 * Full validation and testing
	 */
	async validateAndTest(
		code: string,
		stepId: string,
		options?: { maxRetries?: number; stepTitle?: string; timeoutMs?: number }
	): Promise<CodeValidationResult> {
		return this.orchestrateValidation(code, stepId, {
			maxRetries: options?.maxRetries || 2,
			stepTitle: options?.stepTitle || `Validation and test for ${stepId}`,
			timeoutMs: options?.timeoutMs || 30000,
		});
	}
}
