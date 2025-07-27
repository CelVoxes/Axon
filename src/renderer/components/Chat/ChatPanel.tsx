import React, { useState, useEffect, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { FiSend, FiX, FiStopCircle, FiChevronDown } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { BioRAGClient } from "../../services/BioRAGClient";
import { AutonomousAgent } from "../../services/AutonomousAgent";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DatasetSelectionModal } from "./DatasetSelectionModal";

// Animations
const fadeIn = keyframes`
	from { opacity: 0; transform: translateY(10px); }
	to { opacity: 1; transform: translateY(0); }
`;

const slideIn = keyframes`
	from { transform: translateX(100%); }
	to { transform: translateX(0); }
`;

const pulse = keyframes`
	0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
	40% { transform: scale(1); opacity: 1; }
`;

// Enhanced Chat Container
const ChatContainer = styled.div<{ $collapsed: boolean }>`
	width: 100%;
	height: 100%;
	background: #1a1a1a;
	border-left: 1px solid #2a2a2a;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	position: relative;
`;

// Enhanced Header
const ChatHeader = styled.div`
	padding: 16px 20px;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: #2d2d30;
	position: relative;
	z-index: 10;
`;

const ChatTitle = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
	color: #cccccc;
	font-weight: 600;
	font-size: 16px;

	svg {
		color: #007acc;
	}
