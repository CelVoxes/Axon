import { useCallback, useRef } from "react";
import { BackendClient } from "../../../services/backend/BackendClient";
import { LocalDatasetEntry } from "../../../services/chat/LocalDatasetRegistry";
import { DatasetResolutionService } from "../../../services/chat/DatasetResolutionService";
import { NotebookEditingService } from "../../../services/chat/NotebookEditingService";
import { ChatToolAgent } from "../../../services/tools/ChatToolAgent";
import { ToolRegistry } from "../../../services/tools/ToolRegistry";
import { AutonomousInspectionService } from "../../../services/tools/AutonomousInspectionService";

interface UseChatMessageHandlingProps {
	backendClient: BackendClient | null;
	datasetResolutionService: DatasetResolutionService;
	notebookEditingService: NotebookEditingService | null;
	workspaceState: any;
	analysisState: any;
	chatMode: string;
	codeEditContext: any;
	codeEditContextRef: React.MutableRefObject<any>;
	inputValueRef: React.MutableRefObject<HTMLTextAreaElement | null>;
	isLoading: boolean;
	addMessage: (
		content: string,
		isUser: boolean,
		code?: string,
		codeLanguage?: string,
		codeTitle?: string,
		suggestions?: any,
		status?: string,
		isStreaming?: boolean
	) => void;
	resetLoadingState: () => void;
	setInputValue: (value: string) => void;
	setIsLoading: (loading: boolean) => void;
	setIsProcessing: (processing: boolean) => void;
	setCodeEditContext: (context: any) => void;
	setValidationErrors: (errors: string[]) => void;
	setValidationSuccessMessage: (message: string) => void;
	resolveAtMentions: (text: string) => LocalDatasetEntry[];
	selectDatasets: (datasets: any[]) => void;
	mergeSelectedDatasets: (datasets1: any[], datasets2: any[]) => any[];
	analysisDispatch: any;
}

const INSPECTION_CACHE_TTL_MS = 10_000;

