import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
	// File system operations
	readFile: (filePath: string) => ipcRenderer.invoke("fs-read-file", filePath),
	writeFile: (filePath: string, content: string) =>
		ipcRenderer.invoke("fs-write-file", filePath, content),
	createDirectory: (dirPath: string) =>
		ipcRenderer.invoke("fs-create-directory", dirPath),
	listDirectory: (dirPath: string) =>
		ipcRenderer.invoke("fs-list-directory", dirPath),

	// Jupyter operations
	startJupyter: (workingDir: string) =>
		ipcRenderer.invoke("jupyter-start", workingDir),
	stopJupyter: () => ipcRenderer.invoke("jupyter-stop"),
	checkJupyterStatus: () => ipcRenderer.invoke("jupyter-status"),
	executeJupyterCode: (code: string) =>
		ipcRenderer.invoke("jupyter-execute", code),
	createVirtualEnv: (workspacePath: string) =>
		ipcRenderer.invoke("create-virtual-env", workspacePath),

	// Dialog operations
	showOpenDialog: (options: any) =>
		ipcRenderer.invoke("show-open-dialog", options),
	showSaveDialog: (options: any) =>
		ipcRenderer.invoke("show-save-dialog", options),

	// Store operations
	storeGet: (key: string) => ipcRenderer.invoke("store-get", key),
	storeSet: (key: string, value: any) =>
		ipcRenderer.invoke("store-set", key, value),

	// BioRAG operations
	bioragQuery: (query: any) => ipcRenderer.invoke("biorag-query", query),
	getBioragPort: () => ipcRenderer.invoke("get-biorag-port"),
	getBioragUrl: () => ipcRenderer.invoke("get-biorag-url"),

	// Event listeners
	onBioRAGLog: (callback: (data: string) => void) => {
		ipcRenderer.on("biorag-log", (_, data) => callback(data));
	},
	onBioRAGError: (callback: (data: string) => void) => {
		ipcRenderer.on("biorag-error", (_, data) => callback(data));
	},
	onBioRAGServerReady: (
		callback: (data: { port: number; url: string }) => void
	) => {
		ipcRenderer.on("biorag-server-ready", (_, data) => callback(data));
	},
	onJupyterLog: (callback: (data: string) => void) => {
		ipcRenderer.on("jupyter-log", (_, data) => callback(data));
	},
	onJupyterReady: (
		callback: (data: { url: string; token: string }) => void
	) => {
		ipcRenderer.on("jupyter-ready", (_, data) => callback(data));
	},
	onJupyterError: (callback: (data: string) => void) => {
		ipcRenderer.on("jupyter-error", (_, data) => callback(data));
	},
	onVirtualEnvStatus: (callback: (data: any) => void) => {
		ipcRenderer.on("virtual-env-status", (_, data) => callback(data));
	},
	onJupyterCodeWriting: (callback: (data: any) => void) => {
		ipcRenderer.on("jupyter-code-writing", (_, data) => callback(data));
	},

	// Workspace events
	onSetWorkspace: (callback: (workspacePath: string) => void) => {
		ipcRenderer.on("set-workspace", (_, workspacePath) =>
			callback(workspacePath)
		);
	},
	onTriggerOpenWorkspace: (callback: () => void) => {
		ipcRenderer.on("trigger-open-workspace", () => callback());
	},

	// Remove listeners
	removeAllListeners: (channel: string) => {
		ipcRenderer.removeAllListeners(channel);
	},
});

// Type definitions for the exposed API
export interface ElectronAPI {
	readFile: (filePath: string) => Promise<string>;
	writeFile: (filePath: string, content: string) => Promise<boolean>;
	createDirectory: (dirPath: string) => Promise<boolean>;
	listDirectory: (
		dirPath: string
	) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;

	startJupyter: (
		workingDir: string
	) => Promise<{ success: boolean; url?: string; error?: string }>;
	stopJupyter: () => Promise<{ success: boolean }>;
	checkJupyterStatus: () => Promise<boolean>;
	executeJupyterCode: (
		code: string
	) => Promise<{ success: boolean; output?: string; error?: string }>;
	createVirtualEnv: (workspacePath: string) => Promise<{
		success: boolean;
		venvPath?: string;
		pythonPath?: string;
		kernelName?: string;
		error?: string;
	}>;

	showOpenDialog: (options: any) => Promise<any>;
	showSaveDialog: (options: any) => Promise<any>;

	storeGet: (key: string) => Promise<any>;
	storeSet: (key: string, value: any) => Promise<boolean>;

	bioragQuery: (query: any) => Promise<any>;
	getBioragPort: () => Promise<any>;
	getBioragUrl: () => Promise<any>;

	onBioRAGLog: (callback: (data: string) => void) => void;
	onBioRAGError: (callback: (data: string) => void) => void;
	onBioRAGServerReady: (
		callback: (data: { port: number; url: string }) => void
	) => void;
	onJupyterLog: (callback: (data: string) => void) => void;
	onJupyterReady: (
		callback: (data: { url: string; token: string }) => void
	) => void;
	onJupyterError: (callback: (data: string) => void) => void;
	onVirtualEnvStatus: (callback: (data: any) => void) => void;
	onJupyterCodeWriting: (callback: (data: any) => void) => void;

	onSetWorkspace: (callback: (workspacePath: string) => void) => void;
	onTriggerOpenWorkspace: (callback: () => void) => void;

	removeAllListeners: (channel: string) => void;
}
