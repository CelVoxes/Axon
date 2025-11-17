import React, {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import { electronAPI } from "../utils/electronAPI";

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
	// Finalized duration for reasoning/"Thought" messages (in seconds). Used to keep
	// the displayed timer stable across reloads once streaming is complete.
	reasoningSeconds?: number;
}

export interface ChecklistSummary {
	summary: string;
	lines: string[];
	completed: number;
	total: number;
	skipped: number;
	next?: string | null;
}

export interface ChatSessionMeta {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lastMessagePreview?: string;
}

// Combined state interface
interface AppState {
	// Workspace state
	currentWorkspace: string | null;
	fileTree: FileItem[];
	openFiles: string[];
	activeFile: string | null;
	/** Files with unsaved changes (by absolute path) */
	unsavedFiles: Set<string>;

	// Analysis state
	bioragConnected: boolean;
	isAnalyzing: boolean;
	jupyterUrl: string | null;
	messages: Message[];
	currentMessage: string;
	isStreaming: boolean;
	analysisStatus: string;
	checklistSummary: ChecklistSummary | null;

	// UI state
	chatCollapsed: boolean;
	showChatPanel: boolean;
	showSidebar: boolean;

	// Chat sessions state
	activeChatSessionId: string | null;
	chatSessions: ChatSessionMeta[];
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
	| { type: "SET_FILE_DIRTY"; payload: { filePath: string; dirty: boolean } }

	// Analysis actions
	| { type: "SET_BIORAG_CONNECTED"; payload: boolean }
	| { type: "SET_ANALYZING"; payload: boolean }
	| { type: "SET_JUPYTER_URL"; payload: string | null }
	| {
			type: "ADD_MESSAGE";
			payload: Omit<Message, "id" | "timestamp"> & { id?: string };
	  }
	| {
			type: "UPDATE_MESSAGE";
			payload: { id: string; updates: Partial<Message> };
	  }
	| { type: "SET_CURRENT_MESSAGE"; payload: string }
	| { type: "SET_STREAMING"; payload: boolean }
	| { type: "SET_CHAT_MESSAGES"; payload: Message[] }
	| { type: "SET_ANALYSIS_STATUS"; payload: string }
	| { type: "SET_CHECKLIST_SUMMARY"; payload: ChecklistSummary | null }

	// UI actions
	| { type: "SET_CHAT_COLLAPSED"; payload: boolean }
	| { type: "SET_SHOW_CHAT_PANEL"; payload: boolean }
	| { type: "SET_SHOW_SIDEBAR"; payload: boolean }

	// Chat sessions actions
	| { type: "SET_CHAT_SESSIONS"; payload: ChatSessionMeta[] }
	| { type: "SET_ACTIVE_CHAT_SESSION"; payload: string | null }
	| { type: "NEW_CHAT_SESSION"; payload?: { title?: string } };

const initialState: AppState = {
	// Workspace state
	currentWorkspace: null,
	fileTree: [],
	openFiles: [],
	activeFile: null,
	unsavedFiles: new Set<string>(),

	// Analysis state
	bioragConnected: false,
	isAnalyzing: false,
	jupyterUrl: null,
	messages: [],
	currentMessage: "",
	isStreaming: false,
	analysisStatus: "",
	checklistSummary: null,

	// UI state
	chatCollapsed: false,
	showChatPanel: false,
	showSidebar: true,

	// Chat sessions state
	activeChatSessionId: null,
	chatSessions: [],
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
				unsavedFiles: new Set<string>(),
				// Clear chat-related state immediately on workspace switch; it will be
				// restored (or stay empty) by the loader effect below.
				messages: [],
				currentMessage: "",
				isStreaming: false,
				analysisStatus: "",
				checklistSummary: null,
			};

		case "SET_FILE_TREE":
			return { ...state, fileTree: action.payload };

