// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import Store from "electron-store";
import { JupyterService } from "./services/JupyterService";
import { WorkspaceEnvironmentService } from "./services/WorkspaceEnvironmentService";

// Store for app settings
const store = new Store();

export class AxonApp {
	private mainWindow: BrowserWindow | null = null;
	private bioragServer: ChildProcess | null = null;
	private jupyterProcess: ChildProcess | null = null;
	// Track cancellable processes for virtual env creation and installation
	private venvCreateProcess: ChildProcess | null = null;
	private venvInstallProcess: ChildProcess | null = null;
	private jupyterPort: number = 8888;
	private bioragPort: number = 8001;
	// Track which workspace the current Jupyter server was started for
	private currentJupyterWorkspace: string | null = null;
	// FS watchers per workspace root
	private workspaceWatchers: Map<string, fs.FSWatcher> = new Map();

	// Centralized services
	private jupyterService: JupyterService;
	private workspaceEnvironmentService: WorkspaceEnvironmentService;

	// Ensure the configured Jupyter port is available; if occupied, try to free it or switch to an available port
	private async ensureJupyterPortAvailable(): Promise<void> {
		try {
			const desiredPort = this.jupyterPort;
			const isAvailable = await new Promise<boolean>((resolve) => {
				const net = require("net");
				const tester = net
					.createServer()
					.once("error", () => resolve(false))
					.once("listening", () => {
						tester.once("close", () => resolve(true)).close();
					})
					.listen(desiredPort, "127.0.0.1");
			});

			if (isAvailable) return;

			// Try to free the port gracefully
			try {
				const { exec } = require("child_process");
				const { promisify } = require("util");
				const execAsync = promisify(exec);
				if (process.platform === "win32") {
					await execAsync(
						`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${desiredPort}') do taskkill /f /pid %a`
					).catch(() => {});
				} else {
					await execAsync(`lsof -ti:${desiredPort} | xargs kill -9`).catch(
						() => {}
					);
				}
			} catch (_) {}

			// Recheck; if still not available, find a new port
			const recheckAvailable = await new Promise<boolean>((resolve) => {
				const net = require("net");
				const tester = net
					.createServer()
					.once("error", () => resolve(false))
					.once("listening", () => {
						tester.once("close", () => resolve(true)).close();
					})
					.listen(desiredPort, "127.0.0.1");
			});

			if (!recheckAvailable) {
				const getPort = require("get-port");
				const newPort = await getPort({ port: getPort.makeRange(8889, 8999) });
				console.log(
					`Port ${desiredPort} busy; switching Jupyter to ${newPort}`
				);
				this.jupyterPort = newPort;
			}
		} catch (error) {
			console.warn("Failed to ensure Jupyter port availability:", error);
		}
	}

	constructor() {
		// Initialize centralized services
		this.jupyterService = new JupyterService(
			JupyterService.getDefaultConfig(this.jupyterPort)
		);
		this.workspaceEnvironmentService = new WorkspaceEnvironmentService();
		
		this.initializeApp();
	}

	private initializeApp() {
		app
			.whenReady()
			.then(async () => {
				try {
					this.createMainWindow();
					
					// Start BioRAG server only if not in split mode
					if (process.env.SPLIT_BACKEND !== "true") {
						await this.startBioRAGServer();
					} else {
						console.log("🔗 Split backend mode - BioRAG server should be started manually");
						console.log("💡 Run: npm run backend:dev");
					}
					
					this.setupIpcHandlers();
					this.createMenu();
				} catch (error) {
					console.error("Error during app initialization:", error);
				}
			})
			.catch((error) => {
				console.error("Failed to initialize app:", error);
			});

		app.on("window-all-closed", () => {
			try {
				this.cleanup();
				if (process.platform !== "darwin") {
					app.quit();
				}
			} catch (error) {
				console.error("Error during app cleanup:", error);
			}
		});

		app.on("activate", () => {
			try {
				if (BrowserWindow.getAllWindows().length === 0) {
					this.createMainWindow();
				}
			} catch (error) {
				console.error("Error during app activation:", error);
			}
		});

		// Handle unhandled promise rejections
		process.on("unhandledRejection", (reason, promise) => {
			console.error("Unhandled promise rejection:", reason);
		});

		process.on("uncaughtException", (error) => {
			console.error("Uncaught exception:", error);
		});
	}

	private createMainWindow() {
		const iconPath = path.join(__dirname, "..", "png", "axon-apple-120.png");

		this.mainWindow = new BrowserWindow({
			width: 1400,
			height: 900,
			minWidth: 1200,
			minHeight: 700,
			title: "Axon",
			icon: iconPath,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: path.join(__dirname, "preload.js"),
				webSecurity: true, // Enable web security
				webviewTag: true, // Enable webview elements
				allowRunningInsecureContent: false, // Disable insecure content
				sandbox: false, // Disable sandbox for webview compatibility
			},
			titleBarStyle: "hiddenInset",
			show: false,
		});

		// Set dock icon programmatically for macOS
		if (process.platform === "darwin") {
			app.dock.setIcon(iconPath);
			console.log("Set dock icon to:", iconPath);
		}

		// Set CSP headers for better security
		this.mainWindow.webContents.session.webRequest.onHeadersReceived(
			(details, callback) => {
				// Use different CSP for development vs production
				const isDevelopment = process.env.NODE_ENV === "development";
				const scriptSrc = isDevelopment
					? "'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net"
					: "'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net";

				const csp = `default-src 'self' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net http://axon.celvox.co:*; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net; img-src 'self' data: https: http://127.0.0.1:* http://localhost:*; connect-src 'self' http://127.0.0.1:* http://localhost:* https://localhost:* https://cdn.jsdelivr.net http://axon.celvox.co:*; frame-src 'self' http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:;`;

				callback({
					responseHeaders: {
						...details.responseHeaders,
						"Content-Security-Policy": [csp],
					},
				});
			}
		);

		// Load the React app
		if (process.env.NODE_ENV === "development") {
			this.mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
			this.mainWindow.webContents.openDevTools();
		} else {
			this.mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
		}

		this.mainWindow.once("ready-to-show", () => {
			this.mainWindow?.show();
			
			// Update services with main window reference
			this.jupyterService = new JupyterService(
				JupyterService.getDefaultConfig(this.jupyterPort),
				this.mainWindow!
			);

			// Configure workspace environment service with code execution capability
			this.workspaceEnvironmentService.setCodeExecutionFunction(
				async (code: string, workspacePath: string) => {
					return this.executeCodeUsingCentralizedService(code, workspacePath);
				}
			);
		});

