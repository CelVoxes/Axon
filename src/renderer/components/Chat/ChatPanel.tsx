import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { FiSend, FiX, FiStopCircle, FiMessageSquare } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { BioRAGClient } from "../../services/BioRAGClient";
import { ChatMessage } from "./ChatMessage";
import { DatasetSelectionModal } from "./DatasetSelectionModal";

const ChatContainer = styled.div<{ collapsed: boolean }>`
	width: 100%;
	height: 100%;
	background: linear-gradient(180deg, #1a1a1a 0%, #151515 100%);
	border-left: 1px solid #2a2a2a;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	position: relative;
`;

const ChatHeader = styled.div`
	padding: 16px 20px;
	border-bottom: 1px solid #2a2a2a;
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: rgba(26, 26, 26, 0.8);
	backdrop-filter: blur(10px);
	position: relative;
	z-index: 10;
`;

const ChatTitle = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	color: #ffffff;
	font-weight: 600;
	font-size: 14px;
	letter-spacing: -0.01em;
`;

const CollapseButton = styled.button`
	background: transparent;
	border: none;
	color: #888;
	cursor: pointer;
	padding: 4px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	&:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.1);
	}
`;

const MessagesContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;

	/* Custom scrollbar */
	&::-webkit-scrollbar {
		width: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
	}

	&::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.2);
	}
`;

const InputContainer = styled.div`
	padding: 20px;
	border-top: 1px solid #2a2a2a;
	background: rgba(26, 26, 26, 0.8);
	backdrop-filter: blur(10px);
`;

const InputWrapper = styled.div`
	display: flex;
	gap: 12px;
	align-items: flex-end;
`;

const TextAreaWrapper = styled.div`
	flex: 1;
	position: relative;
`;

const TextArea = styled.textarea`
	width: 100%;
	background: #2a2a2a;
	border: 1px solid #404040;
	border-radius: 8px;
	padding: 12px 16px;
	color: #ffffff;
	font-size: 14px;
	font-family: inherit;
	resize: none;
	outline: none;
	min-height: 20px;
	max-height: 120px;
	line-height: 1.4;
	transition: all 0.2s ease;

	&:focus {
		border-color: #007acc;
		box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1);
	}

	&::placeholder {
		color: #888;
	}
`;

const SendButton = styled.button<{ disabled: boolean }>`
	background: ${(props) => (props.disabled ? "#404040" : "#007acc")};
	border: none;
	border-radius: 8px;
	color: #ffffff;
	padding: 12px;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};

	&:hover:not(:disabled) {
		background: #005a9e;
		transform: translateY(-1px);
	}

	&:active:not(:disabled) {
		transform: translateY(0);
	}
`;

const StopButton = styled.button`
	background: #dc3545;
	border: none;
	border-radius: 8px;
	color: #ffffff;
	padding: 12px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	&:hover {
		background: #c82333;
		transform: translateY(-1px);
	}

	&:active {
		transform: translateY(0);
	}
`;

// --- Chat History Drawer ---
const ChatHistoryDrawer = styled.div<{ open: boolean }>`
	position: absolute;
	top: 0;
	right: 0;
	width: 320px;
	height: 100%;
	background: #18181a;
	border-left: 1px solid #232326;
	box-shadow: -2px 0 8px rgba(0, 0, 0, 0.12);
	z-index: 20;
	display: flex;
	flex-direction: column;
	transform: translateX(${(props) => (props.open ? "0" : "100%")});
	transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
`;

const ChatHistoryHeader = styled.div`
	padding: 16px 20px 8px 20px;
	font-size: 15px;
	font-weight: 600;
	color: #fff;
	border-bottom: 1px solid #232326;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;

const ChatHistoryList = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 8px 0 0 0;
`;

const ChatHistoryItem = styled.div`
	padding: 12px 20px;
	color: #ccc;
	font-size: 14px;
	cursor: pointer;
	border-bottom: 1px solid #222;
	transition: background 0.15s;
	&:hover {
		background: #232326;
		color: #fff;
	}
`;

