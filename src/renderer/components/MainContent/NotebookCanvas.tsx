import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import styled from "styled-components";
import {
	FiPlay,
	FiSquare,
	FiCpu,
	FiFileText,
	FiPlus,
	FiBarChart,
	FiDatabase,
	FiImage,
	FiSettings,
	FiCode,
	FiBookOpen,
	FiTrendingUp,
	FiFilter,
	FiSave,
	FiEdit3,
	FiEye,
	FiX,
} from "react-icons/fi";
import { typography } from "../../styles/design-system";
import { EventManager } from "../../utils/EventManager";

type NotebookCell = {
	cell_type: "code" | "markdown";
	source: string[] | string;
	metadata: any;
	execution_count?: number | null;
	outputs?: any[];
};

type CellState = { code: string; output: string };
type ViewMode = "preview" | "edit";

interface NotebookCanvasProps {
	filePath: string;
	cells: NotebookCell[];
	cellStates: CellState[];
	onOpenCell?: (index: number) => void;
}

const CanvasContainer = styled.div`
	padding: 20px;
	background: #fafafa;
	min-height: 100vh;
	position: relative;
`;

const CanvasHeader = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 24px;
	padding-bottom: 16px;
	border-bottom: 2px solid #e5e7eb;
	background: white;
	padding: 16px 20px;
	border-radius: 12px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
`;

const CanvasTitle = styled.h1`
	font-size: ${typography.xl};
	font-weight: 700;
	color: #111827;
	margin: 0;
`;

const CanvasControls = styled.div`
	display: flex;
	gap: 12px;
	align-items: center;
`;

const CanvasArea = styled.div`
	position: relative;
	width: 100%;
	height: 600px;
	background: white;
	border-radius: 12px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	border: 1px solid #e5e7eb;
	overflow: hidden;
`;

const FlowNode = styled.div<{
	$x: number;
	$y: number;
	$type: string;
	$status: string;
}>`
	position: absolute;
	width: 120px;
	height: 80px;
	border-radius: 12px;
	border: 2px solid;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	cursor: pointer;
	transition: all 0.2s ease;
	font-size: 11px;
	font-weight: 500;
	text-align: center;
	padding: 8px;

	${(p) => {
		const colors = {
			data: { border: "#10b981", bg: "#ecfdf5", text: "#065f46" },
			visualization: { border: "#8b5cf6", bg: "#faf5ff", text: "#6b21a8" },
			code: { border: "#6b7280", bg: "#f9fafb", text: "#374151" },
			note: { border: "#f59e0b", bg: "#fffbeb", text: "#92400e" },
			loading: { border: "#059669", bg: "#ecfdf5", text: "#065f46" },
			processing: { border: "#2563eb", bg: "#eff6ff", text: "#1d4ed8" },
		};

		const typeKey = p.$type as keyof typeof colors;
		const statusKey = p.$status as keyof typeof colors;
		const colorSet = colors[typeKey] || colors.code;

		return `
			left: ${p.$x}px;
			top: ${p.$y}px;
			border-color: ${colorSet.border};
			background: ${colorSet.bg};
			color: ${colorSet.text};
		`;
	}}

	&:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}
`;

const NodeIcon = styled.div<{ $color: string }>`
	font-size: 20px;
	color: ${(p) => p.$color};
`;

const NodeLabel = styled.div`
	font-weight: 600;
	font-size: 10px;
`;

const NodeDescription = styled.div`
	font-size: 9px;
	opacity: 0.8;
`;

const FlowEdge = styled.svg`
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
`;

const EdgePath = styled.path`
	stroke: #9ca3af;
	stroke-width: 2;
	fill: none;
	opacity: 0.6;
`;

const EdgeArrow = styled.path`
	stroke: #9ca3af;
	stroke-width: 2;
	fill: #9ca3af;
`;

const NodeActions = styled.div`
	position: absolute;
	top: -40px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	gap: 4px;
	opacity: 0;
	pointer-events: none;
	transition: opacity 0.2s ease;
`;

const ActionButton = styled.button`
	padding: 4px 8px;
	border-radius: 6px;
	font-size: 10px;
	border: 1px solid #d1d5db;
	background: white;
	color: #374151;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;

	&:hover {
		background: #f9fafb;
	}
`;

const EmptyCanvas = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #6b7280;
	text-align: center;
`;

const EmptyIcon = styled.div`
	font-size: 48px;
	margin-bottom: 16px;
	opacity: 0.5;
`;

const EmptyTitle = styled.h2`
	font-size: ${typography.lg};
	margin-bottom: 8px;
	color: #374151;
`;

