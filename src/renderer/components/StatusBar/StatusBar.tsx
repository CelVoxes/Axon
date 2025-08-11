import React from "react";
import styled from "styled-components";
import {
	useWorkspaceContext,
	useAnalysisContext,
} from "../../context/AppContext";
import { typography } from "../../styles/design-system";

const StatusBarContainer = styled.div`
	height: 24px;
	background: #222;
	display: flex;

	align-items: center;
	justify-content: space-between;
	padding: 0 4px;
	font-size: ${typography.sm};
	color: white;
	flex-shrink: 0;
	border-top: 1px solid #444;
`;

const StatusLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

const StatusRight = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

const StatusItem = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 6px;

	font-weight: 500;
	transition: background-color 0.2s;
`;

export const StatusBar: React.FC = () => {
	const { state } = useWorkspaceContext();
	const { state: analysisState } = useAnalysisContext();

	return (
		<StatusBarContainer>
			<StatusLeft>
				<StatusItem>
					{state.currentWorkspace
						? `Workspace: ${state.currentWorkspace}`
						: "No workspace"}
				</StatusItem>
			</StatusLeft>

			<StatusRight>
				<StatusItem>
					<span
						className={analysisState.isStreaming ? "pulse-dot" : ""}
						style={{
							display: "inline-block",
							width: 8,
							height: 8,
							borderRadius: "50%",
							backgroundColor: analysisState.isStreaming
								? "#00ff00"
								: "#9aa0a6",
							animation: analysisState.isStreaming
								? "pulse 1.5s infinite"
								: "none",
						}}
					/>
					{analysisState.isStreaming ? "Streaming" : "Ready"}
				</StatusItem>
			</StatusRight>
		</StatusBarContainer>
	);
};
