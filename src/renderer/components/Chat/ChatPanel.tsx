import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { FiSend, FiX, FiStopCircle, FiMessageSquare } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { BioRAGClient } from "../../services/BioRAGClient";
import { AutonomousAgent } from "../../services/AutonomousAgent";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

			// Check if query contains specific GEO dataset IDs
			const geoIds = query.match(/GSE\d+/g) || [];

			if (geoIds.length > 0) {
				// User mentioned specific datasets - fetch them directly
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: `🔍 Fetching information for specific datasets: ${geoIds.join(
							", "
						)}...`,
						isUser: false,
					},
				});

				try {
					const datasets = await bioragClient.getDatasetsByIds(geoIds);

					if (datasets.length > 0) {
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `## Found ${datasets.length} Dataset(s)

${datasets
	.map(
		(d, i) =>
			`**${i + 1}. ${d.id}** - ${d.title}
- Samples: ${d.samples}
- Organism: ${d.organism}
- Platform: ${d.platform}
- Status: ${d.downloaded ? "Downloaded" : "Not downloaded"}

${d.description}

---`
	)
	.join("\n\n")}

Please select which datasets you'd like me to download and analyze.`,
								isUser: false,
							},
						});

						setAvailableDatasets(datasets);
						setShowDatasetModal(true);
					} else {
						throw new Error("No datasets found for the specified IDs");
					}
				} catch (error) {
					console.error("Error fetching specific datasets:", error);
					// Fall back to search approach
					await executeDatasetSearch(query);
				}
			} else {
				// No specific IDs mentioned - search for relevant datasets
				await executeDatasetSearch(query);
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

	const executeDatasetSearch = async (query: string) => {
		// Step 1: Search for relevant datasets
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
	};

	const executeAnalysisWithoutDatasets = async (query: string) => {
		// Fallback to original analysis approach
		await executeAnalysisRequest(query);
	};

	const createAnalysisWorkspace = async (query: string): Promise<string> => {
		// Create a timestamped workspace directory
		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.slice(0, 19);
		const workspaceName = `analysis_${timestamp}`;
		const workspacePath = `${state.currentWorkspace || "./"}/${workspaceName}`;

		// Create the directory
		await window.electronAPI.createDirectory(workspacePath);

		return workspacePath;
	};

	const generateInteractiveDownloadNotebook = (
		query: string,
		selectedDatasets: any[],
		workspacePath: string
	): string => {
		return `
# Interactive Dataset Download and Analysis
# Query: ${query}
# Selected Datasets: ${selectedDatasets.map((d) => d.id).join(", ")}

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import requests
import json
import time
from pathlib import Path
import os

print("=== Interactive Dataset Download and Analysis ===")
print(f"Query: ${query}")
print(f"Selected Datasets: ${selectedDatasets.map((d) => d.id).join(", ")}")
print(f"Workspace: ${workspacePath}")

# BioRAG API configuration
BIORAG_API_BASE = "http://localhost:8000"

# Create data directory
data_dir = Path('${workspacePath}/data')
data_dir.mkdir(parents=True, exist_ok=True)

def download_dataset_interactive(dataset_id, dataset_info):
    """Download a specific dataset with user interaction"""
    print(f"\\n📥 Downloading {dataset_id}...")
    print(f"   Title: {dataset_info.title}")
    print(f"   Samples: {dataset_info.samples}")
    print(f"   Organism: {dataset_info.organism}")
    
    try:
        # Start download
        response = requests.post(f"{BIORAG_API_BASE}/datasets/{dataset_id}/download", 
                               json={'force_redownload': False})
        
        if response.status_code == 200:
            result = response.json()
            print(f"   Download started: {result.get('status', 'unknown')}")
            
            # Monitor progress
            max_attempts = 60  # 5 minutes max
            for attempt in range(max_attempts):
                time.sleep(5)  # Check every 5 seconds
                
                try:
                    status_response = requests.get(f"{BIORAG_API_BASE}/datasets/{dataset_id}/status")
                    if status_response.status_code == 200:
                        status_info = status_response.json()
                        status = status_info.get('status', 'unknown')
                        progress = status_info.get('progress', 0)
                        
                        print(f"   Progress: {progress}% - {status}")
                        
                        if status == 'completed':
                            print(f"✅ {dataset_id} download completed!")
                            return True
                        elif status == 'error':
                            print(f"❌ {dataset_id} download failed!")
                            return False
                    else:
                        print(f"   Status check failed: {status_response.status_code}")
                except Exception as status_error:
                    print(f"   Status check error: {status_error}")
                
                print(f"   Checking status... (attempt {attempt + 1})")
            
            print(f"⏰ {dataset_id} download timeout")
            return False
        else:
            print(f"❌ Failed to start download for {dataset_id} - Status: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error downloading {dataset_id}: {e}")
        return False

# Download all selected datasets
print("\\n=== Starting Downloads ===")
download_results = {}

datasets_to_download = ${JSON.stringify(selectedDatasets)}
for dataset in datasets_to_download:
    success = download_dataset_interactive(dataset['id'], dataset)
    download_results[dataset['id']] = success

print("\\n=== Download Summary ===")
for dataset_id, success in download_results.items():
    status = "✅ Success" if success else "❌ Failed"
    print(f"{dataset_id}: {status}")

# Load and analyze downloaded data
print("\\n=== Loading Downloaded Data ===")
loaded_datasets = {}

for dataset_id, success in download_results.items():
    if success:
        try:
            # Get dataset info
            info_response = requests.get(f"{BIORAG_API_BASE}/datasets/{dataset_id}")
            if info_response.status_code == 200:
                dataset_info = info_response.json()
                file_paths = dataset_info.get('file_paths', {})
                
                print(f"📊 Loaded {dataset_id}: {dataset_info.get('samples', 0)} samples")
                loaded_datasets[dataset_id] = dataset_info
            else:
                print(f"❌ Could not get info for {dataset_id}")
        except Exception as e:
            print(f"❌ Error loading {dataset_id}: {e}")

print(f"\\n✅ Successfully loaded {len(loaded_datasets)} datasets")
print("\\n=== Ready for Analysis ===")
print("You can now analyze your downloaded datasets!")
print("Available datasets:", list(loaded_datasets.keys()))
`;
	};

	const handleDatasetSelection = async (selectedDatasets: any[]) => {
		setShowDatasetModal(false);

		try {
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `📥 **Selected ${
						selectedDatasets.length
					} dataset(s) for interactive download and analysis:**\n\n**Datasets:**\n${selectedDatasets
						.map((d, i) => `${i + 1}. ${d.id} - ${d.title}`)
						.join(
							"\n"
						)}\n\n**Next:** Starting Jupyter notebook for interactive download and analysis.`,
					isUser: false,
				},
			});

			// Create analysis workspace
			const analysisWorkspace = await createAnalysisWorkspace(currentQuery);

			// Start Jupyter if not already running
			if (!state.jupyterUrl) {
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: "🚀 Starting Jupyter server...",
						isUser: false,
					},
				});

				try {
					const jupyterResult = await window.electronAPI.startJupyter(
						analysisWorkspace
					);

					if (jupyterResult.success && jupyterResult.url) {
						dispatch({
							type: "SET_JUPYTER_URL",
							payload: jupyterResult.url,
						});
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `✅ Jupyter server started at: ${jupyterResult.url}`,
								isUser: false,
							},
						});
					} else {
						throw new Error(jupyterResult.error || "Failed to start Jupyter");
					}
				} catch (error) {
					console.error("Jupyter start error:", error);
					dispatch({
						type: "ADD_MESSAGE",
						payload: {
							content: `❌ Failed to start Jupyter: ${
								error instanceof Error ? error.message : "Unknown error"
							}`,
							isUser: false,
							status: "failed",
						},
					});
					return;
				}
			}

			// Generate notebook code using LLM
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: "🤖 Generating interactive notebook code...",
					isUser: false,
				},
			});

			try {
				// Use the autonomous agent to generate and execute the notebook code
				const autonomousAgent = new AutonomousAgent(
					bioragClient,
					analysisWorkspace
				);

				// Set up status callback to show progress
				autonomousAgent.setStatusCallback((status) => {
					dispatch({
						type: "ADD_MESSAGE",
						payload: {
							content: `🤖 ${status}`,
							isUser: false,
						},
					});
				});

				// Generate the analysis plan and code using the autonomous agent
				const analysisResult =
					await autonomousAgent.executeAnalysisRequestWithData(
						currentQuery,
						selectedDatasets
					);

				// Execute the first step (data loading) in Jupyter
				if (analysisResult.steps.length > 0) {
					const firstStep = analysisResult.steps[0];
					const executionResult = await window.electronAPI.executeJupyterCode(
						firstStep.code
					);

					if (executionResult.success) {
						dispatch({
							type: "ADD_MESSAGE",
							payload: {
								content: `✅ Interactive notebook generated and executed successfully!\n\n**Analysis Plan:**\n${analysisResult.understanding.requiredSteps
									.map((step, i) => `${i + 1}. ${step}`)
									.join("\n")}\n\n**Selected Datasets:**\n${selectedDatasets
									.map((d) => `- ${d.id}: ${d.title}`)
									.join(
										"\n"
									)}\n\n**Next Steps:**\n1. The notebook is now running in Jupyter\n2. You can interactively work with your downloaded datasets\n3. All data will be saved to your workspace\n4. The autonomous agent will guide you through the analysis`,
								isUser: false,
							},
						});
					} else {
						throw new Error(
							executionResult.error || "Notebook execution failed"
						);
					}
				} else {
					throw new Error("No analysis steps generated");
				}
			} catch (error) {
				console.error("Notebook generation/execution error:", error);
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: `❌ Failed to generate or execute notebook: ${
							error instanceof Error ? error.message : "Unknown error"
						}`,
						isUser: false,
						status: "failed",
					},
				});
			}

			// Open the notebook tab
			dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });
			dispatch({ type: "SET_ANALYZING", payload: false });
		} catch (error) {
			console.error("Dataset selection error:", error);
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `❌ Failed to process selected datasets: ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
					isUser: false,
					status: "failed",
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
			// Save analysis result to workspace for notebook to load
			const analysisFile = `${analysisResult.workingDirectory}/analysis_result.json`;
			await window.electronAPI.writeFile(
				analysisFile,
				JSON.stringify(analysisResult, null, 2)
			);
			console.log("Saved analysis result to:", analysisFile);

			// Open the notebook tab to show the analysis cells
			dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `📊 **Analysis Generated Successfully!**

I've created ${analysisResult.steps.length} analysis steps and opened them in the **Interactive Notebook** tab.

**What's next:**
1. Switch to the "Interactive Notebook" tab to see your analysis cells
2. Each cell contains a step of your analysis
3. Run the cells individually or use "Run All Steps" to execute everything
4. View results and modify code as needed

**Analysis Overview:**
- **Research Question:** ${analysisResult.understanding.userQuestion}
- **Datasets Found:** ${analysisResult.datasets.length}
- **Analysis Steps:** ${analysisResult.steps.length}

The notebook will automatically load and execute your analysis steps!`,
					isUser: false,
					status: "completed",
				},
			});

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
						<div
							key={message.id}
							style={{
								alignSelf: message.isUser ? "flex-end" : "flex-start",
								maxWidth: "80%",
								background: message.isUser ? "#232326" : "#18181a",
								color: "#fff",
								borderRadius: 10,
								marginBottom: 8,
								padding: "14px 18px",
								fontSize: 15,
								boxShadow: message.isUser
									? "0 1px 4px 0 rgba(0,0,0,0.10)"
									: "0 1px 4px 0 rgba(0,0,0,0.08)",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								borderTopRightRadius: message.isUser ? 2 : 10,
								borderTopLeftRadius: message.isUser ? 10 : 2,
								border: message.isUser
									? "1px solid #232326"
									: "1px solid #232326",
							}}
						>
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								components={{
									code({ inline, children, ...rest }) {
										return !inline ? (
											<pre
												style={{
													background: "#232326",
													borderRadius: 8,
													padding: "12px 16px",
													fontSize: 14,
													overflowX: "auto",
													margin: "10px 0",
												}}
											>
												<code {...rest}>{children}</code>
											</pre>
										) : (
											<code
												style={{
													background: "#232326",
													borderRadius: 4,
													padding: "2px 6px",
													fontSize: 14,
												}}
												{...rest}
											>
												{children}
											</code>
										);
									},
									h1: (props) => (
										<h1
											style={{
												fontSize: 22,
												fontWeight: 700,
												margin: "18px 0 8px 0",
											}}
											{...props}
										/>
									),
									h2: (props) => (
										<h2
											style={{
												fontSize: 18,
												fontWeight: 600,
												margin: "14px 0 6px 0",
											}}
											{...props}
										/>
									),
									h3: (props) => (
										<h3
											style={{
												fontSize: 16,
												fontWeight: 600,
												margin: "10px 0 4px 0",
											}}
											{...props}
										/>
									),
									ul: (props) => (
										<ul style={{ margin: "8px 0 8px 18px" }} {...props} />
									),
									ol: (props) => (
										<ol style={{ margin: "8px 0 8px 18px" }} {...props} />
									),
									li: (props) => <li style={{ margin: "4px 0" }} {...props} />,
									blockquote: (props) => (
										<blockquote
											style={{
												borderLeft: "3px solid #444",
												margin: "8px 0",
												padding: "6px 0 6px 14px",
												color: "#aaa",
											}}
											{...props}
										/>
									),
									a: (props) => (
										<a
											style={{ color: "#7ecfff", textDecoration: "underline" }}
											target="_blank"
											rel="noopener noreferrer"
											{...props}
										/>
									),
									p: (props) => <p style={{ margin: "8px 0" }} {...props} />,
								}}
							>
								{message.content}
							</ReactMarkdown>
						</div>
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
