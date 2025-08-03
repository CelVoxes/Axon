import React, { createContext, useContext, useReducer } from "react";

interface UIState {
	chatCollapsed: boolean;
	showChatPanel: boolean;
}

type UIAction =
	| { type: "SET_CHAT_COLLAPSED"; payload: boolean }
	| { type: "SET_SHOW_CHAT_PANEL"; payload: boolean };

const initialState: UIState = {
	chatCollapsed: false,
	showChatPanel: false, // Don't show chat panel by default on starter screen
};

function uiReducer(state: UIState, action: UIAction): UIState {
	switch (action.type) {
		case "SET_CHAT_COLLAPSED":
			return { ...state, chatCollapsed: action.payload };

		case "SET_SHOW_CHAT_PANEL":
			return { ...state, showChatPanel: action.payload };

		default:
			return state;
	}
}

const UIContext = createContext<{
	state: UIState;
	dispatch: React.Dispatch<UIAction>;
} | null>(null);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [state, dispatch] = useReducer(uiReducer, initialState);

	return (
		<UIContext.Provider value={{ state, dispatch }}>
			{children}
		</UIContext.Provider>
	);
};

export const useUIContext = () => {
	const context = useContext(UIContext);
	if (!context) {
		throw new Error("useUIContext must be used within a UIProvider");
	}
	return context;
};
