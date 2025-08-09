import React, { useEffect, useRef, useState, useCallback } from "react";
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
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
			autoScrollRef.current = nearBottom;
		};
		el.addEventListener("scroll", onScroll);
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	// Auto-scroll as content streams in
	useEffect(() => {
		if (!isExpanded) return;
		if (!isStreaming && !autoScrollRef.current) return;
		const el = scrollContainerRef.current;
		if (!el) return;
		if (autoScrollRef.current) el.scrollTop = el.scrollHeight;
	}, [code, isStreaming, isExpanded]);

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

	const isLongCode = code.length > 1000;
	const displayCode =
		isLongCode && !showFullCode
			? `${code.substring(0, 1000)}\n\n... (truncated)`
			: code;

	return (
		<div className="expandable-code-block" style={{ margin: "12px 0" }}>
			<div
				className="code-header"
				onClick={handleToggle}
				style={{ cursor: isStreaming ? "default" : "pointer" }}
			>
				<div className="code-header-left">
					{title && <span className="code-title">{title}</span>}
					<span className="code-language" style={{ marginLeft: 8 }}>
						{language}
						{isStreaming && (
							<span className="streaming-indicator" style={{ marginLeft: 4 }}>
								●
							</span>
						)}
					</span>
					<span className="code-size-indicator" style={{ marginLeft: 8 }}>
						{code.length} chars
					</span>
				</div>
				<div
					className="code-header-right"
					style={{ display: "flex", gap: 8, alignItems: "center" }}
				>
					<button
						className="copy-button"
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard();
						}}
						title="Copy code"
					>
						<FiCopy size={14} />
						{copied && (
							<span className="copied-tooltip" style={{ marginLeft: 6 }}>
								Copied!
							</span>
						)}
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
						<code className={`language-${language}`}>{displayCode}</code>
					</pre>
					{isLongCode && (
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
