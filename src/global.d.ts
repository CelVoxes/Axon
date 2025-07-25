export interface ElectronAPI {
	readFile: (filePath: string) => Promise<string>;
	writeFile: (filePath: string, content: string) => Promise<boolean>;
	createDirectory: (dirPath: string) => Promise<boolean>;
	listDirectory: (
		dirPath: string
	) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;

	startJupyter: (
		workingDir: string
	) => Promise<{ success: boolean; error?: string }>;
	stopJupyter: () => Promise<{ success: boolean }>;
	checkJupyterStatus: () => Promise<boolean>;
	executeJupyterCode: (
		code: string
	) => Promise<{ success: boolean; output?: string; error?: string }>;

	showOpenDialog: (options: any) => Promise<any>;
	showSaveDialog: (options: any) => Promise<any>;

	storeGet: (key: string) => Promise<any>;
	storeSet: (key: string, value: any) => Promise<boolean>;

	bioragQuery: (query: any) => Promise<any>;

	onBioRAGLog: (callback: (data: string) => void) => void;
	onBioRAGError: (callback: (data: string) => void) => void;
	onJupyterLog: (callback: (data: string) => void) => void;
	onJupyterReady: (
		callback: (data: { url: string; token: string }) => void
	) => void;
	onJupyterError: (callback: (data: string) => void) => void;

	onSetWorkspace: (callback: (workspacePath: string) => void) => void;
	onTriggerOpenWorkspace: (callback: () => void) => void;

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
