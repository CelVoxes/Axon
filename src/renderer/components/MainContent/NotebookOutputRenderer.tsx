import React, { useState, useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import styled from "styled-components";
import {
	FiCopy,
	FiDownload,
	FiEye,
	FiEyeOff,
	FiChevronDown,
	FiChevronUp,
	FiMaximize2,
	FiMinimize2,
} from "react-icons/fi";
import { ActionButton } from "@components/shared/StyledComponents";
import { typography } from "../../styles/design-system";

const OutputContainer = styled.div`
	padding: 16px;
	background: #18181a;
	border-top: 1px solid #404040;
	border-radius: 0 0 8px 8px;
`;

const OutputHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
`;

const OutputTitle = styled.div`
	font-size: ${typography.sm};
	color: #858585;
	font-weight: 500;
	display: flex;
	align-items: center;
	gap: 8px;
`;

const OutputActions = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;
`;

const OutputStats = styled.div`
	display: flex;
	gap: 16px;
	margin-bottom: 8px;
	font-size: ${typography.xs};
	color: #858585;
`;

const StatItem = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
`;

const ErrorOutput = styled.div`
	color: #ff6b6b;
	background: rgba(255, 107, 107, 0.1);
	border: 1px solid rgba(255, 107, 107, 0.3);
	border-radius: 6px;
	padding: 12px;
	margin: 8px 0;
`;

const SuccessOutput = styled.div`
	color: #51cf66;
	background: rgba(81, 207, 102, 0.1);
	border: 1px solid rgba(81, 207, 102, 0.3);
	border-radius: 6px;
	padding: 12px;
	margin: 8px 0;
`;

const DataTable = styled.div`
	overflow-x: auto;
	margin: 8px 0;
	border: 1px solid #404040;
	border-radius: 6px;
	background: #1e1e1e;
	max-height: 400px;
	overflow-y: auto;
`;

const TableHeader = styled.div`
	display: flex;
	background: #2d2d30;
	border-bottom: 1px solid #404040;
	font-weight: 600;
	color: #ffffff;
	position: sticky;
	top: 0;
	z-index: 1;
`;

const TableRow = styled.div`
	display: flex;
	border-bottom: 1px solid #404040;

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: rgba(255, 255, 255, 0.05);
	}
`;

const TableCell = styled.div<{ $isHeader?: boolean; $width?: string }>`
	padding: 8px 12px;
	border-right: 1px solid #404040;
	min-width: ${(props) => props.$width || "120px"};
	max-width: ${(props) => props.$width || "200px"};
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: ${typography.sm};
	color: ${(props) => (props.$isHeader ? "#ffffff" : "#d4d4d4")};

	&:last-child {
		border-right: none;
	}
`;

const ImageOutput = styled.div`
	margin: 8px 0;
	text-align: center;

	img {
		max-width: 100%;
		max-height: 500px;
		border-radius: 6px;
		border: 1px solid #404040;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
	}
`;

const ChartContainer = styled.div`
	margin: 8px 0;
	padding: 16px;
	background: #1e1e1e;
	border: 1px solid #404040;
	border-radius: 6px;
	text-align: center;
`;

const CollapsibleOutput = styled.div<{
	$isCollapsed: boolean;
	$maxHeight?: string;
}>`
	max-height: ${(props) =>
		props.$isCollapsed ? props.$maxHeight || "300px" : "none"};
	overflow: hidden;
	position: relative;
	transition: max-height 0.3s ease;

	${(props) =>
		props.$isCollapsed &&
		`
		&::after {
			content: '';
			position: absolute;
			bottom: 0;
			left: 0;
			right: 0;
			height: 40px;
			background: linear-gradient(transparent, #18181a);
			pointer-events: none;
		}
	`}
`;

const FullscreenModal = styled.div<{ $isFullscreen: boolean }>`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.95);
	z-index: 1000;
	display: ${(props) => (props.$isFullscreen ? "flex" : "none")};
	flex-direction: column;
	padding: 20px;

	${OutputContainer} {
		flex: 1;
		margin: 0;
		max-height: none;
		overflow-y: auto;
	}
`;

const FullscreenContent = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 20px;
	background: #18181a;
	border-radius: 8px;
	margin-top: 10px;
`;