const NewChatButton = styled.button`
	margin-right: 12px;
	background: #232326;
	color: #fff;
	border: none;
	border-radius: 6px;
	padding: 7px 16px;
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s;
	&:hover {
		background: #333;
	}
`;

interface ChatPanelProps {
	collapsed: boolean;
	onToggle: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
	collapsed,
	onToggle,
}) => {
	const { state, dispatch } = useAppContext();
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [currentAgent, setCurrentAgent] = useState<any>(null);
	const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
	const [chatSessions, setChatSessions] = useState<any[]>([]);
	const [loadingChats, setLoadingChats] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const bioragClient = new BioRAGClient();

	// New state for dataset selection
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [currentQuery, setCurrentQuery] = useState("");
	const [downloadProgress, setDownloadProgress] = useState<{
		[key: string]: number;
	}>({});

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	useEffect(() => {
		scrollToBottom();
	}, [state.messages]);

	useEffect(() => {
		const adjustTextAreaHeight = () => {
			if (textAreaRef.current) {
				textAreaRef.current.style.height = "auto";
				textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
			}
		};

		adjustTextAreaHeight();
	}, [inputValue]);

	// Load chat sessions from /chats folder
	useEffect(() => {
		const loadChats = async () => {
			if (!state.currentWorkspace) return;
			setLoadingChats(true);
			try {
				const chatsDir = `${state.currentWorkspace}/chats`;
				await window.electronAPI.createDirectory(chatsDir);
				const files = await window.electronAPI.listDirectory(chatsDir);
				const chatFiles = files.filter((f: any) => f.name.endsWith(".json"));
				// Sort by filename (ISO date in name)
				chatFiles.sort((a: any, b: any) => b.name.localeCompare(a.name));
				setChatSessions(chatFiles);
			} catch (e) {
				setChatSessions([]);
			}
			setLoadingChats(false);
		};
		loadChats();
	}, [state.currentWorkspace, chatHistoryOpen]);

	const handleSendMessage = async () => {
		if (!inputValue.trim() || isLoading || !state.currentWorkspace) return;

		const userMessage = inputValue.trim();
		setInputValue("");

		// Add user message
		dispatch({
			type: "ADD_MESSAGE",
			payload: {
				content: userMessage,
				isUser: true,
			},
		});

		setIsLoading(true);

		try {
			// Check if this looks like a biological analysis request
			const analysisKeywords = [
				"analyze",
				"analysis",
				"compare",
				"differential",
				"expression",
				"dataset",
				"gene",
				"protein",
				"pathway",
				"AML",
				"cancer",
				"subtype",
				"biomarker",
				"DEG",
				"RNA-seq",
				"microarray",
				"download",
				"data",
			];

			const isAnalysisRequest = analysisKeywords.some((keyword) =>
				userMessage.toLowerCase().includes(keyword.toLowerCase())
			);

			if (isAnalysisRequest) {
				// Enhanced analysis workflow with dataset discovery
				await executeEnhancedAnalysisRequest(userMessage);
			} else {
				// Regular BioRAG query
				const response = await bioragClient.query({
					question: userMessage,
					max_documents: 5,
					response_type: "answer",
				});

				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: response.answer,
						isUser: false,
					},
				});
			}
		} catch (error) {
			console.error("Chat error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Error: ${
						error instanceof Error ? error.message : "Unknown error occurred"
					}`,
					isUser: false,
					status: "failed",
				},
			});
		} finally {
			setIsLoading(false);
		}
	};

	const executeEnhancedAnalysisRequest = async (query: string) => {
		try {
			dispatch({ type: "SET_ANALYZING", payload: true });
			setCurrentQuery(query);

			// Step 1: Search for relevant datasets first
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: "🔍 Searching for relevant datasets and literature...",
					isUser: false,
				},
			});

			const searchResult = await bioragClient.findDatasetsForQuery(query, {
				includeDatasets: true,
				maxDatasets: 10,
			});

			// Show the initial analysis
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `## Analysis Overview

${searchResult.answer}

**Found ${
						searchResult.datasets.length
					} relevant datasets that could help answer your question.**

${
	searchResult.datasets.length > 0
		? `**Available Datasets:**
${searchResult.datasets
	.map(
		(d, i) =>
			`${i + 1}. **${d.id}** - ${d.title} (${d.samples} samples, ${d.organism})`
	)
	.join("\n")}

Please select which datasets you'd like me to download and analyze.`
		: "No specific datasets were found, but I can help with general analysis."
}`,
					isUser: false,
				},
			});

			if (searchResult.datasets.length > 0) {
				// Show dataset selection modal
				setAvailableDatasets(searchResult.datasets);
				setShowDatasetModal(true);
			} else {
				// Proceed with general analysis
				await executeAnalysisWithoutDatasets(query);
			}
		} catch (error) {
			console.error("Enhanced analysis error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Analysis failed: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
					status: "failed",
				},
			});
		} finally {
			if (!showDatasetModal) {
				dispatch({ type: "SET_ANALYZING", payload: false });
			}
		}
	};

	const executeAnalysisWithoutDatasets = async (query: string) => {
		// Fallback to original analysis approach
		await executeAnalysisRequest(query);
	};

	const handleDatasetSelection = async (selectedDatasets: any[]) => {
		setShowDatasetModal(false);

		try {
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `📥 **Preparing notebook for ${
						selectedDatasets.length
					} datasets:**\n\n**Datasets:**\n${selectedDatasets
						.map((d, i) => `${i + 1}. ${d.id} - ${d.title}`)
						.join(
							"\n"
						)}\n\n**Note:** Data download and preprocessing will be performed in a Jupyter notebook for full user control.`,
					isUser: false,
				},
			});

			// Import the autonomous agent
			const { AutonomousAgent } = await import(
				"../../services/AutonomousAgent"
			);
			const agent = new AutonomousAgent(
				bioragClient,
				state.currentWorkspace || "./"
			);
			setCurrentAgent(agent);

			// Create analysis workspace
			const analysisWorkspace = await agent.createAnalysisWorkspace(
				currentQuery
			);

			// Generate the notebook for data download/preprocessing
			const notebookPath = await agent.generateDataDownloadNotebook(
				currentQuery,
				selectedDatasets,
				analysisWorkspace
			);

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `📓 **Notebook created:** \`${notebookPath}\`\n\nOpen this notebook in Jupyter Lab to download and preprocess your data interactively.`,
					isUser: false,
				},
			});

			// Start Jupyter in the analysis workspace
			const jupyterResult = await window.electronAPI.startJupyter(
				analysisWorkspace
			);
			if (!jupyterResult.success) {
				throw new Error(
					jupyterResult.error || "Failed to start Jupyter server"
				);
			}

			// Listen for Jupyter ready event to get the URL
			window.electronAPI.onJupyterReady((data) => {
				dispatch({
					type: "SET_JUPYTER_URL",
					payload: data.url,
				});
			});
		} catch (error) {
			console.error("Dataset notebook/analysis error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Error during notebook generation/launch: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
				},
			});
		}
	};

	const downloadAndTrackDataset = async (
		dataset: any,
		dataDirectory?: string
	) => {
		try {
			// Start download to the analysis project's data directory
			const downloadResponse = await bioragClient.downloadDataset(
				dataset.id,
				false, // force_redownload
				dataDirectory || state.currentWorkspace || undefined
			);

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `⏳ Downloading ${dataset.id} to analysis data folder: ${downloadResponse.status}`,
					isUser: false,
				},
			});

			// Track download progress
			let completed = false;
			const progressInterval = setInterval(async () => {
				try {
					const status = await bioragClient.getDownloadStatus(dataset.id);
					setDownloadProgress((prev) => ({
						...prev,
						[dataset.id]: status.progress,
					}));

					if (status.status === "completed") {
						completed = true;
						clearInterval(progressInterval);
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `✅ ${dataset.id} download completed`,
								isUser: false,
							},
						});
					} else if (status.status === "error") {
						completed = true;
						clearInterval(progressInterval);
						throw new Error(status.error_message || "Download failed");
					}
				} catch (error) {
					clearInterval(progressInterval);
					if (!completed) {
						throw error;
					}
				}
			}, 2000);

			// Wait for completion (max 5 minutes)
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					clearInterval(progressInterval);
					reject(new Error("Download timeout"));
				}, 300000);

				const checkCompleted = () => {
					if (completed) {
						clearTimeout(timeout);
						resolve(null);
					} else {
						setTimeout(checkCompleted, 1000);
					}
				};
				checkCompleted();
			});
		} catch (error) {
			throw new Error(
				`Failed to download ${dataset.id}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

	const executeAnalysisWithDownloadedData = async (
		query: string,
		datasets: any[]
	) => {
		try {
			// Import the autonomous agent
			const { AutonomousAgent } = await import(
				"../../services/AutonomousAgent"
			);
			const agent = new AutonomousAgent(
				bioragClient,
				state.currentWorkspace || "./"
			);
			setCurrentAgent(agent);

			// Set up status callback for real-time updates
			agent.setStatusCallback((status: string) => {
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: status,
						isUser: false,
					},
				});
			});

			// First create the analysis workspace to get the data directory
			const analysisWorkspace = await agent.createAnalysisWorkspace(query);
			const dataDirectory = `${analysisWorkspace}/data`;

			// Set workspace directory to the analysis project's data folder
			await bioragClient.setWorkspace(dataDirectory);

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `🚀 **Starting AI-powered analysis with Jupyter download:**

**Analysis Project:** \`${analysisWorkspace}\`

**Datasets to download:** ${datasets.length} datasets
**Download Method:** Through Jupyter notebook with size checking

Datasets will be downloaded and loaded directly in the analysis notebook...`,
					isUser: false,
				},
			});

			// Get the analysis plan with real data
			const analysisResult = await agent.executeAnalysisRequestWithData(
				query,
				datasets
			);

			// Show the analysis plan
			const planContent = `## Analysis Plan for Downloaded Data

**Your Question:** ${analysisResult.understanding.userQuestion}

**Analysis Project:** \`${analysisWorkspace}\`

**Data Directory:** \`${dataDirectory}\`

**Downloaded Datasets:**
${datasets
	.map(
		(d, i) =>
			`${i + 1}. **${d.id}** - ${d.title}\n   📊 ${d.samples} samples, ${
				d.organism
			}\n   📁 Expression matrix and metadata downloaded to analysis project data folder`
	)
	.join("\n\n")}

**Analysis Approach:**
${analysisResult.understanding.requiredSteps
	.map((step: string, i: number) => `${i + 1}. ${step}`)
	.join("\n")}

**Expected Outputs:**
${analysisResult.understanding.expectedOutputs
	.map((output: string) => `- ${output}`)
	.join("\n")}

**Working Directory:** \`${analysisResult.workingDirectory}\`

---

**Starting sequential execution in Jupyter...**`;

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: planContent,
					isUser: false,
					analysisResult,
				},
			});

			// Start Jupyter and execute steps with real data
			await executeAnalysisSteps(analysisResult);
		} catch (error) {
			console.error("Analysis with downloaded data error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Analysis failed: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
					status: "failed",
				},
			});
		}
	};

	const executeAnalysisRequest = async (query: string) => {
		try {
			dispatch({ type: "SET_ANALYZING", payload: true });

			// Import the autonomous agent
			const { AutonomousAgent } = await import(
				"../../services/AutonomousAgent"
			);
			const agent = new AutonomousAgent(
				bioragClient,
				state.currentWorkspace || "./"
			);
			setCurrentAgent(agent);

			// Set up status callback for real-time updates
			agent.setStatusCallback((status: string) => {
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: status,
						isUser: false,
					},
				});
			});

			// Get the analysis plan
			const analysisResult = await agent.executeAnalysisRequest(query);

			// Show the analysis plan
			const planContent = `## Analysis Plan

**Your Question:** ${analysisResult.understanding.userQuestion}

**Approach:**
${analysisResult.understanding.requiredSteps
	.map((step, i) => `${i + 1}. ${step}`)
	.join("\n")}

**Data Requirements:**
${
	analysisResult.understanding.dataNeeded.length > 0
		? analysisResult.understanding.dataNeeded
				.map((data) => `- ${data}`)
				.join("\n")
		: "- Analysis will use available data sources"
}

**Expected Outputs:**
${analysisResult.understanding.expectedOutputs
	.map((output) => `- ${output}`)
	.join("\n")}

${
	analysisResult.datasets.length > 0
		? `