`;

const HeaderActions = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

// Enhanced Buttons
const ActionButton = styled.button<{
	$variant?: "primary" | "secondary" | "danger";
}>`
	background: ${(props) => {
		switch (props.$variant) {
			case "primary":
				return "#007acc";
			case "danger":
				return "#dc3545";
			default:
				return "#404040";
		}
	}};
	border: none;
	color: #ffffff;
	cursor: pointer;
	padding: 8px 16px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;
	font-size: 13px;
	font-weight: 500;

	&:hover {
		background: ${(props) => {
			switch (props.$variant) {
				case "primary":
					return "#005a9e";
				case "danger":
					return "#c82333";
				default:
					return "#505050";
			}
		}};
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const CollapseButton = styled(ActionButton)`
	padding: 6px 12px;
	font-size: 12px;
`;

// Enhanced Messages Container
const MessagesContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;
	background: #1e1e1e;

	/* Enhanced scrollbar */
	&::-webkit-scrollbar {
		width: 8px;
	}

	&::-webkit-scrollbar-track {
		background: #2d2d30;
	}

	&::-webkit-scrollbar-thumb {
		background: #424242;
		border-radius: 4px;
	}

	&::-webkit-scrollbar-thumb:hover {
		background: #555;
	}
`;

// Enhanced Message Component
const MessageContainer = styled.div<{ $isUser: boolean; $status?: string }>`
	display: flex;
	align-items: flex-start;
	gap: 12px;
	animation: ${fadeIn} 0.3s ease-out;
	max-width: ${(props) => (props.$isUser ? "" : "100%")};
	align-self: ${(props) => (props.$isUser ? "flex-end" : "flex-start")};
	position: relative;
`;

const MessageAvatar = styled.div<{ $isUser: boolean }>`
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: ${(props) => (props.$isUser ? "#3b82f6" : "#10b981")};
	display: flex;
	align-items: center;
	justify-content: center;
	color: white;
	font-weight: 600;
	font-size: 14px;
	flex-shrink: 0;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`;

const MessageContent = styled.div<{ $isUser: boolean; $status?: string }>`
	background: ${(props) => {
		if (props.$status === "failed") return "#2d1b1b";
		if (props.$status === "completed") return "#1b2d1b";
		return props.$isUser ? "#2d2d30" : "#252526";
	}};
	color: #d4d4d4;
	border-radius: ${(props) => (props.$isUser ? "20px" : "12px")};
	padding: ${(props) => (props.$isUser ? "16px 20px" : "20px 24px")};
	font-size: ${(props) => (props.$isUser ? "12px" : "14px")};
	line-height: 1.6;
	border: 1px solid
		${(props) => {
			if (props.$status === "failed") return "#dc3545";
			if (props.$status === "completed") return "#28a745";
			return props.$isUser ? "#404040" : "#3e3e42";
		}};
	position: relative;
	transition: all 0.2s ease;
	flex: ${(props) => (props.$isUser ? "none" : "1")};
	min-width: ${(props) => (props.$isUser ? "auto" : "0")};

	&:hover {
		border-color: #007acc;
	}
`;

const MessageActions = styled.div`
	position: absolute;
	top: -8px;
	right: -8px;
	display: flex;
	gap: 4px;
	opacity: 0;
	transition: opacity 0.2s ease;
	background: #2d2d30;
	border-radius: 4px;
	padding: 4px;
	border: 1px solid #404040;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

	${MessageContent}:hover & {
		opacity: 1;
	}
`;

const MessageActionButton = styled.button`
	background: transparent;
	border: none;
	color: #858585;
	cursor: pointer;
	padding: 4px;
	border-radius: 2px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;
	font-size: 12px;

	&:hover {
		color: #d4d4d4;
		background: #404040;
	}
`;

// Enhanced Loading Indicator
const LoadingIndicator = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 16px 20px;
	background: #2d2d30;
	color: #858585;
	border-radius: 8px;
	border: 1px solid #404040;
	font-size: 14px;
	align-self: flex-start;
	max-width: 80%;
	animation: ${fadeIn} 0.3s ease-out;
`;

const LoadingDot = styled.div<{ delay: number }>`
	width: 8px;
	height: 8px;
	background: #007acc;
	border-radius: 50%;
	animation: ${pulse} 1.4s ease-in-out infinite;
	animation-delay: ${(props) => props.delay}s;
`;

// New Simplified Input Container
const InputContainer = styled.div`
	padding: 20px;

	background: #252526;
`;

// Add Context Button
const AddContextButton = styled.button`
	background: rgba(0, 122, 204, 0.1);
	border: 1px solid rgba(0, 122, 204, 0.3);
	color: #007acc;
	padding: 8px 16px;
	border-radius: 4px;
	font-size: 13px;
	font-weight: 500;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 12px;
	transition: all 0.2s ease;

	&:hover {
		background: rgba(0, 122, 204, 0.2);
		border-color: rgba(0, 122, 204, 0.5);
	}
`;

// Main Input Area
const InputArea = styled.div`
	background: #1e1e1e;
	border: 1px solid #404040;
	border-radius: 4px;
	padding: 16px;
	transition: all 0.2s ease;

	&:focus-within {
		border-color: #007acc;
	}
`;

const TextArea = styled.textarea`
	width: 100%;
	background: transparent;
	border: none;
	color: #d4d4d4;
	font-size: 14px;
	font-family: inherit;
	resize: none;
	outline: none;
	min-height: 24px;
	max-height: 120px;
	line-height: 1.5;
	transition: all 0.2s ease;

	&::placeholder {
		color: #858585;
	}
`;

// Control Bar
const ControlBar = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 12px;
`;

const ControlLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

// Model Selector
const ModelSelector = styled.div`
	position: relative;
`;

const ModelButton = styled.button`
	background: #404040;
	border: 1px solid #6c6c6c;
	color: #d4d4d4;
	padding: 6px 12px;
	border-radius: 4px;
	font-size: 12px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;

	&:hover {
		background: #505050;
		border-color: #858585;
	}
`;

const ModelDropdown = styled.div<{ $isOpen: boolean }>`
	position: absolute;
	bottom: 100%;
	left: 0;
	background: #2d2d30;
	border: 1px solid #404040;
	border-radius: 4px;
	padding: 8px 0;
	min-width: 150px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	z-index: 100;
	opacity: ${(props) => (props.$isOpen ? 1 : 0)};
	visibility: ${(props) => (props.$isOpen ? "visible" : "hidden")};
	transform: translateY(${(props) => (props.$isOpen ? "0" : "10px")});
	transition: all 0.2s ease;
`;

const ModelOption = styled.div<{ $isSelected: boolean }>`
	padding: 8px 16px;
	color: #d4d4d4;
	font-size: 12px;
	cursor: pointer;
	background: ${(props) => (props.$isSelected ? "#007acc" : "transparent")};
	transition: background 0.2s ease;

	&:hover {
		background: ${(props) => (props.$isSelected ? "#007acc" : "#404040")};
	}
`;

// Control Right
const ControlRight = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`;

const IconButton = styled.button`
	background: transparent;
	border: none;
	color: #858585;
	cursor: pointer;
	padding: 8px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	&:hover {
		color: #d4d4d4;
		background: #404040;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const SendButton = styled.button<{ disabled: boolean }>`
	background: ${(props) => (props.disabled ? "#6b7280" : "#007acc")};
	border: none;
	border-radius: 4px;
	color: #ffffff;
	padding: 8px;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};

	&:hover:not(:disabled) {
		background: #005a9e;
	}
