import { Tooltip } from "@components/shared/Tooltip";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
	useAnalysisContext,
	useUIContext,
	useWorkspaceContext,
} from "../../context/AppContext";
import { BackendClient } from "../../services/BackendClient";
import { useDatasetSearch } from "../../hooks/useDatasetSearch";
import { findWorkspacePath } from "../../utils/WorkspaceUtils";
import { DatasetSelectionModal } from "./DatasetSelectionModal";
import { ChatMessage } from "./ChatMessage";
import {
	FiMinimize2,
	FiMaximize2,
	FiPlus,
	FiClock,
	FiX,
	FiTrash2,
} from "react-icons/fi";
import { CodeBlock } from "./shared/CodeBlock";
import { Composer, ComposerRef } from "./Composer";
import { MentionSuggestions } from "./MentionSuggestions";
import { ProcessingIndicator } from "./Status/ProcessingIndicator";
import { ValidationErrors } from "./Status/ValidationErrors";
import { SearchProgress as SearchProgressView } from "./Status/SearchProgress";
import { EnvironmentStatus } from "./Status/EnvironmentStatus";
import { AutonomousAgent } from "../../services/AutonomousAgent";
import {
	LocalDatasetRegistry,
	LocalDatasetEntry,
} from "../../services/LocalDatasetRegistry";
import { electronAPI } from "../../utils/electronAPI";

import {
	AnalysisOrchestrationService,
	DataTypeSuggestions,
} from "../../services/AnalysisOrchestrationService";
import { ExamplesComponent } from "./AnalysisSuggestionsComponent";
// EventManager already imported above; avoid duplicate imports
import { AsyncUtils } from "../../utils/AsyncUtils";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationErrorEvent,
	Dataset,
} from "../../services/types";
import { EventManager } from "../../utils/EventManager";
import { NotebookService } from "../../services/NotebookService";
import { ruffLinter } from "../../services/RuffLinter";
import { autoFixWithRuffAndLLM } from "../../services/LintAutoFixService";

// Removed duplicated local code rendering. Use shared CodeBlock instead.

// Using Message interface from AnalysisContext

// Utility function to group chat sessions by time periods
function groupSessionsByTime(sessions: any[]) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
	const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
	const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
	const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

	const groups = {
		today: [] as any[],
		yesterday: [] as any[],
		"2d ago": [] as any[],
		"3d ago": [] as any[],
		"this week": [] as any[],
		older: [] as any[],
	};

	sessions.forEach((session) => {
		const sessionDate = new Date(session.updatedAt || session.createdAt);
		const sessionDay = new Date(
			sessionDate.getFullYear(),
			sessionDate.getMonth(),
			sessionDate.getDate()
		);

		if (sessionDay.getTime() >= today.getTime()) {
			groups.today.push(session);
		} else if (sessionDay.getTime() >= yesterday.getTime()) {
			groups.yesterday.push(session);
		} else if (sessionDay.getTime() >= twoDaysAgo.getTime()) {
			groups["2d ago"].push(session);
		} else if (sessionDay.getTime() >= threeDaysAgo.getTime()) {
			groups["3d ago"].push(session);
		} else if (sessionDay.getTime() >= oneWeekAgo.getTime()) {
			groups["this week"].push(session);
		} else {
			groups.older.push(session);
		}
	});

	// Sort sessions within each group by updatedAt (most recent first)
	Object.keys(groups).forEach((key) => {
		groups[key as keyof typeof groups].sort((a, b) => {
			const aTime = new Date(a.updatedAt || a.createdAt).getTime();
			const bTime = new Date(b.updatedAt || b.createdAt).getTime();
			return bTime - aTime;
		});
	});

	return groups;
}

interface ChatPanelProps {
	className?: string;
}

// Cache for notebook paths to avoid repeated file system searches
const notebookPathCache = new Map<string, string>();
// Cache for parsed notebook content to avoid repeated file reads
const notebookContentCache = new Map<string, any>();