		case "OPEN_FILE":
			const updatedOpenFiles = !state.openFiles.includes(action.payload)
				? [...state.openFiles, action.payload]
				: state.openFiles;

			// Persist updated open files list if workspace is active
			if (state.currentWorkspace && updatedOpenFiles.length > 0) {
				const openFilesKey = `workspace:openFiles:${state.currentWorkspace}`;
				electronAPI.storeSet(openFilesKey, updatedOpenFiles).catch(() => {
					// ignore persistence errors
				});
			}

			return {
				...state,
				openFiles: updatedOpenFiles,
				activeFile: action.payload,
			};

		case "CLOSE_FILE":
			const newOpenFiles = state.openFiles.filter((f) => f !== action.payload);
			// Remove from unsaved set when closing
			const nextUnsaved = new Set(state.unsavedFiles);
			nextUnsaved.delete(action.payload);

			// Persist updated open files list if workspace is active
			if (state.currentWorkspace && newOpenFiles.length >= 0) {
				const openFilesKey = `workspace:openFiles:${state.currentWorkspace}`;
				electronAPI.storeSet(openFilesKey, newOpenFiles).catch(() => {
					// ignore persistence errors
				});
			}

			return {
				...state,
				openFiles: newOpenFiles,
				unsavedFiles: nextUnsaved,
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
			const unsavedAfterForce = new Set(state.unsavedFiles);
			unsavedAfterForce.delete(action.payload);
			return {
				...state,
				openFiles: forceClosedFiles,
				unsavedFiles: unsavedAfterForce,
				activeFile:
					state.activeFile === action.payload
						? forceClosedFiles.length > 0
							? forceClosedFiles[forceClosedFiles.length - 1]
							: null
						: state.activeFile,
			};

		case "SET_ACTIVE_FILE":
			// Ensure active file is also in openFiles array (especially important for .ipynb files)
			const newActiveFile = action.payload;
			const shouldAddToOpenFiles =
				newActiveFile && !state.openFiles.includes(newActiveFile);
			return {
				...state,
				activeFile: newActiveFile,
				openFiles: shouldAddToOpenFiles
					? [...state.openFiles, newActiveFile]
					: state.openFiles,
			};

		case "SET_FILE_DIRTY": {
			const { filePath, dirty } = action.payload;
			const next = new Set(state.unsavedFiles);
			if (dirty) next.add(filePath);
			else next.delete(filePath);
			// Avoid unnecessary state churn
			const same =
				next.size === state.unsavedFiles.size &&
				[...next].every((s) => state.unsavedFiles.has(s));
			if (same) return state;
			return { ...state, unsavedFiles: next };
		}

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

		case "SET_CHECKLIST_SUMMARY":
			return { ...state, checklistSummary: action.payload };

		// UI actions
		case "SET_CHAT_COLLAPSED":
			return { ...state, chatCollapsed: action.payload };

		case "SET_SHOW_CHAT_PANEL":
			return { ...state, showChatPanel: action.payload };

		case "SET_SHOW_SIDEBAR":
			return { ...state, showSidebar: action.payload };

		// Chat sessions actions
		case "SET_CHAT_SESSIONS":
			return { ...state, chatSessions: action.payload };

		case "SET_ACTIVE_CHAT_SESSION":
			return { ...state, activeChatSessionId: action.payload };

		case "NEW_CHAT_SESSION": {
			// If the current active session is already empty, don't create another
			if (state.activeChatSessionId && state.messages.length === 0) {
				return state;
			}
			const nowIso = new Date().toISOString();
			const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const title = action.payload?.title || "New Chat";
			const newMeta: ChatSessionMeta = {
				id,
				title,
				createdAt: nowIso,
				updatedAt: nowIso,
				lastMessagePreview: "",
			};
			return {
				...state,
				activeChatSessionId: id,
				chatSessions: [newMeta, ...state.chatSessions],
				messages: [],
				checklistSummary: null,
			};
		}

		default:
			return state;
	}
}

