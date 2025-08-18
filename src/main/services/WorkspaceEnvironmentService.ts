import * as fs from "fs/promises";
import * as path from "path";

export interface EnvironmentStatus {
	venvExists: boolean;
	packagesInstalled: boolean;
	corePackagesAvailable: boolean;
	errors: string[];
	warnings: string[];
}

export interface PackageVerificationResult {
	success: boolean;
	missingPackages: string[];
	installedPackages: string[];
	output?: string;
	error?: string;
}

export interface VenvCreationResult {
	success: boolean;
	kernelName?: string;
	error?: string;
}

/**
 * Centralized service for managing workspace environments, virtual environments,
 * and package management for Axon's biological analysis workflows
 */
export class WorkspaceEnvironmentService {
	private statusCallback?: (status: string) => void;

	setStatusCallback(callback: (status: string) => void) {
		this.statusCallback = callback;
	}

	private updateStatus(message: string) {
		console.log(`🔧 ${message}`);
		if (this.statusCallback) {
			this.statusCallback(message);
		}
	}

	/**
	 * Get the virtual environment path for a workspace
	 */
	getVenvPath(workspacePath: string): string {
		return path.join(workspacePath, "venv");
	}

	/**
	 * Get the Python executable path in the virtual environment
	 */
	getVenvPythonPath(venvPath: string): string {
		return path.join(venvPath, "bin", "python");
	}

