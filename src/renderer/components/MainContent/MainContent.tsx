import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiFolder, FiMessageSquare } from "react-icons/fi";
import { useWorkspaceContext, useUIContext } from "../../context/AppContext";
import { FileEditor } from "./FileEditor";
import { WelcomeScreen } from "./WelcomeScreen";
import {
	ActionButton,
	StatusIndicator,
	EmptyState,
} from "../shared/StyledComponents";
import { electronAPI } from "../../utils/electronAPI";
import { typography } from "../../styles/design-system";

const MainContainer = styled.div`
	flex: 1;
	display: flex;
	flex-direction: column;
	background-color: #151515;
	overflow: hidden;
	height: 100%;
	margin: 8px;
	border-radius: 8px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

const TabBar = styled.div`
	height: 35px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	overflow-x: auto;
`;

const Tab = styled.div<{ $isActive: boolean }>`
	padding: 8px 16px;
	font-size: ${typography.base};
	cursor: pointer;
	border-right: 1px solid #3e3e42;
	background-color: ${(props) => (props.$isActive ? "#1e1e1e" : "transparent")};
	color: ${(props) => (props.$isActive ? "#ffffff" : "#cccccc")};
	white-space: nowrap;

	&:hover {
		background-color: ${(props) => (props.$isActive ? "#1e1e1e" : "#383838")};
	}

	.close {
		margin-left: 8px;
		opacity: 0.6;

		&:hover {
			opacity: 1;
		}
	}
`;

const ControlBar = styled.div`
	height: 40px;
	background-color: #252526;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 12px;
	gap: 8px;
`;

const ControlLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`;