`;

const StopButton = styled.button`
	background: #dc3545;
	border: none;
	border-radius: 4px;
	color: #ffffff;
	padding: 8px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: all 0.2s ease;

	&:hover {
		background: #c82333;
	}
`;

// Enhanced Chat History Drawer
const ChatHistoryDrawer = styled.div<{ open: boolean }>`
	position: absolute;
	top: 0;
	right: 0;
	width: 360px;
	height: 100%;
	background: #1a1a1a;
	border-left: 1px solid #2a2a2a;
	box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
	z-index: 20;
	display: flex;
	flex-direction: column;
	transform: translateX(${(props) => (props.open ? "0" : "100%")});
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	animation: ${slideIn} 0.3s ease-out;
`;

const ChatHistoryHeader = styled.div`
	padding: 20px 24px;
	font-size: 16px;
	font-weight: 600;
	color: #cccccc;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: #2d2d30;
`;

const ChatHistoryList = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 16px 0;
`;

const ChatHistoryItem = styled.div`
	padding: 16px 24px;
	color: #cccccc;
	font-size: 14px;
	cursor: pointer;
	border-bottom: 1px solid #3e3e42;
	transition: all 0.2s ease;

	&:hover {
		background: rgba(0, 122, 204, 0.1);
		color: #ffffff;
		border-left: 3px solid #007acc;
	}
`;

