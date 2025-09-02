import styled from "styled-components";
import {
	colors,
	typography,
	borderRadius,
	shadows,
} from "../../../styles/design-system";
import type { CodeBlockStyleProps, CodeBlockVariant } from "./CodeBlockTypes";

// Base container for all code block variants
export const CodeBlockContainer = styled.div<CodeBlockStyleProps>`
	${({ $variant }) => {
		switch ($variant) {
			case "inline":
				return `
          display: inline;
          background: #2d2d2d;
          color: #e5e7eb;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: ${typography.sm};
          border: 1px solid #444;
        `;

			case "chat":
				return `
          font-size: ${typography.sm};
          margin: 12px 0;
          border: 1px solid #333;
          border-radius: 8px;
          overflow: hidden;
          background: #1e1e1e;
        `;

			case "expandable":
			case "streaming":
			case "diff":
				return `
          border: 1px solid ${colors.gray[700]};
          border-radius: ${borderRadius.lg};
          margin: 12px 0;
          overflow: hidden;
          background: #1e1e1e;
          font-size: ${typography.sm}; /* Match chat variant font size */
        `;

			default:
				return `
          background: #1e1e1e;
          border: 1px solid #333;
          border-radius: 8px;
        `;
		}
	}}
`;

// Header for expandable variants
export const CodeBlockHeader = styled.div<{ $clickable?: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background: #2d2d2d;
	border-bottom: 1px solid #333;
	cursor: ${({ $clickable = true }) => ($clickable ? "pointer" : "default")};

	&:hover {
		background: ${({ $clickable = true }) =>
			$clickable ? "#3c3c3c" : "#2d2d2d"};
	}
`;

export const CodeBlockHeaderLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
`;

export const CodeBlockHeaderRight = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`;

export const CodeBlockTitle = styled.span<{ $isDiff?: boolean }>`
	color: #ffffff;
	font-weight: 600;
	font-size: ${typography.base};
	font-family: inherit;

	${({ $isDiff }) =>
		$isDiff
			? `
    .adds { color: ${colors.success}; }
    .dels { color: ${colors.error}; }
  `
			: ""}
`;

export const CodeBlockLanguage = styled.span`
	font-size: ${typography.xs};
	text-transform: uppercase;
	font-weight: 600;
	background: ${colors.primary[600]};
	color: white;
	padding: 2px 8px;
	border-radius: 4px;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-family: inherit;
`;

export const CodeBlockCopyButton = styled.button`
	background: none;
	color: white;
	border: none;
	border-radius: 4px;
	padding: 4px 8px;
	font-size: ${typography.xs};
	font-family: inherit;
	cursor: pointer;
	transition: background 0.2s;
	position: relative;

	&:hover {
		background: #005a9e;
	}
`;

export const CodeBlockCopiedTooltip = styled.span`
	position: absolute;
	top: -28px;
	right: 0;
	background: ${colors.gray[800]};
	color: white;
	padding: 4px 8px;
	border-radius: 4px;
	font-size: ${typography.xs};
	white-space: nowrap;
	box-shadow: ${shadows.sm};
`;

// Content area
export const CodeBlockContent = styled.div<CodeBlockStyleProps>`
	${({ $variant, $maxHeight = 400, $isStreaming, $hasContent }) => {
		const baseStyles = `
      overflow-x: auto;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #424242 #2d2d30;
      
      &::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      &::-webkit-scrollbar-track {
        background: #2d2d30;
      }
      
      &::-webkit-scrollbar-thumb {
        background: #424242;
        border-radius: 4px;
      }
      
      &::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    `;

		if ($variant === "inline") {
			return "";
		}

		if ($variant === "streaming") {
			return `
        ${baseStyles}
        max-height: ${$maxHeight}px;
        min-height: ${$hasContent ? "60px" : "0"};
        border-left: ${
					$isStreaming ? `3px solid ${colors.primary[600]}` : "none"
				};
        scroll-behavior: ${$isStreaming ? "auto" : "smooth"};
        /* Performance optimizations for streaming */
        contain: layout style paint;
        will-change: ${$isStreaming ? "scroll-position" : "auto"};
        transform: translateZ(0); /* Force GPU layer */
      `;
		}

		return `
      ${baseStyles}
      max-height: ${$maxHeight}px;
      background: #1e1e1e;
      /* Performance optimizations for expandable blocks */
      contain: layout style paint;
      will-change: ${$isStreaming ? "scroll-position" : "auto"};
      ${$isStreaming ? "transform: translateZ(0);" : ""}
    `;
	}}
`;

// Pre element
export const CodeBlockPre = styled.pre<{ $wrap?: boolean; $isDiff?: boolean }>`
	margin: 0;
	padding: 16px;
	background: #0d1117; /* Match hljs github-dark */
	border: none;
	white-space: ${({ $wrap = true }) => ($wrap ? "pre-wrap" : "pre")};
	word-break: ${({ $wrap = true }) => ($wrap ? "break-word" : "normal")};
	/* Performance optimization for text rendering */
	text-rendering: optimizeSpeed;

	${({ $isDiff }) =>
		$isDiff
			? `
    /* Diff line styling */
    .diff-line {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0;
    }
    
    .diff-line.added {
      background: rgba(16, 185, 129, 0.18);
    }
    
    .diff-line.removed {
      background: rgba(239, 68, 68, 0.18);
    }
    
    .diff-line.hunk {
      background: rgba(59, 130, 246, 0.12);
    }
    
    .diff-line.meta {
      background: rgba(156, 163, 175, 0.12);
    }
    
    .diff-collapsed {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin: 6px 0;
      color: #a3a3a3;
      background: rgba(31, 41, 55, 0.7);
      border: 1px dashed ${colors.gray[700]};
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
    }
  `
			: ""}
`;

// Code element
export const CodeBlockCode = styled.code<{ $wrap?: boolean }>`
	font-size: inherit; /* Inherit from container to ensure consistency */
	line-height: 1.4;
	background: transparent;
	white-space: inherit;
	word-break: inherit;

	/* Ensure hljs styles take precedence */
	&.hljs {
		color: inherit;
		background: inherit;

		/* Let all hljs token colors show through */
		* {
			color: inherit;
		}
	}
`;

// Lint container styles for chat variant
export const LintContainer = styled.div`
	margin: 8px 0;
`;

export const LintHeader = styled.div`
	font-size: ${typography.sm};
	display: flex;
	align-items: center;
	color: #9ca3af;
	cursor: pointer;
	user-select: none;
	padding: 4px 0;

	&:hover {
		color: #d1d5db;
	}
`;

export const LintDetails = styled.div`
	color: #9ca3af;
	font-size: ${typography.sm};
	padding-left: 14px;

	ul {
		margin: 6px 0 0 0;
		padding-left: 18px;
	}
`;

export const LintSection = styled.div`
	margin-top: 6px;
`;

// Footer actions
export const CodeBlockFooter = styled.div`
	padding: 8px 12px;
	border-top: 1px solid ${colors.gray[700]};
	background: ${colors.gray[800]};
	display: flex;
	gap: 8px;
`;

export const CodeBlockButton = styled.button`
	background: ${colors.gray[700]};
	border: 1px solid ${colors.gray[600]};
	color: #eee;
	padding: 6px 10px;
	border-radius: 4px;
	font-size: ${typography.sm};
	cursor: pointer;
	transition: all 0.15s ease;

	&:hover {
		background: ${colors.gray[600]};
	}
`;

// Size badge
export const CodeBlockSizeBadge = styled.span`
	background: ${colors.gray[700]};
	color: #ccc;
	padding: 2px 6px;
	border-radius: 3px;
	font-size: ${typography.xs};
	font-weight: 500;
`;
