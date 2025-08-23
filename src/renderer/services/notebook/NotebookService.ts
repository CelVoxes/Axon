import { Dataset } from "../types";
import { AsyncUtils } from "../../utils/AsyncUtils";
import { EventManager } from "../../utils/EventManager";
import { ElectronClient } from "../../utils/ElectronClient";

export interface NotebookCell {
	id: string;
	code: string;
	language: "python" | "r" | "markdown";
	output?: string;
	status?: "pending" | "running" | "completed" | "failed";
	title?: string;
}

export interface NotebookOptions {
	workspacePath: string;
	kernelName?: string;
}

export interface NotebookGenerationOptions {
	query: string;
	datasets: Dataset[];
	analysisSteps: any[];
	workspaceDir: string;
	includePackageInstall?: boolean;
	markdownContent?: string[];
}

export interface NotebookReadyResult {
	isReady: boolean;
	error?: string;
	timeout?: boolean;
}

/**
 * NotebookService - Pure file operations for Jupyter notebooks
 * Responsibilities: ONLY notebook file creation/modification
 * Does NOT: Generate code, manage status, execute cells
 */
export class NotebookService {
	private workspacePath: string;
	private kernelName: string;

	constructor(options: NotebookOptions) {
		this.workspacePath = options.workspacePath;
		this.kernelName = options.kernelName || "python3";
	}

	updateWorkspacePath(newWorkspacePath: string) {
		console.log(
			`NotebookService: Updating workspace path from ${this.workspacePath} to ${newWorkspacePath}`
		);
		this.workspacePath = newWorkspacePath;
	}

	/**
	 * Add a markdown cell to a notebook
	 */
	async addMarkdownCell(notebookPath: string, content: string): Promise<void> {
		// Validate content before adding
		if (!content || !content.trim()) {
			console.warn(
				"NotebookService: Attempted to add empty markdown cell, skipping"
			);
			return;
		}

		console.log(
			`NotebookService: Adding markdown cell with ${content.length} characters to ${notebookPath}`
		);

		// Ensure newlines are preserved when the FileEditor converts to ipynb source
		const normalized = content.replace(/\r\n/g, "\n");
		// Attach the acknowledgement listener BEFORE dispatch to avoid race conditions
		const ackPromise = EventManager.waitForEvent<any>(
			"notebook-cell-added",
			15000
		);
		EventManager.dispatchEvent("add-notebook-cell", {
			filePath: notebookPath,
			cellType: "markdown",
			content: normalized,
		});
		await ackPromise;
	}

	/**
	 * Add a code cell to a notebook
	 */
	async addCodeCell(notebookPath: string, code: string): Promise<void> {
		// Validate code content before adding
		if (!code || !code.trim()) {
			console.warn(
				"NotebookService: Attempted to add empty code cell, skipping"
			);
			return;
		}

		console.log(
			`NotebookService: Adding code cell with ${code.length} characters to ${notebookPath}`
		);

		// Attach the acknowledgement listener BEFORE dispatch to avoid race conditions
		const ackPromise = EventManager.waitForEvent<any>(
			"notebook-cell-added",
			15000
		);
		EventManager.dispatchEvent("add-notebook-cell", {
			filePath: notebookPath,
			cellType: "code",
			content: code,
		});
		await ackPromise;
	}

	/**
	 * Update cell output in a notebook
	 */
	async updateCellOutput(
		notebookPath: string,
		cellIndex: number,
		output: string,
		workspaceDir: string
	): Promise<void> {
		try {
			// Read current notebook
			const notebookContent = await ElectronClient.readFile(notebookPath);
			const notebook = JSON.parse(notebookContent);

			// Update cell output
			if (notebook.cells[cellIndex]) {
				notebook.cells[cellIndex].outputs = [
					{
						output_type: "stream",
						name: "stdout",
						text: output.split("\n"),
					},
				];
			}

			// Write updated notebook
			await ElectronClient.writeFile(
				notebookPath,
				JSON.stringify(notebook, null, 2)
			);
		} catch (error) {
			console.error("NotebookService: Error updating cell output:", error);
			throw error;
		}
	}

	/**
	 * Create a simple empty notebook with basic structure
	 */
	async createEmptyNotebook(
		query: string,
		datasets: Dataset[],
		workspaceDir: string
	): Promise<string> {
		const notebookPath = `${workspaceDir}/analysis.ipynb`;

		// Create basic notebook structure with header only
		const cells: NotebookCell[] = [
			{
				id: "header",
				code: `# Analysis Notebook\n\n**Question:** ${query}\n\n**Selected Datasets:**\n${datasets
					.map((d) => `- **${d.id}**: ${d.title}`)
					.join("\n")}\n\n---`,
				language: "markdown",
			},
		];

		await this.createNotebook(notebookPath, cells);
		return notebookPath;
	}

