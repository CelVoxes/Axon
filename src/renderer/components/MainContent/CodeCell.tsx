import React, { useState, useRef, useEffect } from "react";
import styled from "styled-components";
import { FiPlay, FiCopy, FiCheck, FiX, FiTrash2 } from "react-icons/fi";

const CellContainer = styled.div`
	margin: 16px 0;
	border: 1px solid #404040;
	border-radius: 8px;
	overflow: hidden;
	background: #1e1e1e;
`;

const CellHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background: #2d2d30;
	border-bottom: 1px solid #404040;
`;

const CellType = styled.div`
	font-size: 12px;
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

const ActionButton = styled.button<{
	$variant?: "primary" | "secondary" | "success" | "danger";
}>`
	background: ${(props) => {
		switch (props.$variant) {
			case "primary":
				return "#007acc";
			case "success":
				return "#28a745";
			case "danger":
				return "#dc3545";
			default:
				return "#404040";
		}
	}};
	border: none;
	border-radius: 4px;
	color: #ffffff;
	padding: 4px 8px;
	font-size: 12px;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;
	transition: all 0.2s ease;

	&:hover {
		opacity: 0.8;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const CodeInput = styled.textarea`
	width: 100%;
	min-height: 120px;
	background: #1e1e1e;
	border: none;
	color: #d4d4d4;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: 14px;
	line-height: 1.4;
	padding: 16px;
	resize: vertical;
	outline: none;

	&::placeholder {
		color: #858585;
	}
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
	margin-bottom: 8px;
`;

const OutputTitle = styled.div`
	font-size: 12px;
	color: #858585;
	font-weight: 500;
`;

const OutputContent = styled.pre`
	margin: 0;
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: 13px;
	line-height: 1.4;
	color: #d4d4d4;
	white-space: pre-wrap;
	word-break: break-word;
`;

const ErrorOutput = styled(OutputContent)`
	color: #ff6b6b;
`;

const SuccessOutput = styled(OutputContent)`
	color: #51cf66;
`;

interface CodeCellProps {
	initialCode?: string;
	initialOutput?: string;
	language?: "python" | "r" | "markdown";
	workspacePath?: string;
	onExecute?: (code: string, output: string) => void;
	onCodeChange?: (code: string) => void;
	onDelete?: () => void;
}

export const CodeCell: React.FC<CodeCellProps> = ({
	initialCode = "",
	initialOutput = "",
	language = "python",
	workspacePath,
	onExecute,
	onCodeChange,
	onDelete,
}) => {
	const [code, setCode] = useState(initialCode);
	const [output, setOutput] = useState<string>(initialOutput);
	const [isExecuting, setIsExecuting] = useState(false);
	const [hasError, setHasError] = useState(false);
	const [copied, setCopied] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const executeCode = async () => {
		if (!code.trim() || language === "markdown") return;

		setIsExecuting(true);
		setOutput("");
		setHasError(false);

		try {
			console.log("Executing code in CodeCell:", code);
			const result = await window.electronAPI.executeJupyterCode(
				code,
				workspacePath
			);

			if (result.success) {
				setOutput(result.output || "Code executed successfully");
				setHasError(false);
				onExecute?.(code, result.output || "");
			} else {
				setOutput(result.error || "Execution failed");
				setHasError(true);
				onExecute?.(code, result.error || "");
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
		const newCode = e.target.value;
		setCode(newCode);
		onCodeChange?.(newCode);
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
		<CellContainer>
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

			{language === "markdown" ? (
				<div
					style={{
						padding: "16px",
						color: "#ffffff",
						fontSize: "14px",
						lineHeight: "1.6",
						whiteSpace: "pre-wrap",
					}}
				>
					{code}
				</div>
			) : (
				<>
					<CodeInput
						ref={textareaRef}
						value={code}
						onChange={handleCodeChange}
						placeholder={`Enter your ${language} code here...`}
					/>

					{output && (
						<OutputContainer>
							<OutputHeader>
								<span style={{ color: hasError ? "#ff6b6b" : "#4ecdc4" }}>
									{hasError ? "Error" : "Output"}
								</span>
								<ActionButton onClick={clearOutput} $variant="secondary">
									<FiX size={12} />
									Clear
								</ActionButton>
							</OutputHeader>
							<pre
								style={{
									margin: 0,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									color: hasError ? "#ff6b6b" : "#ffffff",
									fontSize: "13px",
									lineHeight: "1.4",
								}}
							>
								{output}
							</pre>
						</OutputContainer>
					)}
				</>
			)}
		</CellContainer>
	);
};
