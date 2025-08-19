import { useCallback, useMemo, useState } from "react";
import { BackendClient } from "../services/BackendClient";
import { SearchConfig } from "../config/SearchConfig";
import { useChatIntent } from "./useChatIntent";

export interface ChatControllerAPI {
	isLoading: boolean;
	isProcessing: boolean;
	progressMessage: string;
	sendMessage: (text: string) => Promise<void>;
}

interface Dependencies {
	backendClient: BackendClient | null;
	addMessage: (content: string, isUser?: boolean) => void;
	handleSuggestionsRequest: (message: string) => Promise<void>;
	handleAnalysisRequest: (message: string) => Promise<void>;
	setSearchProgress: (progress: any) => void;
	setShowSearchDetails: (v: boolean) => void;
	updateProgressData: (data: any) => void;
}

export function useChatController(deps: Dependencies): ChatControllerAPI {
	const {
		backendClient,
		addMessage,
		handleSuggestionsRequest,
		handleAnalysisRequest,
		setSearchProgress,
		setShowSearchDetails,
		updateProgressData,
	} = deps;
	const { shouldSearchForDatasets, isSuggestionsRequest, isAnalysisRequest } =
		useChatIntent();

	const [isLoading, setIsLoading] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");

	const sendMessage = useCallback(
		async (userMessage: string) => {
			if (!userMessage.trim() || isLoading) return;
			addMessage(userMessage, true);
			setIsLoading(true);
			setIsProcessing(true);

			try {
				if (isSuggestionsRequest(userMessage)) {
					await handleSuggestionsRequest(userMessage);
					return;
				}

				// Decide once whether we should trigger dataset search
				const wantSearch = await shouldSearchForDatasets(userMessage);
				if (wantSearch) {
					setProgressMessage("🔍 Searching for datasets...");
					setShowSearchDetails(true);

					if (!backendClient) {
						addMessage(
							"❌ Backend client not initialized. Please wait a moment and try again.",
							false
						);
						return;
					}

					backendClient.setProgressCallback((progress) =>
						updateProgressData(progress)
					);
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
					} else {
						addMessage(
							"❌ No datasets found matching your search. Try different keywords or be more specific.",
							false
						);
					}

					setTimeout(() => {
						setSearchProgress(null);
						setShowSearchDetails(false);
					}, 2000);
					return;
				}

				if (isAnalysisRequest(userMessage)) {
					// Respect intent gating: only auto-search for analysis if classifier indicated SEARCH_DATA
					if (!wantSearch) {
						addMessage(
							"🧪 Detected an analysis request. To proceed, either select datasets first or ask me to add a new code cell.",
							false
						);
						return;
					}
					// If datasets not selected yet, prompt and auto-search handled by caller if needed
					addMessage(
						`Analysis Request Detected!\n\nI can help you with: ${userMessage}\n\nHowever, I need to find relevant datasets first. Let me search for datasets related to your analysis:\n\nSearching for: ${userMessage}`,
						false
					);
					setProgressMessage("Searching for relevant datasets...");
					setShowSearchDetails(true);
					if (backendClient) {
						backendClient.setProgressCallback((progress) =>
							updateProgressData(progress)
						);
						setSearchProgress({
							message: "Initializing search...",
							progress: 0,
							step: "init",
							datasetsFound: 0,
						});
						const response = await backendClient.discoverDatasets(userMessage, {
							limit: 50,
						});
						if (response.datasets && response.datasets.length > 0) {
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
						setTimeout(() => {
							setSearchProgress(null);
							setShowSearchDetails(false);
						}, 2000);
					} else {
						addMessage(
							"Backend client not initialized. Please wait a moment and try again.",
							false
						);
					}
					return;
				}

				// Fallback helper
				addMessage(
					"To get started, type your question or search for datasets. " +
						"Attach your data with @ (e.g., @data.csv) and reference a notebook cell with # (e.g., #3).",
					false
				);
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error("Error processing message:", error);
				addMessage("Sorry, I encountered an error. Please try again.", false);
			} finally {
				setIsLoading(false);
				setIsProcessing(false);
				setProgressMessage("");
			}
		},
		[
			addMessage,
			isLoading,
			backendClient,
			handleSuggestionsRequest,
			shouldSearchForDatasets,
			isSuggestionsRequest,
			isAnalysisRequest,
			setSearchProgress,
			setShowSearchDetails,
			updateProgressData,
		]
	);

	return { isLoading, isProcessing, progressMessage, sendMessage };
}