// Message Component
const Message: React.FC<{
	message: any;
	onCopy?: (content: string) => void;
	onEdit?: (content: string) => void;
	onDelete?: () => void;
}> = ({ message, onCopy, onEdit, onDelete }) => {
	const [showActions, setShowActions] = useState(false);

	return (
		<MessageContainer $isUser={message.isUser} $status={message.status}>
			<MessageContent
				$isUser={message.isUser}
				$status={message.status}
				onMouseEnter={() => setShowActions(true)}
				onMouseLeave={() => setShowActions(false)}
			>
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						code({ inline, children, ...rest }) {
							return !inline ? (
								<pre
									style={{
										background: "#1e293b",
										borderRadius: 8,
										padding: "16px",
										fontSize: 13,
										overflowX: "auto",
										margin: "12px 0",
										border: "1px solid #334155",
									}}
								>
									<code {...rest}>{children}</code>
								</pre>
							) : (
								<code
									style={{
										background: "#1e293b",
										borderRadius: 4,
										padding: "2px 6px",
										fontSize: 13,
										border: "1px solid #334155",
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
									fontSize: 24,
									fontWeight: 700,
									margin: "20px 0 12px 0",
									color: "#f8fafc",
								}}
								{...props}
							/>
						),
						h2: (props) => (
							<h2
								style={{
									fontSize: 20,
									fontWeight: 600,
									margin: "16px 0 10px 0",
									color: "#f1f5f9",
								}}
								{...props}
							/>
						),
						h3: (props) => (
							<h3
								style={{
									fontSize: 18,
									fontWeight: 600,
									margin: "14px 0 8px 0",
									color: "#e2e8f0",
								}}
								{...props}
							/>
						),
						ul: ({ ordered, ...props }) => (
							<ul style={{ margin: "12px 0 12px 20px" }} {...props} />
						),
						ol: ({ ordered, ...props }) => (
							<ol style={{ margin: "12px 0 12px 20px" }} {...props} />
						),
						li: ({ ordered, ...props }) => (
							<li style={{ margin: "6px 0" }} {...props} />
						),
						blockquote: (props) => (
							<blockquote
								style={{
									borderLeft: "4px solid #60a5fa",
									margin: "12px 0",
									padding: "8px 0 8px 16px",
									color: "#94a3b8",
									background: "rgba(96, 165, 250, 0.1)",
									borderRadius: "0 8px 8px 0",
								}}
								{...props}
							/>
						),
						a: (props) => (
							<a
								style={{
									color: "#60a5fa",
									textDecoration: "underline",
									fontWeight: 500,
								}}
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
			</MessageContent>
		</MessageContainer>
	);
};

// Model and Mode Types
interface Model {
	id: string;
	name: string;
	description: string;
	icon: string;
}

interface ChatPanelProps {
	onToggle: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onToggle }) => {
	const { state, dispatch } = useAppContext();
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [currentQuery, setCurrentQuery] = useState("");
	const [currentAgent, setCurrentAgent] = useState<AutonomousAgent | null>(
		null
	);
	// Model Selection
	const [selectedModel, setSelectedModel] = useState<string>("gpt-4o-mini");
	const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const bioragClient = new BioRAGClient();

	// Available Models
	const availableModels: Model[] = [
		{
			id: "gpt-4o-mini",
			name: "gpt-4o mini",
			description: "Most capable model for complex tasks",
			icon: "",
		},
	];

	// Auto-scroll to bottom
	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	useEffect(() => {
		scrollToBottom();
	}, [state.messages]);

	// Auto-resize textarea
	useEffect(() => {
		const adjustTextAreaHeight = () => {
			if (textAreaRef.current) {
				textAreaRef.current.style.height = "auto";
				textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
			}
		};

		adjustTextAreaHeight();
	}, [inputValue]);

	// Message actions
	const handleCopyMessage = async (content: string) => {
		try {
			await navigator.clipboard.writeText(content);
			// Could add a toast notification here
		} catch (error) {
			console.error("Failed to copy message:", error);
		}
	};

	const handleEditMessage = (content: string) => {
		setInputValue(content);
		textAreaRef.current?.focus();
	};

	const handleDeleteMessage = (messageId: string) => {
		// Implementation for deleting messages
		console.log("Delete message:", messageId);
	};

	// Model handler
	const handleModelSelect = (modelId: string) => {
		setSelectedModel(modelId);
		setModelDropdownOpen(false);
	};

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

**🎯 NEXT STEP: A dataset selection modal should appear below. Please select the datasets you want to analyze and click "Download & Analyze".**

If you don't see the modal, please let me know and I'll proceed with a general analysis.`
		: "No specific datasets were found, but I can help with general analysis."
}`,
				isUser: false,
			},
		});

		if (searchResult.datasets.length > 0) {
			// Show dataset selection modal
			console.log(
				`ChatPanel: Found ${searchResult.datasets.length} datasets, showing modal`
			);
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
					} dataset(s) for analysis:**\n\n**Datasets:**\n${selectedDatasets
						.map((d, i) => `${i + 1}. ${d.id} - ${d.title}`)
						.join(
							"\n"
						)}\n\n**Next:** Generating dynamic analysis plan using AI...`,
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

			// Use the autonomous agent to generate dynamic analysis based on user query and datasets
			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: "🤖 Generating dynamic analysis plan using AI...",
					isUser: false,
				},
			});

			try {
				// For testing, let's create a simple analysis result first to see if the notebook picks it up
				console.log("ChatPanel: Creating test analysis result...");

				const testAnalysisResult = {
					understanding: {
						userQuestion: currentQuery,
						requiredSteps: [
							"Download selected datasets",
							"Load and preprocess data",
							"Perform analysis",
							"Generate visualizations",
						],
						dataNeeded: ["Selected datasets"],
						expectedOutputs: ["Analysis results", "Visualizations"],
					},
					datasets: selectedDatasets,
					steps: [
						{
							id: "step_1",
							description: "Download and load datasets",
							code: `# Test step 1: Download and load datasets
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os

