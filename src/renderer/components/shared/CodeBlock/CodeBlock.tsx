import React, { useState, useCallback } from "react";
import { FiCopy, FiChevronDown, FiChevronUp } from "react-icons/fi";
import "highlight.js/styles/github-dark.css";

import type { CodeBlockProps } from "./CodeBlockTypes";
import { useCodeHighlight } from "./hooks/useCodeHighlight";
import { useCodeStreaming } from "./hooks/useCodeStreaming";
import { parseDiffContent, getDiffStats } from "./utils/diffRenderer";
import {
	CodeBlockContainer,
	CodeBlockHeader,
	CodeBlockHeaderLeft,
	CodeBlockHeaderRight,
	CodeBlockTitle,
	CodeBlockLanguage,
	CodeBlockCopyButton,
	CodeBlockCopiedTooltip,
	CodeBlockContent,
	CodeBlockPre,
	CodeBlockCode,
	CodeBlockFooter,
	CodeBlockButton,
	CodeBlockSizeBadge,
	LintContainer,
	LintHeader,
	LintDetails,
	LintSection,
    InlineCode,
} from "./CodeBlockStyles";

import { FiChevronRight } from "react-icons/fi";

// Inline code variant
const InlineCodeBlock: React.FC<
	Extract<CodeBlockProps, { variant: "inline" }>
> = ({ code, className }) => {
	return <InlineCode className={className}>{code}</InlineCode>;
};

// Chat message code block variant
const ChatCodeBlock: React.FC<Extract<CodeBlockProps, { variant: "chat" }>> = ({
	code,
	language = "text",
	title,
	isStreaming = false,
	className,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	const { codeRef } = useCodeHighlight({ code, language, isStreaming });

	const copyToClipboard = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	}, [code]);

	// Special handling for lint blocks
	if (language === "lint") {
		const lines = code.split(/\r?\n/);
		const summaryLine = lines[0];
		const content = lines.slice(1).join("\n");

		const headerTitle = summaryLine.replace(/^LINT_SUMMARY:\s*/i, "").trim();

		// Parse errors and warnings
		const errorsList: string[] = [];
		const warningsList: string[] = [];
		let section: "none" | "errors" | "warnings" = "none";

		content.split(/\r?\n/).forEach((line) => {
			const trimmed = line.trim();
			if (/^errors:\s*$/i.test(trimmed)) {
				section = "errors";
			} else if (/^warnings:\s*$/i.test(trimmed)) {
				section = "warnings";
			} else if (/^-\s+/.test(trimmed)) {
				const message = trimmed.replace(/^-\s+/, "");
				if (section === "errors") {
					errorsList.push(message);
				} else if (section === "warnings") {
					warningsList.push(message);
				}
			}
		});

		return (
			<LintContainer className={className}>
				<LintHeader onClick={() => setIsExpanded(!isExpanded)}>
					{headerTitle || "Lint results"}
					<FiChevronRight
						size={12}
						style={{
							marginLeft: 4,
							marginTop: 2,
							color: "#9ca3af",
							transform: isExpanded ? "rotate(90deg)" : undefined,
						}}
					/>
				</LintHeader>
				{isExpanded && (
					<LintDetails>
						{errorsList.length > 0 && (
							<LintSection>
								<strong style={{ color: "#d1d5db" }}>Errors</strong>
								<ul>
									{errorsList.map((error, i) => (
										<li key={`error-${i}`}>{error}</li>
									))}
								</ul>
							</LintSection>
						)}
						{warningsList.length > 0 && (
							<LintSection>
								<strong style={{ color: "#d1d5db" }}>Warnings</strong>
								<ul>
									{warningsList.map((warning, i) => (
										<li key={`warning-${i}`}>{warning}</li>
									))}
								</ul>
							</LintSection>
						)}
						{errorsList.length === 0 && warningsList.length === 0 && (
							<LintSection>No issues listed.</LintSection>
						)}
					</LintDetails>
				)}
			</LintContainer>
		);
	}

	return (
		<CodeBlockContainer $variant="chat" className={className}>
			<CodeBlockHeader $clickable={false}>
				<CodeBlockHeaderLeft>
					<CodeBlockLanguage>{language}</CodeBlockLanguage>
					{title && <CodeBlockTitle>{title}</CodeBlockTitle>}
				</CodeBlockHeaderLeft>
				<CodeBlockHeaderRight>
					<CodeBlockCopyButton onClick={copyToClipboard}>
						<FiCopy size={14} />
						{copied && <CodeBlockCopiedTooltip>Copied!</CodeBlockCopiedTooltip>}
					</CodeBlockCopyButton>
				</CodeBlockHeaderRight>
			</CodeBlockHeader>
			<CodeBlockContent $variant="chat">
				<CodeBlockPre>
					<CodeBlockCode ref={codeRef} className={`hljs language-${language}`}>
						{code}
					</CodeBlockCode>
				</CodeBlockPre>
			</CodeBlockContent>
		</CodeBlockContainer>
	);
};

