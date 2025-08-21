import { useCallback } from 'react';
import { BackendClient } from '../../../services/BackendClient';
import { LocalDatasetEntry } from '../../../services/LocalDatasetRegistry';
import { DatasetResolutionService } from '../services/DatasetResolutionService';
import { NotebookEditingService } from '../services/NotebookEditingService';

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
	addMessage: (content: string, isUser: boolean, code?: string, codeLanguage?: string, codeTitle?: string, suggestions?: any, status?: string, isStreaming?: boolean) => void;
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

			await notebookEditingService.performNotebookEdit(args, {
				addMessage,
				analysisDispatch,
			});
		},
		[notebookEditingService, addMessage, analysisDispatch]
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

	const handleAskMode = useCallback(async (userMessage: string) => {
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
			const context = buildContextFromMessages(analysisState.messages);
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
	}, [
		codeEditContext,
		codeEditContextRef,
		addMessage,
		setInputValue,
		setIsLoading,
		setIsProcessing,
		setCodeEditContext,
		validateBackendClient,
		buildContextFromMessages,
		analysisState.messages,
		backendClient,
		resetLoadingState,
		performNotebookEdit
	]);

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

		// Continue with agent mode handling...
		// Note: The rest of the agent mode logic would be extracted here
		// For now, this is a simplified version focusing on the core structure

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
		addMessage
	]);

	return {
		validateBackendClient,
		performNotebookEdit,
		buildContextFromMessages,
		handleAskMode,
		handleSendMessage,
	};
}