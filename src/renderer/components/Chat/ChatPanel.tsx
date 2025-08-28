import { Tooltip } from "@components/shared/Tooltip";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
	useAnalysisContext,
	useUIContext,
	useWorkspaceContext,
} from "../../context/AppContext";
import { BackendClient } from "../../services/backend/BackendClient";
import { useDatasetSearch } from "./hooks/useDatasetSearch";
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
import { CodeBlock } from "../shared/CodeBlock";
import { Composer, ComposerRef } from "./Composer";
import { MentionSuggestions } from "./MentionSuggestions";
import { ProcessingIndicator } from "./Status/ProcessingIndicator";
import { ValidationErrors } from "./Status/ValidationErrors";
import { ValidationSuccess } from "./Status/ValidationSuccess";
import { SearchProgress as SearchProgressView } from "./Status/SearchProgress";
import { EnvironmentStatus } from "./Status/EnvironmentStatus";
import { AutonomousAgent } from "../../services/analysis/AutonomousAgent";
import { NotebookCodeGenerationService } from "../../services/notebook/NotebookCodeGenerationService";
import {
	LocalDatasetRegistry,
	LocalDatasetEntry,
} from "../../services/chat/LocalDatasetRegistry";
import { electronAPI } from "../../utils/electronAPI";

import { AnalysisOrchestrationService } from "../../services/chat/AnalysisOrchestrationService";
import { ExamplesComponent } from "./AnalysisSuggestionsComponent";
// EventManager already imported above; avoid duplicate imports

import { groupSessionsByTime } from "./ChatPanelUtils";
import { useCodeGenerationEvents } from "./hooks/useCodeGenerationEvents";
import { useVirtualEnvEvents } from "./hooks/useVirtualEnvEvents";
import { useChatEvents } from "./hooks/useChatEvents";
import { useChatUIState } from "./hooks/useChatUIState";
import { useChatInteractions } from "./hooks/useChatInteractions";
import { NotebookEditingService } from "../../services/chat/NotebookEditingService";
import { DatasetResolutionService } from "../../services/chat/DatasetResolutionService";
import { ChatCommunicationService } from "../../services/chat/ChatCommunicationService";

// Removed duplicated local code rendering. Use shared CodeBlock instead.

