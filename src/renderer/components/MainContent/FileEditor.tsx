import React, { useState, useEffect } from "react";
import styled from "styled-components";
import Editor from "@monaco-editor/react";
import { CodeCell } from "./CodeCell";
import { FiPlus, FiTrash2 } from "react-icons/fi";

const EditorContainer = styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
`;

const EditorHeader = styled.div`
	height: 30px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	font-size: 12px;
	color: #cccccc;
`;

const EditorContent = styled.div`
	flex: 1;

	.monaco-editor {
		background-color: #1e1e1e !important;
	}
`;

const NotebookContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 16px;
	background: #1e1e1e;

	/* Add some spacing between cells */
	> * + * {
		margin-top: 8px;
	}
`;

const NotebookHeader = styled.div`
	margin-bottom: 24px;
	padding: 16px;
	background: #2d2d30;
	border-radius: 8px;
	border: 1px solid #404040;
`;

const NotebookTitle = styled.h1`
	margin: 0 0 8px 0;
	color: #ffffff;
	font-size: 20px;
	font-weight: 600;
`;

const NotebookMetadata = styled.div`
	color: #858585;
	font-size: 12px;
	line-height: 1.4;
`;

const NotebookActions = styled.div`
	display: flex;
	gap: 8px;
	margin-top: 12px;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" }>`
	background: ${(props) =>
		props.$variant === "primary" ? "#007acc" : "#404040"};
	border: none;
	border-radius: 4px;
	color: #ffffff;
	padding: 6px 12px;
	font-size: 12px;
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

interface FileEditorProps {
	filePath: string;
}

interface NotebookCell {
	cell_type: "code" | "markdown";
	source: string[];
	metadata: any;
	execution_count?: number | null;
	outputs?: any[];
}

interface NotebookData {
	cells: NotebookCell[];
	metadata: {
		kernelspec?: {
			display_name: string;
			language: string;
			name: string;
		};
		language_info?: {
			name: string;
			version: string;
		};
	};
	nbformat: number;
	nbformat_minor: number;
}

