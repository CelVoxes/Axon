import React, { useState, useEffect, useRef } from "react";
import styled from "styled-components";
import Editor from "@monaco-editor/react";
import { CodeCell } from "./CodeCell";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { ActionButton } from "@components/shared/StyledComponents";
import { Tooltip } from "@components/shared/Tooltip";
import { useWorkspaceContext } from "../../context/AppContext";
import { typography } from "../../styles/design-system";
import { EventManager } from "../../utils/EventManager";
import { findWorkspacePath } from "../../utils/WorkspaceUtils";
import { electronAPI } from "../../utils/electronAPI";
import { ElectronClient } from "../../utils/ElectronClient";

// Cache detected Python versions per workspace to avoid repeated kernel calls on save
const workspacePythonVersionCache = new Map<string, string>();

const EditorContainer = styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	position: relative; /* ensure in-notebook overlays stay within editor area */
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
	/* Add back a tiny top padding to smooth sticky overlap without a visual gap */
	padding: 2px 16px 16px 16px;
	background: #1e1e1e;
	/* Natural scroll chaining to parent when children reach their edge */
	overscroll-behavior: auto;
	scrollbar-gutter: stable both-edges;

	/* Add some spacing between cells */
	> * + * {
		margin-top: 16px; /* separation between sections (header/controls/cells) */
	}
`;

const NotebookHeader = styled.div`
	margin-bottom: 24px;
	margin-top: 16px;
	padding: 16px;
	background: #2d2d30;
	border-radius: 8px;
	border: 1px solid #404040;
`;

const NotebookTitle = styled.h1`
	margin: 0 0 8px 0;
	color: #bbbbbb;
	font-size: ${typography.xl};
	font-weight: 500;
	max-width: 100%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`;

const NotebookMetadata = styled.div`
	color: #858585;
	font-size: ${typography.sm};
	line-height: 1.4;
