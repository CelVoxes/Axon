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
import { AnalysisPlanner } from "../../services/AnalysisPlanner";
import {
	AnalysisSuggestionsService,
	DataTypeSuggestions,
	AnalysisSuggestion,
} from "../../services/AnalysisSuggestionsService";
import { AnalysisSuggestionsComponent } from "./AnalysisSuggestionsComponent";

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

	// Auto-expand when streaming starts
	useEffect(() => {
		if (isStreaming) {
			setIsExpanded(true);
		}
	}, [isStreaming]);

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
			<div className="code-header" onClick={() => setIsExpanded(!isExpanded)}>
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
				<div className="code-content">
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

const MessageContent: React.FC<MessageContentProps> = ({ content, isStreaming = false }) => {
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

	const formatContent = useCallback((content: string): React.ReactNode => {
		// Split content by code blocks
		const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
		const parts: React.ReactNode[] = [];
		let lastIndex = 0;
		let match;
		let blockIndex = 0;

		while ((match = codeBlockRegex.exec(content)) !== null) {
			// Add text before code block
			if (match.index > lastIndex) {
				const textContent = content.slice(lastIndex, match.index);
				if (textContent.trim()) {
					parts.push(
						<div 
							key={`text-${blockIndex}`}
							className="message-text"
							dangerouslySetInnerHTML={{
								__html: textContent
									.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
									.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>")
									.replace(/\n/g, "<br />")
							}}
						/>
					);
				}
			}

			// Add code block
			const language = match[1] || "text";
			const code = match[2];
			const blockId = `code-${blockIndex}-${Math.random().toString(36).substr(2, 9)}`;
			const isExpanded = expandedBlocks.has(blockId) || isStreaming;
			const isCopied = copiedBlocks.has(blockId);

			parts.push(
				<ExpandableCodeBlock
					key={blockId}
					code={code}
					language={language}
					title="Code"
					isStreaming={isStreaming}
				/>
			);

			lastIndex = match.index + match[0].length;
			blockIndex++;
		}

		// Add remaining text
		if (lastIndex < content.length) {
			const textContent = content.slice(lastIndex);
			if (textContent.trim()) {
				parts.push(
					<div 
						key={`text-${blockIndex}`}
						className="message-text"
						dangerouslySetInnerHTML={{
							__html: textContent
								.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
								.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>")
								.replace(/\n/g, "<br />")
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
							.replace(/\n/g, "<br />")
					}}
				/>
			);
		}

		return parts;
	}, [expandedBlocks, copiedBlocks, isStreaming]);

	return <div className="message-content-wrapper">{formatContent(content)}</div>;
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
	const [codeGenerationLog, setCodeGenerationLog] = useState<
		Array<{ code: string; step: string; timestamp: string }>
	>([]);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [isGeneratingCode, setIsGeneratingCode] = useState(false);
	const [currentCodeGeneration, setCurrentCodeGeneration] = useState("");
	const [isCodeGenerationComplete, setIsCodeGenerationComplete] =
		useState(false);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState("");
	const [recentMessages, setRecentMessages] = useState<string[]>([]);
	const [processedEvents, setProcessedEvents] = useState<Set<string>>(
		new Set()
	);
	const [lastCodeCallback, setLastCodeCallback] = useState<string>("");
	const [agentInstance, setAgentInstance] = useState<any>(null);
	const [processedCodeSignatures, setProcessedCodeSignatures] = useState<
		Set<string>
	>(new Set());
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [searchLog, setSearchLog] = useState<string[]>([]);
	const [codeWritingLog, setCodeWritingLog] = useState<any[]>([]);
	const [showVirtualEnvLog, setShowVirtualEnvLog] = useState(false);
	const [showCodeLog, setShowCodeLog] = useState(false);
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [selectedDatasets, setSelectedDatasets] = useState<any[]>([]);
	const [currentSuggestions, setCurrentSuggestions] =
		useState<DataTypeSuggestions | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const [backendClient, setBackendClient] = useState<BackendClient | null>(null);

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
				console.log("⚠️ BackendClient initialized with default URL: http://localhost:8000");
			}
		};
		initBackendClient();
	}, []);

	// Analysis suggestions service
	const suggestionsService = React.useMemo(() => {
		if (!backendClient) return null;
		return new AnalysisSuggestionsService(backendClient);
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
				addMessage(`📦 **Installing: ${data.package}**`, false);
			} else if (data.status === "packages_installed") {
				addMessage(`✅ **${data.message}**`, false);
			} else if (data.status === "completed") {
				addMessage(`🔧 **${data.message}**`, false);
			} else if (data.status === "error") {
				addMessage(`❌ **${data.message}**`, false);
			}
		};

		// Listen for Jupyter ready events
		const handleJupyterReady = (data: any) => {
			if (!isMounted) return;
			if (data.status === "ready") {
				addMessage(`✅ **Jupyter environment ready!**`, false);
			} else if (data.status === "error") {
				addMessage(`❌ **Jupyter setup failed: ${data.message}**`, false);
			} else if (data.status === "starting") {
				addMessage(`🔄 **Starting Jupyter server...**`, false);
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
						addMessage("❌ Backend client not initialized. Please wait a moment and try again.", false);
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
					console.log("❌ Response.datasets.length:", response.datasets?.length);
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
						`🔬 **Analysis Request Detected!**\n\n` +
							`I can help you with: **${userMessage}**\n\n` +
							`However, I need to find relevant datasets first. Let me search for datasets related to your analysis:\n\n` +
							`**Searching for:** ${userMessage}`,
						false
					);

					// Automatically search for relevant datasets
					setProgressMessage("🔍 Searching for relevant datasets...");
					setShowSearchDetails(true);

					// Check if backendClient is available
					if (!backendClient) {
						addMessage(
							"❌ Backend client not initialized. Please wait a moment and try again.",
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

						let responseContent = `## 🔍 Found ${response.datasets.length} Relevant Datasets\n\n`;
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
							"❌ No datasets found for your analysis request. Try being more specific about the disease, tissue, or organism you're interested in.",
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
				backendClientUrl: backendClient?.getBaseUrl()
			});
			if (isMounted) {
				addMessage(
					"❌ Sorry, I encountered an error. Please try again.",
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

		return () => {
			isMounted = false;
		};
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

	// Listen for live LLM code generation events
	useEffect(() => {
		let isMounted = true;

		const handleLLMCodeGeneration = (event: CustomEvent) => {
			if (!isMounted) return;
			const { chunk, step } = event.detail;

			if (chunk && step) {
				// If this is the first chunk of a new generation, reset the code
				if (!isGeneratingCode && !isCodeGenerationComplete) {
					setCurrentCodeGeneration(chunk);
				} else {
					setCurrentCodeGeneration((prev) => prev + chunk);
				}
				setIsGeneratingCode(true);
				setIsCodeGenerationComplete(false);
			}
		};

		const handleLLMCodeComplete = (event: CustomEvent) => {
			if (!isMounted) return;
			const { code, step } = event.detail;

			if (code && step) {
				setCurrentCodeGeneration(code);
				setIsGeneratingCode(false);
				setIsCodeGenerationComplete(true);
			}
		};

		// Add event listeners
		window.addEventListener(
			"llm-code-generation",
			handleLLMCodeGeneration as EventListener
		);
		window.addEventListener(
			"llm-code-complete",
			handleLLMCodeComplete as EventListener
		);

		// Cleanup
		return () => {
			isMounted = false;
			window.removeEventListener(
				"llm-code-generation",
				handleLLMCodeGeneration as EventListener
			);
			window.removeEventListener(
				"llm-code-complete",
				handleLLMCodeComplete as EventListener
			);
		};
	}, [isGeneratingCode, isCodeGenerationComplete]);

	const handleDatasetSelection = useCallback(
		async (selectedDatasets: any[]) => {
			setShowDatasetModal(false);

			if (selectedDatasets.length > 0) {
				// Store selected datasets for analysis
				setSelectedDatasets(selectedDatasets);

				// Show initial selection message
				let responseContent = `## ✅ Selected ${selectedDatasets.length} Datasets\n\n`;

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

				responseContent += `**🚀 Ready to Analyze!**\n\n`;
				responseContent += `Now tell me what analysis you'd like to perform on these datasets.\n\n`;
				responseContent += `**Examples:**\n`;
				responseContent += `• "Perform differential expression analysis between conditions"\n`;
				responseContent += `• "Find cell type markers and create UMAP visualization"\n`;
				responseContent += `• "Analyze gene expression patterns and identify clusters"\n`;
				responseContent += `• "Compare expression profiles across different time points"\n\n`;
				responseContent += `**💡 Tip:** Be specific about what you want to analyze and what outputs you expect.`;

				addMessage(responseContent, false);
			}
		},
		[
			suggestionsService,
			analysisState.messages,
			analysisDispatch,
			scrollToBottomImmediate,
		]
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
						const suggestions = await suggestionsService.generateSuggestions(
							dataTypes,
							message,
							selectedDatasets
						);

						addMessage("", false, undefined, undefined, undefined, suggestions);
					} else {
						addMessage(
							"💡 **General Analysis Suggestions:**\n\n" +
								"Since I don't have specific data type information, here are some general analyses you can perform:\n\n" +
								"• **Exploratory Data Analysis**: Load and examine your data structure\n" +
								"• **Quality Control**: Check data quality and identify potential issues\n" +
								"• **Statistical Analysis**: Perform basic statistical tests\n" +
								"• **Visualization**: Create plots and charts to understand patterns\n" +
								"• **Differential Analysis**: Compare conditions or groups\n\n" +
								"**💡 Tip**: Be specific about what you want to analyze, and I'll provide more targeted suggestions!",
							false
						);
					}
				} else {
					// No datasets selected, provide general suggestions
					addMessage(
						"💡 **Getting Started Suggestions:**\n\n" +
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
							"**💡 Tip**: Start by searching for datasets related to your research question, then I'll provide specific analysis suggestions!",
						false
					);
				}
			} catch (error) {
				console.error("Error generating suggestions:", error);
				addMessage(
					"❌ Sorry, I encountered an error generating suggestions. Please try again.",
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
				addMessage("❌ No datasets selected for analysis.", false);
				return;
			}

			try {
				setIsLoading(true);
				setProgressMessage("🚀 Starting analysis process...");

				// Reset agent instance and processed signatures for new analysis
				setAgentInstance(null);
				setProcessedCodeSignatures(new Set());

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
						"❌ No workspace is currently open. Please open a workspace first.",
						false
					);
					return;
				}
				const workspaceDir = workspaceState.currentWorkspace;
				
				// Check if backendClient is available
				if (!backendClient) {
					addMessage("❌ Backend client not initialized. Please wait a moment and try again.", false);
					return;
				}
				
				// Create AutonomousAgent instance (kernel name will be set after workspace is created)
				const agent = new AutonomousAgent(backendClient, workspaceDir, undefined, undefined);
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
						addMessage(`🔄 **${status}**`, false);
					}
				});

				// Set up validation error callback
				agent.setValidationErrorCallback((errors, warnings) => {
					setValidationErrors(errors);
					setValidationWarnings(warnings);

					// Add validation errors to chat
					if (errors.length > 0) {
						let errorMessage = `⚠️ **Code Validation Errors Found:**\n\n`;
						errors.forEach((error, index) => {
							errorMessage += `${index + 1}. ${error}\n`;
						});
						addMessage(errorMessage, false);
					}

					// Add validation warnings to chat
					if (warnings.length > 0) {
						let warningMessage = `⚠️ **Code Validation Warnings:**\n\n`;
						warnings.forEach((warning, index) => {
							warningMessage += `${index + 1}. ${warning}\n`;
						});
						addMessage(warningMessage, false);
					}
				});

				// Set up code generation callbacks IMMEDIATELY (before any code generation happens)
				console.log(
					"Setting up code generation callbacks for new agent instance"
				);
				setAgentInstance(agent);

				// Track the last message ID for each step to update it
				const stepMessageIds = new Map<string, string>();
				const streamingSteps = new Set<string>();

				// Streaming is now handled via DOM events only
				// This avoids conflicts between multiple streaming systems

				// Set up final code callback to close the streaming message
				agent.setCodeGenerationCallback((code, step) => {
					console.log(
						"ChatPanel: Final code generation callback received for step:",
						step,
						"code length:",
						code.length
					);
					// Mark this step as completed
					streamingSteps.add(step + "_completed");

					// Find the streaming message and close it
					const currentMessages = analysisState.messages;
					const messageIndex = currentMessages.findIndex(
						(m) => m.content.includes("```python") && !m.content.endsWith("```")
					);

					if (messageIndex !== -1) {
						console.log("ChatPanel: Closing streaming message for step:", step);
						// Close the streaming message with the final code
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: currentMessages[messageIndex].id,
								updates: {
									content: `\`\`\`python\n${code}\n\`\`\``,
								},
							},
						});

						// Store for future updates
						stepMessageIds.set(step, currentMessages[messageIndex].id);
					} else {
						console.log(
							"ChatPanel: No streaming message found, creating new message for step:",
							step
						);
						// Fallback: create a new message if no streaming message exists
						analysisDispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `\`\`\`python\n${code}\n\`\`\``,
								isUser: false,
							},
						});
					}
				});

				// Set up LLM fix callback
				agent.setLLMFixCallback((originalCode, fixedCode, problem) => {
					// Add a message about the fix being applied
					addMessage(
						`🔧 **LLM Auto-Fix Applied**\n\n` +
							`**Problem detected:** ${problem.substring(0, 200)}...\n\n` +
							`**Original code has been automatically fixed and re-executed.**`,
						false
					);

					// Show the fixed code
					addMessage("", false, fixedCode, "python", "🔧 Fixed Code");
				});

				// Generate analysis steps with user-specific request (code generation callbacks are now set up)
				setProgressMessage("🔬 Generating analysis steps...");
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
					`✅ **Generated ${analysisResult.steps.length} analysis steps!**`,
					false
				);

				// Step 1: Create the initial notebook (empty)
				setProgressMessage("📓 Creating initial notebook...");
				const notebookPath = await agent.generateUnifiedNotebook(
					originalQuery,
					datasets,
					analysisResult.steps,
					analysisResult.workingDirectory // Use the question-specific workspace
				);
				console.log("Initial notebook created:", notebookPath);
				addMessage(
					`📓 **Initial notebook created: ${notebookPath.split("/").pop()}**`,
					false
				);

				// Step 2: Open the notebook in the editor (wait for it to be ready)
				setProgressMessage("🔓 Opening notebook in editor...");
				addMessage("🔓 **Notebook opened in editor**", false);

				// Step 3: Now start code generation and streaming to chat
				setProgressMessage("🤖 Starting AI code generation...");
				await agent.startNotebookCodeGeneration(
					notebookPath,
					originalQuery,
					datasets,
					analysisResult.steps,
					analysisResult.workingDirectory
				);

				// Step 4: Notify user that cells are ready for manual execution
				addMessage(
					`🚀 **Notebook Ready!**\n\n` +
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
				addMessage("💾 **Analysis workspace ready!**", false);
				addMessage(
					"📁 **Notebook created and populated** with:\n" +
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
					addMessage(`📁 **Workspace contains ${files.length} files**`, false);
				} catch (error) {
					console.error("Error listing workspace files:", error);
				}

				addMessage("🎯 **Analysis workspace created successfully!**", false);
				addMessage(
					"💡 **Ready to analyze:**\n" +
						"• Notebook is open with all cells added\n" +
						"• All cells are ready for manual execution\n" +
						"• Use notebook controls to run cells when ready",
					false
				);
			} catch (error) {
				console.error("Error starting analysis:", error);
				let errorMessage = `## ❌ Analysis Setup Failed\n\n`;
				errorMessage += `**Error:** ${
					error instanceof Error ? error.message : String(error)
				}\n\n`;
				errorMessage += `**Troubleshooting:**\n`;
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
		addMessage("⏹️ **Processing stopped by user.**", false);
	};

	const handleSuggestionSelect = useCallback(
		async (suggestion: AnalysisSuggestion) => {
			addMessage(`I want to perform: ${suggestion.title}`, true);

			// Start the selected analysis
			if (selectedDatasets.length > 0) {
				try {
					setIsLoading(true);
					setProgressMessage(`🔄 Starting ${suggestion.title}...`);

					// Use the suggestion title as the analysis request
					await handleAnalysisRequest(suggestion.title);
				} catch (error) {
					console.error("Error executing selected suggestion:", error);
					addMessage(
						"❌ Sorry, I encountered an error starting the analysis. Please try again.",
						false
					);
				} finally {
					setIsLoading(false);
					setProgressMessage("");
				}
			} else {
				addMessage(
					"❌ Please select datasets first before starting the analysis.",
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
			'🎯 **Custom Analysis Mode**\n\nPlease describe what specific analysis you\'d like to perform with your selected datasets. For example:\n\n• "Find differentially expressed genes between conditions"\n• "Perform clustering analysis to identify cell types"\n• "Analyze pathway enrichment in my data"\n• "Create visualizations comparing samples"\n\nJust describe your analysis goal and I\'ll help you create a custom workflow!',
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
						<ChatMessage message={message} />
						{message.code && (
							<div style={{ marginTop: '8px', marginLeft: '44px' }}>
								<ExpandableCodeBlock
									code={message.code}
									language={message.codeLanguage || "python"}
									title={message.codeTitle || "Generated Code"}
									isStreaming={message.status === "pending"}
								/>
							</div>
						)}
						{message.suggestions && (
							<div style={{ marginTop: '8px', marginLeft: '44px' }}>
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
								<span>⚠️ Code Validation Errors</span>
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

				{/* Live Code Generation - Cursor-like */}
				{currentCodeGeneration && (
					<div className="message-bubble assistant">
						<ExpandableCodeBlock
							code={currentCodeGeneration}
							language="python"
							title=""
							isStreaming={isGeneratingCode}
						/>
					</div>
				)}

				{/* Code Generation Progress */}
				{codeGenerationLog.length > 0 && (
					<div className="code-generation-indicator">
						<div className="code-generation-header">
							<div className="code-generation-title">
								<span>🤖 Code Generation Progress</span>
								<div className="pulse-dot"></div>
							</div>
						</div>
						<div className="code-generation-details">
							{codeGenerationLog.slice(-3).map((entry, index) => (
								<div key={index} className="code-generation-item">
									<div className="code-step-title">{entry.step}</div>
									<div className="code-preview">
										<code>{entry.code.substring(0, 200)}...</code>
									</div>
									<div className="code-timestamp">
										{new Date(entry.timestamp).toLocaleTimeString()}
									</div>
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
							<span style={{ fontWeight: "bold" }}>🔍 Search Progress</span>
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
				{(virtualEnvStatus || codeWritingLog.length > 0 || isAutoExecuting) && (
					<div className="status-display">
						{/* Virtual Environment Status */}
						{virtualEnvStatus && (
							<div className="status-item virtual-env-status">
								<div
									className="status-header"
									onClick={() => setShowVirtualEnvLog(!showVirtualEnvLog)}
									style={{ cursor: "pointer" }}
								>
									<span>🔧 Virtual Environment</span>
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
									<span>⚡ Auto-Execution Pipeline</span>
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

						{/* Code Writing Log */}
						{(codeWritingLog && codeWritingLog.length > 0) ||
							(isGeneratingCode && (
								<div className="status-item code-writing-log">
									<div
										className="status-header"
										onClick={() => setShowCodeLog(!showCodeLog)}
										style={{ cursor: "pointer" }}
									>
										<span>🤖 AI Code Generation (Live)</span>
										<div className="pulse-dot"></div>
										<span className="expand-arrow">
											{showCodeLog ? "▼" : "▶"}
										</span>
									</div>
									{showCodeLog && (
										<div className="status-details">
											<div className="status-log">
												{(codeWritingLog || [])
													.slice(-10)
													.map((entry, index) => (
														<div key={index} className="log-entry">
															<div className="log-entry-header">
																<span>
																	⏱️{" "}
																	{new Date(
																		entry.timestamp
																	).toLocaleTimeString()}
																</span>
																<span>•</span>
																<span>{entry.code?.length || 0} chars</span>
																<span>•</span>
																<span
																	className={`log-type ${
																		entry.type === "llm_generation"
																			? "ai-generation"
																			: "execution"
																	}`}
																>
																	{entry.type === "llm_generation"
																		? "🤖 AI Generation"
																		: "⚡ Execution"}
																</span>
															</div>
															<div className="log-entry-content">
																{entry.code || ""}
															</div>
														</div>
													))}

												{/* Show current streaming or completed code */}
												{(isGeneratingCode || isCodeGenerationComplete) &&
													currentCodeGeneration && (
														<div className="log-entry streaming">
															<div className="log-entry-header">
																<span>
																	⏱️ {new Date().toLocaleTimeString()}
																</span>
																<span>•</span>
																<span>
																	{currentCodeGeneration.length} chars
																</span>
																<span>•</span>
																<span className="log-type ai-generation">
																	{isGeneratingCode
																		? "🤖 AI Generation (Streaming...)"
																		: "🤖 AI Generation (Complete)"}
																</span>
															</div>
															<div className="log-entry-content">
																<pre className="streaming-code">
																	{currentCodeGeneration}
																</pre>
															</div>
														</div>
													)}
											</div>
										</div>
									)}
								</div>
							))}
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
							↵
						</span>
					)}
				</button>
			</div>

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