export const FileEditor: React.FC<FileEditorProps> = ({ filePath }) => {
	const [content, setContent] = useState<string>("");
	const [notebookData, setNotebookData] = useState<NotebookData | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [hasChanges, setHasChanges] = useState(false);
	const [cellStates, setCellStates] = useState<{
		[key: number]: { code: string; output: string };
	}>({});

	useEffect(() => {
		loadFile();
	}, [filePath]);

	const loadFile = async () => {
		try {
			setIsLoading(true);
			const fileContent = await window.electronAPI.readFile(filePath);

			// Check if it's a .ipynb file
			if (filePath.endsWith(".ipynb")) {
				try {
					const notebook = JSON.parse(fileContent);
					setNotebookData(notebook);
					setContent(""); // Clear content for notebook view
				} catch (parseError) {
					console.error("Error parsing notebook:", parseError);
					setContent(
						`// Error parsing notebook: ${
							parseError instanceof Error
								? parseError.message
								: String(parseError)
						}`
					);
					setNotebookData(null);
				}
			} else {
				setContent(fileContent);
				setNotebookData(null);
			}

			setHasChanges(false);
		} catch (error) {
			console.error("Error loading file:", error);
			setContent(
				`// Error loading file: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			setNotebookData(null);
		} finally {
			setIsLoading(false);
		}
	};

	const saveFile = async () => {
		try {
			if (filePath.endsWith(".ipynb") && notebookData) {
				// Reconstruct the notebook with updated cell states
				const updatedNotebook = {
					...notebookData,
					cells: notebookData.cells.map((cell, index) => {
						const cellState = cellStates[index];
						if (cellState) {
							return {
								...cell,
								source: [cellState.code],
								outputs: cellState.output
									? [
											{
												output_type: "stream",
												name: "stdout",
												text: [cellState.output],
											},
									  ]
									: [],
							};
						}
						return cell;
					}),
				};
				await window.electronAPI.writeFile(
					filePath,
					JSON.stringify(updatedNotebook, null, 2)
				);
			} else {
				await window.electronAPI.writeFile(filePath, content);
			}
			setHasChanges(false);
		} catch (error) {
			console.error("Error saving file:", error);
		}
	};

	const addCell = (cellType: "code" | "markdown" = "code") => {
		if (!notebookData) return;

		const newCell: NotebookCell = {
			cell_type: cellType,
			source: [cellType === "markdown" ? "# New Cell\n" : "# New code cell\n"],
			metadata: {},
			execution_count: null,
			outputs: [],
		};

		const updatedNotebook = {
			...notebookData,
			cells: [...notebookData.cells, newCell],
		};

		setNotebookData(updatedNotebook);
		setHasChanges(true);
	};

	const deleteCell = (index: number) => {
		if (!notebookData) return;

		// Simple confirmation dialog
		if (!confirm(`Are you sure you want to delete cell ${index + 1}?`)) {
			return;
		}

		const updatedCells = notebookData.cells.filter((_, i) => i !== index);
		const updatedNotebook = {
			...notebookData,
			cells: updatedCells,
		};

		// Update cell states to remove the deleted cell
		const updatedCellStates = { ...cellStates };
		delete updatedCellStates[index];
		// Shift down all cell states after the deleted index
		Object.keys(updatedCellStates).forEach((key) => {
			const keyNum = parseInt(key);
			if (keyNum > index) {
				updatedCellStates[keyNum - 1] = updatedCellStates[keyNum];
				delete updatedCellStates[keyNum];
			}
		});

		setNotebookData(updatedNotebook);
		setCellStates(updatedCellStates);
		setHasChanges(true);
	};

	const updateCellCode = (index: number, code: string) => {
		setCellStates((prev) => ({
			...prev,
			[index]: { ...prev[index], code },
		}));
		setHasChanges(true);
	};

	const updateCellOutput = (index: number, output: string) => {
		setCellStates((prev) => ({
			...prev,
			[index]: { ...prev[index], output },
		}));
		setHasChanges(true);
	};

	const handleEditorChange = (value: string | undefined) => {
		if (value !== undefined) {
			setContent(value);
			setHasChanges(true);
		}
	};

	const getLanguage = (filePath: string): string => {
		const extension = filePath.split(".").pop()?.toLowerCase();
		switch (extension) {
			case "py":
				return "python";
			case "r":
				return "r";
			case "js":
				return "javascript";
			case "ts":
				return "typescript";
			case "json":
				return "json";
			case "md":
				return "markdown";
			case "yml":
			case "yaml":
				return "yaml";
			case "sh":
				return "shell";
			case "sql":
				return "sql";
			default:
				return "plaintext";
		}
	};

	const renderNotebook = () => {
		if (!notebookData) return null;

		const workspacePath = filePath.substring(0, filePath.lastIndexOf("/"));

		return (
			<NotebookContainer>
				<NotebookHeader>
					<NotebookTitle>{filePath.split("/").pop()}</NotebookTitle>
					<NotebookMetadata>
						{notebookData.metadata.kernelspec && (
							<div>Kernel: {notebookData.metadata.kernelspec.display_name}</div>
						)}
						{notebookData.metadata.language_info && (
							<div>
								Language: {notebookData.metadata.language_info.name}{" "}
								{notebookData.metadata.language_info.version}
							</div>
						)}
						<div>Cells: {notebookData.cells.length}</div>
					</NotebookMetadata>
				</NotebookHeader>

				{notebookData.cells.map((cell, index) => {
					const cellContent = Array.isArray(cell.source)
						? cell.source.join("")
						: typeof cell.source === "string"
						? cell.source
						: "";

					// Extract output from cell if it exists
					let cellOutput = "";
					if (cell.outputs && cell.outputs.length > 0) {
						cellOutput = cell.outputs
							.map((output: any) => {
								if (output.output_type === "stream") {
									return output.text?.join("") || "";
								} else if (output.output_type === "execute_result") {
									return output.data?.["text/plain"]?.join("") || "";
								} else if (output.output_type === "error") {
									return `Error: ${output.ename}: ${output.evalue}`;
								}
								return "";
							})
							.join("\n");
					}

					// Get current cell state (code and output)
					const currentCellState = cellStates[index] || {
						code: cellContent,
						output: cellOutput,
					};

					return (
						<CodeCell
							key={index}
							initialCode={currentCellState.code}
							initialOutput={currentCellState.output}
							language={cell.cell_type === "markdown" ? "markdown" : "python"}
							workspacePath={workspacePath}
							onExecute={(code, output) => {
								console.log(`Cell ${index} executed:`, { code, output });
								updateCellCode(index, code);
								updateCellOutput(index, output);
							}}
							onCodeChange={(code) => {
								updateCellCode(index, code);
							}}
							onDelete={() => deleteCell(index)}
						/>
					);
				})}

				{/* Add cell buttons at the bottom */}
				<div
					style={{
						marginTop: "16px",
						display: "flex",
						gap: "8px",
						justifyContent: "center",
					}}
				>
					<ActionButton onClick={() => addCell("code")} $variant="primary">
						<FiPlus size={12} />
						Add Code Cell
					</ActionButton>
					<ActionButton
						onClick={() => addCell("markdown")}
						$variant="secondary"
					>
						<FiPlus size={12} />
						Add Markdown Cell
					</ActionButton>
				</div>
			</NotebookContainer>
		);
	};

	const fileName = filePath.split("/").pop() || filePath;

	if (isLoading) {
		return (
			<EditorContainer>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						height: "100%",
						color: "#858585",
					}}
				>
					Loading {fileName}...
				</div>
			</EditorContainer>
		);
	}

	return (
		<EditorContainer>
			<EditorHeader>
				{fileName} {hasChanges && "(modified)"}
				{hasChanges && (
					<button
						onClick={saveFile}
						style={{
							marginLeft: "auto",
							background: "#0e639c",
							border: "none",
							color: "white",
							padding: "2px 8px",
							borderRadius: "2px",
							fontSize: "11px",
							cursor: "pointer",
						}}
					>
						Save
					</button>
				)}
			</EditorHeader>

			{filePath.endsWith(".ipynb") && notebookData ? (
				renderNotebook()
			) : (
				<EditorContent>
					<Editor
						height="100%"
						language={getLanguage(filePath)}
						theme="vs-dark"
						value={content}
						onChange={handleEditorChange}
						options={{
							minimap: { enabled: false },
							fontSize: 13,
							lineNumbers: "on",
							wordWrap: "on",
							automaticLayout: true,
							scrollBeyondLastLine: false,
							renderWhitespace: "selection",
							tabSize: 2,
						}}
					/>
				</EditorContent>
			)}
		</EditorContainer>
	);
};
