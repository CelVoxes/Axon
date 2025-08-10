import React, { useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import {
	FiFolder,
	FiChevronRight,
	FiPlay,
	FiEdit3,
	FiRefreshCw,
	FiMoreVertical,
	FiCopy,
	FiExternalLink,
	FiTrash2,
} from "react-icons/fi";
import { useWorkspaceContext } from "../../context/AppContext";
import { ActionButton, EmptyState } from "@components/shared/StyledComponents";
import {
	formatFileSize,
	formatDate,
	getFileTypeIcon,
	debounce,
} from "../shared/utils";
import { FileItem, ContextMenuState } from "../shared/interfaces";
import { typography } from "../../styles/design-system";

interface SidebarProps {
	onToggle: () => void;
	"data-layout-role"?: string;
}

const SidebarContainer = styled.div<{ $collapsed: boolean }>`
	width: 100%;
	height: 100%;
	background-color: #1a1a1a;
	border-right: 1px solid #2a2a2a;
	display: flex;
	flex-direction: column;
	overflow: hidden;
`;

const SidebarHeader = styled.div`
	padding: 8px 12px;
	font-size: ${typography.xs};
	font-weight: 600;
	color: #cccccc;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;

const HeaderActions = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
`;

// Using shared ActionButton component

const SearchContainer = styled.div`
	padding: 8px 12px;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
`;

const SearchInput = styled.input`
	width: 100%;
	padding: 6px 8px;
	background-color: #3c3c3c;
	border: 1px solid #5a5a5a;
	border-radius: 4px;
	color: #cccccc;
	font-size: ${typography.sm};

	&:focus {
		outline: none;
		border-color: #007acc;
	}

	&::placeholder {
		color: #858585;
	}
`;

const SidebarContent = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 8px 0;
`;

const FileTree = styled.div`
	font-size: ${typography.base};
`;

const FileItem = styled.div<{
	$isDirectory: boolean;
	$level: number;
	$isActive: boolean;
	$fileName?: string;
}>`
	display: flex;
	align-items: center;
	padding: 4px 8px 4px ${(props) => 8 + props.$level * 16}px;
	cursor: pointer;
	color: #cccccc;
	height: 24px;
	background-color: ${(props) => (props.$isActive ? "#37373d" : "transparent")};

	&:hover {
		background-color: #37373d;
	}

	.icon {
		margin-right: 6px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #858585;
	}

	.name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: ${(props) => (props.$isActive ? "600" : "400")};
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: ${typography.xs};
		color: #858585;
		margin-right: 4px;
	}

	.actions {
		display: none;
		align-items: center;
		gap: 4px;
		margin-left: 8px;
	}

	&:hover .actions {
		display: flex;
	}
`;

const ContextMenu = styled.div<{ $visible: boolean; $x: number; $y: number }>`
	position: fixed;
	top: ${(props) => props.$y}px;
	left: ${(props) => props.$x}px;
	background-color: #2d2d30;
	border: 1px solid #3e3e42;
	border-radius: 4px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	z-index: 1000;
	display: ${(props) => (props.$visible ? "block" : "none")};
	min-width: 160px;
`;

const ContextMenuItem = styled.div`
	padding: 8px 12px;
	cursor: pointer;
	color: #cccccc;
	font-size: ${typography.sm};
	display: flex;
	align-items: center;
	gap: 8px;

	&:hover {
		background-color: #37373d;
	}

	&.danger {
		color: #f48771;
	}

	&.danger:hover {
		background-color: #4a2a2a;
	}
`;

const BreadcrumbNav = styled.div`
	padding: 8px 12px;
	font-size: ${typography.sm};
	color: #858585;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
	display: flex;
	align-items: center;
	gap: 4px;
	flex-wrap: wrap;

	.nav-item {
		cursor: pointer;
		color: #007acc;

		&:hover {
			text-decoration: underline;
		}
	}

	.separator {
		color: #858585;
	}