	/**
	 * Check if a directory exists
	 */
	async directoryExists(dirPath: string): Promise<boolean> {
		try {
			const stats = await fs.stat(dirPath);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Ensure the workspace environment is ready for biological analysis
	 */
	async ensureEnvironmentReady(workspacePath: string): Promise<EnvironmentStatus> {
		const status: EnvironmentStatus = {
			venvExists: false,
			packagesInstalled: false,
			corePackagesAvailable: false,
			errors: [],
			warnings: [],
		};

		try {
			this.updateStatus("Checking virtual environment...");

			// Check if virtual environment exists
			const venvPath = this.getVenvPath(workspacePath);
			const venvExists = await this.directoryExists(venvPath);
			status.venvExists = venvExists;

			if (!venvExists) {
				this.updateStatus("Creating virtual environment...");
				const venvResult = await this.createVirtualEnvironment(workspacePath);
				
				if (!venvResult.success) {
					status.errors.push(
						venvResult.error || "Failed to create virtual environment"
					);
					this.updateStatus("❌ Failed to create virtual environment");
					return status;
				}
				
				status.venvExists = true;
				if (venvResult.kernelName) {
					this.updateStatus(`✅ Virtual environment created with kernel: ${venvResult.kernelName}`);
				} else {
					this.updateStatus("✅ Virtual environment created successfully");
				}
			}

			// Verify core packages
			this.updateStatus("Verifying core packages...");
			const packageVerification = await this.verifyCorePackages(workspacePath);
			status.corePackagesAvailable = packageVerification.success;

			if (packageVerification.success) {
				this.updateStatus("✅ All core packages verified");
			} else {
				status.warnings.push("Some core packages may not be available");
				this.updateStatus("⚠️ Package verification failed, but continuing...");
			}

			return status;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			status.errors.push(errorMessage);
			console.error("❌ Environment verification failed:", error);
			this.updateStatus("⚠️ Environment verification failed, but continuing...");
			return status;
		}
	}

	/**
	 * Create a virtual environment for the workspace
	 * Note: This is handled by the main process directly, not through this service
	 */
	private async createVirtualEnvironment(workspacePath: string): Promise<VenvCreationResult> {
		// This method is not used in the centralized architecture
		// Virtual environment creation is handled directly in main.ts
		return {
			success: false,
			error: "Virtual environment creation is handled by main process",
		};
	}

	/**
	 * Verify core packages are available using pip list (faster than import testing)
	 */
	async verifyCorePackages(workspacePath: string): Promise<PackageVerificationResult> {
		const corePackages = ['pandas', 'numpy', 'matplotlib', 'seaborn'];
		const checkCode = `
import subprocess
import sys
import json

try:
    result = subprocess.run([sys.executable, "-m", "pip", "list", "--format=json"], 
                          capture_output=True, text=True, timeout=10)
    if result.returncode == 0:
        packages = json.loads(result.stdout)
        installed = {pkg['name'].lower() for pkg in packages}
        core_packages = ${JSON.stringify(corePackages.map(p => p.toLowerCase()))}
        
        missing = [pkg for pkg in core_packages if pkg not in installed]
        available = [pkg for pkg in core_packages if pkg in installed]
        
        if missing:
            print(f"❌ Missing core packages: {missing}")
        else:
            print("✅ All core packages available")
            
        print(f"VERIFICATION_RESULT: {len(missing) == 0}")
        print(f"MISSING_PACKAGES: {missing}")
        print(f"AVAILABLE_PACKAGES: {available}")
    else:
        print("❌ Failed to list packages")
        print("VERIFICATION_RESULT: False")
        print(f"MISSING_PACKAGES: {core_packages}")
        print("AVAILABLE_PACKAGES: []")
except Exception as e:
    print(f"❌ Package verification error: {e}")
    print("VERIFICATION_RESULT: False")
    print(f"MISSING_PACKAGES: {core_packages}")
    print("AVAILABLE_PACKAGES: []")
`;

		try {
			// Execute verification code
			const testResult = await this.executeCodeInWorkspace(checkCode, workspacePath);

			if (testResult.success && testResult.output) {
				// Parse verification results
				const successMatch = testResult.output.match(/VERIFICATION_RESULT:\s*(True|False)/);
				const success = successMatch ? successMatch[1] === 'True' : false;
				
				const missingMatch = testResult.output.match(/MISSING_PACKAGES:\s*(\[.*?\])/);
				const availableMatch = testResult.output.match(/AVAILABLE_PACKAGES:\s*(\[.*?\])/);
				
				let missingPackages: string[] = [];
				let installedPackages: string[] = [];
				
				try {
					if (missingMatch) {
						missingPackages = JSON.parse(missingMatch[1].replace(/'/g, '"'));
					}
					if (availableMatch) {
						installedPackages = JSON.parse(availableMatch[1].replace(/'/g, '"'));
					}
				} catch (parseError) {
					console.warn("Failed to parse package lists:", parseError);
				}
				
				console.log("📦 Package verification result:", success ? "✅ Success" : "❌ Failed");
				console.log("📦 Missing packages:", missingPackages);
				console.log("📦 Available packages:", installedPackages);
				
				return {
					success,
					missingPackages,
					installedPackages,
					output: testResult.output,
				};
			} else {
				console.warn("⚠️ Package verification failed:", testResult.error);
				return {
					success: false,
					missingPackages: corePackages,
					installedPackages: [],
					error: testResult.error,
				};
			}
		} catch (error) {
			console.error("Error verifying core packages:", error);
			return {
				success: false,
				missingPackages: corePackages,
				installedPackages: [],
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	/**
	 * Install packages in the workspace virtual environment
	 * Note: This is handled by the main process directly, not through this service
	 */
	async installPackages(workspacePath: string, packages: string[]): Promise<{
		success: boolean;
		installedPackages: string[];
		failedPackages: string[];
		error?: string;
	}> {
		this.updateStatus(`Package installation handled by main process`);
		
		// Package installation is handled directly in main.ts through IPC
		// This service focuses on verification and analysis
		return {
			success: false,
			installedPackages: [],
			failedPackages: packages,
			error: "Package installation is handled by main process",
		};
	}

	/**
	 * Get workspace kernel name from metadata
	 */
	async getWorkspaceKernelName(workspaceDir: string): Promise<string> {
		try {
			const metadataPath = path.join(workspaceDir, "workspace_metadata.json");
			const content = await fs.readFile(metadataPath, "utf-8");
			const metadata = JSON.parse(content);
			return metadata?.kernelName || "python3";
		} catch (error) {
			console.warn("Could not read workspace kernel name, using default: python3");
			return "python3";
		}
	}

	/**
	 * Generate package installation code for notebook cells
	 */
	generatePackageInstallationCode(requiredPackages: string[]): string {
		const packages = [...new Set(requiredPackages)].sort();
		
		return `# Install required packages for biological analysis
import subprocess
import sys

required_packages = ${JSON.stringify(packages)}

print("Installing required packages for biological analysis...")
try:
    subprocess.check_call([sys.executable, "-m", "pip", "install", *required_packages])
    print("✓ All packages installed successfully")
except subprocess.CalledProcessError as e:
    print(f"⚠ Failed to install some packages: {e}")

# Verify installation
try:
    subprocess.check_call([sys.executable, "-m", "pip", "check"])
    print("✓ Dependency check passed")
except subprocess.CalledProcessError:
    print("⚠ Dependency conflicts detected")`;
	}

	/**
	 * Execute code in the workspace using provided execution function
	 */
	private async executeCodeInWorkspace(
		code: string, 
		workspacePath: string,
		executeFunction?: (code: string, workspacePath: string) => Promise<{
			success: boolean;
			output?: string;
			error?: string;
		}>
	): Promise<{
		success: boolean;
		output?: string;
		error?: string;
	}> {
		if (!executeFunction) {
			throw new Error("No code execution function provided");
		}
		return executeFunction(code, workspacePath);
	}

	/**
	 * Set code execution function (injected from main process)
	 */
	setCodeExecutionFunction(
		executeFunction: (code: string, workspacePath: string) => Promise<{
			success: boolean;
			output?: string;
			error?: string;
		}>
	) {
		this.executeCodeInWorkspace = async (code: string, workspacePath: string) => {
			return executeFunction(code, workspacePath);
		};
	}
}