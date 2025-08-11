import React, {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useCallback,
} from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { FiCopy, FiChevronDown, FiChevronUp } from "react-icons/fi";
import styled from "styled-components";
import {
	colors,
	typography,
	borderRadius,
	shadows,
} from "../../../styles/design-system";

const Container = styled.div`
	border: 1px solid ${colors.gray[700]};
	border-radius: ${borderRadius.lg};
	margin: 12px 0;
	overflow: hidden;
`;

const Header = styled.div<{ $disabled?: boolean }>`
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px;
	background: #222;
	cursor: ${(p) => (p.$disabled ? "default" : "pointer")};
	text-align: left;

	&:hover {
		background: ${(p) => (p.$disabled ? colors.gray[800] : colors.gray[700])};
	}
`;

const HeaderLeft = styled.div`
	display: flex;
	align-items: center;
	gap: 10px;
`;

const Title = styled.span<{ $isDiff?: boolean }>`
	color: #fff;
	font-weight: 600;
	font-size: ${typography.base};

	${(p) =>
		p.$isDiff
			? `
    .adds { color: ${colors.success}; }
    .dels { color: ${colors.error}; }
  `
			: ""}
`;

const LanguagePill = styled.span`
	background: ${colors.primary[600]};
	color: #fff;
	padding: 2px 8px;
	border-radius: ${borderRadius.sm};
	font-size: ${typography.xs};
	font-weight: 600;
	text-transform: uppercase;
	display: inline-flex;
	align-items: center;
	gap: 6px;
`;

const SizeBadge = styled.span`
	background: ${colors.gray[700]};
	color: #ccc;
	padding: 2px 6px;
	border-radius: ${borderRadius.sm};
	font-size: ${typography.xs};
	font-weight: 500;
`;

const HeaderRight = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
`;

const IconButton = styled.button`
	background: transparent;
	border: 1px solid ${colors.gray[600]};
	border-radius: ${borderRadius.sm};
	padding: 4px 8px;
	color: #ddd;
	cursor: pointer;
	position: relative;
	transition: all 0.15s ease;

	&:hover {
		background: ${colors.primary[600]};
		border-color: ${colors.primary[600]};
		color: white;
	}
`;

const CopiedTooltip = styled.span`
	position: absolute;
	top: -28px;
	right: 0;
	background: ${colors.gray[800]};
	color: #fff;
	padding: 4px 8px;
	border-radius: ${borderRadius.sm};
	font-size: ${typography.xs};
	box-shadow: ${shadows.sm};
`;

const Content = styled.div<{ $streaming?: boolean; $wrap?: boolean }>`
	max-height: 420px;
	overflow-y: auto;
	overflow-x: auto;
	min-height: 60px;
	border-left: ${(p) =>
		p.$streaming ? `3px solid ${colors.primary[600]}` : "none"};
`;

const Pre = styled.pre<{ $wrap?: boolean; $isDiff?: boolean }>`
	margin: 0;
	padding: 12px;
	background: transparent;
	border: none;
	white-space: ${(p) => (p.$wrap ? "pre-wrap" : "pre")};
	word-break: ${(p) => (p.$wrap ? "break-word" : "normal")};
	${(p) =>
		p.$isDiff
			? `
    /* Fallback custom diff line styling */
    .diff-line { display: block; width: 100%; }
    .diff-line.added { background: rgba(16, 185, 129, 0.18); }
    .diff-line.removed { background: rgba(239, 68, 68, 0.18); }
    .diff-line.hunk { background: rgba(59, 130, 246, 0.12); }
    .diff-line.meta { background: rgba(156, 163, 175, 0.12); }

    /* When highlight.js marks tokens, also tint them */
    code > span.hljs-addition,
    code .hljs-addition { background: rgba(16, 185, 129, 0.18); display: block; width: 100%; }
    code > span.hljs-deletion,
    code .hljs-deletion { background: rgba(239, 68, 68, 0.18); display: block; width: 100%; }
  `
			: ""}
`;

const Code = styled.code<{ $wrap?: boolean }>`
	font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
	font-size: ${typography.base};
	line-height: 1.5;
	color: #e1e4e8;
	background: transparent;
	white-space: inherit;
	word-break: inherit;
`;

const FooterActions = styled.div`
	padding: 8px 12px;
	border-top: 1px solid ${colors.gray[700]};
	background: ${colors.gray[800]};
	display: flex;
	gap: 8px;
`;

const SecondaryButton = styled.button`
	background: ${colors.gray[700]};
	border: 1px solid ${colors.gray[600]};
	color: #eee;
	padding: 6px 10px;
	border-radius: ${borderRadius.sm};
	font-size: ${typography.sm};
	cursor: pointer;
	transition: all 0.15s ease;

	&:hover {
		background: ${colors.gray[600]};
	}
