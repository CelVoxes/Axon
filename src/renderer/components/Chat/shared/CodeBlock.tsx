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
		if (codeRef.current) {
			try {
				// If this element was highlighted before, remove the marker so we can re-highlight cleanly
				codeRef.current.removeAttribute("data-highlighted");
				hljs.highlightElement(codeRef.current);
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("Highlight.js error:", e);
			}
		}
	}, [code, language, isExpanded, isStreaming]);

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

	return (
		<div className="expandable-code-block">
			<div
				className={`code-header ${isStreaming ? "non-interactive" : ""}`}
				onClick={handleToggle}
			>
				<div className="code-header-left">
					{title && <span className="code-title">{title}</span>}
					<span className="code-language">
						{language}
						{isStreaming && (
							<span className="pulse-dot" aria-label="Streaming" />
						)}
					</span>
					<span className="code-size-indicator">{code.length} chars</span>
				</div>
				<div className="code-header-right">
					<button
						className="copy-button"
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard();
						}}
						title="Copy code"
					>
						<FiCopy size={14} />
						{copied && <span className="copied-tooltip">Copied!</span>}
					</button>
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</div>
			</div>
			{isExpanded && (
				<div
					className={`code-content ${isStreaming ? "streaming" : ""}`}
					ref={scrollContainerRef}
				>
					<pre>
						<code
							ref={codeRef as unknown as React.RefObject<HTMLElement>}
							className={`language-${language}`}
						>
							{displayCode}
						</code>
					</pre>
					{isLongCode && !isStreaming && (
						<div className="code-actions" style={{ padding: "8px 12px" }}>
							<button
								className="show-more-button"
								onClick={(e) => {
									e.stopPropagation();
									setShowFullCode((s) => !s);
								}}
							>
								{showFullCode ? "Show Less" : "Show Full Code"}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
