import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
	// File system operations
	readFile: (filePath: string) => ipcRenderer.invoke("fs-read-file", filePath),
	readFileBinary: (filePath: string) =>
		ipcRenderer.invoke("fs-read-file-binary", filePath),
	writeFile: async (filePath: string, content: string) => {
		const result = await ipcRenderer.invoke("fs-write-file", filePath, content);
		try {
			// Notify renderer UI to refresh file tree
			window.dispatchEvent(new Event("refreshFileTree"));
		} catch {}
		return result;
	},
	deleteFile: async (filePath: string) => {
		const result = await ipcRenderer.invoke("delete-file", filePath);
		try {
			window.dispatchEvent(new Event("refreshFileTree"));
		} catch {}
		return result;
	},
	deleteDirectory: async (dirPath: string) => {
		const result = await ipcRenderer.invoke("delete-directory", dirPath);
		try {
			window.dispatchEvent(new Event("refreshFileTree"));
		} catch {}
		return result;
	},
	createDirectory: async (dirPath: string) => {
		const result = await ipcRenderer.invoke("fs-create-directory", dirPath);
		try {
			// Notify renderer UI to refresh file tree
			window.dispatchEvent(new Event("refreshFileTree"));
		} catch {
			// ignore
		}
		return result;
	},
	directoryExists: (dirPath: string) =>
		ipcRenderer.invoke("directory-exists", dirPath),
	listDirectory: (dirPath: string) =>
		ipcRenderer.invoke("fs-list-directory", dirPath),
	openFile: (filePath: string) => ipcRenderer.invoke("open-file", filePath),
	getFileInfo: (filePath: string) =>
		ipcRenderer.invoke("get-file-info", filePath),
	findFile: (basePath: string, filename: string) =>
		ipcRenderer.invoke("fs-find-file", basePath, filename),

	// Jupyter operations
	startJupyter: (workingDir: string) =>
		ipcRenderer.invoke("jupyter-start", workingDir),
	stopJupyter: () => ipcRenderer.invoke("jupyter-stop"),
	checkJupyterStatus: () => ipcRenderer.invoke("jupyter-status"),
	executeJupyterCode: (code: string, workspacePath?: string) =>
		ipcRenderer.invoke("jupyter-execute", code, workspacePath),
	interruptJupyter: (workspacePath?: string) =>
		ipcRenderer.invoke("jupyter-interrupt", workspacePath),
	createVirtualEnv: (workspacePath: string) =>
		ipcRenderer.invoke("create-virtual-env", workspacePath),
	installPackages: (workspacePath: string, packages: string[]) =>
		ipcRenderer.invoke("install-packages", workspacePath, packages),
	cancelVirtualEnv: () => ipcRenderer.invoke("cancel-virtual-env"),

	// Dialog operations
	showOpenDialog: (options: any) =>
		ipcRenderer.invoke("show-open-dialog", options),
	showSaveDialog: (options: any) =>
		ipcRenderer.invoke("show-save-dialog", options),

	// Store operations
	storeGet: (key: string) => ipcRenderer.invoke("store-get", key),
	storeSet: (key: string, value: any) =>
		ipcRenderer.invoke("store-set", key, value),

	// App operations
	isPackaged: () => ipcRenderer.sendSync("app-is-packaged"),

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

	// SSH operations
	sshStart: (sessionId: string, config: any) =>
		ipcRenderer.invoke("ssh-start", sessionId, config),
	sshWrite: (sessionId: string, data: string) =>
		ipcRenderer.invoke("ssh-write", sessionId, data),
	sshResize: (sessionId: string, cols: number, rows: number) =>
		ipcRenderer.invoke("ssh-resize", sessionId, cols, rows),
	sshStop: (sessionId: string) => ipcRenderer.invoke("ssh-stop", sessionId),
	onSSHData: (callback: (data: any) => void) => {
		ipcRenderer.on("ssh-data", (_, data) => callback(data));
	},
	onSSHError: (callback: (data: any) => void) => {
		ipcRenderer.on("ssh-error", (_, data) => callback(data));
	},
	onSSHClosed: (callback: (data: any) => void) => {
		ipcRenderer.on("ssh-closed", (_, data) => callback(data));
	},
	onSSHAuthPrompt: (callback: (data: any) => void) => {
		ipcRenderer.on("ssh-auth-prompt", (_, data) => callback(data));
	},
	sshAuthAnswer: (sessionId: string, answers: string[]) =>
		ipcRenderer.invoke("ssh-auth-answer", sessionId, answers),
	sshOpenRemoteFolder: (sessionId: string, remotePath: string) =>
		ipcRenderer.invoke("ssh-open-remote-folder", sessionId, remotePath),

	// Workspace events
	onSetWorkspace: (callback: (workspacePath: string) => void) => {
		ipcRenderer.on("set-workspace", (_, workspacePath) =>
			callback(workspacePath)
		);
	},
	onTriggerOpenWorkspace: (callback: () => void) => {
		ipcRenderer.on("trigger-open-workspace", () => callback());
	},

	// FS watch events
	onFsWatchEvent: (callback: (root: string) => void) => {
		ipcRenderer.on("fs-watch-event", (_evt, payload: { root: string }) => {
			if (payload && payload.root) callback(payload.root);
		});
	},
	startFsWatch: (dirPath: string) =>
		ipcRenderer.invoke("fs-watch-start", dirPath),
	stopFsWatch: (dirPath: string) =>
		ipcRenderer.invoke("fs-watch-stop", dirPath),

	// Auto-updater operations
	checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
	installUpdate: () => ipcRenderer.invoke("install-update"),
	onUpdateStatus: (callback: (data: any) => void) => {
		ipcRenderer.on("update-status", (_, data) => callback(data));
	},

	// Remove listeners
	removeAllListeners: (channel: string) => {
		ipcRenderer.removeAllListeners(channel);
	},
});

