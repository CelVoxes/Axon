// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

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
	// Track cancellable processes for virtual env creation and installation
	private venvCreateProcess: ChildProcess | null = null;
	private venvInstallProcess: ChildProcess | null = null;
	private jupyterPort: number = 8888;
	private bioragPort: number = 8000;
	// Track a single active kernel per workspace to avoid spawning multiple kernels unnecessarily
	private workspaceKernelMap: Map<string, string> = new Map();
	// Prevent concurrent kernel creation for the same workspace
	private workspaceKernelCreationPromises: Map<string, Promise<string>> =
		new Map();
	// Track which workspace the current Jupyter server was started for
	private currentJupyterWorkspace: string | null = null;
	// FS watchers per workspace root
	private workspaceWatchers: Map<string, fs.FSWatcher> = new Map();

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
			// In dev, backend lives in repo root; in production, it's placed under process.resourcesPath via extraResources
			const backendWorkingDir = app.isPackaged
				? process.resourcesPath
				: path.join(__dirname, "..", "..");

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
		// Stable, deterministic kernel name per workspace (no timestamp) to avoid proliferation
		const sanitizedName =
			workspaceName
				.replace(/[^a-zA-Z0-9_-]/g, "_")
				.toLowerCase()
				.substring(0, 32) || "workspace";
		return `axon-${sanitizedName}`;
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
	 * Get workspace metadata including the kernel name
	 */
	private async getWorkspaceMetadata(workspacePath: string): Promise<any> {
		try {
			const metadataPath = path.join(workspacePath, "workspace_metadata.json");
			if (fs.existsSync(metadataPath)) {
				const metadataContent = fs.readFileSync(metadataPath, "utf8");
				return JSON.parse(metadataContent);
			}
		} catch (error) {
			console.warn("Failed to read workspace metadata:", error);
		}
		return null;
	}

	// Removed old compatibility probing helpers that created transient kernels.

	/**
	 * Ensure a workspace-local kernelspec exists and metadata is updated to reference it.
	 * Returns the kernelspec name to use.
	 */
	private ensureWorkspaceKernelSpec(
		workspacePath: string,
		pythonVenvPath: string,
		venvPath: string
	): string {
		try {
			const kernelsDir = path.join(workspacePath, "kernels");
			// Read existing metadata if present
			const metadataPath = path.join(workspacePath, "workspace_metadata.json");
			let metadata: any = {};
			if (fs.existsSync(metadataPath)) {
				try {
					const content = fs.readFileSync(metadataPath, "utf8");
					metadata = JSON.parse(content);
				} catch (e) {
					console.warn(
						"Failed to parse workspace metadata, will regenerate kernel info:",
						e
					);
					metadata = {};
				}
			}

			// Prefer a stable kernel name derived from the workspace directory
			const stableKernelName = this.generateKernelName(workspacePath);
			let kernelName: string = metadata?.kernelName;
			if (!kernelName || typeof kernelName !== "string") {
				kernelName = stableKernelName;
			} else if (kernelName !== stableKernelName) {
				// Migrate existing metadata to the stable kernel name to avoid proliferation
				console.log(
					`Migrating workspace kernel name from '${kernelName}' to stable '${stableKernelName}'`
				);
				kernelName = stableKernelName;
			}

			const kernelDir = path.join(kernelsDir, kernelName);
			const kernelSpecPath = path.join(kernelDir, "kernel.json");

			if (!fs.existsSync(kernelsDir)) {
				fs.mkdirSync(kernelsDir, { recursive: true });
			}
			if (!fs.existsSync(kernelDir)) {
				fs.mkdirSync(kernelDir, { recursive: true });
			}

			// Always ensure kernel.json points to the current venv python
			const kernelSpec = {
				argv: [
					pythonVenvPath,
					"-m",
					"ipykernel_launcher",
					"-f",
					"{connection_file}",
				],
				display_name: `Axon Workspace (${path.basename(workspacePath)})`,
				language: "python",
				metadata: { debugger: true },
			} as any;

			try {
				// If an existing spec is present but points elsewhere, overwrite it
				let needsWrite = true;
				if (fs.existsSync(kernelSpecPath)) {
					try {
						const existing = JSON.parse(
							fs.readFileSync(kernelSpecPath, "utf8")
						);
						if (
							existing &&
							Array.isArray(existing.argv) &&
							existing.argv.length > 0 &&
							existing.argv[0] === pythonVenvPath
						) {
							needsWrite = false; // Already correct
						}
					} catch (_) {
						// If parse fails, we'll rewrite it below
					}
				}
				if (needsWrite) {
					fs.writeFileSync(kernelSpecPath, JSON.stringify(kernelSpec, null, 2));
					console.log(`Workspace kernel spec written: ${kernelSpecPath}`);
				}
			} catch (e) {
				console.warn("Failed to ensure kernel.json:", e);
			}

			// Persist/update metadata with kernel info
			const updatedMetadata = {
				...(metadata || {}),
				kernelName,
				venvPath,
				pythonPath: pythonVenvPath,
				lastUpdated: new Date().toISOString(),
			};
			try {
				fs.writeFileSync(
					metadataPath,
					JSON.stringify(updatedMetadata, null, 2)
				);
			} catch (e) {
				console.warn("Failed to write workspace metadata:", e);
			}

			// Opportunistically clean up any old workspace kernel specs to prevent proliferation
			try {
				this.cleanupWorkspaceKernelSpecs(workspacePath, kernelName);
			} catch (cleanupErr) {
				console.warn(
					"Failed to cleanup old workspace kernel specs:",
					cleanupErr
				);
			}

			return kernelName;
		} catch (error) {
			console.warn("Error ensuring workspace kernelspec:", error);
			// Fallback to python3 name; server may still have a default kernelspec
			return "python3";
		}
	}

	/**
	 * Remove old workspace-local kernelspecs except the one we want to keep.
	 */
	private cleanupWorkspaceKernelSpecs(
		workspacePath: string,
		keepKernelName: string
	): void {
		const kernelsDir = path.join(workspacePath, "kernels");
		if (!fs.existsSync(kernelsDir)) return;
		const entries = fs.readdirSync(kernelsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const name = entry.name;
			if (name === keepKernelName) continue;
			// Only touch Axon-managed kernels to be safe
			if (!name.startsWith("axon-")) continue;
			try {
				const target = path.join(kernelsDir, name);
				fs.rmSync(target, { recursive: true, force: true });
				console.log(`Removed old workspace kernelspec: ${name}`);
			} catch (err) {
				console.warn(`Failed to remove old workspace kernelspec ${name}:`, err);
			}
		}
	}

	/**
	 * Get or create a kernel ID for the workspace using the provided kernelspec name.
	 * Ensures only a single kernel is created per workspace even under concurrent calls.
	 */
	private async getOrCreateKernelId(
		workspacePath: string,
		kernelName: string,
		csrfToken?: string
	): Promise<string> {
		// Reuse cached running kernel if still alive
		try {
			const listResponse = await fetch(
				`http://127.0.0.1:${this.jupyterPort}/api/kernels`
			);
			const kernels: any[] = listResponse.ok ? await listResponse.json() : [];

			const cachedId = this.workspaceKernelMap.get(workspacePath);
			if (cachedId && Array.isArray(kernels)) {
				const stillRunning = kernels.find((k: any) => k.id === cachedId);
				if (stillRunning) {
					return cachedId;
				} else {
					// Drop stale cache
					this.workspaceKernelMap.delete(workspacePath);
				}
			}

			// Prefer an existing kernel with the same spec name if present
			const matching = Array.isArray(kernels)
				? kernels.find((k: any) => k.name === kernelName)
				: undefined;
			if (matching?.id) {
				this.workspaceKernelMap.set(workspacePath, matching.id);
				return matching.id;
			}
		} catch (err) {
			console.warn("Failed to list kernels before creation:", err);
			// Continue to creation path
		}

		// If a creation is already in-flight for this workspace, await it
		const inflight = this.workspaceKernelCreationPromises.get(workspacePath);
		if (inflight) return inflight;

		const createPromise = (async () => {
			// Create fresh kernel
			let headers: any = { "Content-Type": "application/json" };
			if (csrfToken) headers["X-XSRFToken"] = csrfToken;

			// Ensure kernelspecs are visible (best effort)
			try {
				await fetch(
					`http://127.0.0.1:${this.jupyterPort}/api/kernelspecs`
				).catch(() => undefined);
			} catch {}

			const createResp = await fetch(
				`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ name: kernelName }),
				}
			);

			if (!createResp.ok) {
				// Final fallback to python3 if custom kernelspec isn't registered yet
				const fb = await fetch(
					`http://127.0.0.1:${this.jupyterPort}/api/kernels`,
					{
						method: "POST",
						headers,
						body: JSON.stringify({ name: "python3" }),
					}
				);
				if (!fb.ok) {
					const errText = await fb.text().catch(() => "");
					throw new Error(
						`Failed to create kernel (fallback also failed): ${errText}`
					);
				}
				const fbKernel = await fb.json();
				this.workspaceKernelMap.set(workspacePath, fbKernel.id);
				return fbKernel.id as string;
			}

			const newKernel = await createResp.json();
			this.workspaceKernelMap.set(workspacePath, newKernel.id);
			return newKernel.id as string;
		})().finally(() => {
			this.workspaceKernelCreationPromises.delete(workspacePath);
		});

		this.workspaceKernelCreationPromises.set(workspacePath, createPromise);
		return createPromise;
	}

	// Removed global user-level kernel registration; we use workspace-local kernelspecs only.

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
						// If server is healthy but workspace changed, restart to adopt new kernelspec path
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
					// Clear cached kernel ids since server will be restarted
					this.workspaceKernelMap.clear();
					// Wait a moment for the process to fully stop
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}

			console.log("Starting Jupyter server...");

			// Ensure desired port is available; if not, free it or pick an available one
			await this.ensureJupyterPortAvailable();

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

			// Ensure a workspace-local kernelspec exists before starting the server
			const kernelName = this.ensureWorkspaceKernelSpec(
				workspacePath,
				pythonVenvPath,
				venvPath
			);

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
				this.currentJupyterWorkspace = null;
				// Clear cached kernel ids on shutdown
				this.workspaceKernelMap.clear();
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

			// Note the workspace the server is associated with and reset kernel cache
			this.currentJupyterWorkspace = this.normalizeWorkspacePath(workspacePath);
			this.workspaceKernelMap.clear();

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
				console.log(`Starting Jupyter in: ${workingDir}`);
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

				// Notify renderer about virtual environment creation
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "creating",
					message: "Creating virtual environment...",
					timestamp: new Date().toISOString(),
				});

				const pythonPath = await this.findPythonPath();
				const venvPath = path.join(workspacePath, "venv");

				// Create virtual environment with timeout and better error handling
				console.log(`Creating virtual environment with Python: ${pythonPath}`);
				console.log(`Target venv path: ${venvPath}`);

				const createVenvProcess = spawn(pythonPath, ["-m", "venv", venvPath], {
					cwd: workspacePath,
					stdio: "pipe",
				});
				this.venvCreateProcess = createVenvProcess;

				// Add timeout for virtual environment creation
				await new Promise<void>((resolve, reject) => {
					let stdout = "";
					let stderr = "";

					// Set timeout for the operation
					const timeout = setTimeout(() => {
						console.error(
							"Virtual environment creation timed out after 60 seconds"
						);
						createVenvProcess.kill("SIGKILL");
						reject(new Error("Virtual environment creation timed out"));
					}, 60000); // 60 second timeout

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
							console.error(`venv stdout: ${stdout}`);
							console.error(`venv stderr: ${stderr}`);
							reject(
								new Error(
									`Failed to create virtual environment, exit code: ${code}. stderr: ${stderr}`
								)
							);
						}
					});

					createVenvProcess.on("error", (error) => {
						clearTimeout(timeout);
						console.error("Virtual environment creation process error:", error);
						reject(error);
					});
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

				// Ensure workspace-local kernelspec and metadata using centralized helper
				const kernelName = this.ensureWorkspaceKernelSpec(
					workspacePath,
					pythonVenvPath,
					venvPath
				);
				console.log(`Workspace kernel ensured: ${kernelName}`);

				// Notify renderer about completion
				this.mainWindow?.webContents.send("virtual-env-status", {
					status: "completed",
					message: "Virtual environment ready!",
					venvPath: venvPath,
					pythonPath: pythonVenvPath,
					kernelName: kernelName,
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

		// Interrupt currently running execution on the active kernel for a workspace
		ipcMain.handle(
			"jupyter-interrupt",
			async (_: any, workspacePath?: string) => {
				try {
					if (!this.jupyterProcess) {
						return { success: false, error: "Jupyter is not running" };
					}

					const wsPath =
						workspacePath || this.currentJupyterWorkspace || process.cwd();
					let kernelId: string | undefined = undefined;

					// Try to find kernelId from workspace map with normalized path
					try {
						const target = path.resolve(wsPath);
						for (const [key, id] of this.workspaceKernelMap.entries()) {
							if (path.resolve(key) === target) {
								kernelId = id;
								break;
							}
						}
					} catch {}

					// Fallback to any running kernel if specific mapping not found
					if (!kernelId) {
						try {
							const listResponse = await fetch(
								`http://127.0.0.1:${this.jupyterPort}/api/kernels`
							);
							const kernels: any[] = listResponse.ok
								? await listResponse.json()
								: [];
							kernelId = kernels?.[0]?.id;
						} catch {}
					}

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
						const venvPath = path.join(workspacePath, "venv");
						const pythonVenvPath =
							process.platform === "win32"
								? path.join(venvPath, "Scripts", "python.exe")
								: path.join(venvPath, "bin", "python");

						// Ensure the workspace kernelspec exists and metadata is up to date
						kernelName = this.ensureWorkspaceKernelSpec(
							workspacePath,
							pythonVenvPath,
							venvPath
						);
						console.log(`Using workspace kernel: ${kernelName}`);
					}

					console.log(`Looking for workspace kernel: ${kernelName}`);

					console.log(
						`Using kernel: ${kernelName} for workspace: ${workspacePath}`
					);

					// CSRF is disabled via NotebookApp.token='' and disable_check_xsrf=True
					// Skip CSRF retrieval to avoid transient connection issues on startup
					const csrfToken = undefined;

					// 1. Find or create a single kernel id for the workspace using new centralized helper
					const kernelId = await this.getOrCreateKernelId(
						workspacePath || this.currentJupyterWorkspace || process.cwd(),
						kernelName,
						csrfToken
					);

					// Optional small delay after server/kernel readiness to avoid race with channel registration
					try {
						const storeDelay = store.get("wsPostReadyDelayMs") as any as
							| number
							| undefined;
						const envDelay = process.env.WS_POST_READY_DELAY_MS
							? parseInt(process.env.WS_POST_READY_DELAY_MS, 10)
							: undefined;
						const postReadyDelayMs =
							Number.isFinite(storeDelay as any) && (storeDelay as any) >= 0
								? (storeDelay as number)
								: Number.isFinite(envDelay as any) && (envDelay as any) >= 0
								? (envDelay as number)
								: 1000;
						if (postReadyDelayMs > 0) {
							await new Promise((r) => setTimeout(r, postReadyDelayMs));
						}
					} catch (_) {}

					const wsUrl = `ws://127.0.0.1:${this.jupyterPort}/api/kernels/${kernelId}/channels`;
					console.log(`Connecting to WebSocket: ${wsUrl}`);

					// 2. Open a WebSocket connection with retries and configurable timeouts
					console.log(`Attempting to connect to WebSocket: ${wsUrl}`);

					return new Promise((resolve) => {
						let output = "";
						let errorOutput = "";
						let executionTimeoutId: NodeJS.Timeout | null = null;

						// Configurable idle timeout (ms)
						const storeIdleMs = store.get("executionIdleTimeoutMs") as any as
							| number
							| undefined;
						const envIdleMs = process.env.EXECUTION_IDLE_TIMEOUT_MS
							? parseInt(process.env.EXECUTION_IDLE_TIMEOUT_MS, 10)
							: undefined;
						const idleTimeoutMs =
							Number.isFinite(storeIdleMs as any) && (storeIdleMs as any) > 0
								? (storeIdleMs as number)
								: Number.isFinite(envIdleMs as any) && (envIdleMs as any) > 0
								? (envIdleMs as number)
								: 120000; // default 2 minutes

						// Configurable WS connection timeout and retry settings
						const storeConnMs = store.get("wsConnectionTimeoutMs") as any as
							| number
							| undefined;
						const envConnMs = process.env.WS_CONNECTION_TIMEOUT_MS
							? parseInt(process.env.WS_CONNECTION_TIMEOUT_MS, 10)
							: undefined;
						const wsConnectionTimeoutMs =
							Number.isFinite(storeConnMs as any) && (storeConnMs as any) > 0
								? (storeConnMs as number)
								: Number.isFinite(envConnMs as any) && (envConnMs as any) > 0
								? (envConnMs as number)
								: 30000; // default 30s

						const storeMaxAttempts = store.get(
							"wsConnectMaxAttempts"
						) as any as number | undefined;
						const envMaxAttempts = process.env.WS_CONNECT_MAX_ATTEMPTS
							? parseInt(process.env.WS_CONNECT_MAX_ATTEMPTS, 10)
							: undefined;
						const maxAttempts =
							Number.isFinite(storeMaxAttempts as any) &&
							(storeMaxAttempts as any) > 0
								? (storeMaxAttempts as number)
								: Number.isFinite(envMaxAttempts as any) &&
								  (envMaxAttempts as any) > 0
								? (envMaxAttempts as number)
								: 3;

						const storeBackoff = store.get("wsConnectBackoffMs") as any as
							| number
							| undefined;
						const envBackoff = process.env.WS_CONNECT_BACKOFF_MS
							? parseInt(process.env.WS_CONNECT_BACKOFF_MS, 10)
							: undefined;
						const backoffMs =
							Number.isFinite(storeBackoff as any) && (storeBackoff as any) >= 0
								? (storeBackoff as number)
								: Number.isFinite(envBackoff as any) && (envBackoff as any) >= 0
								? (envBackoff as number)
								: 1000;

						const attemptConnect = (attempt: number) => {
							console.log(
								`Attempting to connect to WebSocket (${attempt}/${maxAttempts})...`
							);
							const ws = new WebSocket(wsUrl);

							// Local reset function bound to this socket
							const resetExecutionTimeoutLocal = () => {
								if (!idleTimeoutMs || idleTimeoutMs <= 0) return;
								if (executionTimeoutId) clearTimeout(executionTimeoutId);
								executionTimeoutId = setTimeout(() => {
									console.log("Jupyter execution idle timeout");
									try {
										ws.close();
									} catch (_) {}
									resolve({ success: false, error: "Execution idle timeout" });
								}, idleTimeoutMs);
							};

							const connectionTimeout = setTimeout(() => {
								console.error("WebSocket connection timeout");
								try {
									ws.close();
								} catch (_) {}
								if (attempt < maxAttempts) {
									setTimeout(() => attemptConnect(attempt + 1), backoffMs);
								} else {
									resolve({
										success: false,
										error: "WebSocket connection timeout",
									});
								}
							}, wsConnectionTimeoutMs);

							ws.on("open", () => {
								console.log("Jupyter WebSocket connection opened.");
								clearTimeout(connectionTimeout);
								resetExecutionTimeoutLocal();

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
								if (executionTimeoutId) clearTimeout(executionTimeoutId);
								clearTimeout(connectionTimeout);
								if (attempt < maxAttempts) {
									setTimeout(() => attemptConnect(attempt + 1), backoffMs);
								} else {
									resolve({
										success: false,
										error: `WebSocket error: ${error.message}`,
									});
								}
							});

							ws.on("close", (code: any, reason: any) => {
								console.log(`WebSocket closed: ${code} - ${reason}`);
								if (!output && !errorOutput) {
									if (executionTimeoutId) clearTimeout(executionTimeoutId);
									clearTimeout(connectionTimeout);
									if (attempt < maxAttempts) {
										setTimeout(() => attemptConnect(attempt + 1), backoffMs);
									} else {
										resolve({
											success: false,
											error: `WebSocket closed unexpectedly: ${reason}`,
										});
									}
								}
							});

							ws.on("message", (data: any) => {
								const msg = JSON.parse(data.toString());
								// 4. Listen for execute_reply and stream messages
								if (msg.parent_header && msg.header.msg_type === "stream") {
									output += msg.content.text;
									console.log(`Stream output: ${msg.content.text}`);
									this.mainWindow?.webContents.send("jupyter-code-writing", {
										code: output,
										timestamp: new Date().toISOString(),
										type: "stream",
									});
									resetExecutionTimeoutLocal();
								} else if (
									msg.parent_header &&
									(msg.header.msg_type === "execute_result" ||
										msg.header.msg_type === "display_data")
								) {
									try {
										const dataObj = msg.content?.data || {};
										const text =
											(dataObj["text/plain"] as string | undefined) || "";
										if (text) {
											output += (output ? "\n" : "") + text + "\n";
											this.mainWindow?.webContents.send(
												"jupyter-code-writing",
												{
													code: output,
													timestamp: new Date().toISOString(),
													type: "stream",
												}
											);
										}
									} catch (_) {}
								} else if (
									msg.parent_header &&
									msg.header.msg_type === "execute_reply"
								) {
									console.log(`Execute reply:`, msg.content);
									if (msg.content.status === "ok") {
										console.log(`Execution successful, output: ${output}`);
										if (executionTimeoutId) clearTimeout(executionTimeoutId);
										resolve({ success: true, output });
									} else {
										errorOutput += msg.content.evalue;
										console.log(`Execution failed, error: ${errorOutput}`);
										if (executionTimeoutId) clearTimeout(executionTimeoutId);
										resolve({ success: false, error: errorOutput });
									}
									try {
										ws.close();
									} catch (_) {}
								} else if (
									msg.parent_header &&
									msg.header.msg_type === "error"
								) {
									const tb = Array.isArray(msg.content?.traceback)
										? (msg.content.traceback as string[]).join("\n")
										: "";
									errorOutput +=
										(errorOutput ? "\n" : "") +
										(msg.content.evalue || "Error") +
										(tb ? "\n" + tb : "");
									console.log(`Execution error: ${msg.content.evalue}`);
									resetExecutionTimeoutLocal();
								}
							});
						};

						// Start first attempt
						attemptConnect(1);
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

		ipcMain.on("app-is-packaged", (event) => {
			event.returnValue = app.isPackaged;
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
			// Use same logic as ConfigManager: local in dev, remote when packaged
			if (app.isPackaged) {
				return "http://axon.celvox.co:8002";
			} else {
				return `http://localhost:${this.bioragPort}`;
			}
		});

		// SSH session management (top-level, not nested)
		const sshClients = new Map<string, any>();
		const sshStreams = new Map<string, any>();
		const sshAuthFinish = new Map<string, (answers: string[]) => void>();
		const sshPendingRetry = new Map<
			string,
			{ host: string; port: number; username: string; cwd?: string }
		>();

		ipcMain.handle(
			"ssh-start",
			async (_: any, sessionId: string, config: any) => {
				try {
					let { host, port, username, cwd, target } = config || {};
					if (typeof target === "string" && target.trim().length > 0) {
						const t = target.trim();
						const atIdx = t.indexOf("@");
						let hostPort = t;
						if (atIdx > -1) {
							username = t.slice(0, atIdx);
							hostPort = t.slice(atIdx + 1);
						}
						const colonIdx = hostPort.lastIndexOf(":");
						if (colonIdx > -1) {
							host = hostPort.slice(0, colonIdx);
							const p = parseInt(hostPort.slice(colonIdx + 1), 10);
							if (Number.isFinite(p)) port = p;
						} else {
							host = hostPort;
						}
					}
					port = port || 22;
					if (!host) throw new Error("Missing host");
					if (!username) throw new Error("Missing username (use user@host)");

					const Client = require("ssh2").Client as any;
					const client = new Client();
					sshClients.set(sessionId, client);

					await new Promise<void>((resolve, reject) => {
						client
							.on(
								"keyboard-interactive",
								(
									_name: string,
									instructions: string,
									_lang: string,
									prompts: any[],
									finish: (answers: string[]) => void
								) => {
									try {
										sshAuthFinish.set(sessionId, finish);
										this.mainWindow?.webContents.send("ssh-auth-prompt", {
											sessionId,
											name: _name,
											instructions,
											prompts: (prompts || []).map((p: any) => ({
												prompt: p?.prompt,
												echo: !!p?.echo,
											})),
										});
									} catch {}
								}
							)
							.on("ready", () => {
								try {
									client.shell(
										{ term: "xterm-256color" },
										(err: any, stream: any) => {
											if (err) {
												reject(err);
												return;
											}
											sshStreams.set(sessionId, stream);
											stream.on("data", (data: Buffer) => {
												this.mainWindow?.webContents.send("ssh-data", {
													sessionId,
													data: data.toString("utf8"),
												});
											});
											stream.on("close", () => {
												this.mainWindow?.webContents.send("ssh-closed", {
													sessionId,
												});
												try {
													client.end();
												} catch {}
											});
											if (
												cwd &&
												typeof cwd === "string" &&
												cwd.trim().length > 0
											) {
												stream.write(
													`cd ${cwd
														.replace(/\\/g, "\\\\")
														.replace(/\n/g, "")}\n`
												);
											}
											resolve();
										}
									);
								} catch (e) {
									reject(e);
								}
							})
							.on("error", (err: any) => {
								this.mainWindow?.webContents.send("ssh-error", {
									sessionId,
									error: err?.message || String(err),
								});
								reject(err);
							})
							.on("end", () => {
								this.mainWindow?.webContents.send("ssh-closed", { sessionId });
							})
							.connect({
								host,
								port,
								username,
								tryKeyboard: true,
								password:
									config &&
									typeof config.password === "string" &&
									config.password.length > 0
										? config.password
										: undefined,
							});
					});

					return { success: true };
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					// If server didn't trigger keyboard-interactive and password was not provided, prompt for password
					if (
						/All configured authentication methods failed|No authentication methods available|Authentication failed/i.test(
							message
						)
					) {
						try {
							const tStr =
								typeof config?.target === "string"
									? String(config.target).trim()
									: "";
							let h: string | undefined =
								(config && (config.host as string)) || undefined;
							let p: number = (config && (config.port as number)) || 22;
							let u: string | undefined =
								(config && (config.username as string)) || undefined;
							const d: string | undefined =
								(config && (config.cwd as string)) || undefined;
							if (tStr) {
								const at = tStr.indexOf("@");
								let hp = tStr;
								if (at > -1) {
									u = tStr.slice(0, at);
									hp = tStr.slice(at + 1);
								}
								const ci = hp.lastIndexOf(":");
								if (ci > -1) {
									h = hp.slice(0, ci);
									const pv = parseInt(hp.slice(ci + 1), 10);
									if (Number.isFinite(pv)) p = pv;
								} else {
									h = hp;
								}
							}
							if (h && u) {
								sshPendingRetry.set(sessionId, {
									host: h,
									port: p,
									username: u,
									cwd: d,
								});
							}
							this.mainWindow?.webContents.send("ssh-auth-prompt", {
								sessionId,
								name: "password",
								instructions: "Password authentication required",
								prompts: [{ prompt: "Password:", echo: false }],
							});
							return { success: true, awaitingPassword: true };
						} catch {}
					}
					this.mainWindow?.webContents.send("ssh-error", {
						sessionId,
						error: message,
					});
					try {
						const c = sshClients.get(sessionId);
						c?.end?.();
					} catch {}
					sshClients.delete(sessionId);
					sshStreams.delete(sessionId);
					return { success: false, error: message };
				}
			}
		);

		ipcMain.handle(
			"ssh-write",
			async (_: any, sessionId: string, data: string) => {
				try {
					const stream = sshStreams.get(sessionId);
					if (stream) {
						stream.write(data);
						return { success: true };
					}
					return { success: false, error: "No active SSH stream" };
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		ipcMain.handle(
			"ssh-resize",
			async (_: any, sessionId: string, cols: number, rows: number) => {
				try {
					const stream = sshStreams.get(sessionId);
					if (stream && typeof stream.setWindow === "function") {
						stream.setWindow(rows || 24, cols || 80, 600, 400);
						return { success: true };
					}
					return { success: false };
				} catch (error) {
					return { success: false };
				}
			}
		);

		ipcMain.handle("ssh-stop", async (_: any, sessionId: string) => {
			try {
				const stream = sshStreams.get(sessionId);
				try {
					stream?.end?.();
				} catch {}
				const client = sshClients.get(sessionId);
				try {
					client?.end?.();
				} catch {}
				sshStreams.delete(sessionId);
				sshClients.delete(sessionId);
				sshAuthFinish.delete(sessionId);
				return { success: true };
			} catch (error) {
				return { success: false };
			}
		});

		ipcMain.handle(
			"ssh-auth-answer",
			async (_: any, sessionId: string, answers: string[]) => {
				try {
					const fn = sshAuthFinish.get(sessionId);
					if (fn) {
						sshAuthFinish.delete(sessionId);
						try {
							fn(answers || []);
							return { success: true };
						} catch (e: any) {
							return { success: false, error: e?.message || String(e) };
						}
					}
					// Fallback: retry connection with provided password if we stored target
					const retryCfg = sshPendingRetry.get(sessionId);
					if (!retryCfg)
						return { success: false, error: "No auth prompt pending" };
					sshPendingRetry.delete(sessionId);
					const password =
						Array.isArray(answers) && answers.length > 0
							? String(answers[0])
							: "";
					if (!password) return { success: false, error: "Empty password" };
					const Client = require("ssh2").Client as any;
					const client = new Client();
					sshClients.set(sessionId, client);
					await new Promise<void>((resolve, reject) => {
						client
							.on("ready", () => {
								try {
									client.shell(
										{ term: "xterm-256color" },
										(err: any, stream: any) => {
											if (err) {
												reject(err);
												return;
											}
											sshStreams.set(sessionId, stream);
											stream.on("data", (data: Buffer) => {
												this.mainWindow?.webContents.send("ssh-data", {
													sessionId,
													data: data.toString("utf8"),
												});
											});
											stream.on("close", () => {
												this.mainWindow?.webContents.send("ssh-closed", {
													sessionId,
												});
												try {
													client.end();
												} catch {}
											});
											if (
												retryCfg.cwd &&
												typeof retryCfg.cwd === "string" &&
												retryCfg.cwd.trim().length > 0
											) {
												stream.write(
													`cd ${retryCfg.cwd
														.replace(/\\/g, "\\\\")
														.replace(/\n/g, "")}\n`
												);
											}
											resolve();
										}
									);
								} catch (e) {
									reject(e);
								}
							})
							.on("error", (err: any) => {
								this.mainWindow?.webContents.send("ssh-error", {
									sessionId,
									error: err?.message || String(err),
								});
								reject(err);
							})
							.on("end", () => {
								this.mainWindow?.webContents.send("ssh-closed", { sessionId });
							})
							.connect({
								host: retryCfg.host,
								port: retryCfg.port,
								username: retryCfg.username,
								password,
								tryKeyboard: true,
							});
					});
					return { success: true };
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		// Open remote folder via SFTP into a local temp dir and notify renderer
		ipcMain.handle(
			"ssh-open-remote-folder",
			async (_: any, sessionId: string, remotePath: string) => {
				try {
					const client = sshClients.get(sessionId);
					if (!client) return { success: false, error: "No SSH session" };
					const sftp: any = await new Promise((resolve, reject) => {
						client.sftp((err: any, s: any) => (err ? reject(err) : resolve(s)));
					});
					const os = require("os");
					const path = require("path");
					const fs = require("fs");
					const localRoot = path.join(os.tmpdir(), `axon-remote-${sessionId}`);
					fs.mkdirSync(localRoot, { recursive: true });

					const downloadDir = async (
						rPath: string,
						lPath: string
					): Promise<void> => {
						await new Promise<void>((resolve, reject) => {
							sftp.readdir(rPath, async (err2: any, list: any[]) => {
								if (err2) return reject(err2);
								if (!list || list.length === 0) return resolve();
								// Ensure local dir
								fs.mkdirSync(lPath, { recursive: true });
								const processNext = async (idx: number) => {
									if (idx >= list.length) return resolve();
									const entry = list[idx];
									const name =
										entry.filename || entry.longname?.split(/\s+/).pop();
									if (!name || name === "." || name === "..") {
										return processNext(idx + 1);
									}
									const rChild = path.posix.join(rPath, name);
									const lChild = path.join(lPath, name);
									sftp.stat(rChild, (e3: any, st: any) => {
										if (e3) return processNext(idx + 1);
										if (st.isDirectory && st.isDirectory()) {
											fs.mkdirSync(lChild, { recursive: true });
											downloadDir(rChild, lChild).then(() =>
												processNext(idx + 1)
											);
										} else {
											const writeStream = fs.createWriteStream(lChild);
											const readStream = sftp.createReadStream(rChild);
											readStream
												.pipe(writeStream)
												.on("finish", () => processNext(idx + 1))
												.on("error", () => processNext(idx + 1));
										}
									});
								};
								processNext(0);
							});
						});
					};

					fs.mkdirSync(localRoot, { recursive: true });
					await downloadDir(remotePath, localRoot);

					// Tell renderer to set workspace
					this.mainWindow?.webContents.send("set-workspace", localRoot);
					return { success: true, localPath: localRoot };
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
		);

		// File operations
		// Removed duplicate file and directory IPC handlers to avoid confusion.
		// Use the fs-* channels exposed via preload instead.

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
						if (output.includes("ERROR") || output.includes("WARNING")) {
							console.log(`[pip stdout]: ${output}`);
						}
					});

					installProcess.stderr?.on("data", (data) => {
						const output = data.toString();
						stderr += output;
						// Only log pip stderr if it contains actual errors
						if (output.includes("ERROR") || output.includes("FAILED")) {
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
									new Error(
										`Failed to install packages, exit code: ${code}. stderr: ${stderr}`
									)
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
								const isInstalled = verifyOutput
									.toLowerCase()
									.includes(pkg.toLowerCase());
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
			const result = await execAsync("jupyter kernelspec list").catch(
				() => null
			);
			if (result && result.stdout) {
				const lines = result.stdout.split("\n");
				for (const line of lines) {
					if (line.includes("axon-") && !line.includes("Available kernels:")) {
						const kernelName = line.trim().split(/\s+/)[0];
						if (kernelName.startsWith("axon-")) {
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
		this.cleanupOldKernels().catch((error) => {
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
