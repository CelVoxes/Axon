import React, { useState, useRef, useEffect } from "react";
import { useAnalysisContext } from "../../context/AnalysisContext";
import { useUIContext } from "../../context/UIContext";
import { useWorkspaceContext } from "../../context/WorkspaceContext";
import { BackendClient } from "../../services/BackendClient";
import { SearchConfig } from "../../config/SearchConfig";
import ReactMarkdown from "react-markdown";
import { DatasetSelectionModal } from "./DatasetSelectionModal";
import {
	FiSend,
	FiMinimize2,
	FiMaximize2,
	FiChevronDown,
	FiChevronUp,
	FiCopy,
} from "react-icons/fi";
import { AutonomousAgent } from "../../services/AutonomousAgent";

// Expandable Code Block Component
interface ExpandableCodeBlockProps {
	code: string;
	language?: string;
	title?: string;
}

const ExpandableCodeBlock: React.FC<ExpandableCodeBlockProps> = ({
	code,
	language = "python",
	title = "Generated Code",
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	return (
		<div className="expandable-code-block">
			<div className="code-header" onClick={() => setIsExpanded(!isExpanded)}>
				<div className="code-header-left">
					<span className="code-title">{title}</span>
					<span className="code-language">{language}</span>
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
						<code className={`language-${language}`}>{code}</code>
					</pre>
				</div>
			)}
		</div>
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
	const [codeGenerationLog, setCodeGenerationLog] = useState<
		Array<{ code: string; step: string; timestamp: string }>
	>([]);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [searchLog, setSearchLog] = useState<string[]>([]);
	const [currentCodeGeneration, setCurrentCodeGeneration] =
		useState<string>("");
	const [isGeneratingCode, setIsGeneratingCode] = useState(false);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState<string>("");
	const [codeWritingLog, setCodeWritingLog] = useState<any[]>([]);
	const [showVirtualEnvLog, setShowVirtualEnvLog] = useState(false);
	const [showCodeLog, setShowCodeLog] = useState(false);
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [selectedDatasets, setSelectedDatasets] = useState<any[]>([]);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const backendClient = new BackendClient();

	// Add welcome message on first load
	useEffect(() => {
		if (analysisState.messages.length === 0) {
			analysisDispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `# Welcome to Axon! 🧬

I'm your AI assistant for bioinformatics analysis. I can help you:

🔍 **Search and download datasets** from GEO, SRA, and other repositories
📊 **Analyze gene expression data** with differential expression, clustering, and visualization
🧬 **Process single-cell data** with Scanpy and modern single-cell analysis tools
📈 **Create publication-ready visualizations** and statistical analyses
🔬 **Perform pathway and enrichment analysis** on your results

**To get started:**
1. Ask me to search for datasets related to your research
2. Select the datasets you want to analyze
3. Specify what analysis you'd like to perform
4. I'll generate and execute the analysis code for you

What would you like to analyze today?`,
					isUser: false,
				},
			});
		}
	}, [analysisState.messages.length, analysisDispatch]);

	// Listen for live LLM code generation events
	useEffect(() => {
		const handleLLMCodeGeneration = (event: CustomEvent) => {
			// Handle start event
			if (event.detail.type === "llm_generation_start") {
				setIsGeneratingCode(true);
				setCurrentCodeGeneration("");
				return;
			}

			setIsGeneratingCode(true);
			setCurrentCodeGeneration((prev) => {
				const newCode = prev + (event.detail.chunk || "");
				return newCode;
			});
		};

		const handleLLMCodeComplete = (event: CustomEvent) => {
			setIsGeneratingCode(false);

			// Add the complete generated code as a message with expandable code block
			if (event.detail.totalCode) {
				addMessage(
					"",
					false,
					event.detail.totalCode,
					"python",
					"Generated Code"
				);
			}

			// Clear the current generation
			setCurrentCodeGeneration("");
		};

		// Listen for virtual environment status updates
		const handleVirtualEnvStatus = (data: any) => {
			console.log("ChatPanel: Virtual environment status:", data);
			setVirtualEnvStatus(data.status || data.message || "");
			if (data.status === "installing_package" && data.package) {
				addMessage(`📦 **Installing: ${data.package}**`, false);
			} else if (data.status === "completed") {
				addMessage(`🔧 **${data.message}**`, false);
			}
		};

		// Listen for Jupyter ready events
		const handleJupyterReady = (data: any) => {
			console.log("ChatPanel: Jupyter ready:", data);
			if (data.status === "ready") {
				addMessage(`✅ **Jupyter environment ready!**`, false);
			} else if (data.status === "error") {
				addMessage(`❌ **Jupyter setup failed: ${data.message}**`, false);
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
			window.removeEventListener(
				"llm-code-generation",
				handleLLMCodeGeneration as EventListener
			);
			window.removeEventListener(
				"llm-code-complete",
				handleLLMCodeComplete as EventListener
			);
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

	const scrollToBottom = () => {
		setTimeout(() => {
			if (messagesEndRef.current) {
				messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
			}
		}, 100);
	};

	const scrollToBottomImmediate = () => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: "auto" });
		}
	};

	const addMessage = (
		content: string,
		isUser: boolean = false,
		code?: string,
		codeLanguage?: string,
		codeTitle?: string
	) => {
		analysisDispatch({
			type: "ADD_MESSAGE",
			payload: {
				content,
				isUser,
				code,
				codeLanguage,
				codeTitle,
			},
		});
		scrollToBottomImmediate();
	};

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

	const handleSendMessage = async () => {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();
		addMessage(userMessage, true);
		setInputValue("");
		setIsLoading(true);
		setIsProcessing(true);

		try {
			// Check if the message is about searching for datasets
			if (
				userMessage.toLowerCase().includes("search") ||
				userMessage.toLowerCase().includes("find") ||
				userMessage.toLowerCase().includes("dataset") ||
				userMessage.toLowerCase().includes("data") ||
				userMessage.toLowerCase().includes("geo") ||
				userMessage.toLowerCase().includes("sra")
			) {
				// Search for datasets
				setProgressMessage("🔍 Searching for datasets...");
				setShowSearchDetails(true);

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
					limit: SearchConfig.getSearchLimit(),
				});

				if (response.datasets && response.datasets.length > 0) {
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
			addMessage("❌ Sorry, I encountered an error. Please try again.", false);
		} finally {
			setIsLoading(false);
			setIsProcessing(false);
			setProgressMessage("");
		}
	};

	const handleDatasetSelection = async (selectedDatasets: any[]) => {
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
	};

	// Function to handle analysis requests
	const handleAnalysisRequest = async (analysisRequest: string) => {
		if (selectedDatasets.length === 0) {
			addMessage("❌ No datasets selected for analysis.", false);
			return;
		}

		try {
			setIsLoading(true);
			setProgressMessage("🚀 Starting analysis process...");

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

			console.log("Starting analysis with:", {
				originalQuery,
				analysisRequest,
				datasets: datasets.map((d) => d.id),
				currentWorkspace: workspaceState.currentWorkspace,
			});

			// Create AutonomousAgent instance
			const baseWorkspacePath = workspaceState.currentWorkspace || "/tmp";
			console.log("Using base workspace path:", baseWorkspacePath);
			const agent = new AutonomousAgent(backendClient, baseWorkspacePath);
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

			// Set up code generation callback
			agent.setCodeGenerationCallback((code, step) => {
				const newEntry = {
					code,
					step,
					timestamp: new Date().toISOString(),
				};
				setCodeGenerationLog((prev) => [...prev, newEntry]);

				// Add code generation to chat with expandable code block (raw LLM output)
				addMessage("", false, code, "python", "Generated Code");
			});

			// Create analysis workspace
			setProgressMessage("📁 Creating analysis workspace...");
			const workspaceDir = await agent.createAnalysisWorkspace(originalQuery);
			console.log("Analysis workspace created:", workspaceDir);

			// Generate analysis steps with user-specific request
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

			// Generate unified notebook
			setProgressMessage("📓 Generating unified analysis notebook...");
			const notebookPath = await agent.generateUnifiedNotebook(
				originalQuery,
				datasets,
				analysisResult.steps,
				workspaceDir
			);
			console.log("Unified notebook generated:", notebookPath);
			addMessage(
				`📓 **Complete analysis notebook created: ${notebookPath
					.split("/")
					.pop()}**`,
				false
			);

			console.log("Analysis workspace created:", workspaceDir);
			addMessage("💾 **Analysis workspace ready!**", false);
			addMessage(
				"📁 **Single comprehensive notebook created** with:\n" +
					"• Package installation\n" +
					"• Data download and preprocessing\n" +
					"• Complete analysis pipeline\n" +
					"• All steps in logical order",
				false
			);

			// List files in the workspace for debugging
			try {
				const files = await window.electronAPI.listDirectory(workspaceDir);
				console.log("Files in analysis workspace:", files);
				addMessage(`📁 **Workspace contains ${files.length} files**`, false);
			} catch (error) {
				console.error("Error listing workspace files:", error);
			}

			addMessage("🎯 **Analysis workspace created successfully!**", false);
			addMessage(
				"💡 **Ready to analyze:**\n" +
					"• Open the generated `.ipynb` file in Jupyter\n" +
					"• Run cells in order for complete analysis\n" +
					"• All data download and analysis in one notebook",
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
	};

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
					<div
						key={message.id}
						className={`message ${message.isUser ? "user" : "assistant"}`}
					>
						<div className="message-content">
							<ReactMarkdown>{message.content}</ReactMarkdown>
							{message.code && (
								<ExpandableCodeBlock
									code={message.code}
									language={message.codeLanguage || "python"}
									title={message.codeTitle || "Generated Code"}
								/>
							)}
						</div>
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

				{/* Real-time Code Generation */}
				{isGeneratingCode && currentCodeGeneration && (
					<div className="code-generation-indicator">
						<div className="code-generation-header">
							<div className="code-generation-title">
								<span>🤖 Generating Code...</span>
								<div className="pulse-dot"></div>
							</div>
						</div>
						<div className="code-generation-details">
							<ExpandableCodeBlock
								code={currentCodeGeneration}
								language="python"
								title="Code in Progress..."
							/>
						</div>
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
						{codeWritingLog && codeWritingLog.length > 0 && (
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
											{(codeWritingLog || []).slice(-10).map((entry, index) => (
												<div key={index} className="log-entry">
													<div className="log-entry-header">
														<span>
															⏱️{" "}
															{new Date(entry.timestamp).toLocaleTimeString()}
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
										</div>
									</div>
								)}
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
						<span style={{ fontSize: "12px", color: "#555" }}>⏹</span>
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
