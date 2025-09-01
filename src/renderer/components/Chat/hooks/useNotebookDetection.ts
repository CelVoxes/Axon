import { useState, useEffect } from 'react';

/**
 * Hook for reliable notebook detection that avoids race conditions
 * Replaces unsafe DOM fallback queries with proper state management
 */
export const useNotebookDetection = (workspaceState: any) => {
	const [notebookFile, setNotebookFile] = useState<string | null>(null);
	const [isDetecting, setIsDetecting] = useState(false);

	useEffect(() => {
		setIsDetecting(true);
		
		// Small delay to handle workspace state updates
		const detectTimeout = setTimeout(() => {
			try {
				const activeFile = workspaceState.activeFile as string | null;
				const openFiles = (workspaceState.openFiles || []) as string[];

				console.log('🔬 Notebook detection - state check:', {
					activeFile,
					openFiles,
					currentWorkspace: workspaceState.currentWorkspace
				});

				// Primary detection: active file
				if (activeFile && typeof activeFile === 'string' && activeFile.endsWith('.ipynb')) {
					console.log('✅ Notebook found via activeFile:', activeFile);
					setNotebookFile(activeFile);
					setIsDetecting(false);
					return;
				}

				// Secondary detection: open files
				const notebookInOpen = openFiles.find((f) => 
					typeof f === 'string' && f.endsWith('.ipynb')
				);

				if (notebookInOpen) {
					console.log('✅ Notebook found via openFiles:', notebookInOpen);
					setNotebookFile(notebookInOpen);
					setIsDetecting(false);
					return;
				}

				// No notebook found
				console.log('📂 No notebook detected in current workspace state');
				setNotebookFile(null);
				setIsDetecting(false);

			} catch (error) {
				console.warn('Notebook detection failed:', error);
				setNotebookFile(null);
				setIsDetecting(false);
			}
		}, 50); // Small delay to handle state sync

		return () => clearTimeout(detectTimeout);
	}, [
		workspaceState.activeFile, 
		workspaceState.openFiles, 
		workspaceState.currentWorkspace
	]);

	return {
		notebookFile,
		isNotebookOpen: Boolean(notebookFile),
		isDetecting
	};
};