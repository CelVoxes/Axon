import React, { useState, useRef, useEffect, useCallback } from "react";
import {
	useAnalysisContext,
	useUIContext,
	useWorkspaceContext,
} from "../../context/AppContext";
import { BackendClient } from "../../services/BackendClient";
import { SearchConfig } from "../../config/SearchConfig";
import { useChatIntent } from "../../hooks/useChatIntent";
import { DatasetSelectionModal } from "./DatasetSelectionModal";
import { ChatMessage } from "./ChatMessage";
import { FiMinimize2, FiMaximize2, FiPlus, FiClock, FiX } from "react-icons/fi";
import { CodeBlock } from "./shared/CodeBlock";
import { Composer } from "./Composer";
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

// Removed duplicated local code rendering. Use shared CodeBlock instead.

// Using Message interface from AnalysisContext

interface ChatPanelProps {
	className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
	const { isSuggestionsRequest, shouldSearchForDatasets, isAnalysisRequest } =
		useChatIntent();
	const { state: analysisState, dispatch: analysisDispatch } =
		useAnalysisContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();
	const { state: workspaceState } = useWorkspaceContext();
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const [progressData, setProgressData] = useState<any>(null);
	const [searchProgress, setSearchProgress] = useState<any>(null);
	const [showSearchDetails, setShowSearchDetails] = useState(false);
	const [validationErrors, setValidationErrors] = useState<string[]>([]);
	const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [suggestionButtons, setSuggestionButtons] = useState<string[]>([]);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState("");
	const [recentMessages, setRecentMessages] = useState<string[]>([]);
	const [processedEvents, setProcessedEvents] = useState<Set<string>>(
		new Set()
	);
	const [agentInstance, setAgentInstance] = useState<any>(null);
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [showVirtualEnvLog, setShowVirtualEnvLog] = useState(false);
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [selectedDatasets, setSelectedDatasets] = useState<any[]>([]);
	const [currentSuggestions, setCurrentSuggestions] =
		useState<DataTypeSuggestions | null>(null);
	const localRegistryRef = useRef<LocalDatasetRegistry | null>(null);
	const [showHistoryMenu, setShowHistoryMenu] = useState<boolean>(false);

	// Chat mode: "Agent" (default) or "Ask"
	const [chatMode, setChatMode] = useState<"Agent" | "Ask">("Agent");

	// Global code context to track all generated code across the conversation
	const [globalCodeContext, setGlobalCodeContext] = useState<
		Map<string, string>
	>(new Map());

	// rAF-batched streaming updates for smoother UI
	const rafStateRef = useRef<{
		pending: Record<string, string>;
		scheduled: boolean;
	}>({ pending: {}, scheduled: false });

