import { useCallback, useRef } from "react";
import { DataTypeSuggestions } from "../../../services/chat/AnalysisOrchestrationService";

interface UseChatInteractionsProps {
	analysisDispatch: any;
	chatContainerRef: React.RefObject<HTMLDivElement>;
	chatAutoScrollRef: React.MutableRefObject<boolean>;
	recentMessages: string[];
	setRecentMessages: (
		messages: string[] | ((prev: string[]) => string[])
	) => void;
	setCurrentSuggestions: (suggestions: DataTypeSuggestions | null) => void;
}

export function useChatInteractions({
	analysisDispatch,
	chatContainerRef,
	chatAutoScrollRef,
	recentMessages,
	setRecentMessages,
	setCurrentSuggestions,
}: UseChatInteractionsProps) {
	const scrollToBottomImmediate = useCallback(() => {
		const el = chatContainerRef.current;
		if (!el) return;
		if (!chatAutoScrollRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [chatContainerRef, chatAutoScrollRef]);

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
		[
			analysisDispatch,
			scrollToBottomImmediate,
			recentMessages,
			setRecentMessages,
			setCurrentSuggestions,
		]
	);

	return {
		addMessage,
		scrollToBottomImmediate,
	};
}
