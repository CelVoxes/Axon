import React, { useState, useEffect } from "react";
import styled from "styled-components";
import {
	FiPlus,
	FiSave,
	FiDownload,
	FiPlay,
	FiCheck,
	FiX,
} from "react-icons/fi";
import { CodeCell } from "./CodeCell";
import { runNotebookStep } from "../../utils";

const NotebookContainer = styled.div`
	display: flex;
	flex-direction: column;
	height: 100%;
	background: #151515;
`;

const NotebookHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	background: #1e1e1e;
	border-bottom: 1px solid #404040;
`;

const NotebookTitle = styled.div`
	font-size: 16px;
	font-weight: 600;
	color: #ffffff;
`;

const NotebookActions = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" }>`
	background: ${(props) =>
		props.$variant === "primary" ? "#007acc" : "#404040"};
	border: none;
	border-radius: 6px;
	color: #ffffff;
	padding: 8px 16px;
	font-size: 13px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;

	&:hover {
		opacity: 0.8;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const StatusIndicator = styled.div<{
	$status: "starting" | "ready" | "error" | "running";
}>`
	font-size: 12px;
	color: ${(props) => {
		switch (props.$status) {
			case "ready":
				return "#00ff00";
			case "starting":
				return "#ffff00";
			case "running":
				return "#007acc";
			case "error":
				return "#ff0000";
			default:
				return "#858585";
		}
	}};
	display: flex;
	align-items: center;
	gap: 6px;
`;

const CellsContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 20px;
`;

const AddCellButton = styled.button`
	width: 100%;
	padding: 16px;
	background: #2d2d30;
	border: 2px dashed #404040;
	border-radius: 8px;
	color: #858585;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	font-size: 14px;
	transition: all 0.2s ease;

	&:hover {
		background: #404040;
		color: #ffffff;
		border-color: #007acc;
	}
`;

const StatusDisplay = styled.div`
	background: #1e1e1e;
	border: 1px solid #404040;
	border-radius: 6px;
	padding: 12px;
	margin: 8px 0;
	font-size: 12px;
	color: #cccccc;
`;

const VirtualEnvStatus = styled.div<{ $status?: string }>`
	color: ${(props) => {
		if (props.$status?.includes("error")) return "#ff6b6b";
		if (props.$status?.includes("ready")) return "#51cf66";
		if (props.$status?.includes("installing")) return "#ffd43b";
		return "#74c0fc";
	}};
	margin-bottom: 8px;
`;

const CodeWritingLog = styled.div`
	max-height: 200px;
	overflow-y: auto;
	border-top: 1px solid #404040;
	padding-top: 8px;
`;

const CodeEntry = styled.div`
	background: #2d2d30;
	border-radius: 4px;
	padding: 8px;
	margin: 4px 0;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: 11px;
	color: #e9ecef;
	border-left: 3px solid #007acc;
`;

const ProgressBar = styled.div`
	width: 100%;
	height: 4px;
	background: #404040;
	border-radius: 2px;
	overflow: hidden;
	margin: 8px 0;
`;

const ProgressFill = styled.div<{ $progress: number }>`
	height: 100%;
	background: #007acc;
	width: ${(props) => props.$progress}%;
	transition: width 0.3s ease;
`;

const AutoExecutionNotice = styled.div`
	background: rgba(0, 122, 204, 0.1);
	border: 1px solid rgba(0, 122, 204, 0.3);
	border-radius: 8px;
	padding: 12px 16px;
	margin: 16px 0;
	color: #007acc;
	font-size: 14px;
	display: flex;
	align-items: center;
	gap: 8px;
`;

const LoadingMessage = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 200px;
	color: #858585;
	font-size: 14px;
	gap: 16px;
`;

interface Cell {
	id: string;
	code: string;
	language: "python" | "r" | "markdown";
	output: string;
	hasError: boolean;
	status: "pending" | "running" | "completed" | "failed";
	title?: string;
	isMarkdown?: boolean;
}

interface AnalysisStep {
	id: string;
	description: string;
	code: string;
	status: "pending" | "running" | "completed" | "failed";
	output?: string;
}

interface NotebookProps {
	workspacePath?: string;
	onSave?: (cells: Cell[]) => void;
}

export const Notebook: React.FC<NotebookProps> = ({
	workspacePath,
	onSave,
}) => {
	const [cells, setCells] = useState<Cell[]>([]);
	const [jupyterStatus, setJupyterStatus] = useState<
		"starting" | "ready" | "error" | "running"
	>("starting");
	const [isAutoExecuting, setIsAutoExecuting] = useState(false);
	const [analysisCellsCreated, setAnalysisCellsCreated] = useState(false);
	const [analysisCheckAttempts, setAnalysisCheckAttempts] = useState(0);
	const [codeWritingLog, setCodeWritingLog] = useState<
		Array<{ code: string; timestamp: string }>
	>([]);
	const [virtualEnvStatus, setVirtualEnvStatus] = useState<string>("");
	const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
	const [currentStepIndex, setCurrentStepIndex] = useState(0);
	const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

	// Check Jupyter status and start if needed
	useEffect(() => {
		const checkAndStartJupyter = async () => {
			if (!workspacePath) {
				setJupyterStatus("error");
				return;
			}

			console.log(
				`Notebook: Checking Jupyter status for workspace: ${workspacePath}`
			);

			try {
				// First check if Jupyter is already running
				const isRunning = await window.electronAPI.checkJupyterStatus();
				console.log(`Notebook: Jupyter status check result: ${isRunning}`);

				if (isRunning) {
					console.log(
						"Notebook: Jupyter is already running, using existing instance"
					);
					setJupyterStatus("ready");
					// Reset cells when workspace changes
					setCells([]);
					setAnalysisCellsCreated(false);
					setAnalysisCheckAttempts(0);
					// Let the analysis check handle cell creation
					return;
				}

				// If not running, start a new instance
				console.log("Notebook: Jupyter not running, starting new instance...");
				setJupyterStatus("starting");

				const result = await window.electronAPI.startJupyter(workspacePath);

				if (result.success) {
					console.log("Notebook: Jupyter started successfully:", result.url);
					setJupyterStatus("ready");
					// Reset cells when workspace changes
					setCells([]);
					setAnalysisCellsCreated(false);
					setAnalysisCheckAttempts(0);
					// Let the analysis check handle cell creation
				} else {
					console.error("Notebook: Failed to start Jupyter:", result.error);
					setJupyterStatus("error");
				}
			} catch (error) {
				console.error("Notebook: Error checking/starting Jupyter:", error);
				setJupyterStatus("error");
			}
		};

		checkAndStartJupyter();
	}, [workspacePath]);

	// Reset analysis state when workspace changes
	useEffect(() => {
		console.log("Notebook: Workspace changed to:", workspacePath);
		setAnalysisCellsCreated(false);
		setAnalysisCheckAttempts(0);
		setCells([]);
	}, [workspacePath]);

	// Listen for virtual environment status updates
	useEffect(() => {
		const handleVirtualEnvStatus = (data: any) => {
			console.log("Notebook: Virtual environment status:", data);
			setVirtualEnvStatus(data.message);
		};

		window.electronAPI.onVirtualEnvStatus(handleVirtualEnvStatus);
		return () => {
			window.electronAPI.removeAllListeners("virtual-env-status");
		};
	}, []);

	// Listen for code being written to notebook
	useEffect(() => {
		const handleCodeWriting = (data: any) => {
			console.log("Notebook: Code being written:", data);
			setCodeWritingLog((prev) => [
				...prev,
				{
					code: data.code,
					timestamp: data.timestamp,
				},
			]);
		};

		window.electronAPI.onJupyterCodeWriting(handleCodeWriting);
		return () => {
			window.electronAPI.removeAllListeners("jupyter-code-writing");
		};
	}, []);

	// Listen for analysis results from chat panel
	useEffect(() => {
		const checkForAnalysis = async () => {
			console.log(
				`Notebook: checkForAnalysis called - workspacePath: ${workspacePath}, jupyterStatus: ${jupyterStatus}`
			);

			if (!workspacePath || jupyterStatus !== "ready") {
				console.log(
					`Notebook: Skipping analysis check - workspace: ${workspacePath}, jupyterStatus: ${jupyterStatus}`
				);
				return;
			}

			// Skip if analysis cells have already been created
			if (analysisCellsCreated) {
				console.log("Notebook: Analysis cells already created, skipping check");
				return;
			}

			console.log(
				`Notebook: Checking for analysis results in workspace: ${workspacePath}`
			);

			try {
				// First, check if we're in an analysis workspace (contains analysis_result.json)
				const analysisFile = `${workspacePath}/analysis_result.json`;
				console.log(`Notebook: Looking for analysis file: ${analysisFile}`);

				// Check if the file exists first
				try {
					const files = await window.electronAPI.listDirectory(workspacePath);
					console.log(
						"Notebook: Files in workspace:",
						files.map((f) => f.name)
					);
				} catch (dirError) {
					console.log("Notebook: Error listing directory:", dirError);
				}

				const analysisContent = await window.electronAPI.readFile(analysisFile);
				const analysisResult = JSON.parse(analysisContent);

				if (analysisResult.steps && Array.isArray(analysisResult.steps)) {
					console.log(
						`Notebook: Found analysis result in current workspace with ${analysisResult.steps.length} steps, creating cells...`
					);
					createCellsFromSteps(analysisResult.steps);
					return;
				} else {
					console.log("Notebook: Analysis result found but no steps array");
				}
			} catch (error) {
				console.log(
					`Notebook: No analysis_result.json in current workspace: ${error}`
				);

				// Not in an analysis workspace, check for analysis workspaces in the parent directory
				try {
					const parentDir = workspacePath.split("/").slice(0, -1).join("/");
					console.log(`Notebook: Checking parent directory: ${parentDir}`);

					const files = await window.electronAPI.listDirectory(parentDir);

					// Look for analysis_* directories
					const analysisDirs = files.filter(
						(f) => f.isDirectory && f.name.startsWith("analysis_")
					);

					console.log(
						`Notebook: Found ${analysisDirs.length} analysis directories in parent`
					);

					// Check each analysis directory for analysis_result.json
					for (const analysisDir of analysisDirs) {
						try {
							const analysisFile = `${analysisDir.path}/analysis_result.json`;
							console.log(`Notebook: Checking analysis file: ${analysisFile}`);

							const analysisContent = await window.electronAPI.readFile(
								analysisFile
							);
							const analysisResult = JSON.parse(analysisContent);

							if (analysisResult.steps && Array.isArray(analysisResult.steps)) {
								console.log(
									`Notebook: Found analysis result in ${analysisDir.name} with ${analysisResult.steps.length} steps, creating cells...`
								);
								createCellsFromSteps(analysisResult.steps);
								return;
							}
						} catch (dirError) {
							console.log(
								`Notebook: Error reading ${analysisDir.name}: ${dirError}`
							);
							// Continue checking other directories
							continue;
						}
					}
				} catch (parentError) {
					// No analysis directories found, that's fine
					console.log(
						`Notebook: Error checking parent directory: ${parentError}`
					);
				}
			}

			// If we still have no cells after checking, notebook will remain empty
			if (cells.length === 0 && !analysisCellsCreated) {
				console.log(
					"Notebook: No analysis cells found, waiting for analysis request"
				);
			}
		};

		// Check immediately when Jupyter becomes ready
		if (jupyterStatus === "ready") {
			console.log("Notebook: Jupyter ready, checking for analysis immediately");
			checkForAnalysis();
		}

		// Only set up periodic checking if we haven't found analysis cells yet and haven't exceeded max attempts
		let interval: NodeJS.Timeout | null = null;
		if (
			!analysisCellsCreated &&
			jupyterStatus === "ready" &&
			analysisCheckAttempts < 10
		) {
			interval = setInterval(() => {
				console.log("Notebook: Periodic analysis check");
				setAnalysisCheckAttempts((prev) => prev + 1);
				checkForAnalysis();
			}, 5000); // Increased to 5 seconds to reduce spam
		}

		return () => {
			if (interval) {
				clearInterval(interval);
			}
		};
	}, [
		workspacePath,
		jupyterStatus,
		analysisCellsCreated,
		analysisCheckAttempts,
	]);

	const createCellsFromSteps = (steps: AnalysisStep[]) => {
		console.log(
			`Notebook: Creating ${steps.length} cells from analysis steps:`,
			steps
		);

		const newCells: Cell[] = steps.map((step, index) => ({
			id: step.id,
			code: step.code,
			language: "python" as const,
			output: step.output || "",
			hasError: step.status === "failed",
			status: "pending", // Start as pending so user can run manually
			title: `Step ${index + 1}: ${step.description}`,
		}));

		console.log(
			`Notebook: Created ${newCells.length} cell objects:`,
			newCells.map((c) => ({ id: c.id, title: c.title }))
		);

		setCells((prev) => {
			console.log(
				`Notebook: Current cells before update:`,
				prev.map((c) => ({ id: c.id, title: c.title }))
			);

			// Filter out any existing cells with the same IDs to avoid duplicates
			const existingIds = new Set(prev.map((cell) => cell.id));
			const uniqueNewCells = newCells.filter(
				(cell) => !existingIds.has(cell.id)
			);

			if (uniqueNewCells.length > 0) {
				console.log(
					`Notebook: Added ${uniqueNewCells.length} new cells to notebook`
				);
				const updatedCells = [...prev, ...uniqueNewCells];
				console.log(
					`Notebook: Total cells after update:`,
					updatedCells.map((c) => ({ id: c.id, title: c.title }))
				);
				setAnalysisCellsCreated(true); // Mark as created

				// Auto-execute the new cells after a short delay
				setTimeout(() => {
					console.log("Notebook: Auto-executing new analysis cells...");
					executeAnalysisPipeline(uniqueNewCells);
				}, 1000);

				return updatedCells;
			} else {
				console.log("Notebook: No new cells to add (all already exist)");
				setAnalysisCellsCreated(true); // Mark as created even if no new cells
				return prev;
			}
		});
	};

	// New function to execute analysis cells one by one with dynamic generation
	const executeAnalysisPipeline = async (cellsToExecute: Cell[]) => {
		console.log(
			`Notebook: Starting analysis pipeline with ${cellsToExecute.length} initial cells...`
		);
		console.log(`Notebook: Current Jupyter status: ${jupyterStatus}`);

		// Wait a bit more if Jupyter is still starting
		if (jupyterStatus === "starting") {
			console.log("Notebook: Jupyter still starting, waiting...");
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		if (jupyterStatus !== "ready") {
			console.log("Notebook: Jupyter not ready, retrying in 2 seconds...");
			setTimeout(() => executeAnalysisPipeline(cellsToExecute), 2000);
			return;
		}

		console.log(
			`Notebook: Starting analysis pipeline with ${cellsToExecute.length} cells...`
		);
		setJupyterStatus("running");
		setIsAutoExecuting(true);

		// Execute the first cell (data loading) - subsequent cells will be generated dynamically
		const firstCell = cellsToExecute[0];
		if (firstCell && firstCell.status === "pending" && !firstCell.isMarkdown) {
			console.log(`Notebook: Executing first cell: ${firstCell.title}`);

			// Execute the first cell - next steps will be generated when it completes
			await executeCell(firstCell.id, firstCell.code);
		}

		setJupyterStatus("ready");
		setIsAutoExecuting(false);
		console.log(
			"Notebook: Initial cell execution completed - pipeline will continue automatically!"
		);
	};

	// Helper function to get workspace files
	const getWorkspaceFiles = async (): Promise<string[]> => {
		try {
			// Use a simple approach to get files - just return empty array for now
			// We can enhance this later if needed
			return [];
		} catch (error) {
			console.error("Error reading workspace files:", error);
			return [];
		}
	};

	// Function to generate next analysis steps based on current data
	const generateNextAnalysisSteps = async () => {
		try {
			console.log("Notebook: Generating next analysis steps...");

			// Get the current cells to see what's already been done
			const currentCells = cells.filter((c) => c.status === "completed");
			const completedSteps = currentCells.length;

			console.log(
				`Notebook: Completed ${completedSteps} steps, planning next step...`
			);

			// Get current state for planning
			const currentState = {
				completed_steps: completedSteps,
				workspace_path: workspacePath || "",
				available_files: await getWorkspaceFiles(),
				last_cell_output:
					currentCells.length > 0
						? currentCells[currentCells.length - 1].output || ""
						: "",
			};

			// Generate plan for next steps using the general planning API
			const planResponse = await fetch(`http://localhost:8000/llm/plan`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					question: "What should be the next analysis step?",
					context: `Currently analyzing datasets in workspace. Completed ${completedSteps} steps.`,
					current_state: currentState,
					available_data: [],
					task_type: "analysis_step",
				}),
			});

			if (planResponse.ok) {
				const planResult = await planResponse.json();
				console.log("Planning result:", planResult);

				if (planResult.next_steps && planResult.next_steps.length > 0) {
					const nextStepDescription = planResult.next_steps[0]; // Take the first next step

					console.log(`Notebook: Planning to execute: ${nextStepDescription}`);

					// Generate code for the next step
					const nextStepCode = await generateStepCode(
						nextStepDescription,
						"Continue analysis",
						[],
						workspacePath || "",
						completedSteps + 1
					);

					// Create a new cell for the next step
					const newCell: Cell = {
						id: `step_${completedSteps + 2}`,
						code: nextStepCode,
						language: "python" as const,
						output: "",
						hasError: false,
						status: "pending",
						title: `Step ${completedSteps + 2}: ${nextStepDescription}`,
					};

					// Add the new cell
					setCells((prev) => [...prev, newCell]);

					// Execute the new cell
					setTimeout(() => {
						executeCell(newCell.id, newCell.code);
					}, 1000);

					console.log(
						`Notebook: Generated and executing next step: ${nextStepDescription}`
					);
				} else {
					console.log("Notebook: No more steps planned - analysis complete!");
				}
			} else {
				console.warn("Notebook: Planning API call failed, using fallback");
				// Fallback: generate a basic next step
				const fallbackStep = `Continue analysis with step ${
					completedSteps + 2
				}`;
				const fallbackCode = await generateStepCode(
					fallbackStep,
					"Continue analysis",
					[],
					workspacePath || "",
					completedSteps + 1
				);

				const newCell: Cell = {
					id: `step_${completedSteps + 2}`,
					code: fallbackCode,
					language: "python" as const,
					output: "",
					hasError: false,
					status: "pending",
					title: `Step ${completedSteps + 2}: ${fallbackStep}`,
				};

				setCells((prev) => [...prev, newCell]);
				setTimeout(() => {
					executeCell(newCell.id, newCell.code);
				}, 1000);
			}
		} catch (error) {
			console.error("Notebook: Error generating next analysis steps:", error);
		}
	};

	// Function to generate code for a specific step
	const generateStepCode = async (
		stepDescription: string,
		userQuestion: string,
		datasets: any[],
		workingDir: string,
		stepIndex: number
	): Promise<string> => {
		console.log(`Notebook: Generating code for step: ${stepDescription}`);

		try {
			const response = await fetch(`http://localhost:8000/llm/code/stream`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					task_description: stepDescription,
					language: "python",
					context: `Original question: ${userQuestion}\nWorking directory: ${workingDir}\nAvailable datasets: ${datasets
						.map((d) => d.id)
						.join(", ")}`,
				}),
			});

			if (response.ok && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fullCode = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value);
					const lines = chunk.split("\n");

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							try {
								const data = JSON.parse(line.slice(6));
								if (data.chunk) {
									fullCode += data.chunk;
									// Update the code writing log in real-time
									setCodeWritingLog((prev) => [
										...prev,
										{
											code: data.chunk,
											timestamp: new Date().toISOString(),
										},
									]);
								}
							} catch (e) {
								console.warn("Failed to parse streaming chunk:", e);
							}
						}
					}
				}

				console.log("Streaming code generation completed:", fullCode);
				return fullCode;
			} else {
				const errorText = await response.text();
				console.warn(
					`LLM streaming code API call failed. Status: ${response.status}, Error: ${errorText}`
				);
			}
		} catch (apiError) {
			console.warn(`LLM streaming code API error:`, apiError);
		}

		// Fallback to basic code generation
		console.log("Using fallback code generation for step:", stepDescription);
		return `# Fallback code for: ${stepDescription}
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

# TODO: Implement ${stepDescription}
print("Code generation not available. Please implement manually.")`;
	};

	const addCell = (language: "python" | "r" = "python") => {
		const newCell: Cell = {
			id: Date.now().toString(),
			code:
				language === "python"
					? "# Write Python code here"
					: "# Write R code here",
			language,
			output: "",
			hasError: false,
			status: "pending",
		};
		setCells([...cells, newCell]);
	};

	const updateCell = (id: string, updates: Partial<Cell>) => {
		setCells(
			cells.map((cell) => (cell.id === id ? { ...cell, ...updates } : cell))
		);
	};

	const removeCell = (id: string) => {
		setCells(cells.filter((cell) => cell.id !== id));
	};

	const executeCell = async (id: string, code: string) => {
		if (jupyterStatus !== "ready") {
			console.error("Jupyter not ready for execution");
			return;
		}
		const cell = cells.find((c) => c.id === id);
		if (!cell || cell.isMarkdown) return;

		// Update cell status to running
		updateCell(id, { status: "running" });

		await runNotebookStep(
			id,
			code,
			(payload: { output: string | null; error: string | null }) => {
				const newStatus = payload.error ? "failed" : "completed";
				updateCell(id, {
					output: payload.output ?? undefined,
					hasError: !!payload.error,
					status: newStatus,
				});

				// If cell completed successfully and this is an analysis cell, generate next step
				if (
					newStatus === "completed" &&
					cell.title &&
					cell.title.includes("Step")
				) {
					console.log(`Notebook: Cell ${cell.title} completed successfully`);

					// Check if this was the data loading cell or if we should generate the next step
					if (
						cell.title.includes("Download and load datasets") ||
						(cell.title.includes("Step") && !cell.title.includes("Download"))
					) {
						// Wait a bit for the cell output to be processed
						setTimeout(() => {
							generateNextAnalysisSteps();
						}, 2000);
					}
				}
			}
		);
	};

	const executeAllSteps = async () => {
		if (jupyterStatus !== "ready" || cells.length === 0) return;

		setJupyterStatus("running");
		console.log("Starting execution of all analysis steps...");

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			if (cell.status === "pending" || cell.status === "failed") {
				setCurrentStepIndex(i);
				await executeCell(cell.id, cell.code);

				// Wait a bit between steps
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		setJupyterStatus("ready");
		console.log("All analysis steps completed!");
	};

	const saveNotebook = () => {
		if (onSave) {
			onSave(cells);
		}
		console.log("Saving notebook...");
	};

	const exportNotebook = () => {
		console.log("Exporting notebook...");
	};

	const getStatusText = () => {
		switch (jupyterStatus) {
			case "starting":
				return "Starting Jupyter...";
			case "ready":
				return "Jupyter Ready";
			case "running":
				return "Auto-Executing Analysis...";
			case "error":
				return "Jupyter Error";
			default:
				return "Unknown Status";
		}
	};

	const getProgressPercentage = () => {
		if (cells.length === 0) return 0;
		const completed = cells.filter(
			(cell) => cell.status === "completed"
		).length;
		return (completed / cells.length) * 100;
	};

	if (jupyterStatus === "starting" || isLoadingAnalysis) {
		return (
			<NotebookContainer>
				<NotebookHeader>
					<NotebookTitle>Interactive Notebook</NotebookTitle>
					<StatusIndicator $status={jupyterStatus}>
						<FiPlay size={14} />
						{getStatusText()}
					</StatusIndicator>
				</NotebookHeader>
				<LoadingMessage>
					<div>
						{jupyterStatus === "starting"
							? "Starting Jupyter Lab..."
							: "Loading analysis steps..."}
					</div>
					<div>This may take a few moments</div>
				</LoadingMessage>
			</NotebookContainer>
		);
	}

	return (
		<NotebookContainer>
			<NotebookHeader>
				<NotebookTitle>Interactive Notebook</NotebookTitle>
				<NotebookActions>
					{isAutoExecuting && (
						<div
							style={{
								background: "rgba(0, 122, 204, 0.1)",
								border: "1px solid rgba(0, 122, 204, 0.3)",
								borderRadius: "4px",
								padding: "4px 8px",
								color: "#007acc",
								fontSize: "12px",
								display: "flex",
								alignItems: "center",
								gap: "4px",
							}}
						>
							<FiPlay size={12} />
							Auto-executing...
						</div>
					)}
					<StatusIndicator $status={jupyterStatus}>
						<FiPlay size={14} />
						{getStatusText()}
					</StatusIndicator>
					{cells.length > 0 && (
						<ActionButton
							onClick={executeAllSteps}
							disabled={jupyterStatus !== "ready"}
							$variant="primary"
						>
							<FiPlay size={14} />
							Run All Steps
						</ActionButton>
					)}
					<ActionButton
						onClick={saveNotebook}
						disabled={jupyterStatus !== "ready"}
					>
						<FiSave size={14} />
						Save
					</ActionButton>
					<ActionButton
						onClick={exportNotebook}
						disabled={jupyterStatus !== "ready"}
					>
						<FiDownload size={14} />
						Export
					</ActionButton>
				</NotebookActions>
			</NotebookHeader>

			{/* Status Display */}
			{(virtualEnvStatus || codeWritingLog.length > 0) && (
				<StatusDisplay>
					{virtualEnvStatus && (
						<VirtualEnvStatus $status={virtualEnvStatus}>
							🔧 {virtualEnvStatus}
						</VirtualEnvStatus>
					)}
					{codeWritingLog.length > 0 && (
						<CodeWritingLog>
							<div
								style={{
									marginBottom: "8px",
									color: "#007acc",
									fontWeight: "600",
								}}
							>
								📝 Code Generation Log:
							</div>
							{codeWritingLog.slice(-3).map((entry, index) => (
								<CodeEntry key={index}>
									<div
										style={{
											color: "#858585",
											fontSize: "10px",
											marginBottom: "4px",
										}}
									>
										{new Date(entry.timestamp).toLocaleTimeString()}
									</div>
									<div style={{ whiteSpace: "pre-wrap" }}>
										{entry.code.substring(0, 200)}
										{entry.code.length > 200 ? "..." : ""}
									</div>
								</CodeEntry>
							))}
						</CodeWritingLog>
					)}
				</StatusDisplay>
			)}

			{cells.length > 0 && (
				<div
					style={{
						padding: "0 20px",
						background: "#1e1e1e",
						borderBottom: "1px solid #404040",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "12px",
							padding: "8px 0",
						}}
					>
						<span style={{ color: "#858585", fontSize: "12px" }}>
							Progress:
						</span>
						<ProgressBar>
							<ProgressFill $progress={getProgressPercentage()} />
						</ProgressBar>
						<span style={{ color: "#858585", fontSize: "12px" }}>
							{Math.round(getProgressPercentage())}% Complete
						</span>
					</div>
				</div>
			)}

			<CellsContainer>
				{cells.length === 0 ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							padding: "60px 20px",
							color: "#858585",
							textAlign: "center",
						}}
					>
						<div style={{ fontSize: "48px", marginBottom: "16px" }}>📊</div>
						<div
							style={{
								fontSize: "18px",
								fontWeight: "600",
								marginBottom: "8px",
								color: "#cccccc",
							}}
						>
							Interactive Analysis Notebook
						</div>
						<div
							style={{
								fontSize: "14px",
								marginBottom: "24px",
								maxWidth: "400px",
							}}
						>
							Ask a question in the chat panel to generate analysis steps. The
							notebook will automatically create and execute cells based on your
							request.
						</div>
						<div style={{ fontSize: "12px", color: "#666" }}>
							Example: "Can you find me the different transcriptional subtypes
							of B-ALL?"
						</div>
					</div>
				) : (
					cells.map((cell, index) => (
						<div key={cell.id} style={{ marginBottom: "16px" }}>
							{cell.title && !cell.isMarkdown && (
								<div
									style={{
										color: "#007acc",
										fontSize: "14px",
										fontWeight: "600",
										marginBottom: "8px",
										display: "flex",
										alignItems: "center",
										gap: "8px",
									}}
								>
									{cell.status === "completed" && (
										<FiCheck size={16} color="#00ff00" />
									)}
									{cell.status === "failed" && (
										<FiX size={16} color="#ff0000" />
									)}
									{cell.status === "running" && (
										<FiPlay size={16} color="#007acc" />
									)}
									{cell.title}
								</div>
							)}
							{cell.isMarkdown ? (
								<div
									style={{
										background: "#1e1e1e",
										border: "1px solid #404040",
										borderRadius: "8px",
										padding: "16px",
										color: "#ffffff",
										fontSize: "14px",
										lineHeight: "1.6",
									}}
								>
									<div
										dangerouslySetInnerHTML={{
											__html: cell.code.replace(/\n/g, "<br/>"),
										}}
									/>
								</div>
							) : (
								<CodeCell
									key={cell.id}
									initialCode={cell.code}
									language={cell.language}
									workspacePath={workspacePath}
									onExecute={(code, output) => {
										updateCell(cell.id, { code, output });
									}}
								/>
							)}
						</div>
					))
				)}

				{cells.length > 0 && (
					<>
						<AddCellButton onClick={() => addCell("python")}>
							<FiPlus size={16} />
							Add Python Cell
						</AddCellButton>

						<AddCellButton onClick={() => addCell("r")}>
							<FiPlus size={16} />
							Add R Cell
						</AddCellButton>
					</>
				)}
			</CellsContainer>
		</NotebookContainer>
	);
};
