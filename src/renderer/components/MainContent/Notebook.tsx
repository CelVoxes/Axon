import React, { useState, useEffect, useRef } from "react";
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
import { NotebookOutputRenderer } from "./NotebookOutputRenderer";
import {
	ActionButton,
	StatusIndicator,
	LoadingMessage,
} from "../shared/StyledComponents";
import { Cell, AnalysisStep } from "../shared/interfaces";
import { typography } from "../../styles/design-system";
import {
	CellExecutionService,
	Cell as ServiceCell,
} from "../../services/CellExecutionService";

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
	font-size: ${typography.lg};
	font-weight: 600;
	color: #ffffff;
`;

const NotebookActions = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;
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
	font-size: ${typography.base};
	transition: all 0.2s ease;

	&:hover {
		background: #404040;
		color: #ffffff;
		border-color: #007acc;
	}
`;

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
	const [currentStepIndex, setCurrentStepIndex] = useState(0);

	// Add refs for autoscroll functionality
	const cellsContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Initialize CellExecutionService
	const cellExecutionService = React.useMemo(() => {
		return workspacePath ? new CellExecutionService(workspacePath) : null;
	}, [workspacePath]);

	// Check Jupyter status and start if needed
	useEffect(() => {
		const checkAndStartJupyter = async () => {
			if (!workspacePath) {
				setJupyterStatus("error");
				return;
			}

			try {
				// First check if Jupyter is already running
				const isRunning = await window.electronAPI.checkJupyterStatus();

				if (isRunning) {
					setJupyterStatus("ready");
					return;
				}

				// If not running, start a new instance
				setJupyterStatus("starting");

				const result = await window.electronAPI.startJupyter(workspacePath);

				if (result.success) {
					setJupyterStatus("ready");
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

	// Listen for notebook cell events from AutonomousAgent
	useEffect(() => {
		const handleAddNotebookCell = (event: CustomEvent) => {
			const { filePath, cellType, content } = event.detail;

			// Only handle events for the current notebook
			const isRelevantEvent =
				filePath &&
				(filePath.includes(workspacePath || "") ||
					(workspacePath && filePath.startsWith(workspacePath)) ||
					(workspacePath &&
						filePath.includes(workspacePath.split("/").pop() || "")) ||
					(filePath.endsWith(".ipynb") &&
						workspacePath &&
						filePath.includes(workspacePath.split("/").pop() || "")));

			if (isRelevantEvent) {
				if (cellType === "markdown") {
					const newCell: Cell = {
						id: `markdown-${Date.now()}`,
						code: content,
						language: "markdown",
						output: "",
						hasError: false,
						status: "completed",
						isMarkdown: true,
					};
					setCells((prev) => [...prev, newCell]);
				} else if (cellType === "code") {
					const newCell: Cell = {
						id: `code-${Date.now()}`,
						code: content,
						language: "python",
						output: "",
						hasError: false,
						status: "pending",
					};
					setCells((prev) => [...prev, newCell]);
				}
			}
		};

		const handleUpdateNotebookCell = (event: CustomEvent) => {
			const { filePath, cellIndex, output } = event.detail;

			const isRelevantEvent =
				filePath &&
				(filePath.includes(workspacePath || "") ||
					(workspacePath && filePath.startsWith(workspacePath)) ||
					(workspacePath &&
						filePath.includes(workspacePath.split("/").pop() || "")) ||
					(filePath.endsWith(".ipynb") &&
						workspacePath &&
						filePath.includes(workspacePath.split("/").pop() || "")));

			if (isRelevantEvent) {
				setCells((prev) => {
					const newCells = [...prev];
					if (newCells[cellIndex]) {
						newCells[cellIndex] = {
							...newCells[cellIndex],
							output: output,
							status: "completed",
						};
					}
					return newCells;
				});
			}
		};

		// Add event listeners
		window.addEventListener(
			"add-notebook-cell",
			handleAddNotebookCell as EventListener
		);
		window.addEventListener(
			"update-notebook-cell",
			handleUpdateNotebookCell as EventListener
		);

		// Cleanup
		return () => {
			window.removeEventListener(
				"add-notebook-cell",
				handleAddNotebookCell as EventListener
			);
			window.removeEventListener(
				"update-notebook-cell",
				handleUpdateNotebookCell as EventListener
			);
		};
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
		console.log(`Executing cell ${id} with status: ${jupyterStatus}`);
		if (jupyterStatus !== "ready") {
			console.error("Jupyter not ready for execution");
			return;
		}
		const cell = cells.find((c) => c.id === id);
		if (!cell || cell.isMarkdown) {
			console.log(`Cell ${id} not found or is markdown`);
			return;
		}

		console.log(`Starting execution of cell ${id}: ${cell.title}`);

		// Update cell status to running
		updateCell(id, { status: "running" });

		if (!cellExecutionService) {
			throw new Error("CellExecutionService not initialized");
		}

		const result = await cellExecutionService.executeCell(
			id,
			code,
			(updates: Partial<ServiceCell>) => {
				const newStatus = updates.status || "completed";
				updateCell(id, {
					output: updates.output,
					hasError: updates.hasError || false,
					status: newStatus,
				});
			}
		);
	};

	const executeAllSteps = async () => {
		if (jupyterStatus !== "ready" || !cells || cells.length === 0) return;

		setJupyterStatus("running");
		setIsAutoExecuting(true);
		console.log("Starting sequential execution of all analysis steps...");

		// Get all pending cells
		const pendingCells = cells.filter(
			(cell) => cell.status === "pending" || cell.status === "failed"
		);

		for (let i = 0; i < pendingCells.length; i++) {
			const cell = pendingCells[i];
			setCurrentStepIndex(i);

			console.log(
				`Executing cell ${i + 1}/${pendingCells.length}: ${cell.title}`
			);

			// Execute the cell
			await executeCell(cell.id, cell.code);

			// Wait a bit between steps for better UX
			if (i < pendingCells.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		setJupyterStatus("ready");
		setIsAutoExecuting(false);
		console.log("All analysis steps completed!");
	};

	// Execute cells one by one with user control
	const executeNextCell = async () => {
		if (jupyterStatus !== "ready" || !cells || cells.length === 0) return;

		// Find the first pending cell
		const nextCell = cells.find(
			(cell) => cell.status === "pending" || cell.status === "failed"
		);

		if (!nextCell) {
			console.log("No more cells to execute");
			return;
		}

		setJupyterStatus("running");
		console.log(`Executing next cell: ${nextCell.title}`);

		await executeCell(nextCell.id, nextCell.code);

		setJupyterStatus("ready");
		console.log(`Cell completed: ${nextCell.title}`);
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
		if (!cells || cells.length === 0) return 0;
		const completed = cells.filter(
			(cell) => cell.status === "completed"
		).length;
		return (completed / cells.length) * 100;
	};

	// Enhanced autoscroll effect for new cells
	useEffect(() => {
		if (cellsContainerRef.current) {
			setTimeout(() => {
				if (cellsContainerRef.current) {
					cellsContainerRef.current.scrollTop =
						cellsContainerRef.current.scrollHeight;
				}
			}, 100);
		}
	}, [cells]);

	if (jupyterStatus === "starting") {
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
					<div>Starting Jupyter Lab...</div>
					<div>This may take a few moments</div>
				</LoadingMessage>
			</NotebookContainer>
		);
	}

	return (
		<NotebookContainer>
			<NotebookHeader>
				<NotebookTitle>Enhanced Interactive Notebook</NotebookTitle>
				<NotebookActions>
					<StatusIndicator $status={jupyterStatus}>
						<FiPlay size={14} />
						{getStatusText()}
					</StatusIndicator>
					{cells && cells.length > 0 && (
						<>
							<ActionButton
								onClick={executeNextCell}
								disabled={jupyterStatus !== "ready"}
								$variant="secondary"
							>
								<FiPlay size={14} />
								Run Next Cell
							</ActionButton>
							<ActionButton
								onClick={executeAllSteps}
								disabled={jupyterStatus !== "ready"}
								$variant="primary"
							>
								<FiPlay size={14} />
								Run All Steps
							</ActionButton>
						</>
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

			<CellsContainer ref={cellsContainerRef}>
				{!cells || cells.length === 0 ? (
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
							Enhanced Interactive Notebook
						</div>
						<div
							style={{
								fontSize: "14px",
								marginBottom: "24px",
								maxWidth: "500px",
							}}
						>
							Experience rich notebook outputs with advanced rendering
							capabilities:
						</div>
						<div
							style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}
						>
							📊 <strong>Data Tables</strong> - Beautiful, interactive data
							displays
						</div>
						<div
							style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}
						>
							📈 <strong>Charts & Plots</strong> - Visualize your data with rich
							graphics
						</div>
						<div
							style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}
						>
							📝 <strong>Rich Text</strong> - Markdown formatting and syntax
							highlighting
						</div>
						<div
							style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}
						>
							🔧 <strong>JSON & Metrics</strong> - Structured data with
							collapsible views
						</div>
						<div
							style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}
						>
							💾 <strong>Export & Copy</strong> - Download outputs and copy to
							clipboard
						</div>
						<div style={{ fontSize: "12px", color: "#666" }}>
							Ask questions in the chat panel to generate analysis workflows
							with enhanced outputs
						</div>
					</div>
				) : (
					(cells || []).map((cell, index) => (
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
								<>
									<CodeCell
										key={cell.id}
										initialCode={cell.code}
										initialOutput={cell.output}
										language={cell.language}
										workspacePath={workspacePath}
										onExecute={(code, output) => {
											updateCell(cell.id, { code, output });
										}}
									/>
									{cell.output && (
										<NotebookOutputRenderer
											output={cell.output}
											hasError={cell.hasError}
										/>
									)}
								</>
							)}
						</div>
					))
				)}

				{/* Add ref for autoscroll */}
				<div ref={messagesEndRef} />
			</CellsContainer>
		</NotebookContainer>
	);
};