print("=== Test Analysis Step 1 ===")
print(f"Query: ${currentQuery}")
print(f"Selected datasets: ${selectedDatasets.map((d) => d.id).join(", ")}")

# Create data directory
os.makedirs('data', exist_ok=True)
os.makedirs('results', exist_ok=True)
os.makedirs('figures', exist_ok=True)

print("✅ Data directories created")
print("✅ Step 1 completed successfully!")`,
							status: "pending",
						},
						{
							id: "step_2",
							description: "Load and preprocess data",
							code: `# Test step 2: Load and preprocess data
print("=== Test Analysis Step 2 ===")
print("Loading and preprocessing data...")

# Simulate data loading
import numpy as np
import pandas as pd

# Create sample data for demonstration
sample_data = pd.DataFrame({
    'gene_1': np.random.normal(0, 1, 100),
    'gene_2': np.random.normal(0, 1, 100),
    'gene_3': np.random.normal(0, 1, 100)
})

print(f"Sample data shape: {sample_data.shape}")
print("✅ Data loaded and preprocessed")
print("✅ Step 2 completed successfully!")`,
							status: "pending",
						},
						{
							id: "step_3",
							description: "Perform analysis",
							code: `# Test step 3: Perform analysis
print("=== Test Analysis Step 3 ===")
print("Performing analysis...")

# Simple analysis
import numpy as np
import pandas as pd

# Calculate basic statistics
stats = sample_data.describe()
print("Data statistics:")
print(stats)

print("✅ Analysis completed")
print("✅ Step 3 completed successfully!")`,
							status: "pending",
						},
						{
							id: "step_4",
							description: "Generate visualizations",
							code: `# Test step 4: Generate visualizations
print("=== Test Analysis Step 4 ===")
print("Generating visualizations...")

import matplotlib.pyplot as plt
import seaborn as sns

# Create a simple plot
plt.figure(figsize=(10, 6))
sample_data.boxplot()
plt.title("Gene Expression Distribution")
plt.ylabel("Expression Level")
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('figures/test_analysis.png', dpi=300, bbox_inches='tight')
plt.show()

print("✅ Visualization saved to figures/test_analysis.png")
print("✅ Step 4 completed successfully!")
print("\\n=== Test Analysis Complete ===")
print("All steps completed successfully!")`,
							status: "pending",
						},
					],
					workingDirectory: analysisWorkspace,
				};

				console.log(
					"ChatPanel: Test analysis result created:",
					testAnalysisResult
				);

				// Save test analysis result to workspace for notebook to load
				const analysisFile = `${analysisWorkspace}/analysis_result.json`;
				console.log(
					`ChatPanel: Saving test analysis result to: ${analysisFile}`
				);

				await window.electronAPI.writeFile(
					analysisFile,
					JSON.stringify(testAnalysisResult, null, 2)
				);

				console.log(`ChatPanel: Test analysis file saved successfully`);

				// Open the notebook tab to show the analysis cells
				dispatch({
					type: "SET_WORKSPACE",
					payload: analysisWorkspace,
				});
				dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });

				console.log(`ChatPanel: Set workspace to: ${analysisWorkspace}`);
				console.log(`ChatPanel: Show notebook set to: true`);

				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: `✅ **Test Analysis Plan Created Successfully!**

I've created ${
							testAnalysisResult.steps.length
						} test analysis steps and opened them in the **Interactive Notebook** tab.

**Analysis Plan:**
${testAnalysisResult.understanding.requiredSteps
	.map((step, i) => `${i + 1}. ${step}`)
	.join("\n")}

**Selected Datasets:** ${selectedDatasets.map((d) => d.id).join(", ")}

