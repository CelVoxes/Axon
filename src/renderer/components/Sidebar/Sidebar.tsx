import React, { useState, useEffect, useMemo, useRef } from "react";
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
	FiSearch,
	FiFile,
	FiPlus,
} from "react-icons/fi";
import { useWorkspaceContext } from "../../context/AppContext";
import { ActionButton, EmptyState } from "@components/shared/StyledComponents";
import { Tooltip } from "@components/shared/Tooltip";
import {
	formatFileSize,
	formatDate,
	getFileTypeIcon,
	debounce,
} from "../shared/utils";
import { FileItem, ContextMenuState } from "../shared/interfaces";
import { typography } from "../../styles/design-system";
import { BackendClient } from "../../services/backend/BackendClient";
import { AuthService } from "../../services/backend/AuthService";
import { electronAPI } from "../../utils/electronAPI";

// Visual constants for the tree
const INDENT_WIDTH = 6; // further reduced indentation per level

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
	padding: 6px 12px;
	font-size: ${typography.sm};
	font-weight: 500;
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

const Tabs = styled.div`
	display: inline-flex;
	align-items: center;
	gap: 6px;
`;

const TabButton = styled.button<{ $active?: boolean }>`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 6px;
	background-color: ${(p) => (p.$active ? "#3a3a3f" : "#2d2d30")};
	color: ${(p) => (p.$active ? "#ffffff" : "#cccccc")};
	cursor: pointer;
	padding: 0;
	transition: background-color 0.15s ease, color 0.15s ease,
		border-color 0.15s ease;

	&:hover {
		background-color: ${(p) => (p.$active ? "#44444a" : "#35353a")};
		color: #ffffff;
	}
`;

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

const SidebarContent = styled.div<{ $isDragOver?: boolean }>`
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 8px 0;
	position: relative;
	width: 100%;
	min-height: 0;
	max-height: calc(100vh - 120px);

	/* Custom scrollbar styling */
	scrollbar-width: thin;
	scrollbar-color: #424242 #2d2d30;

	&::-webkit-scrollbar {
		width: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 3px;
	}

	&::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	${(props) =>
		props.$isDragOver &&
		`
		&::after {
			content: "Drop files here";
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 122, 204, 0.2);
			border: 2px dashed #007acc;
			display: flex;
			align-items: center;
			justify-content: center;
			color: #007acc;
			font-size: ${typography.lg};
			font-weight: 500;
			z-index: 1000;
			margin: 0;
			box-sizing: border-box;
		}
	`}
`;

const FileTree = styled.div`
	font-size: ${typography.base};
	width: 100%;
	min-height: 100%;
`;

const FileItem = styled.div<{
	$isDirectory: boolean;
	$level: number;
	$isActive: boolean;
	$isSelected: boolean;
	$isDragOver?: boolean;
	$fileName?: string;
}>`
	display: flex;
	align-items: center;
	padding: 4px 4px;
	cursor: pointer;
	color: #cccccc;
	height: 24px;
	width: 100%;
	box-sizing: border-box;
	background-color: ${(props) =>
		props.$isDragOver && props.$isDirectory
			? "rgba(0, 122, 204, 0.3)"
			: props.$isActive
			? "#007acc"
			: props.$isSelected
			? "#4a4a4a"
			: "transparent"};
	border-left: ${(props) =>
		props.$isDragOver && props.$isDirectory
			? "3px solid #007acc"
			: props.$isActive
			? "3px solid #007acc"
			: props.$isSelected
			? "3px solid #6a6a6a"
			: "3px solid transparent"};
	position: relative;

	&:hover {
		background-color: ${(props) =>
			props.$isActive ? "#007acc" : props.$isSelected ? "#5a5a5a" : "#37373d"};
	}

	.icon {
		margin-right: 4px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: ${(props) =>
			props.$isActive ? "#ffffff" : props.$isSelected ? "#cccccc" : "#858585"};
	}

	.name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 400;
		color: ${(props) =>
			props.$isActive ? "#ffffff" : props.$isSelected ? "#ffffff" : "#cccccc"};
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: ${typography.xs};
		color: ${(props) =>
			props.$isActive
				? "rgba(255,255,255,0.8)"
				: props.$isSelected
				? "rgba(255,255,255,0.7)"
				: "#858585"};
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

const IndentGuides = styled.div<{ $level: number }>`
	display: inline-flex;
	width: ${(p) => p.$level * INDENT_WIDTH}px;
	height: 100%;
	margin-right: 2px;
	pointer-events: none;
`;

const Guide = styled.span`
	width: ${INDENT_WIDTH}px;
	height: 100%;
	display: inline-block;
`;

const ContextMenu = styled.div<{ $visible: boolean; $x: number; $y: number }>`
	position: fixed;
	top: ${(props) => props.$y}px;
	left: ${(props) => props.$x}px;
	background-color: #2d2d30;
	border: 1px solid #404040;
	border-radius: 4px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.8);
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

const DialogOverlay = styled.div`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 10000;
`;

const Dialog = styled.div`
	background: #2d2d30;
	border-radius: 8px;
	border: 1px solid #404040;
	padding: 20px;
	min-width: 300px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
`;

const DialogTitle = styled.h3`
	margin: 0 0 16px 0;
	color: #ffffff;
	font-size: ${typography.lg};
	font-weight: 500;
`;

const DialogInput = styled.input`
	width: 100%;
	padding: 8px 12px;
	background: #3c3c3c;
	border: 1px solid #5a5a5a;
	border-radius: 4px;
	color: #cccccc;
	font-size: ${typography.base};
	margin-bottom: 16px;

	&:focus {
		outline: none;
		border-color: #007acc;
	}

	&::placeholder {
		color: #858585;
	}
`;

const DialogActions = styled.div`
	display: flex;
	gap: 8px;
	justify-content: flex-end;
`;

const DialogButton = styled.button<{ $primary?: boolean }>`
	padding: 8px 16px;
	border-radius: 4px;
	border: none;
	font-size: ${typography.sm};
	cursor: pointer;
	background: ${(props) => (props.$primary ? "#007acc" : "#5a5a5a")};
	color: ${(props) => (props.$primary ? "#ffffff" : "#cccccc")};

	&:hover {
		background: ${(props) => (props.$primary ? "#0086d9" : "#6a6a6a")};
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const BreadcrumbNav = styled.div`
	padding: 6px 4px;
	font-size: ${typography.sm};
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
	display: flex;
	align-items: center;
	gap: 4px;
	flex-wrap: wrap;
	justify-content: space-between;
	min-height: 32px;

	.nav-item {
		cursor: pointer;

		&:hover {
			text-decoration: underline;
		}
	}

	.separator {
		color: #858585;
	}

	.nav-breadcrumbs {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
		flex: 1;
		padding-left: 8px;
	}

	.nav-actions {
		opacity: 0;
		visibility: hidden;
		display: flex;
		align-items: center;
		gap: 1px;
		transition: opacity 0.2s ease, visibility 0.2s ease;
	}

	&:hover .nav-actions {
		opacity: 1;
		visibility: visible;
	}
