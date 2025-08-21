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
	cursor: pointer;
	text-align: left;

	&:hover {
		background: ${colors.gray[700]};
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

const Content = styled.div<{
    $streaming?: boolean;
    $wrap?: boolean;
    $streamingActive?: boolean;
    $hasContent?: boolean;
}>`
	max-height: 420px;
	overflow-y: auto;
	overflow-x: auto;
	min-height: ${(p) => (p.$hasContent ? "60px" : "0")};
	scroll-behavior: ${(p) => (p.$streaming ? "auto" : "smooth")};
	border-left: ${(p) =>
		p.$streamingActive ? `3px solid ${colors.primary[600]}` : "none"};
	/* Match global scrollbar styling */
	scrollbar-width: thin;
	scrollbar-color: #424242 #2d2d30;
	scrollbar-gutter: stable both-edges;
	overscroll-behavior: contain;

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

const Pre = styled.pre<{ $wrap?: boolean; $isDiff?: boolean }>`
    margin: 0;
    padding: 12px;
    /* Match highlight.js github-dark background from the start */
    background: #0d1117;
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

    /* Collapsed section indicator */
    .diff-collapsed {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin: 6px 0;
      color: #a3a3a3;
      background: rgba(31, 41, 55, 0.7);
      border: 1px dashed ${colors.gray[700]};
      border-radius: ${borderRadius.sm};
      cursor: pointer;
      user-select: none;
    }

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
    /* Slightly smaller font for better density */
    font-size: ${typography.sm};
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
export const CodeBlock: React.FC<CodeBlockProps> = React.memo(
    ({ code, language = "python", title = "", isStreaming = false }) => {
		const [isExpanded, setIsExpanded] = useState(isStreaming);
		const [copied, setCopied] = useState(false);
		const [showFullCode, setShowFullCode] = useState(false);
		const [isScrollPaused, setIsScrollPaused] = useState(false);
		// The scrollable container is the wrapper div with class `code-content`, not the <pre>
		const scrollContainerRef = useRef<HTMLDivElement | null>(null);
		const autoScrollRef = useRef(true);
		const codeRef = useRef<HTMLElement | null>(null);
		const lastStreamingContentRef = useRef<string>("");

		// Full build of highlight.js includes common languages; no manual registration needed

		// Auto-expand when streaming starts and ensure auto-scroll is enabled
		useEffect(() => {
			if (isStreaming) {
				setIsExpanded(true);
				// Ensure auto-scroll is enabled when streaming starts
				autoScrollRef.current = true;
				setIsScrollPaused(false);
			}
		}, [isStreaming]);

		const handleToggle = useCallback(() => {
			setIsExpanded((prev) => !prev);
		}, []);

    // Track scroll position: only pause auto-scroll when user has scrolled up
    const lastPausedRef = useRef<boolean>(false);

		useEffect(() => {
			const el = scrollContainerRef.current;
			if (!el) return;

        const onScroll = () => {
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
            autoScrollRef.current = nearBottom;
            if (lastPausedRef.current === nearBottom) return;
            lastPausedRef.current = nearBottom;
            setIsScrollPaused(!nearBottom);
        };

			el.addEventListener("scroll", onScroll, { passive: true });
            return () => {
                el.removeEventListener("scroll", onScroll);
            };
        }, []);

        // Auto-scroll on content growth only
        const lastScrollHeightRef = useRef<number>(0);

		useLayoutEffect(() => {
			if (!isExpanded) {
				return;
			}
			const el = scrollContainerRef.current;
			if (!el) {
				return;
			}

            const newH = el.scrollHeight;
            if (isStreaming) {
                if (autoScrollRef.current && newH > (lastScrollHeightRef.current || 0)) {
                    el.scrollTop = newH;
                }
                lastScrollHeightRef.current = newH;
            } else if (autoScrollRef.current) {
                // On final render, ensure we end at bottom once
                requestAnimationFrame(() => {
                    el.scrollTop = el.scrollHeight;
                    lastScrollHeightRef.current = el.scrollHeight;
                });
            }

            return () => {};
        }, [code, isStreaming, isExpanded]);

        // Highlight code when content changes; skip during streaming to avoid jank
        useEffect(() => {
            if (isStreaming) return;
            const el = codeRef.current as HTMLElement | null;
            if (!el) return;

            requestAnimationFrame(() => {
                try {
                    const highlightText = code; // never truncate

                    // Always reset to plain text to avoid leftover spans triggering HLJS security warnings
                    el.textContent = highlightText;
                    // Ensure hljs + language classes are present from the start
                    el.className = `hljs language-${language}`;
                    el.removeAttribute("data-highlighted");
                    hljs.highlightElement(el);
                } catch (e) {
                    console.error("Highlight.js error:", e);
                }
            });
        }, [code, language, isExpanded, isStreaming]);

        // One-time initial highlight when the first non-empty chunk arrives during streaming
        const didInitialHighlightRef = useRef<boolean>(false);
        useEffect(() => {
            if (!isStreaming) {
                didInitialHighlightRef.current = false;
                return;
            }
            if (!code || code.length === 0) return;
            if (didInitialHighlightRef.current) return;
            const el = codeRef.current as HTMLElement | null;
            if (!el) return;
            try {
                // Set plain text and run a single highlight pass
                el.textContent = code;
                el.className = `hljs language-${language}`;
                el.removeAttribute('data-highlighted');
                hljs.highlightElement(el);
                didInitialHighlightRef.current = true;
            } catch {
                // ignore
            }
        }, [isStreaming, code, language]);

		// When streaming completes, do a final scroll to bottom if not paused
		useEffect(() => {
			if (!isStreaming) {
				const el = scrollContainerRef.current;
				if (!el) return;
				if (autoScrollRef.current) {
					requestAnimationFrame(() => {
						el.scrollTop = el.scrollHeight;
					});
				}
			}
		}, [isStreaming]);

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
		// Do not truncate diff blocks; we handle length via collapsed hunks
		const isLongCode = false;
		const displayCode = React.useMemo(() => {
			if (isStreaming) {
				// During streaming, prevent rapid content changes
				if (lastStreamingContentRef.current === code) {
					return lastStreamingContentRef.current;
				}
				lastStreamingContentRef.current = code;
				return code;
			}
		return code;
		}, [code, isStreaming]);

		const [wrap, setWrap] = useState(true);
		const isDiff = (language || "").toLowerCase() === "diff";

		type DiffRenderable =
			| { type: "line"; text: string; cls: string }
			| {
					type: "collapsed";
					id: number;
					count: number;
					lines: Array<{ text: string; cls: string }>;
			  };

		const [expanded, setExpanded] = useState<Record<number, boolean>>({});

		const diffSegments = React.useMemo(() => {
			if (!isDiff) return [] as DiffRenderable[];
			const rawLines = displayCode.split(/\r?\n/);

			// Classify lines
			const classify = (
				line: string
			): {
				text: string;
				cls: string;
				kind: "meta" | "hunk" | "add" | "del" | "unchanged";
			} => {
				if (
					line.startsWith("+++ ") ||
					line.startsWith("--- ") ||
					line.startsWith("diff ") ||
					line.startsWith("index ")
				) {
					return { text: line, cls: "diff-line meta", kind: "meta" };
				}
				if (line.startsWith("@@")) {
					return { text: line, cls: "diff-line hunk", kind: "hunk" };
				}
				if (line.startsWith("+") && !line.startsWith("+++ ")) {
					return { text: line, cls: "diff-line added", kind: "add" };
				}
				if (line.startsWith("-") && !line.startsWith("--- ")) {
					return { text: line, cls: "diff-line removed", kind: "del" };
				}
				return { text: line, cls: "diff-line", kind: "unchanged" };
			};

			const classified = rawLines.map(classify);
			const importantIdx: number[] = [];
			for (let i = 0; i < classified.length; i++) {
				const k = classified[i].kind;
				if (k === "add" || k === "del" || k === "hunk" || k === "meta") {
					importantIdx.push(i);
				}
			}

			// If nothing stands out, fall back to rendering all lines
			if (importantIdx.length === 0) {
				return classified.map((c) => ({
					type: "line",
					text: c.text,
					cls: c.cls,
				})) as DiffRenderable[];
			}

			const segments: DiffRenderable[] = [];
			let cursor = 0;
			let segId = 0;
			for (const idx of importantIdx) {
				// Collapse unchanged run before this important line
				if (idx > cursor) {
					const lines = classified
						.slice(cursor, idx)
						.map((c) => ({ text: c.text, cls: c.cls }));
					const count = lines.length;
					if (count > 0) {
						segments.push({ type: "collapsed", id: segId++, count, lines });
					}
				}
				// Emit the important line itself
				const c = classified[idx];
				segments.push({ type: "line", text: c.text, cls: c.cls });
				cursor = idx + 1;
			}
			// Tail unchanged lines
			if (cursor < classified.length) {
				const lines = classified
					.slice(cursor)
					.map((c) => ({ text: c.text, cls: c.cls }));
				const count = lines.length;
				if (count > 0) {
					segments.push({ type: "collapsed", id: segId++, count, lines });
				}
			}

			return segments;
		}, [displayCode, isDiff]);

		return (
			<Container>
				<Header
					role="button"
					tabIndex={0}
					onClick={handleToggle}
					$disabled={false}
					aria-disabled={false}
					aria-expanded={isExpanded}
					aria-label={isExpanded ? "Collapse code" : "Expand code"}
					onKeyDown={(e) => {
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
							{isStreaming && isScrollPaused && (
								<span
									title="Auto-scroll paused"
									style={{ marginLeft: "4px", opacity: 0.7 }}
								>
									⏸
								</span>
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
						{isExpanded ? (
							<FiChevronUp size={16} />
						) : (
							<FiChevronDown size={16} />
						)}
					</HeaderRight>
				</Header>
				{isExpanded && (
					<>
						<Content
							ref={scrollContainerRef}
							$streaming={isStreaming}
							$streamingActive={isStreaming && Boolean(code && code.trim().length > 0)}
							$hasContent={Boolean(code && code.length > 0)}
							$wrap={wrap}
						>
							<Pre $wrap={wrap} $isDiff={isDiff}>
								{isDiff ? (
                            <code className={`hljs language-${language}`}>
										{diffSegments.map((seg, idx) => {
											if (seg.type === "line") {
												return (
													<div key={`l-${idx}`} className={seg.cls}>
														{seg.text || "\u00A0"}
													</div>
												);
											}
											const isOpen = !!expanded[seg.id];
											return (
												<React.Fragment key={`c-${idx}`}>
													<div
														className="diff-collapsed"
														role="button"
														aria-expanded={isOpen}
														onClick={(e) => {
															e.stopPropagation();
															setExpanded((prev) => ({
																...prev,
																[seg.id]: !prev[seg.id],
															}));
														}}
														title={isOpen ? "Hide context" : "Show context"}
													>
														{isOpen ? (
															<FiChevronUp size={12} />
														) : (
															<FiChevronDown size={12} />
														)}
														{seg.count} hidden lines
													</div>
													{isOpen &&
														seg.lines.map((l, j) => (
															<div key={`cx-${seg.id}-${j}`} className={l.cls}>
																{l.text || "\u00A0"}
															</div>
														))}
												</React.Fragment>
											);
										})}
									</code>
								) : (
                        <Code
                            ref={codeRef as unknown as React.RefObject<HTMLElement>}
                            className={`hljs language-${language}`}
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
	},
	(prevProps, nextProps) => {
		// Custom comparison function to prevent unnecessary re-renders
		return (
			prevProps.code === nextProps.code &&
			prevProps.language === nextProps.language &&
			prevProps.title === nextProps.title &&
			prevProps.isStreaming === nextProps.isStreaming
		);
	}
);
