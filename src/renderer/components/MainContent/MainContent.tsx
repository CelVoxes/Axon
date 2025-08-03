import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiFolder, FiMessageSquare } from "react-icons/fi";
import { useWorkspaceContext } from "../../context/WorkspaceContext";
import { useUIContext } from "../../context/UIContext";
import { FileEditor } from "./FileEditor";
import { openWorkspace } from "../../utils";
// @ts-ignore
import axonLogo from "../../../png/axon-no-background.png";

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
	font-size: 13px;
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

const ChatToggleButton = styled.button`
	background: #007acc;
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
		background: #005a9e;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;

const StatusIndicator = styled.div<{
	$status: "running" | "stopped" | "starting";
}>`
	font-size: 12px;
	color: #858585;

	${(props) => {
		if (props.$status === "running") {
			return `color: #00ff00;`;
		} else if (props.$status === "starting") {
			return `color: #ffff00;`;
		} else {
			return `color: #ff0000;`;
		}
	}}
`;

const EmptyState = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #858585;
	font-size: 14px;
	padding: 40px;

	.app-logo {
		margin-bottom: 20px;
		width: 120px;
		height: auto;
	}

	.title {
		font-size: 24px;
		margin-bottom: 8px;
		color: #cccccc;
		font-weight: 600;
	}

	.subtitle {
		margin-bottom: 32px;
		color: #858585;
		text-align: center;
		line-height: 1.5;
	}
`;

const WelcomeActions = styled.div`
	display: flex;
	gap: 16px;
	margin-bottom: 40px;
	flex-wrap: wrap;
	justify-content: center;
`;

const ActionCard = styled.button`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 24px;
	min-width: 140px;
	height: 120px;
	background-color: #2d2d2d;
	border: 1px solid #404040;
	border-radius: 8px;
	color: #cccccc;
	font-size: 14px;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: #383838;
		border-color: #007acc;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.icon {
		margin-bottom: 12px;
		font-size: 24px;
	}

	.label {
		font-weight: 500;
	}

	.description {
		font-size: 12px;
		color: #858585;
		margin-top: 4px;
		text-align: center;
	}
`;

const RecentProjects = styled.div`
	margin-top: 32px;
	width: 100%;
	max-width: 600px;

	.section-title {
		font-size: 16px;
		color: #cccccc;
		margin-bottom: 16px;
		font-weight: 600;
	}

	.project-item {
		display: flex;
		align-items: center;
		padding: 12px;
		background-color: #2d2d2d;
		border-radius: 6px;
		margin-bottom: 8px;
		cursor: pointer;
		transition: background-color 0.2s ease;

		&:hover {
			background-color: #383838;
		}

		.project-name {
			font-weight: 500;
			color: #cccccc;
			margin-right: 8px;
		}

		.project-path {
			color: #858585;
			font-size: 12px;
			margin-left: auto;
			max-width: 120px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
`;

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
				const recent = await window.electronAPI.storeGet("recentWorkspaces");
				setRecentWorkspaces(
					(recent || [])
						.filter((w: any) => typeof w === "string" && w.length > 0)
						.slice(0, 3)
				);
			} catch (e) {
				console.error("Error loading recent workspaces:", e);
			}
		}
		syncRecentWorkspaces();
	}, []);

	const handleOpenWorkspace = (path: string) => {
		openWorkspace(path, workspaceDispatch, setRecentWorkspaces);
	};

	const handleTabClose = (e: React.MouseEvent, filePath: string) => {
		e.stopPropagation();
		workspaceDispatch({ type: "CLOSE_FILE", payload: filePath });
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
			<EmptyState>
				<img src={axonLogo} alt="Axon" className="app-logo" />
				<div className="title">Welcome to Axon</div>
				<div className="subtitle">
					AI-powered biological data analysis platform
					<br />
					Open a workspace and start analyzing biological data with intelligent
					assistance
				</div>

				<WelcomeActions>
					<ActionCard onClick={() => handleOpenWorkspace("")}>
						<div className="icon">
							<FiFolder size={24} />
						</div>
						<div className="label">Open project</div>
						<div className="description">Open an existing folder</div>
					</ActionCard>

					<ActionCard
						onClick={() => {
							console.log("Clone repo clicked");
						}}
					>
						<div className="icon">⌘</div>
						<div className="label">Clone repo</div>
						<div className="description">Clone from Git repository</div>
					</ActionCard>
				</WelcomeActions>

				<RecentProjects>
					<div className="section-title">
						Recent projects ({recentWorkspaces.length})
					</div>
					{recentWorkspaces.length > 0 ? (
						recentWorkspaces.map((workspacePath, index) => (
							<div
								key={workspacePath}
								className="project-item"
								onClick={() => handleOpenWorkspace(workspacePath)}
							>
								<div className="project-name">
									{workspacePath.split("/").pop()}
								</div>
								<div className="project-path">
									{workspacePath.split("/").slice(0, -1).join("/")}
								</div>
							</div>
						))
					) : (
						<div
							className="project-item"
							style={{ opacity: 0.6, cursor: "default" }}
						>
							<div className="project-name">No recent projects</div>
							<div className="project-path">Open a project to see it here</div>
						</div>
					)}
				</RecentProjects>
			</EmptyState>
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
							<ChatToggleButton onClick={toggleChat} title="Open Chat">
								<FiMessageSquare size={14} color="white" />
								Chat
							</ChatToggleButton>
						)}
					</ControlRight>
				</ControlBar>
			)}

			{renderContent()}

			{/* Floating chat toggle button when chat is not shown or collapsed */}
			{workspaceState.currentWorkspace &&
				(!uiState.showChatPanel || uiState.chatCollapsed) && (
					<ChatToggleButton
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
					</ChatToggleButton>
				)}
		</MainContainer>
	);
};
