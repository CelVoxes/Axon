import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { electronAPI } from '../../utils/electronAPI';

interface UpdateStatus {
	status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
	message: string;
	version?: string;
	percent?: number;
	error?: string;
}

const NotificationContainer = styled.div<{ show: boolean }>`
	position: fixed;
	top: 20px;
	right: 20px;
	background: #2d3748;
	border: 1px solid #4a5568;
	border-radius: 8px;
	padding: 16px;
	max-width: 400px;
	z-index: 10000;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	transform: translateX(${props => props.show ? '0' : '420px'});
	transition: transform 0.3s ease-in-out;
	color: #e2e8f0;
`;

const NotificationHeader = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 12px;
`;

const Title = styled.h4`
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	color: #e2e8f0;
`;

const CloseButton = styled.button`
	background: none;
	border: none;
	color: #a0aec0;
	cursor: pointer;
	font-size: 18px;
	padding: 0;
	line-height: 1;

	&:hover {
		color: #e2e8f0;
	}
`;

const Message = styled.p`
	margin: 0 0 12px 0;
	font-size: 13px;
	color: #cbd5e0;
`;

const ProgressBar = styled.div<{ percent: number }>`
	width: 100%;
	height: 6px;
	background: #4a5568;
	border-radius: 3px;
	overflow: hidden;
	margin: 8px 0;

	&::after {
		content: '';
		display: block;
		height: 100%;
		width: ${props => props.percent}%;
		background: #4299e1;
		transition: width 0.3s ease;
	}
`;

const ButtonGroup = styled.div`
	display: flex;
	gap: 8px;
	margin-top: 12px;
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' }>`
	padding: 6px 12px;
	border: none;
	border-radius: 4px;
	font-size: 12px;
	cursor: pointer;
	transition: background-color 0.2s;

	${props => props.variant === 'primary' ? `
		background: #4299e1;
		color: white;
		&:hover {
			background: #3182ce;
		}
	` : `
		background: #4a5568;
		color: #e2e8f0;
		&:hover {
			background: #2d3748;
		}
	`}
`;

export const UpdateNotification: React.FC = () => {
	const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
	const [show, setShow] = useState(false);

	useEffect(() => {
		const handleUpdateStatus = (status: UpdateStatus) => {
			setUpdateStatus(status);
			setShow(true);

			// Auto-hide for certain statuses
			if (status.status === 'not-available' || status.status === 'error') {
				setTimeout(() => setShow(false), 5000);
			}
		};

		// Listen for update status from main process
		try {
			(window as any).electronAPI?.onUpdateStatus(handleUpdateStatus);
		} catch (error) {
			console.error('Failed to set up update listener:', error);
		}

		return () => {
			// Cleanup listener if possible
		};
	}, []);

	const handleClose = () => {
		setShow(false);
	};

	const handleCheckForUpdates = async () => {
		try {
			await electronAPI.checkForUpdates();
		} catch (error) {
			console.error('Failed to check for updates:', error);
		}
	};

	const handleInstallUpdate = async () => {
		try {
			await electronAPI.installUpdate();
		} catch (error) {
			console.error('Failed to install update:', error);
		}
	};

	if (!updateStatus) return null;

	const getStatusColor = () => {
		switch (updateStatus.status) {
			case 'checking': return '#4299e1';
			case 'available': return '#48bb78';
			case 'downloading': return '#ed8936';
			case 'downloaded': return '#48bb78';
			case 'error': return '#f56565';
			default: return '#a0aec0';
		}
	};

	return (
		<NotificationContainer show={show}>
			<NotificationHeader>
				<Title style={{ color: getStatusColor() }}>
					{updateStatus.status === 'checking' && 'Checking for Updates'}
					{updateStatus.status === 'available' && 'Update Available'}
					{updateStatus.status === 'not-available' && 'Up to Date'}
					{updateStatus.status === 'downloading' && 'Downloading Update'}
					{updateStatus.status === 'downloaded' && 'Update Ready'}
					{updateStatus.status === 'error' && 'Update Error'}
				</Title>
				<CloseButton onClick={handleClose}>×</CloseButton>
			</NotificationHeader>

			<Message>{updateStatus.message}</Message>

			{updateStatus.status === 'downloading' && updateStatus.percent && (
				<ProgressBar percent={updateStatus.percent} />
			)}

			{updateStatus.status === 'available' && (
				<ButtonGroup>
					<Button variant="primary" onClick={handleCheckForUpdates}>
						Download Update
					</Button>
					<Button variant="secondary" onClick={handleClose}>
						Later
					</Button>
				</ButtonGroup>
			)}

			{updateStatus.status === 'downloaded' && (
				<ButtonGroup>
					<Button variant="primary" onClick={handleInstallUpdate}>
						Restart & Install
					</Button>
					<Button variant="secondary" onClick={handleClose}>
						Later
					</Button>
				</ButtonGroup>
			)}

			{updateStatus.status === 'not-available' && (
				<ButtonGroup>
					<Button variant="secondary" onClick={handleCheckForUpdates}>
						Check Again
					</Button>
				</ButtonGroup>
			)}
		</NotificationContainer>
	);
};