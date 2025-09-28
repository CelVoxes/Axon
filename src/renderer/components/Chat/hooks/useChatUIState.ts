import { useState, useCallback, useRef, useEffect } from "react";
import { DataTypeSuggestions } from "../../../services/chat/AnalysisOrchestrationService";
import { useAnalysisContext } from "../../../context/AppContext";

export interface ChecklistSummary {
	summary: string;
	lines: string[];
	completed: number;
	total: number;
	skipped: number;
	next?: string | null;
}

export interface ChatUIState {
	inputValue: string;
	isLoading: boolean;
	progressMessage: string;
	checklistSummary: ChecklistSummary | null;
	isProcessing: boolean;
	progressData: any;
	validationErrors: string[];
	validationSuccessMessage: string;
	suggestionButtons: string[];
	virtualEnvStatus: string;
	recentMessages: string[];
	showAllMessages: boolean;
	processedEvents: Set<string>;
	agentInstance: any;
	showVirtualEnvLog: boolean;
	isAutoExecuting: boolean;
	currentSuggestions: DataTypeSuggestions | null;
	showHistoryMenu: boolean;
}

export interface ChatUIActions {
	setInputValue: (value: string) => void;
	setIsLoading: (value: boolean) => void;
	setProgressMessage: (value: string) => void;
	setChecklistSummary: (value: ChecklistSummary | null) => void;
	setIsProcessing: (value: boolean) => void;
	setProgressData: (value: any) => void;
	setValidationErrors: (errors: string[]) => void;
	setValidationSuccessMessage: (message: string) => void;
	setSuggestionButtons: (buttons: string[]) => void;
	setVirtualEnvStatus: (status: string) => void;
	setRecentMessages: (
		messages: string[] | ((prev: string[]) => string[])
	) => void;
	setShowAllMessages: (show: boolean) => void;
	setProcessedEvents: (
		events: Set<string> | ((prev: Set<string>) => Set<string>)
	) => void;
	setAgentInstance: (instance: any) => void;
	setShowVirtualEnvLog: (show: boolean) => void;
	setIsAutoExecuting: (executing: boolean) => void;
	setCurrentSuggestions: (suggestions: DataTypeSuggestions | null) => void;
	setShowHistoryMenu: (show: boolean) => void;
	scheduleProcessingStop: (delayMs?: number) => void;
	cancelProcessingStop: () => void;
	resetLoadingState: () => void;
}

export function useChatUIState(): ChatUIState & ChatUIActions {
	const { state: analysisState, dispatch: analysisDispatch } =
		useAnalysisContext();
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");
	const [isProcessing, setIsProcessing] = useState(false);
	const [progressData, setProgressData] = useState<any>(null);
	const [validationErrors, setValidationErrors] = useState<string[]>([]);
	const [validationSuccessMessage, setValidationSuccessMessage] =
		useState<string>("");
	const [suggestionButtons, setSuggestionButtons] = useState<string[]>([]);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState("");
	const [recentMessages, setRecentMessages] = useState<string[]>([]);
	const [showAllMessages, setShowAllMessages] = useState(false);
	const [processedEvents, setProcessedEvents] = useState<Set<string>>(
		new Set()
	);
	const [agentInstance, setAgentInstance] = useState<any>(null);
	const [showVirtualEnvLog, setShowVirtualEnvLog] = useState(false);
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [currentSuggestions, setCurrentSuggestions] =
		useState<DataTypeSuggestions | null>(null);
	const [showHistoryMenu, setShowHistoryMenu] = useState<boolean>(false);

	// Manage checklist locally to avoid context synchronization issues
	const [checklistSummary, setChecklistSummaryState] =
		useState<ChecklistSummary | null>(null);

	const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const checklistSyncRef = useRef<boolean>(false);

	const scheduleProcessingStop = useCallback((delayMs = 2000) => {
		if (processingTimeoutRef.current) {
			clearTimeout(processingTimeoutRef.current);
		}
		processingTimeoutRef.current = setTimeout(() => {
			setIsProcessing(false);
			setProgressMessage("");
		}, delayMs);
	}, []);

	const cancelProcessingStop = useCallback(() => {
		if (processingTimeoutRef.current) {
			clearTimeout(processingTimeoutRef.current);
			processingTimeoutRef.current = null;
		}
	}, []);

	const resetLoadingState = useCallback(() => {
		setIsLoading(false);
		setIsProcessing(false);
		setProgressMessage("");
	}, []);

	const setChecklistSummary = useCallback(
		(value: ChecklistSummary | null) => {
			checklistSyncRef.current = true;
			setChecklistSummaryState(value);
			analysisDispatch({
				type: "SET_CHECKLIST_SUMMARY",
				payload: value,
			});
			setTimeout(() => {
				checklistSyncRef.current = false;
			}, 0);
		},
		[analysisDispatch]
	);

	// Sync local checklist state with context when it changes externally
	useEffect(() => {
		if (checklistSyncRef.current) return;
		if (analysisState.checklistSummary !== checklistSummary) {
			setChecklistSummaryState(analysisState.checklistSummary);
		}
	}, [analysisState.checklistSummary]);

	return {
		// State
		inputValue,
		isLoading,
		progressMessage,
		checklistSummary,
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

		// Actions
		setInputValue,
		setIsLoading,
		setProgressMessage,
		setChecklistSummary,
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
	};
}