`;

export interface CodeBlockProps {
	code: string;
	language?: string;
	title?: string;
	isStreaming?: boolean;
}

/**
 * Expandable code block with copy and smart auto-scroll.
 * This is a shared, presentation-only component.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({
	code,
	language = "python",
	title = "Generated Code",
	isStreaming = false,
}) => {
	const [isExpanded, setIsExpanded] = useState(isStreaming);
	const [copied, setCopied] = useState(false);
	const [showFullCode, setShowFullCode] = useState(false);
	// The scrollable container is the wrapper div with class `code-content`, not the <pre>
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const autoScrollRef = useRef(true);
	const codeRef = useRef<HTMLElement | null>(null);

	// Full build of highlight.js includes common languages; no manual registration needed

	// Auto-expand when streaming starts
	useEffect(() => {
		if (isStreaming) setIsExpanded(true);
	}, [isStreaming]);

	const handleToggle = useCallback(() => {
		if (isStreaming) return; // prevent collapsing during streaming
		setIsExpanded((prev) => !prev);
	}, [isStreaming]);

	// Track user scroll to pause autoscroll when scrolled up
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const onScroll = () => {
			// Larger threshold to reduce oscillation near the bottom
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
			autoScrollRef.current = nearBottom;
		};
		el.addEventListener("scroll", onScroll);
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	// Auto-scroll as content streams in
	useLayoutEffect(() => {
		if (!isExpanded) return;
		if (!isStreaming && !autoScrollRef.current) return;
		const el = scrollContainerRef.current;
		if (!el) return;
		if (autoScrollRef.current) {
			// Defer to next frame to avoid layout thrash
			requestAnimationFrame(() => {
				el.scrollTop = el.scrollHeight;
			});
		}
	}, [code, isStreaming, isExpanded]);

	// Highlight code when content changes; skip during streaming to avoid jank
	useEffect(() => {
		if (isStreaming) return;
		const el = codeRef.current as HTMLElement | null;
		if (!el) return;
		try {
			// Compute the exact text that will be shown
			const isLong = !isStreaming && code.length > 1000;
			const highlightText = isStreaming
				? code
				: isLong && !showFullCode
				? `${code.substring(0, 1000)}\n\n... (truncated)`
				: code;
			// Ensure we're highlighting plain text, not HTML
			el.textContent = highlightText;
			el.className = `language-${language}`;
			el.removeAttribute("data-highlighted");
			hljs.highlightElement(el);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("Highlight.js error:", e);
		}
	}, [code, language, isExpanded, isStreaming, showFullCode]);

	const copyToClipboard = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("Failed to copy code:", e);
		}
	}, [code]);

	// Do not truncate while streaming to avoid contradicting live generation
	const isLongCode = !isStreaming && code.length > 1000;
	const displayCode = isStreaming
		? code
		: isLongCode && !showFullCode
		? `${code.substring(0, 1000)}\n\n... (truncated)`
		: code;

	const [wrap, setWrap] = useState(true);
	const isDiff = (language || "").toLowerCase() === "diff";

	const diffLines = React.useMemo(() => {
		if (!isDiff) return [] as Array<{ text: string; cls: string }>;
		const lines = displayCode.split(/\r?\n/);
		return lines.map((line) => {
			if (
				line.startsWith("+++ ") ||
				line.startsWith("--- ") ||
				line.startsWith("diff ") ||
				line.startsWith("index ")
			) {
				return { text: line, cls: "diff-line meta" };
			}
			if (line.startsWith("@@")) {
				return { text: line, cls: "diff-line hunk" };
			}
			if (line.startsWith("+")) {
				return { text: line, cls: "diff-line added" };
			}
			if (line.startsWith("-")) {
				return { text: line, cls: "diff-line removed" };
			}
			return { text: line, cls: "diff-line" };
		});
	}, [displayCode, isDiff]);

	return (
		<Container>
			<Header
				role="button"
				tabIndex={isStreaming ? -1 : 0}
				onClick={handleToggle}
				$disabled={isStreaming}
				aria-disabled={isStreaming}
				aria-expanded={isExpanded}
				aria-label={isExpanded ? "Collapse code" : "Expand code"}
				onKeyDown={(e) => {
					if (isStreaming) return;
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						handleToggle();
					}
				}}
			>
				<HeaderLeft>
					{title && (
						<Title $isDiff={isDiff}>
							{isDiff ? (
								<>
									<span className="adds">{title.split(" ")[0]}</span>{" "}
									<span className="dels">{title.split(" ")[1] || ""}</span>
								</>
							) : (
								title
							)}
						</Title>
					)}
					<LanguagePill>
						{language}
						{isStreaming && (
							<span className="pulse-dot" aria-label="Streaming" />
						)}
					</LanguagePill>
					<SizeBadge>{code.length} chars</SizeBadge>
				</HeaderLeft>
				<HeaderRight>
					<IconButton
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard();
						}}
						title="Copy code"
						aria-label="Copy code"
					>
						<FiCopy size={14} />
						{copied && <CopiedTooltip>Copied!</CopiedTooltip>}
					</IconButton>
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</HeaderRight>
			</Header>
			{isExpanded && (
				<>
					<Content
						ref={scrollContainerRef}
						$streaming={isStreaming}
						$wrap={wrap}
					>
						<Pre $wrap={wrap} $isDiff={isDiff}>
							{isDiff ? (
								<code className={`language-${language}`}>
									{diffLines.map((l, idx) => (
										<div key={idx} className={l.cls}>
											{l.text || "\u00A0"}
										</div>
									))}
								</code>
							) : (
								<Code
									ref={codeRef as unknown as React.RefObject<HTMLElement>}
									className={`language-${language}`}
									$wrap={wrap}
								>
									{displayCode}
								</Code>
							)}
						</Pre>
					</Content>
					{!isStreaming && (
						<FooterActions>
							{isLongCode && (
								<SecondaryButton
									onClick={(e) => {
										e.stopPropagation();
										setShowFullCode((s) => !s);
									}}
								>
									{showFullCode ? "Show Less" : "Show Full Code"}
								</SecondaryButton>
							)}
							<SecondaryButton
								onClick={(e) => {
									e.stopPropagation();
									setWrap((w) => !w);
								}}
							>
								{wrap ? "Disable Wrap" : "Enable Wrap"}
							</SecondaryButton>
						</FooterActions>
					)}
				</>
			)}
		</Container>
	);
};
