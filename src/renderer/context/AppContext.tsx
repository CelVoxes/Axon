import React from "react";
import { WorkspaceProvider, useWorkspaceContext } from "./WorkspaceContext";
import { AnalysisProvider, useAnalysisContext } from "./AnalysisContext";
import { UIProvider, useUIContext } from "./UIContext";

// Re-export types and hooks for backward compatibility
export type { Message } from "./AnalysisContext";
export type { FileItem } from "./WorkspaceContext";

// Combined hook for easy access to all contexts
export const useAppContext = () => {
	const workspace = useWorkspaceContext();
	const analysis = useAnalysisContext();
	const ui = useUIContext();

	return {
		state: {
			...workspace.state,
			...analysis.state,
			...ui.state,
		},
		dispatch: {
			workspace: workspace.dispatch,
			analysis: analysis.dispatch,
			ui: ui.dispatch,
		},
	};
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	return (
		<WorkspaceProvider>
			<AnalysisProvider>
				<UIProvider>{children}</UIProvider>
			</AnalysisProvider>
		</WorkspaceProvider>
	);
};
