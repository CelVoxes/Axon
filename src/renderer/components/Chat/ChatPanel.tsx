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
import { FiMinimize2, FiMaximize2 } from "react-icons/fi";
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
	const [activeLocalIndex, setActiveLocalIndex] = useState<number>(-1);
	const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState<number>(-1);

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

	const handleSendMessage = useCallback(async () => {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();
		// Resolve @mentions to local datasets and auto-attach
		const mentionDatasets = resolveAtMentions(userMessage);
		if (mentionDatasets.length > 0) {
			setSelectedDatasets((prev) =>
				mergeSelectedDatasets(prev, mentionDatasets)
			);
			addMessage(
				`Using local data from mentions: ${mentionDatasets
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
				// Check if this is an analysis request (even without datasets selected)
				const isAnalysis = isAnalysisRequest(userMessage);

				if (isAnalysis) {
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
	}, [workspaceMentionItems, mentionOpen]);

	useEffect(() => {
		if (!mentionOpen) return;
		// Reset highlight on query change
		if (workspaceMentionItems.length > 0) {
			setActiveWorkspaceIndex(0);
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

	const handleComposerKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (!mentionOpen) return;
			const total = workspaceMentionItems.length;
			// Navigate within mention list
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (total > 0) {
					setActiveWorkspaceIndex((prev) => {
						const next = prev < 0 ? 0 : Math.min(prev + 1, total - 1);
						return next;
					});
				}
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (total > 0) {
					setActiveWorkspaceIndex((prev) => {
						const next = prev <= 0 ? 0 : prev - 1;
						return next;
					});
				}
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const index = activeWorkspaceIndex >= 0 ? activeWorkspaceIndex : 0;
				void chooseWorkspaceMention(index, false);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMentionOpen(false);
				setMentionQuery("");
				setWorkspaceMentionItems([]);
				setActiveWorkspaceIndex(-1);
				setActiveLocalIndex(-1);
				return;
			}
		},
		[
			mentionOpen,
			workspaceMentionItems.length,
			activeWorkspaceIndex,
			chooseWorkspaceMention,
		]
	);

	const toggleChat = () => {
		uiDispatch({
			type: "SET_CHAT_COLLAPSED",
			payload: !uiState.chatCollapsed,
		});
	};

	// Intent detection moved to useChatIntent hook

	const handleStopProcessing = () => {
		setIsLoading(false);
		setIsProcessing(false);
		setProgressMessage("");
		addMessage("Processing stopped by user.", false);
	};

	// Composer change handler with @-mention detection
	const handleComposerChange = useCallback(
		(next: string) => {
			setInputValue(next);
			const match = next.match(/@([^\s@]*)$/);
			if (match) {
				setMentionOpen(true);
				setMentionQuery(match[1] || "");
				(async () => {
					try {
						if (!workspaceState.currentWorkspace) {
							setWorkspaceMentionItems([]);
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
					} catch {
						setWorkspaceMentionItems([]);
					}
				})();
			} else if (mentionOpen) {
				setMentionOpen(false);
				setMentionQuery("");
				setWorkspaceMentionItems([]);
			}
		},
		[mentionOpen, workspaceState.currentWorkspace]
	);

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
				<h3></h3>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						onClick={toggleChat}
						className="chat-toggle-button"
						title={uiState.chatCollapsed ? "Expand Chat" : "Collapse Chat"}
					>
						{uiState.chatCollapsed ? <FiMaximize2 /> : <FiMinimize2 />}
					</button>
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
			/>

			{/* @ mention suggestions menu */}
			<MentionSuggestions
				isOpen={mentionOpen}
				items={localRegistryRef.current?.list() || []}
				workspaceItems={workspaceMentionItems}
				query={mentionQuery}
				hideLocal={true}
				hideFolders={false}
				activeWorkspaceIndex={activeWorkspaceIndex}
				activeLocalIndex={activeLocalIndex}
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
