import React, { useId, useState, useRef, useEffect } from "react";
import styled from "styled-components";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
	content: React.ReactNode;
	children: React.ReactElement;
	placement?: TooltipPlacement;
	delayMs?: number;
	maxWidthPx?: number;
}

const TooltipWrapper = styled.span`
	position: relative;
	display: inline-flex;
	align-items: center;
`;

const TooltipBubble = styled.div<{
	$visible: boolean;
	$placement: TooltipPlacement;
	$maxWidthPx: number;
}>`
	position: absolute;
	z-index: 1000;
	padding: 6px 8px;
	background: #2d2d30;
	color: #d4d4d4;
	border: 1px solid #3c3c3c;
	border-radius: 6px;
	font-size: 12px;
	line-height: 1.3;
	max-width: ${(p) => p.$maxWidthPx}px;
	min-width: 160px;
	pointer-events: none;
	opacity: ${(p) => (p.$visible ? 1 : 0)};
	transform: ${(p) =>
		p.$visible ? "translateY(0) scale(1)" : "translateY(2px) scale(0.98)"};
	transition: opacity 120ms ease, transform 120ms ease;

	${(p) =>
		p.$placement === "top" &&
		`
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, ${p.$visible ? "0" : "2px"}) scale(${
			p.$visible ? 1 : 0.98
		});
  `}
	${(p) =>
		p.$placement === "bottom" &&
		`
    top: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, ${p.$visible ? "0" : "-2px"}) scale(${
			p.$visible ? 1 : 0.98
		});
  `}
  ${(p) =>
		p.$placement === "left" &&
		`
    right: calc(100% + 8px);
    top: 50%;
    transform: translate(${p.$visible ? "0" : "2px"}, -50%) scale(${
			p.$visible ? 1 : 0.98
		});
  `}
  ${(p) =>
		p.$placement === "right" &&
		`
    left: calc(100% + 8px);
    top: 50%;
    transform: translate(${p.$visible ? "0" : "-2px"}, -50%) scale(${
			p.$visible ? 1 : 0.98
		});
  `}
`;

export const Tooltip: React.FC<TooltipProps> = ({
	content,
	children,
	placement = "top",
	delayMs = 600,
	maxWidthPx = 260,
}) => {
	const id = useId();
	const [visible, setVisible] = useState(false);
	const showTimer = useRef<number | null>(null);
	const hideTimer = useRef<number | null>(null);

	const show = () => {
		if (hideTimer.current) {
			window.clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}
		showTimer.current = window.setTimeout(() => setVisible(true), delayMs);
	};

	const hide = () => {
		if (showTimer.current) {
			window.clearTimeout(showTimer.current);
			showTimer.current = null;
		}
		hideTimer.current = window.setTimeout(() => setVisible(false), 120);
	};

	useEffect(() => {
		return () => {
			if (showTimer.current) window.clearTimeout(showTimer.current);
			if (hideTimer.current) window.clearTimeout(hideTimer.current);
		};
	}, []);

	// Ensure focus/hover both trigger the tooltip
	const childProps = {
		onMouseEnter: (e: React.MouseEvent) => {
			children.props.onMouseEnter?.(e);
			show();
		},
		onMouseLeave: (e: React.MouseEvent) => {
			children.props.onMouseLeave?.(e);
			hide();
		},
		onFocus: (e: React.FocusEvent) => {
			children.props.onFocus?.(e);
			show();
		},
		onBlur: (e: React.FocusEvent) => {
			children.props.onBlur?.(e);
			hide();
		},
		"aria-describedby": id,
	} as const;

	const trigger = React.cloneElement(children, childProps);

	return (
		<TooltipWrapper>
			{trigger}
			<TooltipBubble
				role="tooltip"
				id={id}
				$visible={visible}
				$placement={placement}
				$maxWidthPx={maxWidthPx}
			>
				{content}
			</TooltipBubble>
		</TooltipWrapper>
	);
};

export default Tooltip;
