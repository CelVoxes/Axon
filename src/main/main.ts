import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import Store from "electron-store";

// Store for app settings
const store = new Store();

export class AxonApp {
	private mainWindow: BrowserWindow | null = null;
	private bioragServer: ChildProcess | null = null;
	private jupyterProcess: ChildProcess | null = null;
	private jupyterPort: number = 8888;
	private bioragPort: number = 8000;

	constructor() {
		this.initializeApp();
	}

	private initializeApp() {
		app
			.whenReady()
			.then(async () => {
				try {
					this.createMainWindow();
					await this.startBioRAGServer();
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
		// Use PNG for development, ICNS for production on macOS
		const isDevelopment = process.env.NODE_ENV === "development";
		const iconPath =
			process.platform === "darwin" && !isDevelopment
				? path.join(__dirname, "..", "png", "axon-very-rounded-150.icns")
				: path.join(__dirname, "..", "png", "axon-very-rounded-150.png");

		// Reduced logging for cleaner output
		if (!fs.existsSync(iconPath)) {
			console.log("Default icon not found, searching alternatives...");
		}

		// Try alternative icon paths if the first one doesn't exist
		let finalIconPath = iconPath;
		if (!fs.existsSync(iconPath)) {
			const alternativePaths = [
				path.join(app.getAppPath(), "src", "png", "axon-very-rounded-150.png"),
				path.join(app.getAppPath(), "dist", "png", "axon-very-rounded-150.png"),
				path.join(
					__dirname,
					"..",
					"..",
					"src",
					"png",
					"axon-very-rounded-150.png"
				),
				// Fallback to other rounded versions
				path.join(app.getAppPath(), "src", "png", "axon-very-rounded.png"),
				path.join(app.getAppPath(), "dist", "png", "axon-very-rounded.png"),
				path.join(__dirname, "..", "..", "src", "png", "axon-very-rounded.png"),
				// Fallback to original rounded
				path.join(app.getAppPath(), "src", "png", "axon-rounded.png"),
				path.join(app.getAppPath(), "dist", "png", "axon-rounded.png"),
				path.join(__dirname, "..", "..", "src", "png", "axon-rounded.png"),
				// Final fallback to original
				path.join(app.getAppPath(), "src", "png", "axon.png"),
				path.join(app.getAppPath(), "dist", "png", "axon.png"),
				path.join(__dirname, "..", "..", "src", "png", "axon.png"),
			];

			for (const altPath of alternativePaths) {
				if (fs.existsSync(altPath)) {
					finalIconPath = altPath;
					console.log("Found icon at:", finalIconPath);
					break;
				}
			}
		}

		// Only log icon path if there were issues finding it
		if (finalIconPath !== iconPath) {
			console.log("Using alternative icon path:", finalIconPath);
		}

		this.mainWindow = new BrowserWindow({
			width: 1400,
			height: 900,
			minWidth: 1200,
			minHeight: 700,
			title: "Axon",
			icon: finalIconPath,
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
			app.dock.setIcon(finalIconPath);
			console.log("Set dock icon to:", finalIconPath);
		}

		// Set CSP headers for better security
		this.mainWindow.webContents.session.webRequest.onHeadersReceived(
			(details, callback) => {
				// Use different CSP for development vs production
				const isDevelopment = process.env.NODE_ENV === "development";
				const scriptSrc = isDevelopment
					? "'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net"
					: "'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net";

				const csp = `default-src 'self' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net; img-src 'self' data: https: http://127.0.0.1:* http://localhost:*; connect-src 'self' http://127.0.0.1:* http://localhost:* https://localhost:* https://cdn.jsdelivr.net; frame-src 'self' http://127.0.0.1:* http://localhost:*; worker-src 'self' blob:;`;

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
						accelerator: "CmdOrCtrl+O",
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
			// First, clean up any existing BioRAG processes
			await this.cleanupExistingBioRAGProcesses();

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

			// Find an available port starting from the preferred port
			const availablePort = await this.findAvailablePort(this.bioragPort);
			if (availablePort !== this.bioragPort) {
				console.log(
					`Port ${this.bioragPort} busy, using port ${availablePort} instead`
				);
				this.bioragPort = availablePort;
			}

			console.log(`Starting BioRAG server on port ${this.bioragPort}`);

			// Start the BioRAG API server with the available port
			const pythonPath = await this.findPythonPath();
			const backendPath = path.join(__dirname, "..", "..", "backend");

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
					cwd: path.dirname(backendPath),
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

					// Log port conflicts but don't restart (port should already be allocated correctly)
					if (message.includes("address already in use")) {
						console.log(
							`Port conflict detected in server stderr - this shouldn't happen as port was pre-allocated`
						);
						this.mainWindow?.webContents.send(
							"biorag-log",
							`BioRAG server encountered port conflict despite pre-allocation`
						);
					}

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
					this.mainWindow?.webContents.send(
						"biorag-log",
						`BioRAG server is ready on port ${this.bioragPort}`
					);
					// Notify renderer about the BioRAG URL
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

	private generateKernelName(workspacePath: string): string {
		const workspaceName = path.basename(workspacePath);
		// Create a shorter, sanitized kernel name with timestamp for uniqueness
		const sanitizedName = workspaceName
			.replace(/[^a-zA-Z0-9_-]/g, "_") // Replace invalid chars with underscore
			.toLowerCase() // Normalize to lowercase
			.substring(0, 10); // Limit length to 10 chars to leave room for timestamp
		const timestamp = Date.now().toString().slice(-5); // Last 5 digits of timestamp
		return `axon-${sanitizedName}-${timestamp}`;
	}

	/**
	 * Get workspace metadata including the kernel name
	 */
	private async getWorkspaceMetadata(workspacePath: string): Promise<any> {
		try {
			const metadataPath = path.join(workspacePath, ".axon-metadata.json");
			if (fs.existsSync(metadataPath)) {
				const metadataContent = fs.readFileSync(metadataPath, "utf8");
				return JSON.parse(metadataContent);
			}
		} catch (error) {
			console.warn("Failed to read workspace metadata:", error);
		}
		return null;
	}

	private async findCompatibleKernel(): Promise<string | null> {
		try {
			const response = await fetch(`http://127.0.0.1:${this.jupyterPort}/api/kernelspecs`);
			if (response.ok) {
				const kernelSpecs = await response.json();
				const axonKernels = Object.keys(kernelSpecs.kernelspecs || {})
					.filter(name => name.startsWith('axon-'));
				
				// Try to validate the first available kernel by attempting to create a test instance
				for (const kernelName of axonKernels) {
					const isValid = await this.validateKernelSpec(kernelName);
					if (isValid) {
						console.log(`Found valid compatible kernel: ${kernelName}`);
						return kernelName;
					} else {
						console.warn(`Kernel spec ${kernelName} is invalid, trying next...`);
					}
				}
			}
		} catch (error) {
			console.warn("Could not check for compatible kernels:", error);
		}
		return null;
	}

	private async validateKernelSpec(kernelName: string): Promise<boolean> {
		try {
			// Try to create a test kernel instance to validate the kernel spec
			const response = await fetch(`http://127.0.0.1:${this.jupyterPort}/api/kernels`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: kernelName })
			});
			
			if (response.ok) {
				const kernel = await response.json();
				// Immediately delete the test kernel
				try {
					await fetch(`http://127.0.0.1:${this.jupyterPort}/api/kernels/${kernel.id}`, {
						method: 'DELETE'
					});
				} catch (deleteError) {
					console.warn("Failed to cleanup test kernel:", deleteError);
				}
				return true;
			}
			return false;
		} catch (error) {
			console.warn(`Failed to validate kernel spec ${kernelName}:`, error);
			return false;
		}
	}

	private async attemptKernelRegistration(workspacePath: string, kernelName: string): Promise<boolean> {
		try {
			const venvPath = path.join(workspacePath, "venv");
			const pythonVenvPath = process.platform === "win32"
				? path.join(venvPath, "Scripts", "python.exe")
				: path.join(venvPath, "bin", "python");
				
			if (!fs.existsSync(pythonVenvPath)) {
				console.warn(`Virtual environment Python not found at ${pythonVenvPath}`);
				return false;
			}

			console.log(`Attempting to register kernel ${kernelName} with Python at: ${pythonVenvPath}`);
			
			const registerProcess = spawn(
				pythonVenvPath,
				[
					"-m",
					"ipykernel",
					"install",
					"--user",
					"--name",
					kernelName,
					"--display-name",
					`Axon Analysis (${path.basename(workspacePath)})`,
				],
				{ stdio: "pipe" }
			);
			
			return new Promise<boolean>((resolve) => {
				registerProcess.on("close", (code) => {
					if (code === 0) {
						console.log(`Kernel ${kernelName} registered successfully`);
						resolve(true);
					} else {
						console.warn(`Failed to register kernel ${kernelName}, exit code: ${code}`);
						resolve(false);
					}
				});
				registerProcess.on("error", (error) => {
					console.warn(`Error registering kernel ${kernelName}:`, error);
					resolve(false);
				});
			});
		} catch (error) {
			console.warn(`Exception during kernel registration for ${kernelName}:`, error);
			return false;
		}
	}

	private async findPythonPath(): Promise<string> {
		const { execFile } = require("child_process");
		const { promisify } = require("util");
		const execFileAsync = promisify(execFile);

		// Try different Python commands in order of preference
		const pythonCommands = [
			"python3",
			"python",
			"/usr/bin/python3",
			"/usr/local/bin/python3",
			"/opt/homebrew/bin/python3", // Homebrew on Apple Silicon
		];

		for (const cmd of pythonCommands) {
			try {
				const result = await execFileAsync(cmd, ["--version"]);
				console.log(`Found Python at: ${cmd} - ${result.stdout.trim()}`);
				return cmd;
			} catch (error) {
				console.log(`Python command ${cmd} not available`);
				// Continue to next command
			}
		}

		// Fallback to stored preference or default
		const storedPath = store.get("pythonPath", "python3") as string;
		console.log(`Using fallback Python path: ${storedPath}`);
		return storedPath;
	}

	private async startJupyterIfNeeded(
		workspacePath: string
	): Promise<{ success: boolean; error?: string }> {
		try {
			// Check if Jupyter is already running and healthy
			if (this.jupyterProcess) {
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
						console.log("Jupyter is already running and healthy");
						return { success: true };
					}
				} catch (error) {
					console.log("Jupyter health check failed, will restart");
				}

				console.log("Jupyter is running but not healthy, restarting...");
				this.jupyterProcess.kill();
				this.jupyterProcess = null;
				// Wait a moment for the process to fully stop
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}

			console.log("Starting Jupyter server...");

			// Find Python path
			const pythonPath = await this.findPythonPath();

			// Create virtual environment if it doesn't exist
			const venvPath = path.join(workspacePath, "venv");
			if (!fs.existsSync(venvPath)) {
				console.log("Creating virtual environment...");
				await new Promise<void>((resolve, reject) => {
					const createVenvProcess = spawn(pythonPath, ["-m", "venv", venvPath]);

					createVenvProcess.on("error", (error: Error) => {
						console.error("Error creating virtual environment:", error);
						reject(error);
					});

					createVenvProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Virtual environment created successfully");
							resolve();
						} else {
							reject(
								new Error(
									`Failed to create virtual environment, exit code: ${code}`
								)
							);
						}
					});
				});
			}

			// Determine pip and python paths for the virtual environment
			const isWindows = process.platform === "win32";
			const isMac = process.platform === "darwin";

			let pipPath: string;
			if (isWindows) {
				pipPath = path.join(venvPath, "Scripts", "pip.exe");
			} else if (isMac) {
				// On macOS, try pip3 first, then fall back to pip
				const pip3Path = path.join(venvPath, "bin", "pip3");
				const pipPathUnix = path.join(venvPath, "bin", "pip");

				if (fs.existsSync(pip3Path)) {
					pipPath = pip3Path;
				} else if (fs.existsSync(pipPathUnix)) {
					pipPath = pipPathUnix;
				} else {
					throw new Error(
						`No pip executable found in virtual environment. Tried: ${pip3Path} and ${pipPathUnix}`
					);
				}
			} else {
				// Linux and other Unix systems
				pipPath = path.join(venvPath, "bin", "pip");
			}

			const pythonVenvPath = isWindows
				? path.join(venvPath, "Scripts", "python.exe")
				: path.join(venvPath, "bin", "python");

			// Verify virtual environment executables exist
			if (!fs.existsSync(pipPath)) {
				throw new Error(`Virtual environment pip not found at: ${pipPath}`);
			}
			if (!fs.existsSync(pythonVenvPath)) {
				throw new Error(
					`Virtual environment python not found at: ${pythonVenvPath}`
				);
			}

			// Install Jupyter if not already installed
			console.log("Installing Jupyter...");
			await new Promise<void>((resolve, reject) => {
				const installProcess = spawn(pipPath, [
					"install",
					"jupyter",
					"notebook",
					"ipykernel",
				]);

				installProcess.on("error", (error: Error) => {
					console.error("Error installing Jupyter:", error);
					reject(error);
				});

				installProcess.on("close", (code) => {
					if (code === 0) {
						console.log("Jupyter installed successfully");
						resolve();
					} else {
						reject(new Error(`Failed to install Jupyter, exit code: ${code}`));
					}
				});
			});

			// Start Jupyter server with workspace kernels
			console.log(`Starting Jupyter server for workspace: ${workspacePath}`);
			const workspaceKernelsPath = path.join(workspacePath, "kernels");
			console.log(`Using workspace kernels from: ${workspaceKernelsPath}`);
			
			this.jupyterProcess = spawn(
				pythonVenvPath,
				[
					"-m",
					"jupyter",
					"notebook",
					"--no-browser",
					`--port=${this.jupyterPort}`,
					"--ip=127.0.0.1",
					"--allow-root",
					"--NotebookApp.token=''",
					"--NotebookApp.password=''",
					`--KernelSpecManager.kernel_spec_path=${workspaceKernelsPath}`,
					"--NotebookApp.disable_check_xsrf=True",
					`--notebook-dir=${workspacePath}`,
				],
				{
					cwd: workspacePath,
					stdio: ["pipe", "pipe", "pipe"],
				}
			);

			this.jupyterProcess.on("error", (error: Error) => {
				console.error("Jupyter process error:", error);
			});

			this.jupyterProcess.on("close", (code: number, reason: string) => {
				console.log(`Jupyter process closed with code: ${code}`);
				this.jupyterProcess = null;
			});

			// Wait for Jupyter to start
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Jupyter startup timeout"));
				}, 30000);

				const checkInterval = setInterval(async () => {
					try {
						const response = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/status`
						);
						if (response.ok) {
							clearTimeout(timeout);
							clearInterval(checkInterval);
							console.log("Jupyter server is ready");
							resolve();
						}
					} catch (error) {
						// Server not ready yet, continue waiting
					}
				}, 1000);
			});

			return { success: true };
		} catch (error) {
			console.error("Error starting Jupyter:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async cleanupExistingBioRAGProcesses(): Promise<void> {
		try {
			const { exec } = require("child_process");
			const { promisify } = require("util");
			const execAsync = promisify(exec);

			console.log(
				`Checking for processes on BioRAG port ${this.bioragPort}...`
			);

			if (process.platform === "win32") {
				// Windows: Find and kill process using the BioRAG port
				await execAsync(`netstat -ano | findstr :${this.bioragPort}`)
					.then(async (result: any) => {
						const lines = result.stdout.split("\n");
						for (const line of lines) {
							const match = line.match(/\s+(\d+)$/);
							if (match) {
								const pid = match[1];
								await execAsync(`taskkill /PID ${pid} /F`).catch(() => {
									// Ignore errors if process doesn't exist
								});
								console.log(`Killed process ${pid} on port ${this.bioragPort}`);
							}
						}
					})
					.catch(() => {
						// No processes found on the port
						console.log(`No processes found on port ${this.bioragPort}`);
					});
			} else {
				// Unix-like systems: Find and kill process using the BioRAG port
				await execAsync(`lsof -ti:${this.bioragPort} | xargs kill -9`).catch(
					() => {
						// Ignore errors if no process is using the port
						console.log(`No processes found on port ${this.bioragPort}`);
					}
				);
			}
		} catch (error) {
			console.log(
				`No existing server to kill on port ${this.bioragPort} or error:`,
				error
			);
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

		// Jupyter notebook operations
		ipcMain.handle("jupyter-start", async (_, workingDir: string) => {
			try {
				console.log(`Starting Jupyter in: ${workingDir}`);

				// Stop existing Jupyter process if running
				if (this.jupyterProcess) {
					this.jupyterProcess.kill();
					this.jupyterProcess = null;
				}

				const pythonPath = await this.findPythonPath();
				console.log(`Found Python at: ${pythonPath}`);

				// Check if Jupyter Notebook is available
				const checkJupyter = spawn(
					pythonPath,
					["-m", "notebook", "--version"],
					{
						cwd: workingDir,
					}
				);

				await new Promise((resolve, reject) => {
					checkJupyter.on("close", (code) => {
						if (code === 0) {
							console.log("Found Jupyter Notebook via python -m notebook");
							resolve(null);
						} else {
							reject(new Error("Jupyter Notebook not found"));
						}
					});
				});

				// Start Jupyter Notebook server
				this.jupyterProcess = spawn(
					pythonPath,
					[
						"-m",
						"notebook",
						"--no-browser",
						"--allow-root",
						"--ip=127.0.0.1",
						"--NotebookApp.token=",
						"--NotebookApp.password=",
						"--port-retries=50",
						"--NotebookApp.disable_check_xsrf=True",
						"--NotebookApp.allow_origin='*'",
						"--NotebookApp.allow_credentials=True",
						"--NotebookApp.allow_remote_access=True",
						"--NotebookApp.open_browser=False",
						"--NotebookApp.trust_xheaders=True",
					],
					{
						cwd: workingDir,
						env: { ...process.env, PYTHONUNBUFFERED: "1" },
					}
				);

				return new Promise((resolve) => {
					let resolved = false;
					const timeout = setTimeout(() => {
						if (!resolved) {
							resolved = true;
							resolve({
								success: true,
								url: `http://127.0.0.1:${this.jupyterPort}`,
							});
						}
					}, 10000);

					let jupyterUrl = `http://127.0.0.1:${this.jupyterPort}`;

					this.jupyterProcess!.stdout!.on("data", (data) => {
						const output = data.toString();
						console.log("Jupyter:", output);

						// Check if Jupyter is ready
						if (
							output.includes("Jupyter Notebook") &&
							output.includes("running at")
						) {
							const urlMatch = output.match(/http:\/\/[^\s]+/);
							if (urlMatch) {
								jupyterUrl = urlMatch[0];
								console.log("Detected Jupyter URL:", jupyterUrl);
							}
						}

						if (
							output.includes("Jupyter Notebook") &&
							output.includes("running at") &&
							!resolved
						) {
							resolved = true;
							clearTimeout(timeout);

							// Create a kernel for the notebook
							setTimeout(async () => {
								try {
									// Get CSRF token first
									let csrfToken = "";
									try {
										const csrfResponse = await fetch(
											`http://127.0.0.1:${this.jupyterPort}/api/security/csrf`
										);
										if (csrfResponse.ok) {
											const csrfData = await csrfResponse.json();
											csrfToken = csrfData.token;
										}
									} catch (error) {
										console.warn(
											"Failed to get CSRF token for initial kernel:",
											error
										);
									}

									const headers: any = {
										"Content-Type": "application/json",
									};

									if (csrfToken) {
										headers["X-XSRFToken"] = csrfToken;
									}

									const response = await fetch(
										`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
										{
											method: "POST",
											headers,
											body: JSON.stringify({
												name: "python3",
											}),
										}
									);

									if (response.ok) {
										const kernel = await response.json();
										console.log("Created initial kernel:", kernel.id);
									} else {
										console.error(
											"Failed to create initial kernel, status:",
											response.status
										);
									}
								} catch (error) {
									console.error("Failed to create initial kernel:", error);
								}
							}, 2000);

							resolve({
								success: true,
								url: jupyterUrl,
							});
						}
					});

					this.jupyterProcess!.stderr?.on("data", (data) => {
						const output = data.toString();
						console.log(`Jupyter Error: ${output}`);

						// Also check stderr for the URL
						const urlMatch = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/lab/);
						if (urlMatch && !resolved) {
							resolved = true;
							clearTimeout(timeout);
							this.jupyterPort = parseInt(urlMatch[1]);
							const jupyterUrl = `http://127.0.0.1:${this.jupyterPort}`;
							console.log(`Detected Jupyter URL: ${jupyterUrl}`);

							// Notify the renderer process
							this.mainWindow?.webContents.send("jupyter-ready", {
								url: jupyterUrl,
								token: "",
								port: this.jupyterPort,
							});

							resolve({
								success: true,
								url: jupyterUrl,
							});
						}
					});

					this.jupyterProcess!.on("error", (error) => {
						console.error("Jupyter process error:", error);
						if (!resolved) {
							resolved = true;
							clearTimeout(timeout);
							resolve({
								success: false,
								error: error.message,
							});
						}
					});
				});
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

				// Notify renderer about virtual environment creation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "creating",
					message: "Creating virtual environment...",
					timestamp: new Date().toISOString(),
				});

				const pythonPath = await this.findPythonPath();
				const venvPath = path.join(workspacePath, "venv");

				// Create virtual environment
				const createVenvProcess = spawn(pythonPath, ["-m", "venv", venvPath], {
					cwd: workspacePath,
					stdio: "pipe",
				});

				await new Promise<void>((resolve, reject) => {
					createVenvProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Virtual environment created successfully");
							resolve();
						} else {
							reject(
								new Error(
									`Failed to create virtual environment, exit code: ${code}`
								)
							);
						}
					});
					createVenvProcess.on("error", reject);
				});

				// Determine the pip path in the virtual environment
				const pipPath = path.join(venvPath, "bin", "pip");
				const pythonVenvPath = path.join(venvPath, "bin", "python");

				// Notify renderer about package installation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "installing",
					message: "Installing required packages...",
					timestamp: new Date().toISOString(),
				});

				// Install basic Jupyter infrastructure and commonly needed packages
				const basicPackages = ["jupyter", "notebook", "ipykernel", "pandas", "numpy", "matplotlib", "seaborn"];

				// Notify about basic infrastructure installation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "installing",
					message: "Setting up Jupyter infrastructure...",
					timestamp: new Date().toISOString(),
				});

				const installProcess = spawn(pipPath, ["install", ...basicPackages], {
					cwd: workspacePath,
					stdio: "pipe",
				});

				await new Promise<void>((resolve, reject) => {
					installProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Jupyter infrastructure installed successfully");
							resolve();
						} else {
							reject(
								new Error(
									`Failed to install Jupyter infrastructure, exit code: ${code}`
								)
							);
						}
					});
					installProcess.on("error", reject);
				});

				// First, install ipykernel in the virtual environment
				const installIpykernelProcess = spawn(
					pipPath,
					["install", "ipykernel"],
					{
						cwd: workspacePath,
						stdio: "pipe",
					}
				);

				await new Promise<void>((resolve, reject) => {
					installIpykernelProcess.on("close", (code) => {
						if (code === 0) {
							console.log("ipykernel installed successfully");
							resolve();
						} else {
							console.warn("Failed to install ipykernel, proceeding anyway");
							resolve();
						}
					});
					installIpykernelProcess.on("error", () => {
						console.warn("Error installing ipykernel, proceeding anyway");
						resolve();
					});
				});

				// Create workspace-local kernel spec
				const kernelName = this.generateKernelName(workspacePath);
				console.log(`Creating workspace-local kernel: ${kernelName}`);
				
				// Create kernel spec directory in workspace
				const kernelsDir = path.join(workspacePath, "kernels");
				const kernelDir = path.join(kernelsDir, kernelName);
				
				if (!fs.existsSync(kernelsDir)) {
					fs.mkdirSync(kernelsDir, { recursive: true });
				}
				if (!fs.existsSync(kernelDir)) {
					fs.mkdirSync(kernelDir, { recursive: true });
				}
				
				// Create kernel.json that points to workspace venv Python
				const kernelSpec = {
					argv: [
						pythonVenvPath,  // Use the workspace venv Python
						"-m",
						"ipykernel_launcher",
						"-f",
						"{connection_file}"
					],
					display_name: `Axon Workspace (${path.basename(workspacePath)})`,
					language: "python",
					metadata: {
						debugger: true
					}
				};
				
				fs.writeFileSync(
					path.join(kernelDir, "kernel.json"),
					JSON.stringify(kernelSpec, null, 2)
				);
				
				console.log(`Workspace kernel created: ${kernelDir}/kernel.json`);

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
					kernelName: kernelName,
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

		ipcMain.handle(
			"jupyter-execute",
			async (_, code: string, workspacePath?: string) => {
				try {
					console.log(
						`Executing code in Jupyter for workspace: ${workspacePath}\n${code.substring(
							0,
							100
						)}...`
					);

					// Always ensure Jupyter is running for the correct workspace
					console.log(
						"Ensuring Jupyter is running for the correct workspace..."
					);
					const startResult = await this.startJupyterIfNeeded(
						workspacePath || process.cwd()
					);
					if (!startResult.success) {
						return {
							success: false,
							error: "Failed to start Jupyter server",
						};
					}

					// Notify renderer that code is being written (for streaming)
					this.mainWindow?.webContents.send("jupyter-code-writing", {
						code: code,
						timestamp: new Date().toISOString(),
						type: "full_code",
					});

					const WebSocket = require("ws");
					const { v4: uuidv4 } = require("uuid");

					// Use the workspace-specific kernel that was created
					let kernelName = "python3";
					if (workspacePath) {
						const metadata = await this.getWorkspaceMetadata(workspacePath);
						if (metadata?.kernelName) {
							kernelName = metadata.kernelName;
							console.log(`Found workspace kernel in metadata: ${kernelName}`);
						} else {
							// Fallback to generating a new kernel name
							kernelName = this.generateKernelName(workspacePath);
							console.log(`No metadata found, generated kernel name: ${kernelName}`);
						}
					}
					
					console.log(`Looking for workspace kernel: ${kernelName}`);
					
					console.log(
						`Using kernel: ${kernelName} for workspace: ${workspacePath}`
					);

					// Get CSRF token first
					let csrfToken = "";
					try {
						const csrfResponse = await fetch(
							`http://127.0.0.1:${this.jupyterPort}/api/security/csrf`
						);
						if (csrfResponse.ok) {
							const csrfData = await csrfResponse.json();
							csrfToken = csrfData.token;
							console.log("Got CSRF token:", csrfToken);
						}
					} catch (error) {
						console.warn("Failed to get CSRF token:", error);
						// Try alternative approach - get token from cookies
						try {
							const cookieResponse = await fetch(
								`http://127.0.0.1:${this.jupyterPort}/`
							);
							const cookies = cookieResponse.headers.get("set-cookie");
							if (cookies) {
								const xsrfMatch = cookies.match(/_xsrf=([^;]+)/);
								if (xsrfMatch) {
									csrfToken = xsrfMatch[1];
									console.log("Got CSRF token from cookies:", csrfToken);
								}
							}
						} catch (cookieError) {
							console.warn(
								"Failed to get CSRF token from cookies:",
								cookieError
							);
						}
					}

					// 1. Find the running kernel or create one
					let response = await fetch(
						`http://127.0.0.1:${this.jupyterPort}/api/kernels`
					);
					let kernels = await response.json();
					console.log(`Available kernels:`, kernels);

					let kernelId: string;
					if (!kernels || kernels.length === 0) {
						// Create a new kernel with retry mechanism
						console.log(
							`No kernel found, creating new kernel with name: ${kernelName}`
						);

						// Add a small delay to ensure Jupyter is fully ready
						await new Promise((resolve) => setTimeout(resolve, 1000));

						let createResponse: Response | undefined;
						let retries = 3;

						while (retries > 0) {
							try {
								const headers: any = {
									"Content-Type": "application/json",
								};

								// Add CSRF token if available
								if (csrfToken) {
									headers["X-XSRFToken"] = csrfToken;
								} else {
									// Fallback: try without CSRF token (for local development)
									console.warn(
										"No CSRF token available, attempting request without it"
									);
								}

								// First check if the kernel spec exists, if not try to register it
								try {
									const kernelSpecsResponse = await fetch(
										`http://127.0.0.1:${this.jupyterPort}/api/kernelspecs`
									);
									
									if (kernelSpecsResponse.ok) {
										const kernelSpecs = await kernelSpecsResponse.json();
										console.log("Available kernel specs:", Object.keys(kernelSpecs.kernelspecs || {}));
										
										// If our custom kernel doesn't exist, try to register it
										if (!kernelSpecs.kernelspecs || !kernelSpecs.kernelspecs[kernelName]) {
											console.warn(`Kernel spec '${kernelName}' not found, attempting to register it`);
											
											if (workspacePath) {
												const success = await this.attemptKernelRegistration(workspacePath, kernelName);
												if (!success) {
													console.warn(`Failed to register kernel '${kernelName}', falling back to 'python3'`);
													kernelName = 'python3';
												}
											} else {
												console.warn("No workspace path provided, falling back to python3");
												kernelName = 'python3';
											}
										}
									}
								} catch (specError) {
									console.warn("Could not check kernel specs, proceeding with original kernel name:", specError);
								}

								createResponse = await fetch(
									`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
									{
										method: "POST",
										headers,
										body: JSON.stringify({
											name: kernelName,
										}),
									}
								);

								console.log(
									`Kernel creation response status: ${createResponse.status}`
								);

								if (createResponse.ok) {
									break;
								} else {
									const errorText = await createResponse.text();
									console.warn(
										`Kernel creation attempt ${
											4 - retries
										} failed: ${errorText}`
									);

									if (retries > 1) {
										await new Promise((resolve) => setTimeout(resolve, 2000));
									}
								}
							} catch (error) {
								console.warn(
									`Kernel creation attempt ${4 - retries} failed with error:`,
									error
								);
								if (retries > 1) {
									await new Promise((resolve) => setTimeout(resolve, 2000));
								}
							}
							retries--;
						}

						if (!createResponse || !createResponse.ok) {
							const errorText = createResponse
								? await createResponse.text()
								: "No response";
							console.error(
								`Failed to create Jupyter kernel after retries: ${errorText}`
							);
							console.error(`Kernel name: ${kernelName}`);
							console.error(`Workspace path: ${workspacePath}`);

							// Try to create a basic python3 kernel as fallback
							console.log("Attempting to create fallback python3 kernel...");
							try {
								const fallbackHeaders: any = {
									"Content-Type": "application/json",
								};

								// Add CSRF token if available
								if (csrfToken) {
									fallbackHeaders["X-XSRFToken"] = csrfToken;
								} else {
									// Fallback: try without CSRF token (for local development)
									console.warn(
										"No CSRF token available for fallback, attempting request without it"
									);
								}

								const fallbackResponse = await fetch(
									`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
									{
										method: "POST",
										headers: fallbackHeaders,
										body: JSON.stringify({
											name: "python3",
										}),
									}
								);

								if (fallbackResponse.ok) {
									const fallbackKernel = await fallbackResponse.json();
									kernelId = fallbackKernel.id;
									console.log("Created fallback python3 kernel:", kernelId);
								} else {
									throw new Error(
										`Failed to create Jupyter kernel: ${errorText}`
									);
								}
							} catch (fallbackError) {
								console.error(
									"Fallback kernel creation also failed:",
									fallbackError
								);
								throw new Error(
									`Failed to create Jupyter kernel: ${errorText}`
								);
							}
						}

						// At this point, createResponse should be defined and ok
						if (createResponse) {
							const newKernel = await createResponse.json();
							kernelId = newKernel.id;
							console.log("Created new kernel:", kernelId);
						} else {
							throw new Error("Failed to create kernel: No response received");
						}
					} else {
						// Try to find a kernel with the correct name
						const matchingKernel = kernels.find(
							(k: any) => k.name === kernelName
						);
						if (matchingKernel) {
							kernelId = matchingKernel.id;
							console.log(
								`Using existing kernel with name ${kernelName}:`,
								kernelId
							);
						} else {
							// Use the first available kernel
							kernelId = kernels[0].id;
							console.log("Using first available kernel:", kernelId);
						}
					}

					const wsUrl = `ws://127.0.0.1:${this.jupyterPort}/api/kernels/${kernelId}/channels`;
					console.log(`Connecting to WebSocket: ${wsUrl}`);

					// 2. Open a WebSocket connection
					console.log(`Attempting to connect to WebSocket: ${wsUrl}`);
					const ws = new WebSocket(wsUrl);

					return new Promise((resolve) => {
						let output = "";
						let errorOutput = "";
						let executionTimeoutId: NodeJS.Timeout;

						// Add connection timeout
						const connectionTimeout = setTimeout(() => {
							console.error("WebSocket connection timeout");
							ws.close();
							resolve({
								success: false,
								error: "WebSocket connection timeout",
							});
						}, 10000);

						// Set a timeout for the execution
						executionTimeoutId = setTimeout(() => {
							console.log("Jupyter execution timeout");
							ws.close();
							resolve({ success: false, error: "Execution timeout" });
						}, 30000); // 30 second timeout

						ws.on("open", () => {
							console.log("Jupyter WebSocket connection opened.");
							clearTimeout(connectionTimeout); // Clear connection timeout

							// 3. Send an execute_request message
							const msgId = uuidv4();
							const executeRequest = {
								header: {
									msg_id: msgId,
									username: "user",
									session: uuidv4(),
									msg_type: "execute_request",
									version: "5.3",
								},
								parent_header: {},
								metadata: {},
								content: {
									code: code,
									silent: false,
									store_history: true,
									user_expressions: {},
									allow_stdin: false,
									stop_on_error: true,
								},
								channel: "shell",
							};
							ws.send(JSON.stringify(executeRequest));
						});

						ws.on("error", (error: any) => {
							console.error("WebSocket error:", error);
							clearTimeout(executionTimeoutId);
							resolve({
								success: false,
								error: `WebSocket error: ${error.message}`,
							});
						});

						ws.on("close", (code: any, reason: any) => {
							console.log(`WebSocket closed: ${code} - ${reason}`);
							if (!output && !errorOutput) {
								clearTimeout(executionTimeoutId);
								resolve({
									success: false,
									error: `WebSocket closed unexpectedly: ${reason}`,
								});
							}
						});

						ws.on("message", (data: any) => {
							const msg = JSON.parse(data.toString());
							// Only log important WebSocket messages
							if (msg.header?.msg_type && !['status', 'comm_open'].includes(msg.header.msg_type)) {
								console.log(`Jupyter WebSocket message:`, {
									msg_type: msg.header.msg_type,
									parent_header: !!msg.parent_header,
									content: msg.content,
								});
							}

							// 4. Listen for execute_reply and stream messages
							if (msg.parent_header && msg.header.msg_type === "stream") {
								output += msg.content.text;
								console.log(`Stream output: ${msg.content.text}`);
								// Notify renderer about streamed output
								this.mainWindow?.webContents.send("jupyter-code-writing", {
									code: output, // Send the current accumulated output
									timestamp: new Date().toISOString(),
									type: "stream",
								});
							} else if (
								msg.parent_header &&
								msg.header.msg_type === "execute_reply"
							) {
								console.log(`Execute reply:`, msg.content);
								if (msg.content.status === "ok") {
									console.log(`Execution successful, output: ${output}`);
									clearTimeout(executionTimeoutId);
									resolve({ success: true, output });
								} else {
									errorOutput += msg.content.evalue;
									console.log(`Execution failed, error: ${errorOutput}`);
									clearTimeout(executionTimeoutId);
									resolve({ success: false, error: errorOutput });
								}
								ws.close();
							} else if (msg.parent_header && msg.header.msg_type === "error") {
								errorOutput += msg.content.evalue;
								console.log(`Execution error: ${msg.content.evalue}`);
							}
						});

						// Note: error and close handlers are already defined above
					});
				} catch (error) {
					console.error("Jupyter execution error:", error);
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

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

		// BioRAG API proxy
		ipcMain.handle("biorag-query", async (_, query: any) => {
			try {
				// This will be handled by the renderer process via HTTP
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		// BioRAG server management
		ipcMain.handle("get-biorag-port", () => {
			return this.bioragPort;
		});

		ipcMain.handle("get-biorag-url", () => {
			return `http://localhost:${this.bioragPort}`;
		});

		// File operations
		ipcMain.handle("read-file", async (_, filePath: string) => {
			try {
				const content = await fs.promises.readFile(filePath, "utf8");
				return content;
			} catch (error) {
				throw error;
			}
		});

		ipcMain.handle(
			"write-file",
			async (_, filePath: string, content: string) => {
				try {
					await fs.promises.writeFile(filePath, content, "utf8");
					return { success: true };
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		ipcMain.handle("list-directory", async (_, dirPath: string) => {
			try {
				const items = await fs.promises.readdir(dirPath, {
					withFileTypes: true,
				});
				return items.map((item) => ({
					name: item.name,
					isDirectory: item.isDirectory(),
					path: path.join(dirPath, item.name),
				}));
			} catch (error) {
				throw error;
			}
		});

		ipcMain.handle("create-directory", async (_, dirPath: string) => {
			try {
				await fs.promises.mkdir(dirPath, { recursive: true });
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

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

		ipcMain.handle("delete-directory", async (_, dirPath: string) => {
			try {
				await fs.promises.rmdir(dirPath, { recursive: true });
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

		ipcMain.handle("file-exists", async (_, filePath: string) => {
			try {
				await fs.promises.access(filePath);
				return true;
			} catch {
				return false;
			}
		});

		ipcMain.handle("directory-exists", async (_, dirPath: string) => {
			try {
				const stat = await fs.promises.stat(dirPath);
				return stat.isDirectory();
			} catch {
				return false;
			}
		});

		ipcMain.handle("get-file-info", async (_, filePath: string) => {
			try {
				const stat = await fs.promises.stat(filePath);
				return {
					size: stat.size,
					created: stat.birthtime,
					modified: stat.mtime,
					isDirectory: stat.isDirectory(),
				};
			} catch (error) {
				throw error;
			}
		});

		ipcMain.handle("open-file", async (_, filePath: string) => {
			try {
				const { shell } = require("electron");
				await shell.openPath(filePath);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});


		ipcMain.handle("on-jupyter-ready", (_, callback: (data: any) => void) => {
			// This is handled by the renderer process
			return true;
		});

		// Dynamic package installation based on analysis requirements
		ipcMain.handle(
			"install-packages",
			async (_, workspacePath: string, packages: string[]) => {
				try {
					console.log(`Installing packages in workspace: ${workspacePath}`);
					console.log(`Packages to install: ${packages.join(", ")}`);

					// Notify renderer about package installation
					this.mainWindow?.webContents.send("virtual-env-status", {
						status: "installing_packages",
						message: `Installing ${packages.length} required packages...`,
						packages: packages,
						timestamp: new Date().toISOString(),
					});

					const venvPath = path.join(workspacePath, "venv");

					// Check if virtual environment exists
					if (!fs.existsSync(venvPath)) {
						throw new Error(
							`Virtual environment not found at: ${venvPath}. Please ensure Jupyter is started first.`
						);
					}

					// Determine pip path based on platform
					const isWindows = process.platform === "win32";
					const isMac = process.platform === "darwin";

					let pipPath: string;
					if (isWindows) {
						pipPath = path.join(venvPath, "Scripts", "pip.exe");
					} else if (isMac) {
						// On macOS, try pip3 first, then fall back to pip
						const pip3Path = path.join(venvPath, "bin", "pip3");
						const pipPathUnix = path.join(venvPath, "bin", "pip");

						if (fs.existsSync(pip3Path)) {
							pipPath = pip3Path;
						} else if (fs.existsSync(pipPathUnix)) {
							pipPath = pipPathUnix;
						} else {
							throw new Error(
								`No pip executable found in virtual environment. Tried: ${pip3Path} and ${pipPathUnix}`
							);
						}
					} else {
						// Linux and other Unix systems
						pipPath = path.join(venvPath, "bin", "pip");
					}

					// Verify pip executable exists
					if (!fs.existsSync(pipPath)) {
						throw new Error(
							`Virtual environment pip not found at: ${pipPath}. Virtual environment may be corrupted.`
						);
					}

					console.log(`Using pip at: ${pipPath}`);

					// Notify about each package being installed
					for (const pkg of packages) {
						this.mainWindow?.webContents.send("virtual-env-status", {
							status: "installing_package",
							message: `Installing ${pkg}...`,
							package: pkg,
							timestamp: new Date().toISOString(),
						});
					}

					const installProcess = spawn(pipPath, ["install", ...packages], {
						cwd: workspacePath,
						stdio: "pipe",
					});

					let stdout = "";
					let stderr = "";

					installProcess.stdout?.on("data", (data) => {
						const output = data.toString();
						stdout += output;
						// Only log pip errors and warnings, not verbose output
						if (output.includes('ERROR') || output.includes('WARNING')) {
							console.log(`[pip stdout]: ${output}`);
						}
					});

					installProcess.stderr?.on("data", (data) => {
						const output = data.toString();
						stderr += output;
						// Only log pip stderr if it contains actual errors
						if (output.includes('ERROR') || output.includes('FAILED')) {
							console.log(`[pip stderr]: ${output}`);
						}
					});

					await new Promise<void>((resolve, reject) => {
						installProcess.on("close", (code) => {
							console.log(`Pip process completed with code: ${code}`);
							// Only log stdout/stderr if there were errors
							if (code !== 0) {
								console.log(`Full stdout: ${stdout}`);
								console.log(`Full stderr: ${stderr}`);
							}
							
							if (code === 0) {
								console.log("Packages installed successfully");
								resolve();
							} else {
								reject(
									new Error(`Failed to install packages, exit code: ${code}. stderr: ${stderr}`)
								);
							}
						});
						installProcess.on("error", (error) => {
							console.error(`Pip process error: ${error}`);
							reject(error);
						});
					});

					// Verify packages were actually installed
					console.log("Verifying package installation...");
					const verifyProcess = spawn(pipPath, ["list"], {
						cwd: workspacePath,
						stdio: "pipe",
					});

					let verifyOutput = "";
					verifyProcess.stdout?.on("data", (data) => {
						verifyOutput += data.toString();
					});

					await new Promise<void>((resolve) => {
						verifyProcess.on("close", () => {
							// Don't log the full package list to reduce noise
							console.log("Verifying package installation...");
							
							// Check if each package is in the list
							for (const pkg of packages) {
								const isInstalled = verifyOutput.toLowerCase().includes(pkg.toLowerCase());
								// Only log missing packages
								if (!isInstalled) {
									console.log(`Package ${pkg}: NOT FOUND`);
								}
							}
							resolve();
						});
						verifyProcess.on("error", (error) => {
							console.error(`Verification error: ${error}`);
							resolve();
						});
					});

					// Notify renderer about completion
					this.mainWindow?.webContents.send("virtual-env-status", {
						status: "packages_installed",
						message: "All required packages installed successfully!",
						packages: packages,
						timestamp: new Date().toISOString(),
					});

					return {
						success: true,
						packages: packages,
					};
				} catch (error) {
					console.error("Error installing packages:", error);
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);
	}

	private async cleanupOldKernels(): Promise<void> {
		try {
			const { exec } = require("child_process");
			const { promisify } = require("util");
			const execAsync = promisify(exec);

			console.log("Cleaning up old Axon kernels...");

			// List all kernels and remove old Axon ones
			const result = await execAsync("jupyter kernelspec list").catch(() => null);
			if (result && result.stdout) {
				const lines = result.stdout.split('\n');
				for (const line of lines) {
					if (line.includes('axon-') && !line.includes('Available kernels:')) {
						const kernelName = line.trim().split(/\s+/)[0];
						if (kernelName.startsWith('axon-')) {
							try {
								await execAsync(`jupyter kernelspec remove -f ${kernelName}`);
								console.log(`Removed old kernel: ${kernelName}`);
							} catch (error) {
								console.warn(`Failed to remove kernel ${kernelName}:`, error);
							}
						}
					}
				}
			}
		} catch (error) {
			console.warn("Error during kernel cleanup:", error);
		}
	}

	private cleanup() {
		console.log("Cleaning up processes...");

		// Clean up old kernels first
		this.cleanupOldKernels().catch(error => {
			console.warn("Error during kernel cleanup:", error);
		});

		if (this.bioragServer) {
			try {
				// Try graceful shutdown first
				this.bioragServer.kill("SIGTERM");

				// Force kill after 5 seconds if still running
				setTimeout(() => {
					if (this.bioragServer && !this.bioragServer.killed) {
						console.log("Force killing BioRAG server...");
						this.bioragServer.kill("SIGKILL");
					}
				}, 5000);

				this.bioragServer = null;
				console.log("BioRAG server terminated");
			} catch (error) {
				console.error("Error terminating BioRAG server:", error);
			}
		}

		if (this.jupyterProcess) {
			try {
				// Try graceful shutdown first
				this.jupyterProcess.kill("SIGTERM");

				// Force kill after 5 seconds if still running
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

		console.log("BioRAG system shutdown complete");
	}
}

// Initialize the app
new AxonApp();
