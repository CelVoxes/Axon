import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { FiPlay, FiSquare, FiRefreshCw, FiFolder } from "react-icons/fi";
import { useAppContext } from "../../context/AppContext";
import { FileEditor } from "./FileEditor";
import { JupyterViewer } from "./JupyterViewer";

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
`;

const Tab = styled.div<{ isActive: boolean }>`
	padding: 8px 16px;
	font-size: 13px;
	cursor: pointer;
	border-right: 1px solid #3e3e42;
	background-color: ${(props) => (props.isActive ? "#1e1e1e" : "transparent")};
	color: ${(props) => (props.isActive ? "#ffffff" : "#cccccc")};
	white-space: nowrap;

	&:hover {
		background-color: ${(props) => (props.isActive ? "#1e1e1e" : "#383838")};
	}

	.close {
		margin-left: 8px;
		opacity: 0.6;

		&:hover {
			opacity: 1;
		}
	}
`;

const JupyterTab = styled(Tab)`
	background-color: ${(props) => (props.isActive ? "#1e1e1e" : "#3e4751")};
	border-left: 3px solid #f37626;
`;

const ControlBar = styled.div`
	height: 40px;
	background-color: #252526;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	gap: 8px;
`;

const ControlButton = styled.button`
	background: #3c3c3c;
	border: 1px solid #6c6c6c;
	color: #d4d4d4;
	padding: 6px 12px;
	border-radius: 2px;
	cursor: pointer;
	font-size: 12px;
	display: flex;
	align-items: center;
	gap: 6px;

	&:hover:not(:disabled) {
		background: #464647;
	}

	&:disabled {
		background: #3c3c3c;
		color: #858585;
		cursor: not-allowed;
	}
`;

const ContentArea = styled.div`
	flex: 1;
	overflow: hidden;
	position: relative;
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
		font-size: 48px;
		margin-bottom: 20px;
		color: #007acc;
		font-weight: bold;
		letter-spacing: 2px;
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
		}
	}
`;

const StatusIndicator = styled.div<{
	status: "running" | "stopped" | "starting";
}>`
	font-size: 12px;
	color: #858585;

	${(props) => {
		if (props.status === "running") {
			return `color: #00ff00;`;
		} else if (props.status === "starting") {
			return `color: #ffff00;`;
		} else {
			return `color: #ff0000;`;
		}
	}}