**Datasets to be Used:**
${analysisResult.datasets
	.map(
		(dataset, i) =>
			`${i + 1}. **${dataset.id}** - ${dataset.title}\n   Source: ${
				dataset.source
			}\n   ${dataset.description}`
	)
	.join("\n\n")}`
		: ""
}

**Working Directory:** \`${analysisResult.workingDirectory}\`

---

**Starting sequential execution in Jupyter...**`;

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: planContent,
					isUser: false,
					analysisResult,
				},
			});

			// Start Jupyter and execute steps
			await executeAnalysisSteps(analysisResult);
		} catch (error) {
			console.error("Analysis error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Analysis failed: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
					status: "failed",
				},
			});
		} finally {
			dispatch({ type: "SET_ANALYZING", payload: false });
			setCurrentAgent(null);
		}
	};

	const executeAnalysisSteps = async (analysisResult: any) => {
		try {
			// Start Jupyter in working directory
			const jupyterResult = await window.electronAPI.startJupyter(
				analysisResult.workingDirectory
			);

			if (!jupyterResult.success) {
				throw new Error(
					jupyterResult.error || "Failed to start Jupyter server"
				);
			}

			// Listen for Jupyter ready event to get the URL
			let jupyterUrl = "http://localhost:8888"; // Default fallback
			window.electronAPI.onJupyterReady((data) => {
				jupyterUrl = data.url;
				dispatch({
					type: "SET_JUPYTER_URL",
					payload: data.url,
				});
			});

			// Execute each step sequentially
			for (let i = 0; i < analysisResult.steps.length; i++) {
				const step = analysisResult.steps[i];

				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: `**Step ${i + 1}:** ${step.description}`,
						isUser: false,
					},
				});

				// Wrap the code in proper setup
				const wrappedCode = `
import os
import sys
import warnings
warnings.filterwarnings('ignore')

# Set working directory
os.chdir(r'${analysisResult.workingDirectory}')

# Create necessary directories
os.makedirs('data', exist_ok=True)
os.makedirs('results', exist_ok=True) 
os.makedirs('figures', exist_ok=True)

# Execute the analysis step
try {
${step.code
	.split("\n")
	.map((line: string) => "    " + line)
	.join("\n")}
except Exception as e:
    print(f"Error in step: {e}")
    import traceback
    traceback.print_exc()
`;

				try {
					const result = await window.electronAPI.executeJupyterCode(
						wrappedCode
					);

					if (result.success) {
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `Step completed successfully.\n\n\`\`\`\n${
									result.output || "No output"
								}\n\`\`\``,
								isUser: false,
								status: "completed",
							},
						});
					} else {
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `Step failed: ${result.error}`,
								isUser: false,
								status: "failed",
							},
						});
					}
				} catch (error) {
					dispatch({
						type: "ADD_MESSAGE",
						payload: {
							content: `Execution error: ${
								error instanceof Error ? error.message : "Unknown error"
							}`,
							isUser: false,
							status: "failed",
						},
					});
				}
			}

			// Analysis completed
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `## Analysis Pipeline Completed!

- Question analyzed: ${analysisResult.understanding.userQuestion}
- Analysis steps completed: ${analysisResult.steps.length}
- Working directory: \`${analysisResult.workingDirectory}\`

**Results have been saved to the working directory. Check the figures/ and results/ folders for outputs.**`,
					isUser: false,
					status: "completed",
				},
			});
		} catch (error) {
			console.error("Step execution error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `Pipeline execution failed: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
					status: "failed",
				},
			});
		}
	};

	const handleStopAnalysis = () => {
		if (currentAgent) {
			currentAgent.stopAnalysis();
			setCurrentAgent(null);
		}
		dispatch({ type: "SET_ANALYZING", payload: false });
		setIsLoading(false);
		setShowDatasetModal(false);
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	// Chat session persistence helpers
	const saveChatSession = async (messages: any[], workspace: string) => {
		if (!workspace) return;
		const chatsDir = `${workspace}/chats`;
		await window.electronAPI.createDirectory(chatsDir);
		const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
		const filePath = `${chatsDir}/chat_${sessionId}.json`;
		await window.electronAPI.writeFile(
			filePath,
			JSON.stringify(messages, null, 2)
		);
	};

	const loadChatSession = async (filePath: string) => {
		const content = await window.electronAPI.readFile(filePath);
		return JSON.parse(content);
	};

	const handleLoadChat = async (filePath: string) => {
		const messages = await loadChatSession(filePath);
		dispatch({ type: "SET_CHAT_MESSAGES", payload: messages });
		setChatHistoryOpen(false);
	};

	const handleNewChat = () => {
		dispatch({ type: "SET_CHAT_MESSAGES", payload: [] });
		setChatHistoryOpen(false);
	};

	if (collapsed) {
		return <div style={{ display: "none" }} />;
	}

	return (
		<>
			<ChatContainer collapsed={collapsed}>
				<ChatHeader>
					<ChatTitle>
						<FiMessageSquare size={16} />
						BioRAG Chat
					</ChatTitle>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<NewChatButton onClick={handleNewChat}>New Chat</NewChatButton>
						<CollapseButton
							onClick={() => setChatHistoryOpen((v) => !v)}
							title="Show past chats"
						>
							<span style={{ fontSize: 15, color: "#aaa" }}>Past Chats</span>
						</CollapseButton>
						<CollapseButton onClick={onToggle} title="Close chat">
							<FiX size={16} />
						</CollapseButton>
					</div>
				</ChatHeader>

				<MessagesContainer>
					{state.messages.map((message) => (
						<ChatMessage
							key={message.id}
							message={{
								id: message.id,
								content: message.content,
								isUser: message.isUser,
								timestamp: message.timestamp,
								status: message.status,
							}}
						/>
					))}
					<div ref={messagesEndRef} />
				</MessagesContainer>

				<InputContainer>
					<InputWrapper>
						<TextAreaWrapper>
							<TextArea
								ref={textAreaRef}
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								onKeyPress={handleKeyPress}
								placeholder="Ask about biological data, request analysis, or search for information..."
								disabled={isLoading}
							/>
						</TextAreaWrapper>

						{state.isAnalyzing ? (
							<StopButton onClick={handleStopAnalysis}>
								<FiStopCircle size={16} />
							</StopButton>
						) : (
							<SendButton
								disabled={
									!inputValue.trim() || isLoading || !state.currentWorkspace
								}
								onClick={handleSendMessage}
							>
								<FiSend size={16} />
							</SendButton>
						)}
					</InputWrapper>
				</InputContainer>
			</ChatContainer>

			<DatasetSelectionModal
				isOpen={showDatasetModal}
				datasets={availableDatasets}
				onClose={() => {
					setShowDatasetModal(false);
					dispatch({ type: "SET_ANALYZING", payload: false });
				}}
				onConfirm={handleDatasetSelection}
				isLoading={state.isAnalyzing}
			/>

			<ChatHistoryDrawer open={chatHistoryOpen}>
				<ChatHistoryHeader>
					Past Chats
					<CollapseButton
						onClick={() => setChatHistoryOpen(false)}
						title="Close"
					>
						<FiX size={16} />
					</CollapseButton>
				</ChatHistoryHeader>
				<ChatHistoryList>
					{loadingChats ? (
						<div style={{ color: "#888", padding: "16px 20px" }}>
							Loading...
						</div>
					) : chatSessions.length === 0 ? (
						<div style={{ color: "#888", padding: "16px 20px" }}>
							No past chats
						</div>
					) : (
						chatSessions.map((item) => (
							<ChatHistoryItem
								key={item.path}
								onClick={() => handleLoadChat(item.path)}
							>
								{item.name
									.replace("chat_", "")
									.replace(".json", "")
									.replace(/T/, " ")}
							</ChatHistoryItem>
						))
					)}
				</ChatHistoryList>
			</ChatHistoryDrawer>
		</>
	);
};
