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

		console.log("Icon path:", iconPath);
		console.log("Icon exists:", fs.existsSync(iconPath));
		console.log("Current directory (__dirname):", __dirname);
		console.log("App path:", app.getAppPath());
		console.log("Platform:", process.platform);
		console.log("Development mode:", isDevelopment);

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
				console.log("Trying alternative path:", altPath);
				if (fs.existsSync(altPath)) {
					finalIconPath = altPath;
					console.log("Found icon at:", finalIconPath);
					break;
				}
			}
		}

		console.log("Final icon path being used:", finalIconPath);

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

				// Check if Jupyter Lab is available
				const checkJupyter = spawn(
					pythonPath,
					["-m", "jupyterlab", "--version"],
					{
						cwd: workingDir,
					}
				);

				await new Promise((resolve, reject) => {
					checkJupyter.on("close", (code) => {
						if (code === 0) {
							console.log("Found Jupyter Lab via python -m jupyterlab");
							resolve(null);
						} else {
							reject(new Error("Jupyter Lab not found"));
						}
					});
				});

				// Start Jupyter Lab
				this.jupyterProcess = spawn(
					pythonPath,
					[
						"-m",
						"jupyterlab",
						"--no-browser",
						"--allow-root",
						"--ip=127.0.0.1",
						"--NotebookApp.token=",
						"--NotebookApp.password=",
						"--ServerApp.token=",
						"--ServerApp.password=",
						"--port-retries=50",
						"--NotebookApp.disable_check_xsrf=True",
						"--ServerApp.disable_check_xsrf=True",
						"--ServerApp.allow_origin='*'",
						"--ServerApp.allow_credentials=True",
						"--LabApp.default_url='/lab'",
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
							output.includes("Jupyter Server") &&
							output.includes("running at")
						) {
							const urlMatch = output.match(/http:\/\/[^\s]+/);
							if (urlMatch) {
								jupyterUrl = urlMatch[0];
								console.log("Detected Jupyter URL:", jupyterUrl);
							}
						}

						if (
							output.includes("Jupyter Server") &&
							output.includes("running at") &&
							!resolved
						) {
							resolved = true;
							clearTimeout(timeout);

							// Create a kernel for the notebook
							setTimeout(async () => {
								try {
									const response = await fetch(
										`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
										{
											method: "POST",
											headers: {
												"Content-Type": "application/json",
											},
											body: JSON.stringify({
												name: "python3",
												path: ".",
											}),
										}
									);

									if (response.ok) {
										const kernel = await response.json();
										console.log("Created initial kernel:", kernel.id);
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

				// Install required packages
				const requiredPackages = [
					"pandas",
					"numpy",
					"matplotlib",
					"seaborn",
					"scikit-learn",
					"requests",
					"beautifulsoup4",
					"jupyter",
					"notebook",
					"ipykernel",
				];

				const installProcess = spawn(
					pipPath,
					["install", ...requiredPackages],
					{
						cwd: workspacePath,
						stdio: "pipe",
					}
				);

				await new Promise<void>((resolve, reject) => {
					installProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Packages installed successfully");
							resolve();
						} else {
							reject(
								new Error(`Failed to install packages, exit code: ${code}`)
							);
						}
					});
					installProcess.on("error", reject);
				});

				// Register the virtual environment kernel with Jupyter
				const registerProcess = spawn(
					pythonVenvPath,
					[
						"-m",
						"ipykernel",
						"install",
						"--user",
						"--name",
						`axon-${path.basename(workspacePath)}`,
						"--display-name",
						`Axon Analysis (${path.basename(workspacePath)})`,
					],
					{
						cwd: workspacePath,
						stdio: "pipe",
					}
				);

				await new Promise<void>((resolve, reject) => {
					registerProcess.on("close", (code) => {
						if (code === 0) {
							console.log("Kernel registered successfully");
							resolve();
						} else {
							reject(
								new Error(`Failed to register kernel, exit code: ${code}`)
							);
						}
					});
					registerProcess.on("error", reject);
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
					kernelName: `axon-${path.basename(workspacePath)}`,
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

		ipcMain.handle("jupyter-execute", async (_, code: string) => {
			try {
				console.log(
					`Executing code in Jupyter: \n${code.substring(0, 100)}...`
				);

				// Notify renderer that code is being written (for streaming)
				this.mainWindow?.webContents.send("jupyter-code-writing", {
					code: code,
					timestamp: new Date().toISOString(),
					type: "full_code",
				});

				const WebSocket = require("ws");
				const { v4: uuidv4 } = require("uuid");

				// 1. Find the running kernel or create one
				let response = await fetch(
					`http://127.0.0.1:${this.jupyterPort}/api/kernels`
				);
				let kernels = await response.json();

				let kernelId: string;
				if (!kernels || kernels.length === 0) {
					// Create a new kernel
					console.log("No kernel found, creating new kernel...");
					const createResponse = await fetch(
						`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								name: "python3",
								path: ".",
							}),
						}
					);

					if (!createResponse.ok) {
						throw new Error("Failed to create Jupyter kernel");
					}

					const newKernel = await createResponse.json();
					kernelId = newKernel.id;
					console.log("Created new kernel:", kernelId);
				} else {
					kernelId = kernels[0].id;
					console.log("Using existing kernel:", kernelId);
				}

				const wsUrl = `ws://127.0.0.1:${this.jupyterPort}/api/kernels/${kernelId}/channels`;

				// 2. Open a WebSocket connection
				const ws = new WebSocket(wsUrl);

				return new Promise((resolve) => {
					let output = "";
					let errorOutput = "";

					ws.on("open", () => {
						console.log("Jupyter WebSocket connection opened.");

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

					ws.on("message", (data: any) => {
						const msg = JSON.parse(data.toString());

						// 4. Listen for execute_reply and stream messages
						if (msg.parent_header && msg.header.msg_type === "stream") {
							output += msg.content.text;
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
							if (msg.content.status === "ok") {
								resolve({ success: true, output });
							} else {
								errorOutput += msg.content.evalue;
								resolve({ success: false, error: errorOutput });
							}
							ws.close();
						} else if (msg.parent_header && msg.header.msg_type === "error") {
							errorOutput += msg.content.evalue;
						}
					});

					ws.on("close", () => {
						console.log("Jupyter WebSocket connection closed.");
						if (!output && errorOutput) {
							resolve({ success: false, error: errorOutput });
						}
					});

					ws.on("error", (error: any) => {
						console.error("Jupyter WebSocket error:", error);
						resolve({
							success: false,
							error: `WebSocket error: ${error.message}`,
						});
					});
				});
			} catch (error) {
				console.error("Jupyter execution error:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		});

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

		ipcMain.handle("on-jupyter-ready", (_, callback: (data: any) => void) => {
			// This is handled by the renderer process
			return true;
		});
	}

	private cleanup() {
		console.log("Cleaning up processes...");

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
