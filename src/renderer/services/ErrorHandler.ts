import { StatusManager } from "./StatusManager";

export interface ErrorInfo {
	message: string;
	code?: string;
	details?: any;
	source: string;
	timestamp: Date;
	severity: "low" | "medium" | "high" | "critical";
	recoverable: boolean;
}

export interface ErrorHandlerConfig {
	enableLogging?: boolean;
	enableNotifications?: boolean;
	recoveryStrategies?: Map<string, () => Promise<void>>;
}

export class ErrorHandler {
	private statusManager: StatusManager;
	private config: ErrorHandlerConfig;
	private static instance: ErrorHandler;

	constructor(config: ErrorHandlerConfig = {}) {
		this.config = {
			enableLogging: true,
			enableNotifications: true,
			recoveryStrategies: new Map(),
			...config,
		};
		this.statusManager = StatusManager.getInstance();
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(config?: ErrorHandlerConfig): ErrorHandler {
		if (!ErrorHandler.instance) {
			ErrorHandler.instance = new ErrorHandler(config);
		}
		return ErrorHandler.instance;
	}

	/**
	 * Handle an error with standardized processing
	 */
	handleError(
		error: Error | string,
		source: string,
		severity: ErrorInfo["severity"] = "medium",
		recoverable: boolean = true,
		details?: any
	): ErrorInfo {
		const errorInfo: ErrorInfo = {
			message: typeof error === "string" ? error : error.message,
			code:
				typeof error === "object" && "code" in error
					? (error as any).code
					: undefined,
			details,
			source,
			timestamp: new Date(),
			severity,
			recoverable,
		};

		// Log the error
		if (this.config.enableLogging) {
			console.error(`[${source}] ${severity.toUpperCase()}:`, errorInfo);
		}

		// Update status
		const statusType =
			severity === "critical" || severity === "high" ? "error" : "warning";
		this.statusManager.updateStatus(errorInfo.message, statusType, source);

		// Attempt recovery if possible
		if (recoverable && this.config.recoveryStrategies?.has(source)) {
			this.attemptRecovery(source, errorInfo);
		}

		return errorInfo;
	}

	/**
	 * Handle async errors with proper error boundaries
	 */
	async handleAsyncError<T>(
		asyncOperation: () => Promise<T>,
		source: string,
		severity: ErrorInfo["severity"] = "medium",
		fallback?: T
	): Promise<T> {
		try {
			return await asyncOperation();
		} catch (error) {
			this.handleError(error as Error | string, source, severity, true);
			if (fallback !== undefined) {
				return fallback;
			}
			throw error;
		}
	}

	/**
	 * Add a recovery strategy for a specific source
	 */
	addRecoveryStrategy(source: string, strategy: () => Promise<void>) {
		this.config.recoveryStrategies?.set(source, strategy);
	}

	/**
	 * Attempt to recover from an error
	 */
	private async attemptRecovery(source: string, errorInfo: ErrorInfo) {
		const strategy = this.config.recoveryStrategies?.get(source);
		if (strategy) {
			try {
				this.statusManager.updateStatus(
					`Attempting recovery for ${source}...`,
					"info",
					source
				);
				await strategy();
				this.statusManager.success(`Recovery successful for ${source}`, source);
			} catch (recoveryError) {
				this.statusManager.error(
					`Recovery failed for ${source}: ${recoveryError}`,
					source
				);
			}
		}
	}

	/**
	 * Create a safe wrapper for operations that might fail
	 */
	createSafeWrapper<T>(
		operation: () => T | Promise<T>,
		source: string,
		severity: ErrorInfo["severity"] = "medium",
		fallback?: T
	): () => T | Promise<T> {
		return async () => {
			try {
				const result = operation();
				return result instanceof Promise ? await result : result;
			} catch (error) {
				this.handleError(error as Error | string, source, severity, true);
				if (fallback !== undefined) {
					return fallback;
				}
				throw error;
			}
		};
	}

	/**
	 * Validate input parameters
	 */
	validateInput<T>(
		input: T,
		validator: (input: T) => boolean,
		source: string,
		errorMessage: string
	): T {
		if (!validator(input)) {
			this.handleError(errorMessage, source, "medium", true);
			throw new Error(errorMessage);
		}
		return input;
	}

	/**
	 * Handle network errors specifically
	 */
	handleNetworkError(error: any, source: string): ErrorInfo {
		const isNetworkError =
			error.code === "NETWORK_ERROR" ||
			error.message?.includes("network") ||
			error.message?.includes("fetch");

		return this.handleError(
			error,
			source,
			isNetworkError ? "medium" : "high",
			true,
			{ isNetworkError }
		);
	}

	/**
	 * Handle API errors specifically
	 */
	handleAPIError(error: any, source: string, endpoint?: string): ErrorInfo {
		return this.handleError(error, source, "medium", true, {
			endpoint,
			statusCode: error.status,
		});
	}
}
