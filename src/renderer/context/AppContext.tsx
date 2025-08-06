import React, { createContext, useContext, useReducer } from "react";

// Types from previous contexts
export interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
	isOpen?: boolean;
	children?: FileItem[];
}

export interface Message {
	id: string;
	content: string;
	isUser: boolean;
	timestamp: Date;
	files?: string[];
	status?: "pending" | "completed" | "failed";
	isStreaming?: boolean;
	analysisResult?: any;
	code?: string;
	codeLanguage?: string;
	codeTitle?: string;
	suggestions?: any; // DataTypeSuggestions from AnalysisSuggestionsService
}

// Combined state interface
interface AppState {
	// Workspace state
	currentWorkspace: string | null;
	fileTree: FileItem[];
	openFiles: string[];
	activeFile: string | null;

	// Analysis state
	bioragConnected: boolean;
	isAnalyzing: boolean;
	jupyterUrl: string | null;
	messages: Message[];
	currentMessage: string;
	isStreaming: boolean;
	analysisStatus: string;

	// UI state
	chatCollapsed: boolean;
	showChatPanel: boolean;
}

// Combined action types
type AppAction =
	// Workspace actions
	| { type: "SET_WORKSPACE"; payload: string | null }
	| { type: "SET_FILE_TREE"; payload: FileItem[] }
	| { type: "OPEN_FILE"; payload: string }
	| { type: "CLOSE_FILE"; payload: string }
	| { type: "FORCE_CLOSE_FILE"; payload: string }
	| { type: "SET_ACTIVE_FILE"; payload: string | null }

	// Analysis actions
	| { type: "SET_BIORAG_CONNECTED"; payload: boolean }
	| { type: "SET_ANALYZING"; payload: boolean }
	| { type: "SET_JUPYTER_URL"; payload: string | null }
	| { type: "ADD_MESSAGE"; payload: Omit<Message, "id" | "timestamp"> & { id?: string } }
	| {
			type: "UPDATE_MESSAGE";
			payload: { id: string; updates: Partial<Message> };
	  }
	| { type: "SET_CURRENT_MESSAGE"; payload: string }
	| { type: "SET_STREAMING"; payload: boolean }
	| { type: "SET_CHAT_MESSAGES"; payload: Message[] }
	| { type: "SET_ANALYSIS_STATUS"; payload: string }

	// UI actions
	| { type: "SET_CHAT_COLLAPSED"; payload: boolean }
	| { type: "SET_SHOW_CHAT_PANEL"; payload: boolean };

const initialState: AppState = {
	// Workspace state
	currentWorkspace: null,
	fileTree: [],
	openFiles: [],
	activeFile: null,

	// Analysis state
	bioragConnected: false,
	isAnalyzing: false,
	jupyterUrl: null,
	messages: [],
	currentMessage: "",
	isStreaming: false,
	analysisStatus: "",

	// UI state
	chatCollapsed: false,
	showChatPanel: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		// Workspace actions
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

		case "FORCE_CLOSE_FILE":
			const forceClosedFiles = state.openFiles.filter(
				(f) => f !== action.payload
			);
			return {
				...state,
				openFiles: forceClosedFiles,
				activeFile:
					state.activeFile === action.payload
						? forceClosedFiles.length > 0
							? forceClosedFiles[forceClosedFiles.length - 1]
							: null
						: state.activeFile,
			};

		case "SET_ACTIVE_FILE":
			return { ...state, activeFile: action.payload };

		// Analysis actions
		case "SET_BIORAG_CONNECTED":
			return { ...state, bioragConnected: action.payload };

		case "SET_ANALYZING":
			return { ...state, isAnalyzing: action.payload };

		case "SET_JUPYTER_URL":
			return { ...state, jupyterUrl: action.payload };

		case "ADD_MESSAGE":
			const newMessage: Message = {
				...action.payload,
				id: action.payload.id || Math.random().toString(36).substring(7),
				timestamp: new Date(),
			};
			return { ...state, messages: [...state.messages, newMessage] };

		case "UPDATE_MESSAGE":
			return {
				...state,
				messages: state.messages.map((message) =>
					message.id === action.payload.id
						? { ...message, ...action.payload.updates }
						: message
				),
			};

		case "SET_CURRENT_MESSAGE":
			return { ...state, currentMessage: action.payload };

		case "SET_STREAMING":
			return { ...state, isStreaming: action.payload };

		case "SET_CHAT_MESSAGES":
			return { ...state, messages: action.payload };

		case "SET_ANALYSIS_STATUS":
			return { ...state, analysisStatus: action.payload };

		// UI actions
		case "SET_CHAT_COLLAPSED":
			return { ...state, chatCollapsed: action.payload };

		case "SET_SHOW_CHAT_PANEL":
			return { ...state, showChatPanel: action.payload };

		default:
			return state;
	}
}

const AppContext = createContext<{
	state: AppState;
	dispatch: React.Dispatch<AppAction>;
} | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [state, dispatch] = useReducer(appReducer, initialState);

	return (
		<AppContext.Provider value={{ state, dispatch }}>
			{children}
		</AppContext.Provider>
	);
};

export const useAppContext = () => {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useAppContext must be used within an AppProvider");
	}
	return context;
};

// Convenience hooks for specific state sections
export const useWorkspaceContext = () => {
	const { state, dispatch } = useAppContext();
	return {
		state: {
			currentWorkspace: state.currentWorkspace,
			fileTree: state.fileTree,
			openFiles: state.openFiles,
			activeFile: state.activeFile,
		},
		dispatch,
	};
};

export const useAnalysisContext = () => {
	const { state, dispatch } = useAppContext();
	return {
		state: {
			bioragConnected: state.bioragConnected,
			isAnalyzing: state.isAnalyzing,
			jupyterUrl: state.jupyterUrl,
			messages: state.messages,
			currentMessage: state.currentMessage,
			isStreaming: state.isStreaming,
			analysisStatus: state.analysisStatus,
		},
		dispatch,
	};
};

export const useUIContext = () => {
	const { state, dispatch } = useAppContext();
	return {
		state: {
			chatCollapsed: state.chatCollapsed,
			showChatPanel: state.showChatPanel,
		},
		dispatch,
	};
};
