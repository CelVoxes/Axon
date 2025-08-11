import React, { useState, useRef, useEffect, useMemo } from "react";
import Editor from "@monaco-editor/react";
import styled from "styled-components";
import {
	FiPlay,
	FiCopy,
	FiCheck,
	FiX,
	FiTrash2,
	FiChevronDown,
	FiChevronUp,
	FiDownload,
	FiEye,
	FiEyeOff,
	FiMessageSquare,
} from "react-icons/fi";
import { CellExecutionService } from "../../services/CellExecutionService";
import { ActionButton } from "@components/shared/StyledComponents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import hljs from "highlight.js";
import { typography } from "../../styles/design-system";
import { EventManager } from "../../utils/EventManager";
import { SHORTCUTS } from "../../utils/Constants";
import { ActionButton as SharedActionButton } from "@components/shared/StyledComponents";

const CellContainer = styled.div<{ $accentColor?: string }>`
	margin: 16px 0;
	border: 1px solid #404040;
	border-left: 4px solid ${(props) => props.$accentColor || "transparent"};
	border-radius: 8px;
	overflow: hidden;
	background: #1e1e1e;
`;

const FloatingToolbar = styled.div`
	position: absolute;
	display: flex;
	align-items: center;
	gap: 8px;
	background: #2d2d30;
	border: 1px solid #3c3c3c;
	border-radius: 6px;
	padding: 6px 8px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
	z-index: 5;
	white-space: nowrap;
`;

interface SelectionToolbarProps {
	editor: any | null;
	onAddToChat: () => void;
}

const MonacoSelectionToolbar: React.FC<SelectionToolbarProps> = ({
	editor,
	onAddToChat,
}) => {
	const [visible, setVisible] = useState(false);
	const [position, setPosition] = useState<{ left: number; top: number }>({
		left: 0,
		top: 0,
	});

	useEffect(() => {
		if (!editor) return;

		const updateFromSelection = () => {
			try {
				const selection = editor.getSelection?.();
				const model = editor.getModel?.();
				const hasSelection = !!selection && !selection.isEmpty?.();
				if (!hasSelection || !model) {
					setVisible(false);
					return;
				}
				const end = selection.getEndPosition();
				const layout = editor.getLayoutInfo?.();
				const editorDom = editor.getDomNode?.();
				const rect = editorDom?.getBoundingClientRect?.();
				const coords = editor.getScrolledVisiblePosition?.(end);
				if (!layout || !rect || !coords) {
					setVisible(false);
					return;
				}
				const left = rect.left + (coords.left ?? 0) + layout.contentLeft;
				const top = rect.top + (coords.top ?? 0) + (coords.height ?? 0) + 6;
				setPosition({ left, top });
				setVisible(true);
			} catch {
				setVisible(false);
			}
		};

		const disposables: any[] = [];
		disposables.push(editor.onDidChangeCursorSelection?.(updateFromSelection));
		disposables.push(editor.onDidScrollChange?.(updateFromSelection));
		// Update once on mount
		updateFromSelection();

		return () => {
			disposables.forEach((d) => d && d.dispose && d.dispose());
		};
	}, [editor]);

	if (!visible) return null;

	return (
		<div
			style={{
				position: "fixed",
				left: Math.max(8, position.left),
				top: Math.max(8, position.top),
				pointerEvents: "auto",
				zIndex: 9999,
			}}
		>
			<FloatingToolbar>
				<ActionButton onClick={onAddToChat} $variant="secondary">
					Add to Chat ({SHORTCUTS.ADD_TO_CHAT.accelerator})
				</ActionButton>
			</FloatingToolbar>
		</div>
	);
};

const CellHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background: #2d2d30;
	border-bottom: 1px solid #404040;
`;

const CellType = styled.div`
	font-size: ${typography.sm};
	color: #858585;
	font-weight: 500;
	display: flex;
	align-items: center;
	gap: 8px;
