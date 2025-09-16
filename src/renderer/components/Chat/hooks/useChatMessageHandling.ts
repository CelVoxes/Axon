import { useCallback } from "react";
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
                if (wsDir) sessionId = `session:${wsDir}:${chatId}`;
            } catch (_) {}

            await notebookEditingService.performNotebookEdit({ ...args, sessionId }, {
                addMessage,
                analysisDispatch,
            });
        },
        [notebookEditingService, addMessage, analysisDispatch, workspaceState.currentWorkspace, analysisState]
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
			
			// Add small delay to make inspection visible
			await new Promise(resolve => setTimeout(resolve, 500));

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
					await new Promise(resolve => setTimeout(resolve, 300));
				}
			);

			// Show completion
			const successCount = results.filter(r => r.success).length;
			if (successCount > 0) {
				addMessage(`✅ Inspected ${successCount} item(s). Proceeding with analysis...`, false);
				// Brief pause before proceeding
				await new Promise(resolve => setTimeout(resolve, 800));
			}

			// Return context for LLM
			return inspectionService.buildInspectionContext(results);
		},
		[workspaceState.currentWorkspace, addMessage]
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
				const inspectionContext = await autoPeekMentionedItems(userMessage);
				const baseContext = buildContextFromMessages(analysisState.messages);
				const enhancedContext = baseContext + inspectionContext;
				
				// Use ChatToolAgent for autonomous tool usage in Ask mode
                const chatId = (analysisState as any).activeChatSessionId || 'global';
                const sessionId = `session:${workspaceState.currentWorkspace || 'global'}:${chatId}`;
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
			buildContextFromMessages,
			analysisState.messages,
			workspaceState.currentWorkspace,
			backendClient,
			resetLoadingState,
			autoPeekMentionedItems,
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
			const inspectionContext = await autoPeekMentionedItems(userMessage);

			// Continue with agent mode handling...
			// (The full agent mode logic would be implemented here)
			// For now, use tools-enhanced Q&A as fallback with inspection context
			const baseContext = buildContextFromMessages(analysisState.messages);
			const enhancedContext = baseContext + inspectionContext;
			
			const chatId = (analysisState as any).activeChatSessionId || 'global';
			const sessionId = `session:${workspaceState.currentWorkspace || 'global'}:${chatId}`;
			
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
		autoPeekMentionedItems,
		validateBackendClient,
		buildContextFromMessages,
		backendClient,
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
