// Centralized workspace logic for opening and managing workspaces
export async function openWorkspace(
	path: string,
	dispatch: React.Dispatch<any>,
	setRecentWorkspaces: React.Dispatch<React.SetStateAction<string[]>>
) {
	dispatch({ type: "SET_WORKSPACE", payload: path });
	setRecentWorkspaces((prev: string[]) => {
		const updated = [path, ...prev.filter((w: string) => w !== path)].slice(
			0,
			3
		);
		window.electronAPI.storeSet("recentWorkspaces", updated);
		return updated;
	});
	dispatch({ type: "SET_FILE_TREE", payload: [] });
	dispatch({ type: "SET_ACTIVE_FILE", payload: null });
}

// Centralized file open logic
export function openFile(filePath: string, dispatch: React.Dispatch<any>) {
	dispatch({ type: "OPEN_FILE", payload: filePath });
}

// Centralized notebook step execution logic
export async function runNotebookStep(
	stepId: string,
	code: string,
	update: (payload: { output: string | null; error: string | null }) => void,
	workspacePath?: string
) {
	try {
		console.log(
			`Executing notebook step ${stepId} with code:`,
			code.substring(0, 100) + "..."
		);

		// @ts-ignore
		const result = await window.electronAPI.executeJupyterCode(
			code,
			workspacePath
		);

		console.log(`Jupyter execution result:`, result);

		if (result.success) {
			update({ output: result.output || null, error: null });
		} else {
			update({ output: null, error: result.error || "Execution failed" });
		}
	} catch (error: unknown) {
		console.error(`Error executing notebook step ${stepId}:`, error);
		const errMsg = error instanceof Error ? error.message : String(error);
		update({ output: null, error: errMsg });
	}
}

// Centralized error reporting
export function reportError(error: unknown) {
	// Optionally show a toast or dialog
	console.error(error);
}