const ExpandButton = styled.button`
	background: none;
	border: none;
	color: #007acc;
	cursor: pointer;
	padding: 4px 8px;
	font-size: ${typography.sm};
	display: flex;
	align-items: center;
	gap: 4px;
	margin-top: 8px;

	&:hover {
		background: rgba(0, 122, 204, 0.1);
		border-radius: 4px;
	}
`;

const RichTextOutput = styled.div`
	color: #d4d4d4;
	line-height: 1.6;

	h1,
	h2,
	h3,
	h4,
	h5,
	h6 {
		color: #ffffff;
		margin: 16px 0 8px 0;
	}

	p {
		margin: 8px 0;
	}

	code {
		background: rgba(255, 255, 255, 0.1);
		padding: 2px 4px;
		border-radius: 3px;
		font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	}

	pre {
		background: #1e1e1e;
		padding: 12px;
		border-radius: 6px;
		overflow-x: auto;
		margin: 8px 0;
		border: 1px solid #404040;
	}

	ul,
	ol {
		margin: 8px 0;
		padding-left: 20px;
	}

	li {
		margin: 4px 0;
	}

	blockquote {
		border-left: 4px solid #007acc;
		padding-left: 16px;
		margin: 16px 0;
		color: #858585;
	}

	table {
		border-collapse: collapse;
		width: 100%;
		margin: 8px 0;
	}

	th,
	td {
		border: 1px solid #404040;
		padding: 8px;
		text-align: left;
	}

	th {
		background: #2d2d30;
		color: #ffffff;
	}
`;

const ProgressBar = styled.div`
	width: 100%;
	height: 8px;
	background: #404040;
	border-radius: 4px;
	overflow: hidden;
	margin: 8px 0;
`;

const ProgressFill = styled.div<{ $progress: number; $color?: string }>`
	height: 100%;
	background: ${(props) => props.$color || "#007acc"};
	width: ${(props) => props.$progress}%;
	transition: width 0.3s ease;
`;

const MetricCard = styled.div`
	background: #2d2d30;
	border: 1px solid #404040;
	border-radius: 6px;
	padding: 16px;
	margin: 8px 0;
	text-align: center;
`;

const MetricValue = styled.div`
	font-size: 24px;
	font-weight: 600;
	color: #ffffff;
	margin-bottom: 4px;
`;

const MetricLabel = styled.div`
	font-size: ${typography.sm};
	color: #858585;
`;

const CodeBlock = styled.pre`
	background: #1e1e1e;
	border: 1px solid #404040;
	border-radius: 6px;
	padding: 12px;
	overflow-x: auto;
	margin: 8px 0;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: ${typography.sm};
	color: #d4d4d4;
`;

const WarningOutput = styled.div`
	color: #ffd43b;
	background: rgba(255, 212, 59, 0.1);
	border: 1px solid rgba(255, 212, 59, 0.3);
	border-radius: 6px;
	padding: 12px;
	margin: 8px 0;
`;

const InfoOutput = styled.div`
	color: #74c0fc;
	background: rgba(116, 192, 252, 0.1);
	border: 1px solid rgba(116, 192, 252, 0.3);
	border-radius: 6px;
	padding: 12px;
	margin: 8px 0;
`;

interface NotebookOutputRendererProps {
	output: string;
	hasError?: boolean;
	outputType?:
		| "text"
		| "dataframe"
		| "chart"
		| "image"
		| "markdown"
		| "json"
		| "progress"
		| "metrics"
		| "error"
		| "success"
		| "warning"
		| "info";
}

