"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAppContext = exports.AppProvider = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const initialState = {
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
function appReducer(state, action) {
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
                activeFile: state.activeFile === action.payload
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
            const newMessage = {
                ...action.payload,
                id: Math.random().toString(36).substring(7),
                timestamp: new Date(),
            };
            return { ...state, messages: [...state.messages, newMessage] };
        case "UPDATE_MESSAGE":
            return {
                ...state,
                messages: state.messages.map((message) => message.id === action.payload.id
                    ? { ...message, ...action.payload.updates }
                    : message),
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
const AppContext = (0, react_1.createContext)(null);
const AppProvider = ({ children, }) => {
    const [state, dispatch] = (0, react_1.useReducer)(appReducer, initialState);
    return ((0, jsx_runtime_1.jsx)(AppContext.Provider, { value: { state, dispatch }, children: children }));
};
exports.AppProvider = AppProvider;
const useAppContext = () => {
    const context = (0, react_1.useContext)(AppContext);
    if (!context) {
        throw new Error("useAppContext must be used within an AppProvider");
    }
    return context;
};
exports.useAppContext = useAppContext;
