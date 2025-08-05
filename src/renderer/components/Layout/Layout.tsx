import React, { useState, useContext } from "react";
import styled from "styled-components";
import { throttle } from "../shared/utils";
import { useUIContext } from "../../context/AppContext";

interface LayoutProps {
	children: React.ReactNode;
}

interface LayoutHeaderProps {
	children?: React.ReactNode;
}

interface LayoutBodyProps {
	children: React.ReactNode;
}

interface LayoutComponent extends React.FC<LayoutProps> {
	Header: React.FC<LayoutHeaderProps>;
	Body: React.FC<LayoutBodyProps>;
}

const LayoutContainer = styled.div`
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: #0f0f0f;
	color: #ffffff;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
		Ubuntu, Cantarell, sans-serif;
`;

const LayoutHeader = styled.div`
	height: 40px;
	background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
	border-bottom: 1px solid #2a2a2a;
	display: flex;
	align-items: center;
	padding: 0 16px;
	flex-shrink: 0;
	-webkit-app-region: drag;

	/* Make buttons in header clickable */
	button {
		-webkit-app-region: no-drag;
	}
`;

const LayoutBodyContainer = styled.div`
	flex: 1;
	display: flex;
	overflow: hidden;
	position: relative;
	align-items: stretch;
`;

const ResizablePane = styled.div<{
	width: number;
	$minWidth: number;
	$maxWidth: number;
	$isRightPane?: boolean;
}>`
	width: ${(props) => props.width}px;
	min-width: ${(props) => props.$minWidth}px;
	max-width: ${(props) => props.$maxWidth}px;
	flex-shrink: 0;
	overflow: hidden;
	position: relative;
`;

const MainPane = styled.div`
	flex: 1;
	overflow: hidden;
	background: #151515;
	position: relative;
	min-width: 0;
`;

const Resizer = styled.div<{ $isDisabled?: boolean }>`
	width: 4px;
	background: ${(props) => (props.$isDisabled ? "transparent" : "#404040")};
	cursor: ${(props) => (props.$isDisabled ? "default" : "col-resize")};
	position: relative;
	transition: background-color 0.2s ease;
	z-index: 1000;
	display: flex;
	align-items: center;
	justify-content: center;

	&:hover {
		background: ${(props) => (props.$isDisabled ? "transparent" : "#0ea5e9")};
	}

	&:active {
		background: ${(props) => (props.$isDisabled ? "transparent" : "#0284c7")};
	}

	&::before {
		content: "";
		position: absolute;
		top: 0;
		left: -2px;
		right: -2px;
		bottom: 0;
		z-index: 10;
	}

	&::after {
		content: "⋮";
		color: ${(props) => (props.$isDisabled ? "transparent" : "#666")};
		font-size: 12px;
		line-height: 1;
		z-index: 20;
		position: relative;
	}
`;

const Layout = ({ children }: LayoutProps) => {
	return <LayoutContainer>{children}</LayoutContainer>;
};

const LayoutWithSubComponents = Layout as LayoutComponent;

const Header: React.FC<LayoutHeaderProps> = ({ children }) => {
	return <LayoutHeader>{children}</LayoutHeader>;
};

const Body: React.FC<LayoutBodyProps> = ({ children }) => {
	const { state: uiState } = useUIContext();
	const [leftPaneWidth, setLeftPaneWidth] = useState(240);
	const [rightPaneWidth, setRightPaneWidth] = useState(400);
	const [isResizingLeft, setIsResizingLeft] = useState(false);
	const [isResizingRight, setIsResizingRight] = useState(false);

	const handleMouseDown = (side: "left" | "right") => (e: React.MouseEvent) => {
		e.preventDefault();
		if (side === "left") {
			setIsResizingLeft(true);
		} else if (side === "right" && !uiState.chatCollapsed) {
			setIsResizingRight(true);
		}
	};

	React.useEffect(() => {
		let animationFrameId: number;

		const handleMouseMove = throttle((e: MouseEvent) => {
			// Use requestAnimationFrame for better performance
			cancelAnimationFrame(animationFrameId);
			animationFrameId = requestAnimationFrame(() => {
				if (isResizingLeft) {
					const newWidth = Math.max(200, Math.min(500, e.clientX));
					setLeftPaneWidth(newWidth);
				} else if (isResizingRight) {
					// Calculate width from the right edge of the window
					const newWidth = Math.max(
						300,
						Math.min(600, window.innerWidth - e.clientX)
					);
					setRightPaneWidth(newWidth);
				}
			});
		}, 16); // ~60fps

		const handleMouseUp = () => {
			setIsResizingLeft(false);
			setIsResizingRight(false);
		};

		if (isResizingLeft || isResizingRight) {
			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		}

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			cancelAnimationFrame(animationFrameId);
		};
	}, [isResizingLeft, isResizingRight, leftPaneWidth]);

	const childrenArray = React.Children.toArray(children);
	const leftPane = childrenArray.find(
		(child: any) => child?.props?.["data-layout-role"] === "sidebar"
	);
	const mainPane = childrenArray.find(
		(child: any) => child?.props?.["data-layout-role"] === "main"
	);
	const rightPane = childrenArray.find(
		(child: any) => child?.props?.["data-layout-role"] === "chat"
	);

	return (
		<LayoutBodyContainer>
			{/* Left section with sidebar */}
			{leftPane && (
				<>
					<ResizablePane width={leftPaneWidth} $minWidth={200} $maxWidth={500}>
						{leftPane}
					</ResizablePane>
					<Resizer onMouseDown={handleMouseDown("left")} />
				</>
			)}

			{/* Main content area */}
			<MainPane>{mainPane}</MainPane>

			{/* Right section with chat */}
			{rightPane && (
				<>
					<Resizer
						onMouseDown={handleMouseDown("right")}
						$isDisabled={uiState.chatCollapsed}
					/>
					<ResizablePane
						width={uiState.chatCollapsed ? 40 : rightPaneWidth}
						$minWidth={uiState.chatCollapsed ? 40 : 300}
						$maxWidth={uiState.chatCollapsed ? 40 : 600}
					>
						{rightPane}
					</ResizablePane>
				</>
			)}
		</LayoutBodyContainer>
	);
};

LayoutWithSubComponents.Header = Header;
LayoutWithSubComponents.Body = Body;

export { LayoutWithSubComponents as Layout };