const AppContext = createContext<{
	state: AppState;
	dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Fine-grained slice contexts to reduce unnecessary re-renders
const WorkspaceContext = createContext<{
	state: Pick<
		AppState,
		| "currentWorkspace"
		| "fileTree"
		| "openFiles"
		| "activeFile"
		| "unsavedFiles"
	>;
	dispatch: React.Dispatch<AppAction>;
} | null>(null);

const AnalysisContext = createContext<{
	state: Pick<
		AppState,
		| "bioragConnected"
		| "isAnalyzing"
		| "jupyterUrl"
		| "messages"
		| "currentMessage"
		| "isStreaming"
		| "analysisStatus"
		| "activeChatSessionId"
		| "chatSessions"
		| "checklistSummary"
	>;
	dispatch: React.Dispatch<AppAction>;
} | null>(null);

const UIOnlyContext = createContext<{
	state: Pick<AppState, "chatCollapsed" | "showChatPanel" | "showSidebar">;
	dispatch: React.Dispatch<AppAction>;
} | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [state, dispatch] = useReducer(appReducer, initialState);
	const restoredWorkspaceRef = useRef<string | null>(null);
	const sessionSwitchingRef = useRef<boolean>(false);
	const lastPersistedSessionRef = useRef<string | null>(null);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Memoize slice states so provider values only change when relevant fields change
	const workspaceSlice = useMemo(
		() => ({
			currentWorkspace: state.currentWorkspace,
			fileTree: state.fileTree,
			openFiles: state.openFiles,
			activeFile: state.activeFile,
			unsavedFiles: state.unsavedFiles,
		}),
		[
			state.currentWorkspace,
			state.fileTree,
			state.openFiles,
			state.activeFile,
			state.unsavedFiles,
		]
	);

	const analysisSlice = useMemo(
		() => ({
			bioragConnected: state.bioragConnected,
			isAnalyzing: state.isAnalyzing,
			jupyterUrl: state.jupyterUrl,
			messages: state.messages,
			currentMessage: state.currentMessage,
			isStreaming: state.isStreaming,
			analysisStatus: state.analysisStatus,
			activeChatSessionId: state.activeChatSessionId,
			chatSessions: state.chatSessions,
			checklistSummary: state.checklistSummary,
		}),
		[
			state.bioragConnected,
			state.isAnalyzing,
			state.jupyterUrl,
			state.messages,
			state.currentMessage,
			state.isStreaming,
			state.analysisStatus,
			state.activeChatSessionId,
			state.chatSessions,
			state.checklistSummary,
		]
	);

	const uiSlice = useMemo(
		() => ({
			chatCollapsed: state.chatCollapsed,
			showChatPanel: state.showChatPanel,
			showSidebar: state.showSidebar,
		}),
		[state.chatCollapsed, state.showChatPanel, state.showSidebar]
	);

	// Bridge workspace/chat state to window for modules that are not inside React context
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			(window as any).__axonWorkspace = state.currentWorkspace || null;
			(window as any).currentWorkspace = state.currentWorkspace || null;
		} catch (_) {
			// ignore
		}
	}, [state.currentWorkspace]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const existing =
				typeof (window as any).__axonAnalysisState === "object" &&
				(window as any).__axonAnalysisState !== null
					? (window as any).__axonAnalysisState
					: {};
			existing.activeChatSessionId =
				analysisSlice.activeChatSessionId || null;
			(window as any).__axonAnalysisState = existing;
		} catch (_) {
			// ignore
		}
	}, [analysisSlice.activeChatSessionId]);

	// Note: We intentionally do not auto-open the last workspace on boot.

	// Load chat sessions, active session, and open files on workspace change (with legacy migration)
	useEffect(() => {
		(async () => {
			try {
				const ws = state.currentWorkspace;
				if (!ws) {
					dispatch({ type: "SET_CHAT_MESSAGES", payload: [] as any });
					dispatch({ type: "SET_CHAT_SESSIONS", payload: [] });
					dispatch({ type: "SET_ACTIVE_CHAT_SESSION", payload: null });
					dispatch({ type: "SET_CHECKLIST_SUMMARY", payload: null });
					return;
				}

				// Restore open files for this workspace
				const openFilesKey = `workspace:openFiles:${ws}`;
				const openFilesResult = await electronAPI.storeGet(openFilesKey);
				const persistedOpenFiles = openFilesResult?.success && Array.isArray(openFilesResult.data)
					? openFilesResult.data as string[]
					: [];

				// Restore open files by dispatching OPEN_FILE actions (but not on initial load)
				if (persistedOpenFiles.length > 0 && restoredWorkspaceRef.current !== ws) {
					// Only restore if we haven't already restored this workspace
					persistedOpenFiles.forEach(filePath => {
						dispatch({ type: "OPEN_FILE", payload: filePath });
					});

					// Set the first file as active if there was no active file set
					if (persistedOpenFiles.length > 0 && !state.activeFile) {
						dispatch({ type: "SET_ACTIVE_FILE", payload: persistedOpenFiles[0] });
					}

					// Mark this workspace as restored to avoid re-restoring on subsequent changes
					restoredWorkspaceRef.current = ws;
				}

				const sessionsKey = `chat:sessions:${ws}`;
				const activeKey = `chat:activeSession:${ws}`;
				const legacyKey = `chatHistory:${ws}`;

				const [sessionsRes, activeRes] = await Promise.all([
					electronAPI.storeGet(sessionsKey),
					electronAPI.storeGet(activeKey),
				]);

				let sessions: ChatSessionMeta[] = Array.isArray(sessionsRes?.data)
					? (sessionsRes.data as ChatSessionMeta[])
					: [];

				if (!sessions || sessions.length === 0) {
					const legacy = await electronAPI.storeGet(legacyKey);
					const legacyMessages: any[] = Array.isArray(legacy?.data)
						? (legacy!.data as any[])
						: [];
					const nowIso = new Date().toISOString();
					const id = `sess_${Date.now()}_${Math.random()
						.toString(36)
						.slice(2, 8)}`;
					const titleBase =
						legacyMessages.find((m) => m?.isUser)?.content || "New Chat";
					const title = String(titleBase).slice(0, 60) || "New Chat";
					const meta: ChatSessionMeta = {
						id,
						title,
						createdAt: nowIso,
						updatedAt: nowIso,
						lastMessagePreview: legacyMessages.length
							? String(
									legacyMessages[legacyMessages.length - 1]?.content || ""
							  ).slice(0, 140)
							: "",
					};
					sessions = [meta];
					await electronAPI.storeSet(sessionsKey, sessions);
					await electronAPI.storeSet(activeKey, id);
					const sessionKey = `chat:session:${ws}:${id}`;
					await electronAPI.storeSet(sessionKey, legacyMessages || []);
					restoredWorkspaceRef.current = ws;
					dispatch({ type: "SET_CHAT_SESSIONS", payload: sessions });
					dispatch({ type: "SET_ACTIVE_CHAT_SESSION", payload: id });
					dispatch({
						type: "SET_CHAT_MESSAGES",
						payload: (legacyMessages || []) as any,
					});
					dispatch({ type: "SET_CHECKLIST_SUMMARY", payload: null });
					return;
				}

				const activeIdRaw = activeRes?.data as string | null;
				const activeMeta = sessions.find((s) => s.id === activeIdRaw);
				const activeId = activeMeta
					? activeMeta.id
					: sessions
							.slice()
							.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0].id;

				const sessionKey = `chat:session:${ws}:${activeId}`;
				const msgsRes = await electronAPI.storeGet(sessionKey);
				const sessionData = msgsRes?.data;

				// Handle both new format (with checklist) and legacy format (messages only)
				let messages: any[] = [];
				let checklistSummary: ChecklistSummary | null = null;

				if (sessionData) {
					if (typeof sessionData === "object" && !Array.isArray(sessionData)) {
						// New format with messages and checklist
						messages = Array.isArray(sessionData.messages)
							? sessionData.messages
							: [];
						checklistSummary = sessionData.checklistSummary || null;
					} else {
						// Legacy format - just messages
						messages = Array.isArray(sessionData) ? sessionData : [];
					}
				}

				const restored = messages.map((m) => ({
					...m,
					id: m.id || Math.random().toString(36).slice(2),
					timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
				}));

				restoredWorkspaceRef.current = ws;
				dispatch({ type: "SET_CHAT_SESSIONS", payload: sessions });
				dispatch({ type: "SET_ACTIVE_CHAT_SESSION", payload: activeId });
				dispatch({ type: "SET_CHAT_MESSAGES", payload: restored as any });
				dispatch({ type: "SET_CHECKLIST_SUMMARY", payload: checklistSummary });
			} catch (e) {
				console.error("Error loading workspace sessions:", e);
				dispatch({ type: "SET_CHAT_MESSAGES", payload: [] as any });
				dispatch({ type: "SET_CHAT_SESSIONS", payload: [] });
				dispatch({ type: "SET_ACTIVE_CHAT_SESSION", payload: null });
				dispatch({ type: "SET_CHECKLIST_SUMMARY", payload: null });
			}
		})();
	}, [state.currentWorkspace]);

	// Persist active session messages per workspace and update session metadata
	// Debounced to avoid blocking the UI during rapid updates
	useEffect(() => {
		const ws = state.currentWorkspace;
		const activeId = state.activeChatSessionId;
		if (!ws || !activeId) return;

		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
			persistTimerRef.current = null;
		}

		persistTimerRef.current = setTimeout(async () => {
			persistTimerRef.current = null;

			try {
				if (!state.currentWorkspace || !state.activeChatSessionId) return;
				if (restoredWorkspaceRef.current !== state.currentWorkspace) return;
				if (sessionSwitchingRef.current) return;

				const sessionKey = `chat:session:${state.currentWorkspace}:${state.activeChatSessionId}`;
				const sessionData = {
					messages: state.messages,
					checklistSummary: state.checklistSummary,
				};
				await electronAPI.storeSet(sessionKey, sessionData);
				// Keep legacy key updated for backwards compatibility
				const legacyKey = `chatHistory:${state.currentWorkspace}`;
				await electronAPI.storeSet(legacyKey, state.messages);

				const lastPreview = state.messages.length
					? String(
							state.messages[state.messages.length - 1]?.content || ""
					  ).slice(0, 140)
					: "";
				const firstUser = state.messages.find((m) => m.isUser)?.content || "";
				const nextSessions = state.chatSessions.map((s) =>
					s.id === state.activeChatSessionId
						? {
								...s,
								title:
									s.title && s.title !== "New Chat"
										? s.title
										: (firstUser || s.title || "New Chat").slice(0, 60),
								updatedAt: new Date().toISOString(),
								lastMessagePreview: lastPreview,
						  }
						: s
				);
				const sessionsKey = `chat:sessions:${state.currentWorkspace}`;
				await electronAPI.storeSet(sessionsKey, nextSessions);
				if (
					JSON.stringify(nextSessions) !== JSON.stringify(state.chatSessions)
				) {
					dispatch({ type: "SET_CHAT_SESSIONS", payload: nextSessions });
				}
			} catch (e) {
				// ignore persistence errors
			}
		}, 600);

		return () => {
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
				persistTimerRef.current = null;
			}
		};
	}, [
		state.currentWorkspace,
		state.activeChatSessionId,
		state.messages,
		state.checklistSummary,
		state.chatSessions,
	]);

	// Persist active session id and sessions list when they change
	useEffect(() => {
		(async () => {
			try {
				const ws = state.currentWorkspace;
				if (!ws) return;
				const activeKey = `chat:activeSession:${ws}`;
				await electronAPI.storeSet(activeKey, state.activeChatSessionId);
				const sessionsKey = `chat:sessions:${ws}`;
				await electronAPI.storeSet(sessionsKey, state.chatSessions);
			} catch (e) {
				// ignore
			}
		})();
	}, [state.currentWorkspace, state.activeChatSessionId, state.chatSessions, state.checklistSummary]);

	// Persist open files when they change
	useEffect(() => {
		(async () => {
			try {
				const ws = state.currentWorkspace;
				if (!ws || state.openFiles.length === 0) return;

				const openFilesKey = `workspace:openFiles:${ws}`;
				await electronAPI.storeSet(openFilesKey, state.openFiles);
			} catch (e) {
				// ignore persistence errors
			}
		})();
	}, [state.currentWorkspace, state.openFiles]);

	// Load messages when active chat session changes
	useEffect(() => {
		(async () => {
			const ws = state.currentWorkspace;
			const activeId = state.activeChatSessionId;
			if (!ws || !activeId) {
				return;
			}

			// Set switching flag
			sessionSwitchingRef.current = true;

			let msgsRes: any = null;

			try {
				const sessionKey = `chat:session:${ws}:${activeId}`;
				msgsRes = await electronAPI.storeGet(sessionKey);
				const sessionData = msgsRes?.data;

				// Handle both new format (with checklist) and legacy format (messages only)
				let messages: any[] = [];
				let checklistSummary: ChecklistSummary | null = null;

				if (sessionData) {
					if (typeof sessionData === "object" && !Array.isArray(sessionData)) {
						// New format with messages and checklist
						messages = Array.isArray(sessionData.messages)
							? sessionData.messages
							: [];
						checklistSummary = sessionData.checklistSummary || null;
					} else {
						// Legacy format - just messages
						messages = Array.isArray(sessionData) ? sessionData : [];
					}

					const restored = messages.map((m) => ({
						...m,
						id: m.id || Math.random().toString(36).slice(2),
						timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
					}));

					dispatch({ type: "SET_CHAT_MESSAGES", payload: restored as any });
					dispatch({
						type: "SET_CHECKLIST_SUMMARY",
						payload: checklistSummary,
					});
				}

				// Allow persistence for this session after loading is complete
				setTimeout(() => {
					sessionSwitchingRef.current = false;
					lastPersistedSessionRef.current = activeId;
				}, 100);
			} catch (e) {
				console.error("Error loading chat session:", e);
				// Only clear messages if we actually have a session to load from
				// and the session data was not successfully loaded
				if (activeId && msgsRes?.data) {
					dispatch({ type: "SET_CHAT_MESSAGES", payload: [] as any });
					// Don't clear checklist on error - it should already be loaded from workspace loader
				}
				sessionSwitchingRef.current = false;
			}
		})();
	}, [state.currentWorkspace, state.activeChatSessionId]);

	return (
		<AppContext.Provider value={{ state, dispatch }}>
			<WorkspaceContext.Provider value={{ state: workspaceSlice, dispatch }}>
				<AnalysisContext.Provider value={{ state: analysisSlice, dispatch }}>
					<UIOnlyContext.Provider value={{ state: uiSlice, dispatch }}>
						{children}
					</UIOnlyContext.Provider>
				</AnalysisContext.Provider>
			</WorkspaceContext.Provider>
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
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error("useWorkspaceContext must be used within an AppProvider");
	}
	return ctx;
};

export const useAnalysisContext = () => {
	const ctx = useContext(AnalysisContext);
	if (!ctx) {
		throw new Error("useAnalysisContext must be used within an AppProvider");
	}
	return ctx;
};

export const useUIContext = () => {
	const ctx = useContext(UIOnlyContext);
	if (!ctx) {
		throw new Error("useUIContext must be used within an AppProvider");
	}
	return ctx;
};