// Full expandable code block variant
const ExpandableCodeBlock: React.FC<
	Extract<CodeBlockProps, { variant: "expandable" }>
> = ({
	code,
	language = "python",
	title,
	isStreaming = false,
	showCopyButton = true,
	maxHeight = 400,
	className,
}) => {
	const [isExpanded, setIsExpanded] = useState(isStreaming);
	const [copied, setCopied] = useState(false);
	const [wrap, setWrap] = useState(true);

	const { codeRef } = useCodeHighlight({ code, language, isStreaming });
	const { scrollContainerRef, isScrollPaused } = useCodeStreaming({
		isStreaming,
		code,
		autoScroll: true,
	});

	const copyToClipboard = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	}, [code]);

	return (
		<CodeBlockContainer $variant="expandable" className={className}>
			<CodeBlockHeader onClick={() => setIsExpanded(!isExpanded)}>
				<CodeBlockHeaderLeft>
					{title && <CodeBlockTitle>{title}</CodeBlockTitle>}
					<CodeBlockLanguage>
						{language}
						{isStreaming && <span className="pulse-dot" />}
						{isStreaming && isScrollPaused && (
							<span style={{ marginLeft: 4, opacity: 0.7 }}>⏸</span>
						)}
					</CodeBlockLanguage>
					<CodeBlockSizeBadge>{code.length} chars</CodeBlockSizeBadge>
				</CodeBlockHeaderLeft>
				<CodeBlockHeaderRight>
					{showCopyButton && (
						<CodeBlockCopyButton
							onClick={(e) => {
								e.stopPropagation();
								copyToClipboard();
							}}
						>
							<FiCopy size={14} />
							{copied && (
								<CodeBlockCopiedTooltip>Copied!</CodeBlockCopiedTooltip>
							)}
						</CodeBlockCopyButton>
					)}
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</CodeBlockHeaderRight>
			</CodeBlockHeader>

			{isExpanded && (
				<>
					<CodeBlockContent
						ref={scrollContainerRef}
						$variant="expandable"
						$maxHeight={maxHeight}
						$isStreaming={isStreaming}
						$hasContent={Boolean(code)}
					>
						<CodeBlockPre $wrap={wrap}>
							<CodeBlockCode
								ref={codeRef}
								className={`hljs language-${language}`}
								$wrap={wrap}
							>
								{code}
							</CodeBlockCode>
						</CodeBlockPre>
					</CodeBlockContent>

					{!isStreaming && (
						<CodeBlockFooter>
							<CodeBlockButton onClick={() => setWrap(!wrap)}>
								{wrap ? "Disable Wrap" : "Enable Wrap"}
							</CodeBlockButton>
						</CodeBlockFooter>
					)}
				</>
			)}
		</CodeBlockContainer>
	);
};

// Streaming code block variant
const StreamingCodeBlock: React.FC<
	Extract<CodeBlockProps, { variant: "streaming" }>
> = ({
	code,
	language = "python",
	autoScroll = true,
	onStreamingComplete,
	className,
}) => {
	const { codeRef } = useCodeHighlight({ code, language, isStreaming: true });
	const { scrollContainerRef } = useCodeStreaming({
		isStreaming: true,
		code,
		autoScroll,
		onStreamingComplete,
	});

	return (
		<CodeBlockContainer $variant="streaming" className={className}>
			<CodeBlockContent
				ref={scrollContainerRef}
				$variant="streaming"
				$isStreaming={true}
				$hasContent={Boolean(code)}
			>
				<CodeBlockPre>
					<CodeBlockCode ref={codeRef} className={`hljs language-${language}`}>
						{code}
					</CodeBlockCode>
				</CodeBlockPre>
			</CodeBlockContent>
		</CodeBlockContainer>
	);
};

