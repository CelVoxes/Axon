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

const ActionButton = styled.button<{ variant?: "primary" | "secondary" }>`
	background: ${(props) =>
		props.variant === "primary" ? "#007acc" : "#404040"};
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
	status: "starting" | "ready" | "error" | "running";
}>`
	font-size: 12px;
	color: ${(props) => {
		switch (props.status) {
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
	font-size: 14px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	transition: all 0.2s ease;
	margin: 16px 0;

	&:hover {
		background: #383838;
		border-color: #007acc;
		color: #007acc;
	}
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

const ProgressBar = styled.div`
	width: 100%;
	height: 4px;
	background: #404040;
	border-radius: 2px;
	overflow: hidden;
	margin: 8px 0;
`;

const ProgressFill = styled.div<{ progress: number }>`
	height: 100%;
	background: #007acc;
	width: ${(props) => props.progress}%;
	transition: width 0.3s ease;
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
	const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
	const [currentStepIndex, setCurrentStepIndex] = useState(0);
	const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

	// Start Jupyter when notebook is opened
	useEffect(() => {
		const startJupyter = async () => {
			if (!workspacePath) {
				setJupyterStatus("error");
				return;
			}

			try {
				setJupyterStatus("starting");
				console.log("Starting Jupyter for notebook...");

				const result = await window.electronAPI.startJupyter(workspacePath);

				if (result.success) {
					console.log("Jupyter started successfully:", result.url);
					setJupyterStatus("ready");
					createWelcomeCell();
					loadAnalysisSteps();
				} else {
					console.error("Failed to start Jupyter:", result.error);
					setJupyterStatus("error");
				}
			} catch (error) {
				console.error("Error starting Jupyter:", error);
				setJupyterStatus("error");
			}
		};

		startJupyter();
	}, [workspacePath]);

	const createWelcomeCell = () => {
		const welcomeCell: Cell = {
			id: "welcome",
			code: `# Welcome to Your Interactive Analysis Notebook!

This notebook will help you analyze biological data step by step.

## How to use:
1. Use the chat panel to ask your research question
2. Analysis steps will be generated and appear here as cells
3. Run each cell to execute the analysis
4. View results and modify code as needed

## Example questions to ask in chat:
- "Can you find me the different transcriptional subtypes of B-ALL?"
- "Analyze gene expression patterns in cancer vs normal samples"
- "Identify differentially expressed genes in this dataset"

Ready to start your analysis!`,
			language: "markdown",
			output: "",
			hasError: false,
			status: "completed",
			title: "Welcome",
			isMarkdown: true,
		};
		setCells([welcomeCell]);
	};

	// Load analysis steps from the workspace
	const loadAnalysisSteps = async () => {
		if (!workspacePath) return;

		try {
			setIsLoadingAnalysis(true);
			console.log("Loading analysis steps from workspace...");

			// Check if there's an analysis result file in the workspace
			const analysisFile = `${workspacePath}/analysis_result.json`;
			try {
				const analysisContent = await window.electronAPI.readFile(analysisFile);
				const analysisResult = JSON.parse(analysisContent);

				if (analysisResult.steps && Array.isArray(analysisResult.steps)) {
					setAnalysisSteps(analysisResult.steps);
					createCellsFromSteps(analysisResult.steps);
					console.log("Loaded analysis steps:", analysisResult.steps.length);

					// Automatically execute all steps after a short delay
					setTimeout(() => {
						executeAllSteps();
					}, 2000);
				}
			} catch (error) {
				console.log("No existing analysis found");
			}
		} catch (error) {
			console.error("Error loading analysis steps:", error);
		} finally {
			setIsLoadingAnalysis(false);
		}
	};

	const createCellsFromSteps = (steps: AnalysisStep[]) => {
		const newCells: Cell[] = steps.map((step, index) => ({
			id: step.id,
			code: step.code,
			language: "python" as const,
			output: step.output || "",
			hasError: step.status === "failed",
			status: step.status,
			title: `Step ${index + 1}: ${step.description}`,
		}));
		setCells((prev) => [...prev, ...newCells]);
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

		try {
			console.log("Executing cell:", id);
			updateCell(id, { status: "running", output: "Executing..." });

			const result = await window.electronAPI.executeJupyterCode(code);

			if (result.success) {
				updateCell(id, {
					output: result.output || "Code executed successfully",
					hasError: false,
					status: "completed",
				});
			} else {
				updateCell(id, {
					output: result.error || "Execution failed",
					hasError: true,
					status: "failed",
				});
			}
		} catch (error) {
			console.error("Error executing code:", error);
			updateCell(id, {
				output: `Error: ${error}`,
				hasError: true,
				status: "failed",
			});
		}
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
				return "Executing Analysis...";
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
					<StatusIndicator status={jupyterStatus}>
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
					<StatusIndicator status={jupyterStatus}>
						<FiPlay size={14} />
						{getStatusText()}
					</StatusIndicator>
					{cells.length > 0 && (
						<ActionButton
							onClick={executeAllSteps}
							disabled={jupyterStatus !== "ready"}
							variant="primary"
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
							<ProgressFill progress={getProgressPercentage()} />
						</ProgressBar>
						<span style={{ color: "#858585", fontSize: "12px" }}>
							{Math.round(getProgressPercentage())}% Complete
						</span>
					</div>
				</div>
			)}

			<CellsContainer>
				{cells.map((cell, index) => (
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
								{cell.status === "failed" && <FiX size={16} color="#ff0000" />}
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
				))}

				<AddCellButton onClick={() => addCell("python")}>
					<FiPlus size={16} />
					Add Python Cell
				</AddCellButton>

				<AddCellButton onClick={() => addCell("r")}>
					<FiPlus size={16} />
					Add R Cell
				</AddCellButton>
			</CellsContainer>
		</NotebookContainer>
	);
};