`;

export const MainContent: React.FC<{ "data-layout-role"?: string }> = (
	props
) => {
	const { state, dispatch } = useAppContext();
	const [jupyterStatus, setJupyterStatus] = useState<
		"running" | "stopped" | "starting"
	>("stopped");

	const openWorkspace = async () => {
		try {
			const result = await window.electronAPI.showOpenDialog({
				properties: ["openDirectory", "createDirectory"],
				title: "Select Workspace Folder",
			});

			if (!result.canceled && result.filePaths.length > 0) {
				const workspacePath = result.filePaths[0];
				dispatch({ type: "SET_WORKSPACE", payload: workspacePath });
			}
		} catch (error) {
			console.error("Error opening workspace:", error);
		}
	};

	useEffect(() => {
		// Listen for Jupyter events
		window.electronAPI.onJupyterReady((data) => {
			setJupyterStatus("running");
			dispatch({ type: "SET_JUPYTER_URL", payload: data.url });
		});

		window.electronAPI.onJupyterError((error) => {
			console.error("Jupyter error:", error);
			setJupyterStatus("stopped");
		});

		return () => {
			window.electronAPI.removeAllListeners("jupyter-ready");
			window.electronAPI.removeAllListeners("jupyter-error");
		};
	}, []);

	const startJupyter = async () => {
		if (jupyterStatus !== "stopped") return;

		setJupyterStatus("starting");

		try {
			const workingDir = state.currentWorkspace || process.cwd();
			const result = await window.electronAPI.startJupyter(workingDir);

			if (!result.success) {
				setJupyterStatus("stopped");
				console.error("Failed to start Jupyter:", result.error);
			}
		} catch (error) {
			setJupyterStatus("stopped");
			console.error("Error starting Jupyter:", error);
		}
	};

	const stopJupyter = async () => {
		try {
			await window.electronAPI.stopJupyter();
			setJupyterStatus("stopped");
			dispatch({ type: "SET_JUPYTER_URL", payload: null });
		} catch (error) {
			console.error("Error stopping Jupyter:", error);
		}
	};

	const handleTabClose = (e: React.MouseEvent, filePath: string) => {
		e.stopPropagation();
		dispatch({ type: "CLOSE_FILE", payload: filePath });
	};

	const renderTabBar = () => {
		if (state.openFiles.length === 0 && !state.jupyterUrl) return null;

		const tabs = [];

		// File tabs
		state.openFiles.forEach((filePath) => {
			const fileName = filePath.split("/").pop() || filePath;
			const isActive = state.activeFile === filePath;

			tabs.push(
				<Tab
					key={filePath}
					isActive={isActive}
					onClick={() =>
						dispatch({ type: "SET_ACTIVE_FILE", payload: filePath })
					}
				>
					{fileName}
					<span className="close" onClick={(e) => handleTabClose(e, filePath)}>
						×
					</span>
				</Tab>
			);
		});

		// Jupyter tab
		if (state.jupyterUrl) {
			tabs.push(
				<JupyterTab
					key="jupyter"
					isActive={!state.activeFile}
					onClick={() => dispatch({ type: "SET_ACTIVE_FILE", payload: null })}
				>
					Jupyter Lab
				</JupyterTab>
			);
		}

		return tabs;
	};

	const renderContent = () => {
		// Show file editor if a file is selected and open
		if (state.activeFile && state.openFiles.includes(state.activeFile)) {
			return <FileEditor filePath={state.activeFile} />;
		}

		// Show Jupyter if URL is available and no file is selected
		if (state.jupyterUrl && !state.activeFile) {
			return <JupyterViewer url={state.jupyterUrl} />;
		}

		// Show welcome screen
		if (state.activeFile && state.openFiles.includes(state.activeFile)) {
			return <FileEditor filePath={state.activeFile} />;
		}

		return (
			<EmptyState>
				<div className="app-logo">NODE</div>
				<div className="title">Welcome to Node</div>
				<div className="subtitle">
					AI-powered biological data analysis platform
					<br />
					Open a workspace and start analyzing biological data with intelligent
					assistance
				</div>

				<WelcomeActions>
					<ActionCard onClick={openWorkspace}>
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
					<div className="section-title">Recent projects</div>
					<div
						className="project-item"
						onClick={() => {
							dispatch({
								type: "SET_WORKSPACE",
								payload: "/Users/onur-lumc/Desktop/BioRAG",
							});
							// The useEffect in Sidebar will handle file tree loading
						}}
					>
						<div className="project-name">BioRAG</div>
						<div className="project-path">~/Desktop</div>
					</div>
				</RecentProjects>
			</EmptyState>
		);
	};

	return (
		<MainContainer {...props}>
			{(() => {
				const tabs = renderTabBar();
				return tabs && tabs.length > 0 ? <TabBar>{tabs}</TabBar> : null;
			})()}

			{state.currentWorkspace && (
				<ControlBar>
					<StatusIndicator status={jupyterStatus}>
						{jupyterStatus === "running" && "Jupyter Running"}
						{jupyterStatus === "starting" && "Starting Jupyter..."}
						{jupyterStatus === "stopped" && "Jupyter Stopped"}
					</StatusIndicator>

					{jupyterStatus === "running" && (
						<ControlButton onClick={stopJupyter}>
							<FiSquare size={14} />
							Stop Jupyter
						</ControlButton>
					)}
				</ControlBar>
			)}

			<ContentArea>{renderContent()}</ContentArea>
		</MainContainer>
	);
};
