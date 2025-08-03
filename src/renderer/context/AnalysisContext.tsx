import React, { createContext, useContext, useReducer } from "react";

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
}

interface AnalysisState {
	bioragConnected: boolean;
	isAnalyzing: boolean;
	jupyterUrl: string | null;
	messages: Message[];
	currentMessage: string;
	isStreaming: boolean;
	analysisStatus: string;
}

type AnalysisAction =
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
	| { type: "SET_CHAT_MESSAGES"; payload: Message[] }
	| { type: "SET_ANALYSIS_STATUS"; payload: string };

const initialState: AnalysisState = {
	bioragConnected: false,
	isAnalyzing: false,
	jupyterUrl: null,
	messages: [],
	currentMessage: "",
	isStreaming: false,
	analysisStatus: "",
};

function analysisReducer(
	state: AnalysisState,
	action: AnalysisAction
): AnalysisState {
	switch (action.type) {
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

		case "SET_ANALYSIS_STATUS":
			return { ...state, analysisStatus: action.payload };

		default:
			return state;
	}
}

const AnalysisContext = createContext<{
	state: AnalysisState;
	dispatch: React.Dispatch<AnalysisAction>;
} | null>(null);

export const AnalysisProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [state, dispatch] = useReducer(analysisReducer, initialState);

	return (
		<AnalysisContext.Provider value={{ state, dispatch }}>
			{children}
		</AnalysisContext.Provider>
	);
};

export const useAnalysisContext = () => {
	const context = useContext(AnalysisContext);
	if (!context) {
		throw new Error(
			"useAnalysisContext must be used within an AnalysisProvider"
		);
	}
	return context;
};