	/**
	 * Wait for notebook to be ready for operations
	 */
	async waitForNotebookReady(
		notebookPath: string,
		timeoutMs: number = 10000
	): Promise<NotebookReadyResult> {
		console.log(
			`NotebookService: waitForNotebookReady called for ${notebookPath} with timeout ${timeoutMs}ms`
		);
		return new Promise((resolve) => {
			// First, check if the notebook is already ready (in case event was dispatched before listener was set up)
			const checkIfAlreadyReady = async () => {
				try {
					const fileContent = await ElectronClient.readFile(notebookPath);
					if (fileContent && fileContent.length > 0) {
						// Try to parse as JSON to verify it's a valid notebook
						try {
							JSON.parse(fileContent);
							console.log(
								`NotebookService: Notebook already exists and is valid: ${notebookPath}`
							);
							return true;
						} catch (parseError) {
							console.warn(
								`NotebookService: Notebook file exists but is not valid JSON: ${notebookPath}`
							);
							return false;
						}
					}
				} catch (error) {
					// File doesn't exist yet, continue waiting
				}
				return false;
			};

			const timeout = setTimeout(async () => {
				console.warn(
					`NotebookService: Timeout waiting for notebook ready: ${notebookPath}`
				);
				try {
					const fileContent = await ElectronClient.readFile(notebookPath);
					console.log(
						`NotebookService: Notebook file exists and has content length: ${fileContent.length}`
					);
				} catch (fileError) {
					console.error(
						`NotebookService: Notebook file does not exist or cannot be read after timeout: ${fileError}`
					);
				}
				resolve({ isReady: false, timeout: true });
			}, timeoutMs);

			const handleNotebookReady = (event: Event) => {
				const customEvent = event as CustomEvent;
				const { filePath } = customEvent.detail;
				console.log(
					`NotebookService: Received notebook-ready event for ${filePath}, waiting for ${notebookPath}`
				);
				if (filePath === notebookPath) {
					console.log(
						`NotebookService: Notebook ready event matched for: ${notebookPath}`
					);
					clearTimeout(timeout);
					window.removeEventListener("notebook-ready", handleNotebookReady);
					resolve({ isReady: true });
				}
			};

			console.log(
				`NotebookService: Setting up notebook-ready event listener for ${notebookPath}`
			);
			window.addEventListener("notebook-ready", handleNotebookReady);

			// Check if already ready immediately after setting up listener
			checkIfAlreadyReady().then((isReady) => {
				if (isReady) {
					clearTimeout(timeout);
					window.removeEventListener("notebook-ready", handleNotebookReady);
					resolve({ isReady: true });
				}
			});
		});
	}

	/**
	 * Open notebook in editor with proper file existence checking
	 */
	async openNotebookInEditor(notebookPath: string): Promise<boolean> {
		// Wait for the file to exist before trying to open it
		let attempts = 0;
		const maxAttempts = 10;

		while (attempts < maxAttempts) {
			try {
				// Check if file exists by trying to read it
				await ElectronClient.readFile(notebookPath);
				break; // File exists, proceed to open
			} catch (error) {
				attempts++;
				if (attempts >= maxAttempts) {
					console.error(
						`Notebook file not found after ${maxAttempts} attempts: ${notebookPath}`
					);
					return false;
				}
				// Wait 500ms before next attempt
				await AsyncUtils.sleep(500);
			}
		}

		// Dispatch an event to open the notebook file in the workspace
		EventManager.dispatchEvent("open-workspace-file", {
			filePath: notebookPath,
		});

		// Add a delay to allow the FileEditor to process the event and load the notebook
		console.log(
			`NotebookService: Waiting 1 second for FileEditor to process open-workspace-file event for ${notebookPath}`
		);
		await AsyncUtils.sleep(1000);

		// Wait for the notebook to be ready with a longer timeout
		console.log(
			`NotebookService: Starting waitForNotebookReady for ${notebookPath}`
		);
		const readyResult = await this.waitForNotebookReady(notebookPath, 15000); // Increased timeout to 15 seconds
		console.log(
			`NotebookService: waitForNotebookReady result for ${notebookPath}:`,
			readyResult
		);

		if (!readyResult.isReady) {
			console.warn(`Notebook not ready after timeout: ${notebookPath}`);
			// Try to verify if the file exists and is valid
			try {
				const fileContent = await window.electronAPI.readFile(notebookPath);
				if (fileContent && fileContent.length > 0) {
					try {
						JSON.parse(fileContent);
						console.log(
							`Notebook file exists and is valid, proceeding anyway: ${notebookPath}`
						);
						return true; // File exists and is valid, proceed
					} catch (parseError) {
						console.error(`Notebook file is not valid JSON: ${notebookPath}`);
						return false;
					}
				}
			} catch (fileError) {
				console.error(
					`Could not read notebook file: ${notebookPath}`,
					fileError
				);
				return false;
			}
		}

		return readyResult.isReady;
	}

