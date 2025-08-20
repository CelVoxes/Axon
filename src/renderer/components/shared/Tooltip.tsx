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
	delayMs = 200,
	maxWidthPx = 260,
}) => {
	const id = useId();
	const [visible, setVisible] = useState(false);
	const [actualPlacement, setActualPlacement] = useState(placement);
	const showTimer = useRef<number | null>(null);
	const hideTimer = useRef<number | null>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLSpanElement>(null);
	const isMouseDownRef = useRef(false);

	const checkBounds = () => {
		if (!tooltipRef.current || !wrapperRef.current) return;

		const tooltip = tooltipRef.current;
		const wrapper = wrapperRef.current;
		const rect = tooltip.getBoundingClientRect();
		const wrapperRect = wrapper.getBoundingClientRect();
		const viewport = {
			width: window.innerWidth,
			height: window.innerHeight,
		};

		let newPlacement = placement;

		if (placement === "top" && rect.top < 0) {
			newPlacement = "bottom";
		} else if (placement === "bottom" && rect.bottom > viewport.height) {
			newPlacement = "top";
		} else if (placement === "left" && rect.left < 0) {
			newPlacement = "right";
		} else if (placement === "right" && rect.right > viewport.width) {
			newPlacement = "left";
		}

		if (newPlacement !== actualPlacement) {
			setActualPlacement(newPlacement);
		}
	};

	const show = () => {
		if (hideTimer.current) {
			window.clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}
		showTimer.current = window.setTimeout(() => {
			// Don't show tooltip if a dropdown menu is open
			const hasOpenDropdown = wrapperRef.current?.querySelector('.dropdown-menu');
			if (hasOpenDropdown) return;
			
			setVisible(true);
			requestAnimationFrame(checkBounds);
		}, delayMs);
	};

	const hide = () => {
		if (showTimer.current) {
			window.clearTimeout(showTimer.current);
			showTimer.current = null;
		}
		setVisible(false);
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
			// Don't show tooltip if hovering over dropdown menu
			const target = e.target as HTMLElement;
			if (target.closest('.dropdown-menu')) return;
			show();
		},
		onMouseLeave: (e: React.MouseEvent) => {
			children.props.onMouseLeave?.(e);
			hide();
		},
		onMouseDown: (e: React.MouseEvent) => {
			children.props.onMouseDown?.(e);
			isMouseDownRef.current = true;
			hide();
		},
		onMouseUp: (e: React.MouseEvent) => {
			children.props.onMouseUp?.(e);
			setTimeout(() => {
				isMouseDownRef.current = false;
			}, 50);
		},
		onFocus: (e: React.FocusEvent) => {
			children.props.onFocus?.(e);
			if (!isMouseDownRef.current) {
				show();
			}
		},
		onBlur: (e: React.FocusEvent) => {
			children.props.onBlur?.(e);
			hide();
		},
		"aria-describedby": id,
	} as const;

	const trigger = React.cloneElement(children, childProps);

	return (
		<TooltipWrapper ref={wrapperRef}>
			{trigger}
			<TooltipBubble
				ref={tooltipRef}
				role="tooltip"
				id={id}
				$visible={visible}
				$placement={actualPlacement}
				$maxWidthPx={maxWidthPx}
			>
				{content}
			</TooltipBubble>
		</TooltipWrapper>
	);
};

export default Tooltip;
