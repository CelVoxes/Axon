import React, { useEffect } from "react";
import { Layout } from "./components/Layout/Layout";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ChatPanel } from "./components/Chat/ChatPanel";
import { MainContent } from "./components/MainContent/MainContent";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { AppProvider } from "./context/AppContext";
import { useWorkspaceContext } from "./context/WorkspaceContext";
import { useUIContext } from "./context/UIContext";

const AppContent: React.FC = () => {
	const { state: workspaceState } = useWorkspaceContext();
	const { state: uiState, dispatch: uiDispatch } = useUIContext();

	// Handle workspace change to automatically show chat panel
	useEffect(() => {
		if (workspaceState.currentWorkspace && !uiState.showChatPanel) {
			uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
		}
	}, [workspaceState.currentWorkspace, uiState.showChatPanel, uiDispatch]);

	return (
		<Layout>
			<Layout.Header />

			<Layout.Body>
				{workspaceState.currentWorkspace && (
					<Sidebar onToggle={() => {}} data-layout-role="sidebar" />
				)}

				<MainContent data-layout-role="main" />

				{/* Only show ChatPanel when a workspace is open and showChatPanel is true */}
				{workspaceState.currentWorkspace && uiState.showChatPanel && (
					<ChatPanel
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
