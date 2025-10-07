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
	FiMoreVertical,
	FiSquare,
} from "react-icons/fi";
import { CellExecutionService } from "../../services/notebook/CellExecutionService";
import { ActionButton } from "@components/shared/StyledComponents";
import { Tooltip } from "@components/shared/Tooltip";
import ReactMarkdown from "react-markdown";
import { sanitizeMarkdown } from "../../utils/MarkdownUtils";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import hljs from "highlight.js";
import { resolveHighlightLanguage } from "../../utils/highlight";
import { typography } from "../../styles/design-system";
import { SHORTCUTS } from "../../utils/Constants";
import rehypeSanitize from "rehype-sanitize";

const CellContainer = styled.div<{ $accentColor?: string }>`
	position: relative;
	margin: 16px 0;
	border: 1px solid #404040;
	border-left: 4px solid ${(props) => props.$accentColor || "transparent"};
	border-radius: 8px;
	overflow: visible; /* allow sticky header to position correctly */
	background: #1e1e1e;
	/* container keeps its top border to avoid layout shifts when header sticks */
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
	// Avoid losing click due to editor blur hiding the toolbar immediately
	const ignoreBlurRef = useRef(false);
	const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!editor) return;

		const updateFromSelection = () => {
			try {
				// Only show the toolbar for the actively focused editor
				const hasFocus = editor.hasTextFocus?.() ?? false;
				if (!hasFocus) {
					setVisible(false);
					return;
				}
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
		// React to editor focus/blur to avoid showing across multiple notebooks
		disposables.push(editor.onDidFocusEditorText?.(updateFromSelection));
		disposables.push(
			editor.onDidBlurEditorText?.(() => {
				// Delay hiding a tick to allow toolbar clicks to register
				if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = setTimeout(() => {
					if (!ignoreBlurRef.current) setVisible(false);
				}, 120);
			})
		);
		// Update once on mount
		updateFromSelection();

		return () => {
			if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
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
			onMouseDown={(e) => {
				// Interacting with toolbar should not immediately hide it
				ignoreBlurRef.current = true;
				// Reset shortly after to allow normal behavior next time
				setTimeout(() => (ignoreBlurRef.current = false), 200);
			}}
		>
			<FloatingToolbar>
				<ActionButton
					onClick={() => {
						try {
							onAddToChat();
						} finally {
							setVisible(false);
						}
					}}
					$variant="secondary"
				>
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
	padding: 6px 10px;
	background: #222222;
	border-bottom: 1px solid #404040;
	position: sticky;
	top: 0; /* stick to the very top of the notebook scroller */
	transform: translateY(-1px); /* overlap container top border without reflow */
	z-index: 2;
	cursor: grab; /* allow dragging from the header */
	user-select: none; /* avoid accidental text selection during drag */
`;

const CellType = styled.div`
	font-size: ${typography.xs};
	color: #858585;
	display: flex;
	align-items: center;
	gap: 4px;
`;

const CellIndexBadge = styled.button`
	background: #222222;
	color: #858585;
	border: 1px solid #404040;
	border-radius: 10px;
	padding: 0 6px;
	font-size: ${typography.xs};
	line-height: 18px;
	height: 18px;
	cursor: pointer;
	transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;

	&:hover {
		background: #374151;
		color: #e5e7eb;
		border-color: #4b5563;
	}
`;

// Left badge now sits inline inside header to avoid overlap

// Former drag handle removed; drag is handled by the header area now.

const ExecutionIndicator = styled.div<{
	$hasOutput: boolean;
	$hasError: boolean;
}>`
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: ${(props) =>
		props.$hasError ? "#ff6b6b" : props.$hasOutput ? "#28a745" : "#6c757d"};
`;

const CellActions = styled.div`
	display: flex;
	gap: 8px;
	align-items: center;

	/* Keep pointer cursor for controls inside draggable header */
	button,
	[role="button"],
	a {
		cursor: pointer;
	}
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

// Polished markdown input area for a nicer writing experience
const MarkdownInput = styled.textarea`
	width: 100%;
	min-height: 140px;
	background: #1a1b1e;
	border: 1px solid #30363d;
	color: #e6e6e6;
	font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
		Ubuntu, "Helvetica Neue", Arial, sans-serif;
	font-size: ${typography.base};
	line-height: 1.6;
	padding: 14px 16px;
	resize: vertical;
	outline: none;
	border-radius: 8px;

	&::placeholder {
		color: #8a8f98;
	}

	&:focus {
		border-color: #4b9ce6;
		box-shadow: 0 0 0 2px rgba(75, 156, 230, 0.15);
	}