export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
	const { state: analysisState, dispatch: analysisDispatch } =
		useAnalysisContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();
	const { state: workspaceState } = useWorkspaceContext();
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const pendingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scheduleProcessingStop = useCallback((delayMs = 2000) => {
		if (pendingStopRef.current) clearTimeout(pendingStopRef.current);
		pendingStopRef.current = setTimeout(() => {
			setIsProcessing(false);
			setProgressMessage("");
			pendingStopRef.current = null;
		}, delayMs);
	}, []);
	const cancelProcessingStop = useCallback(() => {
		if (pendingStopRef.current) {
			clearTimeout(pendingStopRef.current);
			pendingStopRef.current = null;
		}
	}, []);
	const [progressData, setProgressData] = useState<any>(null);
	const [validationErrors, setValidationErrors] = useState<string[]>([]);
	const [validationSuccessMessage, setValidationSuccessMessage] =
		useState<string>("");
	// Suggestions disabled per request
	const [suggestionButtons, setSuggestionButtons] = useState<string[]>([]);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState("");
	const [recentMessages, setRecentMessages] = useState<string[]>([]);
	const [showAllMessages, setShowAllMessages] = useState(false);
	const [processedEvents, setProcessedEvents] = useState<Set<string>>(
		new Set()
	);
	const inputValueRef = React.useRef<string>("");
	const [agentInstance, setAgentInstance] = useState<any>(null);
	const [showVirtualEnvLog, setShowVirtualEnvLog] = useState(false);
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [currentSuggestions, setCurrentSuggestions] =
		useState<DataTypeSuggestions | null>(null);
	const localRegistryRef = useRef<LocalDatasetRegistry | null>(null);
	const [showHistoryMenu, setShowHistoryMenu] = useState<boolean>(false);
	const [showDeleteMenu, setShowDeleteMenu] = useState<boolean>(false);
	const [showExamples, setShowExamples] = useState<boolean>(false);

	// Chat mode: "Agent" (default) or "Ask"
	const [chatMode, setChatMode] = useState<"Agent" | "Ask">("Agent");

	// Global code context to track all generated code across the conversation
	const [globalCodeContext, setGlobalCodeContext] = useState<
		Map<string, string>
	>(new Map());

	// rAF-batched streaming updates for smoother UI with throttling
	const rafStateRef = useRef<{
		pending: Record<string, string>;
		scheduled: boolean;
		lastUpdate: number;
	}>({ pending: {}, scheduled: false, lastUpdate: 0 });

	const scheduleRafUpdate = useCallback(() => {
		if (rafStateRef.current.scheduled) return;

		const now = Date.now();
		const timeSinceLastUpdate = now - rafStateRef.current.lastUpdate;
		const minInterval = 100; // Slower updates to reduce flicker (10fps instead of 60fps)

		if (timeSinceLastUpdate < minInterval) {
			// Throttle updates to prevent excessive re-renders
			setTimeout(() => {
				if (!rafStateRef.current.scheduled) {
					scheduleRafUpdate();
				}
			}, minInterval - timeSinceLastUpdate);
			return;
		}

		rafStateRef.current.scheduled = true;
		requestAnimationFrame(() => {
			const pending = rafStateRef.current.pending;
			rafStateRef.current.pending = {};
			rafStateRef.current.scheduled = false;
			rafStateRef.current.lastUpdate = Date.now();

			for (const stepId of Object.keys(pending)) {
				const stream = activeStreams.current.get(stepId);
				if (!stream) continue;
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							code: pending[stepId],
							codeLanguage: "python",
						},
					},
				});
			}
			// Avoid forcing parent container scroll during streaming; inner code blocks handle it.
		});
	}, [analysisDispatch]);

	const enqueueStreamingUpdate = useCallback(
		(stepId: string, content: string) => {
			// Only update if content has actually changed to prevent flickering
			const currentPending = rafStateRef.current.pending[stepId];
			if (currentPending === content) return;

			// Also check if the content is already in the current message
			const stream = activeStreams.current.get(stepId);
			if (stream) {
				const currentMessage = analysisState.messages.find(
					(m) => m.id === stream.messageId
				);
				if (currentMessage && currentMessage.content === content) return;
			}

			rafStateRef.current.pending[stepId] = content;
			scheduleRafUpdate();
		},
		[scheduleRafUpdate, analysisState.messages]
	);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const chatContainerRef = useRef<HTMLDivElement>(null);
	const chatAutoScrollRef = useRef<boolean>(true);
	const composerRef = useRef<ComposerRef>(null);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [mentionQuery, setMentionQuery] = useState("");
	const [workspaceMentionItems, setWorkspaceMentionItems] = useState<any[]>([]);
	const [cellMentionItems, setCellMentionItems] = useState<any[]>([]);
	const [activeLocalIndex, setActiveLocalIndex] = useState<number>(-1);
	const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState<number>(-1);
	const [activeCellIndex, setActiveCellIndex] = useState<number>(-1);

	// Suggested quick mentions (e.g., open/active files) to show as chips above the composer
	const suggestedMentions = React.useMemo(() => {
		// Per user request: do not derive mentions from open files
		return [] as Array<{ label: string; alias: string }>;
	}, []);

	// Selection-based code edit context (set when user triggers Ask Chat from a notebook cell)
	interface CodeEditContext {
		filePath?: string;
		cellIndex?: number;
		language?: string;
		selectedText: string;
		fullCode?: string;
		selectionStart?: number;
		selectionEnd?: number;
		outputText?: string;
		hasErrorOutput?: boolean;
	}
	const [codeEditContext, setCodeEditContext] =
		useState<CodeEditContext | null>(null);
	const codeEditContextRef = useRef<CodeEditContext | null>(null);

	// Prefill composer when user triggers chat-edit-selection from an editor
	useEffect(() => {
		// Deduplicate rapid successive events (e.g., multiple notebooks emitting)
		let lastPayloadKey = "";
		let lastAt = 0;
		const DEDUPE_MS = 250;

		const cleanup = EventManager.createManagedListener(
			"chat-edit-selection",
			(event) => {
				const detail = event.detail || {};
				const snippet: string = String(detail.selectedText || "");
				const lang: string = String(detail.language || "python");
				const filePath: string = String(detail.filePath || "");
				const cellIndex: string = String(
					detail.cellIndex === 0 || detail.cellIndex
						? String(detail.cellIndex)
						: ""
				);
				const payloadKey = `${filePath}|${cellIndex}|${lang}|${snippet}`;
				const now = Date.now();
				if (payloadKey === lastPayloadKey && now - lastAt < DEDUPE_MS) {
					return;
				}
				lastPayloadKey = payloadKey;
				lastAt = now;

				const ctx: CodeEditContext = {
					filePath: detail.filePath,
					cellIndex: detail.cellIndex,
					language: detail.language,
					selectedText: detail.selectedText,
					fullCode: detail.fullCode,
					selectionStart: detail.selectionStart,
					selectionEnd: detail.selectionEnd,
				};
				setCodeEditContext(ctx);
				codeEditContextRef.current = ctx;
				// Ensure chat opens and is focused
				if (!uiState.showChatPanel || uiState.chatCollapsed) {
					uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
					uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
					// Focus the composer after the chat panel opens
					setTimeout(() => composerRef.current?.focus(), 100);
				} else {
					// If chat is already open, focus immediately
					composerRef.current?.focus();
				}
			}
		);
		return cleanup;
	}, [uiDispatch, uiState.showChatPanel, uiState.chatCollapsed]);

	// Prefill composer when user adds output to chat or asks to fix an error
	useEffect(() => {
		const onAddOutput = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");

			// Build a cell mention like @relative/path#N
			let alias = "";
			try {
				const wsRoot =
					findWorkspacePath({
						filePath: d.filePath || "",
						currentWorkspace: workspaceState.currentWorkspace || undefined,
					}) ||
					workspaceState.currentWorkspace ||
					"";
				const rel =
					d.filePath && wsRoot && String(d.filePath).startsWith(wsRoot)
						? String(d.filePath).slice(wsRoot.length + 1)
						: String(d.filePath || "");
				const cellNum =
					typeof d.cellIndex === "number" ? d.cellIndex + 1 : undefined;
				alias = rel ? `@${rel}${cellNum ? `#${cellNum}` : ""}` : "";
			} catch (_) {
				/* ignore */
			}

			// Add the mention and the actual output/error content for user visibility
			if (alias) {
				// Clear any existing input and start fresh with the mention
				const mentionText = alias;

				// Add the prompt and the actual output/error content
				const outputType = Boolean(d.hasError) ? "Error" : "Output";
				const outputPrompt = `\n\nPlease explain this ${outputType.toLowerCase()} from the ${lang} cell and suggest how to fix any issues:`;

				// Include the actual output/error content so user can see what they're asking about
				const outputContent = out.trim()
					? `\n\n\`\`\`\n${out.trim()}\n\`\`\``
					: "";

				const final = mentionText + " " + outputPrompt + outputContent;
				setInputValue(final);
				inputValueRef.current = final;
			} else {
				// Fallback to old behavior if no alias
				const prefix = `Please review the ${lang} cell output and fix any issues.`;
				const body = `\n\nCell: (referenced cell)\n`;
				const prefill = prefix + body;
				setInputValue(prefill);
				inputValueRef.current = prefill;
			}

			// For "Ask Chat" on output, don't auto-trigger edit mode
			// Instead, let the user have a conversation about the error/output
			// They can explicitly ask for code changes if needed

			// IMPORTANT: Clear any existing codeEditContext to prevent it from
			// getting stuck on a previous cell when user asks about a different cell
			setCodeEditContext(null);
			codeEditContextRef.current = null;

			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
				// Focus the composer after the chat panel opens
				setTimeout(() => composerRef.current?.focus(), 100);
			} else {
				// If chat is already open, focus immediately
				composerRef.current?.focus();
			}
		};
		const onFixError = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");
			const prefix = `The following ${lang} cell failed. Fix the code to resolve the error. Return only the corrected code.`;
			// Mention the cell, avoid embedding large blocks
			let alias = "";
			try {
				const wsRoot =
					findWorkspacePath({
						filePath: d.filePath || "",
						currentWorkspace: workspaceState.currentWorkspace || undefined,
					}) ||
					workspaceState.currentWorkspace ||
					"";
				const rel =
					d.filePath && wsRoot && String(d.filePath).startsWith(wsRoot)
						? String(d.filePath).slice(wsRoot.length + 1)
						: String(d.filePath || "");
				const cellNum =
					typeof d.cellIndex === "number" ? d.cellIndex + 1 : undefined;
				alias = rel ? `@${rel}${cellNum ? `#${cellNum}` : ""}` : "";
			} catch (_) {
				/* ignore */
			}
			const body = `\n\nCell: ${alias || "(referenced cell)"}\n`;
			const prefill = prefix + body;
			setInputValue(prefill);
			inputValueRef.current = prefill;
			const ctx: CodeEditContext = {
				filePath: d.filePath,
				cellIndex: d.cellIndex,
				language: d.language,
				selectedText: code,
				fullCode: code,
				selectionStart: 0,
				selectionEnd: code.length,
				outputText: out,
				hasErrorOutput: true,
			};
			// Replace any existing context with this new error-fixing context
			setCodeEditContext(ctx);
			codeEditContextRef.current = ctx;
			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
				// Focus the composer after the chat panel opens
				setTimeout(() => composerRef.current?.focus(), 100);
			} else {
				// If chat is already open, focus immediately
				composerRef.current?.focus();
			}
		};
		window.addEventListener("chat-add-output", onAddOutput as EventListener);
		window.addEventListener("chat-fix-error", onFixError as EventListener);
		return () => {
			window.removeEventListener(
				"chat-add-output",
				onAddOutput as EventListener
			);
			window.removeEventListener("chat-fix-error", onFixError as EventListener);
		};
	}, [uiDispatch, uiState.showChatPanel, uiState.chatCollapsed]);

	// Initialize local dataset registry
	useEffect(() => {
		const registry = new LocalDatasetRegistry();
		localRegistryRef.current = registry;
		registry
			.load()
			.catch((e) => console.warn("Failed to load local dataset registry", e));
	}, []);

	// Track scroll position of chat container to avoid jiggling when user scrolls up
	useEffect(() => {
		const el = chatContainerRef.current;
		if (!el) return;
		const onScroll = () => {
			// More generous threshold to keep auto-scroll active when user is near bottom
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
			chatAutoScrollRef.current = nearBottom;
		};
		el.addEventListener("scroll", onScroll);
		return () => el.removeEventListener("scroll", onScroll);
	}, []);
	// Simplified: using event system instead of complex message refs
	const activeStreams = useRef<
		Map<string, { messageId: string; accumulatedCode: string }>
	>(new Map());
	const [backendClient, setBackendClient] = useState<BackendClient | null>(
		null
	);
	useEffect(() => {
		// Get the correct backend URL from main process
		const initBackendClient = async () => {
			try {
				const backendUrl = await window.electronAPI.getBioragUrl();
				const client = new BackendClient(backendUrl);
				setBackendClient(client);
			} catch (error) {
				console.error("Failed to get backend URL, using default:", error);
				const client = new BackendClient();
				setBackendClient(client);
			}
		};
		initBackendClient();
	}, []);

	// Dataset search functionality
	const [datasetSearchState, datasetSearchActions] = useDatasetSearch(
		backendClient,
		(progress) => {
			setProgressData(progress);
			// Hook handles search progress internally
		}
	);

	// Destructure dataset search state and actions for easier access
	const {
		availableDatasets,
		selectedDatasets,
		isSearching: isDatasetSearching,
		searchProgress: datasetSearchProgress,
		showSearchDetails: showDatasetSearchDetails,
		showDatasetModal,
	} = datasetSearchState;

	const {
		searchForDatasets,
		selectDatasets,
		mergeSelectedDatasets,
		clearSearch: clearDatasetSearch,
		clearSelectedDatasets,
		clearAvailableDatasets,
		setSearchProgress: setDatasetSearchProgress,
		setShowSearchDetails: setShowDatasetSearchDetails,
		setShowDatasetModal,
	} = datasetSearchActions;

	// Analysis suggestions service
	const suggestionsService = React.useMemo(() => {
		if (!backendClient) return null;
		return new AnalysisOrchestrationService(backendClient);
	}, [backendClient]);

	// Listen for virtual environment status updates
	useEffect(() => {
		let isMounted = true;

		const handleVirtualEnvStatus = (data: any) => {
			if (!isMounted) return;
			setVirtualEnvStatus(data.status || data.message || "");
			if (data.status === "installing_package" && data.package) {
				addMessage(`Installing: ${data.package}`, false);
			} else if (data.status === "packages_installed") {
				addMessage(`${data.message}`, false);
			} else if (data.status === "existing") {
				addMessage(`♻️ ${data.message}`, false);
			} else if (data.status === "completed") {
				addMessage(`${data.message}`, false);
			} else if (data.status === "error") {
				addMessage(`${data.message}`, false);
			}
		};

		// Listen for Jupyter ready events
		const handleJupyterReady = (data: any) => {
			if (!isMounted) return;
			if (data.status === "ready") {
				addMessage(`Jupyter environment ready!`, false);
			} else if (data.status === "error") {
				addMessage(`Jupyter setup failed: ${data.message}`, false);
			} else if (data.status === "starting") {
				addMessage(`Starting Jupyter server...`, false);
			}
		};

		// Listen for Python setup status updates
		const handlePythonSetupStatus = (data: any) => {
			if (!isMounted) return;
			setVirtualEnvStatus(data.message || "");

			if (data.status === "required") {
				addMessage(`🐍 ${data.message}`, false);
				if (data.reason) {
					addMessage(`💡 ${data.reason}`, false);
				}
				addMessage(
					`📦 This is a one-time setup for optimal compatibility`,
					false
				);
			} else if (data.status === "downloading") {
				// Update status but don't spam chat with download progress
				if (data.progress && data.progress % 25 === 0) {
					addMessage(`📥 ${data.message}`, false);
				}
			} else if (data.status === "installing") {
				addMessage(`⚙️ ${data.message}`, false);
			} else if (data.status === "completed") {
				addMessage(`✅ ${data.message}`, false);
				addMessage(`🚀 Ready for data analysis with modern Python!`, false);
			} else if (data.status === "error") {
				addMessage(`❌ ${data.message}`, false);
				if (data.error) {
					addMessage(`Error details: ${data.error}`, false);
				}
				addMessage(
					`💡 You can install Python 3.11+ manually as an alternative`,
					false
				);
			}
		};

		// Listen for package installation progress updates
		const handlePackageInstallProgress = (data: any) => {
			if (!isMounted) return;

			if (data.message && data.message.trim()) {
				// Filter and format pip output messages
				const msg = data.message.trim();
				if (msg.includes("Collecting")) {
					addMessage(`📥 ${msg}`, false);
				} else if (msg.includes("Downloading")) {
					// Only show major downloads, not every chunk
					if (msg.includes(" MB") || msg.includes(" KB")) {
						addMessage(`⬇️ ${msg}`, false);
					}
				} else if (msg.includes("Installing")) {
					addMessage(`⚙️ ${msg}`, false);
				} else if (msg.includes("Successfully installed")) {
					addMessage(`✅ ${msg}`, false);
				} else if (msg.includes("ERROR") || msg.includes("Failed")) {
					addMessage(`❌ ${msg}`, false);
				}
			}
		};

		// Add event listeners
		window.addEventListener(
			"virtual-env-status",
			handleVirtualEnvStatus as EventListener
		);
		window.addEventListener(
			"jupyter-ready",
			handleJupyterReady as EventListener
		);
		window.addEventListener(
			"python-setup-status",
			handlePythonSetupStatus as EventListener
		);
		window.addEventListener(
			"package-install-progress",
			handlePackageInstallProgress as EventListener
		);

		// Cleanup
		return () => {
			isMounted = false;
			window.removeEventListener(
				"virtual-env-status",
				handleVirtualEnvStatus as EventListener
			);
			window.removeEventListener(
				"jupyter-ready",
				handleJupyterReady as EventListener
			);
			window.removeEventListener(
				"python-setup-status",
				handlePythonSetupStatus as EventListener
			);
			window.removeEventListener(
				"package-install-progress",
				handlePackageInstallProgress as EventListener
			);
		};
	}, []);

	// Set up code generation event listeners
	useEffect(() => {
		let isMounted = true;

		const updateGlobalStreamingFlag = () => {
			// Toggle global streaming based on active streams
			analysisDispatch({
				type: "SET_STREAMING",
				payload: activeStreams.current.size > 0,
			});
		};

		const handleCodeGenerationStarted = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationStartedEvent>;
			const { stepId, stepDescription } = customEvent.detail;

			// Clear any lingering validation banners when a new generation starts
			setValidationErrors([]);
			setValidationSuccessMessage("");

			// Create new streaming message
			const messageId = `streaming-${stepId}`;
			activeStreams.current.set(stepId, { messageId, accumulatedCode: "" });

			analysisDispatch({
				type: "ADD_MESSAGE",
				payload: {
					id: messageId,
					content: "", // Start with empty content for streaming
					code: "", // Ensure a CodeBlock mounts immediately
					codeLanguage: "python",
					isUser: false,
					isStreaming: true,
				},
			});

			// Update progress + mark global streaming as active
			setIsProcessing(true);
			setProgressMessage(`Generating: ${stepDescription || "step"}`);
			cancelProcessingStop();
			updateGlobalStreamingFlag();
		};

		const handleCodeGenerationChunk = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationChunkEvent>;
			const { stepId } = customEvent.detail as any;

			const stream = activeStreams.current.get(stepId);
			if (!stream) return;

			// Prefer authoritative accumulatedCode from event (already cleaned of duplicate imports)
			const updated = (customEvent.detail as any)?.accumulatedCode;
			if (typeof updated === "string") {
				stream.accumulatedCode = updated;
			} else {
				// Fallback: append chunk if accumulatedCode is not provided
				const chunk = (customEvent.detail as any)?.chunk || "";
				stream.accumulatedCode += chunk;
			}

			// Send raw code content for streaming (no markdown wrapping)
			enqueueStreamingUpdate(stepId, stream.accumulatedCode);
		};

		const handleCodeGenerationCompleted = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationCompletedEvent>;
			const { stepId, stepDescription, finalCode, success } =
				customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (stream) {
				// Close the streaming message
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							code: finalCode,
							codeLanguage: "python",
							// Keep streaming indicator until validation success/error arrives
							isStreaming: true,
							status: "pending" as any,
						},
					},
				});

				// Set a timeout fallback in case validation events never arrive
				const timeoutId = setTimeout(() => {
					if (activeStreams.current.has(stepId)) {
						console.warn(
							`Validation timeout for step ${stepId}, marking as completed without validation`
						);
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.messageId,
								updates: { isStreaming: false, status: "completed" as any },
							},
						});
						activeStreams.current.delete(stepId);
						updateGlobalStreamingFlag();
						if (activeStreams.current.size === 0) {
							setIsProcessing(false);
							setProgressMessage("");
						}
					}
				}, 30000); // 30 second timeout

				// Store timeout ID to cancel it if validation events arrive
				(stream as any).validationTimeoutId = timeoutId;
			}
		};

		const handleCodeGenerationFailed = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationFailedEvent>;
			const { stepId, stepDescription, error } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (stream) {
				// Clear validation timeout if it exists since generation failed
				if ((stream as any).validationTimeoutId) {
					clearTimeout((stream as any).validationTimeoutId);
				}

				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							content: `Code generation failed for: ${stepDescription}\n\nError: ${error}`,
							isStreaming: false,
							status: "failed" as any,
						},
					},
				});
				activeStreams.current.delete(stepId);
				updateGlobalStreamingFlag();
				if (activeStreams.current.size === 0) {
					scheduleProcessingStop(2500);
				}
			}
		};

		const handleValidationError = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeValidationErrorEvent>;
			const { errors, warnings, originalCode, fixedCode } = customEvent.detail;

			// Set validation errors for display (UI will show them)
			setValidationSuccessMessage("");
			setValidationErrors(errors);

			// Also post a chat message summarizing the errors with optional diff
			try {
				const errorCount = errors?.length || 0;
				const warningCount = warnings?.length || 0;
				// Build collapsible lint block for chat using a custom "lint" fenced block
				let summary = "";
				summary += "```lint\n";
				summary += `LINT_SUMMARY: ⚠️ Found ${errorCount} error(s)${
					warningCount ? ` and ${warningCount} warning(s)` : ""
				}`;
				summary += "\n";
				if (errorCount) {
					summary += "Errors:\n";
					summary += errors.map((e) => `- ${e}`).join("\n");
					summary += "\n";
				}
				if (warningCount) {
					summary += "Warnings:\n";
					summary += warnings.map((w) => `- ${w}`).join("\n");
					summary += "\n";
				}
				summary += "```";
				if (
					originalCode &&
					fixedCode &&
					typeof originalCode === "string" &&
					typeof fixedCode === "string"
				) {
					// Lightweight line-by-line diff for the chat
					const oldLines = originalCode.split("\n");
					const newLines = fixedCode.split("\n");
					const m = oldLines.length;
					const n = newLines.length;
					const lcs: number[][] = Array.from({ length: m + 1 }, () =>
						Array(n + 1).fill(0)
					);
					for (let i = 1; i <= m; i++) {
						for (let j = 1; j <= n; j++) {
							lcs[i][j] =
								oldLines[i - 1] === newLines[j - 1]
									? lcs[i - 1][j - 1] + 1
									: Math.max(lcs[i - 1][j], lcs[i][j - 1]);
						}
					}
					const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
					let i = m,
						j = n;
					while (i > 0 || j > 0) {
						if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
							ops.push({ t: " ", s: oldLines[i - 1] });
							i--;
							j--;
						} else if (j > 0 && (i === 0 || lcs[i][j - 1] > lcs[i - 1][j])) {
							ops.push({ t: "+", s: newLines[j - 1] });
							j--;
						} else if (i > 0) {
							ops.push({ t: "-", s: oldLines[i - 1] });
							i--;
						}
					}
					ops.reverse();
					const diffBody = ops
						.map((o) => {
							const content = o.s.length === 0 ? "(empty line)" : o.s;
							if (o.t === " ") {
								return `  ${content}`; // Two spaces for unchanged lines
							} else {
								return `${o.t} ${content}`; // Space after + or -
							}
						})
						.join("\n");
					summary += `\n\n\`\`\`diff\n${diffBody}\n\`\`\``;
				}
				// Skip adding lint error summary to reduce chat clutter
				// Mark streaming message as completed now
				try {
					const stream = activeStreams.current.get(
						customEvent.detail.stepId as any
					);
					if (stream) {
						// Clear validation timeout if it exists
						if ((stream as any).validationTimeoutId) {
							clearTimeout((stream as any).validationTimeoutId);
						}

						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.messageId,
								updates: { isStreaming: false, status: "failed" as any },
							},
						});
						activeStreams.current.delete(customEvent.detail.stepId as any);
						updateGlobalStreamingFlag();
						if (activeStreams.current.size === 0) {
							setIsProcessing(false);
							setProgressMessage("");
						}
					}
				} catch (_) {}
			} catch (_) {
				// Ignore chat summary failures
			}
		};

		const handleValidationSuccess = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<{
				stepId: string;
				message?: string;
			}>;
			const { message, stepId, code } = (customEvent.detail as any) || {};
			// Clear any previous errors/warnings when lints pass
			setValidationErrors([]);
			setValidationSuccessMessage(message || "No linter errors found");
			// Skip adding lint success message to reduce chat clutter
			// Do not attach validated code to chat (to reduce clutter)

			// Mark streaming message as completed now
			try {
				const stream = activeStreams.current.get(stepId);
				if (stream) {
					// Clear validation timeout if it exists
					if ((stream as any).validationTimeoutId) {
						clearTimeout((stream as any).validationTimeoutId);
					}

					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: stream.messageId,
							updates: { isStreaming: false, status: "completed" as any },
						},
					});
					activeStreams.current.delete(stepId);
					updateGlobalStreamingFlag();
					if (activeStreams.current.size === 0) {
						scheduleProcessingStop(2500);
					}
				}
			} catch (_) {}
		};

		// Add event listeners
		EventManager.addEventListener(
			"code-generation-started",
			handleCodeGenerationStarted
		);
		EventManager.addEventListener(
			"code-generation-chunk",
			handleCodeGenerationChunk
		);
		EventManager.addEventListener(
			"code-generation-completed",
			handleCodeGenerationCompleted
		);
		EventManager.addEventListener(
			"code-generation-failed",
			handleCodeGenerationFailed
		);
		EventManager.addEventListener(
			"code-validation-error",
			handleValidationError
		);
		EventManager.addEventListener(
			"code-validation-success",
			handleValidationSuccess
		);

		return () => {
			isMounted = false;
			EventManager.removeEventListener(
				"code-generation-started",
				handleCodeGenerationStarted
			);
			EventManager.removeEventListener(
				"code-generation-chunk",
				handleCodeGenerationChunk
			);
			EventManager.removeEventListener(
				"code-generation-completed",
				handleCodeGenerationCompleted
			);
			EventManager.removeEventListener(
				"code-generation-failed",
				handleCodeGenerationFailed
			);
			EventManager.removeEventListener(
				"code-validation-error",
				handleValidationError
			);
			EventManager.removeEventListener(
				"code-validation-success",
				handleValidationSuccess
			);
		};
	}, [analysisDispatch]); // Remove addMessage from deps since it's defined after this useEffect

	// Auto-scroll to bottom when new messages are added (only if near bottom)
	useEffect(() => {
		scrollToBottomImmediate();
	}, [analysisState.messages]);

	const scrollToBottomImmediate = useCallback(() => {
		const el = chatContainerRef.current;
		if (!el) return;
		if (!chatAutoScrollRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, []);

	const addMessage = useCallback(
		(
			content: string,
			isUser: boolean = false,
			code?: string,
			codeLanguage?: string,
			codeTitle?: string,
			suggestions?: DataTypeSuggestions,
			status?: "pending" | "completed" | "failed",
			isStreaming?: boolean
		) => {
			// Create a unique message signature using timestamp and content hash
			const timestamp = Date.now();
			const contentHash =
				content.substring(0, 50) + (code?.substring(0, 50) || "");
			const messageSignature = `${timestamp}-${contentHash}`;

			// For non-user messages, check if this is a duplicate (same content within 1 second)
			if (!isUser) {
				const isDuplicate = recentMessages.some((sig) => {
					const [prevTimestamp, prevHash] = sig.split("-", 2);
					const timeDiff = timestamp - parseInt(prevTimestamp);
					return timeDiff < 1000 && prevHash === contentHash;
				});

				if (isDuplicate) {
					return;
				}
			}

			// Add to recent messages (keep only last 20 for better duplicate detection)
			setRecentMessages((prev) => {
				const newMessages = [...prev, messageSignature];
				return newMessages.slice(-20);
			});

			// Store suggestions if provided
			if (suggestions) {
				setCurrentSuggestions(suggestions);
			}

			analysisDispatch({
				type: "ADD_MESSAGE",
				payload: {
					content,
					isUser,
					code,
					codeLanguage,
					codeTitle,
					suggestions,
					status: status || (isUser ? "completed" : "pending"),
					isStreaming: isStreaming || false,
				},
			});
			scrollToBottomImmediate();
		},
		[analysisDispatch, scrollToBottomImmediate]
	);

	// Helper functions to eliminate duplications
	const resetLoadingState = useCallback(() => {
		setIsLoading(false);
		setIsProcessing(false);
		setProgressMessage("");
	}, []);

	const validateBackendClient = useCallback(
		(customErrorMessage?: string): boolean => {
			if (!backendClient) {
				addMessage(
					customErrorMessage ||
						"❌ Backend client not initialized. Please wait a moment and try again.",
					false
				);
				resetLoadingState();
				return false;
			}
			return true;
		},
		[backendClient, addMessage, resetLoadingState]
	);

	// Resolve @mentions like @data.csv to indexed local datasets
	const resolveAtMentions = useCallback((text: string): LocalDatasetEntry[] => {
		const registry = localRegistryRef.current;
		if (!registry) return [];
		const tokens = Array.from(text.matchAll(/@([^\s@]+)/g)).map((m) => m[1]);
		if (!tokens.length) return [];
		const resolved: LocalDatasetEntry[] = [];
		for (const t of tokens) {
			const matches = registry.resolveMention(t);
			for (const m of matches) resolved.push(m);
		}
		const byId = new Map<string, LocalDatasetEntry>();
		resolved.forEach((d) => byId.set(d.id, d));
		return Array.from(byId.values());
	}, []);

	// Helper types and functions for minimal edit application
	type LineEdit = {
		startLine: number; // 1-based, inclusive
		endLine: number; // 1-based, inclusive
		replacement: string; // exact text to replace the range with
	};

	const stripCodeFences = (text: string): string => {
		return text
			.replace(/^\s*```[a-zA-Z]*\s*/g, "")
			.replace(/\s*```\s*$/g, "")
			.trim();
	};

	// Helper: compute selection range from a user message requesting specific line(s)
	const computeSelectionFromMessage = (
		fullCode: string,
		userMessage: string
	): {
		selStart: number;
		selEnd: number;
		startLine: number;
		endLine: number;
		withinSelection: string;
	} => {
		let selStart = 0;
		let selEnd = fullCode.length;
		let startLine = 1;
		let endLine = (fullCode.match(/\n/g)?.length ?? 0) + 1;
		try {
			const lm =
				userMessage.match(/lines?\s+(\d+)(?:\s*-\s*(\d+))?/i) ||
				userMessage.match(/line\s+(\d+)/i);
			if (lm) {
				const s = Math.max(1, parseInt(lm[1] || "1", 10));
				const e = Math.max(s, parseInt(lm[2] || String(s), 10));
				const lineStartPositions: number[] = [0];
				for (let i = 0; i < fullCode.length; i++) {
					if (fullCode[i] === "\n") lineStartPositions.push(i + 1);
				}
				startLine = Math.min(s, lineStartPositions.length);
				endLine = Math.min(e, lineStartPositions.length);
				selStart = lineStartPositions[startLine - 1] ?? 0;
				selEnd =
					lineStartPositions[endLine] !== undefined
						? lineStartPositions[endLine]
						: fullCode.length;
			}
		} catch (_) {}
		const withinSelection = fullCode.slice(selStart, selEnd);
		return { selStart, selEnd, startLine, endLine, withinSelection };
	};

	// Helper: unified diff for selection updates
	const buildUnifiedDiff = (
		oldText: string,
		newText: string,
		file: string,
		oldStart: number
	) => {
		const oldLines = oldText.split("\n");
		const newLines = newText.split("\n");
		const m = oldLines.length;
		const n = newLines.length;
		const lcs: number[][] = Array.from({ length: m + 1 }, () =>
			Array(n + 1).fill(0)
		);
		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (oldLines[i - 1] === newLines[j - 1]) {
					lcs[i][j] = lcs[i - 1][j - 1] + 1;
				} else {
					lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
				}
			}
		}
		const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
		let i = m,
			j = n;
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
				ops.push({ t: " ", s: oldLines[i - 1] });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || lcs[i][j - 1] > lcs[i - 1][j])) {
				ops.push({ t: "+", s: newLines[j - 1] });
				j--;
			} else if (i > 0) {
				ops.push({ t: "-", s: oldLines[i - 1] });
				i--;
			}
		}
		ops.reverse();
		const oldCount = m;
		const newCount = n;
		const newStart = oldStart; // selection replaced in place
		const headerA = `--- a/${file}:${oldStart}-${oldStart + oldCount - 1}`;
		const headerB = `+++ b/${file}:${newStart}-${newStart + newCount - 1}`;
		const hunk = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
		const body = ops
			.map((o) => {
				const content = o.s.length === 0 ? "(empty line)" : o.s;
				if (o.t === " ") {
					return `  ${content}`; // Two spaces for unchanged lines
				} else {
					return `${o.t} ${content}`; // Space after + or -
				}
			})
			.join("\n");
		return `${headerA}\n${headerB}\n${hunk}\n${body}`;
	};

	// Shared notebook edit executor to avoid duplication between cellMention and selection-based edits
	const performNotebookEdit = useCallback(
		async (args: {
			filePath: string;
			cellIndex: number;
			language: string;
			fullCode: string;
			userMessage: string;
			selection?: {
				selStart: number;
				selEnd: number;
				startLine: number;
				endLine: number;
				withinSelection: string;
			};
			outputText?: string;
			hasErrorOutput?: boolean;
		}) => {
			if (!backendClient) {
				addMessage(
					"Backend not ready to edit code. Please try again in a moment.",
					false
				);
				return;
			}
			const {
				filePath,
				cellIndex,
				language,
				fullCode,
				userMessage,
				selection,
				outputText,
				hasErrorOutput,
			} = args;

			const wsPath =
				findWorkspacePath({
					filePath,
					currentWorkspace: workspaceState.currentWorkspace || undefined,
				}) || "";
			const notebookService = new NotebookService({ workspacePath: wsPath });

			const lang = (language || "python").toLowerCase();
			const { selStart, selEnd, startLine, endLine, withinSelection } =
				selection || computeSelectionFromMessage(fullCode, userMessage);
			const fileName = filePath.split("/").pop() || filePath;

			addMessage(
				`Editing plan:\n\n- **Target**: cell ${cellIndex} in \`${fileName}\`\n- **Scope**: replace lines ${startLine}-${endLine} of the selected code\n- **Process**: I will generate the revised snippet (streaming below), then apply it to the notebook and confirm the save.`,
				false
			);
			const task =
				`Edit the following ${lang} code according to the user's instruction. ` +
				`CRITICAL RULES:\n` +
				`1. Return ONLY the exact replacement for lines ${startLine}-${endLine}\n` +
				`2. Do NOT include explanations or markdown formatting\n` +
				`3. Do NOT add imports, package installs, magic commands, shebangs, or globals\n` +
				`4. Preserve the number of lines unless removing content; match indentation and style\n` +
				`5. Output ONLY the modified code as plain text`;

			let streamedResponse = "";
			const streamingMessageId = `edit-${Date.now()}`;
			analysisDispatch({
				type: "ADD_MESSAGE",
				payload: {
					id: streamingMessageId,
					content: "Streaming edited code…",
					isUser: false,
					isStreaming: true,
					code: "",
					codeLanguage: lang,
					codeTitle: "Edited snippet",
				},
			});

			try {
				const base = fullCode;
				const start = selStart;
				const end = selEnd;
				let lastCellUpdate = 0;
				await backendClient!.generateCodeStream(
					{
						task_description:
							`${task}\n\nUser instruction: ${userMessage}\n\n` +
							(outputText && outputText.trim().length > 0
								? `${
										hasErrorOutput ? "Error" : "Execution"
								  } output for context:\n\n\`\`\`text\n${outputText}\n\`\`\`\n\n`
								: "") +
							`Original code (lines ${startLine}-${endLine}):\n${withinSelection}\n\nIMPORTANT: The original has ${
								withinSelection.split("\n").length
							} lines. Return EXACTLY ${
								withinSelection.split("\n").length
							} modified lines (no imports, no extra lines). Example format:\nline1\nline2\n\nYour response:`,
						language: lang,
						context: "Notebook code edit-in-place",
						notebook_edit: true,
					},
					(chunk: string) => {
						streamedResponse += chunk;
						const cleanedSnippet = stripCodeFences(streamedResponse);

						// Update chat message with the edited snippet so far
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: streamingMessageId,
								updates: {
									content: `Streaming edited code…`,
									code: cleanedSnippet,
									codeLanguage: lang,
									codeTitle: "Edited snippet",
									isStreaming: true,
								},
							},
						});

						// Throttled live update of the notebook cell so changes are visible during streaming
						const now = Date.now();
						if (now - lastCellUpdate > 500) {
							const partialNewCode =
								base.substring(0, start) + cleanedSnippet + base.substring(end);
							notebookService
								.updateCellCode(filePath, cellIndex, partialNewCode)
								.catch(() => {});
							lastCellUpdate = now;
						}
					}
				);
			} catch (e) {
				addMessage(
					`Code edit failed: ${e instanceof Error ? e.message : String(e)}`,
					false
				);
				return;
			} finally {
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: { id: streamingMessageId, updates: { isStreaming: false } },
				});
			}

			// Use the streamed edited snippet; fallback to JSON edits if the model returned them
			const base = fullCode;
			const start = selStart;
			const end = selEnd;
			const cleanedFinal = stripCodeFences(streamedResponse);
			const jsonFallback = parseJsonEdits(streamedResponse);
			let newSelection = jsonFallback
				? applyLineEdits(withinSelection, jsonFallback)
				: cleanedFinal;

			// Guardrail: strip newly introduced imports not present in original selection
			try {
				const importRe = /^(?:\s*from\s+\S+\s+import\s+|\s*import\s+\S+)/;
				const originalLines = withinSelection.split(/\r?\n/);
				const originalImportSet = new Set(
					originalLines.filter((l) => importRe.test(l)).map((l) => l.trim())
				);
				const newLines = newSelection.split(/\r?\n/);
				const filtered = newLines.filter((l) => {
					if (!importRe.test(l)) return true;
					return originalImportSet.has(l.trim());
				});
				if (filtered.length !== newLines.length) {
					newSelection = filtered.join("\n");
				}
			} catch (_) {}
			const newCode =
				base.substring(0, start) + newSelection + base.substring(end);

			// Validate generated code with Ruff; if issues remain, auto-fix via backend LLM
			let validatedCode = newCode;
			let didAutoFix = false;
			try {
				// Skip linting for package installation cells (pip/conda magics or commands)
				const isInstallCell =
					/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(
						newCode
					);
				if (isInstallCell) {
					// Keep code as-is; prefer not to mutate install commands
					addMessage(
						`ℹ️ Skipping lint/fix for package installation lines.`,
						false
					);
					validatedCode = newCode;
				} else {
					const ruffResult = await ruffLinter.lintCode(newCode, {
						enableFixes: true,
						filename: `cell_${cellIndex + 1}.py`,
					});
					if (!ruffResult.isValid) {
						const errors = ruffResult.diagnostics
							.filter((d) => d.kind === "error")
							.map((d) => `${d.code}: ${d.message} (line ${d.startLine})`);
						addMessage(
							`⚠️ Code validation issues detected. Attempting auto-fix…`,
							false
						);
						const fixed = backendClient
							? await autoFixWithRuffAndLLM(backendClient, newCode, {
									filename: `cell_${cellIndex + 1}.py`,
									stepTitle: `Inline edit for cell ${cellIndex + 1}`,
							  })
							: {
									fixedCode: ruffResult.fixedCode || newCode,
									issues: errors,
									wasFixed: false,
							  };
						validatedCode = fixed.fixedCode || ruffResult.fixedCode || newCode;
						didAutoFix = !!fixed.wasFixed;
						if (fixed.wasFixed) {
							addMessage(`✅ Applied auto-fix for lint issues.`, false);
						} else {
							addMessage(
								`⚠️ Auto-fix attempted but some issues may remain.`,
								false
							);
						}
					} else {
						// Prefer Ruff's improvements when available
						const improved = ruffResult.fixedCode || ruffResult.formattedCode;
						if (improved && improved !== newCode) {
							didAutoFix = true;
							validatedCode = improved;
						} else {
							validatedCode = newCode;
						}
					}
				}
			} catch (error) {
				console.warn("Ruff validation or auto-fix failed:", error);
				validatedCode = newCode;
			}

			await notebookService.updateCellCode(filePath, cellIndex, validatedCode);

			// Final linting check on the updated code (skip for install cells)
			try {
				const isInstallCellFinal =
					/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(
						validatedCode
					);
				if (isInstallCellFinal) {
					// No final lint for install lines
					throw null; // jump to catch without logging error
				}
				console.log(`Final linting check for cell ${cellIndex + 1}...`);
				const finalLintResult = await ruffLinter.lintCode(validatedCode, {
					enableFixes: false, // Don't fix again, just check
					filename: `cell_${cellIndex + 1}_final.py`,
				});

				if (!finalLintResult.isValid) {
					const issueLines = finalLintResult.diagnostics.map(
						(d) => `${d.code}: ${d.message} (line ${d.startLine})`
					);
					console.warn(
						`Linting issues found in cell ${cellIndex + 1}:`,
						issueLines.join(", ")
					);
					const errorCount = finalLintResult.diagnostics.filter(
						(d) => d.kind === "error"
					).length;
					const warningCount = finalLintResult.diagnostics.filter(
						(d) => d.kind === "warning"
					).length;
					let lintBlock = "```lint\n";
					lintBlock +=
						`LINT_SUMMARY: ⚠️ Found ${errorCount} error(s)${
							warningCount ? ` and ${warningCount} warning(s)` : ""
						} in cell ${cellIndex + 1}` + "\n";
					if (errorCount) {
						lintBlock += "Errors:\n";
						lintBlock +=
							finalLintResult.diagnostics
								.filter((d) => d.kind === "error")
								.map((d) => `- ${d.code}: ${d.message} (line ${d.startLine})`)
								.join("\n") + "\n";
					}
					if (warningCount) {
						lintBlock += "Warnings:\n";
						lintBlock +=
							finalLintResult.diagnostics
								.filter((d) => d.kind === "warning")
								.map((d) => `- ${d.code}: ${d.message} (line ${d.startLine})`)
								.join("\n") + "\n";
					}
					lintBlock += "```";
					// Skip adding lint error summary to reduce chat clutter
				} else {
					console.log(`Cell ${cellIndex + 1} passed final linting check`);
				}
			} catch (lintError) {
				if (lintError) {
					console.warn(
						`Failed to run final lint check on cell ${cellIndex + 1}:`,
						lintError
					);
				}
				// Don't fail the whole operation if linting fails
			}

			// Short confirmation window; fallback to optimistic success
			let updateDetail: any = null;
			try {
				const timeoutMs = 2000;
				const detail = await Promise.race([
					EventManager.waitForEvent<any>(
						"notebook-cell-updated",
						timeoutMs
					).then((d) =>
						d?.filePath === filePath && d?.cellIndex === cellIndex ? d : null
					),
					new Promise((resolve) =>
						setTimeout(() => resolve({ success: true, immediate: true }), 100)
					),
				]);
				updateDetail = detail || { success: true, immediate: true };
			} catch (_) {
				updateDetail = { success: true, immediate: true };
			}

			const originalLineCount = withinSelection.split("\n").length;
			const newLineCount = newSelection.split("\n").length;
			const statusText =
				updateDetail?.success === false
					? "save failed"
					: updateDetail?.immediate
					? "applied"
					: "saved";
			const validationText = didAutoFix ? " (auto-fixed)" : "";
			const summary = `Applied notebook edit:\n\n- **Cell**: ${cellIndex}\n- **Lines**: ${startLine}-${endLine} (${originalLineCount} → ${newLineCount} lines)\n- **Status**: ${statusText}${validationText}`;

			// Build diff against the actual replacement we generated.
			// Using validatedCode offsets can drift if a linter reformats outside the selection,
			// so prefer the explicit newSelection for a correct, minimal diff view.
			const unifiedDiff = buildUnifiedDiff(
				withinSelection,
				newSelection,
				fileName,
				startLine
			);
			addMessage(`${summary}\n\n\`\`\`diff\n${unifiedDiff}\n\`\`\``, false);
		},
		[
			backendClient,
			addMessage,
			analysisDispatch,
			workspaceState.currentWorkspace,
		]
	);

	const parseJsonEdits = (text: string): LineEdit[] | null => {
		try {
			const cleaned = stripCodeFences(text);
			// Extract JSON array if there is extra prose
			const arrayMatch = cleaned.match(/\[([\s\S]*)\]$/);
			const candidate = arrayMatch ? `[${arrayMatch[1]}]` : cleaned;
			const parsed = JSON.parse(candidate);
			if (Array.isArray(parsed)) {
				const edits: LineEdit[] = parsed
					.map((e) => ({
						startLine: Number(e.startLine),
						endLine: Number(e.endLine),
						replacement: String(e.replacement ?? ""),
					}))
					.filter(
						(e) =>
							Number.isFinite(e.startLine) &&
							Number.isFinite(e.endLine) &&
							e.startLine >= 1 &&
							e.endLine >= e.startLine
					);
				return edits.length > 0 ? edits : null;
			}
			// Support single-object edit
			if (parsed && typeof parsed === "object") {
				const e = parsed as any;
				const startLine = Number(e.startLine);
				const endLine = Number(e.endLine);
				if (
					Number.isFinite(startLine) &&
					Number.isFinite(endLine) &&
					startLine >= 1 &&
					endLine >= startLine
				) {
					return [
						{
							startLine,
							endLine,
							replacement: String(e.replacement ?? ""),
						},
					];
				}
			}
		} catch {
			// ignore
		}
		return null;
	};

	const applyLineEdits = (original: string, edits: LineEdit[]): string => {
		const normalizedOriginal = original.replace(/\r\n/g, "\n");
		let lines = normalizedOriginal.split("\n");
		// Apply from bottom-most edit to top to preserve indices
		const sorted = [...edits].sort((a, b) => b.startLine - a.startLine);
		for (const edit of sorted) {
			const startIdx = Math.max(0, Math.min(lines.length, edit.startLine - 1));
			const endIdx = Math.max(startIdx, Math.min(lines.length, edit.endLine));
			const replacementLines = String(edit.replacement)
				.replace(/\r\n/g, "\n")
				.split("\n");
			lines = [
				...lines.slice(0, startIdx),
				...replacementLines,
				...lines.slice(endIdx),
			];
		}
		return lines.join("\n");
	};

	const handleSendMessage = useCallback(async () => {
		if (!inputValueRef.current.trim() || isLoading) return;

		// Clear lingering validation status for a fresh conversation cycle
		setValidationErrors([]);
		setValidationSuccessMessage("");

		const userMessage = inputValueRef.current.trim();

		// Ask mode: If a code selection/context is present, do an edit-in-place; otherwise do Q&A
		if (chatMode === "Ask") {
			// Prefer notebook edit when Ask Chat is invoked from code/output context
			const ctxAsk = codeEditContext || codeEditContextRef.current;
			if (ctxAsk && ctxAsk.filePath && ctxAsk.cellIndex !== undefined) {
				const lang = (ctxAsk.language || "python").toLowerCase();
				const filePath = ctxAsk.filePath;
				const cellIndex = ctxAsk.cellIndex;
				const fullCode = ctxAsk.fullCode ?? "";
				const selStart = Math.max(0, ctxAsk.selectionStart ?? 0);
				const selEnd = Math.min(
					fullCode.length,
					ctxAsk.selectionEnd ?? selStart
				);
				const beforeSelection = fullCode.slice(0, selStart);
				const withinSelection = fullCode.slice(selStart, selEnd);
				const startLine = (beforeSelection.match(/\n/g)?.length ?? 0) + 1;
				const endLine = startLine + (withinSelection.match(/\n/g)?.length ?? 0);

				await performNotebookEdit({
					filePath,
					cellIndex,
					language: lang,
					fullCode,
					userMessage,
					selection: { selStart, selEnd, startLine, endLine, withinSelection },
					outputText: ctxAsk.outputText,
					hasErrorOutput: ctxAsk.hasErrorOutput,
				});
				setCodeEditContext(null);
				codeEditContextRef.current = null;
				return;
			}

			addMessage(userMessage, true);
			setInputValue("");
			setIsLoading(true);
			setIsProcessing(true);

			let isMounted = true;
			try {
				if (!validateBackendClient()) {
					return;
				}
				// Build lightweight context from recent messages, including any code snippets
				const recent = (analysisState.messages || []).slice(-10);
				const context = recent
					.map((m: any) => {
						const text = typeof m.content === "string" ? m.content : "";
						const codeStr =
							typeof m.code === "string" && m.code.trim().length > 0
								? `\n\n\`\`\`${m.codeLanguage || "python"}\n${m.code}\n\`\`\`\n`
								: "";
						return text + codeStr;
					})
					.filter(Boolean)
					.join("\n\n");
				const answer = await backendClient!.askQuestion({
					question: userMessage,
					context,
				});
				if (isMounted) {
					addMessage(answer || "(No answer)", false);
				}
			} catch (error) {
				console.error("Ask mode error:", error);
				if (isMounted) {
					addMessage(
						"Sorry, I couldn't answer that right now. Please try again.",
						false
					);
				}
			} finally {
				if (isMounted) {
					resetLoadingState();
				}
			}
			return;
		}
		// Resolve @mentions to local datasets and auto-attach (Agent mode only)
		const mentionDatasets = resolveAtMentions(userMessage);

		// Additionally resolve direct workspace/absolute path mentions like @data/file.csv or @path/to/folder
		const tokens = Array.from(userMessage.matchAll(/@([^\s@]+)/g)).map(
			(m) => m[1]
		);
		// Also capture #N and #all tokens (only meaningful if notebook active)
		const hashTokens = Array.from(userMessage.matchAll(/#(all|\d+)/gi)).map(
			(m) => m[1]
		);
		const workspaceResolved: LocalDatasetEntry[] = [];
		let cellMentionContext: null | {
			filePath: string;
			cellIndex0: number;
			language: string;
			code: string;
		} = null;

		// If user referenced cells with #N/#all, resolve them against the active notebook now
		if (hashTokens.length > 0) {
			try {
				const activeFile = (workspaceState as any).activeFile as string | null;
				if (activeFile && activeFile.endsWith(".ipynb")) {
					// Use cached notebook content if available
					let nb = notebookContentCache.get(activeFile);
					if (!nb) {
						const content = await window.electronAPI.readFile(activeFile);
						nb = JSON.parse(content);
						notebookContentCache.set(activeFile, nb);
					}
					const cells = Array.isArray(nb?.cells) ? nb.cells : [];
					const wantAll = hashTokens.some(
						(t) => String(t).toLowerCase() === "all"
					);
					const targetIndices = wantAll
						? cells.map((_: unknown, i: number) => i)
						: hashTokens
								.map((t) => parseInt(String(t), 10))
								.filter(
									(n) => Number.isInteger(n) && n >= 1 && n <= cells.length
								)
								.map((n) => n - 1);
					if (targetIndices.length > 0) {
						for (const idx0 of targetIndices) {
							const c = cells[idx0];
							if (!c) continue;
							const srcArr: string[] = Array.isArray(c.source) ? c.source : [];
							const code = srcArr.join("");
							const lang = c.cell_type === "markdown" ? "markdown" : "python";
							if (!cellMentionContext) {
								cellMentionContext = {
									filePath: activeFile,
									cellIndex0: idx0,
									language: lang,
									code,
								};
							}
						}
					}
				}
			} catch {
				// ignore
			}
		}

		// Resolve only @-style tokens and explicit notebook path references here.
		// Avoid re-processing #N/#all hash tokens which were already handled above.
		if (tokens.length > 0) {
			const wsRoot = workspaceState.currentWorkspace || "";
			const registry = localRegistryRef.current;
			for (const token of tokens) {
				// Heuristic: consider anything with a slash or starting with / as a path
				const looksLikePath = token.startsWith("/") || token.includes("/");
				// Handle notebook cell reference like path.ipynb#3
				const cellRefMatch = token.match(/^(.*\.ipynb)#(\d+)$/i);
				if (cellRefMatch) {
					const pathPart = cellRefMatch[1];
					const index1Based = parseInt(cellRefMatch[2], 10);
					if (!Number.isNaN(index1Based) && index1Based >= 1) {
						let candidatePath = "";
						if (pathPart.startsWith("/")) {
							// Absolute path
							candidatePath = pathPart;
						} else if (wsRoot) {
							// Smart notebook resolution (cached)
							candidatePath = notebookPathCache.get(pathPart) || "";
							console.log(
								`💾 Cache lookup for ${pathPart}: ${
									candidatePath || "NOT FOUND"
								}`
							);

							if (!candidatePath) {
								// FAST: Check if it's the currently active file
								const activeFile = (workspaceState as any).activeFile as
									| string
									| null;
								console.log(`⚡ Active file: ${activeFile}`);
								console.log(`⚡ Looking for: ${pathPart}`);

								if (activeFile && activeFile.endsWith(pathPart)) {
									candidatePath = activeFile;
									console.log(`⚡ Using active file: ${candidatePath}`);
								} else if (activeFile) {
									// FAST: Try current directory (where active file is)
									const activeDir = activeFile
										.split("/")
										.slice(0, -1)
										.join("/");
									const testPath = `${activeDir}/${pathPart}`;
									console.log(`⚡ Testing same directory: ${testPath}`);
									try {
										const info = await window.electronAPI.getFileInfo(testPath);
										if (info && "size" in info) {
											candidatePath = testPath;
											console.log(
												`⚡ Found in active directory: ${candidatePath}`
											);
										} else {
											console.log(`⚡ Not in active directory, info:`, info);
										}
									} catch (e) {
										console.log(`⚡ Error checking active directory:`, e);
									}
								} else {
									// FALLBACK: Try to find it by searching only the immediate subdirectories
									console.log(`⚡ No active file, trying subdirectories...`);
									try {
										const directories = await window.electronAPI.listDirectory(
											wsRoot
										);
										for (const dir of directories) {
											if (dir.isDirectory) {
												const testPath = `${dir.path}/${pathPart}`;
												try {
													const info = await window.electronAPI.getFileInfo(
														testPath
													);
													if (info && "size" in info) {
														candidatePath = testPath;
														console.log(
															`⚡ Found in subdirectory: ${candidatePath}`
														);
														break;
													}
												} catch (e) {
													// Continue to next directory
												}
											}
										}
									} catch (e) {
										console.log(`⚡ Error listing directories:`, e);
									}
								}

								// FALLBACK: Only if we couldn't find it anywhere else
								if (!candidatePath) {
									candidatePath = `${wsRoot}/${pathPart}`;
									console.log(`⚡ Using fallback path: ${candidatePath}`);
								}

								notebookPathCache.set(pathPart, candidatePath);
							} else {
								console.log(`📋 Using cached path: ${candidatePath}`);
							}
						}
						if (candidatePath) {
							try {
								console.log(`🔍 About to read notebook from: ${candidatePath}`);
								// Check cache first
								let nb = notebookContentCache.get(candidatePath);
								if (!nb) {
									const fileContent = await window.electronAPI.readFile(
										candidatePath
									);
									nb = JSON.parse(fileContent);
									notebookContentCache.set(candidatePath, nb);
								}
								const idx0 = index1Based - 1;
								const cell = Array.isArray(nb?.cells) ? nb.cells[idx0] : null;
								if (cell) {
									const srcArr: string[] = Array.isArray(cell.source)
										? cell.source
										: [];
									const code = srcArr.join("");
									const lang =
										cell.cell_type === "markdown" ? "markdown" : "python";
									// Prefer first valid cell mention only for edit context
									if (!cellMentionContext) {
										cellMentionContext = {
											filePath: candidatePath,
											cellIndex0: idx0,
											language: lang,
											code,
										};
									}
									// Do not process hashTokens here; they are handled in the dedicated block above
								}
							} catch (_) {
								// ignore
							}
						}
					}
					// skip normal path handling for cell references
					continue;
				}
				if (!looksLikePath) continue;

				const candidatePath = token.startsWith("/")
					? token
					: wsRoot
					? `${wsRoot}/${token}`
					: "";
				if (!candidatePath) continue;

				try {
					const info = await electronAPI.getFileInfo(candidatePath);
					if (info?.success && info.data) {
						if (registry) {
							const entry = await registry.addFromPath(candidatePath, token);
							if (entry) workspaceResolved.push(entry);
						}
					}
				} catch (_) {
					// ignore failures; not a valid path
				}
			}
		}

		const allMentionDatasets = mergeSelectedDatasets(
			mentionDatasets as any[],
			workspaceResolved as any[]
		);

		if (allMentionDatasets.length > 0) {
			selectDatasets(allMentionDatasets);
			addMessage(
				`Using local data from mentions: ${allMentionDatasets
					.map((d) => d.alias || d.title)
					.join(", ")}`,
				false
			);
		}
		addMessage(userMessage, true);
		setInputValue("");
		setIsLoading(true);
		setIsProcessing(true);

		let isMounted = true;

		try {
			// If user referenced a notebook cell and specified line ranges, optionally show a snippet.
			// Only show the snippet and return if the prompt clearly asks to "show/view" rather than edit.
			if (cellMentionContext) {
				const wantOutput = /\boutput\b/i.test(userMessage);
				const lineMatch =
					userMessage.match(/lines?\s+(\d+)(?:\s*-\s*(\d+))?/i) ||
					userMessage.match(/line\s+(\d+)/i);
				if (lineMatch) {
					const editIntent =
						/(edit|change|fix|modify|refactor|replace|update|improve|correct|transform|rewrite)/i.test(
							userMessage
						);
					const showIntent =
						/(show|display|view|print|see|what\s*'?s?\s+in)/i.test(userMessage);
					// If it's a show-only request (or output requested) and not an edit intent, display snippet then return.
					if ((showIntent || wantOutput) && !editIntent) {
						try {
							const startLineIdx = Math.max(
								1,
								parseInt(lineMatch[1] || "1", 10)
							);
							const endLineIdx = Math.max(
								startLineIdx,
								parseInt(lineMatch[2] || String(startLineIdx), 10)
							);
							let snippet = "";
							let langForBlock = wantOutput
								? "text"
								: cellMentionContext.language || "python";
							if (wantOutput) {
								const fileContent = await window.electronAPI.readFile(
									cellMentionContext.filePath
								);
								const nb = JSON.parse(fileContent);
								const cell = Array.isArray(nb?.cells)
									? nb.cells[cellMentionContext.cellIndex0]
									: null;
								let outputText = "";
								if (cell && Array.isArray(cell.outputs)) {
									const parts: string[] = [];
									for (const o of cell.outputs) {
										if (o?.output_type === "stream" && Array.isArray(o.text)) {
											parts.push(o.text.join(""));
										} else if (
											o?.output_type === "execute_result" &&
											o?.data?.["text/plain"]
										) {
											const t = o.data["text/plain"];
											parts.push(Array.isArray(t) ? t.join("") : String(t));
										}
									}
									outputText = parts.join("\n");
								}
								const outLines = (outputText || "").split(/\r?\n/);
								snippet = outLines
									.slice(startLineIdx - 1, endLineIdx)
									.join("\n");
							} else {
								const codeLines = (cellMentionContext.code || "").split(
									/\r?\n/
								);
								snippet = codeLines
									.slice(startLineIdx - 1, endLineIdx)
									.join("\n");
							}
							const cellNum = cellMentionContext.cellIndex0 + 1;
							addMessage(
								`Cell ${cellNum} ${
									wantOutput ? "output" : "code"
								} lines ${startLineIdx}-${endLineIdx}:\n\n\`\`\`${langForBlock}\n${snippet}\n\`\`\``,
								false
							);
							return; // show-only path ends here to avoid triggering edit below
						} catch (_) {
							// ignore snippet failures and fall through to edit path
						}
					}
				}
			}
			// If message referenced a notebook cell via #N/#all, perform inline edit on the first referenced cell
			// Prefer explicit selection-based edits (codeEditContext) over cell mentions to avoid duplicate handling
			if (cellMentionContext && !codeEditContext) {
				if (!backendClient) {
					addMessage(
						"Backend not ready to edit code. Please try again in a moment.",
						false
					);
					return;
				}

				const lang = (cellMentionContext.language || "python").toLowerCase();
				const originalSnippet = cellMentionContext.code || "";
				const filePath = cellMentionContext.filePath;
				const cellIndex = cellMentionContext.cellIndex0;
				const fullCode = originalSnippet;
				// If the message includes an explicit line range (e.g., "lines 3-10"),
				// restrict the edit scope to those lines; otherwise edit the entire cell
				let selStart = 0;
				let selEnd = fullCode.length;
				let startLine = 1;
				let endLine = (fullCode.match(/\n/g)?.length ?? 0) + 1;
				try {
					const lm =
						userMessage.match(/lines?\s+(\d+)(?:\s*-\s*(\d+))?/i) ||
						userMessage.match(/line\s+(\d+)/i);
					if (lm) {
						const s = Math.max(1, parseInt(lm[1] || "1", 10));
						const e = Math.max(s, parseInt(lm[2] || String(s), 10));
						// Map line numbers to character offsets using original newlines
						const lineStartPositions: number[] = [0];
						for (let i = 0; i < fullCode.length; i++) {
							if (fullCode[i] === "\n") {
								lineStartPositions.push(i + 1);
							}
						}
						startLine = Math.min(s, lineStartPositions.length);
						endLine = Math.min(e, lineStartPositions.length);
						selStart = lineStartPositions[startLine - 1] ?? 0;
						selEnd =
							lineStartPositions[endLine] !== undefined
								? lineStartPositions[endLine]
								: fullCode.length;
					}
				} catch (_) {}
				const withinSelection = fullCode.slice(selStart, selEnd);
				const fileName = filePath.split("/").pop() || filePath;

				// Use shared edit executor to avoid duplication
				await performNotebookEdit({
					filePath,
					cellIndex,
					language: lang,
					fullCode,
					userMessage,
					selection: { selStart, selEnd, startLine, endLine, withinSelection },
				});
				return;
			}

			// If there is an active code edit context (state or ref), perform edit-in-place and return early
			const ctxAgent = codeEditContext || codeEditContextRef.current;
			if (ctxAgent && ctxAgent.filePath && ctxAgent.cellIndex !== undefined) {
				if (!backendClient) {
					addMessage(
						"Backend not ready to edit code. Please try again in a moment.",
						false
					);
					return;
				}

				// Build LLM prompt to transform only the selected snippet
				const lang = (ctxAgent.language || "python").toLowerCase();
				const filePath = ctxAgent.filePath;
				const cellIndex = ctxAgent.cellIndex;
				const fullCode = ctxAgent.fullCode ?? "";
				const selStart = Math.max(0, ctxAgent.selectionStart ?? 0);
				const selEnd = Math.min(
					fullCode.length,
					ctxAgent.selectionEnd ?? selStart
				);
				const beforeSelection = fullCode.slice(0, selStart);
				const withinSelection = fullCode.slice(selStart, selEnd);
				const startLine = (beforeSelection.match(/\n/g)?.length ?? 0) + 1;
				const endLine = startLine + (withinSelection.match(/\n/g)?.length ?? 0);

				await performNotebookEdit({
					filePath,
					cellIndex,
					language: lang,
					fullCode,
					userMessage,
					selection: { selStart, selEnd, startLine, endLine, withinSelection },
					outputText: ctxAgent.outputText,
					hasErrorOutput: ctxAgent.hasErrorOutput,
				});
				setCodeEditContext(null);
				codeEditContextRef.current = null;
				return;
			}
			// If datasets are already selected, prioritize analysis/suggestions over intent classification
			// to avoid accidentally routing to search or generic Q&A.
			if (selectedDatasets.length > 0) {
				// Default with selected datasets: treat as analysis request
				await handleAnalysisRequest(userMessage);
				return; // handled
			}

			// Use backend LLM to classify intent instead of local pattern matching
			if (!validateBackendClient()) {
				return;
			}

			// Get intent classification from backend
			const intentResult = await backendClient!.classifyIntent(userMessage);

			// If confidence is too low (< 0.65), treat as general question instead of forcing into specific intent
			const isLowConfidence = (intentResult.confidence || 0) < 0.8;

			// Handle dataset search based on backend intent
			if (intentResult.intent === "SEARCH_DATA" && !isLowConfidence) {
				console.log("🔍 Detected search request for:", userMessage);
				// Search for datasets
				if (isMounted) {
					setProgressMessage("🔍 Searching for datasets...");
					setShowDatasetSearchDetails(true);
				}

				// Check if backendClient is available
				if (!validateBackendClient()) {
					return;
				}

				console.log("🔍 Starting search with query:", userMessage);

				try {
					const searchResult = await searchForDatasets(userMessage);
					console.log("🔍 Search response:", searchResult);

					if (isMounted && searchResult.datasets.length > 0) {
					} else if (isMounted) {
						console.log("❌ No datasets found. SearchResult:", searchResult);
						addMessage(
							"❌ No datasets found matching your search. Try different keywords or be more specific.",
							false
						);
					}
				} catch (error) {
					console.error("Dataset search failed:", error);
					if (isMounted) {
						addMessage(
							"❌ Failed to search for datasets. Please check your connection and try again.",
							false
						);
					}
				}
			}
			// Handle ADD_CELL intent or analysis requests for active notebooks (only if confident)
			else if (intentResult.intent === "ADD_CELL") {
				// Robust notebook detection - check multiple sources due to potential race conditions
				const activeFile = (workspaceState as any).activeFile as string | null;
				const openFiles = ((workspaceState as any).openFiles || []) as string[];

				// Primary detection: workspace state
				let notebookFile =
					activeFile && activeFile.endsWith(".ipynb") ? activeFile : null;
				if (!notebookFile) {
					notebookFile =
						openFiles.find(
							(f) => typeof f === "string" && f.endsWith(".ipynb")
						) || null;
				}

				// Fallback detection: check DOM for open notebook tabs if workspace state is empty
				// This handles race conditions where workspace state isn't synced yet
				if (!notebookFile && openFiles.length === 0) {
					try {
						// The Tab component sets the full file path on the parent element's title attribute
						// and renders a child span with class "tab-title". Use that structure to find .ipynb tabs.
						const titleSpans = document.querySelectorAll(".tab-title");
						for (const span of Array.from(titleSpans)) {
							const parent = (span as HTMLElement).parentElement;
							const filePath = parent?.getAttribute("title");
							if (filePath && filePath.endsWith(".ipynb")) {
								notebookFile = filePath;
								console.log(
									"📂 Found notebook via tab DOM fallback:",
									notebookFile
								);
								break;
							}
						}
					} catch (domError) {
						console.warn("Failed DOM fallback detection:", domError);
					}
				}

				const isNotebookOpen = Boolean(notebookFile);
				console.log(
					"📂 Final notebook detection - activeFile:",
					activeFile,
					"openFiles:",
					openFiles,
					"notebookFile:",
					notebookFile,
					"isOpen:",
					isNotebookOpen
				);

				if (isNotebookOpen && notebookFile) {
					// Append new analysis step to the current notebook (skip dataset search)
					addMessage(
						`Detected analysis request for the current notebook. Starting background code generation for: ${userMessage}`,
						false
					);
					// Run Agent in background (non-blocking)
					(async () => {
						try {
							const wsDir =
								findWorkspacePath({
									filePath: notebookFile,
									currentWorkspace: workspaceState.currentWorkspace,
								}) ||
								workspaceState.currentWorkspace ||
								"";
							if (!backendClient || !wsDir)
								throw new Error("Backend not ready");
							const agent = new AutonomousAgent(backendClient, wsDir);

							// Load existing notebook context into the agent
							try {
								const fileContent = await window.electronAPI.readFile(
									notebookFile
								);
								const nb = JSON.parse(fileContent);
								if (Array.isArray(nb?.cells)) {
									for (let idx = 0; idx < nb.cells.length; idx++) {
										const c = nb.cells[idx];
										if (c?.cell_type !== "code") continue;
										const srcArr: string[] = Array.isArray(c.source)
											? c.source
											: [];
										const code = srcArr.join("");
										if (code && code.trim().length > 0) {
											const id = `existing-cell-${idx}`;
											agent.addCodeToContext(id, code);
										}
									}
								}
							} catch (e) {
								console.warn("Failed to load notebook context:", e);
							}

							// Generate single step code for the new cell
							let stepCode = await agent.generateSingleStepCode(
								userMessage,
								userMessage,
								[], // Empty datasets array - notebook already has its context
								wsDir,
								0
							);

							// Strip markdown code fences if present
							stepCode = stepCode
								.replace(/^```(?:python)?\s*\n?/gm, "")
								.replace(/\n?```\s*$/gm, "")
								.trim();

							// Add the generated code as a new cell to the notebook
							const notebookService = (agent as any).notebookService;
							await notebookService.addCodeCell(notebookFile, stepCode);
							addMessage("✅ Added analysis step to the open notebook.", false);
						} catch (e) {
							addMessage(
								`Failed to append analysis step: ${
									e instanceof Error ? e.message : String(e)
								}`,
								false
							);
						}
					})().finally(() => {
						// Release chat UI after background operation completes
						resetLoadingState();
					});
					return;
				} else {
					// No active notebook but intent is ADD_CELL - treat as general analysis request
					// This handles cases like "add a cell for B-cell markers" when no notebook is open
					await handleAnalysisRequest(userMessage);
					return;
				}
			}
			// Handle low confidence intents or unrecognized intents as general questions
			else {
				console.log(
					`🤔 Low confidence (${intentResult.confidence}) or unhandled intent: ${intentResult.intent}. Treating as general question.`
				);
				// General question handling - send to backend LLM
				try {
					// Build lightweight context from recent messages
					const recent = (analysisState.messages || []).slice(-10);
					const context = recent
						.map((m: any) => {
							const text = typeof m.content === "string" ? m.content : "";
							const codeStr =
								typeof m.code === "string" && m.code.trim().length > 0
									? `\n\n\`\`\`${m.codeLanguage || "python"}\n${
											m.code
									  }\n\`\`\`\n`
									: "";
							return text + codeStr;
						})
						.filter(Boolean)
						.join("\n\n");

					const answer = await backendClient!.askQuestion({
						question: userMessage,
						context,
					});

					if (isMounted) {
						addMessage(answer || "(No answer received)", false);
					}
				} catch (error) {
					console.error("Error asking question to backend:", error);
					if (isMounted) {
						addMessage(
							"Sorry, I couldn't process your question right now. Please check your connection and try again.",
							false
						);
					}
				}
			}
		} catch (error) {
			console.error("Error processing message:", error);
			console.error("Error details:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				userMessage,
				backendClientExists: !!backendClient,
				backendClientUrl: backendClient?.getBaseUrl(),
			});
			if (isMounted) {
				addMessage("Sorry, I encountered an error. Please try again.", false);
			}
		} finally {
			if (isMounted) {
				resetLoadingState();
			}
		}
	}, [
		isLoading,
		backendClient,
		availableDatasets,
		selectedDatasets,
		workspaceState.currentWorkspace,
		analysisDispatch,
		scrollToBottomImmediate,
	]);

	// Removed redundant LLM event system - streaming handled by callbacks now
	const handleDatasetSelection = useCallback(
		async (selectedDatasetsArray: any[]) => {
			// Use the hook's selectDatasets function
			selectDatasets(selectedDatasetsArray);

			if (selectedDatasetsArray.length > 0) {
				// Give users a readable pause before auto-suggestions or downstream actions
				await new Promise((resolve) => setTimeout(resolve, 600));

				// Show initial selection message
				let responseContent = `## Selected ${selectedDatasetsArray.length} Datasets\n\n`;

				selectedDatasetsArray.forEach((dataset, index) => {
					responseContent += `### ${index + 1}. ${dataset.title}\n`;
					responseContent += `**ID:** ${dataset.id}\n`;
					if (dataset.description) {
						responseContent += `**Description:** ${dataset.description}\n`;
					}
					if (dataset.organism) {
						responseContent += `**Organism:** ${dataset.organism}\n`;
					}
					responseContent += `\n`;
				});


				addMessage(responseContent, false, undefined, undefined, undefined, {
					suggestions: [],
					recommended_approaches: [],
					data_insights: [],
					next_steps: [],
				});

				// Example queries UI will be rendered below the composer when datasets are selected

				// Per request: no analysis suggestions. Post only a concise single-cell tip when applicable.
				try {
					let dataTypes = selectedDatasets
						.map((d) => (d as any).dataType || (d as any).data_type || "")
						.filter(Boolean);
					if (dataTypes.length === 0) {
						dataTypes = selectedDatasets
							.map((dataset) => {
								const t = String((dataset as any).title || "").toLowerCase();
								const d = String(
									(dataset as any).description || ""
								).toLowerCase();
								const p = String((dataset as any).platform || "").toLowerCase();
								if (
									t.includes("single-cell") ||
									d.includes("single-cell") ||
									p.includes("single-cell")
								) {
									return "single_cell_expression";
								}
								return "";
							})
							.filter(Boolean);
					}
					const isSingleCell = (dataTypes || [])
						.map((x) => String(x).toLowerCase())
						.some((x) => x.includes("single") || x.includes("scrna"));
					if (isSingleCell) {
						addMessage(
							"Tip: For single-cell data, start with quality control (QC), then cluster cells (e.g., PCA/UMAP + Leiden), and identify marker genes for each cluster.",
							false
						);
					}
				} catch (e) {
					console.warn("Single-cell tip generation failed", e);
				}
			}
		},
		[
			suggestionsService,
			analysisState.messages,
			analysisDispatch,
			scrollToBottomImmediate,
		]
	);

	// Handle clicks on suggestion buttons
	useEffect(() => {
		const handleButtonClick = (e: Event) => {
			const target = e.target as HTMLElement;
			if (target && target.classList.contains("suggestion-button")) {
				const suggestion = target.getAttribute("data-suggestion");
				if (suggestion) {
					console.log("ChatPanel: Suggestion button clicked:", suggestion);

					// Set the clicked text as the next message
					setInputValue(suggestion);
					inputValueRef.current = suggestion;

					// Trigger send directly
					handleSendMessage();
				}
			}
		};

		document.addEventListener("click", handleButtonClick);
		return () => {
			document.removeEventListener("click", handleButtonClick);
		};
	}, [setInputValue]);

	// Handle clicks on analysis suggestion links (kept for backward compatibility)
	const handleAnalysisClick = useCallback(
		(analysisType: string) => {
			console.log("ChatPanel: Analysis clicked:", analysisType);

			// Just set the clicked text as the next message
			setInputValue(analysisType);
			inputValueRef.current = analysisType;

			// Trigger send directly
			handleSendMessage();
		},
		[setInputValue]
	);

	// Function to handle analysis requests
	const handleAnalysisRequest = useCallback(
		async (analysisRequest: string) => {
			if (selectedDatasets.length === 0) {
				addMessage("No datasets selected for analysis.", false);
				return;
			}

			try {
				setIsLoading(true);
				setProgressMessage("Starting analysis process...");

				// Reset agent instance for new analysis
				setAgentInstance(null);

				// Convert selected datasets preserving source and urls for the agent/LLM
				const datasets = selectedDatasets.map((dataset) => ({
					id: dataset.id,
					title: dataset.title,
					source: (dataset as any).source || "Unknown",
					organism: dataset.organism || "Unknown",
					samples:
						(dataset as any).samples ?? (dataset as any).sample_count ?? 0,
					platform: dataset.platform || "Unknown",
					description: dataset.description || "",
					// Pass through URL only if provided by the search source; do not invent URLs
					url: (dataset as any).url,
					// Preserve local dataset info (full path, folder flag, and alias) for downstream analysis
					localPath: (dataset as any).localPath,
					isLocalDirectory: (dataset as any).isLocalDirectory,
					alias: (dataset as any).alias,
				}));

				// Get the original query from the last user message
				const originalQuery =
					analysisState.messages.find((m: any) => m.isUser)?.content ||
					"Analysis of selected datasets";

				// Use the current workspace directory
				if (!workspaceState.currentWorkspace) {
					addMessage(
						"No workspace is currently open. Please open a workspace first.",
						false
					);
					return;
				}
				const workspaceDir = workspaceState.currentWorkspace;

				// Check if backendClient is available
				if (!validateBackendClient()) {
					return;
				}

				// Create AutonomousAgent instance (kernel name will be set after workspace is created)
				const agent = new AutonomousAgent(
					backendClient!,
					workspaceDir,
					undefined,
					undefined
				);
				agent.setStatusCallback((status) => {
					setProgressMessage(status);
					analysisDispatch({ type: "SET_ANALYSIS_STATUS", payload: status });
					// Only add important status updates to chat, not every minor update
					if (
						status.includes("workspace") ||
						status.includes("notebook") ||
						status.includes("steps") ||
						status.includes("⚠️") ||
						status.includes("fallback")
					) {
						addMessage(`${status}`, false);
					}
				});

				// Note: Validation errors now handled via events - see useEffect above

				// Store agent instance for reference (callbacks now handled via events)
				setAgentInstance(agent);

				// Generate analysis steps with user-specific request (events will handle UI updates)
				setProgressMessage("Generating analysis steps...");
				const analysisResult = await agent.executeAnalysisRequestWithData(
					analysisRequest, // Use the user's specific analysis request
					datasets
				);
				console.log(
					"Analysis result generated with",
					analysisResult.steps.length,
					"steps"
				);
				addMessage(
					`Generated ${analysisResult.steps.length} analysis steps!`,
					false
				);

				// Step 1: Create the initial notebook (empty)
				setProgressMessage("Creating initial notebook...");
				const notebookPath = await agent.generateUnifiedNotebook(
					originalQuery,
					datasets,
					analysisResult.steps,
					analysisResult.workingDirectory // Use the question-specific workspace
				);

				if (!notebookPath) {
					console.error("Failed to create notebook");
					addMessage("Failed to create notebook", false);
					setProgressMessage("");
					setIsProcessing(false);
					return;
				}

				console.log("Initial notebook created:", notebookPath);
				addMessage(
					`Initial notebook created: ${notebookPath.split("/").pop()}`,
					false
				);

				// Step 2: Open the notebook in the editor (wait for it to be ready)
				setProgressMessage("Opening notebook in editor...");
				addMessage("Notebook opened in editor", false);

				// Step 3: Start code generation in the background (non-blocking)
				setProgressMessage("Starting AI code generation in background...");
				(async () => {
					try {
						const ok = await agent.startNotebookCodeGeneration(
							notebookPath,
							originalQuery,
							datasets,
							analysisResult.steps,
							analysisResult.workingDirectory
						);
						if (!ok) {
							console.warn("Code generation completed with issues");
							addMessage(
								"Code generation completed with some issues. Check the notebook for details.",
								false
							);
						}
					} catch (e) {
						addMessage(
							`Code generation failed: ${
								e instanceof Error ? e.message : String(e)
							}`,
							false
						);
					} finally {
						// Release chat UI after background operation completes
						resetLoadingState();
					}
				})();

				// Step 4: Inform the user that generation is ongoing; final readiness will be posted on completion
				addMessage(
					`Notebook created and opened.\n\n` +
						`I'm now generating the analysis cells in the background.\n` +
						`I'll notify you when all cells have been added and are ready to run.`,
					false
				);

				// Analysis workspace created
				addMessage("Analysis workspace created.", false);

				// List files in the workspace for debugging
				try {
					const files = await window.electronAPI.listDirectory(
						analysisResult.workingDirectory
					);
					// Files in analysis workspace
					addMessage(`Workspace contains ${files.length} files`, false);
				} catch (error) {
					console.error("Error listing workspace files:", error);
				}

				addMessage("Analysis workspace created successfully!", false);
				addMessage(
					"Next steps:\n" +
						"• Wait for cells to finish generating (you'll get a confirmation)\n" +
						"• Then use notebook controls to run cells when ready",
					false
				);
			} catch (error) {
				console.error("Error starting analysis:", error);
				let errorMessage = `## Analysis Setup Failed\n\n`;
				errorMessage += `Error: ${
					error instanceof Error ? error.message : String(error)
				}\n\n`;
				errorMessage += `Troubleshooting:\n`;
				errorMessage += `- Check that Jupyter Lab is properly installed\n`;
				errorMessage += `- Ensure you have write permissions to the workspace\n`;
				errorMessage += `- Try restarting the application\n`;

				addMessage(errorMessage, false);
				// Reset processing state on failure
				resetLoadingState();
			}
		},
		[
			selectedDatasets,
			workspaceState.currentWorkspace,
			analysisDispatch,
			analysisState.messages,
		]
	);

	// Ensure first item is highlighted when menu opens or updates
	useEffect(() => {
		if (mentionOpen) {
			if (workspaceMentionItems.length > 0) {
				setActiveWorkspaceIndex(0);
			} else {
				setActiveWorkspaceIndex(-1);
			}
			if ((cellMentionItems || []).length > 0) {
				setActiveCellIndex(0);
			} else {
				setActiveCellIndex(-1);
			}
			if ((localRegistryRef.current?.list() || []).length > 0) {
				setActiveLocalIndex(0);
			} else {
				setActiveLocalIndex(-1);
			}
		}
	}, [mentionOpen]);

	useEffect(() => {
		if (!mentionOpen) return;
		if (workspaceMentionItems.length === 0) {
			setActiveWorkspaceIndex(-1);
		} else if (
			activeWorkspaceIndex < 0 ||
			activeWorkspaceIndex >= workspaceMentionItems.length
		) {
			setActiveWorkspaceIndex(0);
		}
		if (cellMentionItems.length === 0) {
			setActiveCellIndex(-1);
		} else if (
			activeCellIndex < 0 ||
			activeCellIndex >= cellMentionItems.length
		) {
			setActiveCellIndex(0);
		}
	}, [workspaceMentionItems, mentionOpen]);

	useEffect(() => {
		if (!mentionOpen) return;
		// Reset highlight on query change
		if (workspaceMentionItems.length > 0) {
			setActiveWorkspaceIndex(0);
		}
		if (cellMentionItems.length > 0) {
			setActiveCellIndex(0);
		}
	}, [mentionQuery]);

	const chooseWorkspaceMention = useCallback(
		async (index: number, sendAfter: boolean) => {
			if (index < 0 || index >= workspaceMentionItems.length) return;
			const item = workspaceMentionItems[index];
			const registry = localRegistryRef.current;
			let entry: any = item;
			if (registry && item.localPath) {
				try {
					const added = await registry.addFromPath(item.localPath);
					if (added) entry = added as any;
				} catch {
					// ignore add failure; we'll still insert alias text
				}
			}
			selectDatasets([entry]);
			const alias =
				entry.alias || (entry.title || entry.id).replace(/\s+/g, "_");
			const nextInput =
				inputValueRef.current.replace(/@([^\s@]*)$/, `@${alias}`) + " ";
			setInputValue(nextInput);
			inputValueRef.current = nextInput;
			setMentionOpen(false);
			setMentionQuery("");
			setWorkspaceMentionItems([]);
			setActiveWorkspaceIndex(-1);
			setActiveLocalIndex(-1);
			if (sendAfter) {
				// No longer sending automatically on Enter selection per UX
			}
		},
		[workspaceMentionItems, mergeSelectedDatasets, handleSendMessage]
	);

	// Choose from notebook cell mentions (for # context)
	const chooseCellMention = useCallback(
		async (index: number) => {
			if (index < 0 || index >= cellMentionItems.length) return;
			const item = cellMentionItems[index];
			const alias = String(item.alias || "");
			const current = inputValueRef.current || "";
			const next = /#[^\s#]*$/.test(current)
				? current.replace(/#([^\s#]*)$/, alias) + " "
				: (current.endsWith(" ") ? current : current + " ") + alias + " ";
			setInputValue(next);
			inputValueRef.current = next;
			setMentionOpen(false);
			setMentionQuery("");
			setWorkspaceMentionItems([]);
			setCellMentionItems([]);
			setActiveCellIndex(-1);
		},
		[cellMentionItems]
	);

	const handleComposerKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (!mentionOpen) return;
			const isHashContext = /#[^\s#]*$/.test(inputValueRef.current);
			const totalCells = cellMentionItems.length;
			const totalWs = workspaceMentionItems.length;
			// Navigate within mention list (cells when using #, workspace when using @)
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isHashContext && totalCells > 0) {
					setActiveCellIndex((prev) =>
						prev < 0 ? 0 : Math.min(prev + 1, totalCells - 1)
					);
				} else if (!isHashContext && totalWs > 0) {
					setActiveWorkspaceIndex((prev) =>
						prev < 0 ? 0 : Math.min(prev + 1, totalWs - 1)
					);
				}
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isHashContext && totalCells > 0) {
					setActiveCellIndex((prev) => (prev <= 0 ? 0 : prev - 1));
				} else if (!isHashContext && totalWs > 0) {
					setActiveWorkspaceIndex((prev) => (prev <= 0 ? 0 : prev - 1));
				}
				return;
			}
			if (e.key === "Enter") {
				const hasItems = isHashContext ? totalCells > 0 : totalWs > 0;
				if (hasItems) {
					e.preventDefault();
					if (isHashContext) {
						const index = activeCellIndex >= 0 ? activeCellIndex : 0;
						void chooseCellMention(index);
					} else {
						const index = activeWorkspaceIndex >= 0 ? activeWorkspaceIndex : 0;
						void chooseWorkspaceMention(index, false);
					}
				}
				// If no items, do not prevent default; let Composer send
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMentionOpen(false);
				setMentionQuery("");
				setWorkspaceMentionItems([]);
				setActiveWorkspaceIndex(-1);
				setActiveLocalIndex(-1);
				setActiveCellIndex(-1);
				return;
			}
		},
		[
			mentionOpen,
			workspaceMentionItems.length,
			cellMentionItems.length,
			activeWorkspaceIndex,
			activeCellIndex,
			chooseWorkspaceMention,
			chooseCellMention,
		]
	);

	const closeChat = () => {
		// Fully hide the chat panel and reset collapsed state
		uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: false });
		uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
	};

	// Intent detection moved to useChatIntent hook

	const handleStopProcessing = () => {
		try {
			// Abort any in-flight backend streams (dataset search, code generation)
			backendClient && (backendClient as any).abortAllRequests?.();
		} catch {}

		try {
			// Signal agent to stop further steps
			agentInstance?.stopAnalysis?.();
		} catch {}

		try {
			// Interrupt any running Jupyter cell execution for the current workspace
			const ws = workspaceState.currentWorkspace;
			if (ws) {
				// fire and forget
				void electronAPI.interruptJupyter(ws);
			}
		} catch {}

		try {
			// Cancel any ongoing virtual environment creation/installation
			void (window as any).electronAPI?.cancelVirtualEnv?.();
		} catch {}

		// Mark the most recent streaming message as cancelled so it doesn't stay pending
		try {
			for (let i = analysisState.messages.length - 1; i >= 0; i--) {
				const m = analysisState.messages[i] as any;
				if (m && m.isStreaming) {
					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: m.id,
							updates: {
								isStreaming: false,
								status: "failed" as any,
								content: `${m.content || ""}\n\nCancelled by user.`,
							},
						},
					});
					break;
				}
			}
		} catch {}

		resetLoadingState();
		addMessage("Processing stopped by user.", false);
	};

	// Debounced processing to avoid performance issues
	const debouncedCellProcessing = React.useRef<NodeJS.Timeout | null>(null);
	const debouncedMentionProcessing = React.useRef<NodeJS.Timeout | null>(null);
	const cellItemsCache = React.useRef<{
		activeFile: string;
		items: any[];
	} | null>(null);

	// Composer change handler with @-mention detection
	const handleComposerChange = useCallback(
		(next: string) => {
			setInputValue(next);
			inputValueRef.current = next;
			(window as any)._lastMentionChange = Date.now();
			// Support #N / #all shorthands only when a notebook is open
			const hashMatch = next.match(/#([^\s#]*)$/);
			if (hashMatch) {
				setMentionOpen(true);
				setMentionQuery(hashMatch[1] || "");

				// Clear any existing debounced processing
				if (debouncedCellProcessing.current) {
					clearTimeout(debouncedCellProcessing.current);
				}

				// Debounce expensive cell processing
				debouncedCellProcessing.current = setTimeout(async () => {
					try {
						// Only show cell items; hide files and local data
						const activeFile = (workspaceState as any).activeFile as
							| string
							| null;
						const ws = workspaceState.currentWorkspace || "";
						const rel = (p: string) =>
							ws && p && p.startsWith(ws) ? p.slice(ws.length + 1) : p;
						if (!activeFile || !activeFile.endsWith(".ipynb")) {
							setCellMentionItems([]);
							return;
						}

						// Check cache first to avoid re-reading the same file
						if (cellItemsCache.current?.activeFile === activeFile) {
							setCellMentionItems(cellItemsCache.current.items);
							return;
						}

						const fileContent = await window.electronAPI.readFile(activeFile);
						const nb = JSON.parse(fileContent);
						const items: any[] = [];
						const cells = Array.isArray(nb?.cells) ? nb.cells : [];
						for (let i = 0; i < cells.length; i++) {
							const c = cells[i];
							const srcArr: string[] = Array.isArray(c?.source) ? c.source : [];
							const firstLine =
								(srcArr.join("") || "")
									.split("\n")
									.find((l) => l.trim().length > 0) ||
								(c?.cell_type === "markdown" ? "markdown" : "code");
							const alias = `#${i + 1}`;
							items.push({
								id: `${activeFile}-${i}`,
								alias,
								title: `${rel(activeFile)} — ${firstLine.slice(0, 80)}`,
								localPath: activeFile,
								cellIndex: i + 1,
							});
						}
						// allow #all virtual item
						const allItem = {
							id: `${activeFile}-all`,
							alias: `#all`,
							title: `${rel(activeFile)} — all cells`,
							localPath: activeFile,
							cellIndex: undefined,
						};
						const q = (hashMatch[1] || "").toLowerCase();
						const filtered = q
							? [allItem, ...items].filter(
									(it) =>
										it.alias.toLowerCase().includes(q) ||
										(it.title || "").toLowerCase().includes(q)
							  )
							: [allItem, ...items];

						// Cache the results to avoid re-processing the same file
						cellItemsCache.current = { activeFile, items: [allItem, ...items] };

						setCellMentionItems(filtered);
						setWorkspaceMentionItems([]);
					} catch {
						setCellMentionItems([]);
					}
				}, 500); // 500ms debounce - longer delay for better performance
				return;
			}

			const match = next.match(/@([^\s@]*)$/);
			if (match) {
				setMentionOpen(true);
				setMentionQuery(match[1] || "");

				// Clear any existing debounced processing
				if (debouncedMentionProcessing.current) {
					clearTimeout(debouncedMentionProcessing.current);
				}

				// Debounce expensive mention processing
				debouncedMentionProcessing.current = setTimeout(async () => {
					// Skip heavy processing if query is still changing rapidly
					if (Date.now() - (window as any)._lastMentionChange < 100) return;
					try {
						if (!workspaceState.currentWorkspace) {
							setWorkspaceMentionItems([]);
							setCellMentionItems([]);
							return;
						}
						const wsRoot = workspaceState.currentWorkspace;
						const token = match[1] || "";
						const parts = token.split("/");
						const dirRel =
							parts.length > 1
								? parts.slice(0, -1).filter(Boolean).join("/")
								: "";
						const search = (parts.slice(-1)[0] || "").toLowerCase();

						const maxDepth = 3;
						const maxResults = 200;
						const queue: Array<{ full: string; rel: string; depth: number }> =
							[];
						const startFull = dirRel ? `${wsRoot}/${dirRel}` : wsRoot;
						const startRel = dirRel || "";
						queue.push({ full: startFull, rel: startRel, depth: 0 });
						const results: any[] = [];

						while (queue.length > 0 && results.length < maxResults) {
							const node = queue.shift()!;
							let res: any = await window.electronAPI.listDirectory(node.full);
							const entries = Array.isArray(res) ? res : res?.data || [];
							for (const e of entries) {
								const relAlias = node.rel ? `${node.rel}/${e.name}` : e.name;
								if (!search || e.name.toLowerCase().includes(search)) {
									results.push({
										id: `ws-${e.path}`,
										title: e.name,
										source: "Workspace",
										localPath: e.path,
										isLocalDirectory: !!e.isDirectory,
										alias: relAlias,
									});
									if (results.length >= maxResults) break;
								}
								if (e.isDirectory && node.depth < maxDepth) {
									queue.push({
										full: e.path,
										rel: relAlias,
										depth: node.depth + 1,
									});
								}
							}
						}

						setWorkspaceMentionItems(results);

						// Build notebook cell items from active .ipynb
						try {
							const activeFile = (workspaceState as any).activeFile as
								| string
								| null;
							const ws = workspaceState.currentWorkspace || "";
							const rel = (p: string) =>
								ws && p.startsWith(ws) ? p.slice(ws.length + 1) : p;
							if (activeFile && activeFile.endsWith(".ipynb")) {
								const fileContent = await window.electronAPI.readFile(
									activeFile
								);
								const nb = JSON.parse(fileContent);
								const items: any[] = [];
								const cells = Array.isArray(nb?.cells) ? nb.cells : [];
								for (let i = 0; i < cells.length; i++) {
									const c = cells[i];
									const srcArr: string[] = Array.isArray(c?.source)
										? c.source
										: [];
									const firstLine =
										(srcArr.join("") || "")
											.split("\n")
											.find((l) => l.trim().length > 0) ||
										(c?.cell_type === "markdown" ? "markdown" : "code");
									const alias = `${rel(activeFile)}#${i + 1}`;
									items.push({
										id: `${activeFile}-${i}`,
										alias,
										title: firstLine.slice(0, 80),
										localPath: activeFile,
										cellIndex: i + 1,
									});
								}
								// Filter by query
								const q = (match[1] || "").toLowerCase();
								const filtered = q
									? items.filter(
											(it) =>
												it.alias.toLowerCase().includes(q) ||
												(it.title || "").toLowerCase().includes(q)
									  )
									: items;
								setCellMentionItems(filtered);
							} else {
								setCellMentionItems([]);
							}
						} catch {
							setCellMentionItems([]);
						}
					} catch {
						setWorkspaceMentionItems([]);
						setCellMentionItems([]);
					}
				}, 500); // 500ms debounce - longer delay for better performance
			} else if (mentionOpen) {
				setMentionOpen(false);
				setMentionQuery("");
				setWorkspaceMentionItems([]);
				setCellMentionItems([]);
			}
		},
		[mentionOpen, workspaceState.currentWorkspace]
	);

	// Cleanup debounced processing on unmount or when active file changes
	React.useEffect(() => {
		return () => {
			if (debouncedCellProcessing.current) {
				clearTimeout(debouncedCellProcessing.current);
			}
			if (debouncedMentionProcessing.current) {
				clearTimeout(debouncedMentionProcessing.current);
			}
		};
	}, []);

	// Clear cache when active file changes
	React.useEffect(() => {
		const activeFile = (workspaceState as any).activeFile as string | null;
		if (
			cellItemsCache.current &&
			cellItemsCache.current.activeFile !== activeFile
		) {
			cellItemsCache.current = null;
		}
	}, [(workspaceState as any).activeFile]);

	// Support external requests to insert a mention into the composer (from cells)
	useEffect(() => {
		// Deduplicate rapid successive mention insertions
		let lastKey = "";
		let lastTs = 0;
		const DEDUPE_MS = 250;
		const onInsertMention = (e: Event) => {
			const ce = e as CustomEvent<{
				alias?: string;
				filePath?: string;
				selectedCode?: string;
				lineRange?: { start: number; end: number };
			}>;
			const alias = ce.detail?.alias || "";
			const fp = ce.detail?.filePath || "";
			// Intentionally ignore selectedCode and lineRange to avoid pasting code in chat

			if (!alias) return;
			const key = `${fp}|${alias}`;
			const now = Date.now();
			if (key === lastKey && now - lastTs < DEDUPE_MS) {
				return;
			}
			lastKey = key;
			lastTs = now;

			// Only insert the alias reference; do not paste code snippets
			const messageText = alias;

			const current = inputValueRef.current || "";
			const next =
				(current.endsWith(" ") || current.length === 0
					? current
					: current + " ") +
				messageText +
				" ";
			setInputValue(next);
			inputValueRef.current = next;
			setMentionOpen(false);
			setMentionQuery("");
			setWorkspaceMentionItems([]);
			setCellMentionItems([]);
			// Ensure chat is visible when mention is inserted
			try {
				if (!uiState.showChatPanel || uiState.chatCollapsed) {
					uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
					uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
				}
			} catch (_) {}
		};
		window.addEventListener(
			"chat-insert-mention",
			onInsertMention as EventListener
		);
		return () =>
			window.removeEventListener(
				"chat-insert-mention",
				onInsertMention as EventListener
			);
	}, []);

	const MessagesView = React.useMemo(() => {
		return (
			<div className="chat-messages" ref={chatContainerRef}>
				{analysisState.messages.map((message: any) => (
					<div key={message.id}>
						<ChatMessage
							message={message}
							onAnalysisClick={handleAnalysisClick}
						/>
						{(message.isStreaming || typeof message.code === "string") && (
							<div style={{ marginTop: "8px" }}>
								<CodeBlock
									code={message.code || ""}
									language={message.codeLanguage || "python"}
									title={message.codeTitle || ""}
									isStreaming={
										message.status === "pending" || !!message.isStreaming
									}
								/>
							</div>
						)}
					</div>
				))}

				{isProcessing && (
					<ProcessingIndicator
						text={
							analysisState.analysisStatus || progressMessage || "Processing"
						}
					/>
				)}

				<ValidationErrors errors={validationErrors} />

				<SearchProgressView progress={datasetSearchProgress} />


				<EnvironmentStatus
					virtualEnvStatus={virtualEnvStatus}
					showLog={showVirtualEnvLog}
					onToggleLog={() => setShowVirtualEnvLog(!showVirtualEnvLog)}
					isAutoExecuting={isAutoExecuting}
				/>

				{/* Loading dots at the end of chat */}
				{isProcessing && (
					<div className="loading-dots">
						<span>.</span>
						<span>.</span>
						<span>.</span>
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		analysisState.messages,
		isProcessing,
		progressMessage,
		validationErrors,
		datasetSearchProgress,
		virtualEnvStatus,
		showVirtualEnvLog,
		isAutoExecuting,
		availableDatasets,
		selectedDatasets,
	]);

	// Delete chat functions
	const handleDeleteChat = async (sessionId: string) => {
		try {
			const ws = workspaceState.currentWorkspace;
			if (!ws) return;

			// Remove from sessions list
			const updatedSessions = analysisState.chatSessions.filter(
				(s) => s.id !== sessionId
			);

			// Delete session data
			const sessionKey = `chat:session:${ws}:${sessionId}`;
			await electronAPI.storeSet(sessionKey, []);

			// Update sessions list
			const sessionsKey = `chat:sessions:${ws}`;
			await electronAPI.storeSet(sessionsKey, updatedSessions);

			// If deleting the active session, switch to the first available session or create new
			if (sessionId === analysisState.activeChatSessionId) {
				if (updatedSessions.length > 0) {
					analysisDispatch({
						type: "SET_ACTIVE_CHAT_SESSION",
						payload: updatedSessions[0].id,
					});
				} else {
					analysisDispatch({ type: "NEW_CHAT_SESSION" });
				}
			}

			// Update local state
			analysisDispatch({ type: "SET_CHAT_SESSIONS", payload: updatedSessions });
			setShowDeleteMenu(false);
		} catch (error) {
			console.error("Failed to delete chat:", error);
		}
	};

	const handleDeleteAllChats = async () => {
		try {
			const ws = workspaceState.currentWorkspace;
			if (!ws) return;

			// Delete all session data
			for (const session of analysisState.chatSessions) {
				const sessionKey = `chat:session:${ws}:${session.id}`;
				await electronAPI.storeSet(sessionKey, []);
			}

			// Clear sessions list
			const sessionsKey = `chat:sessions:${ws}`;
			await electronAPI.storeSet(sessionsKey, []);

			// Clear active session
			const activeKey = `chat:activeSession:${ws}`;
			await electronAPI.storeSet(activeKey, null);

			// Clear the local state immediately
			analysisDispatch({ type: "SET_CHAT_SESSIONS", payload: [] });
			analysisDispatch({ type: "SET_ACTIVE_CHAT_SESSION", payload: null });
			analysisDispatch({ type: "SET_CHAT_MESSAGES", payload: [] });

			// Create new chat session
			analysisDispatch({ type: "NEW_CHAT_SESSION" });
			setShowDeleteMenu(false);
		} catch (error) {
			console.error("Failed to delete all chats:", error);
		}
	};

	return (
		<div className={`chat-panel ${className || ""}`}>
			<div className="chat-header">
				<h3
					style={{
						margin: 0,
						fontSize: 13,
						color: "#bbb",
						fontWeight: 500,
						flex: 1,
						minWidth: 0,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
					title={(() => {
						const activeId = (analysisState as any).activeChatSessionId as
							| string
							| null;
						const sessions = ((analysisState as any).chatSessions ||
							[]) as Array<{
							id: string;
							title: string;
						}>;
						const active = sessions.find((s) => s.id === activeId);
						return active?.title || "Chat";
					})()}
				>
					{(() => {
						const activeId = (analysisState as any).activeChatSessionId as
							| string
							| null;
						const sessions = ((analysisState as any).chatSessions ||
							[]) as Array<{
							id: string;
							title: string;
						}>;
						const active = sessions.find((s) => s.id === activeId);
						return active?.title || "Chat";
					})()}
				</h3>
				<div
					style={{
						display: "flex",
						gap: 4,
						alignItems: "center",
						position: "relative",
					}}
				>
					{/* Pass through chatMode to Composer via props */}
					<Tooltip content="New chat" placement="bottom">
						<button
							onClick={() => {
								// Start a brand new chat session
								analysisDispatch({ type: "NEW_CHAT_SESSION" });
								clearSelectedDatasets();
								clearAvailableDatasets();
								setCurrentSuggestions(null);
								setSuggestionButtons([]);
								setProcessedEvents(new Set());
								setAgentInstance(null);
								setVirtualEnvStatus("");
								setShowHistoryMenu(false);
								setShowExamples(false);
								suggestionsService?.startNewConversation?.();
							}}
							className="chat-button"
						>
							<FiPlus />
						</button>
					</Tooltip>
					<Tooltip content="Chat history" placement="bottom">
						<button
							onClick={() => setShowHistoryMenu((v) => !v)}
							className="chat-button"
						>
							<FiClock />
						</button>
					</Tooltip>

					<Tooltip
						content={
							analysisState.isStreaming
								? "Collapse chat (streaming)"
								: "Close chat"
						}
						placement="bottom"
					>
						<button
							onClick={() => {
								// If streaming, prefer collapse to preserve ongoing progress
								if (analysisState.isStreaming) {
									uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: true });
								} else {
									closeChat();
								}
							}}
							className="chat-button"
						>
							<FiX />
						</button>
					</Tooltip>
					{showHistoryMenu && (
						<div
							style={{
								position: "absolute",
								right: 48,
								top: 28,
								background: "#2d2d30",
								border: "1px solid #3e3e42",
								borderRadius: 6,
								width: 320,
								maxHeight: 360,
								overflowY: "auto",
								overflowX: "hidden",
								zIndex: 10,
								boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
							}}
							onMouseLeave={() => setShowHistoryMenu(false)}
						>
							<div
								style={{
									padding: "8px 10px",
									color: "#999",
									fontSize: 12,
									borderBottom: "1px solid #3e3e42",
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									position: "relative",
								}}
							>
								<span>Sessions</span>
								<button
									style={{
										background: "none",
										border: "none",
										color: "#999",
										cursor: "pointer",
										fontSize: 14,
										padding: "2px 4px",
										borderRadius: "3px",
										lineHeight: 1,
									}}
									onClick={(e) => {
										e.stopPropagation();
										setShowDeleteMenu(!showDeleteMenu);
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "rgba(255,255,255,0.1)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "none";
									}}
								>
									⋯
								</button>
								{showDeleteMenu && (
									<div
										style={{
											position: "absolute",
											top: "100%",
											right: 0,
											background: "#3a3a3a",
											border: "1px solid #555",
											borderRadius: "4px",
											minWidth: "160px",
											boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
											zIndex: 20,
										}}
										onMouseLeave={() => setShowDeleteMenu(false)}
									>
										<div
											style={{
												padding: "8px 12px",
												fontSize: 12,
												color: "#ddd",
												cursor: "pointer",
												borderBottom: "1px solid #555",
											}}
											onClick={() => {
												if (
													window.confirm(
														"Are you sure you want to delete all chat history?"
													)
												) {
													handleDeleteAllChats();
												}
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.background =
													"rgba(255,255,255,0.1)";
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.background = "transparent";
											}}
										>
											Delete All Chats
										</div>
									</div>
								)}
							</div>
							{(((analysisState as any).chatSessions || []) as Array<any>)
								.length === 0 && (
								<div style={{ padding: 10, color: "#aaa", fontSize: 12 }}>
									No previous chats
								</div>
							)}
							{(() => {
								const sessions = ((analysisState as any).chatSessions ||
									[]) as Array<any>;
								if (sessions.length === 0) return null;

								const groupedSessions = groupSessionsByTime(sessions);
								const groupOrder = [
									"today",
									"yesterday",
									"2d ago",
									"3d ago",
									"this week",
									"older",
								];

								return groupOrder.map((groupKey) => {
									const groupSessions =
										groupedSessions[groupKey as keyof typeof groupedSessions];
									if (groupSessions.length === 0) return null;

									return (
										<div key={groupKey}>
											<div
												style={{
													padding: "8px 12px 4px 12px",
													color: "#666",
													fontSize: 11,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.5px",
													borderBottom:
														groupKey !== groupOrder[groupOrder.length - 1]
															? "1px solid #2a2a2a"
															: "none",
													marginBottom: 2,
												}}
											>
												{groupKey === "today"
													? "Today"
													: groupKey === "yesterday"
													? "Yesterday"
													: groupKey === "2d ago"
													? "2d ago"
													: groupKey === "3d ago"
													? "3d ago"
													: groupKey === "this week"
													? "This week"
													: "Older"}
											</div>
											{groupSessions.map((s: any) => {
												const isActive =
													s.id === (analysisState as any).activeChatSessionId;
												return (
													<div
														key={s.id}
														onClick={async () => {
															setShowHistoryMenu(false);
															if (
																s.id ===
																(analysisState as any).activeChatSessionId
															)
																return;
															analysisDispatch({
																type: "SET_ACTIVE_CHAT_SESSION",
																payload: s.id,
															});
															// Messages for the selected session will be loaded by context effect
															clearSelectedDatasets();
															clearAvailableDatasets();
															setCurrentSuggestions(null);
															setSuggestionButtons([]);
															setProcessedEvents(new Set());
															setAgentInstance(null);
															setVirtualEnvStatus("");
														}}
														style={{
															padding: "10px 12px",
															cursor: "pointer",
															display: "flex",
															flexDirection: "column",
															gap: 2,
															width: "100%",
															background: isActive ? "#37373d" : "transparent",
															position: "relative",
														}}
														onMouseEnter={(e) => {
															const deleteBtn = e.currentTarget.querySelector(
																".delete-chat-btn"
															) as HTMLElement;
															if (deleteBtn) deleteBtn.style.opacity = "1";
														}}
														onMouseLeave={(e) => {
															const deleteBtn = e.currentTarget.querySelector(
																".delete-chat-btn"
															) as HTMLElement;
															if (deleteBtn) deleteBtn.style.opacity = "0";
														}}
													>
														<div
															style={{
																color: "#ddd",
																fontSize: 13,
																whiteSpace: "nowrap",
																overflow: "hidden",
																textOverflow: "ellipsis",
																display: "flex",
																alignItems: "center",
																justifyContent: "space-between",
																gap: 8,
															}}
														>
															<span
																style={{
																	flex: 1,
																	minWidth: 0,
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																}}
															>
																{s.title || "Untitled"}
															</span>
															<button
																className="delete-chat-btn"
																style={{
																	background: "none",
																	border: "none",
																	color: "#999",
																	cursor: "pointer",
																	fontSize: 12,
																	padding: "2px",
																	borderRadius: "2px",
																	opacity: 0,
																	transition: "opacity 0.2s, background 0.2s",
																	flex: "0 0 auto",
																	width: "16px",
																	height: "16px",
																	display: "flex",
																	alignItems: "center",
																	justifyContent: "center",
																}}
																onClick={(e) => {
																	e.stopPropagation();
																	if (
																		window.confirm(
																			`Delete chat "${s.title || "Untitled"}"?`
																		)
																	) {
																		handleDeleteChat(s.id);
																	}
																}}
																onMouseEnter={(e) => {
																	e.currentTarget.style.background =
																		"rgba(255,255,255,0.1)";
																	e.currentTarget.style.color = "#ff6b6b";
																}}
																onMouseLeave={(e) => {
																	e.currentTarget.style.background = "none";
																	e.currentTarget.style.color = "#999";
																}}
															>
																<FiTrash2 size={12} />
															</button>
														</div>
														{s.lastMessagePreview && (
															<div
																style={{
																	color: "#999",
																	fontSize: 11,
																	whiteSpace: "nowrap",
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																}}
															>
																{s.lastMessagePreview}
															</div>
														)}
													</div>
												);
											})}
										</div>
									);
								});
							})()}
						</div>
					)}
				</div>
			</div>

			{MessagesView}

			<Composer
				ref={composerRef}
				value={inputValue}
				onChange={handleComposerChange}
				onSend={handleSendMessage}
				onStop={handleStopProcessing}
				isProcessing={isProcessing}
				isLoading={isLoading}
				onKeyDown={handleComposerKeyDown}
				mode={chatMode}
				onModeChange={(m) => setChatMode(m)}
				suggestedMentions={[]}
				onInsertAlias={(alias: string) => {
					const prev = inputValueRef.current || "";
					const needsSpace = prev.length > 0 && !prev.endsWith(" ");
					const next = `${prev}${needsSpace ? " " : ""}${alias} `;
					setInputValue(next);
					inputValueRef.current = next;
					setMentionOpen(false);
					setMentionQuery("");
				}}
			/>

			{/* @ mention suggestions menu */}
			<MentionSuggestions
				isOpen={mentionOpen}
				items={localRegistryRef.current?.list() || []}
				workspaceItems={workspaceMentionItems}
				cellItems={cellMentionItems}
				hideWorkspace={/#[^\s#]*$/.test(inputValueRef.current)}
				query={mentionQuery}
				onRemoveLocal={async (item) => {
					try {
						const registry = localRegistryRef.current;
						if (!registry) return;
						await registry.remove(item.id);
						// refresh items
						const updated = registry.list();
						// Filter against current query token
						const token = mentionQuery.toLowerCase();
						const filtered = token
							? updated.filter(
									(d) =>
										(d.alias || "").toLowerCase().includes(token) ||
										(d.title || "").toLowerCase().includes(token)
							  )
							: updated;
						// Update only local items; keep workspace/cell lists intact
						// Force re-render by toggling mention open briefly if needed
						// (not strictly necessary since props change)
						// No-op
					} catch (e) {
						// eslint-disable-next-line no-console
						console.warn("Failed to remove local mention", e);
					}
				}}
				hideLocal={true}
				hideFolders={false}
				activeWorkspaceIndex={activeWorkspaceIndex}
				activeLocalIndex={activeLocalIndex}
				activeCellIndex={activeCellIndex}
				onSelect={(item) => {
					const alias =
						item.alias || (item.title || item.id).replace(/\s+/g, "_");
					selectDatasets([item] as any);
					{
						const prev = inputValueRef.current || "";
						const next = prev.replace(/@([^\s@]*)$/, `@${alias}`) + " ";
						setInputValue(next);
						inputValueRef.current = next;
					}
					setMentionOpen(false);
					setMentionQuery("");
				}}
				onSelectWorkspace={async (item) => {
					const registry = localRegistryRef.current;
					let entry: any = item;
					if (registry) {
						const added = await registry.addFromPath(item.localPath);
						if (added) entry = added as any;
					}
					selectDatasets([entry]);
					const alias =
						entry.alias || (entry.title || entry.id).replace(/\s+/g, "_");
					{
						const prev = inputValueRef.current || "";
						const next = prev.replace(/@([^\s@]*)$/, `@${alias}`) + " ";
						setInputValue(next);
						inputValueRef.current = next;
					}
					setMentionOpen(false);
					setMentionQuery("");
				}}
				onSelectCell={(item) => {
					const alias = item.alias; // already relPath#N
					setInputValue(
						(prev) => prev.replace(/@([^\s@]*)$/, `@${alias}`) + " "
					);
					setMentionOpen(false);
					setMentionQuery("");
				}}
			/>

			{/* Suggestions removed per request */}

			{/* Dataset Selection Modal */}
			<DatasetSelectionModal
				isOpen={showDatasetModal}
				datasets={availableDatasets}
				onClose={() => setShowDatasetModal(false)}
				onConfirm={handleDatasetSelection}
				isLoading={false}
			/>
		</div>
	);
};
