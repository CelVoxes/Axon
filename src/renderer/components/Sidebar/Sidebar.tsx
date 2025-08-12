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
import { electronAPI } from "../../utils/electronAPI";

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

	const filteredFiles = currentFiles;

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
					{activeTab === "explorer" && (
						<Tooltip content="Refresh file list" placement="bottom">
							<ActionButton onClick={() => loadDirectory(currentPath)}>
								<FiRefreshCw size={12} />
							</ActionButton>
						</Tooltip>
					)}
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
				<>
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
									{index < array.length - 1 && (
										<span className="separator">/</span>
									)}
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
											{item.modified && (
												<span>{formatDate(item.modified)}</span>
											)}
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
								))}
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
				</>
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
		</SidebarContainer>
	);
};