export const NotebookOutputRenderer: React.FC<NotebookOutputRendererProps> = ({
	output,
	hasError = false,
	outputType,
}) => {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [showRaw, setShowRaw] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const parsed = useMemo(
		() => parseOutput(output, outputType),
		[output, outputType]
	);
	const outputLength = output.length;
	const lineCount = output.split("\n").length;

	const shouldCollapse = outputLength > 1000 || lineCount > 50;

	// Set initial collapsed state
	useEffect(() => {
		setIsCollapsed(shouldCollapse);
	}, [shouldCollapse]);

	const copyOutput = async () => {
		try {
			await navigator.clipboard.writeText(output);
		} catch (error) {
			console.error("Failed to copy output:", error);
		}
	};

	const downloadOutput = () => {
		const blob = new Blob([output], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `notebook-output-${Date.now()}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const renderContent = () => {
		if (showRaw) {
			return <CodeBlock>{output}</CodeBlock>;
		}

		switch (parsed.type) {
			case "dataframe":
				return renderDataFrame(parsed.data);
			case "image":
				return renderImage(parsed.data);
			case "chart":
				return renderChart(parsed.data);
			case "markdown":
				return renderMarkdown(parsed.data);
			case "json":
				return renderJSON(parsed.data);
			case "progress":
				return renderProgress(parsed.data);
			case "metrics":
				return renderMetrics(parsed.data);
			case "error":
				return (
					<ErrorOutput>
						<pre>{parsed.data}</pre>
					</ErrorOutput>
				);
			case "success":
				return (
					<SuccessOutput>
						<pre>{parsed.data}</pre>
					</SuccessOutput>
				);
			case "warning":
				return (
					<WarningOutput>
						<pre>{parsed.data}</pre>
					</WarningOutput>
				);
			case "info":
				return (
					<InfoOutput>
						<pre>{parsed.data}</pre>
					</InfoOutput>
				);
			default:
				return <CodeBlock>{parsed.data}</CodeBlock>;
		}
	};

	if (hasError) {
		return (
			<ErrorOutput>
				<OutputStats>
					<StatItem>❌ Error Output</StatItem>
					<StatItem>{outputLength} characters</StatItem>
					<StatItem>{lineCount} lines</StatItem>
				</OutputStats>
				<pre>{output}</pre>
			</ErrorOutput>
		);
	}

	return (
		<OutputContainer>
			<OutputHeader>
				<OutputTitle>
					{parsed.type === "dataframe" && "📊 Data Table"}
					{parsed.type === "chart" && "📈 Chart"}
					{parsed.type === "image" && "🖼️ Image"}
					{parsed.type === "markdown" && "📝 Rich Text"}
					{parsed.type === "json" && "🔧 JSON"}
					{parsed.type === "progress" && "⏳ Progress"}
					{parsed.type === "metrics" && "📊 Metrics"}
					{parsed.type === "error" && "❌ Error"}
					{parsed.type === "success" && "✅ Success"}
					{parsed.type === "warning" && "⚠️ Warning"}
					{parsed.type === "info" && "ℹ️ Info"}
					{parsed.type === "text" && "📄 Output"}
				</OutputTitle>
				<OutputActions>
					<ActionButton onClick={copyOutput} $variant="secondary">
						<FiCopy size={12} />
						Copy
					</ActionButton>
					{shouldCollapse && (
						<ActionButton
							onClick={() => setIsCollapsed(!isCollapsed)}
							$variant="secondary"
						>
							{isCollapsed ? (
								<FiChevronDown size={12} />
							) : (
								<FiChevronUp size={12} />
							)}
							{isCollapsed ? "Expand" : "Collapse"}
						</ActionButton>
					)}
					<ActionButton
						onClick={() => setShowRaw(!showRaw)}
						$variant="secondary"
					>
						{showRaw ? <FiEyeOff size={12} /> : <FiEye size={12} />}
						{showRaw ? "Hide Raw" : "Show Raw"}
					</ActionButton>
					<ActionButton
						onClick={() => setIsFullscreen(!isFullscreen)}
						$variant="secondary"
					>
						{isFullscreen ? (
							<FiMinimize2 size={12} />
						) : (
							<FiMaximize2 size={12} />
						)}
						{isFullscreen ? "Minimize" : "Fullscreen"}
					</ActionButton>
					<ActionButton onClick={downloadOutput} $variant="secondary">
						<FiDownload size={12} />
						Download
					</ActionButton>
				</OutputActions>
			</OutputHeader>

			<OutputStats>
				<StatItem>{outputLength} characters</StatItem>
				<StatItem>{lineCount} lines</StatItem>
				<StatItem>{parsed.type} format</StatItem>
			</OutputStats>

			{isFullscreen ? (
				<FullscreenModal $isFullscreen={isFullscreen}>
					<OutputHeader>
						<OutputTitle>
							{parsed.type === "dataframe" && "📊 Data Table"}
							{parsed.type === "chart" && "📈 Chart"}
							{parsed.type === "image" && "🖼️ Image"}
							{parsed.type === "markdown" && "📝 Rich Text"}
							{parsed.type === "json" && "🔧 JSON"}
							{parsed.type === "progress" && "⏳ Progress"}
							{parsed.type === "metrics" && "📊 Metrics"}
							{parsed.type === "error" && "❌ Error"}
							{parsed.type === "success" && "✅ Success"}
							{parsed.type === "warning" && "⚠️ Warning"}
							{parsed.type === "info" && "ℹ️ Info"}
							{parsed.type === "text" && "📄 Output"} - Fullscreen
						</OutputTitle>
						<OutputActions>
							<ActionButton onClick={copyOutput} $variant="secondary">
								<FiCopy size={12} />
								Copy
							</ActionButton>
							<ActionButton
								onClick={() => setShowRaw(!showRaw)}
								$variant="secondary"
							>
								{showRaw ? <FiEyeOff size={12} /> : <FiEye size={12} />}
								{showRaw ? "Hide Raw" : "Show Raw"}
							</ActionButton>
							<ActionButton
								onClick={() => setIsFullscreen(false)}
								$variant="secondary"
							>
								<FiMinimize2 size={12} />
								Exit Fullscreen
							</ActionButton>
							<ActionButton onClick={downloadOutput} $variant="secondary">
								<FiDownload size={12} />
								Download
							</ActionButton>
						</OutputActions>
					</OutputHeader>
					<FullscreenContent>{renderContent()}</FullscreenContent>
				</FullscreenModal>
			) : (
				<CollapsibleOutput
					$isCollapsed={shouldCollapse && isCollapsed}
					$maxHeight="300px"
				>
					{renderContent()}
				</CollapsibleOutput>
			)}

			{shouldCollapse && isCollapsed && !isFullscreen && (
				<ExpandButton onClick={() => setIsCollapsed(false)}>
					<FiChevronDown size={14} />
					Show more ({outputLength - 1000} more characters)
				</ExpandButton>
			)}
		</OutputContainer>
	);
};

// Enhanced output parsing with better detection
const parseOutput = (output: string, outputType?: string) => {
	// If outputType is provided, use it
	if (outputType) {
		return { type: outputType, data: output };
	}

	try {
		// Try to parse as JSON first
		const parsed = JSON.parse(output);
		return { type: "json", data: parsed };
	} catch {
		// Check for specific output patterns
		const lowerOutput = output.toLowerCase();

		if (
			lowerOutput.includes("dataframe") ||
			lowerOutput.includes("pandas") ||
			(lowerOutput.includes("index") && lowerOutput.includes("columns"))
		) {
			return { type: "dataframe", data: output };
		}

		if (
			lowerOutput.includes("matplotlib") ||
			lowerOutput.includes("plot") ||
			lowerOutput.includes("chart") ||
			lowerOutput.includes("figure")
		) {
			return { type: "chart", data: output };
		}

		if (
			lowerOutput.includes("data:image") ||
			lowerOutput.includes("base64") ||
			lowerOutput.includes("png") ||
			lowerOutput.includes("jpg") ||
			lowerOutput.includes("jpeg")
		) {
			return { type: "image", data: output };
		}

		if (
			lowerOutput.includes("progress") ||
			lowerOutput.includes("%") ||
			lowerOutput.includes("completed") ||
			lowerOutput.includes("processing")
		) {
			return { type: "progress", data: output };
		}

		if (
			lowerOutput.includes("accuracy") ||
			lowerOutput.includes("precision") ||
			lowerOutput.includes("recall") ||
			lowerOutput.includes("f1") ||
			lowerOutput.includes("score") ||
			lowerOutput.includes("metric")
		) {
			return { type: "metrics", data: output };
		}

		if (
			lowerOutput.includes("error") ||
			lowerOutput.includes("exception") ||
			lowerOutput.includes("traceback") ||
			lowerOutput.includes("failed")
		) {
			return { type: "error", data: output };
		}

		if (
			lowerOutput.includes("success") ||
			lowerOutput.includes("completed") ||
			lowerOutput.includes("finished") ||
			lowerOutput.includes("done")
		) {
			return { type: "success", data: output };
		}

		if (
			lowerOutput.includes("warning") ||
			lowerOutput.includes("deprecated") ||
			lowerOutput.includes("deprecation")
		) {
			return { type: "warning", data: output };
		}

		if (
			lowerOutput.includes("info") ||
			lowerOutput.includes("note") ||
			lowerOutput.includes("information")
		) {
			return { type: "info", data: output };
		}

		if (
			output.includes("```") ||
			output.includes("**") ||
			output.includes("#") ||
			(output.includes("[") && output.includes("]("))
		) {
			return { type: "markdown", data: output };
		}

		return { type: "text", data: output };
	}
};