// Bridge selected IPC events to window CustomEvents so React can listen with window.addEventListener
try {
	ipcRenderer.on("jupyter-ready", (_evt, data) => {
		try {
			const e = new CustomEvent("jupyter-ready", {
				detail: { status: "ready", ...(data || {}) },
			});
			window.dispatchEvent(e);
		} catch {}
	});
	ipcRenderer.on("jupyter-error", (_evt, data) => {
		try {
			const e = new CustomEvent("jupyter-ready", {
				detail: { status: "error", message: String(data) },
			});
			window.dispatchEvent(e);
		} catch {}
	});
	ipcRenderer.on("virtual-env-status", (_evt, data) => {
		try {
			const e = new CustomEvent("virtual-env-status", { detail: data });
			window.dispatchEvent(e);
		} catch {}
	});
	ipcRenderer.on("python-setup-status", (_evt, data) => {
		try {
			const e = new CustomEvent("python-setup-status", { detail: data });
			window.dispatchEvent(e);
		} catch {}
	});
	ipcRenderer.on("package-install-progress", (_evt, data) => {
		try {
			const e = new CustomEvent("package-install-progress", { detail: data });
			window.dispatchEvent(e);
		} catch {}
	});
} catch {}

// Type definitions for the exposed API
export interface ElectronAPI {
	readFile: (filePath: string) => Promise<string>;
	readFileBinary: (
		filePath: string
	) => Promise<{ dataUrl: string; mime: string }>;
	writeFile: (filePath: string, content: string) => Promise<boolean>;
	deleteFile: (
		filePath: string
	) => Promise<{ success: boolean; error?: string } | boolean>;
	deleteDirectory: (
		dirPath: string
	) => Promise<{ success: boolean; error?: string } | boolean>;
	createDirectory: (dirPath: string) => Promise<boolean>;
	directoryExists: (dirPath: string) => Promise<boolean>;
	listDirectory: (
		dirPath: string
	) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
	openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
	findFile: (basePath: string, filename: string) => Promise<string[]>;

	startJupyter: (
		workingDir: string
	) => Promise<{ success: boolean; url?: string; error?: string }>;
	stopJupyter: () => Promise<{ success: boolean }>;
	checkJupyterStatus: () => Promise<boolean>;
	executeJupyterCode: (
		code: string,
		workspacePath?: string
	) => Promise<{ success: boolean; output?: string; error?: string }>;
	interruptJupyter: (
		workspacePath?: string
	) => Promise<{ success: boolean; error?: string }>;
	createVirtualEnv: (workspacePath: string) => Promise<{
		success: boolean;
		venvPath?: string;
		pythonPath?: string;
		kernelName?: string;
		error?: string;
	}>;
	installPackages: (
		workspacePath: string,
		packages: string[]
	) => Promise<{
		success: boolean;
		packages?: string[];
		error?: string;
	}>;
	cancelVirtualEnv: () => Promise<{
		success: boolean;
		cancelled?: boolean;
		error?: string;
	}>;

	showOpenDialog: (options: any) => Promise<any>;
	showSaveDialog: (options: any) => Promise<any>;

	storeGet: (key: string) => Promise<any>;
	storeSet: (key: string, value: any) => Promise<boolean>;

	isPackaged: () => boolean;

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

	// Auto-updater operations
	checkForUpdates: () => Promise<{ success: boolean; error?: string }>;
	installUpdate: () => Promise<{ success: boolean; error?: string }>;
	onUpdateStatus: (callback: (data: any) => void) => void;

	removeAllListeners: (channel: string) => void;
}