`;

const ExecutionIndicator = styled.div<{ $hasOutput: boolean }>`
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: ${(props) => (props.$hasOutput ? "#28a745" : "#6c757d")};
`;

const CellActions = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;
`;

// Using shared ActionButton component

const CodeInput = styled.textarea`
	width: 100%;
	min-height: 120px;
	background: #1e1e1e;
	border: none;
	color: #d4d4d4;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: ${typography.sm};
	line-height: 1.4;
	padding: 16px;
	resize: vertical;
	outline: none;

	&::placeholder {
		color: #858585;
	}
`;

const CellBody = styled.div`
	position: relative;
`;

const OutputContainer = styled.div`
	padding: 16px;
	background: #18181a;
	border-top: 1px solid #404040;
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

const OutputContent = styled.div`
	margin: 0;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: ${typography.base};
	line-height: 1.4;
	color: #d4d4d4;
	pre code {
		font-family: inherit;
		font-size: ${typography.sm};
	}
`;

const ErrorOutput = styled(OutputContent)`
	color: #ff6b6b;
	background: rgba(255, 107, 107, 0.1);
	border: 1px solid rgba(255, 107, 107, 0.3);
	border-radius: 6px;
	padding: 12px;
`;

const SuccessOutput = styled(OutputContent)`
	color: #51cf66;
`;

const DataTable = styled.div`
	overflow-x: auto;
	margin: 8px 0;
	border: 1px solid #404040;
	border-radius: 6px;
	background: #1e1e1e;
`;

const TableHeader = styled.div`
	display: flex;
	background: #2d2d30;
	border-bottom: 1px solid #404040;
	font-weight: 600;
	color: #ffffff;
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

const TableCell = styled.div<{ $isHeader?: boolean }>`
	padding: 8px 12px;
	border-right: 1px solid #404040;
	min-width: 120px;
	max-width: 200px;
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
		max-height: 400px;
		border-radius: 6px;
		border: 1px solid #404040;
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

const CollapsibleOutput = styled.div<{ $isCollapsed: boolean }>`
	max-height: ${(props) => (props.$isCollapsed ? "200px" : "none")};
	overflow: hidden;
	position: relative;

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
	}

	ul,
	ol {
		margin: 8px 0;
		padding-left: 20px;
	}

	li {
		margin: 4px 0;
	}
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

interface CodeCellProps {
	initialCode?: string;
	initialOutput?: string;
	language?: "python" | "r" | "markdown";
	workspacePath?: string;
	onExecute?: (code: string, output: string) => void;
	onCodeChange?: (code: string) => void;
	onDelete?: () => void;
	/** Optional: backing file path for this cell (when editing a .ipynb) */
	filePath?: string;
	/** Optional: index of this cell within the notebook (when editing a .ipynb) */
	cellIndex?: number;
}

