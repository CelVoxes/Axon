import React from "react";
import styled from "styled-components";
import { useAppContext } from "../../context/AppContext";

const StatusBarContainer = styled.div`
	height: 24px;
	background: #007acc;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 12px;
	font-size: 12px;
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
	cursor: pointer;
	transition: background-color 0.2s;

	&:hover {
		background: rgba(255, 255, 255, 0.2);
	}
`;

export const StatusBar: React.FC = () => {
	const { state } = useAppContext();

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
