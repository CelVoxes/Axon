/**
 * Centralized error handling utilities
 */

export class ErrorUtils {
	/**
	 * Extract error message from any error type
	 */
	static getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	/**
	 * Log error with consistent format
	 */
	static logError(context: string, error: unknown): void {
		console.error(`${context}:`, error);
	}

	/**
	 * Handle error with logging and message extraction
	 */
	static handleError(context: string, error: unknown): string {
		ErrorUtils.logError(context, error);
		return ErrorUtils.getErrorMessage(error);
	}

	/**
	 * Create standard error response
	 */
	static createErrorResponse(error: unknown, success = false): {
		success: boolean;
		error: string;
	} {
		return {
			success,
			error: ErrorUtils.getErrorMessage(error),
		};
	}
}