const renderDataFrame = (data: string) => {
	// Enhanced DataFrame parsing with better error handling
	try {
		const lines = data.split("\n");
		const tableData: string[][] = [];

		lines.forEach((line) => {
			if (
				line.trim() &&
				!line.includes("DataFrame") &&
				!line.includes("dtype") &&
				!line.includes("memory usage") &&
				!line.includes("RangeIndex") &&
				!line.includes("...") &&
				!line.includes("rows ×")
			) {
				const cells = line.split(/\s+/).filter((cell) => cell.trim());
				if (cells.length > 1) {
					tableData.push(cells);
				}
			}
		});

		if (tableData.length === 0) return <CodeBlock>{data}</CodeBlock>;

		const headers = tableData[0];
		const rows = tableData.slice(1);

		// Validate table structure
		if (!headers || headers.length === 0) {
			return <CodeBlock>{data}</CodeBlock>;
		}

		// Calculate column widths based on content
		const columnWidths = headers.map((_, colIndex) => {
			const maxLength = Math.max(
				headers[colIndex]?.length || 0,
				...rows.map((row) => row[colIndex]?.length || 0)
			);
			return Math.min(Math.max(maxLength * 8, 80), 300) + "px";
		});

		return (
			<DataTable>
				<TableHeader>
					{headers.map((header, index) => (
						<TableCell key={index} $isHeader $width={columnWidths[index]}>
							{header || ""}
						</TableCell>
					))}
				</TableHeader>
				{rows.map((row, rowIndex) => (
					<TableRow key={rowIndex}>
						{headers.map((_, cellIndex) => (
							<TableCell key={cellIndex} $width={columnWidths[cellIndex]}>
								{row[cellIndex] || ""}
							</TableCell>
						))}
					</TableRow>
				))}
			</DataTable>
		);
	} catch (error) {
		console.error("Error rendering DataFrame:", error);
		return <CodeBlock>{data}</CodeBlock>;
	}
};

