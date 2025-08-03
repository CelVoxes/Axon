import React, { createContext, useContext, useReducer } from "react";

export interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
	isOpen?: boolean;
	children?: FileItem[];
}

interface WorkspaceState {
	currentWorkspace: string | null;
	fileTree: FileItem[];
	openFiles: string[];
	activeFile: string | null;
}

type WorkspaceAction =
	| { type: "SET_WORKSPACE"; payload: string | null }
	| { type: "SET_FILE_TREE"; payload: FileItem[] }
	| { type: "OPEN_FILE"; payload: string }
	| { type: "CLOSE_FILE"; payload: string }
	| { type: "SET_ACTIVE_FILE"; payload: string | null };

const initialState: WorkspaceState = {
	currentWorkspace: null,
	fileTree: [],
	openFiles: [],
	activeFile: null,
};

function workspaceReducer(
	state: WorkspaceState,
	action: WorkspaceAction
): WorkspaceState {
	switch (action.type) {
		case "SET_WORKSPACE":
			return {
				...state,
				currentWorkspace: action.payload,
				openFiles: [],
				activeFile: null,
				fileTree: [],
			};

		case "SET_FILE_TREE":
			return { ...state, fileTree: action.payload };

		case "OPEN_FILE":
			if (!state.openFiles.includes(action.payload)) {
				return {
					...state,
					openFiles: [...state.openFiles, action.payload],
					activeFile: action.payload,
				};
			}
			return { ...state, activeFile: action.payload };

		case "CLOSE_FILE":
			const newOpenFiles = state.openFiles.filter((f) => f !== action.payload);
			return {
				...state,
				openFiles: newOpenFiles,
				activeFile:
					state.activeFile === action.payload
						? newOpenFiles.length > 0
							? newOpenFiles[newOpenFiles.length - 1]
							: null
						: state.activeFile,
			};

		case "SET_ACTIVE_FILE":
			return { ...state, activeFile: action.payload };

		default:
			return state;
	}
}

const WorkspaceContext = createContext<{
	state: WorkspaceState;
	dispatch: React.Dispatch<WorkspaceAction>;
} | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [state, dispatch] = useReducer(workspaceReducer, initialState);

	return (
		<WorkspaceContext.Provider value={{ state, dispatch }}>
			{children}
		</WorkspaceContext.Provider>
	);
};

export const useWorkspaceContext = () => {
	const context = useContext(WorkspaceContext);
	if (!context) {
		throw new Error(
			"useWorkspaceContext must be used within a WorkspaceProvider"
		);
	}
	return context;
};
