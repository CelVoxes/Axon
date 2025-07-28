import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiFolder, FiFile, FiChevronRight } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { openFile } from "../../utils";

interface SidebarProps {
	onToggle: () => void;
	"data-layout-role"?: string;
}

interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
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
	font-size: 11px;
	font-weight: 600;
	color: #cccccc;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
`;

const SidebarContent = styled.div`
	flex: 1;
	overflow-y: auto;
	padding: 8px 0;
`;

const FileTree = styled.div`
	font-size: 13px;
`;

const FileItem = styled.div<{ $isDirectory: boolean; $level: number }>`
	display: flex;
	align-items: center;
	padding: 4px 8px 4px ${(props) => 8 + props.$level * 16}px;
	cursor: pointer;
	color: #cccccc;
	height: 22px;

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
	}

	.name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
`;

const BreadcrumbNav = styled.div`
	padding: 8px 12px;
	font-size: 12px;
	color: #858585;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
	display: flex;
	align-items: center;
	gap: 4px;

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

export const Sidebar: React.FC<SidebarProps> = ({ onToggle, ...props }) => {
	const { state, dispatch } = useAppContext();
	const [currentPath, setCurrentPath] = useState<string>("");
	const [currentFiles, setCurrentFiles] = useState<FileItem[]>([]);

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

	const loadDirectory = async (dirPath: string) => {
		try {
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

	const handleItemClick = (item: FileItem) => {
		if (item.isDirectory) {
			setCurrentPath(item.path);
			loadDirectory(item.path);
		} else {
			openFile(item.path, dispatch);
		}
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

	const navigateToWorkspaceRoot = () => {
		if (state.currentWorkspace) {
			setCurrentPath(state.currentWorkspace);
			loadDirectory(state.currentWorkspace);
		}
	};

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

	return (
		<SidebarContainer $collapsed={false} {...props}>
			{/* Explorer Section */}
			<SidebarHeader>Explorer</SidebarHeader>

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

						{currentFiles.map((item) => (
							<FileItem
								key={item.path}
								$isDirectory={item.isDirectory}
								$level={0}
								onClick={() => handleItemClick(item)}
							>
								<div className="icon">
									{item.isDirectory ? (
										<FiChevronRight size={12} />
									) : (
										<FiFile size={12} />
									)}
								</div>
								<div className="name">{item.name}</div>
							</FileItem>
						))}
					</FileTree>
				) : (
					<div
						style={{ padding: "16px", textAlign: "center", color: "#858585" }}
					>
						No workspace opened
					</div>
				)}
			</SidebarContent>
		</SidebarContainer>
	);
};