`;

const ExplorerSection = styled.div`
	&:hover .nav-actions {
		opacity: 1;
		visibility: visible;
	}
`;

// Using shared EmptyState component

const FileTypeIcon = ({ fileName }: { fileName: string }) => {
	const icon = getFileTypeIcon(fileName);
	return (
		<span style={{ fontSize: typography.sm, color: "#858585" }}>{icon}</span>
	);
};

// Search results styling
const SearchResultsContainer = styled.div`
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 4px 0 8px 0;
`;

const SearchSummary = styled.div`
	padding: 6px 12px;
	font-size: ${typography.sm};
	color: #b5b5b5;
	border-bottom: 1px solid #3e3e42;
`;

const SearchResultItem = styled.div`
	padding: 8px 12px;
	border-bottom: 1px solid #2f2f33;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	gap: 4px;

	&:hover {
		background-color: #2a2a2f;
	}
`;

const SearchResultHeader = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	color: #ddd;
`;

const SearchResultPath = styled.div`
	margin-left: 20px;
	color: #8a8a8a;
	font-size: ${typography.xs};
`;

const SearchResultPreview = styled.div`
	margin-left: 20px;
	color: #cccccc;
	font-size: ${typography.sm};
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`;

const MatchRow = styled.div`
	display: flex;
	align-items: flex-start;
	gap: 10px;
	margin-left: 20px;
	padding: 2px 0;
`;

const LineNumber = styled.span`
	display: inline-block;
	min-width: 36px;
	padding: 0 6px;
	text-align: right;
	color: #9a9a9a;
	background: #2a2a2e;
	border: 1px solid #34343a;
	border-radius: 3px;
	font-size: ${typography.xs};
`;

