import React, { useState, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { FiFolder } from "react-icons/fi";
import { useWorkspaceContext, useUIContext } from "../../context/AppContext";
import { FileEditor } from "./FileEditor";
import { WelcomeScreen } from "./WelcomeScreen";
import { SSHConnectModal } from "./SSHConnectModal";
import { SSHTerminal } from "./SSHTerminal";
import { RemoteFolderModal } from "./RemoteFolderModal";
import {
	ActionButton,
	StatusIndicator,
	EmptyState,
} from "@components/shared/StyledComponents";
import { electronAPI } from "../../utils/electronAPI";
import { typography } from "../../styles/design-system";

const MainContainer = styled.div`
	flex: 1;
	display: flex;
	flex-direction: column;
	background-color: #151515;
	overflow: hidden;
	height: 100%;
`;

const TabBar = styled.div`
	height: 35px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	overflow-x: auto;
	overflow-y: hidden;
	flex-wrap: nowrap;
	-webkit-overflow-scrolling: touch; /* smooth scrolling */
	overscroll-behavior-x: contain;
	position: sticky;
	top: 0;
	z-index: 100;
	
	/* Enhanced scrollbar styling for better visibility */
	scrollbar-width: thin;
	scrollbar-color: #555 transparent;
	
	&::-webkit-scrollbar {
		height: 4px;
	}
	&::-webkit-scrollbar-thumb {
		background: #555;
		border-radius: 2px;
	}
	&::-webkit-scrollbar-track {
		background: transparent;
	}
	&::-webkit-scrollbar-thumb:hover {
		background: #777;
	}
	
	/* Fade indicators for scrollable content */
	&::before,
	&::after {
		content: '';
		position: absolute;
		top: 0;
		width: 20px;
		height: 100%;
		pointer-events: none;
		z-index: 1;
		transition: opacity 0.2s ease;
	}
	
	&::before {
		left: 0;
		background: linear-gradient(to right, #2d2d30 0%, transparent 100%);
		opacity: 0;
	}
	
	&::after {
		right: 0;
		background: linear-gradient(to left, #2d2d30 0%, transparent 100%);
		opacity: 0;
	}
	
	&.can-scroll-left::before {
		opacity: 1;
	}
	
	&.can-scroll-right::after {
		opacity: 1;
	}
`;

const Tab = styled.div<{ $isActive: boolean }>`
	padding: 8px 8px 8px 12px;
	font-size: ${typography.base};
	cursor: pointer;
	border-right: 1px solid #3e3e42;
	background-color: ${(props) => (props.$isActive ? "#1e1e1e" : "transparent")};
	color: ${(props) => (props.$isActive ? "#ffffff" : "#cccccc")};
	white-space: nowrap;
	flex: 0 0 auto; /* prevent shrinking/wrapping */
	width: 180px; /* Fixed width for consistent sizing */
	display: flex;
	align-items: center;
	gap: 6px;

	&:hover {
		background-color: ${(props) => (props.$isActive ? "#1e1e1e" : "#383838")};
	}

	.tab-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.2;
	}

	.close {
		flex: 0 0 auto;
		opacity: 0.5;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		font-size: 16px;
		line-height: 1;
		margin-left: auto; /* Push to right edge */
		background-color: transparent;
		transition: all 0.15s ease;

		&:hover {
			opacity: 1;
			background-color: rgba(255, 255, 255, 0.15);
			transform: scale(1.1);
		}

		&:active {
			transform: scale(0.95);
		}
	}
`;

// Control bar removed (moved actions to header)

// Using shared ActionButton component

// Using shared StatusIndicator component

// Using shared EmptyState component

// Welcome screen styling moved to WelcomeScreen component

export const MainContent: React.FC<{ "data-layout-role"?: string }> = (
	props
) => {
	// Horizontal scrolling for TabBar with mouse wheel (convert vertical wheel to horizontal)
	const tabBarRef = useRef<HTMLDivElement | null>(null);
	const { state: workspaceState, dispatch: workspaceDispatch } =
		useWorkspaceContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
	const [showSSHModal, setShowSSHModal] = useState(false);
	const [sshSessionId, setSshSessionId] = useState<string | null>(null);
	const [sshTargetLabel, setSshTargetLabel] = useState<string>("");
	const [isConnectingSSH, setIsConnectingSSH] = useState(false);
	const [sshError, setSshError] = useState<string | null>(null);
	const [showRemoteFolderModal, setShowRemoteFolderModal] = useState(false);
	const [sshUsername, setSshUsername] = useState<string>("");
	const [canScrollLeft, setCanScrollLeft] = useState(false);
	const [canScrollRight, setCanScrollRight] = useState(false);

	// Check scroll capability
	const checkScrollCapability = useCallback(() => {
		const el = tabBarRef.current;
		if (!el) return;
		
		const canScrollL = el.scrollLeft > 0;
		const canScrollR = el.scrollLeft < (el.scrollWidth - el.clientWidth);
		
		setCanScrollLeft(canScrollL);
		setCanScrollRight(canScrollR);
	}, []);

	// Monitor tab bar scroll capability and handle wheel events
	useEffect(() => {
		const el = tabBarRef.current;
		if (!el) return;

		checkScrollCapability();
		
		const handleScroll = () => checkScrollCapability();
		const handleResize = () => checkScrollCapability();
		
		// Handle wheel events for horizontal scrolling (using native listener to avoid passive event issues)
		const handleWheel = (e: WheelEvent) => {
			// Only handle vertical scrolling when horizontal scroll is possible
			if (Math.abs(e.deltaY) >= Math.abs(e.deltaX) && (el.scrollWidth > el.clientWidth)) {
				// Check if we can scroll in the intended direction
				const newScrollLeft = el.scrollLeft + e.deltaY;
				const maxScrollLeft = el.scrollWidth - el.clientWidth;
				
				if (newScrollLeft >= 0 && newScrollLeft <= maxScrollLeft) {
					el.scrollLeft = newScrollLeft;
					e.preventDefault();
				}
			}
		};
		
		el.addEventListener('scroll', handleScroll);
		el.addEventListener('wheel', handleWheel, { passive: false });
		window.addEventListener('resize', handleResize);
		
		return () => {
			el.removeEventListener('scroll', handleScroll);
			el.removeEventListener('wheel', handleWheel);
			window.removeEventListener('resize', handleResize);
		};
	}, [checkScrollCapability, workspaceState.openFiles]);

	useEffect(() => {
		async function syncRecentWorkspaces() {
			try {
				const result = await electronAPI.storeGet("recentWorkspaces");

				if (result.success && result.data) {
					const raw: string[] = (result.data || []).filter(
						(w: any) => typeof w === "string" && w.length > 0
					);

					// Deduplicate while preserving order
					const unique: string[] = [];
					for (const p of raw) {
						if (!unique.includes(p)) unique.push(p);
					}

					// Validate paths exist; remove any that no longer exist
					const existence = await Promise.all(
						unique.map(async (p) => {
							const res = await electronAPI.directoryExists(p);
							return res.success && res.data === true;
						})
					);
					const existing = unique.filter((_, idx) => existence[idx]);

					const finalList = existing.slice(0, 3);
					setRecentWorkspaces(finalList);

					// Persist cleaned list if it changed
					const changed =
						JSON.stringify(finalList) !== JSON.stringify(raw.slice(0, 3));
					if (changed) {
						try {
							await electronAPI.storeSet("recentWorkspaces", finalList);
						} catch (err) {
							console.warn("Failed to update recent workspaces store:", err);
						}
					}
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

		// Validate provided path exists; if not, prune from recents and abort
		try {
			const exists = await electronAPI.directoryExists(path);
			if (!exists) {
				// Remove stale entry from recentWorkspaces and persist
				setRecentWorkspaces((prev: string[]) => {
					const updated = prev.filter((w) => w !== path);
					electronAPI
						.storeSet("recentWorkspaces", updated)
						.catch((err) =>
							console.warn("Failed to persist cleaned recents:", err)
						);
					return updated;
				});
				console.warn("Selected workspace no longer exists:", path);
				return;
			}
		} catch (e) {
			console.warn("Failed to validate workspace path:", e);
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

		// Treat .ipynb like any other file in tabs; close immediately
		workspaceDispatch({ type: "CLOSE_FILE", payload: filePath });
	};

	const handleTabMouseDown = (e: React.MouseEvent, filePath: string) => {
		// Middle click (button 1) closes the tab
		if (e.button === 1) {
			e.preventDefault();
			e.stopPropagation();
			workspaceDispatch({ type: "CLOSE_FILE", payload: filePath });
		}
	};

	const renderTabBar = () => {
		// Always include the active file in addition to open files (ensures .ipynb doesn't hide others)
		const files: string[] = Array.from(
			new Set([
				...workspaceState.openFiles,
				...(workspaceState.activeFile ? [workspaceState.activeFile] : []),
			])
		);

		if (files.length === 0) return null;

		const tabs: React.ReactNode[] = [];

		// File tabs
		files.forEach((filePath: string) => {
			const fileName = filePath.split("/").pop() || filePath;
			const isActive = workspaceState.activeFile === filePath;

			tabs.push(
				<Tab
					key={filePath}
					$isActive={isActive}
					onClick={() =>
						workspaceDispatch({ type: "SET_ACTIVE_FILE", payload: filePath })
					}
					onMouseDown={(e) => handleTabMouseDown(e, filePath)}
					title={filePath}
				>
					<span className="tab-title">{fileName}</span>
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
			if (workspaceState.activeFile) {
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
			<>
				<WelcomeScreen
					recentWorkspaces={recentWorkspaces}
					onOpenWorkspace={handleOpenWorkspace}
					onOpenSSH={() => {
						setSshError(null);
						setShowSSHModal(true);
					}}
				/>
				{showSSHModal && (
					<SSHConnectModal
						onCancel={() => setShowSSHModal(false)}
						isConnecting={isConnectingSSH}
						error={sshError}
						onConnect={async (target: string) => {
							try {
								setIsConnectingSSH(true);
								setSshError(null);
								const { v4: uuidv4 } = await import("uuid");
								const sid = uuidv4();
								setSshSessionId(sid);
								setSshTargetLabel(target);
								const username = target.includes("@")
									? target.split("@")[0]
									: "";
								setSshUsername(username);
								const res = await (window as any).electronAPI.sshStart(sid, {
									target,
								});
								if (!res?.success) {
									setSshError(res?.error || "Failed to start SSH session");
									setSshSessionId(null);
									return;
								}
								setShowSSHModal(false);
								setShowRemoteFolderModal(true);
							} catch (e: any) {
								setSshError(e?.message || String(e));
							} finally {
								setIsConnectingSSH(false);
							}
						}}
					/>
				)}
				{sshSessionId && (
					<SSHTerminal
						sessionId={sshSessionId}
						targetLabel={sshTargetLabel}
						onClose={() => {
							if (sshSessionId) {
								(window as any).electronAPI
									.sshStop(sshSessionId)
									.catch(() => {});
							}
							setSshSessionId(null);
						}}
					/>
				)}
				{showRemoteFolderModal && sshSessionId && (
					<RemoteFolderModal
						username={sshUsername || "root"}
						isWorking={false}
						error={null}
						onCancel={() => setShowRemoteFolderModal(false)}
						onOpen={async (remotePath: string) => {
							try {
								const resp = await (
									window as any
								).electronAPI.sshOpenRemoteFolder(sshSessionId, remotePath);
								if (!resp?.success) {
									alert(resp?.error || "Failed to open remote folder");
									return;
								}
								setShowRemoteFolderModal(false);
							} catch (e) {
								alert(String(e));
							}
						}}
					/>
				)}
			</>
		);
	};

	return (
		<MainContainer>
			{(() => {
				const tabs = renderTabBar();
				return tabs && tabs.length > 0 ? (
					<TabBar 
						ref={tabBarRef} 
						className={`${canScrollLeft ? 'can-scroll-left' : ''} ${canScrollRight ? 'can-scroll-right' : ''}`}
					>
						{tabs}
					</TabBar>
				) : null;
			})()}

			{/* Control bar removed */}

			{renderContent()}

			{/* Floating chat toggle removed; top header button handles reopen */}
		</MainContainer>
	);
};
