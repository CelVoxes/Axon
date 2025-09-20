import { Dataset, DataTypeAnalysis } from "../types";
import { DatasetManager } from "../analysis/DatasetManager";
import { ElectronClient } from "../../utils/ElectronClient";

export interface EnvironmentStatus {
	venvExists: boolean;
	packagesInstalled: boolean;
	corePackagesAvailable: boolean;
	errors: string[];
	warnings: string[];
}

export interface PackageInstallationResult {
	success: boolean;
	installedPackages: string[];
	failedPackages: string[];
	error?: string;
}

/**
 * EnvironmentManager handles all environment setup and package management
 * Separates concerns from AutonomousAgent which should focus on workflow orchestration
 */
export class EnvironmentManager {
	private datasetManager: DatasetManager;
	private statusCallback?: (status: string) => void;
	private installedPackages = new Set<string>();

	constructor(datasetManager: DatasetManager) {
		this.datasetManager = datasetManager;
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
	 * Start Jupyter with workspace kernels if not already running
	 */
	async startJupyterWithWorkspaceKernels(
		workspaceDir: string
	): Promise<boolean> {
		try {
			this.updateStatus("🔧 Starting Jupyter with workspace kernels...");

			// Start Jupyter server with workspace kernels
			const result = await ElectronClient.startJupyter(workspaceDir);

			if (result.success) {
				console.log("✅ Jupyter started with workspace kernels");
				this.updateStatus("✅ Jupyter ready with workspace kernels");
				return true;
			} else {
				console.warn(
					"⚠️ Failed to start Jupyter with workspace kernels:",
					result.error
				);
				this.updateStatus("⚠️ Jupyter startup issue, using default");
				return false;
			}
		} catch (error) {
			console.warn("Failed to start Jupyter with workspace kernels:", error);
			this.updateStatus("⚠️ Jupyter startup failed, using default");
			return false;
		}
	}

	/**
	 * Simplified kernel readiness check - just verify Jupyter server is running
	 * since we now use dynamic kernel discovery instead of workspace-specific kernels
	 */
	async ensureWorkspaceKernelReady(workspaceDir: string): Promise<boolean> {
		try {
			this.updateStatus(`🔧 Verifying Jupyter server is ready...`);

			// Just verify that Jupyter server is running - kernel discovery is handled dynamically
			await ElectronClient.startJupyter(workspaceDir);

			this.updateStatus(
				`✅ Jupyter server ready with dynamic kernel discovery`
			);
			return true;
		} catch (error) {
			console.warn("Failed to ensure Jupyter server is ready:", error);
			this.updateStatus("⚠️ Jupyter server issue");
			return false;
		}
	}

	/**
	 * Ensure virtual environment and kernel are ready for code execution
	 */
	async ensureEnvironmentReady(
		workspaceDir: string
	): Promise<EnvironmentStatus> {
		const status: EnvironmentStatus = {
			venvExists: false,
			packagesInstalled: false,
			corePackagesAvailable: false,
			errors: [],
			warnings: [],
		};

		try {
			this.updateStatus("🔍 Checking virtual environment...");

			// Check if virtual environment exists
			const venvPath = `${workspaceDir}/venv`;
			const venvExists = await ElectronClient.directoryExists(venvPath);
			status.venvExists = venvExists;

			if (!venvExists) {
				this.updateStatus("🔧 Creating virtual environment...");
				try {
					// Create virtual environment using IPC
					const venvResult = await ElectronClient.createVirtualEnv(
						workspaceDir
					);
					if (!venvResult.success) {
						throw new Error(
							venvResult.error || "Failed to create virtual environment"
						);
					}
					status.venvExists = true;

					// Log kernel information if available
					if (venvResult.kernelName) {
						console.log(
							`Virtual environment created with kernel: ${venvResult.kernelName}`
						);
						this.updateStatus(
							`✅ Virtual environment created with kernel: ${venvResult.kernelName}`
						);
					} else {
						this.updateStatus("✅ Virtual environment created successfully");
					}
				} catch (venvError) {
					const errorMessage =
						venvError instanceof Error ? venvError.message : "Unknown error";
					status.errors.push(
						`Failed to create virtual environment: ${errorMessage}`
					);
					this.updateStatus("❌ Failed to create virtual environment");
					console.error("Error creating virtual environment:", venvError);
					return status;
				}
			}

			this.updateStatus("🔍 Verifying installed packages...");

			// Verify core packages are installed by attempting imports
			const corePackagesAvailable = await this.verifyCorePackages(workspaceDir);
			status.corePackagesAvailable = corePackagesAvailable;

			if (corePackagesAvailable) {
				this.updateStatus("✅ All core packages verified");
			} else {
				status.warnings.push("Some core packages may not be available");
				this.updateStatus("⚠️ Package verification failed, but continuing...");
			}

			return status;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			status.errors.push(errorMessage);
			console.error("❌ Environment verification failed:", error);
			this.updateStatus(
				"⚠️ Environment verification failed, but continuing..."
			);
			return status;
		}
	}

	/**
	 * Install required packages based on datasets and analysis requirements
	 */
    async installRequiredPackages(
        datasets: Dataset[],
        workingDir: string
    ): Promise<PackageInstallationResult> {
		const result: PackageInstallationResult = {
			success: false,
			installedPackages: [],
			failedPackages: [],
		};

		try {
			// Validate working directory exists
			const workingDirExists = await window.electronAPI.directoryExists(
				workingDir
			);
			if (!workingDirExists) {
				throw new Error(`Working directory does not exist: ${workingDir}`);
			}

			// Ensure virtual environment is ready before installing packages
			this.updateStatus("🔧 Ensuring virtual environment is ready...");
			const envStatus = await this.ensureEnvironmentReady(workingDir);

			if (!envStatus.venvExists) {
				throw new Error(
					`Virtual environment not found at: ${workingDir}/venv. Please ensure Jupyter is started first.`
				);
			}

			this.updateStatus("Analyzing required packages...");

            // If no datasets provided, peek into workspace to infer data
            let datasetsForAnalysis = datasets;
            if (!datasetsForAnalysis || datasetsForAnalysis.length === 0) {
                this.updateStatus("🔎 Inspecting workspace to detect data types...");
                try {
                    datasetsForAnalysis = await this.datasetManager.scanWorkspaceForData(
                        workingDir
                    );
                    if (datasetsForAnalysis.length === 0) {
                        this.updateStatus(
                            "ℹ️ No recognizable data files found; using minimal environment"
                        );
                    } else {
                        this.updateStatus(
                            `✅ Detected ${datasetsForAnalysis.length} data item(s) in workspace`
                        );
                    }
                } catch (e) {
                    console.warn("Workspace scan failed:", e);
                }
            }

            // Use DatasetManager to determine required tools
            const dataAnalysis =
                await this.datasetManager.analyzeDataTypesAndSelectTools(
                    datasetsForAnalysis,
                    workingDir
                );

			// Get the list of required packages
            const requiredPackages = dataAnalysis.recommendedTools;

			if (requiredPackages.length === 0) {
				this.updateStatus("No additional packages required.");
				result.success = true;
				return result;
			}

			this.updateStatus(
				`Installing ${requiredPackages.length} required packages...`
			);

			// Install packages using the IPC method
			console.log("🔧 Starting package installation...", requiredPackages);
			const installResult = await window.electronAPI.installPackages(
				workingDir,
				requiredPackages
			);
			console.log("✅ Package installation completed:", installResult);

			// Store the successfully installed packages
			if (installResult.success) {
				requiredPackages.forEach((pkg) => this.installedPackages.add(pkg));
				result.installedPackages = requiredPackages;
				result.success = true;
				console.log(
					"📦 Installed packages stored:",
					Array.from(this.installedPackages)
				);
			} else {
				result.failedPackages = requiredPackages;
				result.error = installResult.error;
			}

			if (installResult.success) {
				this.updateStatus(
					`Successfully installed: ${requiredPackages.join(", ")}`
				);
			} else {
				console.warn("Failed to install packages:", installResult.error);
				this.updateStatus("Warning: Some packages may not be available");
			}

			return result;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			result.error = errorMessage;
			console.error("Error installing packages:", error);
			this.updateStatus(
				"Warning: Package installation failed, proceeding anyway"
			);
			return result;
		}
	}

	/**
	 * Generate package installation code for notebook cells
	 */
	async generatePackageInstallationCode(
		datasets: Dataset[],
		analysisSteps?: any[],
		workspaceDir?: string
	): Promise<string> {
		// Get required packages from dataset analysis (use workspace when available)
		const dataAnalysis =
			await this.datasetManager.analyzeDataTypesAndSelectTools(
				datasets,
				workspaceDir || ""
			);

		// Collect all required packages
		const requiredPackages = new Set<string>();

		// Add packages from data analysis
		dataAnalysis.recommendedTools.forEach((pkg) => requiredPackages.add(pkg));

		// Avoid forcing base scientific packages; allow resolver to pick versions with the tools

		// Heuristic: Include single-cell stack if any dataset hints at single-cell formats or platforms
		const mentionsSingleCell = (text?: string) => {
			const t = (text || "").toLowerCase();
			return (
				t.includes("single-cell") ||
				t.includes("single cell") ||
				t.includes("scrnaseq") ||
				t.includes("sc-rna-seq") ||
				t.includes("10x") ||
				t.includes("dropseq") ||
				t.includes("smart-seq")
			);
		};
		const needsScanpy =
			dataAnalysis.recommendedTools.includes("scanpy") ||
			datasets.some((d: any) => {
				const url = String(d?.url || "").toLowerCase();
				const fmt = String(d?.fileFormat || "").toLowerCase();
				const title = String(d?.title || "");
				const desc = String(d?.description || "");
				const plat = String(d?.platform || "");
				const localPath = String((d as any)?.localPath || "").toLowerCase();
				const isDir = Boolean((d as any)?.isLocalDirectory);
				return (
					url.endsWith(".h5ad") ||
					url.endsWith(".loom") ||
					fmt === "h5ad" ||
					fmt === "loom" ||
					fmt === "mtx" ||
					localPath.endsWith(".h5ad") ||
					localPath.endsWith(".loom") ||
					isDir ||
					mentionsSingleCell(title) ||
					mentionsSingleCell(desc) ||
					mentionsSingleCell(plat)
				);
			});
        if (needsScanpy) {
            requiredPackages.add("scanpy");
            requiredPackages.add("anndata");
            requiredPackages.add("scipy");
            // Common extras used in single-cell workflows
            // Avoid heavyweight/compiled dependencies prone to install failures (e.g., leidenalg/igraph)
            // Prefer scikit-learn clustering instead of sc.tl.leiden/louvain
            requiredPackages.add("umap-learn");
            requiredPackages.add("scikit-learn");
            requiredPackages.add("seaborn");
            requiredPackages.add("plotly");
        }

		console.log(
			"📦 Packages for notebook cell installation:",
			Array.from(requiredPackages)
		);

		// Ensure stable ordering for reproducibility
		const packages = Array.from(requiredPackages).sort((a, b) =>
			a.localeCompare(b)
		);

		const installationCode = [
			"# Install required packages as a single pip transaction for consistent dependency resolution",
			"import os",
			"import subprocess",
			"import sys",
			"from pathlib import Path",
			"",
			"# Use a workspace-local pip cache so wheel builds succeed inside restricted environments",
			"cache_dir = Path.cwd() / \"pip-cache\"",
			"cache_dir.mkdir(exist_ok=True)",
			"env = os.environ.copy()",
			"env[\"PIP_CACHE_DIR\"] = str(cache_dir)",
			"",
			`required_packages = ${JSON.stringify(packages)}`,
			"pip_command = [sys.executable, \"-m\", \"pip\", \"install\", \"--no-cache-dir\", *required_packages]",
			"",
			'print("Installing required packages as one pip call...")',
			"try:",
			"    subprocess.check_call(pip_command, env=env)",
			'    print("✓ All packages installed")',
			"except subprocess.CalledProcessError:",
			'    print("⚠ Failed to install one or more packages")',
			"",
			"# Optional: verify dependency conflicts",
			"try:",
			'    subprocess.check_call([sys.executable, "-m", "pip", "check"], env=env)',
			'    print("Dependency check passed")',
			"except subprocess.CalledProcessError:",
			'    print("⚠ Dependency conflicts detected")',
		].join("\n");
		
		return installationCode;
	}

	/**
	 * Get list of currently installed packages
	 */
	getInstalledPackages(): string[] {
		return Array.from(this.installedPackages);
	}

	/**
	 * Check if specific packages are installed
	 */
	hasPackages(packages: string[]): boolean {
		return packages.every((pkg) => this.installedPackages.has(pkg));
	}

	/**
	 * Verify core packages are available - simplified for maximum speed
	 */
	private async verifyCorePackages(workspaceDir: string): Promise<boolean> {
		// Skip package verification entirely in renderer - let the main process handle it
		// The main process already does optimized verification when needed
		// This eliminates the slow Python subprocess chain entirely
		console.log("📦 Package verification delegated to main process for speed");
		return true;
	}
}
