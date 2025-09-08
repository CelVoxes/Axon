/**
 * Utility functions for safely accessing Electron API
 */

export interface ElectronAPICheck {
	isAvailable: boolean;
	error?: string;
}

/**
 * Check if Electron API is available and ready
 */
export function checkElectronAPI(): ElectronAPICheck {
	if (typeof window === "undefined") {
		return { isAvailable: false, error: "Window is not defined" };
	}

	if (!window.electronAPI) {
		return { isAvailable: false, error: "Electron API is not available" };
	}

	return { isAvailable: true };
}

/**
 * Check if a specific Electron API method is available
 */
export function checkElectronAPIMethod(methodName: string): ElectronAPICheck {
	const apiCheck = checkElectronAPI();
	if (!apiCheck.isAvailable) {
		return apiCheck;
	}

	if (
		typeof window.electronAPI[methodName as keyof typeof window.electronAPI] !==
		"function"
	) {
		return {
			isAvailable: false,
			error: `Electron API method '${methodName}' is not available`,
		};
	}

	return { isAvailable: true };
}

/**
 * Safe wrapper for Electron API calls
 */
export async function safeElectronAPICall<T>(
	methodName: string,
	...args: any[]
): Promise<{ success: boolean; data?: T; error?: string }> {
	const check = checkElectronAPIMethod(methodName);
	if (!check.isAvailable) {
		return { success: false, error: check.error };
	}

	try {
		const method = window.electronAPI[
			methodName as keyof typeof window.electronAPI
		] as Function;
		const result = await method(...args);
		return { success: true, data: result };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Common Electron API operations with safety checks
 */
export const electronAPI = {
	/**
	 * Safely read a file
	 */
	async readFile(
		filePath: string
	): Promise<{ success: boolean; data?: string; error?: string }> {
		return safeElectronAPICall<string>("readFile", filePath);
	},

	/**
	 * Safely read a file as binary and return data URL + mime
	 */
	async readFileBinary(filePath: string): Promise<{
		success: boolean;
		data?: { dataUrl: string; mime: string };
		error?: string;
	}> {
		return safeElectronAPICall<{ dataUrl: string; mime: string }>(
			"readFileBinary",
			filePath
		);
	},

	/**
	 * Safely write a file
	 */
	async writeFile(
		filePath: string,
		content: string
	): Promise<{ success: boolean; error?: string }> {
		// The main process returns an object { success, error? } for writes.
		// safeElectronAPICall wraps returns as { success: true/false, data?: any }.
		// Unwrap and normalize so callers reliably see the write result.
		const res = await safeElectronAPICall<any>("writeFile", filePath, content);
		if (!res.success) {
			return { success: false, error: res.error };
		}
		const inner = res.data;
		if (inner && typeof inner === "object" && "success" in inner) {
			return inner as { success: boolean; error?: string };
		}
		if (typeof inner === "boolean") {
			return { success: inner };
		}
		// Fallback: assume success if call succeeded and no structured result provided
		return { success: true };
	},

	/**
	 * Safely check if a directory exists
	 */
	async directoryExists(
		dirPath: string
	): Promise<{ success: boolean; data?: boolean; error?: string }> {
		return safeElectronAPICall<boolean>("directoryExists", dirPath);
	},

	/**
	 * Safely list directory contents
	 */
	async listDirectory(
		dirPath: string
	): Promise<{ success: boolean; data?: any[]; error?: string }> {
		return safeElectronAPICall<any[]>("listDirectory", dirPath);
	},

	/**
	 * Safely create a directory
	 */
	async createDirectory(
		dirPath: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<boolean>("createDirectory", dirPath);
	},

	/**
	 * Safely open a file dialog
	 */
	async showOpenDialog(
		options: any
	): Promise<{ success: boolean; data?: any; error?: string }> {
		return safeElectronAPICall<any>("showOpenDialog", options);
	},

	/**
	 * Safely get a value from store
	 */
	async storeGet(
		key: string
	): Promise<{ success: boolean; data?: any; error?: string }> {
		return safeElectronAPICall<any>("storeGet", key);
	},

	/**
	 * Safely set a value in store
	 */
	async storeSet(
		key: string,
		value: any
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<boolean>("storeSet", key, value);
	},

	/**
	 * Safely open a file in system
	 */
	async openFile(
		filePath: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("openFile", filePath);
	},

	// FS watch integrations
	onFsWatchEvent(callback: (root: string) => void) {
		try {
			(window as any).electronAPI.onFsWatchEvent((payloadRoot: string) => {
				if (typeof callback === "function") callback(payloadRoot);
			});
		} catch (e) {
			// ignore
		}
	},
	async startFsWatch(dirPath: string) {
		return safeElectronAPICall<any>("startFsWatch", dirPath);
	},
	async stopFsWatch(dirPath: string) {
		return safeElectronAPICall<any>("stopFsWatch", dirPath);
	},

	/**
	 * Safely get file info (size, timestamps, isDirectory)
	 */
	async getFileInfo(filePath: string): Promise<{
		success: boolean;
		data?: {
			size: number;
			created: string | Date;
			modified: string | Date;
			isDirectory: boolean;
		};
		error?: string;
	}> {
		return safeElectronAPICall<any>("getFileInfo", filePath);
	},

	/**
	 * Safely delete a file
	 */
	async deleteFile(
		filePath: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("deleteFile", filePath);
	},

	/**
	 * Safely delete a directory
	 */
	async deleteDirectory(
		dirPath: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("deleteDirectory", dirPath);
	},

	/**
	 * Safely check Jupyter status
	 */
	async checkJupyterStatus(): Promise<{
		success: boolean;
		data?: boolean;
		error?: string;
	}> {
		return safeElectronAPICall<boolean>("checkJupyterStatus");
	},

	/**
	 * Safely start Jupyter
	 */
	async startJupyter(
		workingDir: string
	): Promise<{ success: boolean; data?: any; error?: string }> {
		return safeElectronAPICall<any>("startJupyter", workingDir);
	},

	/**
	 * Safely execute Jupyter code
	 */
	async executeJupyterCode(
		code: string,
		workspacePath?: string,
		executionId?: string
	): Promise<{ success: boolean; data?: any; error?: string }> {
		return safeElectronAPICall<any>(
			"executeJupyterCode",
			code,
			workspacePath,
			executionId
		);
	},

	/**
	 * Safely interrupt currently running Jupyter cell (if any)
	 */
	async interruptJupyter(
		workspacePath?: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("interruptJupyter", workspacePath);
	},

	// SSH operations
	async sshStart(
		sessionId: string,
		config: any
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("sshStart", sessionId, config);
	},
	async sshWrite(
		sessionId: string,
		data: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("sshWrite", sessionId, data);
	},
	async sshResize(
		sessionId: string,
		cols: number,
		rows: number
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("sshResize", sessionId, cols, rows);
	},
	async sshStop(
		sessionId: string
	): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("sshStop", sessionId);
	},

	// Auto-updater operations
	async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("checkForUpdates");
	},

	async installUpdate(): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<any>("installUpdate");
	},

	async getAppVersion(): Promise<{ success: boolean; version?: string; error?: string }> {
		return safeElectronAPICall<any>("getAppVersion");
	},

	// Update status listener
	onUpdateStatus(callback: (status: any) => void) {
		try {
			(window as any).electronAPI.onUpdateStatus((status: any) => {
				if (typeof callback === "function") callback(status);
			});
		} catch (e) {
			// ignore
		}
	},

	/**
	 * Safely generate a PDF from HTML content
	 */
	async generatePDF(options: {
		html: string;
		outputPath: string;
		options?: {
			format?: string;
			printBackground?: boolean;
			margin?: {
				top?: string;
				right?: string;
				bottom?: string;
				left?: string;
			};
		};
	}): Promise<{ success: boolean; error?: string }> {
		return safeElectronAPICall<boolean>("generatePDF", options);
	},
};
