// Centralized workspace path logic for consistent venv detection across the app

export interface WorkspacePathOptions {
	filePath?: string | null;
	currentWorkspace?: string | null;
}

/**
 * Centralized workspace path detection logic.
 * For notebook files, always use the notebook's directory to ensure venvs are found/created 
 * in analysis folders where notebooks are located.
 */
export function findWorkspacePath(options: WorkspacePathOptions): string | undefined {
	const { filePath, currentWorkspace } = options;
	
	const fileDirectory = filePath?.includes("/")
		? filePath.substring(0, filePath.lastIndexOf("/"))
		: undefined;
	
	// For notebook files, always use the notebook's directory
	// This ensures venvs are found/created in analysis folders where notebooks are located
	if (filePath?.endsWith(".ipynb") && fileDirectory) {
		return fileDirectory;
	}
	
	// For non-notebook files, use the previous logic
	if (fileDirectory) {
		// If there's no global workspace selected, use file directory
		if (!currentWorkspace) {
			return fileDirectory;
		}
		
		// If there is a global workspace, but the file is not under it, 
		// prefer the file directory
		if (!filePath?.startsWith(currentWorkspace)) {
			return fileDirectory;
		}
		
		// If the file is under the global workspace, use the global workspace
		return currentWorkspace;
	}
	
	// Fallback to global workspace if no file-specific path available
	return currentWorkspace || undefined;
}