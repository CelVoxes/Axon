import React, { useState } from "react";
import styled from "styled-components";

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
`;

const ResizablePane = styled.div<{
	width: number;
	$minWidth: number;
	$maxWidth: number;
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
`;

const Resizer = styled.div`
	width: 4px;
	background: transparent;
	cursor: col-resize;
	position: relative;
	transition: background-color 0.2s ease;

	&:hover {
		background: #0ea5e9;
	}

	&:active {
		background: #0284c7;
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
`;

const Layout = ({ children }: LayoutProps) => {
	return <LayoutContainer>{children}</LayoutContainer>;
};

const LayoutWithSubComponents = Layout as LayoutComponent;

const Header: React.FC<LayoutHeaderProps> = ({ children }) => {
	return <LayoutHeader>{children}</LayoutHeader>;
};

const Body: React.FC<LayoutBodyProps> = ({ children }) => {
	const [leftPaneWidth, setLeftPaneWidth] = useState(240);
	const [rightPaneWidth, setRightPaneWidth] = useState(380);
	const [isResizingLeft, setIsResizingLeft] = useState(false);
	const [isResizingRight, setIsResizingRight] = useState(false);

	const handleMouseDown = (side: "left" | "right") => (e: React.MouseEvent) => {
		e.preventDefault();
		if (side === "left") {
			setIsResizingLeft(true);
		} else {
			setIsResizingRight(true);
		}
	};

	React.useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (isResizingLeft) {
				const newWidth = Math.max(200, Math.min(500, e.clientX));
				setLeftPaneWidth(newWidth);
			} else if (isResizingRight) {
				const newWidth = Math.max(
					300,
					Math.min(600, window.innerWidth - e.clientX)
				);
				setRightPaneWidth(newWidth);
			}
		};

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
		};
	}, [isResizingLeft, isResizingRight]);

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
			{leftPane && (
				<>
					<ResizablePane width={leftPaneWidth} $minWidth={200} $maxWidth={500}>
						{leftPane}
					</ResizablePane>
					<Resizer onMouseDown={handleMouseDown("left")} />
				</>
			)}

			<MainPane>{mainPane}</MainPane>

			{rightPane && (
				<>
					<Resizer onMouseDown={handleMouseDown("right")} />
					<ResizablePane width={rightPaneWidth} $minWidth={300} $maxWidth={600}>
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