const EmptyDescription = styled.p`
	font-size: ${typography.base};
	margin: 0;
	max-width: 400px;
`;

const ControlButton = styled.button<{
	$variant?: "primary" | "secondary" | "danger";
}>`
	padding: 8px 16px;
	border-radius: 8px;
	font-size: ${typography.sm};
	font-weight: 500;
	border: 1px solid;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: all 0.2s ease;

	${(p) =>
		p.$variant === "primary"
			? `
		background: #3b82f6;
		border-color: #3b82f6;
		color: white;
		&:hover { background: #2563eb; }
	`
			: p.$variant === "danger"
			? `
		background: #ef4444;
		border-color: #ef4444;
		color: white;
		&:hover { background: #dc2626; }
	`
			: `
		background: white;
		border-color: #d1d5db;
		color: #374151;
		&:hover { background: #f9fafb; }
	`}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

function extractCode(cell: NotebookCell, state?: CellState): string {
	if (state?.code && state.code.trim()) return state.code;
	if (Array.isArray(cell.source)) return cell.source.join("");
	return String(cell.source ?? "");
}

function getCellStatus(
	cell: NotebookCell,
	isRunning: boolean
): "ready" | "running" | "error" | "completed" {
	if (isRunning) return "running";
	const hasError = !!(cell.outputs || []).some(
		(o: any) => o?.output_type === "error"
	);
	if (hasError) return "error";
	if (cell.execution_count) return "completed";
	return "ready";
}

function getCellVisualInfo(
	cell: NotebookCell,
	code: string
): {
	type: string;
	icon: React.ComponentType<any>;
	label: string;
	color: string;
} {
	if (cell.cell_type === "markdown") {
		const lines = code.split("\n").filter((line) => line.trim());
		if (lines.length === 0) {
			return {
				type: "note",
				icon: FiBookOpen,
				label: "Note",
				color: "#f59e0b",
			};
		}

		const firstLine = lines[0].replace(/^#\s*/, "").toLowerCase();

		if (firstLine.includes("summary") || firstLine.includes("overview")) {
			return {
				type: "note",
				icon: FiBookOpen,
				label: "Summary",
				color: "#f59e0b",
			};
		}
		if (firstLine.includes("analysis") || firstLine.includes("analyze")) {
			return {
				type: "note",
				icon: FiBarChart,
				label: "Analysis Note",
				color: "#f59e0b",
			};
		}

		return {
			type: "note",
			icon: FiBookOpen,
			label: "Documentation",
			color: "#f59e0b",
		};
	}

	if (!code.trim()) {
		return {
			type: "code",
			icon: FiCode,
			label: "Empty",
			color: "#6b7280",
		};
	}

	// Simple heuristics for code visual representation
	const lowerCode = code.toLowerCase();

	if (
		lowerCode.includes("import pandas") ||
		lowerCode.includes("import numpy") ||
		lowerCode.includes("pd.") ||
		lowerCode.includes("np.")
	) {
		return {
			type: "data",
			icon: FiDatabase,
			label: "Data",
			color: "#10b981",
		};
	}
	if (
		lowerCode.includes("plt.") ||
		lowerCode.includes("matplotlib") ||
		lowerCode.includes("seaborn") ||
		lowerCode.includes("plot")
	) {
		return {
			type: "visualization",
			icon: FiBarChart,
			label: "Chart",
			color: "#8b5cf6",
		};
	}
	if (lowerCode.includes("def ")) {
		return {
			type: "code",
			icon: FiSettings,
			label: "Function",
			color: "#6b7280",
		};
	}
	if (
		lowerCode.includes("model") ||
		lowerCode.includes("train") ||
		lowerCode.includes("fit")
	) {
		return {
			type: "processing",
			icon: FiTrendingUp,
			label: "ML Model",
			color: "#2563eb",
		};
	}
	if (
		lowerCode.includes("read_csv") ||
		lowerCode.includes("read_excel") ||
		lowerCode.includes("load")
	) {
		return {
			type: "loading",
			icon: FiDatabase,
			label: "Load Data",
			color: "#059669",
		};
	}
	if (
		lowerCode.includes("filter") ||
		lowerCode.includes("query") ||
		lowerCode.includes("select")
	) {
		return {
			type: "processing",
			icon: FiFilter,
			label: "Filter",
			color: "#2563eb",
		};
	}
	if (lowerCode.includes("print(") || lowerCode.includes("display")) {
		return {
			type: "visualization",
			icon: FiEye,
			label: "Display",
			color: "#8b5cf6",
		};
	}

	return {
		type: "code",
		icon: FiCode,
		label: "Code",
		color: "#6b7280",
	};
}

function calculateNodePositions(
	cells: NotebookCell[]
): Array<{ x: number; y: number; cell: NotebookCell; index: number }> {
	const nodes: Array<{
		x: number;
		y: number;
		cell: NotebookCell;
		index: number;
	}> = [];
	const CELL_WIDTH = 120;
	const CELL_HEIGHT = 80;
	const START_X = 100;
	const START_Y = 100;
	const HORIZONTAL_SPACING = 200;
	const VERTICAL_SPACING = 120;

	cells.forEach((cell, index) => {
		const row = Math.floor(index / 3);
		const col = index % 3;

		const x = START_X + col * HORIZONTAL_SPACING;
		const y = START_Y + row * VERTICAL_SPACING;

		nodes.push({ x, y, cell, index });
	});

	return nodes;
}

function calculateConnections(
	nodes: Array<{ x: number; y: number; cell: NotebookCell; index: number }>
): Array<{
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	midX: number;
	midY: number;
}> {
	const edges: Array<{
		startX: number;
		startY: number;
		endX: number;
		endY: number;
		midX: number;
		midY: number;
	}> = [];

	for (let i = 0; i < nodes.length - 1; i++) {
		const current = nodes[i];
		const next = nodes[i + 1];

		// Simple sequential connection
		const startX = current.x + 60;
		const startY = current.y + 40;
		const endX = next.x + 60;
		const endY = next.y + 40;

		edges.push({
			startX,
			startY,
			endX,
			endY,
			midX: (startX + endX) / 2,
			midY: (startY + endY) / 2,
		});
	}

	return edges;
}

export const NotebookCanvas: React.FC<NotebookCanvasProps> = ({
	filePath,
	cells,
	cellStates,
	onOpenCell,
}) => {
	const [runningCells, setRunningCells] = useState<Set<number>>(new Set());
	const [hoveredNode, setHoveredNode] = useState<number | null>(null);

	useEffect(() => {
		const completeCleanup = EventManager.createManagedListener(
			"notebook-cell-run-complete",
			(event) => {
				const { filePath: eventPath, cellIndex } = event.detail || {};
				if (eventPath === filePath && typeof cellIndex === "number") {
					setRunningCells((prev) => {
						const next = new Set(prev);
						next.delete(cellIndex);
						return next;
					});
				}
			}
		);

		const stopCleanup = EventManager.createManagedListener(
			"notebook-cell-run-stopped",
			(event) => {
				const { filePath: eventPath, cellIndex } = event.detail || {};
				if (eventPath === filePath && typeof cellIndex === "number") {
					setRunningCells((prev) => {
						const next = new Set(prev);
						next.delete(cellIndex);
						return next;
					});
				}
			}
		);

		return () => {
			completeCleanup();
			stopCleanup();
		};
	}, [filePath]);

	const handleRunCell = useCallback(
		(index: number) => {
			setRunningCells((prev) => {
				const next = new Set(prev);
				next.add(index);
				return next;
			});
			try {
				EventManager.dispatchEvent("run-notebook-cell", {
					filePath,
					cellIndex: index,
				});
			} catch (error) {
				console.error("Failed to run notebook cell", error);
				setRunningCells((prev) => {
					const next = new Set(prev);
					next.delete(index);
					return next;
				});
			}
		},
		[filePath]
	);

	const handleStopCell = useCallback(
		(index: number) => {
			setRunningCells((prev) => {
				const next = new Set(prev);
				next.delete(index);
				return next;
			});
			try {
				EventManager.dispatchEvent("stop-notebook-cell", {
					filePath,
					cellIndex: index,
				});
			} catch (error) {
				console.error("Failed to stop notebook cell", error);
			}
		},
		[filePath]
	);

	const handleRunAll = useCallback(() => {
		cells.forEach((cell, index) => {
			if (cell.cell_type === "code") {
				handleRunCell(index);
			}
		});
	}, [cells, handleRunCell]);

	const handleAddCell = useCallback(
		(type: "code" | "markdown") => {
			EventManager.dispatchEvent("add-notebook-cell", {
				filePath,
				cellType: type,
				content: type === "markdown" ? "## Summary\n\n- " : "",
			});
		},
		[filePath]
	);

	// Calculate visual layout
	const nodes = useMemo(() => calculateNodePositions(cells), [cells]);
	const connections = useMemo(() => calculateConnections(nodes), [nodes]);

	// Type assertion to help TypeScript
	const typedNodes = nodes as Array<{
		x: number;
		y: number;
		cell: NotebookCell;
		index: number;
	}>;
	const typedConnections = connections as Array<{
		startX: number;
		startY: number;
		endX: number;
		endY: number;
		midX: number;
		midY: number;
	}>;

	if (cells.length === 0) {
		return (
			<CanvasContainer>
				<CanvasHeader>
					<CanvasTitle>Notebook Canvas</CanvasTitle>
					<CanvasControls>
						<ControlButton
							$variant="secondary"
							onClick={() => handleAddCell("code")}
						>
							<FiPlus size={16} />
							Add Code
						</ControlButton>
						<ControlButton
							$variant="secondary"
							onClick={() => handleAddCell("markdown")}
						>
							<FiEdit3 size={16} />
							Add Note
						</ControlButton>
					</CanvasControls>
				</CanvasHeader>
				<CanvasArea>
					<EmptyCanvas>
						<EmptyIcon>📊</EmptyIcon>
						<EmptyTitle>Your notebook is empty</EmptyTitle>
						<EmptyDescription>
							Start building your data analysis by adding code or markdown cells
							above.
						</EmptyDescription>
					</EmptyCanvas>
				</CanvasArea>
			</CanvasContainer>
		);
	}

	return (
		<CanvasContainer>
			<CanvasHeader>
				<CanvasTitle>Notebook Canvas</CanvasTitle>
				<CanvasControls>
					<ControlButton
						$variant="primary"
						onClick={handleRunAll}
						disabled={runningCells.size > 0}
					>
						<FiPlay size={16} />
						Run All
					</ControlButton>
					<ControlButton
						$variant="secondary"
						onClick={() => handleAddCell("code")}
					>
						<FiPlus size={16} />
						Add Code
					</ControlButton>
					<ControlButton
						$variant="secondary"
						onClick={() => handleAddCell("markdown")}
					>
						<FiEdit3 size={16} />
						Add Note
					</ControlButton>
				</CanvasControls>
			</CanvasHeader>

			<CanvasArea>
				{/* Render connections first (behind nodes) */}
				<FlowEdge>
					{typedConnections.map((edge, index) => (
						<g key={index}>
							<EdgePath
								d={`M ${edge.startX} ${edge.startY} Q ${edge.midX} ${
									edge.midY - 20
								} ${edge.endX} ${edge.endY}`}
							/>
							<EdgeArrow
								d={`M ${edge.endX - 8} ${edge.endY - 4} L ${edge.endX} ${
									edge.endY
								} L ${edge.endX - 8} ${edge.endY + 4}`}
							/>
						</g>
					))}
				</FlowEdge>

				{/* Render nodes */}
				{typedNodes.map((node) => {
					const code = extractCode(node.cell, cellStates[node.index]);
					const visualInfo = getCellVisualInfo(node.cell, code);
					const status = getCellStatus(node.cell, runningCells.has(node.index));
					const IconComponent = visualInfo.icon;

					return (
						<div key={node.index}>
							<FlowNode
								$x={node.x}
								$y={node.y}
								$type={visualInfo.type}
								$status={status}
								onMouseEnter={() => setHoveredNode(node.index)}
								onMouseLeave={() => setHoveredNode(null)}
								onClick={() => onOpenCell?.(node.index)}
							>
								<NodeIcon $color={visualInfo.color}>
									<IconComponent size={20} />
								</NodeIcon>
								<NodeLabel>{visualInfo.label}</NodeLabel>
								<NodeDescription>Cell {node.index + 1}</NodeDescription>
							</FlowNode>

							{/* Action buttons that appear on hover */}
							{hoveredNode === node.index && (
								<NodeActions>
									<ActionButton
										onClick={(e) => {
											e.stopPropagation();
											handleRunCell(node.index);
										}}
										disabled={
											node.cell.cell_type === "markdown" ||
											runningCells.has(node.index)
										}
									>
										<FiPlay size={12} />
										Run
									</ActionButton>
									{runningCells.has(node.index) && (
										<ActionButton
											onClick={(e) => {
												e.stopPropagation();
												handleStopCell(node.index);
											}}
										>
											<FiSquare size={12} />
											Stop
										</ActionButton>
									)}
									<ActionButton
										onClick={(e) => {
											e.stopPropagation();
											onOpenCell?.(node.index);
										}}
									>
										<FiEye size={12} />
										View
									</ActionButton>
								</NodeActions>
							)}
						</div>
					);
				})}
			</CanvasArea>
		</CanvasContainer>
	);
};

export default NotebookCanvas;
