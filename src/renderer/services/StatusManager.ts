/**
 * Centralized StatusManager for consistent status management across the application
 */
export type StatusCallback = (status: StatusUpdate) => void;

export interface StatusUpdate {
	message: string;
	type: "info" | "success" | "warning" | "error" | "progress";
	progress?: number;
	timestamp: Date;
	source?: string;
}

export interface StatusConfig {
	enableLogging?: boolean;
	enableProgress?: boolean;
	timeout?: number;
}

export class StatusManager {
	private statusCallback?: StatusCallback;
	private config: StatusConfig;
	private static instance: StatusManager;

	constructor(config: StatusConfig = {}) {
		this.config = {
			enableLogging: true,
			enableProgress: true,
			timeout: 5000,
			...config,
		};
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(config?: StatusConfig): StatusManager {
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

	/**
	 * Update status with progress information
	 */
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

	/**
	 * Update status with a formatted message
	 */
	updateStatusFormatted(
		step: string,
		message: string,
		type: StatusUpdate["type"] = "info",
		source?: string
	) {
		this.updateStatus(`${step}: ${message}`, type, source);
	}

	/**
	 * Chain multiple status updates
	 */
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

	/**
	 * Success status update
	 */
	success(message: string, source?: string) {
		this.updateStatus(message, "success", source);
	}

	/**
	 * Warning status update
	 */
	warning(message: string, source?: string) {
		this.updateStatus(message, "warning", source);
	}

	/**
	 * Error status update
	 */
	error(message: string, source?: string) {
		this.updateStatus(message, "error", source);
	}

	/**
	 * Info status update
	 */
	info(message: string, source?: string) {
		this.updateStatus(message, "info", source);
	}

	/**
	 * Clear status (useful for resetting)
	 */
	clear(source?: string) {
		this.updateStatus("", "info", source);
	}
}
