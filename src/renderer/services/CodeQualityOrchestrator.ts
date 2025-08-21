/**
 * Dependency-free Code Quality Orchestrator
 * Eliminates circular dependencies by using interfaces and event-driven validation
 */

import {
	ICodeQualityValidator,
	IBackendClient,
	CodeValidationResult,
} from "./types";
import { ruffLinter } from "./RuffLinter";
import { EventManager } from "../utils/EventManager";

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
	setQualityServiceDelegate(delegate: CodeQualityOrchestrator["qualityServiceDelegate"]) {
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
	 * Orchestrate the complete validation pipeline
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

		// If a quality service delegate is available, use it as the single source of truth
		if (this.qualityServiceDelegate) {
			try {
				this.updateStatus(`Delegating validation to CodeQualityService for ${options.stepTitle || stepId}...`);
				const res = await this.qualityServiceDelegate.validateOnly(code, stepId, {
					stepTitle: options.stepTitle || stepId,
					globalCodeContext: options.globalCodeContext,
				});
				const validated = res.isValid ? (res.lintedCode || res.cleanedCode || code) : (res.cleanedCode || res.lintedCode || code);
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
				console.warn("CodeQualityOrchestrator: delegate validation failed, falling back", e as any);
			}
		}

		// Simple Ruff-only validation fallback when no delegate is set
        try {
            this.updateStatus(`Validating code with Ruff for ${options.stepTitle || stepId}...`);
            const ruffResult = await ruffLinter.lintCode(code, {
                enableFixes: true,
                filename: `${(options.stepTitle || stepId).replace(/\s+/g, "_").toLowerCase()}.py`,
            });
            const errors = ruffResult.diagnostics
                .filter((d) => d.kind === "error")
                .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`);
            const warnings = ruffResult.diagnostics
                .filter((d) => d.kind === "warning")
                .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`);

            // Emit UI events so chat can reflect validation outcome (fallback path)
            try {
                if (errors.length > 0) {
                    EventManager.dispatchEvent("code-validation-error", {
                        stepId,
                        errors,
                        warnings,
                        originalCode: code,
                        fixedCode: ruffResult.fixedCode || ruffResult.formattedCode,
                        timestamp: Date.now(),
                    } as any);
                } else {
                    EventManager.dispatchEvent("code-validation-success", {
                        stepId,
                        message: `No linter errors found`,
                        code: ruffResult.fixedCode || ruffResult.formattedCode || code,
                        timestamp: Date.now(),
                    } as any);
                }
            } catch (_) {}

            return {
                isValid: ruffResult.isValid,
                originalCode: code,
                validatedCode: ruffResult.fixedCode || ruffResult.formattedCode || code,
                errors: errors,
                warnings: warnings,
                improvements: [],
                retryCount: 0,
                success: ruffResult.isValid,
            };
		} catch (e) {
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

			// Validation handled above via delegate or Ruff fallback.
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