const ControlRight = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`;

// Using shared ActionButton component

// Using shared StatusIndicator component

// Using shared EmptyState component

// Welcome screen styling moved to WelcomeScreen component

export const MainContent: React.FC<{ "data-layout-role"?: string }> = (
	props
) => {
	const { state: workspaceState, dispatch: workspaceDispatch } =
		useWorkspaceContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);

	useEffect(() => {
		async function syncRecentWorkspaces() {
			try {
				const result = await electronAPI.storeGet("recentWorkspaces");

				if (result.success && result.data) {
					const filtered = (result.data || [])
						.filter((w: any) => typeof w === "string" && w.length > 0)
						.slice(0, 3);

					setRecentWorkspaces(filtered);
				} else if (!result.success) {
					console.warn("Failed to load recent workspaces:", result.error);
				}
			} catch (e) {
				console.error("Error loading recent workspaces:", e);
			}
		}

		// Add a small delay to ensure electronAPI is available
		const timer = setTimeout(() => {
			syncRecentWorkspaces();
		}, 100);

		return () => clearTimeout(timer);
	}, []);

	// Recent workspaces state changes
	useEffect(() => {
		// State updated
	}, [recentWorkspaces]);

	// Listen for notebook events from AutonomousAgent
	useEffect(() => {
		const handleOpenWorkspaceFile = (event: CustomEvent) => {
			const { filePath } = event.detail;

			// Open the file in the workspace
			if (!workspaceState.openFiles.includes(filePath)) {
				workspaceDispatch({ type: "OPEN_FILE", payload: filePath });
			}
			workspaceDispatch({ type: "SET_ACTIVE_FILE", payload: filePath });
		};

		const handleAddNotebookCell = (event: CustomEvent) => {
			// This will be handled by the Notebook component
			// The event is dispatched for the Notebook component to listen to
		};

		const handleUpdateNotebookCell = (event: CustomEvent) => {
			// This will be handled by the Notebook component
			// The event is dispatched for the Notebook component to listen to
		};

		const handleUpdateNotebookCellCode = (event: CustomEvent) => {
			// This will be handled by the FileEditor component
			// The event is dispatched for the FileEditor component to listen to
		};

		// Add event listeners
		window.addEventListener(
			"open-workspace-file",
			handleOpenWorkspaceFile as EventListener
		);
		window.addEventListener(
			"add-notebook-cell",
			handleAddNotebookCell as EventListener
		);
		window.addEventListener(
			"update-notebook-cell",
			handleUpdateNotebookCell as EventListener
		);
		window.addEventListener(
			"update-notebook-cell-code",
			handleUpdateNotebookCellCode as EventListener
		);

		// Cleanup
		return () => {
			window.removeEventListener(
				"open-workspace-file",
				handleOpenWorkspaceFile as EventListener
			);
			window.removeEventListener(
				"add-notebook-cell",
				handleAddNotebookCell as EventListener
			);
			window.removeEventListener(
				"update-notebook-cell",
				handleUpdateNotebookCell as EventListener
			);
			window.removeEventListener(
				"update-notebook-cell-code",
				handleUpdateNotebookCellCode as EventListener
			);
		};
	}, [workspaceState.openFiles, workspaceDispatch]);

	// Add keyboard shortcuts for file operations
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ctrl+W or Cmd+W to close current file
			if ((e.ctrlKey || e.metaKey) && e.key === "w") {
				e.preventDefault();
				if (workspaceState.activeFile) {
					console.log("Keyboard shortcut: Closing active file");
					handleTabClose(e as any, workspaceState.activeFile);
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [workspaceState.activeFile]);

	const handleOpenWorkspace = async (path: string) => {
		// If path is empty, open file dialog
		if (!path) {
			try {
				const result = await electronAPI.showOpenDialog({
					properties: ["openDirectory"],
					title: "Select Project Folder",
				});

				if (
					result.success &&
					result.data &&
					!result.data.canceled &&
					result.data.filePaths.length > 0
				) {
					path = result.data.filePaths[0];
				} else if (!result.success) {
					console.error("Failed to open file dialog:", result.error);
					return;
				} else {
					return; // User cancelled
				}
			} catch (error) {
				console.error("Error opening file dialog:", error);
				return;
			}
		}
		workspaceDispatch({ type: "SET_WORKSPACE", payload: path });
		// Persist as last opened workspace for auto-restore
		try {
			await electronAPI.storeSet("lastWorkspace", path);
		} catch (e) {
			// ignore
		}
		setRecentWorkspaces((prev: string[]) => {
			const updated = [path, ...prev.filter((w: string) => w !== path)].slice(
				0,
				3
			);

			// Store using safe API
			electronAPI.storeSet("recentWorkspaces", updated).catch((error) => {
				console.warn("Failed to store recent workspaces:", error);
			});

			return updated;
		});
		workspaceDispatch({ type: "SET_ACTIVE_FILE", payload: null });
	};

	const handleTabClose = (e: React.MouseEvent, filePath: string) => {
		e.stopPropagation();

		// If it's a notebook file, we might need to clean up Jupyter connections
		if (filePath.endsWith(".ipynb")) {
			// Dispatch a custom event to notify notebook components to cleanup
			const cleanupEvent = new CustomEvent("notebook-cleanup", {
				detail: { filePath },
			});
			window.dispatchEvent(cleanupEvent);

			// Add a small delay to allow cleanup, then close
			setTimeout(() => {
				workspaceDispatch({ type: "CLOSE_FILE", payload: filePath });
			}, 100);
		} else {
			workspaceDispatch({ type: "CLOSE_FILE", payload: filePath });
		}
	};

	const toggleChat = () => {
		if (!uiState.showChatPanel) {
			// If chat panel is not shown, show it
			uiDispatch({
				type: "SET_SHOW_CHAT_PANEL",
				payload: true,
			});
			uiDispatch({
				type: "SET_CHAT_COLLAPSED",
				payload: false,
			});
		} else {
			// If chat panel is shown, toggle collapsed state
			uiDispatch({
				type: "SET_CHAT_COLLAPSED",
				payload: !uiState.chatCollapsed,
			});
		}
	};

	const renderTabBar = () => {
		if (workspaceState.openFiles.length === 0) return null;

		const tabs: React.ReactNode[] = [];

		// File tabs
		workspaceState.openFiles.forEach((filePath: string) => {
			const fileName = filePath.split("/").pop() || filePath;
			const isActive = workspaceState.activeFile === filePath;

			tabs.push(
				<Tab
					key={filePath}
					$isActive={isActive}
					onClick={() =>
						workspaceDispatch({ type: "SET_ACTIVE_FILE", payload: filePath })
					}
				>
					{fileName}
					<span className="close" onClick={(e) => handleTabClose(e, filePath)}>
						×
					</span>
				</Tab>
			);
		});

		return tabs;
	};

	const renderContent = () => {
		// If workspace is open, show file editor or empty state
		if (workspaceState.currentWorkspace) {
			// Show file editor if a file is selected and open
			if (
				workspaceState.activeFile &&
				workspaceState.openFiles.includes(workspaceState.activeFile)
			) {
				return <FileEditor filePath={workspaceState.activeFile} />;
			}

			// Show empty state if no file is active
			return (
				<EmptyState>
					<div className="title">Workspace Open</div>
					<div className="subtitle">
						Use the Explorer to browse and open files, or start analysis in the
						chat panel.
					</div>
				</EmptyState>
			);
		}

		// Show welcome screen when no workspace is open
		return (
			<WelcomeScreen
				recentWorkspaces={recentWorkspaces}
				onOpenWorkspace={handleOpenWorkspace}
			/>
		);
	};

	return (
		<MainContainer>
			{(() => {
				const tabs = renderTabBar();
				return tabs && tabs.length > 0 ? <TabBar>{tabs}</TabBar> : null;
			})()}

			{workspaceState.currentWorkspace && (
				<ControlBar>
					<ControlLeft>
						<StatusIndicator $status="running">Workspace Open</StatusIndicator>
					</ControlLeft>
					<ControlRight>
						{(!uiState.showChatPanel || uiState.chatCollapsed) && (
							<ActionButton
								$variant="primary"
								onClick={toggleChat}
								title="Open Chat"
							>
								<FiMessageSquare size={14} color="white" />
								Chat
							</ActionButton>
						)}
					</ControlRight>
				</ControlBar>
			)}

			{renderContent()}

			{/* Floating chat toggle button when chat is not shown or collapsed */}
			{workspaceState.currentWorkspace &&
				(!uiState.showChatPanel || uiState.chatCollapsed) && (
					<ActionButton
						$variant="primary"
						onClick={toggleChat}
						title="Open Chat"
						style={{
							position: "fixed",
							top: "50%",
							right: "20px",
							transform: "translateY(-50%)",
							zIndex: 1000,
							borderRadius: "50%",
							width: "48px",
							height: "48px",
							padding: "0",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
						}}
					>
						<FiMessageSquare size={20} />
					</ActionButton>
				)}
		</MainContainer>
	);
};
