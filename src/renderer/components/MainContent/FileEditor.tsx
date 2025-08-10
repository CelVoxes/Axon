import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import Editor from "@monaco-editor/react";
import { CodeCell } from "./CodeCell";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { ActionButton } from "@components/shared/StyledComponents";
import { useWorkspaceContext } from "../../context/AppContext";
import { typography } from "../../styles/design-system";
import { EventManager } from "../../utils/EventManager";

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
	font-size: ${typography.sm};
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
	font-size: ${typography["2xl"]};
	font-weight: 600;
`;

const NotebookMetadata = styled.div`
	color: #858585;
	font-size: ${typography.sm};
	line-height: 1.4;
`;

const NotebookActions = styled.div`
	display: flex;
	gap: 8px;
	margin-top: 12px;
`;

// Using shared ActionButton component

// Inline insert controls (top and between cells)
const InsertButtonsRow = styled.div`
	display: flex;
	gap: 8px;
	justify-content: center;
	align-items: center;
	margin: 8px 0;
`;

const InsertCellButton = styled.button`
	padding: 8px 10px;
	background: transparent;
	border: 1px dashed #404040;
	border-radius: 4px;
	color: #cccccc;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	font-size: ${typography.sm};
	transition: all 0.2s ease;
	opacity: 0.7;

	&:hover {
		background: #2d2d30;
		color: #ffffff;
		border-color: #007acc;
		opacity: 1;
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
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [hasChanges, setHasChanges] = useState<boolean>(false);
	const [cellStates, setCellStates] = useState<
		Array<{ code: string; output: string }>
	>([]);
	const [cellIds, setCellIds] = useState<string[]>([]);

	// Use a ref to track the current notebook data to avoid closure issues in event handlers
	const notebookDataRef = useRef<NotebookData | null>(null);
	const isReadyRef = useRef<boolean>(false);

	// Update the ref whenever notebookData changes
	useEffect(() => {
		notebookDataRef.current = notebookData;
		isReadyRef.current = !!notebookData;
	}, [notebookData]);

	// Get workspace context at the top level to avoid React hooks warning
	const { state: workspaceState } = useWorkspaceContext();
	// Prefer the directory of the currently open file (e.g., the notebook folder)
	// Fallback to the globally selected workspace if filePath has no parent
	const fileDirectory = filePath.includes("/")
		? filePath.substring(0, filePath.lastIndexOf("/"))
		: undefined;
	const workspacePath: string | undefined =
		fileDirectory || workspaceState.currentWorkspace || undefined;

	// Queue for events that arrive before notebookData is loaded
	const [pendingEvents, setPendingEvents] = useState<
		Array<{
			type: string;
			detail: any;
			timestamp: number;
		}>
	>([]);

	useEffect(() => {
		loadFile();
		// Clear pending events when file path changes
		if (pendingEvents.length > 0) {
			console.log(
				`FileEditor: Clearing ${pendingEvents.length} pending events due to file path change to ${filePath}`
			);
		}
		setPendingEvents([]);
	}, [filePath]);

	// Normalize editor text to ipynb "source" array form (one string per line, keep trailing newlines)
	const toIpynbSource = (text: string): string[] => {
		const lines = text.split("\n");
		return lines.map((line, idx) =>
			idx < lines.length - 1 ? `${line}\n` : line
		);
	};

	// Stable keys for cells to avoid React reusing wrong instances when inserting/deleting
	const generateCellId = () =>
		`nbcell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	// Function to process pending events
	const processPendingEvents = () => {
		const currentNotebookData = notebookDataRef.current;
		if (currentNotebookData && pendingEvents.length > 0) {
			console.log(
				`FileEditor: Processing ${pendingEvents.length} pending events for ${filePath}`
			);

			pendingEvents.forEach((pendingEvent) => {
				console.log(
					`FileEditor: Processing pending event: ${pendingEvent.type}`
				);
				// Re-dispatch the event to be handled by the current handlers
				const event = new CustomEvent(pendingEvent.type, {
					detail: pendingEvent.detail,
				});
				window.dispatchEvent(event);
			});

			setPendingEvents([]);
		}
	};

	// Function to save notebook to file
	const saveNotebookToFile = async (notebook: NotebookData) => {
		try {
			if (!window.electronAPI || !window.electronAPI.writeFile) {
				console.error("Electron API not available for writing files");
				return;
			}

			await window.electronAPI.writeFile(
				filePath,
				JSON.stringify(notebook, null, 2)
			);
			console.log("FileEditor: Notebook auto-saved successfully");
		} catch (error) {
			console.error("FileEditor: Error auto-saving notebook:", error);
		}
	};

	// Add event listeners for notebook cell events
	useEffect(() => {
		const handleAddNotebookCell = async (event: CustomEvent) => {
			const {
				filePath: eventFilePath,
				cellType,
				content: cellContent,
			} = event.detail;

			// Only handle events for the current notebook file
			if (eventFilePath === filePath && filePath.endsWith(".ipynb")) {
				console.log(
					"FileEditor: Received add-notebook-cell event for current file:",
					{
						filePath: eventFilePath,
						cellType,
						contentLength: cellContent?.length || 0,
					}
				);

				// Use the ref to get the current notebook data
				const currentNotebookData = notebookDataRef.current;
				const isReady = isReadyRef.current;

				if (currentNotebookData && isReady) {
					// Create new cell in Jupyter notebook format
					const newCell: NotebookCell = {
						cell_type: cellType,
						source: toIpynbSource(cellContent),
						metadata: {},
						execution_count: null,
						outputs: [],
					};

					// Add cell to notebook data
					const updatedNotebook = {
						...currentNotebookData,
						cells: [...currentNotebookData.cells, newCell],
					};

					setNotebookData(updatedNotebook);
					setCellIds((prev) => [...prev, generateCellId()]);
					setHasChanges(true);

					// Auto-save the notebook and dispatch success event after completion
					try {
						await saveNotebookToFile(updatedNotebook);
						EventManager.dispatchEvent("notebook-cell-added", {
							filePath: eventFilePath,
							cellType,
							success: true,
						});
					} catch (error) {
						console.error(
							"FileEditor: Failed to save notebook after adding cell:",
							error
						);
						EventManager.dispatchEvent("notebook-cell-added", {
							filePath: eventFilePath,
							cellType,
							success: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				} else {
					// Queue the event for later processing
					console.log(
						`FileEditor: Queuing add-notebook-cell event (notebookData not ready: ${!currentNotebookData}, isReady: ${isReady}) for ${filePath}`
					);
					setPendingEvents((prev) => [
						...prev,
						{
							type: "add-notebook-cell",
							detail: event.detail,
							timestamp: Date.now(),
						},
					]);
				}
			}
		};

		const handleUpdateNotebookCell = async (event: CustomEvent) => {
			const { filePath: eventFilePath, cellIndex, output } = event.detail;

			// Only handle events for the current notebook file
			if (eventFilePath === filePath && filePath.endsWith(".ipynb")) {
				console.log(
					"FileEditor: Received update-notebook-cell event for current file:",
					{
						filePath: eventFilePath,
						cellIndex,
						outputLength: output?.length || 0,
					}
				);

				// Use the ref to get the current notebook data
				const currentNotebookData = notebookDataRef.current;
				const isReady = isReadyRef.current;

				// Handle -1 index for last cell
				let actualCellIndex = cellIndex;
				if (cellIndex === -1 && currentNotebookData) {
					actualCellIndex = currentNotebookData.cells.length - 1;
				}

				if (
					currentNotebookData &&
					isReady &&
					actualCellIndex >= 0 &&
					actualCellIndex < currentNotebookData.cells.length
				) {
					// Update cell output
					const updatedCells = [...currentNotebookData.cells];
					updatedCells[actualCellIndex] = {
						...updatedCells[actualCellIndex],
						outputs: output
							? [
									{
										output_type: "stream",
										name: "stdout",
										text: [output],
									},
							  ]
							: [],
					};

					const updatedNotebook = {
						...currentNotebookData,
						cells: updatedCells,
					};

					setNotebookData(updatedNotebook);
					setHasChanges(true);

					// Auto-save the notebook and dispatch success event after completion
					try {
						await saveNotebookToFile(updatedNotebook);
						EventManager.dispatchEvent("notebook-cell-updated", {
							filePath: eventFilePath,
							cellIndex: actualCellIndex,
							success: true,
						});
					} catch (error) {
						console.error(
							"FileEditor: Failed to save notebook after updating cell output:",
							error
						);
						EventManager.dispatchEvent("notebook-cell-updated", {
							filePath: eventFilePath,
							cellIndex: actualCellIndex,
							success: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				} else if (!currentNotebookData || !isReady) {
					// Queue the event for later processing
					console.log(
						`FileEditor: Queuing update-notebook-cell event (notebookData not ready: ${!currentNotebookData}, isReady: ${isReady}) for ${filePath}`
					);
					setPendingEvents((prev) => [
						...prev,
						{
							type: "update-notebook-cell",
							detail: event.detail,
							timestamp: Date.now(),
						},
					]);
				}
			}
		};

		const handleUpdateNotebookCellCode = async (event: CustomEvent) => {
			const { filePath: eventFilePath, cellIndex, code } = event.detail;

			// Only handle events for the current notebook file
			if (eventFilePath === filePath && filePath.endsWith(".ipynb")) {
				console.log(
					"FileEditor: Received update-notebook-cell-code event for current file:",
					{
						filePath: eventFilePath,
						cellIndex,
						codeLength: code?.length || 0,
					}
				);

				// Use the ref to get the current notebook data
				const currentNotebookData = notebookDataRef.current;
				const isReady = isReadyRef.current;

				// Handle -1 index for last cell
				let actualCellIndex = cellIndex;
				if (cellIndex === -1 && currentNotebookData) {
					actualCellIndex = currentNotebookData.cells.length - 1;
				}

				if (
					currentNotebookData &&
					isReady &&
					actualCellIndex >= 0 &&
					actualCellIndex < currentNotebookData.cells.length
				) {
					// Update cell code
					const updatedCells = [...currentNotebookData.cells];
					updatedCells[actualCellIndex] = {
						...updatedCells[actualCellIndex],
						source: toIpynbSource(code),
						outputs: [], // Clear outputs when code changes
						execution_count: null, // Reset execution count
					};

					const updatedNotebook = {
						...currentNotebookData,
						cells: updatedCells,
					};

					setNotebookData(updatedNotebook);
					setHasChanges(true);

					// Auto-save the notebook and dispatch success event after completion
					try {
						await saveNotebookToFile(updatedNotebook);
						EventManager.dispatchEvent("notebook-cell-updated", {
							filePath: eventFilePath,
							cellIndex: actualCellIndex,
							success: true,
						});
					} catch (error) {
						console.error(
							"FileEditor: Failed to save notebook after updating cell code:",
							error
						);
						EventManager.dispatchEvent("notebook-cell-updated", {
							filePath: eventFilePath,
							cellIndex: actualCellIndex,
							success: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				} else if (!currentNotebookData || !isReady) {
					// Queue the event for later processing
					console.log(
						`FileEditor: Queuing update-notebook-cell-code event (notebookData not ready: ${!currentNotebookData}, isReady: ${isReady}) for ${filePath}`
					);
					setPendingEvents((prev) => [
						...prev,
						{
							type: "update-notebook-cell-code",
							detail: event.detail,
							timestamp: Date.now(),
						},
					]);
				}
			}
		};

		// Add event listeners
		window.addEventListener(
			"add-notebook-cell",
			handleAddNotebookCell as unknown as EventListener
		);
		window.addEventListener(
			"update-notebook-cell",
			handleUpdateNotebookCell as unknown as EventListener
		);
		window.addEventListener(
			"update-notebook-cell-code",
			handleUpdateNotebookCellCode as unknown as EventListener
		);

		// Cleanup
		return () => {
			window.removeEventListener(
				"add-notebook-cell",
				handleAddNotebookCell as unknown as EventListener
			);
			window.removeEventListener(
				"update-notebook-cell",
				handleUpdateNotebookCell as unknown as EventListener
			);
			window.removeEventListener(
				"update-notebook-cell-code",
				handleUpdateNotebookCellCode as unknown as EventListener
			);
		};
	}, [filePath]); // Remove notebookData dependency to prevent listener recreation

	// Process pending events when notebookData becomes available
	useEffect(() => {
		const currentNotebookData = notebookDataRef.current;
		if (currentNotebookData) {
			console.log(
				`FileEditor: notebookData ready for ${filePath}, processing pending events`
			);
			processPendingEvents();
		}
	}, [notebookData, filePath]); // Add filePath dependency to ensure proper processing

	// Clean up old pending events periodically
	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const now = Date.now();
			setPendingEvents((prev) => {
				const filtered = prev.filter((event) => now - event.timestamp < 15000); // Reduced from 30s to 15s
				if (filtered.length !== prev.length) {
					console.log(
						`FileEditor: Cleaned up ${
							prev.length - filtered.length
						} old pending events for ${filePath}`
					);
				}
				return filtered;
			});
		}, 5000); // Clean up every 5 seconds instead of 10

		return () => clearInterval(cleanupInterval);
	}, [filePath]);

	const loadFile = async () => {
		try {
			setIsLoading(true);

			// Check if electronAPI is available
			if (!window.electronAPI || !window.electronAPI.readFile) {
				throw new Error("Electron API not available for reading files");
			}

			const fileContent = await window.electronAPI.readFile(filePath);

			// Check if it's a .ipynb file
			if (filePath.endsWith(".ipynb")) {
				try {
					const notebook = JSON.parse(fileContent);
					setNotebookData(notebook);
					setContent(""); // Clear content for notebook view
					// Initialize stable ids for each cell
					setCellIds((notebook.cells || []).map(() => generateCellId()));

					console.log(`FileEditor: Notebook data loaded for ${filePath}`);

					// Dispatch notebook-ready event after a delay to ensure component is fully mounted
					setTimeout((): void => {
						console.log(
							`FileEditor: Dispatching notebook-ready event for ${filePath}`
						);
						const notebookReadyEvent = new CustomEvent("notebook-ready", {
							detail: { filePath },
						});
						window.dispatchEvent(notebookReadyEvent);
					}, 1000); // Increased delay to ensure component is fully ready
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
					setCellIds([]);
				}
			} else {
				setContent(fileContent);
				setNotebookData(null);
				setCellIds([]);
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
			// Check if electronAPI is available
			if (!window.electronAPI || !window.electronAPI.writeFile) {
				throw new Error("Electron API not available for writing files");
			}

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
				await saveNotebookToFile(updatedNotebook);
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

		// Auto-save the notebook
		saveNotebookToFile(updatedNotebook);
		setCellIds((prev) => [...prev, generateCellId()]);
	};

	const addCellAt = (index: number, cellType: "code" | "markdown" = "code") => {
		if (!notebookData) return;

		const newCell: NotebookCell = {
			cell_type: cellType,
			source: [cellType === "markdown" ? "# New Cell\n" : "# New code cell\n"],
			metadata: {},
			execution_count: null,
			outputs: [],
		};

		// Insert into notebook cells immutably
		const updatedCells = [...notebookData.cells];
		const safeIndex = Math.max(0, Math.min(index, updatedCells.length));
		updatedCells.splice(safeIndex, 0, newCell);

		const updatedNotebook = {
			...notebookData,
			cells: updatedCells,
		};

		// Shift cellStates indices at and after insertion point
		setCellStates((prev) => {
			const updated: any = { ...prev };
			const indices = Object.keys(updated)
				.map((k) => parseInt(k, 10))
				.filter((k) => !Number.isNaN(k))
				.sort((a, b) => b - a); // shift from bottom to top
			indices.forEach((k) => {
				if (k >= safeIndex) {
					updated[k + 1] = updated[k];
					delete updated[k];
				}
			});
			// Initialize state for the inserted cell
			updated[safeIndex] = {
				code: newCell.source.join(""),
				output: "",
			};
			return updated;
		});

		setNotebookData(updatedNotebook);
		setHasChanges(true);
		saveNotebookToFile(updatedNotebook);
		// Maintain stable ids in parallel
		setCellIds((prev) => {
			const updated = [...prev];
			const safeIndexAfter = Math.max(0, Math.min(safeIndex, updated.length));
			updated.splice(safeIndexAfter, 0, generateCellId());
			return updated;
		});
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

		// Auto-save the notebook
		saveNotebookToFile(updatedNotebook);
		setCellIds((prev) => prev.filter((_, i) => i !== index));
	};

	const updateCellCode = (index: number, code: string) => {
		setCellStates((prev) => ({
			...prev,
			[index]: { ...prev[index], code },
		}));
		setHasChanges(true);

		// Auto-save the notebook when cell code is updated
		if (notebookData) {
			const updatedNotebook = {
				...notebookData,
				cells: notebookData.cells.map((cell, i) => {
					if (i === index) {
						return {
							...cell,
							source: toIpynbSource(code),
						};
					}
					return cell;
				}),
			};
			saveNotebookToFile(updatedNotebook);
		}
	};

	const updateCellOutput = (index: number, output: string) => {
		setCellStates((prev) => ({
			...prev,
			[index]: { ...prev[index], output },
		}));
		setHasChanges(true);

		// Auto-save the notebook when cell output is updated
		if (notebookData) {
			const updatedNotebook = {
				...notebookData,
				cells: notebookData.cells.map((cell, i) => {
					if (i === index) {
						return {
							...cell,
							outputs: output
								? [
										{
											output_type: "stream",
											name: "stdout",
											text: [output],
										},
								  ]
								: [],
						};
					}
					return cell;
				}),
			};
			saveNotebookToFile(updatedNotebook);
		}
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

		// Rendering notebook with workspace path

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

				{/* Insert controls at the very top */}
				<InsertButtonsRow>
					<InsertCellButton onClick={() => addCellAt(0, "code")}>
						<FiPlus size={12} /> Insert Code Cell Above
					</InsertCellButton>
					<InsertCellButton onClick={() => addCellAt(0, "markdown")}>
						<FiPlus size={12} /> Insert Markdown Above
					</InsertCellButton>
				</InsertButtonsRow>

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
						<React.Fragment key={cellIds[index] || `cell-${index}`}>
							<CodeCell
								initialCode={currentCellState.code}
								initialOutput={currentCellState.output}
								language={cell.cell_type === "markdown" ? "markdown" : "python"}
								workspacePath={workspacePath}
								onExecute={(code, output) => {
									updateCellCode(index, code);
									updateCellOutput(index, output);
								}}
								onCodeChange={(code) => {
									updateCellCode(index, code);
								}}
								// Ensure Markdown edits are persisted
								onDelete={() => deleteCell(index)}
							/>

							{/* Insert controls between cells (after current index) */}
							<InsertButtonsRow>
								<InsertCellButton onClick={() => addCellAt(index + 1, "code")}>
									<FiPlus size={12} /> Insert Code Cell Here
								</InsertCellButton>
								<InsertCellButton
									onClick={() => addCellAt(index + 1, "markdown")}
								>
									<FiPlus size={12} /> Insert Markdown Here
								</InsertCellButton>
							</InsertButtonsRow>
						</React.Fragment>
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
							fontSize: 14, // Match typography.base for consistency
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
