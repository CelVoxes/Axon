import React from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import { typography } from "../../styles/design-system";
import { Message } from "../../context/AppContext";
import { CodeBlock } from "./shared/CodeBlock";

interface ChatMessageProps {
	message: Message;
	onAnalysisClick?: (analysisType: string) => void;
}

const MessageContainer = styled.div<{ $messageType: string }>`
	display: block;
	margin-bottom: ${(props) =>
		props.$messageType === "system" ? "8px" : "0px"};
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

export const ChatMessage: React.FC<ChatMessageProps> = ({
	message,
	onAnalysisClick,
}) => {
	// Use shared CodeBlock in markdown code renderer for all message types

	// Determine message type from isUser and status
	const getMessageType = () => {
		if (message.isUser) return "user";
		if (message.status === "pending" && !message.content.trim())
			return "system";
		if (message.status === "failed") return "system";
		return "assistant";
	};

	const messageType = getMessageType();

	return (
		<MessageContainer $messageType={messageType}>
			<MessageContent $messageType={messageType}>
				<MessageText $messageType={messageType}>
					<ReactMarkdown
						components={{
							code: ({ node, inline, className, children, ...props }) => {
								const match = /language-(\w+)/.exec(className || "");
								const language = match ? match[1] : "text";
								if (inline) {
									return (
										<code className="inline-code" {...props}>
											{children}
										</code>
									);
								}
								const codeContent = String(children || "").trim();
								if (
									codeContent.length === 0 ||
									codeContent.replace(/\s/g, "").length === 0 ||
									(message.isStreaming && codeContent.length === 0)
								) {
									return null;
								}

								// Compute header title for diff blocks as "+<adds> -<dels>"
								let headerTitle = "";
								if (language === "diff") {
									try {
										const lines = codeContent.split(/\r?\n/);
										let adds = 0;
										let dels = 0;
										for (const line of lines) {
											if (
												line.startsWith("+++") ||
												line.startsWith("---") ||
												line.startsWith("diff ") ||
												line.startsWith("@@")
											) {
												continue;
											}
											if (line.startsWith("+")) adds++;
											else if (line.startsWith("-")) dels++;
										}
										headerTitle = `+${adds} -${dels}`;
									} catch {
										headerTitle = "";
									}
								}

								return (
									<CodeBlock
										code={codeContent}
										language={language}
										title={headerTitle}
										isStreaming={
											message.isStreaming || message.status === "pending"
										}
									/>
								);
							},
							pre: ({ children }) => {
								return <>{children}</>;
							},
							a: ({ href, children, ...props }) => {
								if (href && href.startsWith("analyze:")) {
									const analysisType = href.replace("analyze:", "");
									return (
										<button
											type="button"
											onClick={(e) => {
												e.preventDefault();
												if (onAnalysisClick) {
													onAnalysisClick(analysisType);
												}
											}}
											style={{
												color: "#007acc",
												cursor: "pointer",
												textDecoration: "underline",
												background: "none",
												border: "none",
												padding: 0,
												font: "inherit",
												display: "inline",
											}}
										>
											{children}
										</button>
									);
								}
								if (
									href &&
									(href.startsWith("http://") || href.startsWith("https://"))
								) {
									return (
										<a href={href} target="_blank" rel="noopener noreferrer">
											{children}
										</a>
									);
								} else {
									return (
										<span
											style={{
												color: "#007acc",
												textDecoration: "underline",
											}}
										>
											{children}
										</span>
									);
								}
							},
						}}
					>
						{message.content}
					</ReactMarkdown>
				</MessageText>
				<MessageTimestamp>
					{formatTimestamp(message.timestamp)}
				</MessageTimestamp>
			</MessageContent>
		</MessageContainer>
	);
};
