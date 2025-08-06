import React, { useState, useRef, useEffect, useCallback } from "react";
import {
	useAnalysisContext,
	useUIContext,
	useWorkspaceContext,
} from "../../context/AppContext";
import { BackendClient } from "../../services/BackendClient";
import { SearchConfig } from "../../config/SearchConfig";
import { DatasetSelectionModal } from "./DatasetSelectionModal";
import { ChatMessage } from "./ChatMessage";
import {
	FiSend,
	FiMinimize2,
	FiMaximize2,
	FiChevronDown,
	FiChevronUp,
	FiCopy,
} from "react-icons/fi";
import { AutonomousAgent } from "../../services/AutonomousAgent";

import {
	AnalysisOrchestrationService,
	DataTypeSuggestions,
	AnalysisSuggestion,
} from "../../services/AnalysisOrchestrationService";
import { AnalysisSuggestionsComponent } from "./AnalysisSuggestionsComponent";
import { EventManager } from "../../utils/EventManager";
import { AsyncUtils } from "../../utils/AsyncUtils";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationErrorEvent,
	Dataset,
} from "../../services/types";

// Expandable Code Block Component
interface ExpandableCodeBlockProps {
	code: string;
	language?: string;
	title?: string;
	isStreaming?: boolean;
}

const ExpandableCodeBlock: React.FC<ExpandableCodeBlockProps> = ({
	code,
	language = "python",
	title = "Generated Code",
	isStreaming = false,
}) => {
	const [isExpanded, setIsExpanded] = useState(isStreaming); // Auto-expand when streaming
	const [copied, setCopied] = useState(false);
	const [showFullCode, setShowFullCode] = useState(false);

	// Auto-expand when streaming starts and prevent collapsing during streaming
	useEffect(() => {
		if (isStreaming) {
			setIsExpanded(true);
		}
	}, [isStreaming]);

	// Prevent collapsing during streaming
	const handleToggle = () => {
		if (isStreaming) return; // Don't allow collapsing during streaming
		setIsExpanded(!isExpanded);
	};

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	// Truncate code for preview if it's very long
	const isLongCode = code.length > 1000;
	const displayCode =
		isLongCode && !showFullCode
			? code.substring(0, 1000) + "\n\n... (truncated)"
			: code;

	return (
		<div>
			<div className="code-header" onClick={handleToggle}>
				<div className="code-header-left">
					{title && <span className="code-title">{title}</span>}
					<span className="code-language">
						{language}
						{isStreaming && <span className="streaming-indicator">●</span>}
					</span>
					<span className="code-size-indicator">{code.length} chars</span>
				</div>
				<div className="code-header-right">
					<button
						className="copy-button"
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard();
						}}
						title="Copy code"
					>
						<FiCopy size={14} />
						{copied && <span className="copied-tooltip">Copied!</span>}
					</button>
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</div>
			</div>
			{isExpanded && (
				<div className={`code-content ${isStreaming ? "streaming" : ""}`}>
					<pre>
						<code className={`language-${language}`}>{displayCode}</code>
					</pre>
					{isLongCode && (
						<div className="code-actions">
							<button
								className="show-more-button"
								onClick={(e) => {
									e.stopPropagation();
									setShowFullCode(!showFullCode);
								}}
							>
								{showFullCode ? "Show Less" : "Show Full Code"}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
};

// Custom Message Content Component that always renders code in expandable divs
interface MessageContentProps {
	content: string;
	isStreaming?: boolean;
}

const MessageContent: React.FC<MessageContentProps> = ({
	content,
	isStreaming = false,
}) => {
	const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
	const [copiedBlocks, setCopiedBlocks] = useState<Set<string>>(new Set());

	const copyToClipboard = useCallback(async (code: string, blockId: string) => {
		try {
			await navigator.clipboard.writeText(code);
			setCopiedBlocks((prev) => new Set(prev).add(blockId));
			setTimeout(() => {
				setCopiedBlocks((prev) => {
					const newSet = new Set(prev);
					newSet.delete(blockId);
					return newSet;
				});
			}, 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	}, []);

	const toggleCodeBlock = useCallback((blockId: string) => {
		setExpandedBlocks((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(blockId)) {
				newSet.delete(blockId);
			} else {
				newSet.add(blockId);
			}
			return newSet;
		});
	}, []);

	const formatContent = useCallback(
		(content: string): React.ReactNode => {
			// Debug: Log content being processed
			if (content.includes("```")) {
				console.log(
					"MessageContent: Processing content with code blocks:",
					content.substring(0, 200) + "..."
				);
				console.log("MessageContent: Full content length:", content.length);
				console.log(
					"MessageContent: Content contains newlines:",
					content.includes("\n")
				);
			}

			// Split content by code blocks - only match complete blocks with content
			const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;

			// Check if content is just an incomplete code block (for streaming)
			if (content.trim() === "```python" || content.trim() === "```python\n") {
				return (
					<div className="message-text">
						<em>Generating code...</em>
					</div>
				);
			}

			const parts: React.ReactNode[] = [];
			let lastIndex = 0;
			let match;
			let blockIndex = 0;

			while ((match = codeBlockRegex.exec(content)) !== null) {
				// Add text before code block only if it's meaningful content
				if (match.index > lastIndex) {
					const textContent = content.slice(lastIndex, match.index);
					const trimmedText = textContent.trim();
					// Only add text blocks if they have meaningful content (not just whitespace or empty)
					if (
						trimmedText &&
						trimmedText.length > 0 &&
						!trimmedText.match(/^\s*$/)
					) {
						parts.push(
							<div
								key={`text-${blockIndex}`}
								className="message-text"
								dangerouslySetInnerHTML={{
									__html: textContent
										.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
										.replace(
											/`([^`]+)`/g,
											"<code class='inline-code'>$1</code>"
										)
										.replace(/\n/g, "<br />"),
								}}
							/>
						);
					}
				}

				// Add code block only if it has content
				const language = match[1] || "text";
				const code = match[2];

				// Skip empty code blocks to prevent 0-char blocks
				if (!code || code.trim().length === 0) {
					lastIndex = match.index + match[0].length;
					blockIndex++;
					continue;
				}

				// Verify this is a complete code block by checking for proper structure
				const blockContent = match[0];
				const lines = blockContent.split("\n");
				if (lines.length < 3) {
					// Incomplete block, skip
					lastIndex = match.index + match[0].length;
					blockIndex++;
					continue;
				}

				// Use stable block ID based on content hash to prevent jiggling
				const contentHash = btoa(code).slice(0, 8);
				const blockId = `code-${blockIndex}-${contentHash}`;
				const isExpanded = expandedBlocks.has(blockId) || isStreaming;
				const isCopied = copiedBlocks.has(blockId);

				// Only create code blocks if they have actual content
				if (code && code.trim().length > 0) {
					console.log(
						`MessageContent: Creating code block with ${code.length} chars, language: ${language}`
					);
					parts.push(
						<ExpandableCodeBlock
							key={blockId}
							code={code}
							language={language}
							title="Code"
							isStreaming={isStreaming}
						/>
					);
				} else {
					console.log(
						`MessageContent: Skipping empty code block, code length: ${
							code?.length || 0
						}`
					);
				}

				lastIndex = match.index + match[0].length;
				blockIndex++;
			}

			// Add remaining text only if it's meaningful content
			if (lastIndex < content.length) {
				const textContent = content.slice(lastIndex);
				const trimmedText = textContent.trim();
				// Only add text blocks if they have meaningful content
				if (
					trimmedText &&
					trimmedText.length > 0 &&
					!trimmedText.match(/^\s*$/)
				) {
					parts.push(
						<div
							key={`text-${blockIndex}`}
							className="message-text"
							dangerouslySetInnerHTML={{
								__html: textContent
									.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
									.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>")
									.replace(/\n/g, "<br />"),
							}}
						/>
					);
				}
			}

			// If no code blocks found, render as regular text
			if (parts.length === 0) {
				return (
					<div
						className="message-text"
						dangerouslySetInnerHTML={{
							__html: content
								.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
								.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>")
								.replace(/\n/g, "<br />"),
						}}
					/>
				);
			}

			console.log(`MessageContent: Final parts count: ${parts.length}`);

			// Filter out any empty parts that might have been created
			const filteredParts = parts.filter((part) => {
				if (React.isValidElement(part) && part.type === ExpandableCodeBlock) {
					return part.props.code && part.props.code.trim().length > 0;
				}
				return true;
			});

			console.log(
				`MessageContent: Filtered parts count: ${filteredParts.length}`
			);
			return filteredParts;
		},
		[expandedBlocks, copiedBlocks, isStreaming]
	);

	return (
		<div className="message-content-wrapper">{formatContent(content)}</div>
	);
};

// Using Message interface from AnalysisContext

interface ChatPanelProps {
	className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
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

	// Debounced streaming updates to prevent jiggling
	const debouncedStreamingUpdate = useRef(
		AsyncUtils.debounce((stepId: string, content: string) => {
			const stream = activeStreams.current.get(stepId);
			if (stream) {
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							content: content,
						},
					},
				});
			}
		}, 100) // 100ms debounce
	).current;
	const messagesEndRef = useRef<HTMLDivElement>(null);
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
		};

		const handleCodeGenerationChunk = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeGenerationChunkEvent>;
			const { stepId, chunk } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (!stream) return;

			// Update accumulated code
			stream.accumulatedCode += chunk;

			// Use debounced update to prevent jiggling
			// Format content to avoid creating empty text blocks
			const content = `\`\`\`python\n${stream.accumulatedCode}\n\`\`\``;
			debouncedStreamingUpdate(stepId, content);
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
			}
		};

		const handleValidationError = (event: Event) => {
			if (!isMounted) return;
			const customEvent = event as CustomEvent<CodeValidationErrorEvent>;
			const { errors, warnings } = customEvent.detail;

			// Set validation errors for display (UI will show them)
			setValidationErrors(errors);
			setValidationWarnings(warnings);
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

	// Auto-scroll to bottom when new messages are added
	useEffect(() => {
		scrollToBottom();
	}, [analysisState.messages]);

	// Component lifecycle logging (disabled for performance)
	// useEffect(() => {
	// 	return () => {
	// 		console.log(`ChatPanel: Component unmounted with ID: ${componentId}`);
	// 	};
	// }, [componentId]);

	const scrollToBottom = () => {
		setTimeout(() => {
			if (messagesEndRef.current) {
				messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
			}
		}, 100);
	};

	const scrollToBottomImmediate = useCallback(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "auto" });
		}
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

	const handleSendMessage = useCallback(async () => {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();
		addMessage(userMessage, true);
		setInputValue("");
		setIsLoading(true);
		setIsProcessing(true);

		let isMounted = true;

		try {
			// Check if this is a request for suggestions or help
			if (
				userMessage.toLowerCase().includes("suggest") ||
				userMessage.toLowerCase().includes("help") ||
				userMessage.toLowerCase().includes("what can i") ||
				userMessage.toLowerCase().includes("recommend") ||
				userMessage.toLowerCase().includes("ideas") ||
				userMessage.toLowerCase().includes("options")
			) {
				await handleSuggestionsRequest(userMessage);
			}
			// Check if the message is about searching for datasets
			else if (
				userMessage.toLowerCase().includes("search") ||
				userMessage.toLowerCase().includes("find") ||
				userMessage.toLowerCase().includes("dataset") ||
				userMessage.toLowerCase().includes("data") ||
				userMessage.toLowerCase().includes("geo") ||
				userMessage.toLowerCase().includes("sra")
			) {
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
				// Check if this is an analysis request (even without datasets selected)
				const analysisKeywords = [
					"analyze",
					"analysis",
					"assess",
					"evaluate",
					"examine",
					"investigate",
					"perform",
					"conduct",
					"run",
					"execute",
					"differential expression",
					"clustering",
					"visualization",
					"heatmap",
					"umap",
					"pca",
					"markers",
					"subtypes",
					"pathway",
					"enrichment",
					"correlation",
					"statistical",
					"transcriptional",
					"gene expression",
					"single cell",
					"scrnaseq",
				];

				const isAnalysisRequest = analysisKeywords.some((keyword) =>
					userMessage.toLowerCase().includes(keyword)
				);

				if (isAnalysisRequest) {
					// This is an analysis request, but no datasets are selected yet
					addMessage(
						`Analysis Request Detected!\n\n` +
							`I can help you with: ${userMessage}\n\n` +
							`However, I need to find relevant datasets first. Let me search for datasets related to your analysis:\n\n` +
							`Searching for: ${userMessage}`,
						false
					);

					// Automatically search for relevant datasets
					setProgressMessage("Searching for relevant datasets...");
					setShowSearchDetails(true);

					// Check if backendClient is available
					if (!backendClient) {
						addMessage(
							"Backend client not initialized. Please wait a moment and try again.",
							false
						);
						return;
					}

					// Set up progress callback for real-time updates
					backendClient.setProgressCallback((progress) => {
						updateProgressData(progress);
					});

					// Initialize search progress
					setSearchProgress({
						message: "Initializing search...",
						progress: 0,
						step: "init",
						datasetsFound: 0,
					});

					const response = await backendClient.discoverDatasets(userMessage, {
						limit: 50, // Show more datasets, pagination will handle display
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

					// Keep progress visible for a moment, then clear
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
							"What would you like to do?",
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

				responseContent += `Perfect! Let me provide some analysis suggestions based on your selections.\n\n`;

				addMessage(responseContent, false);

				// Generate simple AI-powered suggestions
				try {
					// Quick data type inference
					const hasRNASeq = selectedDatasets.some(
						(d) =>
							(d.title || "").toLowerCase().includes("rna-seq") ||
							(d.title || "").toLowerCase().includes("rnaseq") ||
							(d.title || "").toLowerCase().includes("transcriptome")
					);

					const hasSingleCell = selectedDatasets.some(
						(d) =>
							(d.title || "").toLowerCase().includes("single cell") ||
							(d.title || "").toLowerCase().includes("single-cell") ||
							(d.title || "").toLowerCase().includes("sc-rna")
					);

					const dataTypeContext = hasSingleCell
						? "single-cell RNA-seq"
						: hasRNASeq
						? "RNA-seq"
						: "expression";

					console.log(
						"ChatPanel: Generating simple suggestions for",
						dataTypeContext,
						"data"
					);

					// Use existing loading mechanism
					setIsLoading(true);
					setProgressMessage("Generating analysis suggestions...");

					try {
						// Make a simple backend call for short suggestions
						const suggestionText = await generateShortSuggestions(
							selectedDatasets
						);

						// Check if it contains suggestions to render as buttons
						if (suggestionText.startsWith("SUGGESTIONS:")) {
							const suggestions = JSON.parse(
								suggestionText.replace("SUGGESTIONS:", "")
							);

							// Store suggestions in state for rendering
							setSuggestionButtons(suggestions);

							// Add a simple message indicating suggestions are available
							addMessage("Here are some analysis suggestions:", false);
						} else {
							// Add regular text
							addMessage(suggestionText, false);
						}
					} finally {
						setIsLoading(false);
						setProgressMessage("");
					}
				} catch (error) {
					console.error("ChatPanel: Error generating suggestions:", error);
					// Add fallback suggestions even if there's an error
					addMessage(
						"[Perform exploratory analysis](analyze:exploratory), [Create visualizations](analyze:visualization), [Run quality control](analyze:quality_control)",
						false
					);
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

				// Convert selected datasets to the format expected by AutonomousAgent
				const datasets = selectedDatasets.map((dataset) => ({
					id: dataset.id,
					title: dataset.title,
					source: "GEO",
					organism: dataset.organism || "Unknown",
					samples: 0, // Will be updated during download
					platform: "Unknown",
					description: dataset.description || "",
					url:
						dataset.url ||
						`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}`,
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
		setInputValue(e.target.value);

		// Auto-resize textarea
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
	};

	const toggleChat = () => {
		uiDispatch({
			type: "SET_CHAT_COLLAPSED",
			payload: !uiState.chatCollapsed,
		});
	};

	const handleStopProcessing = () => {
		setIsLoading(false);
		setIsProcessing(false);
		setProgressMessage("");
		addMessage("Processing stopped by user.", false);
	};

	const handleSuggestionSelect = useCallback(
		async (suggestion: AnalysisSuggestion) => {
			addMessage(`I want to perform: ${suggestion.title}`, true);

			// Start the selected analysis
			if (selectedDatasets.length > 0) {
				try {
					setIsLoading(true);
					setProgressMessage(`Starting ${suggestion.title}...`);

					// Use the suggestion title as the analysis request
					await handleAnalysisRequest(suggestion.title);
				} catch (error) {
					console.error("Error executing selected suggestion:", error);
					addMessage(
						"Sorry, I encountered an error starting the analysis. Please try again.",
						false
					);
				} finally {
					setIsLoading(false);
					setProgressMessage("");
				}
			} else {
				addMessage(
					"Please select datasets first before starting the analysis.",
					false
				);
			}
		},
		[
			selectedDatasets,
			handleAnalysisRequest,
			analysisDispatch,
			scrollToBottomImmediate,
		]
	);

	const handleCustomAnalysis = useCallback(() => {
		addMessage("I'd like to create a custom analysis", true);
		addMessage(
			'Custom Analysis Mode\n\nPlease describe what specific analysis you\'d like to perform with your selected datasets. For example:\n\n• "Find differentially expressed genes between conditions"\n• "Perform clustering analysis to identify cell types"\n• "Analyze pathway enrichment in my data"\n• "Create visualizations comparing samples"\n\nJust describe your analysis goal and I\'ll help you create a custom workflow!',
			false
		);
	}, [analysisDispatch, scrollToBottomImmediate]);

	return (
		<div className={`chat-panel ${className || ""}`}>
			<div className="chat-header">
				<h3>AI Assistant</h3>
				<button
					onClick={toggleChat}
					className="chat-toggle-button"
					title={uiState.chatCollapsed ? "Expand Chat" : "Collapse Chat"}
				>
					{uiState.chatCollapsed ? <FiMaximize2 /> : <FiMinimize2 />}
				</button>
			</div>

			<div className="chat-messages">
				{analysisState.messages.map((message: any) => (
					<div key={message.id}>
						<ChatMessage
							message={message}
							onAnalysisClick={handleAnalysisClick}
						/>
						{message.code && (
							<div style={{ marginTop: "8px", marginLeft: "44px" }}>
								<ExpandableCodeBlock
									code={message.code}
									language={message.codeLanguage || "python"}
									title={message.codeTitle || "Generated Code"}
									isStreaming={message.status === "pending"}
								/>
							</div>
						)}
						{message.suggestions && (
							<div style={{ marginTop: "8px", marginLeft: "44px" }}>
								<AnalysisSuggestionsComponent
									suggestions={message.suggestions}
									onSuggestionSelect={handleSuggestionSelect}
									onCustomAnalysis={handleCustomAnalysis}
								/>
							</div>
						)}
					</div>
				))}

				{/* Processing indicator with animated dots */}
				{isProcessing && (
					<div className="processing-indicator">
						<div className="processing-content">
							<span className="processing-text">
								{analysisState.analysisStatus ||
									progressMessage ||
									"Processing"}
							</span>
							<span className="loading-dots">
								<span>.</span>
								<span>.</span>
								<span>.</span>
							</span>
						</div>
					</div>
				)}

				{/* Validation Errors Display */}
				{validationErrors.length > 0 && (
					<div className="validation-errors-indicator">
						<div className="validation-errors-header">
							<div className="validation-errors-title">
								<span>Code Validation Errors</span>
								<div className="error-dot"></div>
							</div>
						</div>
						<div className="validation-errors-details">
							{validationErrors.map((error, index) => (
								<div key={index} className="validation-error-item">
									<span className="error-number">{index + 1}.</span>
									<span className="error-message">{error}</span>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Simple Search Progress Indicator */}
				{searchProgress && (
					<div
						style={{
							background: "#2d2d30",
							border: "1px solid #3c3c3c",
							borderRadius: "8px",
							margin: "0",
							padding: "12px",
							color: "white",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								marginBottom: "8px",
							}}
						>
							<span style={{ fontWeight: "bold" }}>Search Progress</span>
							<span style={{ color: "#007acc" }}>
								{searchProgress.progress}%
							</span>
						</div>

						<div style={{ marginBottom: "8px" }}>
							<strong>Step:</strong> {searchProgress.step || "Processing"}
						</div>

						<div style={{ marginBottom: "8px" }}>
							<strong>Message:</strong> {searchProgress.message}
						</div>

						{searchProgress.currentTerm && (
							<div style={{ marginBottom: "8px" }}>
								<strong>Search Term:</strong> {searchProgress.currentTerm}
							</div>
						)}

						{searchProgress.datasetsFound !== undefined && (
							<div style={{ marginBottom: "8px" }}>
								<strong>Datasets Found:</strong> {searchProgress.datasetsFound}
							</div>
						)}

						<div
							style={{
								width: "100%",
								height: "8px",
								background: "#1e1e1e",
								borderRadius: "4px",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									width: `${searchProgress.progress}%`,
									height: "100%",
									background: "#007acc",
									transition: "width 0.3s ease",
								}}
							></div>
						</div>
					</div>
				)}

				{/* Status display for analysis progress */}
				{(virtualEnvStatus || isAutoExecuting) && (
					<div className="status-display">
						{/* Virtual Environment Status */}
						{virtualEnvStatus && (
							<div className="status-item virtual-env-status">
								<div
									className="status-header"
									onClick={() => setShowVirtualEnvLog(!showVirtualEnvLog)}
									style={{ cursor: "pointer" }}
								>
									<span>Virtual Environment</span>
									<div className="pulse-dot"></div>
									<span className="expand-arrow">
										{showVirtualEnvLog ? "▼" : "▶"}
									</span>
								</div>
								{showVirtualEnvLog && (
									<div className="status-details">
										<div className="status-log">
											<div className="log-content">{virtualEnvStatus}</div>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Auto-Execution Status */}
						{isAutoExecuting && (
							<div className="status-item auto-execution-status">
								<div className="status-header">
									<span>Auto-Execution Pipeline</span>
									<div className="pulse-dot"></div>
								</div>
								<div className="status-details">
									<div className="status-log">
										<div className="log-content">
											Executing analysis steps automatically...
										</div>
									</div>
								</div>
							</div>
						)}
					</div>
				)}

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

			<div className="chat-input-container">
				<textarea
					value={inputValue}
					onChange={handleTextareaChange}
					onKeyPress={handleKeyPress}
					placeholder="Plan, analyze, or ask me anything"
					disabled={isLoading}
					rows={2}
				/>

				<button
					onClick={isProcessing ? handleStopProcessing : handleSendMessage}
					disabled={!isProcessing && (!inputValue.trim() || isLoading)}
					className={`send-button ${isProcessing ? "stop-mode" : ""}`}
				>
					{isProcessing ? (
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="6" width="12" height="12" fill="#555" />
						</svg>
					) : isLoading ? (
						<div className="loading-dots">
							<span>•</span>
							<span>•</span>
							<span>•</span>
						</div>
					) : (
						<span
							style={{ fontSize: "10px", fontWeight: "900", color: "#2d2d30" }}
						>
							▶
						</span>
					)}
				</button>
			</div>

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
