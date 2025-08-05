import React from "react";
import styled, { keyframes } from "styled-components";
import ReactMarkdown from "react-markdown";
import { FiCopy, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { typography } from "../../styles/design-system";

interface ChatMessageProps {
	message: {
		id: string;
		content: string;
		isUser: boolean;
		timestamp: Date;
		status?: "pending" | "completed" | "failed";
		analysisResult?: any;
		isStreaming?: boolean;
	};
}

const pulse = keyframes`
	0%, 20% { opacity: 0.4; }
	50% { opacity: 1; }
	80%, 100% { opacity: 0.4; }
`;

const MessageContainer = styled.div<{ $messageType: string }>`
	display: block;
	margin-bottom: ${(props) =>
		props.$messageType === "system" ? "8px" : "16px"};
	animation: ${(props) =>
		props.$messageType === "system" ? "none" : "fadeIn 0.3s ease-out"};

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
`;


const MessageContent = styled.div<{ $messageType: string }>`
	flex: 1;
	min-width: 0;
`;

const MessageText = styled.div<{ $messageType: string }>`
	${(props) => {
		switch (props.$messageType) {
			case "user":
				return `
					background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
					color: #ffffff;
					padding: 12px 16px;
					border-radius: 16px 16px 4px 16px;
					font-size: ${typography.base};
					line-height: 1.5;
					word-wrap: break-word;
					box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
				`;
			case "assistant":
				return `
					background: transparent;
					color: #e5e7eb;
					padding: 0;
					border-radius: 0;
					font-size: ${typography.base};
					line-height: 1.5;
					word-wrap: break-word;
					
					.expandable-code-block {
						margin: 12px 0;
						border: 1px solid #333;
						border-radius: 8px;
						overflow: hidden;
						background: #1e1e1e;
					}
					
					.code-header {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding: 8px 12px;
						background: #2d2d2d;
						border-bottom: 1px solid #333;
						cursor: pointer;
					}
					
					.code-language {
						font-size: ${typography.xs};
						color: #888;
						text-transform: uppercase;
						font-weight: 600;
					}
					
					.copy-button {
						background: #007acc;
						color: white;
						border: none;
						border-radius: 4px;
						padding: 4px 8px;
						font-size: ${typography.xs};
						cursor: pointer;
						transition: background 0.2s;
						
						&:hover {
							background: #005a9e;
						}
					}
					
					.code-content {
						background: #1e1e1e;
						border: none;
						border-radius: 0;
						padding: 16px;
						margin: 0;
						overflow-x: auto;
						max-height: 400px;
						overflow-y: auto;
						font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
						font-size: ${typography.base};
						line-height: 1.4;
					}
					
					.inline-code {
						background: #2d2d2d;
						color: #e5e7eb;
						padding: 2px 6px;
						border-radius: 4px;
						font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
						font-size: ${typography.sm};
						border: 1px solid #444;
					}
				`;
			case "system":
				return `
					background: rgba(59, 130, 246, 0.1);
					color: #93c5fd;
					padding: 8px 12px;
					border-radius: 8px;
					font-size: ${typography.base};
					line-height: 1.4;
					border-left: 3px solid #3b82f6;
					word-wrap: break-word;
				`;
			default:
				return `
					background: rgba(42, 42, 42, 0.6);
					color: #d1d5db;
					padding: 12px 16px;
					border-radius: 12px;
					font-size: ${typography.base};
					line-height: 1.5;
				`;
		}
	}}

	pre {
		background: rgba(0, 0, 0, 0.3);
		padding: 12px;
		border-radius: 6px;
		overflow-x: auto;
		margin: 8px 0;
		font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
			"Courier New", monospace;
		font-size: ${typography.base};
		border: 1px solid rgba(75, 85, 99, 0.3);
	}

	code {
		background: rgba(0, 0, 0, 0.3);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
			"Courier New", monospace;
		font-size: ${typography.sm};
		border: 1px solid rgba(75, 85, 99, 0.2);
	}

	strong {
		font-weight: 600;
		color: ${(props) =>
			props.$messageType === "user" ? "#ffffff" : "#ffffff"};
	}

	p {
		margin: 0 0 8px 0;

		&:last-child {
			margin-bottom: 0;
		}
	}

	ul,
	ol {
		margin: 8px 0;
		padding-left: 20px;
	}

	li {
		margin: 4px 0;
	}

	blockquote {
		border-left: 3px solid rgba(59, 130, 246, 0.5);
		padding-left: 12px;
		margin: 8px 0;
		font-style: italic;
		color: rgba(255, 255, 255, 0.8);
	}
`;

const ThinkingContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: rgba(42, 42, 42, 0.6);
	border-radius: 4px 16px 16px 16px;
	border: 1px solid rgba(75, 85, 99, 0.3);
	font-size: ${typography.base};
	color: #94a3b8;
`;

const ThinkingDots = styled.div`
	display: flex;
	gap: 4px;
`;

const Dot = styled.div<{ delay: number }>`
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #0ea5e9;
	animation: ${pulse} 1.4s infinite;
	animation-delay: ${(props) => props.delay}s;
`;

const MessageTimestamp = styled.div`
	font-size: ${typography.xs};
	color: #6b7280;
	margin-top: 4px;
	opacity: 0;
	transition: opacity 0.2s ease;

	${MessageContainer}:hover & {
		opacity: 1;
	}
`;

const ThinkingComponent: React.FC = () => (
	<ThinkingContainer>
		<span>Thinking</span>
		<ThinkingDots>
			<Dot delay={0} />
			<Dot delay={0.2} />
			<Dot delay={0.4} />
		</ThinkingDots>
	</ThinkingContainer>
);


const formatTimestamp = (timestamp: Date): string => {
	const now = new Date();
	const diff = now.getTime() - timestamp.getTime();
	const minutes = Math.floor(diff / 60000);

	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	return timestamp.toLocaleDateString();
};

// Expandable Code Block Component for ReactMarkdown
interface ExpandableCodeProps {
	language?: string;
	children?: React.ReactNode;
	messageId: string;
	blockIndex: number;
	isStreaming?: boolean;
}

const ExpandableCodeBlock: React.FC<ExpandableCodeProps> = ({
	language = "text",
	children,
	messageId,
	blockIndex,
	isStreaming = false,
}) => {
	const [isExpanded, setIsExpanded] = React.useState(false);
	const [copied, setCopied] = React.useState(false);
	const code = String(children || "").replace(/\n$/, "");
	const blockId = `${messageId}-code-${blockIndex}`;

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	const isLongCode = code.length > 500;
	const shouldAutoExpand = code.length <= 200 || isStreaming;

	React.useEffect(() => {
		setIsExpanded(shouldAutoExpand);
	}, [shouldAutoExpand, isStreaming]);

	return (
		<div className="expandable-code-block" style={{ margin: "12px 0" }}>
			<div 
				className="code-header" 
				onClick={() => setIsExpanded(!isExpanded)}
				style={{ cursor: "pointer" }}
			>
				<div className="code-header-left">
					<span className="code-title">Code</span>
					<span className="code-language">
						{language}
						{isStreaming && <span style={{ color: "#0ea5e9", marginLeft: 4 }}>●</span>}
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
						{copied && <span style={{ marginLeft: 4, fontSize: 12 }}>✅</span>}
					</button>
					{isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
				</div>
			</div>
			{isExpanded && (
				<div className="code-content">
					<pre style={{ 
						margin: 0,
						padding: "16px",
						background: "#1e1e1e",
						fontSize: typography.sm,
						lineHeight: "1.4",
						overflow: "auto",
						fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
						whiteSpace: "pre-wrap",
						wordWrap: "break-word"
					}}>
						<code className={`language-${language}`} style={{ 
							background: "transparent",
							color: "#e5e7eb",
							fontSize: "inherit",
							fontFamily: "inherit"
						}}>
							{code}
						</code>
					</pre>
				</div>
			)}
		</div>
	);
};

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
	const [expandedBlocks, setExpandedBlocks] = React.useState<Set<string>>(
		new Set()
	);
	const [copiedBlocks, setCopiedBlocks] = React.useState<Set<string>>(
		new Set()
	);
	let codeBlockCounter = 0;

	const copyToClipboard = React.useCallback(
		async (code: string, blockId: string) => {
			try {
				await navigator.clipboard.writeText(code);
				setCopiedBlocks((prev) => new Set(prev).add(blockId));
				setTimeout(() => {
					setCopiedBlocks((prev) => {
						const newSet = new Set(prev);
						newSet.delete(blockId);
						return newSet;
					});
				}, 2000);
			} catch (error) {
				console.error("Failed to copy code:", error);
			}
		},
		[]
	);

	const toggleCodeBlock = React.useCallback((blockId: string) => {
		setExpandedBlocks((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(blockId)) {
				newSet.delete(blockId);
			} else {
				newSet.add(blockId);
			}
			return newSet;
		});
	}, []);

	const formatContent = React.useCallback(
		(content: string): string => {
			// Convert markdown-like formatting to HTML
			let formatted = content;

			// Bold text
			formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

			// Code blocks - remove inline handlers, will be handled by React
			formatted = formatted.replace(
				/```(\w+)?\n([\s\S]*?)\n```/g,
				(match, language, code, offset) => {
					const lang = language || "text";
					const escapedCode = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
					const codeId = `${message.id}-code-${offset}`;
					const isExpanded = expandedBlocks.has(codeId);
					const isCopied = copiedBlocks.has(codeId);

					return `<div class="code-header" data-code-id="${codeId}" data-code="${escapedCode.replace(
						/"/g,
						"&quot;"
					)}">
					<div class="code-header-left">
						<span class="code-title">Code</span>
						<span class="code-language">${lang}</span>
					</div>
					<div class="code-header-right">
						<button class="copy-button">${isCopied ? "✅ Copied!" : "📋 Copy"}</button>
						<span class="toggle-icon">${isExpanded ? "▼" : "▶"}</span>
					</div>
				</div>
				<div class="code-content" style="display: ${isExpanded ? "block" : "none"};">
					<pre><code class="language-${lang}">${escapedCode}</code></pre>
				</div>`;
				}
			);

			// Inline code
			formatted = formatted.replace(
				/`([^`]+)`/g,
				"<code class='inline-code'>$1</code>"
			);

			// Line breaks
			formatted = formatted.replace(/\n/g, "<br />");

			return formatted;
		},
		[expandedBlocks, copiedBlocks]
	);

	// Handle click events for code blocks
	const handleClick = React.useCallback(
		(e: React.MouseEvent) => {
			const target = e.target as HTMLElement;
			const codeHeader = target.closest(".code-header");

			if (codeHeader) {
				const codeId = codeHeader.getAttribute("data-code-id");
				const code = codeHeader.getAttribute("data-code");

				if (target.classList.contains("copy-button") && codeId && code) {
					e.stopPropagation();
					copyToClipboard(
						code
							.replace(/&quot;/g, '"')
							.replace(/&lt;/g, "<")
							.replace(/&gt;/g, ">"),
						codeId
					);
				} else if (
					target.classList.contains("code-header") ||
					target.closest(".code-header")
				) {
					if (codeId) {
						toggleCodeBlock(codeId);
					}
				}
			}
		},
		[copyToClipboard, toggleCodeBlock]
	);

	// Determine message type from isUser and status
	const getMessageType = () => {
		if (message.isUser) return "user";
		if (message.status === "pending" && !message.content.trim())
			return "system";
		if (message.status === "failed") return "system";
		return "assistant";
	};

	const messageType = getMessageType();
	// Only show thinking bubble for empty pending messages (true loading states)
	const isThinking = message.status === "pending" && !message.content.trim();

	return (
		<MessageContainer $messageType={messageType}>
			<MessageContent $messageType={messageType}>
				{isThinking && !message.isUser ? (
					<ThinkingComponent />
				) : (
					<>
						{messageType === "assistant" ? (
							<MessageText $messageType={messageType} onClick={handleClick}>
								<ReactMarkdown
									components={{
										code: ({ node, inline, className, children, ...props }) => {
											const match = /language-(\w+)/.exec(className || '');
											const language = match ? match[1] : 'text';
											
											if (inline) {
												return (
													<code className="inline-code" {...props}>
														{children}
													</code>
												);
											}
											
											const currentIndex = codeBlockCounter++;
											return (
												<ExpandableCodeBlock
													language={language}
													messageId={message.id}
													blockIndex={currentIndex}
													isStreaming={message.isStreaming || message.status === "pending"}
												>
													{children}
												</ExpandableCodeBlock>
											);
										},
										pre: ({ children }) => {
											// Don't render the default pre tag, let our ExpandableCodeBlock handle it
											return <>{children}</>;
										}
									}}
								>
									{message.content}
								</ReactMarkdown>
							</MessageText>
						) : (
							<MessageText
								$messageType={messageType}
								onClick={handleClick}
								dangerouslySetInnerHTML={{
									__html: formatContent(message.content),
								}}
							/>
						)}
						<MessageTimestamp>
							{formatTimestamp(message.timestamp)}
						</MessageTimestamp>
					</>
				)}
			</MessageContent>
		</MessageContainer>
	);
};
