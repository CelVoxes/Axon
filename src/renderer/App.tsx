import React, { useEffect } from "react";
import { Layout } from "./components/Layout/Layout";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ChatPanel } from "./components/Chat/ChatPanel";
import { MainContent } from "./components/MainContent/MainContent";
import { StatusBar } from "./components/StatusBar/StatusBar";
import {
	AppProvider,
	useWorkspaceContext,
	useUIContext,
	useAnalysisContext,
} from "./context/AppContext";
import { electronAPI } from "./utils/electronAPI";
import {
	BsChatDots,
	BsChatDotsFill,
	BsFolder2,
	BsFolderFill,
} from "react-icons/bs";

const AppContent: React.FC = () => {
	const { state: workspaceState } = useWorkspaceContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();
	const { state: analysisState } = useAnalysisContext();

	// Handle workspace change to automatically show chat panel (only when workspace changes)
	useEffect(() => {
		if (workspaceState.currentWorkspace && !uiState.showChatPanel) {
			uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
		}
		// Intentionally only depend on currentWorkspace so we don't auto-reopen after manual close
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspaceState.currentWorkspace]);

	// Persist last workspace for convenience (no auto-open on boot)
	useEffect(() => {
		(async () => {
			try {
				if (workspaceState.currentWorkspace) {
					await electronAPI.storeSet(
						"lastWorkspace",
						workspaceState.currentWorkspace
					);
				}
			} catch (e) {
				// ignore
			}
		})();
	}, [workspaceState.currentWorkspace]);

	return (
		<Layout>
			<Layout.Header>
				{workspaceState.currentWorkspace && (
					<div
						style={{
							marginLeft: "auto",
							display: "inline-flex",
							alignItems: "center",
							gap: 10,
						}}
					>
						{/* Explorer toggle */}
						<button
							onClick={() =>
								uiDispatch({
									type: "SET_SHOW_SIDEBAR",
									payload: !uiState.showSidebar,
								})
							}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								background: "transparent",
								border: "none",
								color: "#ccc",
								cursor: "pointer",
								padding: 0,
							}}
							title={uiState.showSidebar ? "Hide Explorer" : "Show Explorer"}
						>
							{uiState.showSidebar ? <BsFolderFill /> : <BsFolder2 />}
						</button>

						{/* Chat toggle */}
						<button
							onClick={() => {
								const isExpanded =
									uiState.showChatPanel && !uiState.chatCollapsed;
								if (isExpanded) {
									if (analysisState.isStreaming) {
										uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: true });
									} else {
										uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: false });
										uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
									}
								} else {
									if (!uiState.showChatPanel) {
										uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
									}
									uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
								}
							}}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								background: "transparent",
								border: "none",
								color: "#ccc",
								cursor: "pointer",
								padding: 0,
							}}
							title={
								uiState.showChatPanel && !uiState.chatCollapsed
									? analysisState.isStreaming
										? "Collapse Chat"
										: "Close Chat"
									: "Open Chat"
							}
						>
							{uiState.showChatPanel && !uiState.chatCollapsed ? (
								<BsChatDotsFill />
							) : (
								<BsChatDots />
							)}
						</button>
					</div>
				)}
			</Layout.Header>

			<Layout.Body>
				{workspaceState.currentWorkspace && (
					<Sidebar onToggle={() => {}} data-layout-role="sidebar" />
				)}

				<MainContent data-layout-role="main" />

				{/* Only show ChatPanel when a workspace is open and showChatPanel is true */}
				{workspaceState.currentWorkspace && uiState.showChatPanel && (
					<ChatPanel
						key="chat-panel"
						data-layout-role="chat"
						className={uiState.chatCollapsed ? "chat-collapsed" : ""}
					/>
				)}
			</Layout.Body>

			<StatusBar />
		</Layout>
	);
};

export const App: React.FC = () => {
	return (
		<AppProvider>
			<AppContent />
		</AppProvider>
	);
};