	/**
	 * Generate and open a complete notebook with all cells
	 */
	async generateAndOpenNotebook(
		options: NotebookGenerationOptions
	): Promise<string | null> {
		try {
			// Create the notebook
			const notebookPath = await this.createEmptyNotebook(
				options.query,
				options.datasets,
				options.workspaceDir
			);

			// Open it in the editor
			const opened = await this.openNotebookInEditor(notebookPath);

			if (!opened) {
				console.error("Failed to open notebook in editor");
				return null;
			}

			return notebookPath;
		} catch (error) {
			console.error("Error generating and opening notebook:", error);
			return null;
		}
	}

	/**
	 * Add multiple cells to notebook in sequence
	 */
	async addMultipleCells(
		notebookPath: string,
		cells: { type: "markdown" | "code"; content: string }[]
	): Promise<boolean> {
		try {
			for (let i = 0; i < cells.length; i++) {
				const cell = cells[i];

				if (cell.type === "markdown") {
					await this.addMarkdownCell(notebookPath, cell.content);
				} else {
					await this.addCodeCell(notebookPath, cell.content);
				}

				// Small delay between cells for better coordination
				if (i < cells.length - 1) {
					await AsyncUtils.sleep(100);
				}
			}
			return true;
		} catch (error) {
			console.error("Error adding multiple cells:", error);
			return false;
		}
	}

	/**
	 * Update notebook cell code
	 */
	async updateCellCode(
		notebookPath: string,
		cellIndex: number,
		newCode: string
	): Promise<boolean> {
		try {
			// Dispatch event to update cell code
			EventManager.dispatchEvent("update-notebook-cell-code", {
				filePath: notebookPath,
				cellIndex: cellIndex,
				code: newCode,
			});
			return true;
		} catch (error) {
			console.error("Error updating cell code:", error);
			return false;
		}
	}

	/**
	 * Create notebook file with given cells
	 */
	private async createNotebook(
		notebookPath: string,
		cells: NotebookCell[]
	): Promise<void> {
		try {
			// Try to read workspace metadata to get the workspace-specific kernel name and a friendly display name
			let kernelName = this.kernelName || "python3";
			let kernelDisplay = "Python 3";
			try {
				const metadataContent = await ElectronClient.readFile(
					`${this.workspacePath}/workspace_metadata.json`
				);
				const meta = JSON.parse(metadataContent);
				if (meta?.kernelName && typeof meta.kernelName === "string") {
					kernelName = meta.kernelName;
					kernelDisplay = `Axon Workspace (${
						(meta.workspaceName as string) || kernelName
					})`;
				}
			} catch (_) {
				// ignore; fall back to defaults
			}
			// Create Jupyter notebook structure
			const notebook = {
				cells: cells.map((cell, index) => {
					const normalized = cell.code.replace(/\r\n/g, "\n");
					const parts = normalized.split("\n");
					const source = parts.map((line, i) =>
						i < parts.length - 1 ? `${line}\n` : line
					);
					return {
						id: cell.id || `cell-${index}`,
						cell_type: cell.language === "markdown" ? "markdown" : "code",
						source,
						metadata: {},
						outputs: [],
						execution_count: null,
					};
				}),
				metadata: {
					kernelspec: {
						display_name: kernelDisplay,
						language: "python",
						name: kernelName,
					},
					language_info: {
						name: "python",
						version: "3.8+",
					},
				},
				nbformat: 4,
				nbformat_minor: 4,
			};

			// Write notebook file
			const notebookContent = JSON.stringify(notebook, null, 2);
			await window.electronAPI.writeFile(notebookPath, notebookContent);

			console.log(
				`NotebookService: Created notebook at ${notebookPath} with ${notebookContent.length} bytes`
			);

			// Verify the file was written correctly
			try {
				const writtenContent = await ElectronClient.readFile(notebookPath);
				console.log(
					`NotebookService: Verified notebook file has ${writtenContent.length} bytes`
				);
			} catch (verifyError) {
				console.warn(
					`NotebookService: Could not verify written notebook file: ${verifyError}`
				);
			}
		} catch (error) {
			console.error("NotebookService: Error creating notebook:", error);
			throw error;
		}
	}
}
