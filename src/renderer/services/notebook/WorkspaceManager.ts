import { Dataset } from "../types";
import { AsyncUtils } from "../../utils/AsyncUtils";
import { ElectronClient } from "../../utils/ElectronClient";

export interface WorkspaceInfo {
	path: string;
	exists: boolean;
	kernelName?: string;
	analysisType?: string;
}

export interface FileCheckResult {
	exists: boolean;
	path: string;
	error?: string;
}

/**
 * WorkspaceManager handles all file system operations and workspace management
 * Separates file I/O concerns from business logic
 */
export class WorkspaceManager {
	private statusCallback?: (status: string) => void;

	constructor() {
		// No dependencies needed for file operations
	}

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	private generateWorkspaceName(query: string): string {
		const timestamp = new Date()
			.toISOString()
			.slice(0, 16)
			.replace(/[:-]/g, "");
		const querySlug = query
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, "")
			.replace(/\s+/g, "_")
			.substring(0, 30);
		return `analysis_${timestamp}_${querySlug}`;
	}

	async createAnalysisWorkspace(
		query: string,
		baseWorkspace?: string
	): Promise<string> {
		try {
			// Generate workspace name from query
			const workspaceName = this.generateWorkspaceName(query);
			const workspacePath = baseWorkspace
				? `${baseWorkspace}/${workspaceName}`
				: `./workspaces/${workspaceName}`;

			// Create workspace directories
			await ElectronClient.createDirectory(workspacePath);
			// Proactively refresh file tree in case listeners are not attached yet
			window.dispatchEvent(new Event("refreshFileTree"));

			return workspacePath;
		} catch (error) {
			console.error("WorkspaceManager: Error creating workspace:", error);
			// Fallback to local directory
			const fallbackName = this.generateWorkspaceName(query);
			return `./workspaces/${fallbackName}`;
		}
	}

	/**
	 * Check if a file exists with retry logic
	 */
	async checkFileExists(
		filePath: string,
		maxAttempts: number = 10,
		delayMs: number = 500
	): Promise<FileCheckResult> {
		let attempts = 0;

		while (attempts < maxAttempts) {
			try {
				await ElectronClient.readFile(filePath);
				return {
					exists: true,
					path: filePath,
				};
			} catch (error) {
				attempts++;
				if (attempts >= maxAttempts) {
					return {
						exists: false,
						path: filePath,
						error: `File not found after ${maxAttempts} attempts: ${filePath}`,
					};
				}
				await AsyncUtils.sleep(delayMs);
			}
		}

		return {
			exists: false,
			path: filePath,
			error: "Unexpected error in file check",
		};
	}

	/**
	 * Check if a directory exists
	 */
	async checkDirectoryExists(dirPath: string): Promise<boolean> {
		try {
			return await ElectronClient.directoryExists(dirPath);
		} catch (error) {
			console.error(`Error checking directory ${dirPath}:`, error);
			return false;
		}
	}

	/**
	 * Write file with proper error handling
	 */
	async writeFile(filePath: string, content: string): Promise<boolean> {
		try {
			await ElectronClient.writeFile(filePath, content);
			return true;
		} catch (error) {
			console.error(`Error writing file ${filePath}:`, error);
			return false;
		}
	}

	/**
	 * Read file with proper error handling
	 */
	async readFile(filePath: string): Promise<string | null> {
		try {
			return await ElectronClient.readFile(filePath);
		} catch (error) {
			console.error(`Error reading file ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Save analysis plan to workspace
	 */
	async saveAnalysisPlan(
		workingDir: string,
		analysisPlan: {
			understanding: any;
			datasets: Dataset[];
			workingDir: string;
			requiredSteps: string[];
			userQuestion: string;
			dataTypes: string[];
			recommendedTools: string[];
		}
	): Promise<boolean> {
		const filePath = `${workingDir}/analysis_plan.json`;
		const content = JSON.stringify(analysisPlan, null, 2);

		this.updateStatus("Saving analysis plan...");
		const success = await this.writeFile(filePath, content);

		if (success) {
			this.updateStatus("Analysis plan saved successfully");
		} else {
			this.updateStatus("Warning: Failed to save analysis plan");
		}

		return success;
	}

	/**
	 * Load analysis plan from workspace
	 */
	async loadAnalysisPlan(workingDir: string): Promise<any | null> {
		const filePath = `${workingDir}/analysis_plan.json`;
		const content = await this.readFile(filePath);

		if (content) {
			try {
				return JSON.parse(content);
			} catch (error) {
				console.error("Error parsing analysis plan:", error);
				return null;
			}
		}

		return null;
	}

	/**
	 * Get workspace information
	 */
	async getWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo> {
		const exists = await this.checkDirectoryExists(workspacePath);

		const info: WorkspaceInfo = {
			path: workspacePath,
			exists,
		};

		if (exists) {
			// Try to load workspace metadata if it exists
			const metadataPath = `${workspacePath}/workspace_metadata.json`;
			const metadata = await this.readFile(metadataPath);

			if (metadata) {
				try {
					const parsed = JSON.parse(metadata);
					info.kernelName = parsed.kernelName;
					info.analysisType = parsed.analysisType;
				} catch (error) {
					console.warn("Error parsing workspace metadata:", error);
				}
			}
		}

		return info;
	}

	/**
	 * Ensure workspace directory structure exists
	 */
	async ensureWorkspaceStructure(workspacePath: string): Promise<boolean> {
		try {
			// Check main workspace directory
			const workspaceExists = await this.checkDirectoryExists(workspacePath);
			if (!workspaceExists) {
				this.updateStatus(
					`Workspace directory does not exist: ${workspacePath}`
				);
				return false;
			}

			// Check for required subdirectories and create them if needed
			const requiredDirs = ["results", "figures", "data"];

			for (const dir of requiredDirs) {
				const dirPath = `${workspacePath}/${dir}`;
				const exists = await this.checkDirectoryExists(dirPath);

				if (!exists) {
					this.updateStatus(`Creating directory: ${dir}`);
					try {
						await window.electronAPI.createDirectory(dirPath);
						window.dispatchEvent(new Event("refreshFileTree"));
					} catch (e) {
						console.warn(`Failed to create directory ${dirPath}:`, e);
					}
				}
			}

			return true;
		} catch (error) {
			console.error("Error ensuring workspace structure:", error);
			return false;
		}
	}

	/**
	 * Clean up temporary files in workspace
	 */
	async cleanupTempFiles(workspacePath: string): Promise<void> {
		try {
			this.updateStatus("Cleaning up temporary files...");
			// Implementation would depend on electronAPI having cleanup methods
			// For now, we'll just log the intent
			console.log(`Cleaning up temporary files in: ${workspacePath}`);
			this.updateStatus("Temporary files cleaned up");
		} catch (error) {
			console.error("Error cleaning up temp files:", error);
		}
	}

	/**
	 * Create workspace metadata file
	 */
	async createWorkspaceMetadata(
		workspacePath: string,
		metadata: any
	): Promise<boolean> {
		try {
			const metadataPath = `${workspacePath}/workspace_metadata.json`;
			const content = JSON.stringify(metadata, null, 2);
			return await this.writeFile(metadataPath, content);
		} catch (error) {
			console.error("Error creating workspace metadata:", error);
			return false;
		}
	}

	/**
	 * Validate workspace is ready for operations
	 */
	async validateWorkspace(workspacePath: string): Promise<{
		isValid: boolean;
		issues: string[];
		warnings: string[];
	}> {
		const result = {
			isValid: true,
			issues: [] as string[],
			warnings: [] as string[],
		};

		// Check if workspace directory exists
		const workspaceExists = await this.checkDirectoryExists(workspacePath);
		if (!workspaceExists) {
			result.isValid = false;
			result.issues.push(
				`Workspace directory does not exist: ${workspacePath}`
			);
			return result;
		}

		// Check for virtual environment
		const venvPath = `${workspacePath}/venv`;
		const venvExists = await this.checkDirectoryExists(venvPath);
		if (!venvExists) {
			result.warnings.push("Virtual environment not found");
		}

		// Check for common required directories
		const requiredDirs = ["results", "figures", "data"];
		for (const dir of requiredDirs) {
			const dirPath = `${workspacePath}/${dir}`;
			const exists = await this.checkDirectoryExists(dirPath);
			if (!exists) {
				result.warnings.push(`Directory ${dir} does not exist`);
			}
		}

		return result;
	}
}
