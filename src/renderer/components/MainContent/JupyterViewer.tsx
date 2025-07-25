import React from "react";
import styled from "styled-components";

const JupyterContainer = styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	background-color: #1e1e1e;
`;

const JupyterHeader = styled.div`
	padding: 16px;
	background-color: #2d2d2d;
	border-bottom: 1px solid #404040;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;

const JupyterTitle = styled.h3`
	color: #ffffff;
	margin: 0;
	font-size: 16px;
	font-weight: 600;
`;

const JupyterStatus = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	color: #4caf50;
	font-size: 14px;
`;

const StatusDot = styled.div`
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: #4caf50;
`;

const JupyterFrame = styled.iframe`
	width: 100%;
	height: calc(100% - 60px);
	border: none;
	background-color: white;
`;

const ActionButtons = styled.div`
	display: flex;
	gap: 12px;
`;

const ActionButton = styled.button`
	background-color: #007acc;
	color: white;
	border: none;
	padding: 8px 16px;
	border-radius: 4px;
	cursor: pointer;
	font-size: 14px;

	&:hover {
		background-color: #005a9e;
	}

	&.secondary {
		background-color: #404040;
		&:hover {
			background-color: #505050;
		}
	}
`;

const LoadingMessage = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #888;
	font-size: 14px;
	text-align: center;
`;

const LoadingSpinner = styled.div`
	width: 40px;
	height: 40px;
	border: 3px solid #404040;
	border-top: 3px solid #007acc;
	border-radius: 50%;
	animation: spin 1s linear infinite;
	margin-bottom: 16px;

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
`;

interface JupyterViewerProps {
	url: string;
}

export const JupyterViewer: React.FC<JupyterViewerProps> = ({ url }) => {
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);

	const openInBrowser = () => {
		window.open(url, "_blank");
	};

	const refreshJupyter = () => {
		setIsLoading(true);
		setError(null);
		// Trigger iframe reload
		const iframe = document.querySelector("iframe") as HTMLIFrameElement;
		if (iframe) {
			iframe.src = iframe.src;
		}
	};

	const handleIframeLoad = () => {
		setIsLoading(false);
		setError(null);
	};

	const handleIframeError = () => {
		setIsLoading(false);
		setError(
			"Failed to load Jupyter Lab. You can open it in your browser instead."
		);
	};

	return (
		<JupyterContainer>
			<JupyterHeader>
				<div>
					<JupyterTitle>Jupyter Lab</JupyterTitle>
					<JupyterStatus>
						<StatusDot />
						Running on {url}
					</JupyterStatus>
				</div>
				<ActionButtons>
					<ActionButton className="secondary" onClick={refreshJupyter}>
						Refresh
					</ActionButton>
					<ActionButton onClick={openInBrowser}>Open in Browser</ActionButton>
				</ActionButtons>
			</JupyterHeader>

			{isLoading && (
				<LoadingMessage>
					<LoadingSpinner />
					<div>Loading Jupyter Lab...</div>
					<div style={{ fontSize: "12px", marginTop: "8px", color: "#666" }}>
						If this takes too long, click "Open in Browser"
					</div>
				</LoadingMessage>
			)}

			{error && (
				<LoadingMessage>
					<div style={{ color: "#ff6b6b", marginBottom: "16px" }}>{error}</div>
					<ActionButton onClick={openInBrowser}>Open in Browser</ActionButton>
				</LoadingMessage>
			)}

			<JupyterFrame
				src={url}
				onLoad={handleIframeLoad}
				onError={handleIframeError}
				style={{ display: isLoading || error ? "none" : "block" }}
				title="Jupyter Lab"
			/>
		</JupyterContainer>
	);
};