export const CodeCell: React.FC<CodeCellProps> = ({
	initialCode = "",
	initialOutput = "",
	language = "python",
	workspacePath,
	onExecute,
	onCodeChange,
	onDelete,
	filePath,
	cellIndex,
}) => {
	const [code, setCode] = useState(initialCode);
	const [output, setOutput] = useState<string>(initialOutput);
	const [isExecuting, setIsExecuting] = useState(false);
	const [hasError, setHasError] = useState(false);
	const [copied, setCopied] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const monacoEditorRef = useRef<any>(null);

	// Sync local editor state when parent updates initialCode (e.g., after external edits)
	useEffect(() => {
		if (initialCode !== code) {
			setCode(initialCode);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialCode]);

	// Initialize CellExecutionService
	const cellExecutionService = useMemo(() => {
		return workspacePath ? new CellExecutionService(workspacePath) : null;
	}, [workspacePath]);

	// Using full highlight.js build; no manual registration needed

	// Accent color based on content
	const accentColor = useMemo(() => {
		if (hasError || /traceback|error|exception/i.test(output)) return "#ff6b6b";
		if (language === "markdown") return "#3b82f6"; // blue for markdown
		const lower = code.toLowerCase();
		if (/matplotlib|plt\.|seaborn|sns\.|plot|chart|figure/.test(lower))
			return "#a855f7"; // purple for viz
		if (/sklearn|xgboost|lightgbm|fit\(|predict\(|model/.test(lower))
			return "#f59e0b"; // orange for ml
		if (/pandas|dataframe|read_csv|read_table|read_parquet/.test(lower))
			return "#0ea5e9"; // cyan for data
		return "#404040";
	}, [code, output, hasError, language]);

	const executeCode = async () => {
		if (!code.trim() || language === "markdown" || !cellExecutionService)
			return;

		setIsExecuting(true);
		setOutput("");
		setHasError(false);

		try {
			console.log("Executing code in CodeCell:", code);

			// Use CellExecutionService instead of direct API call
			const result = await cellExecutionService.executeCell(
				`codecell-${Date.now()}`, // Generate a unique ID
				code,
				(updates) => {
					// Handle real-time updates if needed
					if (updates.output !== undefined) {
						setOutput(updates.output || "");
					}
					if (updates.hasError !== undefined) {
						setHasError(updates.hasError);
					}
				}
			);

			// Set final result
			if (result.status === "completed") {
				setOutput(result.output || "Code executed successfully");
				setHasError(false);
				onExecute?.(code, result.output || "");
			} else {
				setOutput(result.output || "Execution failed");
				setHasError(true);
				onExecute?.(code, result.output || "");
			}
		} catch (error) {
			console.error("Error executing code:", error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setOutput(`Error: ${errorMessage}`);
			setHasError(true);
			onExecute?.(code, errorMessage);
		} finally {
			setIsExecuting(false);
		}
	};

	const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		// Normalize CRLF to LF so markdown newlines render consistently
		const newCode = e.target.value.replace(/\r\n/g, "\n");
		setCode(newCode);
		onCodeChange?.(newCode);
	};

	const handleEditorChange = (value?: string) => {
		const normalized = (value ?? "").replace(/\r\n/g, "\n");
		setCode(normalized);
		onCodeChange?.(normalized);
	};

	const copyCode = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	const askChatToEditSelection = () => {
		let selectedText = "";
		// Default selection bounds assume entire code
		let selectionStart = 0;
		let selectionEnd = code.length;

		if (language === "markdown") {
			const el = textareaRef.current;
			if (el) {
				const start = el.selectionStart ?? 0;
				const end = el.selectionEnd ?? 0;
				selectionStart = Math.min(start, end);
				selectionEnd = Math.max(start, end);
				selectedText = code.substring(selectionStart, selectionEnd);
			}
		} else if (monacoEditorRef.current) {
			try {
				const editor = monacoEditorRef.current;
				const selection = editor.getSelection && editor.getSelection();
				if (selection && editor.getModel) {
					const model = editor.getModel();
					if (model && model.getValueInRange && model.getOffsetAt) {
						selectedText = model.getValueInRange(selection) || "";
						const startPos = selection.getStartPosition();
						const endPos = selection.getEndPosition();
						const startOffset = model.getOffsetAt(startPos);
						const endOffset = model.getOffsetAt(endPos);
						selectionStart = Math.min(startOffset, endOffset);
						selectionEnd = Math.max(startOffset, endOffset);
					}
				}
			} catch (_) {
				// ignore selection errors
			}
		}

		// Fallback to entire code if no explicit selection
		if (!selectedText || selectedText.trim().length === 0) {
			selectedText = code;
			selectionStart = 0;
			selectionEnd = code.length;
		}

		EventManager.dispatchEvent("chat-edit-selection", {
			filePath,
			cellIndex,
			selectedText,
			fullCode: code,
			selectionStart,
			selectionEnd,
			language,
		});
	};

	const clearOutput = () => {
		setOutput("");
		setHasError(false);
	};

	// Auto-resize textarea
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
		}
	}, [code]);

	return (
		<CellContainer $accentColor={accentColor}>
			<CellHeader>
				<CellType>
					<ExecutionIndicator $hasOutput={!!output} />
					{language.toUpperCase()}
				</CellType>
				<CellActions>
					{language !== "markdown" && (
						<>
							<ActionButton onClick={copyCode} $variant="secondary">
								{copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
								{copied ? "Copied" : "Copy"}
							</ActionButton>
							<ActionButton
								onClick={askChatToEditSelection}
								$variant="secondary"
							>
								<FiMessageSquare size={12} />
								Ask Chat
							</ActionButton>
							<ActionButton
								onClick={executeCode}
								$variant="primary"
								disabled={isExecuting || !code.trim()}
							>
								<FiPlay size={12} />
								{isExecuting ? "Running..." : "Run"}
							</ActionButton>
						</>
					)}
					{onDelete && (
						<ActionButton onClick={onDelete} $variant="danger">
							<FiTrash2 size={12} />
							Delete
						</ActionButton>
					)}
				</CellActions>
			</CellHeader>

			{/* Editable Markdown and Code with live preview for Markdown */}
			{language === "markdown" ? (
				<>
					<CodeInput
						ref={textareaRef}
						value={code}
						onChange={handleCodeChange}
						placeholder="Enter your markdown here..."
					/>
					<OutputContainer>
						<OutputHeader>
							<OutputTitle>📝 Preview</OutputTitle>
							<OutputActions>
								<ActionButton onClick={copyCode} $variant="secondary">
									{copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
									{copied ? "Copied" : "Copy"}
								</ActionButton>
							</OutputActions>
						</OutputHeader>
						<RichTextOutput>
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeHighlight as unknown as never]}
							>
								{code || ""}
							</ReactMarkdown>
						</RichTextOutput>
					</OutputContainer>
				</>
			) : (
				<>
					<CellBody style={{ borderTop: "1px solid #404040" }}>
						<Editor
							height="260px"
							value={code}
							onChange={handleEditorChange}
							language={language === "python" ? "python" : "plaintext"}
							theme="vs-dark"
							onMount={(editor, monaco) => {
								monacoEditorRef.current = editor;
								try {
									// Add editor command for Add to Chat
									editor.addAction({
										id: "add-to-chat",
										label: "Add to Chat",
										keybindings: monaco
											? [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL]
											: [],
										run: () => {
											askChatToEditSelection();
										},
									});
								} catch (_) {
									// ignore monaco addAction failures
								}
							}}
							options={{
								fontSize: 13,
								minimap: { enabled: false },
								scrollBeyondLastLine: false,
								wordWrap: "on",
								automaticLayout: true,
								tabSize: 4,
								renderWhitespace: "selection",
							}}
						/>
						{/* Floating toolbar near selection */}
						<MonacoSelectionToolbar
							editor={monacoEditorRef.current}
							onAddToChat={askChatToEditSelection}
						/>
					</CellBody>
					{output && <OutputRenderer output={output} hasError={hasError} />}
				</>
			)}
		</CellContainer>
	);
};

