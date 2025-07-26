import React, { createContext, useContext, useReducer } from "react";

interface Message {
	id: string;
	content: string;
	isUser: boolean;
	timestamp: Date;
	files?: string[];
	status?: "pending" | "completed" | "failed";
	isStreaming?: boolean;
	analysisResult?: any;
}

interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
	isOpen?: boolean;
	children?: FileItem[];
}

interface AppState {
	currentWorkspace: string | null;
	fileTree: FileItem[];
	openFiles: string[];
	activeFile: string | null;
	bioragConnected: boolean;
	isAnalyzing: boolean;
	jupyterUrl: string | null;
	messages: Message[];
	currentMessage: string;
	isStreaming: boolean;
}

type AppAction =
	| { type: "SET_WORKSPACE"; payload: string | null }
	| { type: "SET_FILE_TREE"; payload: FileItem[] }
	| { type: "OPEN_FILE"; payload: string }
	| { type: "CLOSE_FILE"; payload: string }
	| { type: "SET_ACTIVE_FILE"; payload: string | null }
	| { type: "SET_BIORAG_CONNECTED"; payload: boolean }
	| { type: "SET_ANALYZING"; payload: boolean }
	| { type: "SET_JUPYTER_URL"; payload: string | null }
	| { type: "ADD_MESSAGE"; payload: Omit<Message, "id" | "timestamp"> }
	| {
			type: "UPDATE_MESSAGE";
			payload: { id: string; updates: Partial<Message> };
	  }
	| { type: "SET_CURRENT_MESSAGE"; payload: string }
	| { type: "SET_STREAMING"; payload: boolean }
	| { type: "SET_CHAT_MESSAGES"; payload: Message[] };

const initialState: AppState = {
	currentWorkspace: null,
	fileTree: [],
	openFiles: [],
	activeFile: null,
	bioragConnected: false,
	isAnalyzing: false,
	jupyterUrl: null,
	messages: [],
	currentMessage: "",
	isStreaming: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		case "SET_WORKSPACE":
			return { ...state, currentWorkspace: action.payload };

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

		case "SET_BIORAG_CONNECTED":
			return { ...state, bioragConnected: action.payload };

		case "SET_ANALYZING":
			return { ...state, isAnalyzing: action.payload };

		case "SET_JUPYTER_URL":
			return { ...state, jupyterUrl: action.payload };

		case "ADD_MESSAGE":
			const newMessage: Message = {
				...action.payload,
				id: Math.random().toString(36).substring(7),
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
