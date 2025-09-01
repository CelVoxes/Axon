import React from "react";
import styled from "styled-components";
import { FiFileText, FiZap } from "react-icons/fi";
import { ActionButton } from "./StyledComponents";
import { Tooltip } from "./Tooltip";

const SummaryButtonContainer = styled(ActionButton)`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	background: linear-gradient(135deg, #6366f1, #8b5cf6);
	border: 1px solid #6366f1;
	color: white;
	font-weight: 500;
	transition: all 0.2s ease;
	
	&:hover {
		background: linear-gradient(135deg, #5855f0, #7c3aed);
		border-color: #5855f0;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}
	
	&:disabled {
		background: #374151;
		border-color: #4b5563;
		color: #9ca3af;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}
`;

const IconContainer = styled.span`
	display: flex;
	align-items: center;
	font-size: 14px;
`;

interface SummaryButtonProps {
	onClick: () => void;
	disabled?: boolean;
	cellCount?: number;
}

export const SummaryButton: React.FC<SummaryButtonProps> = ({
	onClick,
	disabled = false,
	cellCount = 0,
}) => {
	const tooltipContent = disabled 
		? "No cells available to summarize"
		: `Generate AI summary for ${cellCount} cell${cellCount !== 1 ? 's' : ''}`;
		
	return (
		<Tooltip content={tooltipContent} placement="top">
			<SummaryButtonContainer
				onClick={onClick}
				disabled={disabled}
			>
				<IconContainer>
					<FiZap size={14} />
				</IconContainer>
				AI Summary
				<IconContainer>
					<FiFileText size={14} />
				</IconContainer>
			</SummaryButtonContainer>
		</Tooltip>
	);
};