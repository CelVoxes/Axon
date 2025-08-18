export interface ElectronAPI {
	readFile: (filePath: string) => Promise<string>;
	readFileBinary: (
		filePath: string
	) => Promise<{ dataUrl: string; mime: string }>;
	writeFile: (filePath: string, content: string) => Promise<boolean>;
	createDirectory: (dirPath: string) => Promise<boolean>;
	directoryExists: (dirPath: string) => Promise<boolean>;
	listDirectory: (
		dirPath: string
	) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
	openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
	getFileInfo: (filePath: string) => Promise<{
		size: number;
		created: string | Date;
		modified: string | Date;
		isDirectory: boolean;
	}>;
	findFile: (basePath: string, filename: string) => Promise<string[]>;
	deleteFile: (
		filePath: string
	) => Promise<{ success: boolean; error?: string }>;
	deleteDirectory: (
		dirPath: string
	) => Promise<{ success: boolean; error?: string }>;

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

	showOpenDialog: (options: any) => Promise<any>;
	showSaveDialog: (options: any) => Promise<any>;

	storeGet: (key: string) => Promise<any>;
	storeSet: (key: string, value: any) => Promise<boolean>;

	bioragQuery: (query: any) => Promise<any>;
	getBioragPort: () => Promise<number>;
	getBioragUrl: () => Promise<string>;

	onBioRAGLog: (callback: (data: string) => void) => void;
	onBioRAGError: (callback: (data: string) => void) => void;
	onJupyterLog: (callback: (data: string) => void) => void;
	onJupyterReady: (
		callback: (data: { url: string; token: string }) => void
	) => void;
	onJupyterError: (callback: (data: string) => void) => void;
	onVirtualEnvStatus: (callback: (data: any) => void) => void;
	onJupyterCodeWriting: (callback: (data: any) => void) => void;
	onJupyterNetworkError: (callback: (data: any) => void) => void;

	// SSH
	sshStart: (
		sessionId: string,
		config: any
	) => Promise<{ success: boolean; error?: string }>;
	sshWrite: (
		sessionId: string,
		data: string
	) => Promise<{ success: boolean; error?: string }>;
	sshResize: (
		sessionId: string,
		cols: number,
		rows: number
	) => Promise<{ success: boolean; error?: string }>;
	sshStop: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
	onSSHData: (callback: (data: any) => void) => void;
	onSSHError: (callback: (data: any) => void) => void;
	onSSHClosed: (callback: (data: any) => void) => void;
	onSSHAuthPrompt: (callback: (data: any) => void) => void;
	sshAuthAnswer: (
		sessionId: string,
		answers: string[]
	) => Promise<{ success: boolean; error?: string }>;
	sshOpenRemoteFolder: (
		sessionId: string,
		remotePath: string
	) => Promise<{ success: boolean; localPath?: string; error?: string }>;

	onSetWorkspace: (callback: (workspacePath: string) => void) => void;
	onTriggerOpenWorkspace: (callback: () => void) => void;

	// Store operations
	storeGet: (key: string) => Promise<any>;
	storeSet: (key: string, value: any) => Promise<boolean>;

	// App operations
	isPackaged: () => boolean;

	// BioRAG operations
	bioragQuery: (query: any) => Promise<any>;
	getBioragPort: () => Promise<any>;
	getBioragUrl: () => Promise<any>;

	removeAllListeners: (channel: string) => void;
}

declare global {
	interface Window {
		electronAPI: ElectronAPI;
	}

	namespace JSX {
		interface IntrinsicElements {
			webview: {
				src?: string;
				style?: React.CSSProperties;
				onLoad?: () => void;
				nodeintegration?: boolean;
				webpreferences?: string;
			};
		}
	}
}

declare module "*.png" {
	const value: string;
	export default value;
}

declare module "*.jpg" {
	const value: string;
	export default value;
}

declare module "*.jpeg" {
	const value: string;
	export default value;
}

declare module "*.gif" {
	const value: string;
	export default value;
}

declare module "*.svg" {
	const value: string;
	export default value;
}

// React-Markdown rehype plugin without types
declare module "rehype-sanitize" {
	const plugin: any;
	export default plugin;
}