	const scheduleRafUpdate = useCallback(() => {
		if (rafStateRef.current.scheduled) return;
		rafStateRef.current.scheduled = true;
		requestAnimationFrame(() => {
			const pending = rafStateRef.current.pending;
			rafStateRef.current.pending = {};
			rafStateRef.current.scheduled = false;
			for (const stepId of Object.keys(pending)) {
				const stream = activeStreams.current.get(stepId);
				if (!stream) continue;
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: { content: pending[stepId] },
					},
				});
			}
			// Keep view pinned to bottom during streaming if user is near bottom
			const container = chatContainerRef.current;
			if (container && chatAutoScrollRef.current) {
				container.scrollTop = container.scrollHeight;
			}
		});
	}, [analysisDispatch]);

	const enqueueStreamingUpdate = useCallback(
		(stepId: string, content: string) => {
			rafStateRef.current.pending[stepId] = content;
			scheduleRafUpdate();
		},
		[scheduleRafUpdate]
	);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const chatContainerRef = useRef<HTMLDivElement>(null);
	const chatAutoScrollRef = useRef<boolean>(true);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [mentionQuery, setMentionQuery] = useState("");
	const [workspaceMentionItems, setWorkspaceMentionItems] = useState<any[]>([]);
	const [cellMentionItems, setCellMentionItems] = useState<any[]>([]);
	const [activeLocalIndex, setActiveLocalIndex] = useState<number>(-1);
	const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState<number>(-1);
	const [activeCellIndex, setActiveCellIndex] = useState<number>(-1);

	// Selection-based code edit context (set when user triggers Ask Chat from a notebook cell)
	interface CodeEditContext {
		filePath?: string;
		cellIndex?: number;
		language?: string;
		selectedText: string;
		fullCode?: string;
		selectionStart?: number;
		selectionEnd?: number;
	}
	const [codeEditContext, setCodeEditContext] =
		useState<CodeEditContext | null>(null);

	// Prefill composer when user triggers chat-edit-selection from an editor
	useEffect(() => {
		const cleanup = EventManager.createManagedListener(
			"chat-edit-selection",
			(event) => {
				const detail = event.detail || {};
				const snippet: string = String(detail.selectedText || "");
				const lang: string = String(detail.language || "python");
				const prefix = `Please edit the selected ${lang} code.\n`;
				const fenced = "\n```" + lang + "\n" + snippet + "\n```\n";
				setInputValue(prefix + fenced);
				// Save edit context for in-place update on send
				setCodeEditContext({
					filePath: detail.filePath,
					cellIndex: detail.cellIndex,
					language: detail.language,
					selectedText: detail.selectedText,
					fullCode: detail.fullCode,
					selectionStart: detail.selectionStart,
					selectionEnd: detail.selectionEnd,
				});
				// Ensure chat opens and is focused
				if (!uiState.showChatPanel || uiState.chatCollapsed) {
					uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
					uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
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
			const prefix = `Please review the following ${lang} cell output and fix or suggest improvements.`;
			const body = `\n\nOutput:\n\n\`\`\`text\n${out}\n\`\`\`\n\nCode:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
			setInputValue(prefix + body);
			setCodeEditContext({
				filePath: d.filePath,
				cellIndex: d.cellIndex,
				language: d.language,
				selectedText: code,
				fullCode: code,
				selectionStart: 0,
				selectionEnd: code.length,
			});
			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
			}
		};
		const onFixError = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");
			const prefix = `The following ${lang} cell failed. Fix the code to resolve the error. Return only the corrected code.`;
			const body = `\n\nError Output:\n\n\`\`\`text\n${out}\n\`\`\`\n\nOriginal Code:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
			setInputValue(prefix + body);
			setCodeEditContext({
				filePath: d.filePath,
				cellIndex: d.cellIndex,
				language: d.language,
				selectedText: code,
				fullCode: code,
				selectionStart: 0,
				selectionEnd: code.length,
			});
			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
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
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
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
				console.log("✅ Backend URL retrieved:", backendUrl);
				const client = new BackendClient(backendUrl);
				setBackendClient(client);
				console.log("✅ BackendClient initialized with URL:", backendUrl);
			} catch (error) {
				console.error("Failed to get backend URL, using default:", error);
				const client = new BackendClient("http://localhost:8000");
				setBackendClient(client);
				console.log(
					"⚠️ BackendClient initialized with default URL: http://localhost:8000"
				);
			}
		};
		initBackendClient();
	}, []);

	// Analysis suggestions service
	const suggestionsService = React.useMemo(() => {
		if (!backendClient) return null;
		return new AnalysisOrchestrationService(backendClient);
	}, [backendClient]);

	// Add welcome message on first load
	// useEffect(() => {
	// 	if (analysisState.messages.length === 0) {
	// 		analysisDispatch({
	// 			type: "ADD_MESSAGE",
	// 			payload: {
	// 				content: ``,
	// 				isUser: false,
	// 			},
	// 		});
	// 	}
	// }, [analysisState.messages.length, analysisDispatch]);

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

		// Add event listeners
		window.addEventListener(
			"virtual-env-status",
			handleVirtualEnvStatus as EventListener
		);
		window.addEventListener(
			"jupyter-ready",
			handleJupyterReady as EventListener
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

			// Create new streaming message
			const messageId = `streaming-${stepId}`;
			activeStreams.current.set(stepId, { messageId, accumulatedCode: "" });

			analysisDispatch({
				type: "ADD_MESSAGE",
				payload: {
					id: messageId,
					content: `\`\`\`python\n`,
					isUser: false,
					isStreaming: true,
				},
			});

			// Mark global streaming as active
			updateGlobalStreamingFlag();
		};

		const handleCodeGenerationChunk = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationChunkEvent>;
			const { stepId, chunk } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (!stream) return;

			// Update accumulated code
			stream.accumulatedCode += chunk;

			// Format content and enqueue for rAF-batched update
			const content = `\`\`\`python\n${stream.accumulatedCode}\n\`\`\``;
			enqueueStreamingUpdate(stepId, content);
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
							content: `\`\`\`python\n${finalCode}\n\`\`\``,
							isStreaming: false,
							status: success ? "completed" : ("failed" as any),
						},
					},
				});

				// Clean up
				activeStreams.current.delete(stepId);
				updateGlobalStreamingFlag();
			}
		};

		const handleCodeGenerationFailed = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationFailedEvent>;
			const { stepId, stepDescription, error } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (stream) {
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
			}
		};

		const handleValidationError = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeValidationErrorEvent>;
			const { errors, warnings, originalCode, fixedCode } = customEvent.detail;

			// Set validation errors for display (UI will show them)
			setValidationErrors(errors);
			setValidationWarnings(warnings);

			// Also post a chat message summarizing the errors with optional diff
			try {
				const warningSuffix =
					warnings && warnings.length
						? ` and ${warnings.length} warning(s)`
						: "";
				let summary = `**Code validation found ${errors.length} error(s)${warningSuffix}.**`;
				const list = errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
				summary += `\n\n${list}`;
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
						} else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
							ops.push({ t: "+", s: newLines[j - 1] });
							j--;
						} else if (i > 0) {
							ops.push({ t: "-", s: oldLines[i - 1] });
							i--;
						}
					}
					ops.reverse();
					const diffBody = ops.map((o) => `${o.t}${o.s}`).join("\n");
					summary += `\n\n\`\`\`diff\n${diffBody}\n\`\`\``;
				}
				addMessage(summary, false);
			} catch (_) {
				// Ignore chat summary failures
			}
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
		};
	}, [analysisDispatch]); // Remove addMessage from deps since it's defined after this useEffect

	// Auto-scroll to bottom when new messages are added (only if near bottom)
	useEffect(() => {
		scrollToBottomImmediate();
	}, [analysisState.messages]);

	// Component lifecycle logging (disabled for performance)
	// useEffect(() => {
	// 	return () => {
	// 		console.log(`ChatPanel: Component unmounted with ID: ${componentId}`);
	// 	};
	// }, [componentId]);

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

	const updateMessage = useCallback(
		(
			messageId: string,
			updates: {
				content?: string;
				status?: "pending" | "completed" | "failed";
				isStreaming?: boolean;
				code?: string;
				codeLanguage?: string;
				codeTitle?: string;
			}
		) => {
			analysisDispatch({
				type: "UPDATE_MESSAGE",
				payload: {
					id: messageId,
					updates,
				},
			});
			scrollToBottomImmediate();
		},
		[analysisDispatch, scrollToBottomImmediate]
	);

	const updateProgressMessage = (message: string) => {
		setProgressMessage(message);
	};

	const updateProgressData = (data: {
		message: string;
		progress: number;
		step: string;
		datasetsFound?: number;
		currentTerm?: string;
	}) => {
		setProgressData(data);
		setSearchProgress(data);
		// Ensure search details are shown when we get progress updates
		if (!showSearchDetails) {
			setShowSearchDetails(true);
		}
	};

	// Merge datasets by id
	const mergeSelectedDatasets = useCallback((existing: any[], added: any[]) => {
		const byId = new Map<string, any>();
		existing.forEach((d) => d?.id && byId.set(d.id, d));
		added.forEach((d) => d?.id && byId.set(d.id, d));
		return Array.from(byId.values());
	}, []);

	// File/folder picker to attach local data
	const handleAttachLocalData = useCallback(async () => {
		try {
			const result = await electronAPI.showOpenDialog({
				title: "Select data files or folders",
				properties: ["openFile", "openDirectory", "multiSelections"],
			});
			if (!result.success || result.data?.canceled) return;
			const filePaths: string[] = result.data.filePaths || [];
			if (!filePaths.length) return;
			const registry = localRegistryRef.current;
			if (!registry) return;
			const added: LocalDatasetEntry[] = [];
			for (const p of filePaths) {
				// eslint-disable-next-line no-await-in-loop
				const entry = await registry.addFromPath(p);
				if (entry) added.push(entry);
			}
			if (added.length > 0) {
				setSelectedDatasets((prev) => mergeSelectedDatasets(prev, added));
				const names = added.map((d) => d.title).join(", ");
				addMessage(`Attached local data: ${names}`, false);
			}
		} catch (e) {
			console.error("Attach local data failed", e);
			addMessage("Failed to attach local data", false);
		}
	}, [addMessage, mergeSelectedDatasets]);

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
		} catch (_) {
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
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();

		// Ask mode: simple Q&A, no environment creation/editing/search
		if (chatMode === "Ask") {
			addMessage(userMessage, true);
			setInputValue("");
			setIsLoading(true);
			setIsProcessing(true);

			let isMounted = true;
			try {
				if (!backendClient) {
					addMessage(
						"Backend client not initialized. Please wait a moment and try again.",
						false
					);
					return;
				}
				// Build lightweight context from recent messages
				const recent = (analysisState.messages || []).slice(-10);
				const context = recent
					.map((m: any) => (typeof m.content === "string" ? m.content : ""))
					.filter(Boolean)
					.join("\n\n");
				const answer = await backendClient.askQuestion({
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
					setIsLoading(false);
					setIsProcessing(false);
					setProgressMessage("");
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
					const content = await window.electronAPI.readFile(activeFile);
					const nb = JSON.parse(content);
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
			} catch (_) {
				// ignore failures
			}
		}

		if (tokens.length > 0 || hashTokens.length > 0) {
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
						const candidatePath = pathPart.startsWith("/")
							? pathPart
							: wsRoot
							? `${wsRoot}/${pathPart}`
							: "";
						if (candidatePath) {
							try {
								const fileContent = await window.electronAPI.readFile(
									candidatePath
								);
								const nb = JSON.parse(fileContent);
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
									// Handle #N and #all against the active notebook
									try {
										const activeFile = (workspaceState as any).activeFile as
											| string
											| null;
										if (
											activeFile &&
											activeFile.endsWith(".ipynb") &&
											hashTokens.length > 0
										) {
											const content = await window.electronAPI.readFile(
												activeFile
											);
											const nb = JSON.parse(content);
											const cells = Array.isArray(nb?.cells) ? nb.cells : [];
											const wantAll = hashTokens.some(
												(t) => String(t).toLowerCase() === "all"
											);
											const targetIndices = wantAll
												? cells.map((_: unknown, i: number) => i)
												: hashTokens
														.map((t) => parseInt(String(t), 10))
														.filter(
															(n) =>
																Number.isInteger(n) &&
																n >= 1 &&
																n <= cells.length
														)
														.map((n) => n - 1);
											if (targetIndices.length > 0) {
												// Build combined context; prefer first for edit-in-place
												for (const idx0 of targetIndices) {
													const c = cells[idx0];
													if (!c) continue;
													const srcArr: string[] = Array.isArray(c.source)
														? c.source
														: [];
													const code = srcArr.join("");
													const lang =
														c.cell_type === "markdown" ? "markdown" : "python";
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
									} catch (_) {
										// ignore
									}
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
			setSelectedDatasets((prev) =>
				mergeSelectedDatasets(prev, allMentionDatasets)
			);
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
			// If user referenced a notebook cell and specified line ranges, show the referenced lines (code or output)
			if (cellMentionContext) {
				const wantOutput = /\boutput\b/i.test(userMessage);
				const lineMatch =
					userMessage.match(/lines?\s+(\d+)(?:\s*-\s*(\d+))?/i) ||
					userMessage.match(/line\s+(\d+)/i);
				if (lineMatch) {
					try {
						const startLineIdx = Math.max(1, parseInt(lineMatch[1] || "1", 10));
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
							snippet = outLines.slice(startLineIdx - 1, endLineIdx).join("\n");
						} else {
							const codeLines = (cellMentionContext.code || "").split(/\r?\n/);
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
					} catch (_) {
						// ignore snippet failures
					}
				}
			}
			// If message referenced a notebook cell via #N/#all, perform inline edit on the first referenced cell
			if (cellMentionContext) {
				if (!backendClient) {
					addMessage(
						"Backend not ready to edit code. Please try again in a moment.",
						false
					);
					return;
				}
				const wsPath = workspaceState.currentWorkspace || "";
				const notebookService = new NotebookService({ workspacePath: wsPath });

				const lang = (cellMentionContext.language || "python").toLowerCase();
				const originalSnippet = cellMentionContext.code || "";
				const filePath = cellMentionContext.filePath;
				const cellIndex = cellMentionContext.cellIndex0;
				const fullCode = originalSnippet;
				const selStart = 0;
				const selEnd = fullCode.length;
				const beforeSelection = fullCode.slice(0, selStart);
				const withinSelection = fullCode.slice(selStart, selEnd);
				const startLine = (beforeSelection.match(/\n/g)?.length ?? 0) + 1;
				const endLine = startLine + (withinSelection.match(/\n/g)?.length ?? 0);
				const fileName = filePath.split("/").pop() || filePath;

				addMessage(
					`Editing plan:\n\n- **Target**: cell ${cellIndex} in \`${fileName}\`\n- **Scope**: replace lines ${startLine}-${endLine} of the selected code\n- **Process**: I will generate the revised snippet (streaming below), then apply it to the notebook and confirm the save.`,
					false
				);
				const task =
					`Edit the following ${lang} code according to the user's instruction. ` +
					`Return a minimal set of line edits as pure JSON (no backticks, no prose). ` +
					`The JSON must be an array of objects with fields: startLine (1-based, inclusive), endLine (1-based, inclusive), replacement (string). ` +
					`Line numbers are relative to ONLY the provided selected snippet, not the whole file.`;

				let streamedResponse = "";
				const streamingMessageId = `edit-${Date.now()}`;
				analysisDispatch({
					type: "ADD_MESSAGE",
					payload: {
						id: streamingMessageId,
						content: "",
						isUser: false,
						isStreaming: true,
						code: "",
					},
				});

				try {
					await backendClient.generateCodeStream(
						{
							task_description: `${task}\n\nUser instruction:\n${userMessage}\n\nSelected snippet to edit (context only):\n\n\`\`\`${lang}\n${originalSnippet}\n\`\`\`\n\nReturn ONLY JSON edits.`,
							language: lang,
							context: "Notebook code edit-in-place",
						},
						(chunk: string) => {
							streamedResponse += chunk;
							analysisDispatch({
								type: "UPDATE_MESSAGE",
								payload: {
									id: streamingMessageId,
									updates: {
										content: `\n\nProposed edits (JSON, streaming):\n\n\`\`\`json\n${streamedResponse}\n\`\`\``,
										isStreaming: true,
									},
								},
							});
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
						payload: {
							id: streamingMessageId,
							updates: { isStreaming: false },
						},
					});
				}

				// Try to parse JSON line edits; fall back to full replacement
				const edits = parseJsonEdits(streamedResponse);
				const base = fullCode;
				const start = selStart;
				const end = selEnd;
				let newSelection: string;
				if (edits) {
					const withinEdited = applyLineEdits(withinSelection, edits);
					newSelection = withinEdited;
				} else {
					const cleanedFallback = stripCodeFences(streamedResponse);
					newSelection = cleanedFallback;
				}
				const newCode =
					base.substring(0, start) + newSelection + base.substring(end);

				await notebookService.updateCellCode(filePath, cellIndex, newCode);

				let updateDetail: any = null;
				try {
					const timeoutMs = 15000;
					const startWait = Date.now();
					while (Date.now() - startWait < timeoutMs) {
						const detail = await EventManager.waitForEvent<any>(
							"notebook-cell-updated",
							Math.max(1, timeoutMs - (Date.now() - startWait))
						);
						if (
							detail?.filePath === filePath &&
							detail?.cellIndex === cellIndex
						) {
							updateDetail = detail;
							break;
						}
					}
				} catch (_) {}

				const originalLineCount = withinSelection.split("\n").length;
				const newLineCount = newSelection.split("\n").length;
				const summary = `Applied notebook edit:\n\n- **Cell**: ${cellIndex}\n- **Lines**: ${startLine}-${endLine} (${originalLineCount} → ${newLineCount} lines)\n- **Status**: ${
					updateDetail?.success === false ? "save failed" : "saved"
				}`;

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
						} else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
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
					const newStart = oldStart;
					const headerA = `--- a/${file}:${oldStart}-${
						oldStart + oldCount - 1
					}`;
					const headerB = `+++ b/${file}:${newStart}-${
						newStart + newCount - 1
					}`;
					const hunk = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
					const body = ops.map((o) => `${o.t}${o.s}`).join("\n");
					return `${headerA}\n${headerB}\n${hunk}\n${body}`;
				};

				const unifiedDiff = buildUnifiedDiff(
					withinSelection,
					newSelection,
					fileName,
					startLine
				);
				addMessage(`${summary}\n\n\`\`\`diff\n${unifiedDiff}\n\`\`\``, false);
				return;
			}

			// If there is an active code edit context, perform edit-in-place and return early
			if (
				codeEditContext &&
				codeEditContext.filePath &&
				codeEditContext.cellIndex !== undefined
			) {
				if (!backendClient) {
					addMessage(
						"Backend not ready to edit code. Please try again in a moment.",
						false
					);
					return;
				}
				const wsPath = workspaceState.currentWorkspace || "";
				const notebookService = new NotebookService({ workspacePath: wsPath });

				// Build LLM prompt to transform only the selected snippet
				const lang = (codeEditContext.language || "python").toLowerCase();
				const originalSnippet = codeEditContext.selectedText || "";
				const filePath = codeEditContext.filePath;
				const cellIndex = codeEditContext.cellIndex;
				const fullCode = codeEditContext.fullCode ?? "";
				const selStart = Math.max(0, codeEditContext.selectionStart ?? 0);
				const selEnd = Math.min(
					fullCode.length,
					codeEditContext.selectionEnd ?? selStart
				);
				const beforeSelection = fullCode.slice(0, selStart);
				const withinSelection = fullCode.slice(selStart, selEnd);
				const startLine = (beforeSelection.match(/\n/g)?.length ?? 0) + 1;
				const endLine = startLine + (withinSelection.match(/\n/g)?.length ?? 0);
				const fileName = filePath.split("/").pop() || filePath;

				// Pre-change explanation in chat
				addMessage(
					`Editing plan:\n\n- **Target**: cell ${cellIndex} in \`${fileName}\`\n- **Scope**: replace lines ${startLine}-${endLine} of the selected code\n- **Process**: I will generate the revised snippet (streaming below), then apply it to the notebook and confirm the save.`,
					false
				);
				const task =
					`Edit the following ${lang} code according to the user's instruction. ` +
					`Return a minimal set of line edits as pure JSON (no backticks, no prose). ` +
					`The JSON must be an array of objects with fields: startLine (1-based, inclusive), endLine (1-based, inclusive), replacement (string). ` +
					`Line numbers are relative to ONLY the provided selected snippet, not the whole file.`;

				// Streaming accumulation (JSON edits)
				let streamedResponse = "";
				const streamingMessageId = `edit-${Date.now()}`;
				analysisDispatch({
					type: "ADD_MESSAGE",
					payload: {
						id: streamingMessageId,
						content: "",
						isUser: false,
						isStreaming: true,
						code: "",
					},
				});

				try {
					await backendClient.generateCodeStream(
						{
							task_description: `${task}\n\nUser instruction:\n${userMessage}\n\nSelected snippet to edit (context only):\n\n\`\`\`${lang}\n${originalSnippet}\n\`\`\`\n\nReturn ONLY JSON edits.`,
							language: lang,
							context: "Notebook code edit-in-place",
						},
						(chunk: string) => {
							streamedResponse += chunk;
							// Update streaming view as a code block
							analysisDispatch({
								type: "UPDATE_MESSAGE",
								payload: {
									id: streamingMessageId,
									updates: {
										content: `\n\nProposed edits (JSON, streaming):\n\n\`\`\`json\n${streamedResponse}\n\`\`\``,
										isStreaming: true,
									},
								},
							});
						}
					);
				} catch (e) {
					addMessage(
						`Code edit failed: ${e instanceof Error ? e.message : String(e)}`,
						false
					);
					return;
				} finally {
					// Close streaming state
					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: streamingMessageId,
							updates: { isStreaming: false },
						},
					});
				}

				// Try to parse JSON line edits; fall back to full replacement
				const edits = parseJsonEdits(streamedResponse);
				const base = fullCode;
				const start = selStart;
				const end = selEnd;
				let newSelection: string;
				if (edits) {
					const withinEdited = applyLineEdits(withinSelection, edits);
					newSelection = withinEdited;
				} else {
					const cleanedFallback = stripCodeFences(streamedResponse);
					newSelection = cleanedFallback;
				}
				const newCode =
					base.substring(0, start) + newSelection + base.substring(end);

				// Persist into the notebook cell
				await notebookService.updateCellCode(filePath, cellIndex, newCode);

				// Wait for confirmation of save from the editor
				let updateDetail: any = null;
				try {
					// Wait up to 15s for the matching notebook-cell-updated event
					const timeoutMs = 15000;
					const startWait = Date.now();
					while (Date.now() - startWait < timeoutMs) {
						const detail = await EventManager.waitForEvent<any>(
							"notebook-cell-updated",
							Math.max(1, timeoutMs - (Date.now() - startWait))
						);
						if (
							detail?.filePath === filePath &&
							detail?.cellIndex === cellIndex
						) {
							updateDetail = detail;
							break;
						}
					}
				} catch (_) {
					// ignore; we'll fall back to optimistic messaging below
				}

				const originalLineCount = withinSelection.split("\n").length;
				const newLineCount = newSelection.split("\n").length;
				const summary = `Applied notebook edit:\n\n- **Cell**: ${cellIndex}\n- **Lines**: ${startLine}-${endLine} (${originalLineCount} → ${newLineCount} lines)\n- **Status**: ${
					updateDetail?.success === false ? "save failed" : "saved"
				}`;

				// Build unified diff for the selection in GitHub style
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
						} else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
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
					const headerA = `--- a/${file}:${oldStart}-${
						oldStart + oldCount - 1
					}`;
					const headerB = `+++ b/${file}:${newStart}-${
						newStart + newCount - 1
					}`;
					const hunk = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
					const body = ops.map((o) => `${o.t}${o.s}`).join("\n");
					return `${headerA}\n${headerB}\n${hunk}\n${body}`;
				};

				const unifiedDiff = buildUnifiedDiff(
					withinSelection,
					newSelection,
					fileName,
					startLine
				);

				// Post-change summary with unified diff (CodeMessage renderer will show +adds/-dels as title)
				addMessage(`${summary}\n\n\`\`\`diff\n${unifiedDiff}\n\`\`\``, false);

				// Clear context after applying edit
				setCodeEditContext(null);
				return;
			}
			// Check if this is a request for suggestions or help
			if (isSuggestionsRequest(userMessage)) {
				await handleSuggestionsRequest(userMessage);
			}
			// Use intelligent detection to understand if user wants to search for datasets
			else if (shouldSearchForDatasets(userMessage)) {
				console.log("🔍 Detected search request for:", userMessage);
				// Search for datasets
				if (isMounted) {
					setProgressMessage("🔍 Searching for datasets...");
					setShowSearchDetails(true);
				}

				// Check if backendClient is available
				if (!backendClient) {
					if (isMounted) {
						addMessage(
							"❌ Backend client not initialized. Please wait a moment and try again.",
							false
						);
					}
					return;
				}

				// Set up progress callback for real-time updates
				backendClient.setProgressCallback((progress) => {
					if (isMounted) {
						updateProgressData(progress);
					}
				});

				// Initialize search progress
				if (isMounted) {
					setSearchProgress({
						message: "Initializing search...",
						progress: 0,
						step: "init",
						datasetsFound: 0,
					});
				}

				console.log("🔍 Starting search with query:", userMessage);
				console.log("🔍 BackendClient baseUrl:", backendClient.getBaseUrl());

				const response = await backendClient.discoverDatasets(userMessage, {
					limit: SearchConfig.getSearchLimit(),
				});

				console.log("🔍 Search response:", response);

				if (isMounted && response.datasets && response.datasets.length > 0) {
					setAvailableDatasets(response.datasets);
					setShowDatasetModal(true);

					let responseContent = `## 🔍 Found ${response.datasets.length} Datasets\n\n`;
					responseContent += `I found ${response.datasets.length} datasets that match your search. Please select the ones you'd like to analyze:\n\n`;

					response.datasets
						.slice(0, 5)
						.forEach((dataset: any, index: number) => {
							responseContent += `### ${index + 1}. ${dataset.title}\n`;
							responseContent += `**ID:** ${dataset.id}\n`;
							if (dataset.description) {
								responseContent += `**Description:** ${dataset.description.substring(
									0,
									200
								)}...\n`;
							}
							if (dataset.organism) {
								responseContent += `**Organism:** ${dataset.organism}\n`;
							}
							responseContent += `\n`;
						});

					if (response.datasets.length > 5) {
						responseContent += `*... and ${
							response.datasets.length - 5
						} more datasets*\n\n`;
					}

					responseContent += `**💡 Tip:** Select the datasets you want to analyze, then specify what analysis you'd like to perform.`;

					addMessage(responseContent, false);
				} else {
					console.log("❌ No datasets found. Response:", response);
					console.log("❌ Response.datasets:", response.datasets);
					console.log(
						"❌ Response.datasets.length:",
						response.datasets?.length
					);
					addMessage(
						"❌ No datasets found matching your search. Try different keywords or be more specific.",
						false
					);
				}

				// Keep progress visible for a moment, then clear
				setTimeout(() => {
					setSearchProgress(null);
					setShowSearchDetails(false);
				}, 2000);
			} else if (selectedDatasets.length > 0) {
				// User has selected datasets and is now specifying analysis
				await handleAnalysisRequest(userMessage);
			} else {
				// If there is an active notebook open, treat as incremental analysis instead of searching
				const activeFile = (workspaceState as any).activeFile as string | null;
				const isNotebookOpen = Boolean(
					activeFile && activeFile.endsWith(".ipynb")
				);
				const isAnalysis = isAnalysisRequest(userMessage);

				if (isNotebookOpen && isAnalysis) {
					// Append new analysis step to the current notebook (skip dataset search)
					addMessage(
						`Detected analysis request for the current notebook. I'll add a new step for: ${userMessage}`,
						false
					);
					// Reuse the handler below
					await (async () => {
						try {
							const wsDir = workspaceState.currentWorkspace || "";
							if (!backendClient || !wsDir)
								throw new Error("Backend not ready");
							const agent = new AutonomousAgent(backendClient, wsDir);
							const steps = [
								{
									id: "step_1",
									description: userMessage,
									code: "",
									status: "pending" as const,
								},
							];
							await agent.startNotebookCodeGeneration(
								activeFile!,
								userMessage,
								[],
								steps as any,
								wsDir,
								{ skipEnvCells: true }
							);
							addMessage("Added analysis step to the open notebook.", false);
						} catch (e) {
							addMessage(
								`Failed to append analysis step: ${
									e instanceof Error ? e.message : String(e)
								}`,
								false
							);
						}
					})();
				} else if (isAnalysis) {
					// Existing behavior: guide the user to dataset search if nothing is open/selected
					addMessage(
						`Analysis Request Detected!\n\n` +
							`I can help you with: ${userMessage}\n\n` +
							`However, I need to find relevant datasets first. Let me search for datasets related to your analysis:\n\n` +
							`Searching for: ${userMessage}`,
						false
					);
					setProgressMessage("Searching for relevant datasets...");
					setShowSearchDetails(true);
					if (!backendClient) {
						addMessage(
							"Backend client not initialized. Please wait a moment and try again.",
							false
						);
						return;
					}
					backendClient.setProgressCallback((progress) => {
						updateProgressData(progress);
					});
					setSearchProgress({
						message: "Initializing search...",
						progress: 0,
						step: "init",
						datasetsFound: 0,
					});
					const response = await backendClient.discoverDatasets(userMessage, {
						limit: 50,
					});
					if (response.datasets && response.datasets.length > 0) {
						setAvailableDatasets(response.datasets);
						setShowDatasetModal(true);
						let responseContent = `## Found ${response.datasets.length} Relevant Datasets\n\n`;
						responseContent += `I found ${response.datasets.length} datasets that could be used for your analysis. Please select the ones you'd like to work with:\n\n`;
						response.datasets
							.slice(0, 5)
							.forEach((dataset: any, index: number) => {
								responseContent += `### ${index + 1}. ${dataset.title}\n`;
								responseContent += `**ID:** ${dataset.id}\n`;
								if (dataset.description) {
									responseContent += `**Description:** ${dataset.description.substring(
										0,
										200
									)}...\n`;
								}
								if (dataset.organism) {
									responseContent += `**Organism:** ${dataset.organism}\n`;
								}
								responseContent += `\n`;
							});
						if (response.datasets.length > 5) {
							responseContent += `*... and ${
								response.datasets.length - 5
							} more datasets*\n\n`;
						}
						responseContent += `**💡 Tip:** Select the datasets you want to analyze, then I'll proceed with your analysis request.`;
						addMessage(responseContent, false);
					} else {
						addMessage(
							"No datasets found for your analysis request. Try being more specific about the disease, tissue, or organism you're interested in.",
							false
						);
					}
					setTimeout(() => {
						setSearchProgress(null);
						setShowSearchDetails(false);
					}, 2000);
				} else {
					// General conversation
					addMessage(
						"I'm here to help with bioinformatics analysis! You can:\n\n" +
							"• **Ask me to analyze data** (e.g., 'Assess transcriptional subtypes of AML')\n" +
							"• **Search for datasets** (e.g., 'Find AML gene expression data')\n" +
							"• **Ask for specific analysis** (e.g., 'Perform differential expression analysis')\n\n" +
							"You can also attach your own data by mentioning files/folders like @data.csv or @my_folder.",
						false
					);
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
				setIsLoading(false);
				setIsProcessing(false);
				setProgressMessage("");
			}
		}
	}, [
		inputValue,
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
		async (selectedDatasets: any[]) => {
			setShowDatasetModal(false);

			if (selectedDatasets.length > 0) {
				// Store selected datasets for analysis
				setSelectedDatasets(selectedDatasets);

				// Show initial selection message
				let responseContent = `## Selected ${selectedDatasets.length} Datasets\n\n`;

				selectedDatasets.forEach((dataset, index) => {
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

				responseContent += `Perfect! Here are some example queries you can try:\n\n`;

				addMessage(responseContent, false, undefined, undefined, undefined, {
					suggestions: [],
					recommended_approaches: [],
					data_insights: [],
					next_steps: [],
				});

				// Generate and surface short suggestions as clickable buttons
				try {
					// Build data types list from selected datasets
					let dataTypes = selectedDatasets
						.map((d) => (d as any).dataType || (d as any).data_type || "")
						.filter(Boolean);
					if (dataTypes.length === 0) {
						dataTypes = selectedDatasets.map((dataset) => {
							const title = String((dataset as any).title || "").toLowerCase();
							const description = String(
								(dataset as any).description || ""
							).toLowerCase();
							const platform = String(
								(dataset as any).platform || ""
							).toLowerCase();
							if (
								title.includes("single-cell") ||
								description.includes("single-cell") ||
								platform.includes("single-cell")
							) {
								return "single_cell_expression";
							}
							if (
								title.includes("rna-seq") ||
								description.includes("rna-seq") ||
								platform.includes("rna-seq")
							) {
								return "RNA-seq";
							}
							return "expression_matrix";
						});
						// Unique
						dataTypes = dataTypes.filter((dt, i, arr) => arr.indexOf(dt) === i);
					}

					let suggestedLabels: string[] | null = null;
					if (suggestionsService) {
						try {
							const s = await suggestionsService.generateSuggestions(
								dataTypes,
								`Analyze ${selectedDatasets.length} dataset(s)`,
								selectedDatasets as any,
								"Dataset selection context"
							);
							if (s?.suggestions?.length) {
								suggestedLabels = s.suggestions
									.map((x: any) => x.title)
									.slice(0, 3);
							}
						} catch (err) {
							console.log(
								"ChatPanel: Backend suggestions failed, using fallback:",
								err
							);
						}
					}

					if (!suggestedLabels) {
						const joined = dataTypes.join(", ").toLowerCase();
						if (
							joined.includes("single-cell") ||
							joined.includes("single_cell")
						) {
							suggestedLabels = [
								"Perform quality control",
								"Create cell clustering",
								"Identify marker genes",
							];
						} else if (joined.includes("rna-seq") || joined.includes("rna")) {
							suggestedLabels = [
								"Perform differential expression",
								"Create gene plots",
								"Analyze pathways",
							];
						} else {
							suggestedLabels = [
								"Perform exploratory analysis",
								"Create visualizations",
								"Run statistical tests",
							];
						}
					}

					if (suggestedLabels?.length) {
						setSuggestionButtons(suggestedLabels);
					}
				} catch (e) {
					console.warn("Suggestion generation failed", e);
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

	// Simple method to generate short suggestions (no backend call needed)
	const generateShortSuggestions = async (
		datasets: Dataset[]
	): Promise<string> => {
		if (datasets.length === 0) {
			return "No datasets selected. Please select one or more datasets to get analysis suggestions.";
		}

		try {
			console.log(
				"ChatPanel: Generating suggestions for datasets:",
				datasets.map((d) => d.title)
			);

			// Extract data types from datasets
			const dataTypes = datasets
				.map((d) => d.dataType || "unknown")
				.filter(Boolean);

			// Try to get suggestions from backend first
			try {
				const backendSuggestions =
					await suggestionsService!.generateSuggestions(
						dataTypes,
						`Analyze ${datasets.length} dataset(s)`,
						datasets,
						"Dataset selection context"
					);

				if (backendSuggestions.suggestions.length > 0) {
					// Store suggestions for button rendering
					const suggestions = backendSuggestions.suggestions.slice(0, 3);

					// Return a special marker that will be replaced with buttons
					return `SUGGESTIONS:${JSON.stringify(
						suggestions.map((s) => s.title)
					)}`;
				}
			} catch (backendError) {
				console.log(
					"ChatPanel: Backend suggestions failed, using fallback:",
					backendError
				);
			}

			// Fallback to local suggestion generation based on data type
			const dataType = dataTypes.join(", ");
			let fallbackSuggestions = [];
			if (dataType.includes("single-cell")) {
				fallbackSuggestions = [
					"Perform quality control",
					"Create cell clustering",
					"Identify marker genes",
				];
			} else if (dataType.includes("RNA-seq")) {
				fallbackSuggestions = [
					"Perform differential expression",
					"Create gene plots",
					"Analyze pathways",
				];
			} else {
				fallbackSuggestions = [
					"Perform exploratory analysis",
					"Create visualizations",
					"Run statistical tests",
				];
			}

			return `SUGGESTIONS:${JSON.stringify(fallbackSuggestions)}`;
		} catch (error) {
			console.error("ChatPanel: Error generating suggestions:", error);
			return `SUGGESTIONS:${JSON.stringify(["Perform exploratory analysis"])}`;
		}
	};

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

					// Simulate form submission after a brief delay to allow state update
					setTimeout(() => {
						const form = document.querySelector("form");
						if (form) {
							form.requestSubmit();
						}
					}, 10);
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

			// Simulate form submission after a brief delay to allow state update
			setTimeout(() => {
				const form = document.querySelector("form");
				if (form) {
					form.requestSubmit();
				}
			}, 10);
		},
		[setInputValue]
	);

	// Function to handle suggestions requests
	const handleSuggestionsRequest = useCallback(
		async (message: string) => {
			try {
				if (selectedDatasets.length > 0) {
					// Generate suggestions based on selected datasets
					let dataTypes = selectedDatasets
						.map((d) => d.dataType || d.data_type)
						.filter((dt) => dt && dt !== "unknown")
						.filter((dt, index, arr) => arr.indexOf(dt) === index);

					// If no data types found, infer from dataset information
					if (dataTypes.length === 0) {
						dataTypes = selectedDatasets
							.map((dataset) => {
								// Infer data type from dataset information
								const title = dataset.title?.toLowerCase() || "";
								const description = dataset.description?.toLowerCase() || "";
								const platform = dataset.platform?.toLowerCase() || "";

								if (
									title.includes("single-cell") ||
									description.includes("single-cell") ||
									platform.includes("single-cell")
								) {
									return "single_cell_expression";
								} else if (
									title.includes("expression") ||
									description.includes("expression") ||
									platform.includes("expression")
								) {
									return "expression_matrix";
								} else if (
									title.includes("clinical") ||
									description.includes("clinical")
								) {
									return "clinical_data";
								} else if (
									title.includes("sequence") ||
									description.includes("sequence") ||
									platform.includes("sequencing")
								) {
									return "sequence_data";
								} else if (
									title.includes("variant") ||
									description.includes("variant")
								) {
									return "variant_data";
								} else if (
									title.includes("array") ||
									platform.includes("array")
								) {
									return "expression_matrix"; // Microarray data
								} else {
									return "expression_matrix"; // Default to expression matrix
								}
							})
							.filter((dt, index, arr) => arr.indexOf(dt) === index);
					}

					if (dataTypes.length > 0 && suggestionsService) {
						try {
							const suggestions = await suggestionsService.generateSuggestions(
								dataTypes,
								message,
								selectedDatasets
							);

							if (
								suggestions &&
								(suggestions.suggestions.length > 0 ||
									suggestions.recommended_approaches.length > 0)
							) {
								addMessage(
									"",
									false,
									undefined,
									undefined,
									undefined,
									suggestions
								);
							} else {
								addMessage(
									`Based on your selected datasets with ${dataTypes.join(
										", "
									)} data, I recommend starting with exploratory data analysis, quality control checks, then statistical analysis or visualization depending on your research goals.`,
									false
								);
							}
						} catch (error) {
							console.error("ChatPanel: Error generating suggestions:", error);
							addMessage(
								`Based on your ${selectedDatasets.length} selected datasets, I recommend starting with data loading and exploration, followed by quality assessment and then statistical analysis appropriate for your data type.`,
								false
							);
						}
					} else {
						addMessage(
							"General Analysis Suggestions:\n\n" +
								"Since I don't have specific data type information, here are some general analyses you can perform:\n\n" +
								"• **Exploratory Data Analysis**: Load and examine your data structure\n" +
								"• **Quality Control**: Check data quality and identify potential issues\n" +
								"• **Statistical Analysis**: Perform basic statistical tests\n" +
								"• **Visualization**: Create plots and charts to understand patterns\n" +
								"• **Differential Analysis**: Compare conditions or groups\n\n" +
								"Tip: Be specific about what you want to analyze, and I'll provide more targeted suggestions!",
							false
						);
					}
				} else {
					// No datasets selected, provide general suggestions
					addMessage(
						"Getting Started Suggestions:\n\n" +
							"Here are some ways you can get started with bioinformatics analysis:\n\n" +
							"### **1. Search for Datasets**\n" +
							'• "Search for single-cell RNA-seq data from cancer samples"\n' +
							'• "Find gene expression datasets related to Alzheimer\'s disease"\n' +
							'• "Look for clinical data with molecular profiles"\n\n' +
							"### **2. Common Analysis Types**\n" +
							"• **Single-cell analysis**: Clustering, trajectory analysis, cell type identification\n" +
							"• **Bulk RNA-seq**: Differential expression, pathway analysis, visualization\n" +
							"• **Clinical data**: Statistical analysis, survival analysis, correlation studies\n" +
							"• **Multi-omics**: Integration of different data types\n\n" +
							"### **3. Example Queries**\n" +
							'• "Find datasets about breast cancer and perform differential expression analysis"\n' +
							'• "Search for single-cell data from brain tissue and identify cell types"\n' +
							'• "Analyze clinical data with gene expression profiles"\n\n' +
							"Tip: Start by searching for datasets related to your research question, then I'll provide specific analysis suggestions!",
						false
					);
				}
			} catch (error) {
				console.error("Error generating suggestions:", error);
				addMessage(
					"Sorry, I encountered an error generating suggestions. Please try again.",
					false
				);
			}
		},
		[
			selectedDatasets,
			suggestionsService,
			analysisDispatch,
			scrollToBottomImmediate,
		]
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
				if (!backendClient) {
					addMessage(
						"Backend client not initialized. Please wait a moment and try again.",
						false
					);
					return;
				}

				// Create AutonomousAgent instance (kernel name will be set after workspace is created)
				const agent = new AutonomousAgent(
					backendClient,
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

				// Step 3: Now start code generation and streaming to chat
				setProgressMessage("Starting AI code generation...");
				const codeGenSuccess = await agent.startNotebookCodeGeneration(
					notebookPath,
					originalQuery,
					datasets,
					analysisResult.steps,
					analysisResult.workingDirectory
				);

				if (!codeGenSuccess) {
					console.warn("Code generation completed with issues");
					addMessage(
						"Code generation completed with some issues. Check the notebook for details.",
						false
					);
				}

				// Step 4: Notify user that cells are ready for manual execution
				addMessage(
					`Notebook Ready!\n\n` +
						`The notebook has been created and opened with all cells added.\n\n` +
						`**What's ready:**\n` +
						`• All analysis cells have been added to the notebook\n` +
						`• Cells are ready for manual execution\n` +
						`• No automatic execution - you have full control\n\n` +
						`**You can:**\n` +
						`• Run cells one by one using "Run Next Cell"\n` +
						`• Run all cells using "Run All Steps"\n` +
						`• Execute individual cells using their own "Run" buttons\n` +
						`• Review code before execution`,
					false
				);

				// Analysis workspace created
				addMessage("Analysis workspace ready!", false);
				addMessage(
					"Notebook created and populated with:\n" +
						"• Package installation cell\n" +
						"• Data download and loading cell\n" +
						"• Complete analysis pipeline cells\n" +
						"• All cells ready for manual execution",
					false
				);

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
					"Ready to analyze:\n" +
						"• Notebook is open with all cells added\n" +
						"• All cells are ready for manual execution\n" +
						"• Use notebook controls to run cells when ready",
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
			} finally {
				setIsLoading(false);
				setIsProcessing(false);
				setProgressMessage("");
			}
		},
		[
			selectedDatasets,
			workspaceState.currentWorkspace,
			analysisDispatch,
			analysisState.messages,
		]
	);

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const next = e.target.value;
		setInputValue(next);
		// Basic mention detection: open menu after '@' and while token is current
		const caret = e.target.selectionStart || next.length;
		const uptoCaret = next.slice(0, caret);
		const match = uptoCaret.match(/@([^\s@]*)$/);
		if (match) {
			setMentionOpen(true);
			setMentionQuery(match[1] || "");
		} else if (mentionOpen) {
			setMentionOpen(false);
			setMentionQuery("");
		}

		// Auto-resize textarea
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
	};

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
			setSelectedDatasets((prev) => mergeSelectedDatasets(prev, [entry]));
			const alias =
				entry.alias || (entry.title || entry.id).replace(/\s+/g, "_");
			const nextInput = inputValue.replace(/@([^\s@]*)$/, `@${alias}`) + " ";
			setInputValue(nextInput);
			setMentionOpen(false);
			setMentionQuery("");
			setWorkspaceMentionItems([]);
			setActiveWorkspaceIndex(-1);
			setActiveLocalIndex(-1);
			if (sendAfter) {
				// No longer sending automatically on Enter selection per UX
			}
		},
		[
			workspaceMentionItems,
			inputValue,
			mergeSelectedDatasets,
			handleSendMessage,
		]
	);

	// Choose from notebook cell mentions (for # context)
	const chooseCellMention = useCallback(
		async (index: number) => {
			if (index < 0 || index >= cellMentionItems.length) return;
			const item = cellMentionItems[index];
			const alias = String(item.alias || "");
			setInputValue((prev) => {
				if (/#[^\s#]*$/.test(prev)) {
					return prev.replace(/#([^\s#]*)$/, alias) + " ";
				}
				return (prev.endsWith(" ") ? prev : prev + " ") + alias + " ";
			});
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
			const isHashContext = /#[^\s#]*$/.test(inputValue);
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
				e.preventDefault();
				if (isHashContext && totalCells > 0) {
					const index = activeCellIndex >= 0 ? activeCellIndex : 0;
					void chooseCellMention(index);
				} else if (!isHashContext && totalWs > 0) {
					const index = activeWorkspaceIndex >= 0 ? activeWorkspaceIndex : 0;
					void chooseWorkspaceMention(index, false);
				}
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
			inputValue,
			workspaceMentionItems.length,
			cellMentionItems.length,
			activeWorkspaceIndex,
			activeCellIndex,
			chooseWorkspaceMention,
			chooseCellMention,
		]
	);

	const toggleChat = () => {
		uiDispatch({
			type: "SET_CHAT_COLLAPSED",
			payload: !uiState.chatCollapsed,
		});
	};

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

		setIsLoading(false);
		setIsProcessing(false);
		setProgressMessage("");
		addMessage("Processing stopped by user.", false);
	};

	// Composer change handler with @-mention detection
	const handleComposerChange = useCallback(
		(next: string) => {
			setInputValue(next);
			// Support #N / #all shorthands only when a notebook is open
			const hashMatch = next.match(/#([^\s#]*)$/);
			if (hashMatch) {
				setMentionOpen(true);
				setMentionQuery(hashMatch[1] || "");
				(async () => {
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
						setCellMentionItems(filtered);
						setWorkspaceMentionItems([]);
					} catch {
						setCellMentionItems([]);
					}
				})();
				return;
			}

			const match = next.match(/@([^\s@]*)$/);
			if (match) {
				setMentionOpen(true);
				setMentionQuery(match[1] || "");
				(async () => {
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
				})();
			} else if (mentionOpen) {
				setMentionOpen(false);
				setMentionQuery("");
				setWorkspaceMentionItems([]);
				setCellMentionItems([]);
			}
		},
		[mentionOpen, workspaceState.currentWorkspace]
	);

	// Support external requests to insert a mention into the composer (from cells)
	useEffect(() => {
		const onInsertMention = (e: Event) => {
			const ce = e as CustomEvent<{ alias?: string; filePath?: string }>;
			const alias = ce.detail?.alias;
			if (!alias) return;
			setInputValue(
				(prev) =>
					(prev.endsWith(" ") || prev.length === 0 ? prev : prev + " ") +
					alias +
					" "
			);
			setMentionOpen(false);
			setMentionQuery("");
			setWorkspaceMentionItems([]);
			setCellMentionItems([]);
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
						{message.code && (
							<div style={{ marginTop: "8px" }}>
								<CodeBlock
									code={message.code}
									language={message.codeLanguage || "python"}
									title={message.codeTitle || "Generated Code"}
									isStreaming={message.status === "pending"}
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

				<SearchProgressView progress={searchProgress} />

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
		searchProgress,
		virtualEnvStatus,
		showVirtualEnvLog,
		isAutoExecuting,
	]);

	return (
		<div className={`chat-panel ${className || ""}`}>
			<div className="chat-header">
				<h3 style={{ margin: 0, fontSize: 14, color: "#ddd", flex: 1 }}>
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
					<button
						onClick={() => {
							// Start a brand new chat session
							analysisDispatch({ type: "NEW_CHAT_SESSION" });
							setSelectedDatasets([]);
							setAvailableDatasets([]);
							setCurrentSuggestions(null);
							setSuggestionButtons([]);
							setProcessedEvents(new Set());
							setAgentInstance(null);
							setVirtualEnvStatus("");
							setShowHistoryMenu(false);
							suggestionsService?.startNewConversation?.();
						}}
						className="chat-button"
						title="New Chat"
					>
						<FiPlus />
					</button>
					<button
						onClick={() => setShowHistoryMenu((v) => !v)}
						className="chat-button"
						title="Chat History"
					>
						<FiClock />
					</button>

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
						title={
							analysisState.isStreaming
								? "Collapse Chat (streaming)"
								: "Close Chat"
						}
					>
						<FiX />
					</button>
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
								}}
							>
								Sessions
							</div>
							{(((analysisState as any).chatSessions || []) as Array<any>)
								.length === 0 && (
								<div style={{ padding: 10, color: "#aaa", fontSize: 12 }}>
									No previous chats
								</div>
							)}
							{(((analysisState as any).chatSessions || []) as Array<any>).map(
								(s: any) => {
									const isActive =
										s.id === (analysisState as any).activeChatSessionId;
									return (
										<div
											key={s.id}
											onClick={async () => {
												setShowHistoryMenu(false);
												if (s.id === (analysisState as any).activeChatSessionId)
													return;
												analysisDispatch({
													type: "SET_ACTIVE_CHAT_SESSION",
													payload: s.id,
												});
												// Messages for the selected session will be loaded by context effect
												setSelectedDatasets([]);
												setAvailableDatasets([]);
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
											}}
										>
											<div
												style={{
													color: "#ddd",
													fontSize: 13,
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
												}}
											>
												{s.title || "Untitled"}
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
								}
							)}
						</div>
					)}
				</div>
			</div>

			{MessagesView}

			<Composer
				value={inputValue}
				onChange={handleComposerChange}
				onSend={handleSendMessage}
				onStop={handleStopProcessing}
				isProcessing={isProcessing}
				isLoading={isLoading}
				onKeyDown={handleComposerKeyDown}
				mode={chatMode}
				onModeChange={(m) => setChatMode(m)}
			/>

			{/* @ mention suggestions menu */}
			<MentionSuggestions
				isOpen={mentionOpen}
				items={localRegistryRef.current?.list() || []}
				workspaceItems={workspaceMentionItems}
				cellItems={cellMentionItems}
				hideWorkspace={/#[^\s#]*$/.test(inputValue)}
				query={mentionQuery}
				hideLocal={true}
				hideFolders={false}
				activeWorkspaceIndex={activeWorkspaceIndex}
				activeLocalIndex={activeLocalIndex}
				activeCellIndex={activeCellIndex}
				onSelect={(item) => {
					const alias =
						item.alias || (item.title || item.id).replace(/\s+/g, "_");
					setSelectedDatasets((prev) =>
						mergeSelectedDatasets(prev, [item] as any)
					);
					setInputValue(
						(prev) => prev.replace(/@([^\s@]*)$/, `@${alias}`) + " "
					);
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
					setSelectedDatasets((prev) => mergeSelectedDatasets(prev, [entry]));
					const alias =
						entry.alias || (entry.title || entry.id).replace(/\s+/g, "_");
					setInputValue(
						(prev) => prev.replace(/@([^\s@]*)$/, `@${alias}`) + " "
					);
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

			{/* Suggestion Buttons */}
			{suggestionButtons.length > 0 && (
				<div
					style={{
						padding: "16px",
						display: "flex",
						gap: "8px",
						flexWrap: "wrap",
						borderTop: "1px solid #444",
					}}
				>
					{suggestionButtons.map((suggestion, index) => (
						<button
							key={index}
							onClick={() => {
								setInputValue(suggestion);
								setSuggestionButtons([]); // Clear buttons after click
								setTimeout(() => {
									const form = document.querySelector("form");
									if (form) {
										form.requestSubmit();
									}
								}, 10);
							}}
							style={{
								background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
								color: "white",
								border: "none",
								padding: "8px 16px",
								borderRadius: "20px",
								cursor: "pointer",
								fontSize: "14px",
								fontWeight: "500",
							}}
						>
							{suggestion}
						</button>
					))}
				</div>
			)}

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
