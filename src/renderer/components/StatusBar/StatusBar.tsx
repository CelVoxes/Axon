import React from "react";
import styled from "styled-components";
import { useWorkspaceContext } from "../../context/AppContext";
import { typography } from "../../styles/design-system";

const StatusBarContainer = styled.div`
	height: 24px;
	background: #007acc;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 12px;
	font-size: ${typography.sm};
	color: white;
	flex-shrink: 0;
	border-top: 1px solid #005a9e;
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
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.1);
	font-weight: 500;
	transition: background-color 0.2s;
`;

export const StatusBar: React.FC = () => {
	const { state } = useWorkspaceContext();

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
				<StatusItem>Ready</StatusItem>
			</StatusRight>
		</StatusBarContainer>
	);
};
