import React, { useState, useEffect } from "react";
import { Layout } from "./components/Layout/Layout";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ChatPanel } from "./components/Chat/ChatPanel";
import { MainContent } from "./components/MainContent/MainContent";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { AppProvider, useAppContext } from "./context/AppContext";

const AppContent: React.FC = () => {
	const { state, dispatch } = useAppContext();

	useEffect(() => {
		// Show chat panel when a workspace is opened
		if (state.currentWorkspace) {
			dispatch({
				type: "SET_CHAT_COLLAPSED",
				payload: false,
			});
		}
	}, [state.currentWorkspace, dispatch]);

	return (
		<Layout>
			<Layout.Header />

			<Layout.Body>
				{state.currentWorkspace && (
					<Sidebar onToggle={() => {}} data-layout-role="sidebar" />
				)}

				<MainContent data-layout-role="main" />

				{!state.chatCollapsed && state.currentWorkspace && (
					<ChatPanel
						onToggle={() =>
							dispatch({
								type: "SET_CHAT_COLLAPSED",
								payload: !state.chatCollapsed,
							})
						}
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
