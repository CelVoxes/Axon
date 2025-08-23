import { useState, useCallback, useRef } from "react";
import { DataTypeSuggestions } from "../../../services/chat/AnalysisOrchestrationService";

export interface ChatUIState {
	inputValue: string;
	isLoading: boolean;
	progressMessage: string;
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

	const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

	return {
		// State
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

		// Actions
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
	};
}