`;

const MetaRow = styled.div`
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
`;

const MetaItem = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 2px 8px;
	border: 1px solid #404040;
	border-radius: 999px;
	color: #cfcfcf;
	font-size: ${typography.xs};
	background: #1f1f1f;
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
	// Debounce save handling
	const saveDebounceMs = 600;
	const pendingSaveRef = useRef<NotebookData | null>(null);
	const saveTimerRef = useRef<number | null>(null);

	// Update the ref whenever notebookData changes
	useEffect(() => {
		notebookDataRef.current = notebookData;
		isReadyRef.current = !!notebookData;
	}, [notebookData]);

	// Get workspace context at the top level to avoid React hooks warning
	const { state: workspaceState, dispatch: workspaceDispatch } =
		useWorkspaceContext();

	const workspacePath: string | undefined = findWorkspacePath({
		filePath: filePath || undefined,
		currentWorkspace: workspaceState.currentWorkspace || undefined,
	});

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
		}
		setPendingEvents([]);
	}, [filePath]);

	// Ensure the current file is tracked in openFiles even if opened via events
	useEffect(() => {
		try {
			if (workspaceDispatch && !workspaceState.openFiles.includes(filePath)) {
				workspaceDispatch({ type: "OPEN_FILE", payload: filePath });
			}
		} catch (e) {
			// ignore dispatch errors
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
			pendingEvents.forEach((pendingEvent) => {
				// Re-dispatch the event to be handled by the current handlers
				const event = new CustomEvent(pendingEvent.type, {
					detail: pendingEvent.detail,
				});
				window.dispatchEvent(event);
			});

			setPendingEvents([]);
		}
	};

	// Function to save notebook to file (used by manual Save and debounced queue)
	const saveNotebookToFile = async (
		notebook: NotebookData,
		skipVersionDetection = false
	) => {
		try {
			let finalNotebook = notebook;

			// Only try to detect Python version if explicitly requested and not skipped
			if (
				!skipVersionDetection &&
				notebook?.metadata?.language_info?.name === "python" &&
				workspacePath
			) {
				try {
					let detected = workspacePythonVersionCache.get(workspacePath);
					if (!detected) {
						// Only attempt version detection if we have an active kernel
						// This avoids triggering kernel startup just for saving
						const res = await electronAPI.executeJupyterCode(
							"import sys\nprint(sys.version.split(' ')[0])",
							workspacePath
						);
						if (res?.success && typeof res.data?.output === "string") {
							const candidate = res.data.output.trim();
							if (candidate && /\d+\.\d+(\.\d+)?/.test(candidate)) {
								detected = candidate;
								workspacePythonVersionCache.set(workspacePath, candidate);
							}
						}
					}
					if (detected) {
						finalNotebook = {
							...notebook,
							metadata: {
								...notebook.metadata,
								language_info: {
									...(notebook.metadata.language_info || { name: "python" }),
									version: detected,
								},
							},
						};
					}
				} catch (_) {
					// Ignore detection failures; keep existing value
				}
			}

			const writeRes = await electronAPI.writeFile(
				filePath,
				JSON.stringify(finalNotebook, null, 2)
			);
			if (!writeRes.success) {
				throw new Error(writeRes.error || "Failed to write file");
			}
		} catch (error) {
			console.error("FileEditor: Error saving notebook:", error);
		}
	};

	// Debounced queue for notebook saves to reduce disk churn
	const queueNotebookSave = (
		notebook: NotebookData,
		skipVersionDetection = true
	) => {
		pendingSaveRef.current = notebook;
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
		}
		saveTimerRef.current = window.setTimeout(() => {
			const nb = pendingSaveRef.current;
			pendingSaveRef.current = null;
			saveTimerRef.current = null;
			if (nb) {
				void saveNotebookToFile(nb, skipVersionDetection);
			}
		}, saveDebounceMs);
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

					// Auto-save (debounced) and dispatch success event after scheduling
					try {
						queueNotebookSave(updatedNotebook);
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

					// Auto-save (debounced) and dispatch success event after scheduling
					try {
						queueNotebookSave(updatedNotebook);
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
					const incomingEditedByChatAt = (event as any)?.detail
						?.editedByChatAt as string | undefined;
					const existingMeta =
						(updatedCells[actualCellIndex] as any)?.metadata || {};
					updatedCells[actualCellIndex] = {
						...updatedCells[actualCellIndex],
						source: toIpynbSource(code),
						metadata: {
							...existingMeta,
							...(incomingEditedByChatAt
								? { editedByChatAt: incomingEditedByChatAt }
								: {}),
						},
						outputs: [], // Clear outputs when code changes
						execution_count: null, // Reset execution count
					} as any;

					const updatedNotebook = {
						...currentNotebookData,
						cells: updatedCells,
					};

					setNotebookData(updatedNotebook);
					// Update in-memory editor state for immediate UI reflection
					setCellStates((prev) => {
						const next = [...prev] as any[];
						const prevEntry = next[actualCellIndex] || { code: "", output: "" };
						next[actualCellIndex] = {
							...prevEntry,
							code,
							editedByChatAt:
								incomingEditedByChatAt || prevEntry.editedByChatAt,
						};
						return next;
					});
					setHasChanges(true);

					// Auto-save (debounced) and dispatch success event after scheduling
					try {
						queueNotebookSave(updatedNotebook);
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
				}
				return filtered;
			});
		}, 5000); // Clean up every 5 seconds instead of 10

		return () => clearInterval(cleanupInterval);
	}, [filePath]);

	// Add keyboard shortcut for saving (Cmd+S / Ctrl+S)
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "s") {
				event.preventDefault();
				if (hasChanges) {
					saveFile();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [hasChanges]); // Re-run when hasChanges state updates

	const isImageFile = (p: string) => {
		const ext = p.split(".").pop()?.toLowerCase();
		return ext
			? ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)
			: false;
	};

	const loadFile = async () => {
		try {
			setIsLoading(true);

			// If image, read as binary and show an image viewer
			if (isImageFile(filePath)) {
				const bin = await electronAPI.readFileBinary(filePath);
				const dataUrl: string | undefined = bin?.success
					? bin.data?.dataUrl
					: undefined;
				if (dataUrl) {
					setContent(dataUrl);
					setNotebookData(null);
					setCellIds([]);
					setHasChanges(false);
					return;
				}
			}

			const rf = await electronAPI.readFile(filePath);
			if (!rf.success || typeof rf.data !== "string") {
				throw new Error(rf.error || "Failed to read file");
			}
			const fileContent = rf.data;

			// Check if it's a .ipynb file
			if (filePath.endsWith(".ipynb")) {
				try {
					const notebook = JSON.parse(fileContent);
					setNotebookData(notebook);
					setContent(""); // Clear content for notebook view
					// Initialize stable ids for each cell
					setCellIds((notebook.cells || []).map(() => generateCellId()));

					// Dispatch notebook-ready event after a delay to ensure component is fully mounted
					setTimeout((): void => {
						const notebookReadyEvent = new CustomEvent("notebook-ready", {
							detail: { filePath },
						});
						window.dispatchEvent(notebookReadyEvent);
					}, 1000); // Increased delay to ensure component is fully ready
				} catch (parseError) {
					console.error("Error parsing notebook:", parseError);

					// Attempt to salvage by trimming trailing non-JSON content
					try {
						const trySalvage = (): {
							json: string;
							obj: NotebookData;
						} | null => {
							const raw = String(fileContent);
							// Fast path: if error message contains a position, try slicing up to that
							let candidates: number[] = [];
							try {
								const m = String(
									parseError instanceof Error ? parseError.message : ""
								).match(/position\s+(\d+)/i);
								if (m) {
									const pos = parseInt(m[1], 10);
									if (Number.isFinite(pos) && pos > 0 && pos <= raw.length) {
										candidates.push(pos);
									}
								}
							} catch {}
							// Always include last '}' positions (scan up to 200 candidates max)
							const maxScan = 200;
							let found = 0;
							for (let i = raw.length - 1; i >= 0 && found < maxScan; i--) {
								if (raw[i] === "}") {
									candidates.push(i + 1); // slice end exclusive
									found++;
								}
							}
							// Deduplicate keeping order
							const seen = new Set<number>();
							candidates = candidates.filter((i) => {
								if (seen.has(i)) return false;
								seen.add(i);
								return true;
							});
							for (const endIdx of candidates) {
								const slice = raw.slice(0, endIdx).trimEnd();
								try {
									const obj = JSON.parse(slice);
									// Basic notebook shape validation
									if (
										obj &&
										typeof obj === "object" &&
										Array.isArray((obj as any).cells) &&
										typeof (obj as any).nbformat === "number"
									) {
										return { json: JSON.stringify(obj, null, 2), obj };
									}
								} catch {}
							}
							return null;
						};

						const salvaged = trySalvage();
						if (salvaged) {
							console.warn(
								`FileEditor: Salvaged corrupted notebook by trimming trailing content. Repairing file: ${filePath}`
							);
							// Create a timestamped backup of the original file before repairing
							try {
								const backupPath = `${filePath}.backup_${Date.now()}.txt`;
								await electronAPI.writeFile(backupPath, fileContent);
								console.warn(
									`FileEditor: Wrote backup of original notebook to ${backupPath}`
								);
							} catch (e) {
								console.warn("FileEditor: Failed to write backup:", e);
							}

							// Overwrite the original with the repaired JSON
							try {
								await electronAPI.writeFile(filePath, salvaged.json);
							} catch (e) {
								console.warn("FileEditor: Failed to write repaired file:", e);
							}

							// Load salvaged notebook into editor state
							setNotebookData(salvaged.obj);
							setContent("");
							setCellIds(
								(salvaged.obj.cells || []).map(() => generateCellId())
							);

							// Dispatch notebook-ready event
							setTimeout((): void => {
								const notebookReadyEvent = new CustomEvent("notebook-ready", {
									detail: { filePath },
								});
								window.dispatchEvent(notebookReadyEvent);
							}, 500);
						} else {
							// Could not salvage
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
					} catch (salvageError) {
						console.error("FileEditor: Salvage attempt failed:", salvageError);
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
								source: toIpynbSource(cellState.code),
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
				await saveNotebookToFile(updatedNotebook, true); // Skip version detection for manual saves too
			} else {
				const wr = await electronAPI.writeFile(filePath, content);
				if (!wr.success) throw new Error(wr.error || "Failed to write file");
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

		// Auto-save the notebook (debounced)
		queueNotebookSave(updatedNotebook);
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

		// Insert default state at the same index to keep arrays aligned
		setCellStates((prev) => {
			const next = Array.isArray(prev)
				? [...prev]
				: ([] as Array<{ code: string; output: string }>);
			next.splice(safeIndex, 0, { code: newCell.source.join(""), output: "" });
			return next;
		});

		setNotebookData(updatedNotebook);
		setHasChanges(true);
		queueNotebookSave(updatedNotebook);
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

		// Remove corresponding state entry to keep arrays aligned
		setNotebookData(updatedNotebook);
		setCellStates((prev) => {
			const next = Array.isArray(prev)
				? [...prev]
				: ([] as Array<{ code: string; output: string }>);
			if (index >= 0 && index < next.length) next.splice(index, 1);
			return next;
		});
		setHasChanges(true);

		// Auto-save the notebook (debounced)
		queueNotebookSave(updatedNotebook);
		setCellIds((prev) => prev.filter((_, i) => i !== index));
	};

	const updateCellCode = (index: number, code: string) => {
		setCellStates((prev) => {
			const next = Array.isArray(prev)
				? [...prev]
				: ([] as Array<{ code: string; output: string }>);
			const prevEntry = next[index] || { code: "", output: "" };
			next[index] = { ...prevEntry, code };
			return next;
		});
		setHasChanges(true);

		// Auto-save the notebook when cell code is updated (debounced)
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
			queueNotebookSave(updatedNotebook);
		}
	};

	const updateCellOutput = (index: number, output: string) => {
		setCellStates((prev) => {
			const next = Array.isArray(prev)
				? [...prev]
				: ([] as Array<{ code: string; output: string }>);
			const prevEntry = next[index] || { code: "", output: "" };
			next[index] = { ...prevEntry, output };
			return next;
		});
		setHasChanges(true);

		// Auto-save the notebook when cell output is updated (debounced)
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
			queueNotebookSave(updatedNotebook);
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
						<MetaRow>
							{notebookData.metadata.kernelspec && (
								<MetaItem>
									Kernel: {notebookData.metadata.kernelspec.display_name}
								</MetaItem>
							)}
							{notebookData.metadata.language_info && (
								<MetaItem>
									Language: {notebookData.metadata.language_info.name}{" "}
									{notebookData.metadata.language_info.version}
								</MetaItem>
							)}
							<MetaItem>Cells: {notebookData.cells.length}</MetaItem>
						</MetaRow>
					</NotebookMetadata>
				</NotebookHeader>

				{/* Insert controls at the very top */}
				<InsertButtonsRow>
					<Tooltip content="Add a new Python cell at the top" placement="top">
						<InsertCellButton onClick={() => addCellAt(0, "code")}>
							<FiPlus size={12} /> Insert Code Cell Above
						</InsertCellButton>
					</Tooltip>
					<Tooltip
						content="Add a new Markdown text cell at the top"
						placement="top"
					>
						<InsertCellButton onClick={() => addCellAt(0, "markdown")}>
							<FiPlus size={12} /> Insert Markdown Above
						</InsertCellButton>
					</Tooltip>
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
					const currentCellState = (cellStates[index] as any) || {
						code: cellContent,
						output: cellOutput,
						editedByChatAt: undefined as string | undefined,
					};

					return (
						<React.Fragment key={cellIds[index] || `cell-${index}`}>
							<CodeCell
								initialCode={currentCellState.code}
								initialOutput={currentCellState.output}
								language={cell.cell_type === "markdown" ? "markdown" : "python"}
								workspacePath={workspacePath}
								filePath={filePath}
								cellIndex={index}
								editedByChatAt={currentCellState.editedByChatAt}
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
								<Tooltip
									content="Insert a Python cell below this"
									placement="top"
								>
									<InsertCellButton
										onClick={() => addCellAt(index + 1, "code")}
									>
										<FiPlus size={12} /> Insert Code Cell Here
									</InsertCellButton>
								</Tooltip>
								<Tooltip
									content="Insert a Markdown cell below this"
									placement="top"
								>
									<InsertCellButton
										onClick={() => addCellAt(index + 1, "markdown")}
									>
										<FiPlus size={12} /> Insert Markdown Here
									</InsertCellButton>
								</Tooltip>
							</InsertButtonsRow>
						</React.Fragment>
					);
				})}
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
					<div style={{ marginLeft: "auto" }}>
						<Tooltip content="Save changes to disk" placement="bottom">
							<button
								onClick={saveFile}
								style={{
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
						</Tooltip>
					</div>
				)}
			</EditorHeader>

			{filePath.endsWith(".ipynb") && notebookData ? (
				renderNotebook()
			) : isImageFile(filePath) ? (
				<div
					style={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						height: "100%",
						background: "#1e1e1e",
					}}
				>
					<img
						src={content}
						alt={fileName}
						style={{
							maxWidth: "100%",
							maxHeight: "100%",
							objectFit: "contain",
							border: "1px solid #3e3e42",
							borderRadius: 8,
						}}
					/>
				</div>
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