		// Handle external links
		this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url);
			return { action: "deny" };
		});
	}

	private createMenu() {
		const template = [
			{
				label: "File",
				submenu: [
					{
						label: "Open Folder",
						accelerator: process.platform === "darwin" ? "Cmd+O" : "Ctrl+O",
						click: async () => {
							// Just trigger the same action as the UI buttons
							this.mainWindow?.webContents.send("trigger-open-workspace");
						},
					},
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			{
				label: "Edit",
				submenu: [
					{ role: "undo" },
					{ role: "redo" },
					{ type: "separator" },
					{ role: "cut" },
					{ role: "copy" },
					{ role: "paste" },
					{ role: "selectAll" },
				],
			},
			{
				label: "View",
				submenu: [{ role: "toggledevtools" }, { role: "reload" }],
			},
		];
		const menu = Menu.buildFromTemplate(template as any);
		Menu.setApplicationMenu(menu);
	}

	private async startBioRAGServer() {
		try {
			// Skip BioRAG server in development if SKIP_BIORAG environment variable is set
			if (process.env.SKIP_BIORAG === "true") {
				console.log("⏭️  Skipping BioRAG server startup (SKIP_BIORAG=true)");
				this.mainWindow?.webContents.send(
					"biorag-log",
					"BioRAG server disabled for faster development startup"
				);
				return;
			}

			// Check if BioRAG server is already running on the configured port
			const isRunning = await this.checkBioRAGServerRunning();
			if (isRunning) {
				console.log(`BioRAG server already running on port ${this.bioragPort}`);
				this.mainWindow?.webContents.send(
					"biorag-log",
					`Using existing BioRAG server on port ${this.bioragPort}`
				);
				return;
			}

			// In production, use remote server
			if (app.isPackaged) {
				console.log("Using remote BioRAG server at http://axon.celvox.co:8002");
				this.mainWindow?.webContents.send("biorag-server-ready", {
					port: 8002,
					url: "http://axon.celvox.co:8002",
				});
				return;
			}

			// In development, start local server with simple Python
			console.log(`Starting local BioRAG server on port ${this.bioragPort}`);

			// Use simple python3 command - no version checking needed for dev server
			const pythonPath = "python3";

			// Report Python version being used for backend
			try {
				const version = await this.getPythonVersion(pythonPath);
				console.log(`BioRAG backend using Python: ${pythonPath} - ${version}`);
			} catch (error) {
				console.log(
					`BioRAG backend using Python: ${pythonPath} (version check failed)`
				);
			}
			const backendWorkingDir = path.join(__dirname, "..", "..");

			this.bioragServer = spawn(
				pythonPath,
				[
					"-m",
					"backend.cli",
					"serve",
					"--host",
					"0.0.0.0",
					"--port",
					this.bioragPort.toString(),
				],
				{
					cwd: backendWorkingDir,
					stdio: "pipe",
				}
			);

			if (this.bioragServer?.stdout) {
				this.bioragServer.stdout.on("data", (data) => {
					const message = data.toString();
					console.log("BioRAG Server:", message);
					this.mainWindow?.webContents.send("biorag-log", message);
				});
			}

			if (this.bioragServer?.stderr) {
				this.bioragServer.stderr.on("data", (data) => {
					const message = data.toString();
					console.error("BioRAG Server Error:", message);
					this.mainWindow?.webContents.send("biorag-error", message);
				});
			}

			this.bioragServer?.on("error", (error) => {
				console.error("BioRAG server process error:", error);
				this.mainWindow?.webContents.send("biorag-error", error.message);
			});

			this.bioragServer?.on("close", (code) => {
				console.log(`BioRAG server process exited with code ${code}`);
				this.bioragServer = null;
			});

			// Wait a bit for server to start
			setTimeout(async () => {
				const isServerReady = await this.checkBioRAGServerRunning();
				if (isServerReady) {
					console.log(
						`BioRAG server started successfully on port ${this.bioragPort}`
					);
					this.mainWindow?.webContents.send("biorag-server-ready", {
						port: this.bioragPort,
						url: `http://localhost:${this.bioragPort}`,
					});
				} else {
					console.log(
						"BioRAG server may not have started properly, but continuing..."
					);
				}
			}, 3000);
		} catch (error) {
			console.error("Failed to start BioRAG server:", error);
			this.mainWindow?.webContents.send(
				"biorag-error",
				`Failed to start BioRAG server: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	}

	private async findAvailablePort(startPort: number): Promise<number> {
		const net = require("net");

		return new Promise((resolve, reject) => {
			let currentPort = startPort;
			const maxAttempts = 10; // Prevent infinite loops
			let attempts = 0;

			const tryPort = (port: number) => {
				if (attempts >= maxAttempts) {
					reject(
						new Error(
							`Could not find available port after ${maxAttempts} attempts starting from ${startPort}`
						)
					);
					return;
				}

				attempts++;
				const server = net.createServer();

				server.listen(port, "127.0.0.1", () => {
					const allocatedPort = (server.address() as any)?.port;
					server.close(() => {
						console.log(`Found available port: ${allocatedPort}`);
						resolve(allocatedPort);
					});
				});

				server.on("error", (err: any) => {
					if (err.code === "EADDRINUSE") {
						console.log(`Port ${port} is busy, trying ${port + 1}`);
						tryPort(port + 1);
					} else {
						reject(err);
					}
				});
			};

			tryPort(currentPort);
		});
	}

	private async checkBioRAGServerRunning(): Promise<boolean> {
		try {
			const response = await fetch(
				`http://localhost:${this.bioragPort}/health`
			);
			return response.ok;
		} catch {
			return false;
		}
	}


	/**
	 * Normalize a workspace path to a stable canonical form for map keys and comparisons.
	 * Uses realpath (resolves symlinks) when possible, falling back to path.resolve.
	 */
	private normalizeWorkspacePath(workspacePath: string): string {
		try {
			// Prefer native realpath to preserve case on Windows when available
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			return fs.realpathSync.native
				? (fs.realpathSync.native as any)(workspacePath)
				: fs.realpathSync(workspacePath);
		} catch (_) {
			try {
				return path.resolve(workspacePath);
			} catch (_) {
				return workspacePath;
			}
		}
	}

	/**
	 * Centralized method to get the correct venv path for a given directory.
	 * This handles the distinction between workspace root and analysis folders.
	 */
	private getVenvPath(directoryPath: string): string {
		return path.join(directoryPath, "venv");
	}

	/**
	 * Get platform-specific Python executable path within a venv
	 */
	private getVenvPythonPath(venvPath: string): string {
		return process.platform === "win32"
			? path.join(venvPath, "Scripts", "python.exe")
			: path.join(venvPath, "bin", "python");
	}

	/**
	 * Get platform-specific pip executable path within a venv
	 */
	private getVenvPipPath(venvPath: string): string {
		if (process.platform === "win32") {
			return path.join(venvPath, "Scripts", "pip.exe");
		} else if (process.platform === "darwin") {
			// On macOS, prefer pip3 if it exists
			const pip3Path = path.join(venvPath, "bin", "pip3");
			const pipPath = path.join(venvPath, "bin", "pip");
			return fs.existsSync(pip3Path) ? pip3Path : pipPath;
		} else {
			// Linux and other Unix systems
			return path.join(venvPath, "bin", "pip");
		}
	}

	/**
	 * Search for existing venv in current directory and parent directories (up to 3 levels)
	 */
	private findExistingVenv(basePath: string): string | null {
		console.log(`🔍 Searching for existing venv starting from: ${basePath}`);
		const pathParts = basePath.split(path.sep);

		// Check current directory and up to 3 levels up
		for (let i = 0; i <= 3 && pathParts.length > i; i++) {
			const checkPath = pathParts.slice(0, pathParts.length - i).join(path.sep);
			if (!checkPath) continue;

			const venvPath = this.getVenvPath(checkPath);
			const pythonExe = this.getVenvPythonPath(venvPath);

			console.log(
				`🔍 Checking: ${checkPath} → venv: ${venvPath} → python: ${pythonExe}`
			);
			console.log(`🔍 Python executable exists: ${fs.existsSync(pythonExe)}`);

			if (fs.existsSync(pythonExe)) {
				console.log(`✅ Found existing venv at: ${venvPath}`);
				return checkPath;
			}
		}
		console.log(`❌ No existing venv found starting from: ${basePath}`);
		return null;
	}

	/**
	 * Centralized venv creation with timeout and proper error handling
	 */
	private async createVirtualEnvironment(
		workspacePath: string,
		pythonPath: string
	): Promise<void> {
		const venvPath = this.getVenvPath(workspacePath);

		console.log(`Creating virtual environment with Python: ${pythonPath}`);
		console.log(`Target venv path: ${venvPath}`);

		const createVenvProcess = spawn(pythonPath, ["-m", "venv", venvPath], {
			cwd: workspacePath,
			stdio: "pipe",
		});

		// Store reference for cancellation
		this.venvCreateProcess = createVenvProcess;

		return new Promise<void>((resolve, reject) => {
			let stdout = "";
			let stderr = "";

			// Set timeout for the operation
			const timeout = setTimeout(() => {
				console.error(
					"Virtual environment creation timed out after 60 seconds"
				);
				createVenvProcess.kill("SIGKILL");
				reject(new Error("Virtual environment creation timed out"));
			}, 60000);

			createVenvProcess.stdout?.on("data", (data) => {
				stdout += data.toString();
				console.log(`[venv stdout]: ${data.toString().trim()}`);
			});

			createVenvProcess.stderr?.on("data", (data) => {
				stderr += data.toString();
				console.log(`[venv stderr]: ${data.toString().trim()}`);
			});

			createVenvProcess.on("close", (code) => {
				clearTimeout(timeout);
				console.log(
					`Virtual environment creation completed with code: ${code}`
				);
				this.venvCreateProcess = null;

				if (code === 0) {
					console.log("Virtual environment created successfully");
					resolve();
				} else {
					reject(
						new Error(
							`Virtual environment creation failed with code ${code}: ${
								stderr || stdout || "Unknown error"
							}`
						)
					);
				}
			});

			createVenvProcess.on("error", (error) => {
				clearTimeout(timeout);
				console.error("Virtual environment creation process error:", error);
				this.venvCreateProcess = null;
				reject(error);
			});
		});
	}

	/**
	 * Centralized method to ensure a venv exists for a given directory
	 * Returns the directory that contains the venv (might be parent directory)
	 */
	private async ensureVirtualEnvironment(
		workspacePath: string
	): Promise<string> {
		// First, look for existing venv in current directory and parent directories
		const existingWorkspace = this.findExistingVenv(workspacePath);
		if (existingWorkspace) {
			console.log(`Using existing venv at workspace: ${existingWorkspace}`);
			return existingWorkspace;
		}

		// No existing venv found, create new one
		const pythonPath = await this.findPythonPath();
		await this.createVirtualEnvironment(workspacePath, pythonPath);
		return workspacePath;
	}






	private async findPythonPath(): Promise<string> {
		const { execFile } = require("child_process");
		const { promisify } = require("util");
		const execFileAsync = promisify(execFile);

		const MINIMUM_PYTHON_VERSION = "3.11.0";

		// Check if we have app-managed Python first
		const appPythonPath = path.join(
			app.getPath("userData"),
			"python3.11",
			"bin",
			"python3"
		);
		if (fs.existsSync(appPythonPath)) {
			try {
				const version = await this.getPythonVersion(appPythonPath);
				if (this.isVersionSufficient(version, MINIMUM_PYTHON_VERSION)) {
					console.log(
						`Using app-managed Python: ${appPythonPath} - ${version}`
					);
					return appPythonPath;
				}
			} catch (error) {
				console.log("App-managed Python not working, will re-download");
			}
		}

		// Try to find suitable Python (3.11+), starting with pyenv
		const pythonCommands = [
			// Pyenv-managed Python (preferred for biological analysis)
			`${process.env.HOME}/.pyenv/bin/python`,
			`${process.env.HOME}/.pyenv/versions/3.11.7/bin/python`,
			`${process.env.HOME}/.pyenv/shims/python3`,
			`${process.env.HOME}/.pyenv/shims/python`,
			// System Python
			"python3.12",
			"python3.11",
			"/opt/homebrew/bin/python3.12",
			"/opt/homebrew/bin/python3.11",
			"/opt/homebrew/bin/python3",
			"/usr/local/bin/python3.12",
			"/usr/local/bin/python3.11",
			"/usr/local/bin/python3",
			"python3",
			"python",
			"/usr/bin/python3",
		];

		let foundAnyPython = false;
		for (const cmd of pythonCommands) {
			try {
				const version = await this.getPythonVersion(cmd);
				console.log(`Found Python at: ${cmd} - ${version}`);
				foundAnyPython = true;

				if (this.isVersionSufficient(version, MINIMUM_PYTHON_VERSION)) {
					console.log(`✅ Suitable Python found: ${cmd} - ${version}`);
					return cmd;
				} else {
					console.log(
						`⚠️ Python too old: ${cmd} - ${version} (need ${MINIMUM_PYTHON_VERSION}+)`
					);
				}
			} catch (error) {
				console.log(`Python command ${cmd} not available`);
			}
		}

		// No suitable Python found, install Python 3.11 for biological analysis
		if (foundAnyPython) {
			console.log("Found Python but too old, installing Python 3.11...");
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "required",
				message:
					"🧬 Your current Python version is too old for biological analysis",
				reason:
					"Modern biological packages require Python 3.11+. Installing automatically...",
				timestamp: new Date().toISOString(),
			});
		} else {
			console.log("No Python found on system, installing Python 3.11...");
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "required",
				message: "🧬 Installing Python for biological analysis",
				reason:
					"No suitable Python found. Installing Python 3.11+ for biological data analysis...",
				timestamp: new Date().toISOString(),
			});
		}
		await this.downloadAndSetupPython();
		return appPythonPath;
	}

	private async getPythonVersion(pythonPath: string): Promise<string> {
		const { execFile } = require("child_process");
		const { promisify } = require("util");
		const execFileAsync = promisify(execFile);

		const result = await execFileAsync(pythonPath, ["--version"]);
		// Extract version from "Python 3.11.7" format
		const versionMatch = result.stdout.trim().match(/Python (\d+\.\d+\.\d+)/);
		return versionMatch ? versionMatch[1] : "0.0.0";
	}

	private isVersionSufficient(
		currentVersion: string,
		minVersion: string
	): boolean {
		const current = currentVersion.split(".").map(Number);
		const minimum = minVersion.split(".").map(Number);

		for (let i = 0; i < 3; i++) {
			if (current[i] > minimum[i]) return true;
			if (current[i] < minimum[i]) return false;
		}
		return true; // Equal versions are sufficient
	}

	private async downloadAndSetupPython(): Promise<void> {
		// Notify user about Python setup
		this.mainWindow?.webContents.send("python-setup-status", {
			status: "required",
			message:
				"Setting up Python 3.11 for optimal data science compatibility...",
			reason: "No suitable Python found on your system (need Python 3.11+)",
			timestamp: new Date().toISOString(),
		});

		try {
			const pythonDir = path.join(app.getPath("userData"), "python3.11");

			// Ensure directory exists
			if (!fs.existsSync(pythonDir)) {
				fs.mkdirSync(pythonDir, { recursive: true });
			}

			// Download Python based on platform
			const platform = process.platform;
			let downloadUrl: string;
			let pythonVersion = "3.11.7";

			if (platform === "darwin" || platform === "linux") {
				// Install Python via pyenv for virtual environment creation
				await this.installPythonViaPyenv();
				return;
			} else if (platform === "win32") {
				downloadUrl = `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`;
			} else {
				// Linux - use portable Python build
				downloadUrl = `https://github.com/indygreg/python-build-standalone/releases/download/20231002/cpython-${pythonVersion}+20231002-x86_64-unknown-linux-gnu-install_only.tar.gz`;
			}

			this.mainWindow?.webContents.send("python-setup-status", {
				status: "downloading",
				message: `Downloading Python ${pythonVersion}...`,
				progress: 0,
				timestamp: new Date().toISOString(),
			});

			await this.downloadPythonFromUrl(downloadUrl, pythonDir, pythonVersion);

			this.mainWindow?.webContents.send("python-setup-status", {
				status: "completed",
				message: `✅ Python ${pythonVersion} ready for data analysis`,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			console.error("Failed to download Python:", error);
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "error",
				message:
					"Failed to setup Python. Please install Python 3.11+ manually.",
				error: error instanceof Error ? error.message : String(error),
				timestamp: new Date().toISOString(),
			});
			throw error;
		}
	}

	private async installPythonViaPyenv(): Promise<void> {
		const { promisify } = require("util");
		const exec = promisify(require("child_process").exec);
		const pythonVersion = "3.11.7";

		try {
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "installing",
				message: "🔧 Setting up Python environment for biological analysis...",
				timestamp: new Date().toISOString(),
			});

			// Check if pyenv is installed, if not install it
			try {
				await exec("which pyenv");
			} catch (error) {
				console.log("Installing pyenv...");
				this.mainWindow?.webContents.send("python-setup-status", {
					status: "installing",
					message: "📦 Installing Python version manager (pyenv)...",
					timestamp: new Date().toISOString(),
				});

				// Install pyenv via the official installer
				await exec("curl https://pyenv.run | bash");
			}

			// Add pyenv to PATH for this session
			process.env.PATH = `${process.env.HOME}/.pyenv/bin:${process.env.PATH}`;

			// Install Python 3.11.7
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "installing",
				message: `🐍 Installing Python ${pythonVersion} for biological packages...`,
				timestamp: new Date().toISOString(),
			});

			await exec(`~/.pyenv/bin/pyenv install ${pythonVersion}`);
			await exec(`~/.pyenv/bin/pyenv global ${pythonVersion}`);

			this.mainWindow?.webContents.send("python-setup-status", {
				status: "completed",
				message: `✅ Python ${pythonVersion} installed and ready for biological analysis!`,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			console.error("Failed to install Python via pyenv:", error);
			this.mainWindow?.webContents.send("python-setup-status", {
				status: "error",
				message:
					"Failed to install Python for biological analysis. Please install Python 3.11+ manually.",
				error: error instanceof Error ? error.message : String(error),
				timestamp: new Date().toISOString(),
			});
			throw error;
		}
	}

	private async downloadPythonFromUrl(
		url: string,
		targetDir: string,
		version: string
	): Promise<void> {
		const https = require("https");
		const fs = require("fs");
		const path = require("path");

		return new Promise((resolve, reject) => {
			const fileName = path.basename(url);
			const filePath = path.join(targetDir, fileName);

			const file = fs.createWriteStream(filePath);
			let downloadedBytes = 0;
			let totalBytes = 0;

			const request = https.get(url, (response: any) => {
				// Handle redirects (301, 302, 307, 308)
				if (
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location
				) {
					// Follow redirect
					this.downloadPythonFromUrl(
						response.headers.location,
						targetDir,
						version
					)
						.then(resolve)
						.catch(reject);
					return;
				}

				if (response.statusCode !== 200) {
					reject(new Error(`Download failed: ${response.statusCode}`));
					return;
				}

				totalBytes = parseInt(response.headers["content-length"] || "0", 10);

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					const progress =
						totalBytes > 0
							? Math.round((downloadedBytes / totalBytes) * 100)
							: 0;

					this.mainWindow?.webContents.send("python-setup-status", {
						status: "downloading",
						message: `Downloading Python ${version} (${Math.round(
							downloadedBytes / 1024 / 1024
						)}MB of ${Math.round(totalBytes / 1024 / 1024)}MB)...`,
						progress,
						timestamp: new Date().toISOString(),
					});
				});

				response.pipe(file);

				file.on("finish", async () => {
					file.close();

					try {
						// Extract and setup Python based on file type
						await this.extractAndSetupPython(filePath, targetDir, version);
						resolve();
					} catch (error) {
						reject(error);
					}
				});
			});

			request.on("error", reject);
			file.on("error", reject);
		});
	}

	private async extractAndSetupPython(
		filePath: string,
		targetDir: string,
		version: string
	): Promise<void> {
		const { promisify } = require("util");
		const exec = promisify(require("child_process").exec);

		this.mainWindow?.webContents.send("python-setup-status", {
			status: "installing",
			message: `Setting up Python ${version}...`,
			timestamp: new Date().toISOString(),
		});

		try {
			if (filePath.endsWith(".zip")) {
				// Extract ZIP file (Windows) - pure Node.js implementation
				const AdmZip = require("adm-zip");
				const zip = new AdmZip(filePath);
				zip.extractAllTo(targetDir, true);
			} else if (filePath.endsWith(".tar.gz")) {
				// Extract tar.gz file (Linux) - use Node.js if tar not available
				try {
					await exec(`tar -xzf "${filePath}" -C "${targetDir}"`);
				} catch (tarError) {
					// Fallback: try to extract with Node.js zlib
					console.log(
						"tar command not available, attempting Node.js extraction..."
					);
					await this.extractTarGzWithNodeJs(filePath, targetDir);
				}
			}

			// Clean up downloaded file
			fs.unlinkSync(filePath);
		} catch (error) {
			console.error("Python extraction failed:", error);
			throw new Error(
				`Failed to extract Python: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	private async extractTarGzWithNodeJs(
		filePath: string,
		targetDir: string
	): Promise<void> {
		const zlib = require("zlib");
		const tar = require("tar");
		const fs = require("fs");

		// Create read stream -> gunzip -> tar extract
		const readStream = fs.createReadStream(filePath);
		const gunzip = zlib.createGunzip();

		return new Promise((resolve, reject) => {
			readStream
				.pipe(gunzip)
				.pipe(tar.extract({ cwd: targetDir }))
				.on("error", reject)
				.on("end", resolve);
		});
	}

	private async startJupyterIfNeeded(
		workspacePath: string
	): Promise<{ success: boolean; error?: string }> {
		try {
			console.log(
				`🔧 startJupyterIfNeeded called with workspacePath: ${workspacePath}`
			);
			// Check if Jupyter is already running and healthy
			if (this.jupyterProcess) {
				let needRestart = false;
				try {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(
						`http://127.0.0.1:${this.jupyterPort}/api/status`,
						{
							signal: controller.signal,
							headers: { Accept: "application/json" },
						}
					);

					clearTimeout(timeoutId);

					if (response.ok) {
						// If server is healthy but workspace changed, restart for new workspace
						if (
							this.currentJupyterWorkspace &&
							this.normalizeWorkspacePath(this.currentJupyterWorkspace) !==
								this.normalizeWorkspacePath(workspacePath)
						) {
							console.log(
								`Jupyter running for a different workspace (current: ${this.currentJupyterWorkspace}). Will restart for: ${workspacePath}`
							);
							needRestart = true;
						} else {
							console.log(
								"Jupyter is already running and healthy for this workspace"
							);
							return { success: true };
						}
					} else {
						// Status endpoint not OK
						needRestart = true;
					}
				} catch (error) {
					console.log("Jupyter health check failed, will restart");
					needRestart = true;
				}

				if (needRestart) {
					console.log(
						"Jupyter is running but not healthy or workspace changed, restarting..."
					);
					// Fix race condition: check if process still exists before killing
					if (this.jupyterProcess) {
						this.jupyterProcess.kill();
						this.jupyterProcess = null;
					}
					this.currentJupyterWorkspace = null;
					// Wait a moment for the process to fully stop
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}

			console.log("Starting Jupyter server...");

			// Ensure desired port is available; if not, free it or pick an available one
			await this.ensureJupyterPortAvailable();

			// Ensure virtual environment exists (will find existing or create new)
			const actualWorkspacePath = await this.ensureVirtualEnvironment(
				workspacePath
			);
			const venvPath = this.getVenvPath(actualWorkspacePath);

			// Get platform-specific pip and python paths for the virtual environment
			const pipPath = this.getVenvPipPath(venvPath);
			const pythonVenvPath = this.getVenvPythonPath(venvPath);

			// Verify virtual environment executables exist
			if (!fs.existsSync(pipPath)) {
				throw new Error(`Virtual environment pip not found at: ${pipPath}`);
			}
			if (!fs.existsSync(pythonVenvPath)) {
				throw new Error(
					`Virtual environment python not found at: ${pythonVenvPath}`
				);
			}

			// Install Jupyter only if missing to avoid repeated slow installs
			const requiredPackages = ["jupyter", "notebook", "ipykernel"];
			const isPkgInstalled = async (pkg: string): Promise<boolean> => {
				return await new Promise<boolean>((resolve) => {
					const p = spawn(pipPath, ["show", pkg], { stdio: "pipe" });
					p.on("close", (code) => resolve(code === 0));
					p.on("error", () => resolve(false));
				});
			};
			const missingPkgs: string[] = [];
			for (const pkg of requiredPackages) {
				// eslint-disable-next-line no-await-in-loop
				const installed = await isPkgInstalled(pkg);
				if (!installed) missingPkgs.push(pkg);
			}
			if (missingPkgs.length > 0) {
				console.log(`Installing Jupyter packages: ${missingPkgs.join(", ")}`);
				await new Promise<void>((resolve, reject) => {
					const installProcess = spawn(pipPath, ["install", ...missingPkgs]);

					installProcess.on("error", (error: Error) => {
						console.error("Error installing Jupyter packages:", error);
						reject(error);
					});

					installProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Jupyter packages installed successfully");
							resolve();
						} else {
							reject(
								new Error(`Failed to install packages, exit code: ${code}`)
							);
						}
					});
				});
			} else {
				console.log(
					"Skipping Jupyter install - required packages already present"
				);
			}


			// Ensure a kernelspec exists inside this workspace venv and points to this venv's python
			try {
				const venvKernelDir = path.join(
					venvPath,
					"share",
					"jupyter",
					"kernels",
					"python3"
				);
				let needKernelInstall = true;
				try {
					const kernelJsonPath = path.join(venvKernelDir, "kernel.json");
					if (fs.existsSync(kernelJsonPath)) {
						const kernelSpec = JSON.parse(
							fs.readFileSync(kernelJsonPath, "utf-8")
						);
						const argv0: string | undefined = kernelSpec?.argv?.[0];
						if (argv0 && path.resolve(argv0) === path.resolve(pythonVenvPath)) {
							needKernelInstall = false;
						}
					}
				} catch (_) {}

				if (needKernelInstall) {
					console.log("Installing ipykernel kernelspec into workspace venv...");
					await new Promise<void>((resolve, reject) => {
						const p = spawn(
							pythonVenvPath,
							[
								"-m",
								"ipykernel",
								"install",
								"--prefix",
								venvPath,
								"--name",
								"python3",
								"--display-name",
								"Python 3 (Axon Workspace)",
							],
							{ stdio: "pipe" }
						);
						let stderr = "";
						p.stderr?.on("data", (d) => (stderr += d.toString()));
						p.on("error", reject);
						p.on("close", (code) => {
							if (code === 0) return resolve();
							reject(
								new Error(
									`ipykernel install failed (code ${code}): ${stderr}`
								)
							);
						});
					});
				}
			} catch (e) {
				console.warn(
					"Proceeding without preinstalled kernelspec; Jupyter may pick a global one",
					e instanceof Error ? e.message : String(e)
				);
			}


			// Start Jupyter server
			console.log(`Starting Jupyter server for workspace: ${workspacePath}`);

			this.jupyterProcess = spawn(
				pythonVenvPath,
				[
					"-m",
					"jupyter",
					"server",
					"--no-browser",
					`--port=${this.jupyterPort}`,
					"--ip=127.0.0.1",
					"--allow-root",
					"--ServerApp.token=''",
					"--ServerApp.password=''",
					"--ServerApp.disable_check_xsrf=True",
					"--ServerApp.websocket_ping_interval=30000",
					"--ServerApp.websocket_ping_timeout=30000",
					`--ServerApp.root_dir=${workspacePath}`,
				],
				{
					cwd: workspacePath,
					stdio: ["pipe", "pipe", "pipe"],
					env: {
						...process.env,
						JUPYTER_PATH: path.join(venvPath, "share", "jupyter"),
						JUPYTER_DATA_DIR: path.join(venvPath, "share", "jupyter"),
						JUPYTER_CONFIG_DIR: path.join(venvPath, "etc", "jupyter"),
					},
				}
			);

			// Log Jupyter server output for debugging
			if (this.jupyterProcess.stdout) {
				this.jupyterProcess.stdout.on("data", (data) => {
					const message = data.toString().trim();
					if (message) {
						console.log(`[Jupyter stdout]: ${message}`);
					}
				});
			}

			if (this.jupyterProcess.stderr) {
				this.jupyterProcess.stderr.on("data", (data) => {
					const message = data.toString().trim();
					if (message) {
						console.log(`[Jupyter stderr]: ${message}`);
					}
				});
			}

			this.jupyterProcess.on("error", (error: Error) => {
				console.error("Jupyter process error:", error);
			});

			this.jupyterProcess.on("close", (code: number, reason: string) => {
				console.log(`Jupyter process closed with code: ${code}`);
				this.jupyterProcess = null;
				this.currentJupyterWorkspace = null;
			});

			// Wait for Jupyter to start (configurable timeout)
			await new Promise<void>((resolve, reject) => {
				const storeTimeout = store.get("jupyterStartupTimeoutMs") as any as
					| number
					| undefined;
				const envTimeout = process.env.JUPYTER_STARTUP_TIMEOUT_MS
					? parseInt(process.env.JUPYTER_STARTUP_TIMEOUT_MS, 10)
					: undefined;
				const startupTimeoutMs =
					Number.isFinite(storeTimeout as any) && (storeTimeout as any) > 0
						? (storeTimeout as number)
						: Number.isFinite(envTimeout as any) && (envTimeout as any) > 0
						? (envTimeout as number)
						: 60000; // default 60s

				const timeout = setTimeout(() => {
					reject(new Error("Jupyter startup timeout"));
				}, startupTimeoutMs);

				const checkReady = async () => {
					try {
						// Prefer status endpoint; fall back to sessions if status is unavailable
						const statusResp = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/status`
						);
						if (statusResp.ok) {
							clearTimeout(timeout);
							console.log("Jupyter server is ready (status)");
							resolve();
							return;
						}
					} catch (_) {}
					try {
						const sessionsResp = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/sessions`
						);
						if (sessionsResp.ok) {
							clearTimeout(timeout);
							console.log("Jupyter server is ready (sessions)");
							resolve();
							return;
						}
					} catch (_) {}
					// Not ready yet; schedule another check
					setTimeout(checkReady, 1000);
				};
				checkReady();
			});

			// Note the workspace the server is associated with
			this.currentJupyterWorkspace = this.normalizeWorkspacePath(workspacePath);

			// Notify renderer that Jupyter is ready (optional token is empty)
			try {
				this.mainWindow?.webContents.send("jupyter-ready", {
					url: `http://127.0.0.1:${this.jupyterPort}`,
					token: "",
				});
			} catch (_) {}

			return { success: true };
		} catch (error) {
			console.error("Error starting Jupyter:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private setupIpcHandlers() {
		// Dialog operations
		ipcMain.handle("show-open-dialog", async (_, options) => {
			if (process.platform === "darwin") {
				options.properties = options.properties || [];
				if (!options.properties.includes("openDirectory")) {
					options.properties.push("openDirectory");
				}
				if (!options.properties.includes("createDirectory")) {
					options.properties.push("createDirectory");
				}
			}
			const result = await dialog.showOpenDialog(this.mainWindow!, options);
			return result;
		});

		// File system operations
		ipcMain.handle("fs-read-file", async (_, filePath: string) => {
			try {
				return await fs.promises.readFile(filePath, "utf8");
			} catch (error) {
				throw error;
			}
		});

		// Binary file read - returns a data URL for safe rendering in renderer
		ipcMain.handle("fs-read-file-binary", async (_, filePath: string) => {
			try {
				const buf = await fs.promises.readFile(filePath);
				const ext = (path.extname(filePath) || "")
					.toLowerCase()
					.replace(".", "");
				let mime = "application/octet-stream";
				if (ext) {
					if (ext === "jpg") mime = "image/jpeg";
					else if (ext === "svg") mime = "image/svg+xml";
					else if (["png", "jpeg", "gif", "webp", "bmp"].includes(ext)) {
						mime = `image/${ext}`;
					}
				}
				const base64 = buf.toString("base64");
				const dataUrl = `data:${mime};base64,${base64}`;
				return { dataUrl, mime };
			} catch (error) {
				throw error;
			}
		});

		// Search for files matching a pattern in a directory
		ipcMain.handle("fs-find-file", async (_, basePath: string, filename: string) => {
			try {
				const findFile = async (dir: string): Promise<string[]> => {
					const results: string[] = [];
					try {
						const items = await fs.promises.readdir(dir, { withFileTypes: true });
						for (const item of items) {
							const fullPath = path.join(dir, item.name);
							if (item.isDirectory()) {
								const subResults = await findFile(fullPath);
								results.push(...subResults);
							} else if (item.name === filename) {
								results.push(fullPath);
							}
						}
					} catch (e) {
						// Ignore permission errors and continue
					}
					return results;
				};
				return await findFile(basePath);
			} catch (error) {
				return [];
			}
		});

		// File system: write file
		ipcMain.handle(
			"fs-write-file",
			async (_, filePath: string, content: string) => {
				try {
					await fs.promises.writeFile(filePath, content, "utf-8");
					return { success: true };
				} catch (error) {
					console.error("Error writing file:", error);
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		ipcMain.handle("fs-create-directory", async (_, dirPath: string) => {
			try {
				await fs.promises.mkdir(dirPath, { recursive: true });
				return true;
			} catch (error) {
				throw error;
			}
		});

		// Directory existence check
		ipcMain.handle("directory-exists", async (_, dirPath: string) => {
			try {
				const stats = await fs.promises.stat(dirPath);
				return stats.isDirectory();
			} catch (error) {
				return false;
			}
		});

		ipcMain.handle("fs-list-directory", async (_, dirPath: string) => {
			try {
				// Check if directory exists
				if (!fs.existsSync(dirPath)) {
					return []; // Return empty array if directory does not exist
				}
				const entries = await fs.promises.readdir(dirPath, {
					withFileTypes: true,
				});
				return entries.map((entry) => ({
					name: entry.name,
					isDirectory: entry.isDirectory(),
					path: path.join(dirPath, entry.name),
				}));
			} catch (error) {
				throw error;
			}
		});

		// Open a file using the OS default application
		ipcMain.handle("open-file", async (_, filePath: string) => {
			try {
				const result = await shell.openPath(filePath);
				if (result) {
					return { success: false, error: result };
				}
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Return basic file info
		ipcMain.handle("get-file-info", async (_, filePath: string) => {
			try {
				const stats = await fs.promises.stat(filePath);
				return {
					size: stats.size,
					created: stats.birthtime,
					modified: stats.mtime,
					isDirectory: stats.isDirectory(),
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Delete a single file
		ipcMain.handle("delete-file", async (_, filePath: string) => {
			try {
				await fs.promises.unlink(filePath);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Delete a directory recursively
		ipcMain.handle("delete-directory", async (_, dirPath: string) => {
			try {
				// Use rm with recursive + force; fallback to rmdir if needed
				if ((fs.promises as any).rm) {
					await (fs.promises as any).rm(dirPath, { recursive: true, force: true });
				} else {
					await fs.promises.rmdir(dirPath, { recursive: true } as any);
				}
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Start filesystem watcher for a directory (recursive on supported platforms)
		ipcMain.handle("fs-watch-start", async (_: any, dirPath: string) => {
			try {
				if (!dirPath || typeof dirPath !== "string") {
					throw new Error("Invalid directory path");
				}
				// Close any existing watcher for this path first
				try {
					const existing = this.workspaceWatchers.get(dirPath);
					existing?.close();
				} catch {}

				const useRecursive = process.platform !== "linux"; // recursive not supported on Linux
				const watcher = fs.watch(
					dirPath,
					{ recursive: useRecursive },
					(_eventType, _filename) => {
						// Notify renderer to refresh tree; we don't pass payload to keep renderer simple
						try {
							this.mainWindow?.webContents.send("fs-watch-event", {
								root: dirPath,
							});
						} catch {}
					}
				);
				this.workspaceWatchers.set(dirPath, watcher);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Stop filesystem watcher for a directory
		ipcMain.handle("fs-watch-stop", async (_: any, dirPath: string) => {
			try {
				const watcher = this.workspaceWatchers.get(dirPath);
				if (watcher) {
					try {
						watcher.close();
					} catch {}
					this.workspaceWatchers.delete(dirPath);
				}
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Jupyter notebook operations
		ipcMain.handle("jupyter-start", async (_, workingDir: string) => {
			try {
				console.log(`🚀 jupyter-start called with workingDir: ${workingDir}`);
				const unifiedStart = await this.startJupyterIfNeeded(workingDir);
				if (unifiedStart.success) {
					return { success: true, url: `http://127.0.0.1:${this.jupyterPort}` };
				}
				return unifiedStart;
			} catch (error) {
				console.error("Failed to start Jupyter:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		ipcMain.handle("create-virtual-env", async (_, workspacePath: string) => {
			try {
				console.log(`Creating virtual environment in: ${workspacePath}`);

				// Use centralized venv management
				const actualWorkspacePath = await this.ensureVirtualEnvironment(
					workspacePath
				);

				if (actualWorkspacePath !== workspacePath) {
					// Found existing venv in parent directory
					this.mainWindow?.webContents.send("virtual-env-status", {
						status: "existing",
						message: `Using existing virtual environment from ${actualWorkspacePath}`,
						timestamp: new Date().toISOString(),
					});

					return {
						success: true,
						actualWorkspace: actualWorkspacePath,
						message: `Using existing virtual environment from ${actualWorkspacePath}`,
					};
				}

				// New venv was created at workspacePath
				const venvPath = this.getVenvPath(workspacePath);

				// Determine the pip path in the virtual environment
				const pipPath = this.getVenvPipPath(venvPath);
				const pythonVenvPath = this.getVenvPythonPath(venvPath);

				// Notify renderer about package installation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "installing",
					message: "Installing required packages...",
					timestamp: new Date().toISOString(),
				});

				// Install only Jupyter infrastructure here. Scientific stack will be
				// resolved together later with analysis packages to avoid version conflicts.
				const basicPackages = ["jupyter", "notebook", "ipykernel"];

				// Notify about basic infrastructure installation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "installing",
					message: "Setting up Jupyter infrastructure...",
					timestamp: new Date().toISOString(),
				});

				console.log(`Installing packages: ${basicPackages.join(", ")}`);
				console.log(`Using pip at: ${pipPath}`);

				const installProcess = spawn(pipPath, ["install", ...basicPackages], {
					cwd: workspacePath,
					stdio: "pipe",
				});
				this.venvInstallProcess = installProcess;

				await new Promise<void>((resolve, reject) => {
					let stdout = "";
					let stderr = "";

					// Set timeout for package installation (longer since it involves downloading)
					const timeout = setTimeout(() => {
						console.error("Package installation timed out after 5 minutes");
						installProcess.kill("SIGKILL");
						reject(new Error("Package installation timed out"));
					}, 300000); // 5 minute timeout

					installProcess.stdout?.on("data", (data) => {
						const output = data.toString();
						stdout += output;

						// Send progress updates for key installation events
						if (
							output.includes("Downloading") ||
							output.includes("Installing")
						) {
							this.mainWindow?.webContents.send("virtual-env-status", {
								status: "installing",
								message: output.trim(),
								timestamp: new Date().toISOString(),
							});
						}
					});

					installProcess.stderr?.on("data", (data) => {
						const output = data.toString();
						stderr += output;
					});

					installProcess.on("close", (code) => {
						clearTimeout(timeout);
						console.log(`Package installation completed with code: ${code}`);
						this.venvInstallProcess = null;

						if (code === 0) {
							console.log("Jupyter infrastructure installed successfully");
							resolve();
						} else {
							reject(
								new Error(
									`Failed to install Jupyter infrastructure, exit code: ${code}. stderr: ${stderr}`
								)
							);
						}
					});

					installProcess.on("error", (error) => {
						clearTimeout(timeout);
						console.error("Package installation process error:", error);
						reject(error);
					});
				});


				// Notify renderer about completion
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "completed",
					message: "Virtual environment ready!",
					venvPath: venvPath,
					pythonPath: pythonVenvPath,
					timestamp: new Date().toISOString(),
				});

				return {
					success: true,
					venvPath: venvPath,
					pythonPath: pythonVenvPath,
					actualWorkspace: workspacePath,
				};
			} catch (error) {
				console.error("Failed to create virtual environment:", error);

				// Notify renderer about error
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "error",
					message: `Failed to create virtual environment: ${
						error instanceof Error ? error.message : String(error)
					}`,
					timestamp: new Date().toISOString(),
				});

				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Package installation handler
		ipcMain.handle("install-packages", async (_, workspacePath: string, packages: string[]) => {
			try {
				console.log(`Installing packages in workspace: ${workspacePath}`);
				console.log(`Packages to install: ${packages.join(", ")}`);
				
				const venvPath = this.getVenvPath(workspacePath);
				const pipPath = this.getVenvPipPath(venvPath);
				
				console.log(`Using pip at: ${pipPath}`);
				
				const installProcess = spawn(pipPath, ["install", ...packages], {
					cwd: workspacePath,
					stdio: "pipe",
				});

				return new Promise((resolve) => {
					let stdout = "";
					let stderr = "";

					const timeout = setTimeout(() => {
						console.error("Package installation timed out");
						installProcess.kill("SIGKILL");
						resolve({
							success: false,
							error: "Package installation timed out",
						});
					}, 300000); // 5 minutes

					installProcess.stdout?.on("data", (data) => {
						stdout += data.toString();
					});

					installProcess.stderr?.on("data", (data) => {
						stderr += data.toString();
					});

					installProcess.on("close", (code) => {
						clearTimeout(timeout);
						if (code === 0) {
							console.log("✅ Package installation successful");
							resolve({
								success: true,
								packages: packages,
							});
						} else {
							console.error("❌ Package installation failed:", stderr);
							resolve({
								success: false,
								error: stderr || `Installation failed with code ${code}`,
							});
						}
					});

					installProcess.on("error", (error) => {
						clearTimeout(timeout);
						console.error("Package installation process error:", error);
						resolve({
							success: false,
							error: error.message,
						});
					});
				});
			} catch (error) {
				console.error("Error in install-packages handler:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// Allow renderer to cancel any ongoing virtual env creation/installation
		ipcMain.handle("cancel-virtual-env", async () => {
			try {
				let cancelled = false;
				if (this.venvInstallProcess && !this.venvInstallProcess.killed) {
					try {
						this.venvInstallProcess.kill("SIGKILL");
					} catch {}
					this.venvInstallProcess = null;
					cancelled = true;
				}
				if (this.venvCreateProcess && !this.venvCreateProcess.killed) {
					try {
						this.venvCreateProcess.kill("SIGKILL");
					} catch {}
					this.venvCreateProcess = null;
					cancelled = true;
				}
				if (cancelled) {
					this.mainWindow?.webContents.send("virtual-env-status", {
						status: "cancelled",
						message: "Virtual environment setup cancelled",
						timestamp: new Date().toISOString(),
					});
				}
				return { success: true, cancelled };
			} catch (e: any) {
				return { success: false, error: e?.message || String(e) };
			}
		});

		ipcMain.handle("jupyter-stop", async () => {
			if (this.jupyterProcess) {
				this.jupyterProcess.kill("SIGTERM");
				this.jupyterProcess = null;
				this.jupyterPort = 8888;
				return { success: true };
			}
			return { success: false };
		});

		ipcMain.handle("jupyter-status", async () => {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 5000);

				console.log(
					`Checking Jupyter status at: http://127.0.0.1:${this.jupyterPort}/api/status`
				);

				const response = await fetch(
					`http://127.0.0.1:${this.jupyterPort}/api/status`,
					{
						signal: controller.signal,
						headers: {
							Accept: "application/json",
						},
					}
				);

				clearTimeout(timeoutId);

				if (response.ok) {
					console.log("Jupyter health check: HEALTHY");
					return true;
				} else {
					console.log(`Jupyter health check: ✗ UNHEALTHY (${response.status})`);
					return false;
				}
			} catch (error) {
				console.log(
					`Jupyter health check: ✗ ERROR (${
						error instanceof Error ? error.message : "Unknown error"
					})`
				);
				return false;
			}
		});

		// Interrupt currently running execution
		ipcMain.handle(
			"jupyter-interrupt",
			async (_: any, workspacePath?: string) => {
				try {
					if (!this.jupyterProcess) {
						return { success: false, error: "Jupyter is not running" };
					}

					const wsPath =
						workspacePath || this.currentJupyterWorkspace || process.cwd();
					console.log(
						`🎯 Using wsPath for execution: ${wsPath} (workspacePath: ${workspacePath}, currentJupyterWorkspace: ${this.currentJupyterWorkspace})`
					);
					// Find any running kernel to interrupt
					let kernelId: string | undefined = undefined;
					try {
						const listResponse = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/kernels`
						);
						const kernels: any[] = listResponse.ok
							? await listResponse.json()
							: [];
						kernelId = kernels?.[0]?.id;
					} catch {}

					if (!kernelId) {
						return { success: false, error: "No active kernel found" };
					}

					try {
						const resp = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/kernels/${kernelId}/interrupt`,
							{ method: "POST" }
						);
						if (!resp.ok) {
							const text = await resp.text().catch(() => "");
							return {
								success: false,
								error: `Interrupt failed: ${resp.status} ${text}`,
							};
						}
						return { success: true };
					} catch (e: any) {
						return {
							success: false,
							error: e instanceof Error ? e.message : String(e),
						};
					}
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		ipcMain.handle(
			"jupyter-execute",
			async (_, code: string, workspacePath?: string) => {
				try {
					console.log(`🎯 jupyter-execute called with workspacePath: ${workspacePath}`);
					
					// Ensure Jupyter is running for the workspace
					const startResult = await this.startJupyterIfNeeded(
						workspacePath || process.cwd()
					);
					if (!startResult.success) {
						return {
							success: false,
							error: "Failed to start Jupyter server",
						};
					}

					// Delegate to centralized service
					return await this.executeCodeUsingCentralizedService(code, workspacePath);
				} catch (error) {
					console.error("Jupyter execution error:", error);
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		// Dialog operations
		ipcMain.handle("show-save-dialog", async (_, options) => {
			const result = await dialog.showSaveDialog(this.mainWindow!, options);
			return result;
		});

		// Store operations
		ipcMain.handle("store-get", (_, key: string) => {
			return store.get(key);
		});

		ipcMain.handle("store-set", (_, key: string, value: any) => {
			store.set(key, value);
			return true;
		});

		ipcMain.on("app-is-packaged", (event) => {
			event.returnValue = app.isPackaged;
		});

		// BioRAG operations
		ipcMain.handle("get-biorag-port", async () => {
			// Return default BioRAG port
			return 8001;
		});

		ipcMain.handle("get-biorag-url", async () => {
			// Return default BioRAG URL
			return "http://localhost:8001";
		});

		ipcMain.handle("biorag-query", async (_, query: any) => {
			// Placeholder for BioRAG query functionality
			return { success: false, error: "BioRAG service not implemented yet" };
		});
	}

	/**
	 * Execute code using centralized JupyterService
	 */
	private async executeCodeUsingCentralizedService(
		code: string,
		workspacePath?: string
	): Promise<{ success: boolean; output?: string; error?: string }> {
		try {
			// Use simplified kernel approach with dynamic kernel discovery
			console.log(`🔧 Using simplified kernel approach with dynamic discovery`);

			// Use centralized JupyterService for execution
			return await this.jupyterService.executeCode(
				code,
				workspacePath || process.cwd()
			);
		} catch (error) {
			console.error("Centralized service execution error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// Cleanup method
	private async cleanup() {
		await this.stopBioRAGServer();
		await this.stopJupyterIfNeeded();
	}

	private async stopBioRAGServer(): Promise<void> {
		if (this.bioragServer) {
			try {
				this.bioragServer.kill("SIGTERM");
				this.bioragServer = null;
				console.log("BioRAG server terminated");
			} catch (error) {
				console.error("Error terminating BioRAG server:", error);
			}
		}
	}

	private async stopJupyterIfNeeded(): Promise<void> {
		if (this.jupyterProcess) {
			try {
				console.log("Terminating Jupyter process...");
				this.jupyterProcess.kill("SIGTERM");

				// Give process 5 seconds to terminate gracefully
				setTimeout(() => {
					if (this.jupyterProcess && !this.jupyterProcess.killed) {
						console.log("Force killing Jupyter process...");
						this.jupyterProcess.kill("SIGKILL");
					}
				}, 5000);

				this.jupyterProcess = null;
				console.log("Jupyter process terminated");
			} catch (error) {
				console.error("Error terminating Jupyter process:", error);
			}
		}
	}
}

// Initialize the app
new AxonApp();