export const Sidebar: React.FC<SidebarProps> = ({ onToggle, ...props }) => {
	const { state, dispatch } = useWorkspaceContext();
	const [activeTab, setActiveTab] = useState<"explorer" | "search">("explorer");
	const [currentPath, setCurrentPath] = useState<string>("");
	const [currentFiles, setCurrentFiles] = useState<FileItem[]>([]);
	const [searchTerm, setSearchTerm] = useState<string>("");

	// Tree state: cache children per directory and which directories are expanded
	const [dirChildren, setDirChildren] = useState<Record<string, FileItem[]>>(
		{}
	);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
		null
	);

	// Detailed search state
	const [detailedQuery, setDetailedQuery] = useState<string>("");
	const [searchInContent, setSearchInContent] = useState<boolean>(true);
	const [matchCase, setMatchCase] = useState<boolean>(false);
	const [useRegex, setUseRegex] = useState<boolean>(false);
	const [extensionsFilter, setExtensionsFilter] = useState<string>("");
	const [includeGlobs, setIncludeGlobs] = useState<string>("");
	const [excludeGlobs, setExcludeGlobs] = useState<string>("");
	const [isSearching, setIsSearching] = useState<boolean>(false);
	const [cancelSearch, setCancelSearch] = useState<boolean>(false);
	const [searchResults, setSearchResults] = useState<
		{ path: string; isDirectory: boolean; preview?: string }[]
	>([]);
	const [searchError, setSearchError] = useState<string | null>(null);

	// Debounced search term for better performance
	const debouncedSearchTerm = useMemo(() => searchTerm, [searchTerm]);
	// Optional: simple sign-in button using Firebase Google popup
	const [authService, setAuthService] = useState<AuthService | null>(null);
	useEffect(() => {
		(async () => {
			try {
				// Initialize lightweight backend client just for auth call
				const backendUrl = await window.electronAPI.getBioragUrl();
				const client = new BackendClient(backendUrl);
				setAuthService(new AuthService(client));
			} catch {
				const client = new BackendClient();
				setAuthService(new AuthService(client));
			}
		})();
	}, []);
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
			setDirChildren({});
			setExpandedDirs(new Set([state.currentWorkspace]));
			setSelectedDirectory(state.currentWorkspace);
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

	// Start a filesystem watcher for the current workspace (main process emits fs-watch-event)
	useEffect(() => {
		(async () => {
			try {
				if (
					state.currentWorkspace &&
					(window as any).electronAPI?.startFsWatch
				) {
					await (window as any).electronAPI.startFsWatch(
						state.currentWorkspace
					);
				}
			} catch {}
		})();
		return () => {
			try {
				if (
					state.currentWorkspace &&
					(window as any).electronAPI?.stopFsWatch
				) {
					const api = (window as any).electronAPI;
					if (api && typeof api.stopFsWatch === "function") {
						try {
							void api.stopFsWatch(state.currentWorkspace);
						} catch {}
					}
				}
			} catch {}
		};
	}, [state.currentWorkspace]);

	// Listen for fs-watch events bridged from main and refresh tree
	useEffect(() => {
		const handler = (_root: string) => {
			// Refresh all expanded directories for a consistent view
			void refreshTree();
		};
		try {
			(window as any).electronAPI?.onFsWatchEvent?.(handler);
		} catch {}
		return () => {
			try {
				(window as any).electronAPI?.removeAllListeners?.("fs-watch-event");
			} catch {}
		};
	}, [state.currentWorkspace]);

	// Close context menu when clicking outside
	useEffect(() => {
		const handleClickOutside = () => {
			setContextMenu({ visible: false, x: 0, y: 0, item: null });
		};

		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, []);

	// Cancellation flag for in-flight searches
	const cancelSearchRef = useRef<boolean>(false);

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
			setDirChildren((prev) => ({ ...prev, [dirPath]: sortedFiles }));
		} catch (error) {
			console.error("Error loading directory:", error);
			setCurrentFiles([]);
		}
	};

	const toggleDirectory = async (item: FileItem) => {
		if (!item.isDirectory) return;
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(item.path)) next.delete(item.path);
			else next.add(item.path);
			return next;
		});

		if (!dirChildren[item.path]) {
			await loadDirectory(item.path);
		}
	};

	const refreshTree = async () => {
		if (!state.currentWorkspace) return;
		const targets = new Set<string>(expandedDirs);
		targets.add(state.currentWorkspace);
		await Promise.all(Array.from(targets).map((p) => loadDirectory(p)));
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
			setSelectedDirectory(item.path);
			void toggleDirectory(item);
		} else {
			// Clear folder selection when clicking on a file
			setSelectedDirectory(null);
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

	// Tree rendering
	const renderTree = (dirPath: string, level: number): React.ReactNode => {
		const children = dirChildren[dirPath] || [];
		return children.map((item) => {
			const isExpanded = item.isDirectory && expandedDirs.has(item.path);
			return (
				<React.Fragment key={item.path}>
					<FileItem
						data-file-item
						$isDirectory={item.isDirectory}
						$level={level}
						$isActive={state.activeFile === item.path}
						$isSelected={
							item.isDirectory
								? selectedDirectory === item.path
								: state.activeFile === item.path && selectedDirectory === null
						}
						$isDragOver={item.isDirectory && dragOverFolder === item.path}
						$fileName={item.name}
						onClick={() => handleItemClick(item)}
						onContextMenu={(e) => handleItemRightClick(e, item)}
						{...(item.isDirectory && {
							onDragOver: (e: React.DragEvent) =>
								handleFolderDragOver(e, item.path),
							onDragLeave: (e: React.DragEvent) =>
								handleFolderDragLeave(e, item.path),
							onDrop: (e: React.DragEvent) => handleFolderDrop(e, item.path),
						})}
					>
						<IndentGuides $level={level} />
						<div className="icon">
							{item.isDirectory ? (
								<FiChevronRight
									size={16}
									style={{
										marginTop: "2px",
										transform: isExpanded ? "rotate(90deg)" : undefined,
									}}
								/>
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
								>
									<FiPlay size={12} />
								</ActionButton>
							)}
							{!item.isDirectory && (
								<Tooltip content="Open in editor" placement="left">
									<ActionButton
										onClick={(e) => {
											e.stopPropagation();
											dispatch({
												type: "OPEN_FILE",
												payload: item.path,
											});
										}}
									>
										<FiEdit3 size={12} />
									</ActionButton>
								</Tooltip>
							)}
							<Tooltip content="More options" placement="left">
								<ActionButton
									onClick={(e) => {
										e.stopPropagation();
										handleItemRightClick(e, item);
									}}
								>
									<FiMoreVertical size={12} />
								</ActionButton>
							</Tooltip>
						</div>
					</FileItem>
					{isExpanded && renderTree(item.path, level + 1)}
				</React.Fragment>
			);
		});
	};

	const buildMatcher = () => {
		try {
			if (!detailedQuery) return null;
			if (useRegex) {
				return new RegExp(detailedQuery, matchCase ? "g" : "gi");
			}
			const q = matchCase ? detailedQuery : detailedQuery.toLowerCase();
			return {
				test: (s: string) => (matchCase ? s : s.toLowerCase()).includes(q),
			} as { test: (s: string) => boolean };
		} catch (e: any) {
			setSearchError(e?.message || String(e));
			return null;
		}
	};

	const isQueryEmpty = (detailedQuery || "").trim().length === 0;

	const escapeRegExp = (input: string): string =>
		input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	const globToRegExp = (pattern: string): RegExp => {
		// Escape regex chars, then convert glob tokens
		const escaped = pattern
			.replace(/[.+^${}()|\\]/g, "\\$&")
			.replace(/\*\*/g, ".*")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, ".");
		return new RegExp(`^${escaped}$`);
	};

	const parseGlobs = (input: string): RegExp[] => {
		return (input || "")
			.split(/[ ,]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map(globToRegExp);
	};

	const renderHighlighted = (text: string): React.ReactNode => {
		if (!detailedQuery) return text;
		try {
			const pattern = useRegex ? detailedQuery : escapeRegExp(detailedQuery);
			const flags = matchCase ? "g" : "gi";
			const re = new RegExp(pattern, flags);
			const nodes: React.ReactNode[] = [];
			let lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = re.exec(text)) !== null) {
				const start = match.index;
				const end = re.lastIndex;
				if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
				const part = text.slice(start, end);
				nodes.push(
					<span
						key={`${start}-${end}`}
						style={{
							backgroundColor: "#4a4f55",
							borderRadius: 2,
							padding: "0 2px",
							color: "#ffffff",
						}}
					>
						{part}
					</span>
				);
				lastIndex = end;
				if (match[0].length === 0) re.lastIndex += 1; // Avoid zero-length loops
			}
			if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
			return nodes.length ? nodes : text;
		} catch {
			return text;
		}
	};

	const relativeToWorkspace = (p: string): string => {
		if (!state.currentWorkspace) return p;
		const rootWithSlash = state.currentWorkspace.endsWith("/")
			? state.currentWorkspace
			: state.currentWorkspace + "/";
		return p.startsWith(rootWithSlash) ? p.slice(rootWithSlash.length) : p;
	};

	const displayResults = useMemo(() => {
		if (isQueryEmpty)
			return [] as { path: string; isDirectory: boolean; preview?: string }[];
		const seen = new Set<string>();
		const unique: { path: string; isDirectory: boolean; preview?: string }[] =
			[];
		for (const r of searchResults) {
			if (seen.has(r.path)) continue;
			seen.add(r.path);
			unique.push(r);
		}
		return unique.filter((r) => !r.isDirectory);
	}, [isQueryEmpty, searchResults]);

	const shouldConsiderFile = (name: string, fullPath: string): boolean => {
		if (!extensionsFilter.trim()) return true;
		const allowed = extensionsFilter
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
		const lower = name.toLowerCase();
		const extOk = allowed.some((ext) =>
			lower.endsWith(ext.startsWith(".") ? ext : `.${ext}`)
		);
		if (!extOk) return false;

		const rel = relativeToWorkspace(fullPath);
		const includeRegs = parseGlobs(includeGlobs);
		const excludeRegs = parseGlobs(excludeGlobs);
		const included = includeRegs.length
			? includeRegs.some((re) => re.test(rel))
			: true;
		const excluded = excludeRegs.some((re) => re.test(rel));
		return included && !excluded;
	};

	const isLikelyTextFile = (fileName: string): boolean => {
		const textExts = [
			".txt",
			".md",
			".py",
			".ts",
			".tsx",
			".js",
			".jsx",
			".json",
			".css",
			".scss",
			".html",
			".yml",
			".yaml",
			".ipynb",
		];
		const lower = fileName.toLowerCase();
		return textExts.some((ext) => lower.endsWith(ext));
	};

	const runDetailedSearch = async () => {
		if (!state.currentWorkspace) return;
		setSearchError(null);
		setSearchResults([]);
		setIsSearching(true);
		setCancelSearch(false);
		cancelSearchRef.current = false;

		const matcher: any = buildMatcher();
		if (!matcher) {
			setIsSearching(false);
			return;
		}

		try {
			const queue: string[] = [state.currentWorkspace];
			while (queue.length && !cancelSearchRef.current) {
				const dir = queue.shift()!;
				const res = await electronAPI.listDirectory(dir);
				const data = res.success && Array.isArray(res.data) ? res.data : [];
				for (const item of data) {
					if (cancelSearchRef.current) break;
					if (item.isDirectory) {
						queue.push(item.path);
						if (matcher.test && matcher.test(item.name)) {
							setSearchResults((prev) => [
								{ path: item.path, isDirectory: true },
								...prev,
							]);
						}
						continue;
					}

					if (!shouldConsiderFile(item.name, item.path)) continue;
					const nameMatches = matcher.test ? matcher.test(item.name) : false;
					// Only include filename matches when not doing content search
					if (!searchInContent && nameMatches) {
						setSearchResults((prev) => [
							{ path: item.path, isDirectory: false },
							...prev,
						]);
					}

					if (searchInContent && isLikelyTextFile(item.name)) {
						try {
							const rf = await electronAPI.readFile(item.path);
							if (rf.success && typeof rf.data === "string") {
								const hayRaw = rf.data;
								const flags = matchCase ? "g" : "gi";
								const pattern = useRegex
									? detailedQuery
									: escapeRegExp(detailedQuery);
								const re = new RegExp(pattern, flags);

								const lines = hayRaw.split(/\r?\n/);
								const matches: { lineNumber: number; lineText: string }[] = [];
								for (let i = 0; i < lines.length; i++) {
									if (cancelSearchRef.current) break;
									const line = lines[i];
									re.lastIndex = 0;
									if (re.test(line)) {
										matches.push({ lineNumber: i + 1, lineText: line });
									}
								}

								if (matches.length > 0) {
									setSearchResults((prev) => [
										{
											path: item.path,
											isDirectory: false,
											preview: `${matches.length} match${
												matches.length === 1 ? "" : "es"
											}`,
											// matches kept for UI rendering; update type as needed
											// eslint-disable-next-line @typescript-eslint/ban-ts-comment
											// @ts-ignore
											matches,
										},
										...prev,
									]);
								}
							}
						} catch {
							// ignore unreadable files
						}
					}
				}
			}
		} catch (e: any) {
			setSearchError(e?.message || String(e));
		} finally {
			setIsSearching(false);
		}
	};

	const stopSearch = () => {
		setCancelSearch(true);
		cancelSearchRef.current = true;
		setIsSearching(false);
	};

	// Live (debounced) search when query/options change
	useEffect(() => {
		if (activeTab !== "search") return;
		const q = (detailedQuery || "").trim();

		// cancel any in-flight search immediately
		cancelSearchRef.current = true;
		setCancelSearch(true);

		if (q.length === 0) {
			setSearchResults([]);
			setIsSearching(false);
			return;
		}

		const timer = setTimeout(() => {
			cancelSearchRef.current = false;
			setCancelSearch(false);
			runDetailedSearch();
		}, 350);

		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		detailedQuery,
		searchInContent,
		matchCase,
		useRegex,
		extensionsFilter,
		activeTab,
	]);
	const [showNewFileDialog, setShowNewFileDialog] = useState(false);
	const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
	const [newFileName, setNewFileName] = useState("");
	const [newFolderName, setNewFolderName] = useState("");
	const [targetDir, setTargetDir] = useState("");
	const [isDragOver, setIsDragOver] = useState(false);
	const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

	const createNewFile = async (parentDir: string) => {
		setTargetDir(parentDir);
		setNewFileName("");
		setShowNewFileDialog(true);
	};

	const createNewFolder = async (parentDir: string) => {
		setTargetDir(parentDir);
		setNewFolderName("");
		setShowNewFolderDialog(true);
	};

	const handleCreateFile = async () => {
		if (!newFileName.trim()) return;

		try {
			const filePath = `${targetDir}/${newFileName}`;
			const result = await electronAPI.writeFile(filePath, "");

			if (result.success) {
				await refreshTree();
				// Open the new file
				dispatch({ type: "OPEN_FILE", payload: filePath });
				setShowNewFileDialog(false);
				setNewFileName("");
			} else {
				throw new Error(result.error || "Failed to create file");
			}
		} catch (error) {
			console.error("Error creating file:", error);
			alert(
				`Failed to create file: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

	const handleCreateFolder = async () => {
		if (!newFolderName.trim()) return;

		try {
			const folderPath = `${targetDir}/${newFolderName}`;
			const result = await electronAPI.createDirectory(folderPath);

			if (result.success) {
				await refreshTree();
				// Expand the parent directory to show the new folder
				setExpandedDirs((prev) => new Set([...prev, targetDir]));
				setShowNewFolderDialog(false);
				setNewFolderName("");
			} else {
				throw new Error(result.error || "Failed to create folder");
			}
		} catch (error) {
			console.error("Error creating folder:", error);
			alert(
				`Failed to create folder: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

	// Helper function to process directory entries using FileSystemAPI
	const processDirectoryEntry = async (
		entry: any,
		targetPath: string
	): Promise<void> => {
		if (entry.isFile) {
			// Handle file entry
			return new Promise((resolve, reject) => {
				entry.file(async (file: File) => {
					try {
						// Get the full relative path
						const relativePath = entry.fullPath.startsWith("/")
							? entry.fullPath.slice(1)
							: entry.fullPath;
						const fullTargetPath = `${targetPath}/${relativePath}`;

						// Create parent directories if needed
						const parentDir = fullTargetPath.substring(
							0,
							fullTargetPath.lastIndexOf("/")
						);
						if (parentDir !== targetPath) {
							const createDirResult = await electronAPI.createDirectory(
								parentDir
							);
							if (!createDirResult.success) {
								console.warn(
									`Could not create parent directory ${parentDir}: ${createDirResult.error}`
								);
							}
						}

						// Read and write file content
						let content: string;
						const isTextFile =
							file.type.startsWith("text/") ||
							file.name.match(
								/\.(txt|md|js|ts|tsx|jsx|py|json|css|html|xml|yaml|yml|sql|sh|bat|csv)$/i
							);

						if (isTextFile || file.type === "") {
							content = await file.text();
						} else {
							const arrayBuffer = await file.arrayBuffer();
							const uint8Array = new Uint8Array(arrayBuffer);
							content = btoa(
								String.fromCharCode.apply(null, Array.from(uint8Array))
							);
						}

						const result = await electronAPI.writeFile(fullTargetPath, content);
						if (!result.success) {
							throw new Error(
								`Failed to write ${relativePath}: ${result.error}`
							);
						}

						console.log(`Created file: ${fullTargetPath}`);
						resolve();
					} catch (error) {
						reject(error);
					}
				}, reject);
			});
		} else if (entry.isDirectory) {
			// Handle directory entry
			const dirPath = `${targetPath}/${entry.name}`;
			const createResult = await electronAPI.createDirectory(dirPath);

			if (!createResult.success) {
				console.warn(
					`Could not create directory ${dirPath}: ${createResult.error}`
				);
			}

			// Process directory contents
			return new Promise((resolve, reject) => {
				const reader = entry.createReader();
				const processEntries = async () => {
					reader.readEntries(async (entries: any[]) => {
						if (entries.length === 0) {
							resolve();
							return;
						}

						try {
							for (const childEntry of entries) {
								await processDirectoryEntry(childEntry, targetPath);
							}
							// Continue reading (directories might have more entries)
							processEntries();
						} catch (error) {
							reject(error);
						}
					}, reject);
				};
				processEntries();
			});
		}
	};

	// Helper function to recursively handle directory drops
	const handleDirectoryDrop = async (directory: File, targetPath: string) => {
		try {
			// Create the directory first
			const dirPath = `${targetPath}/${directory.name}`;
			const createResult = await electronAPI.createDirectory(dirPath);

			if (!createResult.success) {
				throw new Error(
					`Failed to create directory ${directory.name}: ${createResult.error}`
				);
			}

			console.log(`Created directory: ${dirPath}`);
			console.log(
				`Directory ${directory.name} created successfully. Note: Directory contents must be dropped separately due to browser limitations.`
			);
		} catch (error) {
			console.error(`Error handling directory drop ${directory.name}:`, error);
			throw error;
		}
	};

	// Drag and drop handlers
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Only set general drag state if not over a specific folder
		if (!dragOverFolder) {
			setIsDragOver(true);
		}
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Only set to false if we're leaving the sidebar content area
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragOver(false);
			setDragOverFolder(null); // Clear folder drag state too
		}
	};

	const handleDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);

		if (!state.currentWorkspace) return;

		// Check for DataTransferItems first (better for folder handling)
		const items = Array.from(e.dataTransfer.items);
		const files = Array.from(e.dataTransfer.files);

		if (files.length === 0 && items.length === 0) return;

		// Determine target directory (selected folder or workspace root)
		const targetPath = selectedDirectory || state.currentWorkspace;

		// Try to use DataTransfer items API for better directory support
		if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
			const entries = items
				.map((item) => item.webkitGetAsEntry())
				.filter(Boolean);

			if (entries.length > 0) {
				// Analyze what we're dropping using entries
				const fileEntries = entries.filter((entry) => entry && entry.isFile);
				const directoryEntries = entries.filter(
					(entry) => entry && entry.isDirectory
				);

				// Create confirmation message
				const targetName = selectedDirectory
					? selectedDirectory.split("/").pop()
					: "workspace root";
				let confirmMessage = "";

				if (directoryEntries.length > 0 && fileEntries.length > 0) {
					confirmMessage = `Add ${directoryEntries.length} folder${
						directoryEntries.length === 1 ? "" : "s"
					} and ${fileEntries.length} file${
						fileEntries.length === 1 ? "" : "s"
					} to "${targetName}"?`;
				} else if (directoryEntries.length > 0) {
					const dirNames = directoryEntries
						.filter((entry) => entry && entry.name)
						.map((entry) => entry!.name)
						.join(", ");
					confirmMessage = `Add ${directoryEntries.length} folder${
						directoryEntries.length === 1 ? "" : "s"
					} (${dirNames}) with contents to "${targetName}"?`;
				} else {
					const fileNames = fileEntries
						.filter((entry) => entry && entry.name)
						.map((entry) => entry!.name)
						.join(", ");
					confirmMessage = `Add ${fileEntries.length} file${
						fileEntries.length === 1 ? "" : "s"
					} (${fileNames}) to "${targetName}"?`;
				}

				const confirmed = window.confirm(confirmMessage);
				if (!confirmed) return;

				try {
					// Process each entry (file or directory)
					for (const entry of entries) {
						if (entry) {
							await processDirectoryEntry(entry, targetPath);
						}
					}

					// Refresh the file tree to show new files
					await refreshTree();

					const totalItems = fileEntries.length + directoryEntries.length;
					console.log(
						`Successfully processed ${totalItems} item${
							totalItems === 1 ? "" : "s"
						}`
					);
				} catch (error) {
					console.error("Error handling dropped items:", error);
					alert(
						`Failed to process dropped items: ${
							error instanceof Error ? error.message : "Unknown error"
						}`
					);
				}

				return; // Exit early if we used the entries API
			}
		}

		// Fallback to original file-based approach
		const fileEntries: File[] = [];
		const directoryEntries: string[] = [];

		for (const file of files) {
			if (file.type === "" && file.size === 0) {
				directoryEntries.push(file.name);
			} else {
				fileEntries.push(file);
			}
		}

		// Create confirmation message
		const targetName = selectedDirectory
			? selectedDirectory.split("/").pop()
			: "workspace root";
		let confirmMessage = "";

		if (directoryEntries.length > 0 && fileEntries.length > 0) {
			confirmMessage = `Add ${directoryEntries.length} folder${
				directoryEntries.length === 1 ? "" : "s"
			} and ${fileEntries.length} file${
				fileEntries.length === 1 ? "" : "s"
			} to "${targetName}"?`;
		} else if (directoryEntries.length > 0) {
			confirmMessage = `Add ${directoryEntries.length} folder${
				directoryEntries.length === 1 ? "" : "s"
			} (${directoryEntries.join(
				", "
			)}) to "${targetName}"? Note: Only empty folders will be created.`;
		} else {
			confirmMessage = `Add ${fileEntries.length} file${
				fileEntries.length === 1 ? "" : "s"
			} (${fileEntries.map((f) => f.name).join(", ")}) to "${targetName}"?`;
		}

		const confirmed = window.confirm(confirmMessage);
		if (!confirmed) return;

		try {
			for (const file of files) {
				// Handle directories differently - recursively copy their contents
				if (file.type === "" && file.size === 0) {
					// This is likely a directory
					console.log("Processing directory:", file.name);
					try {
						await handleDirectoryDrop(file, targetPath);
					} catch (dirError) {
						console.error(`Error processing directory ${file.name}:`, dirError);
						// Continue with other items instead of stopping
					}
					continue;
				}

				// Check if file still exists and is readable
				try {
					let content: string;

					// Additional check: if file.type is empty but size is 0, it might still be a directory
					// Try to read it first and catch the error
					try {
						// Try to determine if it's a text file
						const isTextFile =
							file.type.startsWith("text/") ||
							file.name.match(
								/\.(txt|md|js|ts|tsx|jsx|py|json|css|html|xml|yaml|yml|sql|sh|bat|csv)$/i
							);

						if (isTextFile || file.type === "") {
							// Read as text
							content = await file.text();
						} else {
							// For binary files, read as array buffer and convert to base64
							const arrayBuffer = await file.arrayBuffer();
							const uint8Array = new Uint8Array(arrayBuffer);
							content = btoa(
								String.fromCharCode.apply(null, Array.from(uint8Array))
							);
							console.warn(
								`Binary file ${file.name} converted to base64. May not be usable.`
							);
						}
					} catch (readError) {
						// If reading fails, this might be a directory that wasn't caught by our initial check
						if (
							readError instanceof DOMException &&
							readError.message.includes("could not be found")
						) {
							console.log(
								`Item ${file.name} appears to be a directory, creating folder instead`
							);
							await handleDirectoryDrop(file, targetPath);
							continue;
						}
						throw readError; // Re-throw if it's a different error
					}

					const targetFilePath = `${targetPath}/${file.name}`;

					const result = await electronAPI.writeFile(targetFilePath, content);
					if (!result.success) {
						throw new Error(`Failed to write ${file.name}: ${result.error}`);
					}
				} catch (fileError) {
					console.error(`Error processing file ${file.name}:`, fileError);
					// Continue with other files instead of stopping
					continue;
				}
			}

			// Refresh the file tree to show new files
			await refreshTree();

			// Show success message
			const fileCount = files.length;
			console.log(
				`Successfully dropped ${fileCount} file${fileCount === 1 ? "" : "s"}`
			);
		} catch (error) {
			console.error("Error handling dropped files:", error);
			alert(
				`Failed to drop files: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

	// Folder-specific drag handlers
	const handleFolderDragOver = (e: React.DragEvent, folderPath: string) => {
		e.preventDefault();
		e.stopPropagation();
		setDragOverFolder(folderPath);
		setIsDragOver(false); // Clear general drag state
	};

	const handleFolderDragLeave = (e: React.DragEvent, folderPath: string) => {
		e.preventDefault();
		e.stopPropagation();
		// Only clear if we're actually leaving this folder
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setDragOverFolder(null);
		}
	};

	const handleFolderDrop = async (e: React.DragEvent, folderPath: string) => {
		e.preventDefault();
		e.stopPropagation();
		setDragOverFolder(null);
		setIsDragOver(false); // Clear general drag state

		// Check for DataTransferItems first (better for folder handling)
		const items = Array.from(e.dataTransfer.items);
		const files = Array.from(e.dataTransfer.files);

		if (files.length === 0 && items.length === 0) return;

		// Try to use DataTransfer items API for better directory support
		if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
			const entries = items
				.map((item) => item.webkitGetAsEntry())
				.filter(Boolean);

			if (entries.length > 0) {
				// Analyze what we're dropping using entries
				const fileEntries = entries.filter((entry) => entry && entry.isFile);
				const directoryEntries = entries.filter(
					(entry) => entry && entry.isDirectory
				);

				// Create confirmation message
				const folderName = folderPath.split("/").pop() || folderPath;
				let confirmMessage = "";

				if (directoryEntries.length > 0 && fileEntries.length > 0) {
					confirmMessage = `Add ${directoryEntries.length} folder${
						directoryEntries.length === 1 ? "" : "s"
					} and ${fileEntries.length} file${
						fileEntries.length === 1 ? "" : "s"
					} to "${folderName}"?`;
				} else if (directoryEntries.length > 0) {
					const dirNames = directoryEntries
						.filter((entry) => entry && entry.name)
						.map((entry) => entry!.name)
						.join(", ");
					confirmMessage = `Add ${directoryEntries.length} folder${
						directoryEntries.length === 1 ? "" : "s"
					} (${dirNames}) with contents to "${folderName}"?`;
				} else {
					const fileNames = fileEntries
						.filter((entry) => entry && entry.name)
						.map((entry) => entry!.name)
						.join(", ");
					confirmMessage = `Add ${fileEntries.length} file${
						fileEntries.length === 1 ? "" : "s"
					} (${fileNames}) to "${folderName}"?`;
				}

				const confirmed = window.confirm(confirmMessage);
				if (!confirmed) return;

				try {
					// Process each entry (file or directory)
					for (const entry of entries) {
						if (entry) {
							await processDirectoryEntry(entry, folderPath);
						}
					}

					// Refresh the file tree to show new files
					await refreshTree();

					const totalItems = fileEntries.length + directoryEntries.length;
					console.log(
						`Successfully processed ${totalItems} item${
							totalItems === 1 ? "" : "s"
						} into ${folderPath}`
					);
				} catch (error) {
					console.error("Error handling dropped items:", error);
					alert(
						`Failed to process dropped items: ${
							error instanceof Error ? error.message : "Unknown error"
						}`
					);
				}

				return; // Exit early if we used the entries API
			}
		}

		// Fallback to original file-based approach
		const fileEntries: File[] = [];
		const directoryEntries: string[] = [];

		for (const file of files) {
			if (file.type === "" && file.size === 0) {
				directoryEntries.push(file.name);
			} else {
				fileEntries.push(file);
			}
		}

		// Create confirmation message
		const folderName = folderPath.split("/").pop() || folderPath;
		let confirmMessage = "";

		if (directoryEntries.length > 0 && fileEntries.length > 0) {
			confirmMessage = `Add ${directoryEntries.length} folder${
				directoryEntries.length === 1 ? "" : "s"
			} and ${fileEntries.length} file${
				fileEntries.length === 1 ? "" : "s"
			} to "${folderName}"?`;
		} else if (directoryEntries.length > 0) {
			confirmMessage = `Add ${directoryEntries.length} folder${
				directoryEntries.length === 1 ? "" : "s"
			} (${directoryEntries.join(
				", "
			)}) to "${folderName}"? Note: Only empty folders will be created.`;
		} else {
			confirmMessage = `Add ${fileEntries.length} file${
				fileEntries.length === 1 ? "" : "s"
			} (${fileEntries.map((f) => f.name).join(", ")}) to "${folderName}"?`;
		}

		const confirmed = window.confirm(confirmMessage);
		if (!confirmed) return;

		try {
			for (const file of files) {
				// Handle directories differently - recursively copy their contents
				if (file.type === "" && file.size === 0) {
					// This is likely a directory
					console.log("Processing directory:", file.name);
					try {
						await handleDirectoryDrop(file, folderPath);
					} catch (dirError) {
						console.error(`Error processing directory ${file.name}:`, dirError);
						// Continue with other items instead of stopping
					}
					continue;
				}

				try {
					let content: string;

					// Additional check: try to read and catch directory errors
					try {
						const isTextFile =
							file.type.startsWith("text/") ||
							file.name.match(
								/\.(txt|md|js|ts|tsx|jsx|py|json|css|html|xml|yaml|yml|sql|sh|bat|csv)$/i
							);

						if (isTextFile || file.type === "") {
							content = await file.text();
						} else {
							const arrayBuffer = await file.arrayBuffer();
							const uint8Array = new Uint8Array(arrayBuffer);
							content = btoa(
								String.fromCharCode.apply(null, Array.from(uint8Array))
							);
							console.warn(
								`Binary file ${file.name} converted to base64. May not be usable.`
							);
						}
					} catch (readError) {
						// If reading fails, this might be a directory that wasn't caught by our initial check
						if (
							readError instanceof DOMException &&
							readError.message.includes("could not be found")
						) {
							console.log(
								`Item ${file.name} appears to be a directory, creating folder instead`
							);
							await handleDirectoryDrop(file, folderPath);
							continue;
						}
						throw readError; // Re-throw if it's a different error
					}

					const targetFilePath = `${folderPath}/${file.name}`;

					const result = await electronAPI.writeFile(targetFilePath, content);
					if (!result.success) {
						throw new Error(`Failed to write ${file.name}: ${result.error}`);
					}
				} catch (fileError) {
					console.error(`Error processing file ${file.name}:`, fileError);
					continue;
				}
			}

			await refreshTree();
			console.log(
				`Successfully dropped ${files.length} file${
					files.length === 1 ? "" : "s"
				} into ${folderPath}`
			);
		} catch (error) {
			console.error("Error handling dropped files:", error);
			alert(
				`Failed to drop files: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

	const handleOpenWorkspaceSelector = async () => {
		try {
			// Use the electron API to open a directory selection dialog
			const result = await electronAPI.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select Workspace Folder",
			});

			if (
				result.success &&
				result.data &&
				!result.data.canceled &&
				result.data.filePaths.length > 0
			) {
				const selectedPath = result.data.filePaths[0];

				// Update the workspace in the global state
				dispatch({ type: "SET_WORKSPACE", payload: selectedPath });

				// Clear current state and load the new workspace
				setCurrentPath(selectedPath);
				setDirChildren({});
				setExpandedDirs(new Set([selectedPath]));
				setSelectedDirectory(selectedPath);
				await loadDirectory(selectedPath);

				console.log(`Workspace changed to: ${selectedPath}`);
			}
		} catch (error) {
			console.error("Error opening workspace selector:", error);
			alert(
				`Failed to open workspace selector: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	};

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
							// Refresh expanded tree (includes parent)
							await refreshTree();
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
			{/* Tabs Header */}
			<SidebarHeader>
				<Tabs>
					<Tooltip content="Explorer" placement="bottom">
						<TabButton
							$active={activeTab === "explorer"}
							onClick={() => setActiveTab("explorer")}
						>
							<FiFolder size={14} />
						</TabButton>
					</Tooltip>
					<Tooltip content="Search" placement="bottom">
						<TabButton
							$active={activeTab === "search"}
							onClick={() => setActiveTab("search")}
						>
							<FiSearch size={14} />
						</TabButton>
					</Tooltip>
				</Tabs>

				<HeaderActions>
					{/* {authService && (
						<ActionButton
							onClick={async () => {
								try {
									await authService.loginWithFirebaseGooglePopup();
									alert("Signed in");
								} catch (e: any) {
									alert(e?.message || String(e));
								}
							}}
						>
							Sign in
						</ActionButton>
					)} */}
				</HeaderActions>
			</SidebarHeader>

			{activeTab === "explorer" ? null : (
				<SearchContainer>
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						<input
							style={{
								width: "100%",
								padding: "6px 8px",
								backgroundColor: "#3c3c3c",
								border: "1px solid #5a5a5a",
								borderRadius: 4,
								color: "#cccccc",
							}}
							placeholder="Search"
							value={detailedQuery}
							onChange={(e) => setDetailedQuery(e.target.value)}
						/>
						<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
							<label
								style={{
									display: "flex",
									gap: 6,
									alignItems: "center",
									color: "#cccccc",
									fontSize: 12,
								}}
							>
								<input
									type="checkbox"
									checked={searchInContent}
									onChange={(e) => setSearchInContent(e.target.checked)}
								/>
								Search in file contents
							</label>
							<label
								style={{
									display: "flex",
									gap: 6,
									alignItems: "center",
									color: "#cccccc",
									fontSize: 12,
								}}
							>
								<input
									type="checkbox"
									checked={matchCase}
									onChange={(e) => setMatchCase(e.target.checked)}
								/>
								Match case
							</label>
							<label
								style={{
									display: "flex",
									gap: 6,
									alignItems: "center",
									color: "#cccccc",
									fontSize: 12,
								}}
							>
								<input
									type="checkbox"
									checked={useRegex}
									onChange={(e) => setUseRegex(e.target.checked)}
								/>
								Use regex
							</label>
						</div>
						<input
							style={{
								width: "100%",
								padding: "6px 8px",
								backgroundColor: "#3c3c3c",
								border: "1px solid #5a5a5a",
								borderRadius: 4,
								color: "#cccccc",
							}}
							placeholder="Extensions filter (e.g. .ts,.tsx,.py)"
							value={extensionsFilter}
							onChange={(e) => setExtensionsFilter(e.target.value)}
						/>
						<input
							style={{
								width: "100%",
								padding: "6px 8px",
								backgroundColor: "#3c3c3c",
								border: "1px solid #5a5a5a",
								borderRadius: 4,
								color: "#cccccc",
							}}
							placeholder="files to include (globs, e.g. src/**/*.{ts,tsx})"
							value={includeGlobs}
							onChange={(e) => setIncludeGlobs(e.target.value)}
						/>
						<input
							style={{
								width: "100%",
								padding: "6px 8px",
								backgroundColor: "#3c3c3c",
								border: "1px solid #5a5a5a",
								borderRadius: 4,
								color: "#cccccc",
							}}
							placeholder="files to exclude (globs, e.g. **/node_modules/**)"
							value={excludeGlobs}
							onChange={(e) => setExcludeGlobs(e.target.value)}
						/>
					</div>
				</SearchContainer>
			)}

			{activeTab === "explorer" ? (
				<ExplorerSection>
					{state.currentWorkspace && (
						<BreadcrumbNav>
							<div className="nav-breadcrumbs">
								{getBreadcrumbs().map((crumb, index, array) => (
									<React.Fragment key={crumb.path}>
										<span
											className="nav-item"
											onClick={() => {
												// If clicking on the workspace root (first breadcrumb), open workspace selector
												if (
													index === 0 &&
													crumb.path === state.currentWorkspace
												) {
													handleOpenWorkspaceSelector();
												} else {
													// Navigate to that directory
													setCurrentPath(crumb.path);
													loadDirectory(crumb.path);
												}
											}}
											style={{
												cursor: "pointer",
												...(index === 0 && {
													color: "#ddd",
												}),
											}}
											title={
												index === 0
													? "Click to open a different workspace"
													: `Navigate to ${crumb.name}`
											}
										>
											{crumb.name}
										</span>
										{index < array.length - 1 && (
											<span className="separator">/</span>
										)}
									</React.Fragment>
								))}
							</div>
							<div className="nav-actions">
								<Tooltip
									content={
										selectedDirectory
											? "New file in selected folder"
											: "New file in workspace root"
									}
									placement="bottom"
								>
									<ActionButton
										onClick={() => {
											const targetPath =
												selectedDirectory || state.currentWorkspace;
											if (targetPath) createNewFile(targetPath);
										}}
										style={{ padding: "4px" }}
									>
										<FiFile size={12} />
									</ActionButton>
								</Tooltip>
								<Tooltip
									content={
										selectedDirectory
											? "New folder in selected folder"
											: "New folder in workspace root"
									}
									placement="bottom"
								>
									<ActionButton
										onClick={() => {
											const targetPath =
												selectedDirectory || state.currentWorkspace;
											if (targetPath) createNewFolder(targetPath);
										}}
										style={{ padding: "4px" }}
									>
										<FiFolder size={12} />
									</ActionButton>
								</Tooltip>
								<Tooltip content="Refresh file list" placement="bottom">
									<ActionButton
										onClick={() => refreshTree()}
										style={{ padding: "4px" }}
									>
										<FiRefreshCw size={12} />
									</ActionButton>
								</Tooltip>
							</div>
						</BreadcrumbNav>
					)}

					<SidebarContent
						$isDragOver={isDragOver}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
						onClick={(e) => {
							// Clear folder selection when clicking on empty space
							// Check if the click target is the SidebarContent itself or FileTree
							const target = e.target as HTMLElement;
							const isEmptySpaceClick =
								target.closest("[data-file-item]") === null;
							if (isEmptySpaceClick) {
								setSelectedDirectory(null);
							}
						}}
					>
						{state.currentWorkspace ? (
							<FileTree>
								{state.currentWorkspace &&
									renderTree(state.currentWorkspace, 0)}
							</FileTree>
						) : (
							<EmptyState>
								<FiFolder
									size={24}
									style={{ marginBottom: "8px", opacity: 0.5 }}
								/>
								<div>No workspace opened</div>
								<div style={{ fontSize: "10px", marginTop: "4px" }}>
									Open a workspace to start exploring files
								</div>
							</EmptyState>
						)}
					</SidebarContent>
				</ExplorerSection>
			) : (
				<SidebarContent>
					{/* When query is empty, intentionally render nothing */}
					{!isQueryEmpty && (
						<SearchResultsContainer>
							<SearchSummary>
								{isSearching
									? "Searching..."
									: `${displayResults.length} file${
											displayResults.length === 1 ? "" : "s"
									  }`}
							</SearchSummary>
							{displayResults.map((r) => {
								const fileName = r.path.split("/").pop() || r.path;
								const relPath = relativeToWorkspace(r.path);
								return (
									<SearchResultItem
										key={r.path}
										onClick={() =>
											dispatch({ type: "OPEN_FILE", payload: r.path })
										}
										title={r.path}
									>
										<SearchResultHeader>
											<FileTypeIcon fileName={fileName} />
											<div
												style={{ overflow: "hidden", textOverflow: "ellipsis" }}
											>
												{renderHighlighted(fileName)}
											</div>
										</SearchResultHeader>
										<SearchResultPath>{relPath}</SearchResultPath>
										{Array.isArray((r as any).matches) &&
											(r as any).matches
												.slice(0, 5)
												.map((m: any, idx: number) => (
													<MatchRow key={`${r.path}-m-${idx}`}>
														<LineNumber>{m.lineNumber}</LineNumber>
														<div style={{ flex: 1, minWidth: 0 }}>
															{renderHighlighted(m.lineText)}
														</div>
													</MatchRow>
												))}
									</SearchResultItem>
								);
							})}
							{!isSearching && displayResults.length === 0 && (
								<div
									style={{ padding: "12px", color: "#8a8a8a", fontSize: 12 }}
								>
									No results
								</div>
							)}
						</SearchResultsContainer>
					)}
				</SidebarContent>
			)}

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

			{/* New File Dialog */}
			{showNewFileDialog && (
				<DialogOverlay onClick={() => setShowNewFileDialog(false)}>
					<Dialog onClick={(e) => e.stopPropagation()}>
						<DialogTitle>Create New File</DialogTitle>
						<DialogInput
							type="text"
							placeholder="Enter file name (e.g., script.py, README.md)"
							value={newFileName}
							onChange={(e) => setNewFileName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleCreateFile();
								} else if (e.key === "Escape") {
									setShowNewFileDialog(false);
								}
							}}
							autoFocus
						/>
						<DialogActions>
							<DialogButton onClick={() => setShowNewFileDialog(false)}>
								Cancel
							</DialogButton>
							<DialogButton
								$primary
								onClick={handleCreateFile}
								disabled={!newFileName.trim()}
							>
								Create
							</DialogButton>
						</DialogActions>
					</Dialog>
				</DialogOverlay>
			)}

			{/* New Folder Dialog */}
			{showNewFolderDialog && (
				<DialogOverlay onClick={() => setShowNewFolderDialog(false)}>
					<Dialog onClick={(e) => e.stopPropagation()}>
						<DialogTitle>Create New Folder</DialogTitle>
						<DialogInput
							type="text"
							placeholder="Enter folder name"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleCreateFolder();
								} else if (e.key === "Escape") {
									setShowNewFolderDialog(false);
								}
							}}
							autoFocus
						/>
						<DialogActions>
							<DialogButton onClick={() => setShowNewFolderDialog(false)}>
								Cancel
							</DialogButton>
							<DialogButton
								$primary
								onClick={handleCreateFolder}
								disabled={!newFolderName.trim()}
							>
								Create
							</DialogButton>
						</DialogActions>
					</Dialog>
				</DialogOverlay>
			)}
		</SidebarContainer>
	);
};
