import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { FiSend, FiX, FiStopCircle, FiMessageSquare } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { BioRAGClient } from "../../services/BioRAGClient";
import { ChatMessage } from "./ChatMessage";

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
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const bioragClient = new BioRAGClient();

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
			];

			const isAnalysisRequest = analysisKeywords.some((keyword) =>
				userMessage.toLowerCase().includes(keyword.toLowerCase())
			);

			if (isAnalysisRequest) {
				// Use the autonomous agent for analysis
				await executeAnalysisRequest(userMessage);
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
						// Don't set status="pending" for status updates - they have content
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
						// Don't set status="pending" for step descriptions - they have content
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
try:
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
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	if (collapsed) {
		return <div style={{ display: "none" }} />;
	}

	return (
		<ChatContainer collapsed={collapsed}>
			<ChatHeader>
				<ChatTitle>
					<FiMessageSquare size={16} />
					BioRAG Chat
				</ChatTitle>
				<CollapseButton onClick={onToggle}>
					<FiX size={16} />
				</CollapseButton>
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
	);
};