// Enhanced output parsing and rendering
const parseOutput = (output: string) => {
	try {
		// Try to parse as JSON first
		const parsed = JSON.parse(output);
		return { type: "json", data: parsed };
	} catch {
		// Check for common output patterns
		if (output.includes("DataFrame") || output.includes("pandas")) {
			return { type: "dataframe", data: output };
		}
		if (
			output.includes("matplotlib") ||
			output.includes("plot") ||
			output.includes("chart")
		) {
			return { type: "chart", data: output };
		}
		if (output.includes("data:image") || output.includes("base64")) {
			return { type: "image", data: output };
		}
		if (
			output.includes("```") ||
			output.includes("**") ||
			output.includes("#")
		) {
			return { type: "markdown", data: output };
		}
		return { type: "text", data: output };
	}
};

const renderDataFrame = (data: string) => {
	// Extract table data from DataFrame output
	const lines = data.split("\n");
	const tableData: string[][] = [];

	lines.forEach((line) => {
		if (line.trim() && !line.includes("DataFrame") && !line.includes("dtype")) {
			const cells = line.split(/\s+/).filter((cell) => cell.trim());
			if (cells.length > 1) {
				tableData.push(cells);
			}
		}
	});

	if (tableData.length === 0) return null;

	const headers = tableData[0];
	const rows = tableData.slice(1);

	return (
		<DataTable>
			<TableHeader>
				{headers.map((header, index) => (
					<TableCell key={index} $isHeader>
						{header}
					</TableCell>
				))}
			</TableHeader>
			{rows.map((row, rowIndex) => (
				<TableRow key={rowIndex}>
					{row.map((cell, cellIndex) => (
						<TableCell key={cellIndex}>{cell}</TableCell>
					))}
				</TableRow>
			))}
		</DataTable>
	);
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
	return null;
};