`;

const CellBody = styled.div`
	position: relative;
	z-index: 1;
	padding-top: 8px; /* slight spacing to avoid header overlap without creating a gap */
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

const OverflowMenuContainer = styled.div`
	position: relative;
	display: inline-block;
`;

const OverflowMenu = styled.div`
	position: absolute;
	right: 0;
	top: 100%;
	background: #2d2d30;
	border: 1px solid #3c3c3c;
	border-radius: 6px;
	padding: 6px;
	z-index: 10;
	min-width: 180px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
`;

const OverflowItem = styled.button`
	width: 100%;
	background: none;
	border: none;
	color: #d4d4d4;
	text-align: left;
	padding: 8px 10px;
	border-radius: 4px;
	cursor: pointer;
	display: flex;
	gap: 8px;
	align-items: center;
	&:hover {
		background: rgba(255, 255, 255, 0.06);
	}
`;

const OutputContent = styled.div`
	margin: 0;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: ${typography.base};
	line-height: 1.4;
	color: #d4d4d4;

	/* Allow native wheel chaining so when this block reaches its scroll end, the parent notebook scrolls */
	overscroll-behavior: auto;
	overflow-y: auto;
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

const CollapsibleOutput = styled.div<{ $isCollapsed: boolean }>`
	max-height: ${(props) => (props.$isCollapsed ? "200px" : "none")};
	overflow: auto; /* allow internal scroll when collapsed */
	overscroll-behavior: auto; /* pass wheel to parent when at edge */
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

	&:hover {
		background: rgba(0, 122, 204, 0.1);
		border-radius: 4px;
	}