`;

// Using shared EmptyState component

const FileTypeIcon = ({ fileName }: { fileName: string }) => {
	const icon = getFileTypeIcon(fileName);
	return (
		<span style={{ fontSize: typography.sm, color: "#858585" }}>{icon}</span>
	);
};

export const Sidebar: React.FC<SidebarProps> = ({ onToggle, ...props }) => {
	const { state, dispatch } = useWorkspaceContext();
	const [currentPath, setCurrentPath] = useState<string>("");
	const [currentFiles, setCurrentFiles] = useState<FileItem[]>([]);
	const [searchTerm, setSearchTerm] = useState<string>("");

	// Debounced search term for better performance
	const debouncedSearchTerm = useMemo(() => searchTerm, [searchTerm]);
	const [contextMenu, setContextMenu] = useState<{
		visible: boolean;
		x: number;
		y: number;
		item: FileItem | null;
	}>({ visible: false, x: 0, y: 0, item: null });

	// Load file tree when workspace changes
	useEffect(() => {
		if (state.currentWorkspace) {
			setCurrentPath(state.currentWorkspace);
			loadDirectory(state.currentWorkspace);
		}
	}, [state.currentWorkspace]);

	// Listen for file tree refresh events from the autonomous agent
	useEffect(() => {
		const handleRefresh = () => {
			if (currentPath) {
				loadDirectory(currentPath);
			}
		};

		window.addEventListener("refreshFileTree", handleRefresh);
		return () => window.removeEventListener("refreshFileTree", handleRefresh);
	}, [currentPath]);

	// Close context menu when clicking outside
	useEffect(() => {
		const handleClickOutside = () => {
			setContextMenu({ visible: false, x: 0, y: 0, item: null });
		};

		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, []);

	const loadDirectory = async (dirPath: string) => {
		try {
			// Check if electronAPI is available
			if (!window.electronAPI || !window.electronAPI.listDirectory) {
				console.error("Electron API not available for directory listing");
				setCurrentFiles([]);
				return;
			}

			const files = await window.electronAPI.listDirectory(dirPath);

			// Sort: directories first, then files, both alphabetically
			const sortedFiles = files.sort((a, b) => {
				if (a.isDirectory !== b.isDirectory) {
					return a.isDirectory ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

			setCurrentFiles(sortedFiles);
		} catch (error) {
			console.error("Error loading directory:", error);
			setCurrentFiles([]);
		}
	};

	const openInSystem = async (filePath: string) => {
		try {
			// Check if electronAPI is available
			if (!window.electronAPI || !window.electronAPI.openFile) {
				console.error("Electron API not available for opening file");
				return;
			}

			await window.electronAPI.openFile(filePath);
		} catch (error) {
			console.error("Error opening file in system:", error);
		}
	};

	const handleItemClick = (item: FileItem) => {
		if (item.isDirectory) {
			setCurrentPath(item.path);
			loadDirectory(item.path);
		} else {
			dispatch({ type: "OPEN_FILE", payload: item.path });
		}
	};

	const handleItemRightClick = (e: React.MouseEvent, item: FileItem) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({
			visible: true,
			x: e.clientX,
			y: e.clientY,
			item,
		});
	};

	const navigateToParent = () => {
		if (!state.currentWorkspace || currentPath === state.currentWorkspace) {
			return;
		}

		const parentPath = currentPath.split("/").slice(0, -1).join("/");
		if (parentPath && parentPath.length >= state.currentWorkspace.length) {
			setCurrentPath(parentPath);
			loadDirectory(parentPath);
		}
	};

	// Removed unused navigateToWorkspaceRoot function

	const getBreadcrumbs = () => {
		if (!state.currentWorkspace || !currentPath) return [];

		const workspaceName =
			state.currentWorkspace.split("/").pop() || "Workspace";
		const relativePath = currentPath.replace(state.currentWorkspace, "");

		if (!relativePath || relativePath === "/") {
			return [{ name: workspaceName, path: state.currentWorkspace }];
		}

		const parts = relativePath.split("/").filter(Boolean);
		const breadcrumbs = [{ name: workspaceName, path: state.currentWorkspace }];

		let buildPath = state.currentWorkspace;
		for (const part of parts) {
			buildPath += "/" + part;
			breadcrumbs.push({ name: part, path: buildPath });
		}

		return breadcrumbs;
	};

	const filteredFiles = React.useMemo(
		() =>
			currentFiles.filter((item) =>
				item.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
			),
		[currentFiles, debouncedSearchTerm]
	);

	const handleContextMenuAction = async (action: string) => {
		if (!contextMenu.item) return;

		try {
			switch (action) {
				case "open":
					handleItemClick(contextMenu.item);
					break;
				case "open-external":
					await openInSystem(contextMenu.item.path);
					break;
				case "copy-path":
					await navigator.clipboard.writeText(contextMenu.item.path);
					break;
				case "delete":
					// Show confirmation dialog
					const confirmed = window.confirm(
						`Are you sure you want to delete "${contextMenu.item.name}"?`
					);

					if (confirmed) {
						// Check if electronAPI is available
						if (
							!window.electronAPI ||
							!window.electronAPI.deleteDirectory ||
							!window.electronAPI.deleteFile
						) {
							throw new Error(
								"Electron API not available for delete operations"
							);
						}

						let result;
						if (contextMenu.item.isDirectory) {
							result = await window.electronAPI.deleteDirectory(
								contextMenu.item.path
							);
						} else {
							result = await window.electronAPI.deleteFile(
								contextMenu.item.path
							);
						}

						if (result.success) {
							// Refresh the file tree
							loadDirectory(currentPath);
						} else {
							throw new Error(result.error || "Unknown error occurred");
						}
					}
					break;
			}
		} catch (error) {
			console.error("Error in context menu action:", error);
			alert(
				`Operation failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		} finally {
			setContextMenu({ visible: false, x: 0, y: 0, item: null });
		}
	};

	return (
		<SidebarContainer $collapsed={false} {...props}>
			{/* Explorer Section */}
			<SidebarHeader>
				Explorer
				<HeaderActions>
					<ActionButton
						onClick={() => loadDirectory(currentPath)}
						title="Refresh"
					>
						<FiRefreshCw size={12} />
					</ActionButton>
				</HeaderActions>
			</SidebarHeader>

			{/* Search */}
			<SearchContainer>
				<SearchInput
					placeholder="Search files..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
				/>
			</SearchContainer>

			{state.currentWorkspace && (
				<BreadcrumbNav>
					{getBreadcrumbs().map((crumb, index, array) => (
						<React.Fragment key={crumb.path}>
							<span
								className="nav-item"
								onClick={() => {
									setCurrentPath(crumb.path);
									loadDirectory(crumb.path);
								}}
							>
								{crumb.name}
							</span>
							{index < array.length - 1 && <span className="separator">/</span>}
						</React.Fragment>
					))}
				</BreadcrumbNav>
			)}

			<SidebarContent>
				{state.currentWorkspace ? (
					<FileTree>
						{currentPath !== state.currentWorkspace && (
							<FileItem
								$isDirectory={true}
								$level={0}
								$isActive={false}
								$fileName=".."
								onClick={navigateToParent}
							>
								<div className="icon">
									<FiChevronRight
										size={12}
										style={{ transform: "rotate(180deg)" }}
									/>
								</div>
								<div className="name">..</div>
							</FileItem>
						)}

						{filteredFiles.map((item) => (
							<FileItem
								key={item.path}
								$isDirectory={item.isDirectory}
								$level={0}
								$isActive={state.activeFile === item.path}
								$fileName={item.name}
								onClick={() => handleItemClick(item)}
								onContextMenu={(e) => handleItemRightClick(e, item)}
							>
								<div className="icon">
									{item.isDirectory ? (
										<FiFolder size={12} />
									) : (
										<FileTypeIcon fileName={item.name} />
									)}
								</div>
								<div className="name">{item.name}</div>
								<div className="meta">
									{item.size && !item.isDirectory && (
										<span>{formatFileSize(item.size)}</span>
									)}
									{item.modified && <span>{formatDate(item.modified)}</span>}
								</div>
								<div className="actions">
									{!item.isDirectory && item.name.endsWith(".ipynb") && (
										<ActionButton
											onClick={(e) => {
												e.stopPropagation();
												openInSystem(item.path);
											}}
											title="Open in Jupyter/VS Code"
										>
											<FiPlay size={12} />
										</ActionButton>
									)}
									{!item.isDirectory && (
										<ActionButton
											onClick={(e) => {
												e.stopPropagation();
												dispatch({ type: "OPEN_FILE", payload: item.path });
											}}
											title="Open in editor"
										>
											<FiEdit3 size={12} />
										</ActionButton>
									)}
									<ActionButton
										onClick={(e) => {
											e.stopPropagation();
											handleItemRightClick(e, item);
										}}
										title="More options"
									>
										<FiMoreVertical size={12} />
									</ActionButton>
								</div>
							</FileItem>
						))}
					</FileTree>
				) : (
					<EmptyState>
						<FiFolder size={24} style={{ marginBottom: "8px", opacity: 0.5 }} />
						<div>No workspace opened</div>
						<div style={{ fontSize: "10px", marginTop: "4px" }}>
							Open a workspace to start exploring files
						</div>
					</EmptyState>
				)}
			</SidebarContent>

			{/* Context Menu */}
			<ContextMenu
				$visible={contextMenu.visible}
				$x={contextMenu.x}
				$y={contextMenu.y}
			>
				<ContextMenuItem onClick={() => handleContextMenuAction("open")}>
					<FiEdit3 size={12} />
					Open
				</ContextMenuItem>
				<ContextMenuItem
					onClick={() => handleContextMenuAction("open-external")}
				>
					<FiExternalLink size={12} />
					Open in System
				</ContextMenuItem>
				<ContextMenuItem onClick={() => handleContextMenuAction("copy-path")}>
					<FiCopy size={12} />
					Copy Path
				</ContextMenuItem>
				<ContextMenuItem
					className="danger"
					onClick={() => handleContextMenuAction("delete")}
				>
					<FiTrash2 size={12} />
					Delete
				</ContextMenuItem>
			</ContextMenu>
		</SidebarContainer>
	);
};