**Auto-execution:** The analysis cells will start running automatically in 1 second!`,
						isUser: false,
						status: "completed",
					},
				});

				// Comment out the autonomous agent for now to test the notebook
				/*
				const autonomousAgent = new AutonomousAgent(
					bioragClient,
					analysisWorkspace,
					selectedModel
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

				// Generate the analysis plan and code using the autonomous agent with timeout
				const analysisTimeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(
						() =>
							reject(new Error("Analysis generation timeout - using fallback")),
						60000
					);
				});

				const analysisResult = await Promise.race([
					autonomousAgent.executeAnalysisRequestWithData(
						currentQuery,
						selectedDatasets
					),
					analysisTimeoutPromise,
				]);
				*/
			} catch (error) {
				console.error("Analysis generation error:", error);
				dispatch({
					type: "ADD_MESSAGE",
					payload: {
						content: `❌ Failed to generate analysis: ${
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
					// This state is not managed by the new component, so this will not update the UI
					// For now, we'll just log the progress
					console.log(`Progress for ${dataset.id}: ${status.progress}%`);
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
				state.currentWorkspace || "./",
				selectedModel
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
				state.currentWorkspace || "./",
				selectedModel
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

			// Get the analysis plan with timeout
			const analysisTimeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(
					() =>
						reject(new Error("Analysis generation timeout - using fallback")),
					60000
				);
			});

			const analysisResult = await Promise.race([
				agent.executeAnalysisRequest(query),
				analysisTimeoutPromise,
			]);

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
			// Set the workspace to the analysis directory so notebook can find the analysis_result.json
			dispatch({
				type: "SET_WORKSPACE",
				payload: analysisResult.workingDirectory,
			});
			dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });

			dispatch({
				type: "ADD_MESSAGE",
				payload: {
					content: `📊 **Analysis Generated Successfully!**

I've created ${analysisResult.steps.length} analysis steps and opened them in the **Interactive Notebook** tab.

**What's next:**
1. Switch to the "Interactive Notebook" tab to see your analysis cells
2. **Cells will automatically execute in sequence** (you'll see progress in real-time)
3. Each cell contains a step of your analysis
4. You can also run cells individually or use "Run All Steps" to re-execute
5. View results and modify code as needed

**Analysis Overview:**
- **Research Question:** ${analysisResult.understanding.userQuestion}
- **Datasets Found:** ${analysisResult.datasets.length}
- **Analysis Steps:** ${analysisResult.steps.length}

**Auto-execution:** The analysis cells will start running automatically in 1 second!`,
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

	return (
		<>
			<ChatContainer $collapsed={false}>
				<ChatHeader>
					<ChatTitle>Chat</ChatTitle>
					<HeaderActions>
						<CollapseButton onClick={onToggle} title="Close chat">
							<FiX size={16} />
						</CollapseButton>
					</HeaderActions>
				</ChatHeader>

				<MessagesContainer>
					{state.messages.map((message) => (
						<Message
							key={message.id}
							message={message}
							onCopy={handleCopyMessage}
							onEdit={handleEditMessage}
							onDelete={() => handleDeleteMessage(message.id)}
						/>
					))}

					<div ref={messagesEndRef} />
				</MessagesContainer>

				<InputContainer>
					<InputArea>
						<TextArea
							ref={textAreaRef}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyPress={handleKeyPress}
							placeholder="Plan, search, build anything..."
							disabled={isLoading}
						/>
					</InputArea>

					<ControlBar>
						<ControlLeft>
							<ModelSelector>
								<ModelButton
									onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
								>
									{availableModels.find((m) => m.id === selectedModel)?.icon}
									{availableModels.find((m) => m.id === selectedModel)?.name}
									<FiChevronDown size={12} />
								</ModelButton>
								{modelDropdownOpen && (
									<ModelDropdown $isOpen={modelDropdownOpen}>
										{availableModels.map((model) => (
											<ModelOption
												key={model.id}
												$isSelected={model.id === selectedModel}
												onClick={() => handleModelSelect(model.id)}
											>
												{model.icon} {model.name}
											</ModelOption>
										))}
									</ModelDropdown>
								)}
							</ModelSelector>
						</ControlLeft>
						<ControlRight>
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
						</ControlRight>
					</ControlBar>
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
		</>
	);
};
