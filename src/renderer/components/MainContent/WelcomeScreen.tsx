import React from "react";
import styled from "styled-components";
import { FiFolder } from "react-icons/fi";
// @ts-ignore
import axonLogo from "../../../png/axon-no-background.png";
import { typography } from "../../styles/design-system";

const WelcomeContainer = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #858585;
	font-size: ${typography.base};
	padding: 40px;
	text-align: center;
`;

const AppLogo = styled.img`
	margin-bottom: 20px;
	width: 120px;
	height: auto;
`;

const Title = styled.div`
	font-size: ${typography["3xl"]};
	margin-bottom: 8px;
	color: #cccccc;
	font-weight: 600;
`;

const Subtitle = styled.div`
	margin-bottom: 32px;
	color: #858585;
	text-align: center;
	line-height: 1.5;
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
	font-size: ${typography.base};
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: #383838;
		border-color: #007acc;
	}

	.icon {
		margin-bottom: 12px;
		color: #888;
	}

	.label {
		font-weight: 600;
		margin-bottom: 4px;
	}

	.description {
		font-size: ${typography.sm};
		color: #858585;
		text-align: center;
	}
`;

const RecentProjects = styled.div`
	width: 100%;
	max-width: 600px;

	.section-title {
		font-size: ${typography.base};
		font-weight: 600;
		color: #cccccc;
		margin-bottom: 12px;
		text-align: left;
	}

	.project-item {
		display: flex;
		flex-direction: column;
		padding: 12px;
		background-color: #2d2d2d;
		border: 1px solid #404040;
		border-radius: 6px;
		margin-bottom: 8px;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			background-color: #383838;
			border-color: #007acc;
		}

		.project-name {
			font-weight: 600;
			color: #cccccc;
			margin-bottom: 4px;
		}

		.project-path {
			font-size: ${typography.sm};
			color: #858585;
		}
	}
`;

interface WelcomeScreenProps {
	recentWorkspaces: string[];
	onOpenWorkspace: (path: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
	recentWorkspaces,
	onOpenWorkspace,
}) => {
	return (
		<WelcomeContainer>
			<AppLogo src={axonLogo} alt="Axon" />
			<Title>Welcome to Axon</Title>
			<Subtitle>
				AI-powered biological data analysis platform
				<br />
				Open a workspace and start analyzing biological data with intelligent
				assistance
			</Subtitle>

			<WelcomeActions>
				<ActionCard onClick={() => onOpenWorkspace("")}>
					<div className="icon">
						<FiFolder size={18} />
					</div>
					<div className="label">Open project</div>
					<div className="description">Open an existing folder</div>
				</ActionCard>

				<ActionCard
					onClick={() => {
						// Clone repo functionality
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
							onClick={() => onOpenWorkspace(workspacePath)}
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
		</WelcomeContainer>
	);
};
