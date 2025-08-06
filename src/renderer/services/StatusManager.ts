/**
 * Centralized StatusManager for consistent status management across the application
 */
export type StatusCallback = (status: StatusUpdate) => void;

export interface ErrorInfo {
	message: string;
	code?: string;
	details?: any;
	source: string;
	timestamp: Date;
	severity: "low" | "medium" | "high" | "critical";
	recoverable: boolean;
}

export interface StatusUpdate {
	message: string;
	type: "info" | "success" | "warning" | "error" | "progress";
	progress?: number;
	timestamp: Date;
	source?: string;
}

export interface StatusManagerConfig {
	enableLogging?: boolean;
	enableProgress?: boolean;
	statusTimeout?: number;
    enableNotifications?: boolean;
	recoveryStrategies?: Map<string, () => Promise<void>>;
}

export class StatusManager {
	private statusCallback?: StatusCallback;
	private config: StatusManagerConfig;
	private static instance: StatusManager;

	private constructor(config: StatusManagerConfig = {}) {
		this.config = {
			enableLogging: true,
			enableProgress: true,
			statusTimeout: 5000,
            enableNotifications: true,
			recoveryStrategies: new Map(),
			...config,
		};
	}

	static getInstance(config?: StatusManagerConfig): StatusManager {
		if (!StatusManager.instance) {
			StatusManager.instance = new StatusManager(config);
		}
		return StatusManager.instance;
	}

	setStatusCallback(callback: StatusCallback) {
		this.statusCallback = callback;
	}

	updateStatus(
		message: string,
		type: StatusUpdate["type"] = "info",
		source?: string
	) {
		const statusUpdate: StatusUpdate = {
			message,
			type,
			timestamp: new Date(),
			source,
		};

		if (this.statusCallback) {
			this.statusCallback(statusUpdate);
		}

		if (this.config.enableLogging) {
			console.log(
				`[${source || "StatusManager"}] ${type.toUpperCase()}: ${message}`
			);
		}
	}

    // --- Start of Merged ErrorHandler Logic ---

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
		this.updateStatus(errorInfo.message, statusType, source);

		// Attempt recovery if possible
		if (recoverable && this.config.recoveryStrategies?.has(source)) {
			this.attemptRecovery(source, errorInfo);
		}

		return errorInfo;
	}

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

	addRecoveryStrategy(source: string, strategy: () => Promise<void>) {
		this.config.recoveryStrategies?.set(source, strategy);
	}

	private async attemptRecovery(source: string, errorInfo: ErrorInfo) {
		const strategy = this.config.recoveryStrategies?.get(source);
		if (strategy) {
			try {
				this.updateStatus(
					`Attempting recovery for ${source}...`,
					"info",
					source
				);
				await strategy();
				this.success(`Recovery successful for ${source}`, source);
			} catch (recoveryError) {
				this.error(
					`Recovery failed for ${source}: ${recoveryError}`,
					"StatusManager"
				);
			}
		}
	}

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

	handleAPIError(error: any, source: string, endpoint?: string): ErrorInfo {
		return this.handleError(error, source, "medium", true, {
			endpoint,
			statusCode: error.status,
		});
	}

    // --- End of Merged ErrorHandler Logic ---


	updateStatusWithProgress(message: string, progress: number, source?: string) {
		const statusUpdate: StatusUpdate = {
			message,
			type: "progress",
			progress,
			timestamp: new Date(),
			source,
		};

		if (this.statusCallback) {
			this.statusCallback(statusUpdate);
		}

		if (this.config.enableLogging) {
			console.log(
				`[${source || "StatusManager"}] PROGRESS: ${message} (${progress}%)`
			);
		}
	}

	updateStatusFormatted(
		step: string,
		message: string,
		type: StatusUpdate["type"] = "info",
		source?: string
	) {
		this.updateStatus(`${step}: ${message}`, type, source);
	}

	chainStatusUpdates(
		updates: Array<{
			message: string;
			type?: StatusUpdate["type"];
			delay?: number;
		}>,
		source?: string
	) {
		updates.forEach((update, index) => {
			setTimeout(() => {
				this.updateStatus(update.message, update.type || "info", source);
			}, (update.delay || 100) * index);
		});
	}

	success(message: string, source?: string) {
		this.updateStatus(message, "success", source);
	}

	warning(message: string, source?: string) {
		this.updateStatus(message, "warning", source);
	}

	error(message: string | Error, source: string, details?: any) {
        this.handleError(message, source, "medium", true, details);
	}

	info(message: string, source?: string) {
		this.updateStatus(message, "info", source);
	}

	clear(source?: string) {
		this.updateStatus("", "info", source);
	}
}