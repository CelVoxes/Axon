import { Dataset, DataTypeAnalysis } from "./types";
import { DatasetManager } from "./DatasetManager";
import { ElectronClient } from "../utils/ElectronClient";

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
	 * Get kernel name from workspace metadata
	 */
	async getWorkspaceKernelName(workspaceDir: string): Promise<string> {
		try {
			const metadataPath = `${workspaceDir}/workspace_metadata.json`;
			const content = await ElectronClient.readFile(metadataPath);
			const metadata = JSON.parse(content);
			return metadata?.kernelName || "python3";
		} catch (error) {
			console.warn(
				"Could not read workspace kernel name, using default: python3"
			);
			return "python3";
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
	 * Ensure Jupyter is using the workspace's virtual environment kernel
	 */
	async ensureWorkspaceKernelReady(workspaceDir: string): Promise<boolean> {
		try {
			const kernelName = await this.getWorkspaceKernelName(workspaceDir);
			this.updateStatus(`🔧 Ensuring workspace kernel is ready: ${kernelName}`);

			// Verify that the kernel spec exists in the workspace
			const kernelsDir = `${workspaceDir}/kernels/${kernelName}`;
			const kernelSpecPath = `${kernelsDir}/kernel.json`;

			try {
				const kernelSpecContent = await ElectronClient.readFile(kernelSpecPath);
				const kernelSpec = JSON.parse(kernelSpecContent);

				// Verify that the kernel spec points to the workspace's virtual environment Python
				const expectedPythonPath = `${workspaceDir}/venv/bin/python`;
				if (kernelSpec.argv && kernelSpec.argv[0] === expectedPythonPath) {
					console.log(`✅ Workspace kernel properly configured: ${kernelName}`);
					this.updateStatus(`✅ Workspace kernel ready: ${kernelName}`);
					return true;
				} else {
					console.warn(
						`⚠️ Kernel spec does not point to workspace Python: ${kernelSpec.argv?.[0]}`
					);
					this.updateStatus(`⚠️ Kernel configuration issue, using default`);
					return false;
				}
			} catch (readError) {
				console.warn(`⚠️ Could not read kernel spec: ${kernelSpecPath}`);
				this.updateStatus(`⚠️ Kernel spec not found, using default`);
				return false;
			}
		} catch (error) {
			console.warn("Failed to ensure workspace kernel is ready:", error);
			this.updateStatus("⚠️ Using default kernel");
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

			// Use DatasetManager to determine required tools
			const dataAnalysis =
				await this.datasetManager.analyzeDataTypesAndSelectTools(
					datasets,
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

		// Add common packages (avoid duplicates since we're using a Set)
		requiredPackages.add("pandas");
		requiredPackages.add("numpy");
		requiredPackages.add("matplotlib");

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
			requiredPackages.add("leidenalg");
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

		return `# Install required packages
import subprocess
import sys

required_packages = ${JSON.stringify(packages)}

print("Installing required packages...")
for package in required_packages:
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print(f"✓ Installed {package}")
    except subprocess.CalledProcessError:
        print(f"⚠ Failed to install {package}")

print("\\nAll packages installed!")`;
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
	 * Verify core packages are available in the environment
	 */
	private async verifyCorePackages(workspaceDir: string): Promise<boolean> {
		const testCode = `
import sys
print(f"Python path: {sys.path}")
try:
    import pandas
    print("✅ pandas available")
except ImportError:
    print("❌ pandas not available")

try:
    import numpy
    print("✅ numpy available") 
except ImportError:
    print("❌ numpy not available")

try:
    import matplotlib
    print("✅ matplotlib available")
except ImportError:
    print("❌ matplotlib not available")
    
try:
    import seaborn
    print("✅ seaborn available")
except ImportError:
    print("❌ seaborn not available")
`;

		try {
			const testResult = await ElectronClient.executeJupyterCode(
				testCode,
				workspaceDir
			);

			if (testResult.success) {
				console.log("📦 Package verification result:", testResult.output);
				return true;
			} else {
				console.warn("⚠️ Package verification failed:", testResult.error);
				return false;
			}
		} catch (error) {
			console.error("Error verifying core packages:", error);
			return false;
		}
	}
}