// Diff code block variant
const DiffCodeBlock: React.FC<Extract<CodeBlockProps, { variant: "diff" }>> = ({
    code,
    title,
    showStats = true,
    className,
}) => {
    // Keep diffs collapsed by default
    const initialStats = getDiffStats(code);
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedSegments, setExpandedSegments] = useState<
        Record<number, boolean>
    >({});
    const [copied, setCopied] = useState(false);

    const diffSegments = parseDiffContent(code);
    const { additions, deletions } = getDiffStats(code);

	const displayTitle =
		title || (showStats ? `+${additions} -${deletions}` : "Diff");

	const copyToClipboard = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	}, [code]);

	return (
		<CodeBlockContainer $variant="diff" className={className}>
			<CodeBlockHeader onClick={() => setIsExpanded(!isExpanded)}>
				<CodeBlockHeaderLeft>
					<CodeBlockTitle $isDiff={true}>
						<span className="adds">+{additions}</span>{" "}
						<span className="dels">-{deletions}</span>
					</CodeBlockTitle>
					<CodeBlockLanguage>diff</CodeBlockLanguage>
				</CodeBlockHeaderLeft>
				<CodeBlockHeaderRight>
					<CodeBlockCopyButton
						onClick={(e) => {
							e.stopPropagation();
							copyToClipboard();
						}}
					>
						<FiCopy size={14} />
						{copied && <CodeBlockCopiedTooltip>Copied!</CodeBlockCopiedTooltip>}
					</CodeBlockCopyButton>
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</CodeBlockHeaderRight>
			</CodeBlockHeader>

			{isExpanded && (
				<CodeBlockContent $variant="diff">
					<CodeBlockPre $isDiff={true}>
						<CodeBlockCode className="hljs language-diff">
							{diffSegments.map((segment, index) => {
								if (segment.type === "line") {
									const line = segment.content!;
									return (
										<div
											key={`line-${index}`}
											className={`diff-line ${line.type}`}
										>
											{line.text || "\u00A0"}
										</div>
									);
								}

								// Collapsed segment
								const isSegmentExpanded =
									expandedSegments[segment.id!] || false;
								return (
									<React.Fragment key={`segment-${index}`}>
										<div
											className="diff-collapsed"
											onClick={(e) => {
												e.stopPropagation();
												setExpandedSegments((prev) => ({
													...prev,
													[segment.id!]: !prev[segment.id!],
												}));
											}}
										>
											{isSegmentExpanded ? (
												<FiChevronUp size={12} />
											) : (
												<FiChevronDown size={12} />
											)}
											{segment.count} hidden lines
										</div>
										{isSegmentExpanded &&
											segment.lines!.map((line, lineIndex) => (
												<div
													key={`collapsed-${segment.id}-${lineIndex}`}
													className={`diff-line ${line.type}`}
												>
													{line.text || "\u00A0"}
												</div>
											))}
									</React.Fragment>
								);
							})}
						</CodeBlockCode>
					</CodeBlockPre>
				</CodeBlockContent>
			)}
		</CodeBlockContainer>
	);
};

// Main CodeBlock component with variant switching
export const CodeBlock: React.FC<CodeBlockProps> = (props) => {
	switch (props.variant) {
		case "inline":
			return <InlineCodeBlock {...props} />;
		case "chat":
			return <ChatCodeBlock {...props} />;
		case "expandable":
			return <ExpandableCodeBlock {...props} />;
		case "streaming":
			return <StreamingCodeBlock {...props} />;
		case "diff":
			return <DiffCodeBlock {...props} />;
		default:
			return <ExpandableCodeBlock {...(props as any)} />;
	}
};

// Export individual variants for direct use if needed
export {
	InlineCodeBlock,
	ChatCodeBlock,
	ExpandableCodeBlock,
	StreamingCodeBlock,
	DiffCodeBlock,
};
