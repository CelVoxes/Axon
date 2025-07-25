import React, { useState, useEffect } from "react";
import { Layout } from "./components/Layout/Layout";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ChatPanel } from "./components/Chat/ChatPanel";
import { MainContent } from "./components/MainContent/MainContent";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { AppProvider, useAppContext } from "./context/AppContext";

const AppContent: React.FC = () => {
	const { state } = useAppContext();
	const [chatCollapsed, setChatCollapsed] = useState(true);

	useEffect(() => {
		// Show chat panel when a workspace is opened
		if (state.currentWorkspace) {
			setChatCollapsed(false);
		}
	}, [state.currentWorkspace]);

	return (
		<Layout>
			<Layout.Header />

			<Layout.Body>
				{state.currentWorkspace && (
					<Sidebar
						collapsed={false}
						onToggle={() => {}}
						data-layout-role="sidebar"
					/>
				)}

				<MainContent data-layout-role="main" />

				{!chatCollapsed && state.currentWorkspace && (
					<ChatPanel
						collapsed={false}
						onToggle={() => setChatCollapsed(!chatCollapsed)}
						data-layout-role="chat"
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
