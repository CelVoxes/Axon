"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BioRAGCursorApp = void 0;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_store_1 = __importDefault(require("electron-store"));
// Store for app settings
const store = new electron_store_1.default();
class BioRAGCursorApp {
    constructor() {
        this.mainWindow = null;
        this.bioragServer = null;
        this.jupyterProcess = null;
        this.jupyterPort = 8888;
        this.bioragPort = 8000;
        this.initializeApp();
    }
    initializeApp() {
        electron_1.app
            .whenReady()
            .then(async () => {
            try {
                this.createMainWindow();
                await this.startBioRAGServer();
                this.setupIpcHandlers();
                this.createMenu();
            }
            catch (error) {
                console.error("Error during app initialization:", error);
            }
        })
            .catch((error) => {
            console.error("Failed to initialize app:", error);
        });
        electron_1.app.on("window-all-closed", () => {
            try {
                this.cleanup();
                if (process.platform !== "darwin") {
                    electron_1.app.quit();
                }
            }
            catch (error) {
                console.error("Error during app cleanup:", error);
            }
        });
        electron_1.app.on("activate", () => {
            try {
                if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                    this.createMainWindow();
                }
            }
            catch (error) {
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
    createMainWindow() {
        this.mainWindow = new electron_1.BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1200,
            minHeight: 700,
            title: "Node",
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
        // Set CSP headers for better security
        this.mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [
                        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:* https://localhost:*; frame-src 'self' http://127.0.0.1:* https://127.0.0.1:*; frame-ancestors 'self';",
                    ],
                },
            });
        });
        // Load the React app
        if (process.env.NODE_ENV === "development") {
            this.mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
            this.mainWindow.webContents.openDevTools();
        }
        else {
            this.mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
        }
        this.mainWindow.once("ready-to-show", () => {
            this.mainWindow?.show();
        });
        // Handle external links
        this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            electron_1.shell.openExternal(url);
            return { action: "deny" };
        });
    }
    createMenu() {
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
        const menu = electron_1.Menu.buildFromTemplate(template);
        electron_1.Menu.setApplicationMenu(menu);
    }
    async startBioRAGServer() {
        try {
            // First, clean up any existing BioRAG processes
            await this.cleanupExistingBioRAGProcesses();
            // Check if BioRAG server is already running on the configured port
            const isRunning = await this.checkBioRAGServerRunning();
            if (isRunning) {
                console.log(`BioRAG server already running on port ${this.bioragPort}`);
                this.mainWindow?.webContents.send("biorag-log", `Using existing BioRAG server on port ${this.bioragPort}`);
                return;
            }
            // Find an available port starting from the preferred port
            const availablePort = await this.findAvailablePort(this.bioragPort);
            if (availablePort !== this.bioragPort) {
                console.log(`Port ${this.bioragPort} busy, using port ${availablePort} instead`);
                this.bioragPort = availablePort;
            }
            console.log(`Starting BioRAG server on port ${this.bioragPort}`);
            // Start the BioRAG API server with the available port
            const pythonPath = await this.findPythonPath();
            const bioragPath = path.join(__dirname, "..", "..", "biorag");
            this.bioragServer = (0, child_process_1.spawn)(pythonPath, [
                "-m",
                "biorag.main",
                "serve",
                "--host",
                "0.0.0.0",
                "--port",
                this.bioragPort.toString(),
                "--no-reload",
            ], {
                cwd: path.dirname(bioragPath),
                stdio: "pipe",
            });
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
                        console.log(`Port conflict detected in server stderr - this shouldn't happen as port was pre-allocated`);
                        this.mainWindow?.webContents.send("biorag-log", `BioRAG server encountered port conflict despite pre-allocation`);
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
                    console.log(`BioRAG server started successfully on port ${this.bioragPort}`);
                    this.mainWindow?.webContents.send("biorag-log", `BioRAG server is ready on port ${this.bioragPort}`);
                    // Notify renderer about the BioRAG URL
                    this.mainWindow?.webContents.send("biorag-server-ready", {
                        port: this.bioragPort,
                        url: `http://localhost:${this.bioragPort}`,
                    });
                }
                else {
                    console.log("BioRAG server may not have started properly, but continuing...");
                }
            }, 3000);
        }
        catch (error) {
            console.error("Failed to start BioRAG server:", error);
            this.mainWindow?.webContents.send("biorag-error", `Failed to start BioRAG server: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    async findAvailablePort(startPort) {
        const net = require("net");
        return new Promise((resolve, reject) => {
            let currentPort = startPort;
            const maxAttempts = 10; // Prevent infinite loops
            let attempts = 0;
            const tryPort = (port) => {
                if (attempts >= maxAttempts) {
                    reject(new Error(`Could not find available port after ${maxAttempts} attempts starting from ${startPort}`));
                    return;
                }
                attempts++;
                const server = net.createServer();
                server.listen(port, "127.0.0.1", () => {
                    const allocatedPort = server.address()?.port;
                    server.close(() => {
                        console.log(`Found available port: ${allocatedPort}`);
                        resolve(allocatedPort);
                    });
                });
                server.on("error", (err) => {
                    if (err.code === "EADDRINUSE") {
                        console.log(`Port ${port} is busy, trying ${port + 1}`);
                        tryPort(port + 1);
                    }
                    else {
                        reject(err);
                    }
                });
            };
            tryPort(currentPort);
        });
    }
    async checkBioRAGServerRunning() {
        try {
            const response = await fetch(`http://localhost:${this.bioragPort}/health`);
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async findPythonPath() {
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
            }
            catch (error) {
                console.log(`Python command ${cmd} not available`);
                // Continue to next command
            }
        }
        // Fallback to stored preference or default
        const storedPath = store.get("pythonPath", "python3");
        console.log(`Using fallback Python path: ${storedPath}`);
        return storedPath;
    }
    async cleanupExistingBioRAGProcesses() {
        try {
            const { exec } = require("child_process");
            const { promisify } = require("util");
            const execAsync = promisify(exec);
            console.log(`Checking for processes on BioRAG port ${this.bioragPort}...`);
            if (process.platform === "win32") {
                // Windows: Find and kill process using the BioRAG port
                await execAsync(`netstat -ano | findstr :${this.bioragPort}`)
                    .then(async (result) => {
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
            }
            else {
                // Unix-like systems: Find and kill process using the BioRAG port
                await execAsync(`lsof -ti:${this.bioragPort} | xargs kill -9`).catch(() => {
                    // Ignore errors if no process is using the port
                    console.log(`No processes found on port ${this.bioragPort}`);
                });
            }
        }
        catch (error) {
            console.log(`No existing server to kill on port ${this.bioragPort} or error:`, error);
        }
    }
    setupIpcHandlers() {
        // Dialog operations
        electron_1.ipcMain.handle("show-open-dialog", async (_, options) => {
            if (process.platform === "darwin") {
                options.properties = options.properties || [];
                if (!options.properties.includes("openDirectory")) {
                    options.properties.push("openDirectory");
                }
                if (!options.properties.includes("createDirectory")) {
                    options.properties.push("createDirectory");
                }
            }
            const result = await electron_1.dialog.showOpenDialog(this.mainWindow, options);
            return result;
        });
        // File system operations
        electron_1.ipcMain.handle("fs-read-file", async (_, filePath) => {
            try {
                return await fs.promises.readFile(filePath, "utf8");
            }
            catch (error) {
                throw error;
            }
        });
        // File system: write file
        electron_1.ipcMain.handle("fs-write-file", async (_, filePath, content) => {
            try {
                await fs.promises.writeFile(filePath, content, "utf-8");
                return { success: true };
            }
            catch (error) {
                console.error("Error writing file:", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        electron_1.ipcMain.handle("fs-create-directory", async (_, dirPath) => {
            try {
                await fs.promises.mkdir(dirPath, { recursive: true });
                return true;
            }
            catch (error) {
                throw error;
            }
        });
        electron_1.ipcMain.handle("fs-list-directory", async (_, dirPath) => {
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
            }
            catch (error) {
                throw error;
            }
        });
        // Jupyter notebook operations
        electron_1.ipcMain.handle("jupyter-start", async (_, workingDir) => {
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
                const checkJupyter = (0, child_process_1.spawn)(pythonPath, ["-m", "jupyterlab", "--version"], {
                    cwd: workingDir,
                });
                await new Promise((resolve, reject) => {
                    checkJupyter.on("close", (code) => {
                        if (code === 0) {
                            console.log("Found Jupyter Lab via python -m jupyterlab");
                            resolve(null);
                        }
                        else {
                            reject(new Error("Jupyter Lab not found"));
                        }
                    });
                });
                // Start Jupyter Lab
                this.jupyterProcess = (0, child_process_1.spawn)(pythonPath, [
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
                ], {
                    cwd: workingDir,
                    env: { ...process.env, PYTHONUNBUFFERED: "1" },
                });
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
                    this.jupyterProcess.stdout?.on("data", (data) => {
                        const output = data.toString();
                        console.log(`Jupyter Log: ${output}`);
                        // Look for the actual URL in the output
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
                    this.jupyterProcess.stderr?.on("data", (data) => {
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
                    this.jupyterProcess.on("error", (error) => {
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
            }
            catch (error) {
                console.error("Failed to start Jupyter:", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        electron_1.ipcMain.handle("jupyter-stop", async () => {
            if (this.jupyterProcess) {
                this.jupyterProcess.kill("SIGTERM");
                this.jupyterProcess = null;
                this.jupyterPort = 8888;
                return { success: true };
            }
            return { success: false };
        });
        electron_1.ipcMain.handle("jupyter-status", async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                console.log(`Checking Jupyter status at: http://127.0.0.1:${this.jupyterPort}/api/status`);
                const response = await fetch(`http://127.0.0.1:${this.jupyterPort}/api/status`, {
                    signal: controller.signal,
                    headers: {
                        Accept: "application/json",
                    },
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    console.log("Jupyter health check: HEALTHY");
                    return true;
                }
                else {
                    console.log(`Jupyter health check: ✗ UNHEALTHY (${response.status})`);
                    return false;
                }
            }
            catch (error) {
                console.log(`Jupyter health check: ✗ ERROR (${error instanceof Error ? error.message : "Unknown error"})`);
                return false;
            }
        });
        electron_1.ipcMain.handle("jupyter-execute", async (_, code) => {
            try {
                console.log(`Executing code in Jupyter: \n${code.substring(0, 100)}...`);
                const WebSocket = require("ws");
                const { v4: uuidv4 } = require("uuid");
                // 1. Find the running kernel
                const response = await fetch(`http://127.0.0.1:${this.jupyterPort}/api/kernels`);
                const kernels = await response.json();
                if (!kernels || kernels.length === 0) {
                    throw new Error("No active Jupyter kernel found.");
                }
                const kernelId = kernels[0].id;
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
                    ws.on("message", (data) => {
                        const msg = JSON.parse(data.toString());
                        // 4. Listen for execute_reply and stream messages
                        if (msg.parent_header && msg.header.msg_type === "stream") {
                            output += msg.content.text;
                        }
                        else if (msg.parent_header &&
                            msg.header.msg_type === "execute_reply") {
                            if (msg.content.status === "ok") {
                                resolve({ success: true, output });
                            }
                            else {
                                errorOutput += msg.content.evalue;
                                resolve({ success: false, error: errorOutput });
                            }
                            ws.close();
                        }
                        else if (msg.parent_header && msg.header.msg_type === "error") {
                            errorOutput += msg.content.evalue;
                        }
                    });
                    ws.on("close", () => {
                        console.log("Jupyter WebSocket connection closed.");
                        if (!output && errorOutput) {
                            resolve({ success: false, error: errorOutput });
                        }
                    });
                    ws.on("error", (error) => {
                        console.error("Jupyter WebSocket error:", error);
                        resolve({
                            success: false,
                            error: `WebSocket error: ${error.message}`,
                        });
                    });
                });
            }
            catch (error) {
                console.error("Jupyter execution error:", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        electron_1.ipcMain.handle("show-save-dialog", async (_, options) => {
            const result = await electron_1.dialog.showSaveDialog(this.mainWindow, options);
            return result;
        });
        // Store operations
        electron_1.ipcMain.handle("store-get", (_, key) => {
            return store.get(key);
        });
        electron_1.ipcMain.handle("store-set", (_, key, value) => {
            store.set(key, value);
            return true;
        });
        // BioRAG API proxy
        electron_1.ipcMain.handle("biorag-query", async (_, query) => {
            try {
                // This will be handled by the renderer process via HTTP
                return { success: true };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        // BioRAG server management
        electron_1.ipcMain.handle("get-biorag-port", () => {
            return this.bioragPort;
        });
        electron_1.ipcMain.handle("get-biorag-url", () => {
            return `http://localhost:${this.bioragPort}`;
        });
        // File operations
    }
    cleanup() {
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
            }
            catch (error) {
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
            }
            catch (error) {
                console.error("Error terminating Jupyter process:", error);
            }
        }
        console.log("BioRAG system shutdown complete");
    }
}
exports.BioRAGCursorApp = BioRAGCursorApp;
// Initialize the app
new BioRAGCursorApp();