`;

const RichTextOutput = styled.div`
	color: #e6e6e6;
	line-height: 1.7;
	font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
		Ubuntu, "Helvetica Neue", Arial, sans-serif;

	/* Headings */
	h1,
	h2,
	h3,
	h4,
	h5,
	h6 {
		color: #ffffff;
		margin: 16px 0 10px 0;
		line-height: 1.3;
	}
	h1 {
		font-size: 1.6rem;
	}
	h2 {
		font-size: 1.4rem;
		padding-bottom: 6px;
		border-bottom: 1px solid #30363d;
	}
	h3 {
		font-size: 1.2rem;
	}

	/* Paragraphs & links */
	p {
		margin: 10px 0;
	}
	a {
		color: #7cc4ff;
		text-decoration: none;
	}
	a:hover {
		text-decoration: underline;
	}

	/* Inline code */
	code {
		background: #2a2f36;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid #3a3f47;
		font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
		font-size: ${typography.sm};
	}

	/* Code blocks */
	pre {
		background: #0f1115;
		padding: 12px;
		border-radius: 8px;
		border: 1px solid #30363d;
		overflow-x: auto;
		margin: 10px 0;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
	}

	/* Lists */
	ul,
	ol {
		margin: 10px 0;
		padding-left: 22px;
	}
	li {
		margin: 6px 0;
	}

	/* Blockquote */
	blockquote {
		margin: 10px 0;
		padding: 8px 12px;
		background: #1c1f24;
		border-left: 4px solid #3b82f6;
		border-radius: 6px;
		color: #cfd6df;
	}

	/* Tables */
	table {
		width: 100%;
		border-collapse: collapse;
		margin: 10px 0;
		border: 1px solid #30363d;
		border-radius: 6px;
		overflow: hidden;
	}
	th,
	td {
		border: 1px solid #30363d;
		padding: 8px 10px;
		text-align: left;
	}
	th {
		background: #23262b;
		color: #ffffff;
	}
	tr:nth-child(even) td {
		background: #1b1e22;
	}

	/* Images */
	img {
		max-width: 100%;
		height: auto;
		border-radius: 6px;
		border: 1px solid #30363d;
		margin: 8px 0;
	}

	/* Horizontal rule */
	hr {
		border: none;
		height: 1px;
		background: #30363d;
		margin: 14px 0;
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
	/** Optional: timestamp when chat last edited this cell */
	editedByChatAt?: string;
	/** Optional: drag events to support reordering */
	onDragStart?: (index: number, e: React.DragEvent) => void;
	onDragEnd?: () => void;
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
	editedByChatAt,
	onDragStart,
	onDragEnd,
}) => {
	const [code, setCode] = useState(initialCode);
	const [output, setOutput] = useState<string>(initialOutput);
	const [isExecuting, setIsExecuting] = useState(false);
	const [hasError, setHasError] = useState(false);
	const [copied, setCopied] = useState(false);
	const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(
		null
	);
	// Auto-growing editor height for better UX
	const [editorHeight, setEditorHeight] = useState<number>(260);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const monacoEditorRef = useRef<any>(null);

	// Initialize CellExecutionService
	const cellExecutionService = useMemo(() => {
		return workspacePath ? new CellExecutionService(workspacePath) : null;
	}, [workspacePath]);

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

	const stopExecution = () => {
		if (currentExecutionId && cellExecutionService) {
			cellExecutionService.stopExecution(currentExecutionId);
			// Also call the Jupyter interrupt for good measure
			try {
				window.electronAPI?.interruptJupyter?.(workspacePath);
			} catch (_) {}
		}
	};

	const executeCode = async () => {
		if (!code.trim() || language === "markdown" || !cellExecutionService)
			return;

		const executionId = `codecell-${Date.now()}`;
		setCurrentExecutionId(executionId);
		setIsExecuting(true);
		setOutput("");
		setHasError(false);

		try {
			// Use CellExecutionService instead of direct API call
			const result = await cellExecutionService.executeCell(
				executionId,
				code,
				(updates) => {
					// Handle real-time updates if needed
					if (updates.output !== undefined) {
						setOutput(updates.output || "");
					}
					if (updates.hasError !== undefined) {
						setHasError(updates.hasError);
					}
				},
				language as any // pass through current cell language ('python' | 'r')
			);

			// Set final result
			if (result.status === "completed") {
				setOutput(result.output || "Code executed successfully");
				setHasError(false);
				onExecute?.(code, result.output || "");
			} else if (result.status === "cancelled") {
				setOutput(result.output || "Execution was cancelled");
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
			setCurrentExecutionId(null);
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

		// Compute 1-based line numbers for the current selection
		const beforeSelection = code.slice(0, selectionStart);
		const startLine = (beforeSelection.match(/\n/g)?.length ?? 0) + 1;
		const lineCount = selectedText.split(/\r?\n/).length;
		const endLine = startLine + lineCount - 1;

		// Build a mention like: @relative/path.ipynb#N lines S-E
		const relPath = filePath
			? workspacePath && filePath.startsWith(workspacePath)
				? filePath.slice(workspacePath.length + 1)
				: filePath
			: "";
		const cellSuffix = typeof cellIndex === "number" ? `#${cellIndex + 1}` : "";
		const mention = `@${relPath}${cellSuffix} lines ${startLine}-${endLine}`;
		try {
			// 1) Fire a rich edit-selection event so Chat pre-fills and
			//    sets codeEditContext for inline edit in Agent mode
			const editEvt = new CustomEvent("chat-edit-selection", {
				detail: {
					filePath: filePath || undefined,
					cellIndex: typeof cellIndex === "number" ? cellIndex : undefined,
					language,
					selectedText,
					fullCode: code,
					selectionStart,
					selectionEnd,
				},
			});
			window.dispatchEvent(editEvt);

			// 2) Also insert a lightweight mention for display/context
			const mentionEvt = new CustomEvent("chat-insert-mention", {
				detail: {
					alias: mention,
					filePath: filePath || undefined,
				},
			});
			window.dispatchEvent(mentionEvt);
		} catch (_) {
			// ignore
		}
	};

	const insertCellMentionIntoChat = () => {
		try {
			const event = new CustomEvent("chat-insert-mention", {
				detail: {
					alias:
						typeof cellIndex === "number" ? `#${cellIndex + 1}` : undefined,
					filePath,
				},
			});
			window.dispatchEvent(event);
		} catch (_) {
			// ignore
		}
	};

	const addOutputToChat = () => {
		try {
			const event = new CustomEvent("chat-add-output", {
				detail: {
					filePath,
					cellIndex,
					language,
					code,
					output,
					hasError,
				},
			});
			window.dispatchEvent(event);
		} catch {
			// ignore
		}
	};

	const fixErrorWithChat = () => {
		try {
			const event = new CustomEvent("chat-fix-error", {
				detail: {
					filePath,
					cellIndex,
					language,
					code,
					output,
				},
			});
			window.dispatchEvent(event);
		} catch {
			// ignore
		}
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

	// Global keyboard shortcut for Add-to-Chat (Cmd+L on macOS, Ctrl+L on others)
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const isMac = navigator.platform.toLowerCase().includes("mac");
			const trigger =
				(isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "l";
			if (!trigger) return;
			// Only handle when this cell editor or markdown textarea has focus
			const editorHasFocus = !!monacoEditorRef.current?.hasTextFocus?.();
			const mdHasFocus =
				textareaRef.current === (document.activeElement as any);
			if (!editorHasFocus && !mdHasFocus) return;
			e.preventDefault();
			e.stopPropagation();
			askChatToEditSelection();
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, [code, language]);

	// Sync local editor state when parent updates initialCode (e.g., after external edits)
	useEffect(() => {
		if (initialCode !== code) {
			setCode(initialCode);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialCode]);
	return (
		<CellContainer $accentColor={accentColor}>
			<CellHeader
				{...(typeof cellIndex === "number"
					? {
							draggable: true,
							onDragStart: (e: React.DragEvent) => {
								if (!onDragStart || typeof cellIndex !== "number") return;
								const target = e.target as HTMLElement | null;
								// Block drag when starting from interactive controls or editors
								if (
									target?.closest(
										'button, [role="button"], a, input, textarea, select, .monaco-editor'
									)
								) {
									e.preventDefault();
									return;
								}
								onDragStart(cellIndex, e);
							},
							onDragEnd: () => onDragEnd && onDragEnd(),
					  }
					: {})}
			>
				<CellType>
					{/* Drag can be initiated from anywhere on the header now */}
					{typeof cellIndex === "number" && (
						<CellIndexBadge
							onClick={insertCellMentionIntoChat}
							title="Insert cell number into chat"
						>
							#{cellIndex + 1}
						</CellIndexBadge>
					)}
					<ExecutionIndicator $hasOutput={!!output} $hasError={hasError} />
					{language.toUpperCase()}
				</CellType>
				<CellActions>
					{language !== "markdown" && (
						<>
							<Tooltip
								content="Send selected code to Chat for help"
								placement="bottom"
							>
								<ActionButton
									onClick={askChatToEditSelection}
									$variant="secondary"
								>
									<FiMessageSquare size={12} />
									Ask Chat
								</ActionButton>
							</Tooltip>
							<ActionButton
								onClick={isExecuting ? undefined : executeCode}
								$variant="primary"
								disabled={isExecuting || !code.trim()}
							>
								<FiPlay size={12} />
								{isExecuting ? (
									<span
										style={{
											display: "flex",
											alignItems: "center",
											gap: "6px",
										}}
									>
										<div
											style={{
												width: "8px",
												height: "8px",
												color: "green",
												borderRadius: "50%",
												backgroundColor: "currentColor",
												animation: "pulse 1.5s ease-in-out infinite",
											}}
										/>
									</span>
								) : (
									"Run"
								)}
							</ActionButton>
							{isExecuting && (
								<ActionButton $variant="secondary" onClick={stopExecution}>
									<FiSquare size={12} /> Stop
								</ActionButton>
							)}
						</>
					)}
					{onDelete && (
						<ActionButton onClick={onDelete} $variant="danger">
							<FiTrash2 size={12} />
						</ActionButton>
					)}
				</CellActions>
			</CellHeader>
			{editedByChatAt && (
				<div
					style={{
						padding: "6px 12px",
						background: "#1f2a37",
						borderBottom: "1px solid #253041",
						color: "#93c5fd",
						fontSize: "11px",
					}}
				>
					Edited by Chat • {new Date(editedByChatAt).toLocaleString()}
				</div>
			)}

			{/* Editable Markdown and Code with live preview for Markdown */}
			{language === "markdown" ? (
				<>
					<MarkdownInput
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
								rehypePlugins={[
									rehypeSanitize as unknown as never,
									rehypeHighlight as unknown as never,
								]}
							>
								{sanitizeMarkdown(code || "")}
							</ReactMarkdown>
						</RichTextOutput>
					</OutputContainer>
				</>
			) : (
				<>
					<CellBody style={{ borderTop: "1px solid #404040" }}>
						<Editor
							height={editorHeight}
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
									// Auto-grow height with content
									const updateHeight = () => {
										try {
											const contentHeight =
												(editor as any).getContentHeight?.() ||
												editor.getScrollHeight?.() ||
												editorHeight;
											const minH = 160;
											const maxH = 900;
											const next = Math.max(
												minH,
												Math.min(maxH, contentHeight + 20)
											);
											setEditorHeight(next);
											const layoutInfo = editor.getLayoutInfo?.();
											if (layoutInfo) {
												editor.layout({
													width: layoutInfo.width,
													height: next,
												});
											}
										} catch {
											// ignore
										}
									};
									// Initial and on content size change
									updateHeight();
									const d1 = (editor as any).onDidContentSizeChange?.(
										updateHeight
									);
									// Store disposables on the editor instance for cleanup
									(editor as any)._axon_disposables = [d1].filter(Boolean);
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
								lineNumbers: "on",
								smoothScrolling: true,
								scrollbar: {
									alwaysConsumeMouseWheel: false,
									vertical: "visible",
									horizontal: "visible",
									verticalScrollbarSize: 8,
									horizontalScrollbarSize: 8,
									useShadows: false,
								},
							}}
						/>
						{/* Floating toolbar near selection */}
						<MonacoSelectionToolbar
							editor={monacoEditorRef.current}
							onAddToChat={askChatToEditSelection}
						/>
					</CellBody>
					{output && (
						<OutputRenderer
							output={output}
							hasError={hasError}
							// Ask Chat from output should send both output and code of this cell
							onAddOutputToChat={addOutputToChat}
							onFixErrorWithChat={hasError ? fixErrorWithChat : undefined}
							language={language}
							onClearOutput={clearOutput}
						/>
					)}
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
				rehypePlugins={[
					rehypeSanitize as unknown as never,
					rehypeHighlight as unknown as never,
				]}
			>
				{sanitizeMarkdown(data)}
			</ReactMarkdown>
		</RichTextOutput>
	);
};

const OutputRenderer: React.FC<{
	output: string;
	hasError: boolean;
	onAddOutputToChat?: () => void;
	onFixErrorWithChat?: () => void;
	onClearOutput?: () => void;
	language?: "python" | "r" | "markdown";
}> = ({
	output,
	hasError,
	onAddOutputToChat,
	onFixErrorWithChat,
	onClearOutput,
	language = "python",
}) => {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [showRaw, setShowRaw] = useState(true);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const parsed = parseOutput(output);
	const outputLength = output.length;
	const lineCount = output.split("\n").length;
	const extraChars = Math.max(0, outputLength - 1000);
	const extraLines = Math.max(0, lineCount - 50);
	const moreLabel =
		outputLength > 1000
			? `${extraChars} more characters`
			: `${extraLines} more lines`;

	const languageClass = language === "r" ? "language-r" : "language-python";

	const shouldCollapse = outputLength > 1000 || lineCount > 50;

	// Initialize collapsed state based on content size
	useEffect(() => {
		setIsCollapsed(shouldCollapse);
	}, [shouldCollapse]);

	// Close overflow menu on outside click
	useEffect(() => {
		if (!menuOpen) return;
		const onDocClick = (e: MouseEvent) => {
			if (!menuRef.current) return;
			if (!menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [menuOpen]);

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
			const rawLanguage =
				parsed.type === "json"
					? "json"
					: language === "r"
					? "r"
					: "python";
			const { language: highlightLanguage, didFallback } = resolveHighlightLanguage(
				rawLanguage
			);
			el.className = `hljs language-${highlightLanguage}`;
			el.removeAttribute("data-highlighted");
			if (didFallback && rawLanguage) {
				el.setAttribute("data-language-fallback", rawLanguage);
			} else {
				el.removeAttribute("data-language-fallback");
			}
			hljs.highlightElement(el);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("Highlight.js error:", e);
		}
	}, [showRaw, output, parsed, language]);

	return (
		<OutputContainer>
			<OutputHeader>
				<OutputTitle>
					{hasError && "❌ Error Output"}
					{!hasError && parsed.type === "dataframe" && "📊 Data Table"}
					{!hasError && parsed.type === "chart" && "📈 Chart"}
					{!hasError && parsed.type === "image" && "🖼️ Image"}
					{!hasError && parsed.type === "markdown" && "📝 Rich Text"}
					{!hasError && parsed.type === "json" && "🔧 JSON"}
					{!hasError && parsed.type === "text" && "📄 Output"}
				</OutputTitle>
				<OutputActions>
					{onAddOutputToChat && (
						<ActionButton onClick={onAddOutputToChat} $variant="secondary">
							<FiMessageSquare size={12} />
							Ask Chat
						</ActionButton>
					)}
					<OverflowMenuContainer ref={menuRef}>
						<ActionButton
							aria-label="More actions"
							$variant="secondary"
							onClick={() => setMenuOpen((v) => !v)}
						>
							<FiMoreVertical size={12} />
						</ActionButton>
						{menuOpen && (
							<OverflowMenu>
								<OverflowItem
									onClick={() => {
										copyOutput();
										setMenuOpen(false);
									}}
								>
									<FiCopy size={12} /> Copy output
								</OverflowItem>
								<OverflowItem
									onClick={() => {
										setShowRaw(!showRaw);
										setMenuOpen(false);
									}}
								>
									{showRaw ? <FiEyeOff size={12} /> : <FiEye size={12} />}{" "}
									{showRaw ? "Hide raw" : "Show raw"}
								</OverflowItem>
								<OverflowItem
									onClick={() => {
										downloadOutput();
										setMenuOpen(false);
									}}
								>
									<FiDownload size={12} /> Download
								</OverflowItem>
								{/* Clear output moved outside as a separate button */}
								{shouldCollapse && (
									<OverflowItem
										onClick={() => {
											setIsCollapsed(!isCollapsed);
											setMenuOpen(false);
										}}
									>
										{isCollapsed ? (
											<FiChevronDown size={12} />
										) : (
											<FiChevronUp size={12} />
										)}{" "}
										{isCollapsed ? "Expand" : "Collapse"}
									</OverflowItem>
								)}
							</OverflowMenu>
						)}
					</OverflowMenuContainer>
					{onClearOutput && (
						<ActionButton
							style={{ marginLeft: "auto" }}
							aria-label="Clear output"
							onClick={onClearOutput}
							$variant="secondary"
						>
							<FiX size={12} />
						</ActionButton>
					)}
				</OutputActions>
			</OutputHeader>

			<OutputStats>
				<StatItem>{outputLength} characters</StatItem>
				<StatItem>{lineCount} lines</StatItem>
				<StatItem>{hasError ? "error" : `${parsed.type} format`}</StatItem>
			</OutputStats>

			<CollapsibleOutput $isCollapsed={shouldCollapse && isCollapsed}>
				{hasError ? (
					<ErrorOutput>
						<pre>
							<code
								ref={outputRef as unknown as React.RefObject<HTMLElement>}
								className={languageClass}
							>
								{output}
							</code>
						</pre>
					</ErrorOutput>
				) : showRaw ? (
					<pre>
						<code
							ref={outputRef as unknown as React.RefObject<HTMLElement>}
							className={
								parsed.type === "json" ? "language-json" : languageClass
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

			{shouldCollapse && isCollapsed && (
				<ExpandButton onClick={() => setIsCollapsed(false)}>
					<FiChevronDown size={14} />
					Show more ({moreLabel})
				</ExpandButton>
			)}
		</OutputContainer>
	);
};
