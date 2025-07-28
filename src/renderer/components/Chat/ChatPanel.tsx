import React, { useState, useRef, useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { BackendClient } from "../../services/BackendClient";
import ReactMarkdown from "react-markdown";
import { DatasetSelectionModal } from "./DatasetSelectionModal";
import { FiSend } from "react-icons/fi";
import { AutonomousAgent } from "../../services/AutonomousAgent";

interface Message {
	id: string;
	content: string;
	isUser: boolean;
	timestamp: Date;
}

interface ChatPanelProps {
	className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ className }) => {
	const { state, dispatch } = useAppContext();
	const [messages, setMessages] = useState<Message[]>([]);
	const [inputValue, setInputValue] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");
	const [progressData, setProgressData] = useState<any>(null);
	const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
	const [showDatasetModal, setShowDatasetModal] = useState(false);
	const [searchLog, setSearchLog] = useState<string[]>([]);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const backendClient = new BackendClient();

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	useEffect(() => {
		scrollToBottom();
	}, [messages]);

	const addMessage = (content: string, isUser: boolean = false) => {
		const newMessage: Message = {
			id: Date.now().toString(),
			content,
			isUser,
			timestamp: new Date(),
		};
		setMessages((prev) => [...prev, newMessage]);
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

		// Create a formatted progress message similar to backend logs
		let progressText = "";

		switch (data.step) {
			case "init":
				progressText = `🔍 Starting dataset search...`;
				break;
			case "simplify":
				progressText = `🤖 Simplifying query with AI...`;
				break;
			case "simplified":
				progressText = `✅ Query simplified to: "${data.message}"`;
				break;
			case "search":
				progressText = `🔍 Searching databases for: "${data.currentTerm}"`;
				break;
			case "search_results":
				progressText = `📊 Found ${data.datasetsFound} datasets for "${data.currentTerm}"`;
				break;
			case "search_no_results":
				progressText = `❌ No datasets found for "${data.currentTerm}"`;
				break;
			case "search_error":
				progressText = `⚠️ Search failed for "${data.currentTerm}"`;
				break;
			case "initial_results":
				progressText = `📊 Found ${data.datasetsFound} datasets for "${data.currentTerm}"`;
				break;
			case "fallback":
				progressText = `🔄 Need more results, generating alternative search terms...`;
				break;
			case "deduplicate":
				progressText = `🧹 Removing duplicates and finalizing results...`;
				break;
			case "complete":
				progressText = `✅ Search complete! Found ${data.datasetsFound} unique datasets`;
				break;
			case "error":
				progressText = `❌ Search failed: ${data.message}`;
				break;
			default:
				progressText = data.message;
		}

		// Add to search log for real-time display
		setSearchLog((prev) => [...prev, progressText]);

		setProgressMessage(progressText);
	};

	const handleSendMessage = async () => {
		if (!inputValue.trim() || isLoading) return;

		const userMessage = inputValue.trim();
		setInputValue("");
		setIsLoading(true);
		setProgressMessage("");
		setSearchLog([]); // Clear search log for new search

		// Add user message
		addMessage(userMessage, true);

		try {
			// Set up progress callback for real-time updates
			backendClient.setProgressCallback((progress) => {
				updateProgressData(progress);
			});

			// Search for datasets with real-time progress updates
			const searchResult = await backendClient.discoverDatasets(userMessage);

			if (searchResult.datasets.length > 0) {
				// Show datasets in modal for selection
				setAvailableDatasets(searchResult.datasets);
				setShowDatasetModal(true);

				// Add response message with search info
				let responseContent = `## 🔍 Query Processing\n\n`;
				responseContent += `**Original Query:** ${userMessage}\n\n`;

				if (searchResult.queryTransformation) {
					responseContent += `**AI Processing:** ${searchResult.queryTransformation}\n\n`;
				}

				if (searchResult.searchSteps?.length) {
					responseContent += `**Search Process:**\n`;
					searchResult.searchSteps.forEach((step, index) => {
						// Format the step similar to backend logs
						if (step.includes("Searching for:")) {
							responseContent += `🔍 ${step}\n`;
						} else if (step.includes("Found") && step.includes("datasets")) {
							responseContent += `📊 ${step}\n`;
						} else if (step.includes("No datasets found")) {
							responseContent += `❌ ${step}\n`;
						} else if (
							step.includes("Enough results found") ||
							step.includes("Found sufficient results")
						) {
							responseContent += `✅ ${step}\n`;
						} else if (step.includes("Processing query")) {
							responseContent += `🤖 ${step}\n`;
						} else if (step.includes("Simplifying query")) {
							responseContent += `🔄 ${step}\n`;
						} else if (step.includes("Generated terms")) {
							responseContent += `🎯 ${step}\n`;
						} else if (step.includes("Final result")) {
							responseContent += `✅ ${step}\n`;
						} else {
							responseContent += `${index + 1}. ${step}\n`;
						}
					});
					responseContent += `\n`;
				}

				responseContent += `## 📊 Found ${searchResult.datasets.length} Datasets\n\n`;

				// Show dataset details similar to backend format
				searchResult.datasets.forEach((dataset, index) => {
					responseContent += `**${index + 1}. ${dataset.id}** - ${
						dataset.title
					}\n`;
					if (dataset.organism) {
						responseContent += `   Organism: ${dataset.organism}\n`;
					}
					if (dataset.description) {
						responseContent += `   Description: ${dataset.description.substring(
							0,
							100
						)}${dataset.description.length > 100 ? "..." : ""}\n`;
					}
					responseContent += `   URL: https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${dataset.id}\n\n`;
				});

				responseContent += `Please select the datasets you'd like to analyze from the modal below.`;

				addMessage(responseContent);
			} else {
				// No datasets found
				let responseContent = `## ❌ No Datasets Found\n\n`;
				responseContent += `I couldn't find any datasets for your query: "${userMessage}"\n\n`;

				if (searchResult.searchTerms?.length) {
					responseContent += `**🔍 Search terms tried:** ${searchResult.searchTerms.join(
						", "
					)}\n\n`;
				}

				if (searchResult.searchSteps?.length) {
					responseContent += `**📋 Search Process:**\n`;
					searchResult.searchSteps.forEach((step, index) => {
						// Format the step similar to backend logs
						if (step.includes("Searching for:")) {
							responseContent += `🔍 ${step}\n`;
						} else if (step.includes("Found") && step.includes("datasets")) {
							responseContent += `📊 ${step}\n`;
						} else if (step.includes("No datasets found")) {
							responseContent += `❌ ${step}\n`;
						} else if (step.includes("Processing query")) {
							responseContent += `🤖 ${step}\n`;
						} else if (step.includes("Simplifying query")) {
							responseContent += `🔄 ${step}\n`;
						} else if (step.includes("Generated terms")) {
							responseContent += `🎯 ${step}\n`;
						} else {
							responseContent += `${index + 1}. ${step}\n`;
						}
					});
					responseContent += `\n`;
				}

				responseContent += `**Suggestions:**\n`;
				searchResult.suggestions.forEach((suggestion) => {
					responseContent += `- ${suggestion}\n`;
				});

				addMessage(responseContent);
			}
		} catch (error) {
			console.error("Error processing message:", error);
			addMessage(
				"❌ Sorry, I encountered an error while processing your request. Please try again."
			);
		} finally {
			setIsLoading(false);
			setProgressMessage("");
		}
	};

	const handleDatasetSelection = async (selectedDatasets: any[]) => {
		setShowDatasetModal(false);

		if (selectedDatasets.length > 0) {
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

			responseContent += `**🚀 Starting Analysis...**\n`;
			responseContent += `- Creating Jupyter notebook for data download\n`;
			responseContent += `- Generating analysis steps\n`;
			responseContent += `- Preparing to execute cells automatically\n`;

			addMessage(responseContent);

			// Start the analysis process
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
					messages.find((m) => m.isUser)?.content ||
					"Analysis of selected datasets";

				console.log("Starting analysis with:", {
					originalQuery,
					datasets: datasets.map((d) => d.id),
					currentWorkspace: state.currentWorkspace,
				});

				// Create AutonomousAgent instance
				const baseWorkspacePath = state.currentWorkspace || "/tmp";
				console.log("Using base workspace path:", baseWorkspacePath);
				const agent = new AutonomousAgent(backendClient, baseWorkspacePath);
				agent.setStatusCallback((status) => {
					setProgressMessage(status);
				});

				// Create analysis workspace
				setProgressMessage("📁 Creating analysis workspace...");
				const workspaceDir = await agent.createAnalysisWorkspace(originalQuery);
				console.log("Analysis workspace created:", workspaceDir);

				// Generate data download notebook
				setProgressMessage("📓 Generating data download notebook...");
				const notebookPath = await agent.generateDataDownloadNotebook(
					originalQuery,
					datasets,
					workspaceDir
				);
				console.log("Notebook generated:", notebookPath);

				// Generate analysis steps
				setProgressMessage("🔬 Generating analysis steps...");
				const analysisResult = await agent.executeAnalysisRequestWithData(
					originalQuery,
					datasets
				);
				console.log(
					"Analysis result generated with",
					analysisResult.steps.length,
					"steps"
				);

				// Save analysis result to workspace for notebook to pick up
				const analysisFilePath = `${workspaceDir}/analysis_result.json`;
				await window.electronAPI.writeFile(
					analysisFilePath,
					JSON.stringify(analysisResult, null, 2)
				);

				console.log("Analysis workspace created:", workspaceDir);
				console.log("Analysis result saved to:", analysisFilePath);

				// Verify the file was created
				try {
					const files = await window.electronAPI.listDirectory(workspaceDir);
					console.log(
						"Files in analysis workspace:",
						files.map((f) => f.name)
					);
				} catch (dirError) {
					console.error("Error listing analysis workspace:", dirError);
				}

				// Set the analysis workspace as the current workspace so notebook can find it
				dispatch({ type: "SET_WORKSPACE", payload: workspaceDir });

				// Show the notebook panel
				dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });

				// Give the notebook component time to detect the workspace change
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Update progress
				setProgressMessage(
					"✅ Analysis setup complete! Jupyter cells are being created..."
				);

				// Add completion message
				let completionMessage = `## 🎉 Analysis Setup Complete!\n\n`;
				completionMessage += `**Workspace:** ${workspaceDir}\n`;
				completionMessage += `**Notebook:** ${notebookPath}\n`;
				completionMessage += `**Steps Generated:** ${analysisResult.steps.length}\n\n`;
				completionMessage += `**Next Steps:**\n`;
				completionMessage += `- Jupyter notebook is being created with data download cells\n`;
				completionMessage += `- Analysis steps will be executed automatically\n`;
				completionMessage += `- The notebook panel has been opened for you\n`;
				completionMessage += `- Check the notebook for real-time progress and results\n\n`;
				completionMessage += `**Generated Steps:**\n`;
				analysisResult.steps.forEach((step, index) => {
					completionMessage += `${index + 1}. ${step.description}\n`;
				});

				addMessage(completionMessage);
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

				addMessage(errorMessage);
			} finally {
				setIsLoading(false);
				setProgressMessage("");
			}
		}
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	return (
		<div className={`chat-panel ${className || ""}`}>
			<div className="chat-header">
				<h3>AI Assistant</h3>
			</div>

			<div className="chat-messages">
				{messages.map((message) => (
					<div
						key={message.id}
						className={`message ${message.isUser ? "user" : "assistant"}`}
					>
						<div className="message-content">
							<ReactMarkdown>{message.content}</ReactMarkdown>
						</div>
					</div>
				))}

				{/* Progress message */}
				{progressData && (
					<div className="progress-message">
						<div className="progress-header">
							<span className="progress-text">{progressData.message}</span>
							<span className="progress-percentage">
								{progressData.progress}%
							</span>
						</div>
						<div className="progress-bar-container">
							<div
								className="progress-bar-fill"
								style={{ width: `${progressData.progress}%` }}
							></div>
						</div>
						{progressData.currentTerm && (
							<div className="progress-detail">
								Searching: <strong>{progressData.currentTerm}</strong>
							</div>
						)}
						{progressData.datasetsFound !== undefined && (
							<div className="progress-detail">
								Datasets found: <strong>{progressData.datasetsFound}</strong>
							</div>
						)}

						{/* Real-time search log */}
						{searchLog.length > 0 && (
							<div className="search-log">
								<div className="search-log-header">
									<strong>🔍 Search Progress:</strong>
								</div>
								<div className="search-log-entries">
									{searchLog.map((entry, index) => (
										<div key={index} className="search-log-entry">
											{entry}
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				<div ref={messagesEndRef} />
			</div>

			<div className="chat-input-container">
				<textarea
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyPress={handleKeyPress}
					placeholder="Ask me to find datasets or analyze data..."
					disabled={isLoading}
					rows={1}
				/>
				<button
					onClick={handleSendMessage}
					disabled={isLoading || !inputValue.trim()}
					className="send-button"
				>
					{isLoading ? "..." : <FiSend />}
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