// Using Message interface from AnalysisContext

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
	// UI State Management with custom hook
	const {
		inputValue,
		isLoading,
		progressMessage,
		isProcessing,
		progressData,
		validationErrors,
		validationSuccessMessage,
		suggestionButtons,
		virtualEnvStatus,
		recentMessages,
		showAllMessages,
		processedEvents,
		agentInstance,
		showVirtualEnvLog,
		isAutoExecuting,
		currentSuggestions,
		showHistoryMenu,
		setInputValue,
		setIsLoading,
		setProgressMessage,
		setIsProcessing,
		setProgressData,
		setValidationErrors,
		setValidationSuccessMessage,
		setSuggestionButtons,
		setVirtualEnvStatus,
		setRecentMessages,
		setShowAllMessages,
		setProcessedEvents,
		setAgentInstance,
		setShowVirtualEnvLog,
		setIsAutoExecuting,
		setCurrentSuggestions,
		setShowHistoryMenu,
		scheduleProcessingStop,
		cancelProcessingStop,
		resetLoadingState,
	} = useChatUIState();

	const inputValueRef = React.useRef<string>("");
	const localRegistryRef = useRef<LocalDatasetRegistry | null>(null);
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
				const stream = activeStreams.get(stepId);
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
			const stream = activeStreams.get(stepId);
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

	// Use custom hooks for event handling
	const { activeStreams } = useCodeGenerationEvents({
		analysisDispatch,
		setIsProcessing,
		setProgressMessage,
		setValidationErrors,
		setValidationSuccessMessage,
		scheduleProcessingStop,
		cancelProcessingStop,
		enqueueStreamingUpdate,
		addMessage: (content: string, isUser: boolean) =>
			addMessage(content, isUser),
	});

	useVirtualEnvEvents({
		setVirtualEnvStatus,
		addMessage: (content: string, isUser: boolean) =>
			addMessage(content, isUser),
	});

	useChatEvents({
		uiState,
		uiDispatch,
		workspaceState,
		composerRef,
		setInputValue,
		inputValueRef,
		setCodeEditContext,
		codeEditContextRef,
	});

	// Chat event handling moved to useChatEvents hook

	// Initialize local dataset registry and services
	useEffect(() => {
		const registry = new LocalDatasetRegistry();
		localRegistryRef.current = registry;
		registry
			.load()
			.catch((e) => console.warn("Failed to load local dataset registry", e));
	}, []);

	// Services will be initialized after backendClient state is declared

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
	// activeStreams is now provided by useCodeGenerationEvents hook
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
	// Initialize services after backendClient is available
	const notebookEditingService = React.useMemo(() => {
		if (!backendClient) return null;
		return new NotebookEditingService(
			backendClient,
			workspaceState.currentWorkspace || undefined
		);
	}, [backendClient, workspaceState.currentWorkspace]);

	const datasetResolutionService = React.useMemo(() => {
		return new DatasetResolutionService(localRegistryRef.current);
	}, []);

	const chatCommunicationService = React.useMemo(() => {
		if (!backendClient) return null;
		return new ChatCommunicationService(backendClient);
	}, [backendClient]);

	const suggestionsService = React.useMemo(() => {
		if (!backendClient) return null;
		return new AnalysisOrchestrationService(backendClient);
	}, [backendClient]);

	// Virtual environment event handling moved to useVirtualEnvEvents hook

	// Code generation event handling moved to useCodeGenerationEvents hook

	// Chat interactions hook for message handling and scrolling
	const { addMessage, scrollToBottomImmediate } = useChatInteractions({
		analysisDispatch,
		chatContainerRef,
		chatAutoScrollRef,
		recentMessages,
		setRecentMessages,
		setCurrentSuggestions,
	});

	// Auto-scroll to bottom when new messages are added (only if near bottom)
	useEffect(() => {
		scrollToBottomImmediate();
	}, [analysisState.messages, scrollToBottomImmediate]);

	// Clear composer on chat session change (defensive in case session switches elsewhere)
	useEffect(() => {
		try {
			setInputValue("");
			inputValueRef.current = "";
			setMentionOpen(false);
			setMentionQuery("");
		} catch (_) {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [(analysisState as any).activeChatSessionId]);

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

	// Resolve @mentions using the service
	const resolveAtMentions = useCallback(
		(text: string): LocalDatasetEntry[] => {
			return datasetResolutionService.resolveAtMentions(text);
		},
		[datasetResolutionService]
	);

	// Shared notebook edit executor using the service
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
			if (!notebookEditingService) {
				addMessage(
					"Backend not ready to edit code. Please try again in a moment.",
					false
				);
				return;
			}

			await notebookEditingService.performNotebookEdit(args, {
				addMessage,
				analysisDispatch,
			});
		},
		[notebookEditingService, addMessage, analysisDispatch]
	);

	const handleSendMessage = useCallback(async () => {
		if (!inputValueRef.current.trim() || isLoading) return;

		// Clear lingering validation status for a fresh conversation cycle
		setValidationErrors([]);
		setValidationSuccessMessage("");
		// Hide examples once the user sends any message
		setShowExamples(false);

		const userMessage = inputValueRef.current.trim();

		// Ask mode: Strict Q&A (no edits/search)
		if (chatMode === "Ask") {
			addMessage(userMessage, true);
			setInputValue("");
			setIsLoading(true);
			setIsProcessing(true);

			let isMounted = true;
			try {
				if (!validateBackendClient()) {
					return;
				}
				// Build lightweight context from recent messages
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
		
		// Add user message FIRST to avoid duplicates
		addMessage(userMessage, true);
		setInputValue("");
		setIsLoading(true);
		setIsProcessing(true);
		
		// THEN: Autonomous inspection of mentioned files/folders
		let inspectedLocalData = false;
		let inspectionContext = "";
		let inspectedItems: Array<{path: string; success: boolean; content?: string; language?: string; title?: string}> = []; // Store the actual inspected items
		
		try {
			const { AutonomousInspectionService } = await import("../../services/tools/AutonomousInspectionService");
			const inspectionService = new AutonomousInspectionService(
				workspaceState.currentWorkspace || undefined
			);

			if (inspectionService.shouldInspect(userMessage)) {
				addMessage("🔍 Auto-inspecting mentioned files/folders...", false);
				
				// Add delay to make inspection visible
				await new Promise(resolve => setTimeout(resolve, 800));
				
				const results = await inspectionService.inspectMentionedItems(
					userMessage,
					async (result) => {
						if (result.success) {
							addMessage(
								`📁 Inspected ${result.path}`,
								false,
								result.content,
								result.language,
								result.title || result.path
							);
						} else {
							addMessage(
								`❌ Could not inspect ${result.path}: ${result.error}`,
								false
							);
						}
						// Delay between each inspection
						await new Promise(resolve => setTimeout(resolve, 600));
					}
				);

				const successCount = results.filter(r => r.success).length;
				if (successCount > 0) {
					inspectedLocalData = true;
					inspectedItems = results.filter(r => r.success); // Store successful inspections
					inspectionContext = inspectionService.buildInspectionContext(results);
					addMessage(`✅ Inspected ${successCount} item(s). Proceeding with analysis...`, false);
					// Pause before continuing
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}
		} catch (error) {
			console.warn("Autonomous inspection failed:", error);
		}

		// SECOND: Resolve @mentions to local datasets and auto-attach (Agent mode only)
		const mentionDatasets = resolveAtMentions(userMessage);

		// Resolve workspace and cell mentions using the service
		const { workspaceResolved, cellMentionContext } =
			await datasetResolutionService.resolveWorkspaceAndCellMentions(
				userMessage,
				workspaceState.currentWorkspace || "",
				(workspaceState as any).activeFile
			);

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

		let isMounted = true;

		try {
			// If user referenced a notebook cell and specified line ranges, optionally show a snippet.
			// Only show the snippet and return if the prompt clearly asks to "show/view" rather than edit.
			if (cellMentionContext) {
				const wantOutput = /\boutput\b/i.test(userMessage);
				const explainIntent =
					/(what\s+does|explain|describe|summariz(e|e\s+the)|meaning|purpose)/i.test(
						userMessage
					);
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
				setIsProcessing(true);
				try {
					await performNotebookEdit({
						filePath,
						cellIndex,
						language: lang,
						fullCode,
						userMessage,
						selection: {
							selStart,
							selEnd,
							startLine,
							endLine,
							withinSelection,
						},
					});
				} finally {
					scheduleProcessingStop(1200);
				}
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

				setIsProcessing(true);
				try {
					await performNotebookEdit({
						filePath,
						cellIndex,
						language: lang,
						fullCode,
						userMessage,
						selection: {
							selStart,
							selEnd,
							startLine,
							endLine,
							withinSelection,
						},
						outputText: ctxAgent.outputText,
						hasErrorOutput: ctxAgent.hasErrorOutput,
					});
				} finally {
					scheduleProcessingStop(1200);
				}
				setCodeEditContext(null);
				codeEditContextRef.current = null;
				return;
			}
			// If we inspected local data, prepare datasets and proceed directly with analysis
			if (inspectedLocalData && selectedDatasets.length === 0 && inspectedItems.length > 0) {
				// Convert inspected local data to selected datasets
				const localDatasets = inspectedItems.map((item, index) => ({
					id: `local_inspected_${index}`,
					title: `Local Data: ${item.path}`,
					source: "Local Workspace",
					localPath: workspaceState.currentWorkspace ? `${workspaceState.currentWorkspace}/${item.path}` : item.path,
					isLocalDirectory: true,
					alias: item.path,
					description: `Locally inspected data from workspace: ${item.path}`,
					organism: "Unknown"
				}));
				
				selectDatasets(localDatasets);
				const aliases = localDatasets.map(d => d.alias).join(", ");
				addMessage(`Using inspected local data: ${aliases}`, false);
				
				// Proceed directly with analysis using the localDatasets we just created
				console.log("✅ Using inspected local data, proceeding with analysis");
				const enhancedAnalysisRequest = inspectionContext 
					? `${userMessage}\n\nINSPECTION CONTEXT:\n${inspectionContext}` 
					: userMessage;
				await handleAnalysisRequest(enhancedAnalysisRequest, localDatasets);
				return; // handled
			}
			
			// If datasets were already selected, proceed with analysis
			if (selectedDatasets.length > 0) {
				console.log("✅ Previously selected datasets found, proceeding with analysis");
				const enhancedAnalysisRequest = inspectionContext 
					? `${userMessage}\n\nINSPECTION CONTEXT:\n${inspectionContext}` 
					: userMessage;
				await handleAnalysisRequest(enhancedAnalysisRequest);
				return; // handled
			}
			
			console.log("❌ No datasets available, continuing to intent classification");

			// Use backend LLM to classify intent instead of local pattern matching
			if (!validateBackendClient()) {
				return;
			}

			// Get intent classification from backend
			const intentResult = await backendClient!.classifyIntent(userMessage);

			// If confidence is too low (< 0.8), treat as general question instead of forcing into specific intent
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
			else if (intentResult.intent === "ADD_CELL" && !isLowConfidence) {
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
                            const nbCodeService = new NotebookCodeGenerationService(
                                backendClient,
                                wsDir
                            );

                            await nbCodeService.generateAndAddValidatedCode({
                                stepDescription: userMessage,
                                originalQuestion: userMessage,
                                datasets: [], // notebook already has its context
                                workingDir: wsDir,
                                notebookPath: notebookFile,
                            });
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
				// General question handling - use autonomous tool integration
				try {
					// Import and use ChatToolAgent for autonomous tool usage
					const { ChatToolAgent } = await import("../../services/tools/ChatToolAgent");
					
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

					const answer = await ChatToolAgent.askWithTools(
						backendClient!,
						userMessage,
						context,
						{
							workspaceDir: workspaceState.currentWorkspace || undefined,
							addMessage, // Tools will show their output in chat
						}
					);

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

				// After datasets are selected, show example queries in chat
				setShowExamples(true);

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
		async (analysisRequest: string, providedDatasets?: any[]) => {
			const datasetsToUse = providedDatasets || selectedDatasets;
			if (datasetsToUse.length === 0) {
				addMessage(
					"I am a bioinformatics agent. I can help you with your data analysis. Tag @files to analyze or open a notebook to work on it.",
					false
				);
				return;
			}

			try {
				setIsLoading(true);
				setProgressMessage("Starting analysis process...");

				// Reset agent instance for new analysis
				setAgentInstance(null);

				// Convert selected datasets preserving source and urls for the agent/LLM
				const datasets = datasetsToUse.map((dataset) => ({
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
									variant="expandable"
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

				{/* After all prior messages, optionally show example queries as the last message */}
				{showExamples && selectedDatasets.length > 0 && !isProcessing && (
					<div style={{ padding: 12 }}>
						<ExamplesComponent
							onExampleSelect={(example) => {
								setInputValue(example);
								inputValueRef.current = example;
								setShowExamples(false);
								try {
									composerRef.current?.focus();
								} catch (_) {}
							}}
						/>
					</div>
				)}

				{isProcessing && (
					<ProcessingIndicator
						text={
							analysisState.analysisStatus || progressMessage || "Processing"
						}
					/>
				)}

				{/* Show success when there are no errors and a message exists */}
				{!validationErrors?.length && (
					<ValidationSuccess message={validationSuccessMessage} />
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
								// Clear composer input for fresh session
								setInputValue("");
								inputValueRef.current = "";
								suggestionsService?.startNewConversation?.();
							}}
							className="chat-button"
						>
							<FiPlus />
						</button>
					</Tooltip>
					<Tooltip content="Chat history" placement="bottom">
						<button
							onClick={() => setShowHistoryMenu(!showHistoryMenu)}
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
															// Clear composer input when switching sessions
															setInputValue("");
															inputValueRef.current = "";
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
					setInputValue(inputValue.replace(/@([^\s@]*)$/, `@${alias}`) + " ");
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
