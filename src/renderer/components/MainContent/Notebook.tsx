import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiPlus, FiSave, FiDownload, FiPlay } from "react-icons/fi";
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

const StatusIndicator = styled.div<{ status: "starting" | "ready" | "error" }>`
	font-size: 12px;
	color: ${(props) => {
		switch (props.status) {
			case "ready":
				return "#00ff00";
			case "starting":
				return "#ffff00";
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

interface Cell {
	id: string;
	code: string;
	language: "python" | "r";
	output: string;
	hasError: boolean;
}

interface NotebookProps {
	workspacePath?: string;
	onSave?: (cells: Cell[]) => void;
}

export const Notebook: React.FC<NotebookProps> = ({
	workspacePath,
	onSave,
}) => {
	const [cells, setCells] = useState<Cell[]>([
		{
			id: "1",
			code: "# Welcome to your interactive notebook!\n# Write Python code here and click Run to execute it.\n\nprint('Hello, World!')",
			language: "python",
			output: "",
			hasError: false,
		},
	]);
	const [jupyterStatus, setJupyterStatus] = useState<
		"starting" | "ready" | "error"
	>("starting");

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

		try {
			console.log("Executing code:", code);
			const result = await window.electronAPI.executeJupyterCode(code);

			if (result.success) {
				updateCell(id, {
					output: result.output || "Code executed successfully",
					hasError: false,
				});
			} else {
				updateCell(id, {
					output: result.error || "Execution failed",
					hasError: true,
				});
			}
		} catch (error) {
			console.error("Error executing code:", error);
			updateCell(id, {
				output: `Error: ${error}`,
				hasError: true,
			});
		}
	};

	const saveNotebook = () => {
		if (onSave) {
			onSave(cells);
		}
		// TODO: Implement actual file saving
		console.log("Saving notebook...");
	};

	const exportNotebook = () => {
		// TODO: Implement notebook export
		console.log("Exporting notebook...");
	};

	const getStatusText = () => {
		switch (jupyterStatus) {
			case "starting":
				return "Starting Jupyter...";
			case "ready":
				return "Jupyter Ready";
			case "error":
				return "Jupyter Error";
			default:
				return "Unknown Status";
		}
	};

	if (jupyterStatus === "starting") {
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
					<div>Starting Jupyter Lab...</div>
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

			<CellsContainer>
				{cells.map((cell) => (
					<CodeCell
						key={cell.id}
						initialCode={cell.code}
						language={cell.language}
						workspacePath={workspacePath}
						onExecute={(code, output) => {
							updateCell(cell.id, { code, output });
						}}
					/>
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