export function useChatMessageHandling(props: UseChatMessageHandlingProps) {
	const {
		backendClient,
		datasetResolutionService,
		notebookEditingService,
		workspaceState,
		analysisState,
		chatMode,
		codeEditContext,
		codeEditContextRef,
		inputValueRef,
		isLoading,
		addMessage,
		resetLoadingState,
		setInputValue,
		setIsLoading,
		setIsProcessing,
		setCodeEditContext,
		setValidationErrors,
		setValidationSuccessMessage,
		resolveAtMentions,
		selectDatasets,
		mergeSelectedDatasets,
		analysisDispatch,
	} = props;

	const contextCacheRef = useRef<{ key: string; value: string } | null>(null);
	const inspectionCacheRef = useRef<
		Map<string, { context: string; timestamp: number }>
	>(new Map());
	const fallbackSessionInstanceRef = useRef(
		`offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	);

	const buildFallbackSessionId = useCallback(
		(parts: Array<string | null | undefined>) => {
			const suffixParts = parts
				.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
				.map((p) => p.trim().replace(/[:\s]+/g, "_"));
			const suffix = suffixParts.length ? suffixParts.join(":") : "default";
			return `session:${fallbackSessionInstanceRef.current}:${suffix}`;
		},
		[]
	);

	const buildSessionIdSafe = useCallback(
		(...parts: Array<string | null | undefined>) => {
			if (backendClient) {
				return backendClient.buildSessionId(...parts);
			}
			return buildFallbackSessionId(parts);
		},
		[backendClient, buildFallbackSessionId]
	);

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

            // Chain edits to the current chat+workspace session for Responses API tracking
            let sessionId: string | undefined;
            try {
                const { findWorkspacePath } = await import("../../../utils/WorkspaceUtils");
                const wsDir =
                    findWorkspacePath({
                        filePath: args.filePath,
                        currentWorkspace: workspaceState.currentWorkspace,
                    }) || workspaceState.currentWorkspace || "";
				const chatId = (analysisState as any).activeChatSessionId || "global";
				if (wsDir) {
					sessionId = buildSessionIdSafe(wsDir, chatId);
				}
            } catch (_) {}

            await notebookEditingService.performNotebookEdit({ ...args, sessionId }, {
                addMessage,
                analysisDispatch,
            });
	},
	[
		notebookEditingService,
		addMessage,
		analysisDispatch,
		workspaceState.currentWorkspace,
		analysisState,
		buildSessionIdSafe,
	]
);

	const buildContextFromMessages = useCallback((messages: any[]): string => {
		const recent = (messages || []).slice(-10);
		return recent
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
	}, []);

	const getMemoizedContext = useCallback(() => {
		const messages = analysisState.messages || [];
		const lastMessageId = messages[messages.length - 1]?.id || "";
		const key = `${messages.length}:${lastMessageId}`;
		const cached = contextCacheRef.current;
		if (cached && cached.key === key) {
			return cached.value;
		}
		const context = buildContextFromMessages(messages);
		contextCacheRef.current = { key, value: context };
		return context;
	}, [analysisState.messages, buildContextFromMessages]);

	const autoPeekMentionedItems = useCallback(
		async (userMessage: string) => {
			const inspectionService = new AutonomousInspectionService(
				workspaceState.currentWorkspace || undefined
			);

			// Only inspect if the message suggests it would be helpful
			if (!inspectionService.shouldInspect(userMessage)) {
				return "";
			}

			// Show what we're about to inspect
			addMessage("🔍 Auto-inspecting mentioned files/folders...", false);
			
			// Brief delay to surface inspection feedback without stalling too long
			await new Promise((resolve) => setTimeout(resolve, 120));

			// Perform autonomous inspection
			const results = await inspectionService.inspectMentionedItems(
				userMessage,
				async (result) => {
					// Show each inspected item in chat
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
					// Small delay between each inspection result
					await new Promise((resolve) => setTimeout(resolve, 80));
				}
			);

			// Show completion
			const successCount = results.filter(r => r.success).length;
			if (successCount > 0) {
				addMessage(`✅ Inspected ${successCount} item(s). Proceeding with analysis...`, false);
				// Brief pause before proceeding
				await new Promise((resolve) => setTimeout(resolve, 180));
			}

			// Return context for LLM
			return inspectionService.buildInspectionContext(results);
		},
		[workspaceState.currentWorkspace, addMessage]
	);

	const getInspectionContext = useCallback(
		async (userMessage: string) => {
			const workspaceKey = workspaceState.currentWorkspace || "";
			const activeFileKey = (workspaceState as any).activeFile || "";
			const cacheKey = `${workspaceKey}::${activeFileKey}::${userMessage}`;
			const cached = inspectionCacheRef.current.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < INSPECTION_CACHE_TTL_MS) {
				return cached.context;
			}
			const context = await autoPeekMentionedItems(userMessage);
			inspectionCacheRef.current.set(cacheKey, {
				context,
				timestamp: Date.now(),
			});
			return context;
		},
		[autoPeekMentionedItems, workspaceState.currentWorkspace]
	);

	const handleAskMode = useCallback(
		async (userMessage: string) => {
			// Ask mode: Q&A with autonomous tool usage for workspace inspection
			addMessage(userMessage, true);
			setInputValue("");
			setIsLoading(true);
			setIsProcessing(true);

			let isMounted = true;
			try {
				if (!validateBackendClient()) {
					return;
				}
				
				// Auto-inspect mentioned items for Ask mode too
				const inspectionContext = await getInspectionContext(userMessage);
				const baseContext = getMemoizedContext();
				const enhancedContext = baseContext + inspectionContext;
				
				// Use ChatToolAgent for autonomous tool usage in Ask mode
				const chatId = (analysisState as any).activeChatSessionId || "global";
				const sessionId = buildSessionIdSafe(
					workspaceState.currentWorkspace || undefined,
					chatId
				);
				const answer = await ChatToolAgent.askWithTools(
                    backendClient!,
                    userMessage,
                    enhancedContext,
                    {
                        workspaceDir: workspaceState.currentWorkspace || undefined,
                        sessionId,
                        addMessage, // Tools will show their output in chat
                    }
                );
				
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
		},
		[
			addMessage,
			setInputValue,
			setIsLoading,
			setIsProcessing,
			validateBackendClient,
			getMemoizedContext,
			workspaceState.currentWorkspace,
			backendClient,
			buildSessionIdSafe,
			resetLoadingState,
			getInspectionContext,
		]
	);

	const handleSendMessage = useCallback(async () => {
		if (!inputValueRef.current?.value.trim() || isLoading) return;

		// Clear lingering validation status for a fresh conversation cycle
		setValidationErrors([]);
		setValidationSuccessMessage("");

		const userMessage = inputValueRef.current.value.trim();

		// Ask mode: If a code selection/context is present, do an edit-in-place; otherwise do Q&A
		if (chatMode === "Ask") {
			await handleAskMode(userMessage);
			return;
		}

		// Resolve @mentions to local datasets and auto-attach (Agent mode only)
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

		addMessage(userMessage, true);
		setInputValue("");
		setIsLoading(true);
		setIsProcessing(true);

		try {
			if (!validateBackendClient()) {
				return;
			}

			// Auto-peek mentioned files/folders before proceeding
			const inspectionContext = await getInspectionContext(userMessage);

			// Continue with agent mode handling...
			// (The full agent mode logic would be implemented here)
			// For now, use tools-enhanced Q&A as fallback with inspection context
			const baseContext = getMemoizedContext();
			const enhancedContext = baseContext + inspectionContext;
			
			const chatId = (analysisState as any).activeChatSessionId || "global";
			const sessionId = buildSessionIdSafe(
				workspaceState.currentWorkspace || undefined,
				chatId
			);
			
			const answer = await ChatToolAgent.askWithTools(
				backendClient!,
				userMessage,
				enhancedContext,
				{
					workspaceDir: workspaceState.currentWorkspace || undefined,
					sessionId,
					addMessage,
				}
			);
			
			addMessage(answer || "(No answer)", false);
		} catch (error) {
			console.error("Agent mode error:", error);
			addMessage(
				"Sorry, I encountered an error. Please try again.",
				false
			);
		} finally {
			resetLoadingState();
		}
	}, [
		inputValueRef,
		isLoading,
		setValidationErrors,
		setValidationSuccessMessage,
		chatMode,
		handleAskMode,
		resolveAtMentions,
		datasetResolutionService,
		workspaceState,
		mergeSelectedDatasets,
		selectDatasets,
		addMessage,
		getInspectionContext,
		validateBackendClient,
		getMemoizedContext,
		backendClient,
		buildSessionIdSafe,
		analysisState.activeChatSessionId,
		resetLoadingState,
	]);

	return {
		validateBackendClient,
		performNotebookEdit,
		buildContextFromMessages,
		autoPeekMentionedItems,
		handleAskMode,
		handleSendMessage,
	};
}