const renderMarkdown = (data: string) => {
	return (
		<RichTextOutput>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight as unknown as never]}
			>
				{data}
			</ReactMarkdown>
		</RichTextOutput>
	);
};

const OutputRenderer: React.FC<{ output: string; hasError: boolean }> = ({
	output,
	hasError,
}) => {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [showRaw, setShowRaw] = useState(true);

	const parsed = parseOutput(output);
	const outputLength = output.length;
	const lineCount = output.split("\n").length;

	const shouldCollapse = outputLength > 1000 || lineCount > 50;

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
		a.download = `output-${Date.now()}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const outputRef = useRef<HTMLElement | null>(null);

	// Highlight raw output when visible
	useEffect(() => {
		if (!showRaw) return;
		const el = outputRef.current as HTMLElement | null;
		if (!el) return;
		try {
			// Reset to plain text first to avoid nested markup and HLJS warnings
			el.textContent =
				parsed.type === "json" ? JSON.stringify(parsed.data, null, 2) : output;
			el.removeAttribute("data-highlighted");
			hljs.highlightElement(el);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("Highlight.js error:", e);
		}
	}, [showRaw, output, parsed]);

	if (hasError) {
		return (
			<ErrorOutput>
				<OutputStats>
					<StatItem>Error Output</StatItem>
					<StatItem>{outputLength} characters</StatItem>
					<StatItem>{lineCount} lines</StatItem>
				</OutputStats>
				<pre>
					<code
						ref={outputRef as unknown as React.RefObject<HTMLElement>}
						className="language-python"
					>
						{output}
					</code>
				</pre>
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

			<CollapsibleOutput $isCollapsed={isCollapsed && !showRaw}>
				{showRaw ? (
					<pre>
						<code
							ref={outputRef as unknown as React.RefObject<HTMLElement>}
							className={
								parsed.type === "json" ? "language-json" : "language-python"
							}
						>
							{parsed.type === "json"
								? JSON.stringify(parsed.data, null, 2)
								: output}
						</code>
					</pre>
				) : (
					<>
						{parsed.type === "dataframe" && renderDataFrame(parsed.data)}
						{parsed.type === "image" && renderImage(parsed.data)}
						{parsed.type === "markdown" && renderMarkdown(parsed.data)}
						{parsed.type === "json" && (
							<pre>
								<code className="language-json">
									{JSON.stringify(parsed.data, null, 2)}
								</code>
							</pre>
						)}
						{parsed.type === "text" && <pre>{parsed.data}</pre>}
					</>
				)}
			</CollapsibleOutput>

			{shouldCollapse && isCollapsed && !showRaw && (
				<ExpandButton onClick={() => setIsCollapsed(false)}>
					<FiChevronDown size={14} />
					Show more ({outputLength - 1000} more characters)
				</ExpandButton>
			)}
		</OutputContainer>
	);
};