const renderImage = (data: string) => {
	// Extract base64 image data
	const match = data.match(/data:image\/[^;]+;base64,([^"]+)/);
	if (match) {
		return (
			<ImageOutput>
				<img src={match[0]} alt="Generated plot" />
			</ImageOutput>
		);
	}

	// Check for file paths
	const fileMatch = data.match(/\.(png|jpg|jpeg|gif|svg)$/i);
	if (fileMatch) {
		return (
			<ImageOutput>
				<img src={data} alt="Generated plot" />
			</ImageOutput>
		);
	}

	return <CodeBlock>{data}</CodeBlock>;
};

const renderChart = (data: string) => {
	return (
		<ChartContainer>
			<div>📈 Chart Output</div>
			<CodeBlock>{data}</CodeBlock>
		</ChartContainer>
	);
};

const renderMarkdown = (data: string) => {
	return (
		<RichTextOutput>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
			>
				{data}
			</ReactMarkdown>
		</RichTextOutput>
	);
};

const renderJSON = (data: any) => {
	return <CodeBlock>{JSON.stringify(data, null, 2)}</CodeBlock>;
};

const renderProgress = (data: string) => {
	// Extract progress percentage
	const progressMatch = data.match(/(\d+(?:\.\d+)?)%/);
	const progress = progressMatch ? parseFloat(progressMatch[1]) : 0;

	return (
		<div>
			<ProgressBar>
				<ProgressFill $progress={progress} />
			</ProgressBar>
			<div style={{ textAlign: "center", marginTop: "8px" }}>
				{progress.toFixed(1)}% Complete
			</div>
			<CodeBlock>{data}</CodeBlock>
		</div>
	);
};

const renderMetrics = (data: string) => {
	// Extract metrics from output
	const metrics: { [key: string]: number } = {};
	const metricMatches = data.match(/(\w+):\s*([\d.]+)/g);

	if (metricMatches) {
		metricMatches.forEach((match) => {
			const [key, value] = match.split(": ");
			metrics[key] = parseFloat(value);
		});
	}

	return (
		<div>
			{Object.entries(metrics).map(([key, value]) => (
				<MetricCard key={key}>
					<MetricValue>{value.toFixed(4)}</MetricValue>
					<MetricLabel>{key}</MetricLabel>
				</MetricCard>
			))}
			<CodeBlock>{data}</CodeBlock>
		</div>
	);
};
