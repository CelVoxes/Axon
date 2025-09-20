// Unified Electron client that gracefully handles both raw IPC returns
// and wrapped { success, data } shapes used elsewhere in the app.

type DirectoryEntry = { name: string; isDirectory: boolean; path: string };

function hasDataEnvelope(x: any): x is { success: boolean; data: any } {
	return x && typeof x === "object" && "success" in x && "data" in x;
}

function hasSuccessOnly(x: any): x is { success: boolean } {
	return x && typeof x === "object" && "success" in x && !("data" in x);
}

export const ElectronClient = {
	async readFile(filePath: string): Promise<string> {
		const res: any = await (window as any).electronAPI.readFile(filePath);
		return hasDataEnvelope(res) ? (res.data as string) : (res as string);
	},

	async writeFile(filePath: string, content: string): Promise<boolean> {
		const res: any = await (window as any).electronAPI.writeFile(
			filePath,
			content
		);
		if (hasDataEnvelope(res)) return Boolean(res.data);
		if (hasSuccessOnly(res)) return Boolean(res.success);
		return Boolean(res);
	},

	async createDirectory(dirPath: string): Promise<boolean> {
		const res: any = await (window as any).electronAPI.createDirectory(dirPath);
		if (hasDataEnvelope(res)) return Boolean(res.data);
		if (hasSuccessOnly(res)) return Boolean(res.success);
		return Boolean(res);
	},

	async directoryExists(dirPath: string): Promise<boolean> {
		const res: any = await (window as any).electronAPI.directoryExists(dirPath);
		if (hasDataEnvelope(res)) return Boolean(res.data);
		return Boolean(res);
	},

	async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
		const res: any = await (window as any).electronAPI.listDirectory(dirPath);
		if (hasDataEnvelope(res)) return (res.data as DirectoryEntry[]) ?? [];
		return (res as DirectoryEntry[]) ?? [];
	},

	async getFileInfo(filePath: string): Promise<{
		size: number;
		created: string | Date;
		modified: string | Date;
		isDirectory: boolean;
	}> {
		const res: any = await (window as any).electronAPI.getFileInfo(filePath);
		if (hasDataEnvelope(res)) return res.data as any;
		return res as any;
	},

	async deleteFile(filePath: string): Promise<boolean> {
		const res: any = await (window as any).electronAPI.deleteFile(filePath);
		if (hasSuccessOnly(res)) return Boolean(res.success);
		return Boolean(res);
	},

	async deleteDirectory(dirPath: string): Promise<boolean> {
		const res: any = await (window as any).electronAPI.deleteDirectory(dirPath);
		if (hasSuccessOnly(res)) return Boolean(res.success);
		return Boolean(res);
	},

	async startJupyter(
		workingDir: string
	): Promise<{ success: boolean; url?: string; error?: string }> {
		const res: any = await (window as any).electronAPI.startJupyter(workingDir);
		return res;
	},

	async stopJupyter(): Promise<{ success: boolean }> {
		const res: any = await (window as any).electronAPI.stopJupyter();
		return res;
	},

	async checkJupyterStatus(): Promise<boolean> {
		const res: any = await (window as any).electronAPI.checkJupyterStatus();
		if (hasDataEnvelope(res)) return Boolean(res.data);
		return Boolean(res);
	},

	async executeJupyterCode(
		code: string,
		workspacePath?: string,
		executionId?: string,
		language: "python" | "r" = "python"
	): Promise<{ success: boolean; output?: string; error?: string }> {
		const res: any = await (window as any).electronAPI.executeJupyterCode(
			code,
			workspacePath,
			executionId,
			language
		);
		return res;
	},

	async createVirtualEnv(workspacePath: string): Promise<any> {
		const res: any = await (window as any).electronAPI.createVirtualEnv(
			workspacePath
		);
		if (hasDataEnvelope(res)) return res.data;
		return res;
	},

	async installPackages(
		workspacePath: string,
		packages: string[]
	): Promise<any> {
		const res: any = await (window as any).electronAPI.installPackages(
			workspacePath,
			packages
		);
		if (hasDataEnvelope(res)) return res.data;
		return res;
	},

	async interruptJupyter(
		workspacePath?: string
	): Promise<{ success: boolean; error?: string }> {
		const res: any = await (window as any).electronAPI.interruptJupyter?.(
			workspacePath
		);
		return res || { success: false, error: "interrupt not supported" };
	},
};
