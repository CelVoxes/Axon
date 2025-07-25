"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessage = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const styled_components_1 = __importStar(require("styled-components"));
const fi_1 = require("react-icons/fi");
const pulse = (0, styled_components_1.keyframes) `
	0%, 20% { opacity: 0.4; }
	50% { opacity: 1; }
	80%, 100% { opacity: 0.4; }
`;
const MessageContainer = styled_components_1.default.div `
	display: flex;
	align-items: flex-start;
	gap: 12px;
	margin-bottom: ${(props) => props.messageType === "system" ? "8px" : "16px"};
	animation: ${(props) => props.messageType === "system" ? "none" : "fadeIn 0.3s ease-out"};

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
const Avatar = styled_components_1.default.div `
	width: 32px;
	height: 32px;
	border-radius: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	font-size: 14px;

	${(props) => {
    switch (props.messageType) {
        case "user":
            return `
					background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
					color: #ffffff;
				`;
        case "assistant":
            return `
					background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
					color: #ffffff;
				`;
        case "system":
            return `
					background: rgba(75, 85, 99, 0.8);
					color: #d1d5db;
				`;
        default:
            return `
					background: #374151;
					color: #d1d5db;
				`;
    }
}}
`;
const MessageContent = styled_components_1.default.div `
	flex: 1;
	min-width: 0;
`;
const MessageText = styled_components_1.default.div `
	${(props) => {
    switch (props.messageType) {
        case "user":
            return `
					background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
					color: #ffffff;
					padding: 12px 16px;
					border-radius: 16px 16px 4px 16px;
					font-size: 14px;
					line-height: 1.5;
					word-wrap: break-word;
					box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
				`;
        case "assistant":
            return `
					background: rgba(42, 42, 42, 0.6);
					color: #ffffff;
					padding: 16px;
					border-radius: 4px 16px 16px 16px;
					font-size: 14px;
					line-height: 1.6;
					border: 1px solid rgba(75, 85, 99, 0.3);
					word-wrap: break-word;
				`;
        case "system":
            return `
					background: rgba(59, 130, 246, 0.1);
					color: #93c5fd;
					padding: 8px 12px;
					border-radius: 8px;
					font-size: 13px;
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
					font-size: 14px;
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
		font-size: 13px;
		border: 1px solid rgba(75, 85, 99, 0.3);

		&::-webkit-scrollbar {
			height: 6px;
		}

		&::-webkit-scrollbar-track {
			background: transparent;
		}

		&::-webkit-scrollbar-thumb {
			background: rgba(255, 255, 255, 0.2);
			border-radius: 3px;
		}
	}

	code {
		background: rgba(0, 0, 0, 0.3);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
			"Courier New", monospace;
		font-size: 12px;
		border: 1px solid rgba(75, 85, 99, 0.2);
	}

	strong {
		font-weight: 600;
		color: ${(props) => (props.messageType === "user" ? "#ffffff" : "#ffffff")};
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
const ThinkingContainer = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: rgba(42, 42, 42, 0.6);
	border-radius: 4px 16px 16px 16px;
	border: 1px solid rgba(75, 85, 99, 0.3);
	font-size: 14px;
	color: #94a3b8;
`;
const ThinkingDots = styled_components_1.default.div `
	display: flex;
	gap: 4px;
`;
const Dot = styled_components_1.default.div `
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #0ea5e9;
	animation: ${pulse} 1.4s infinite;
	animation-delay: ${(props) => props.delay}s;
`;
const MessageTimestamp = styled_components_1.default.div `
	font-size: 11px;
	color: #6b7280;
	margin-top: 4px;
	opacity: 0;
	transition: opacity 0.2s ease;

	${MessageContainer}:hover & {
		opacity: 1;
	}
`;
const ThinkingComponent = () => ((0, jsx_runtime_1.jsxs)(ThinkingContainer, { children: [(0, jsx_runtime_1.jsx)("span", { children: "Thinking" }), (0, jsx_runtime_1.jsxs)(ThinkingDots, { children: [(0, jsx_runtime_1.jsx)(Dot, { delay: 0 }), (0, jsx_runtime_1.jsx)(Dot, { delay: 0.2 }), (0, jsx_runtime_1.jsx)(Dot, { delay: 0.4 })] })] }));
const formatContent = (content) => {
    // Convert markdown-like formatting to HTML
    let formatted = content;
    // Bold text
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Code blocks
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)\n```/g, "<pre><code>$2</code></pre>");
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Line breaks
    formatted = formatted.replace(/\n/g, "<br />");
    return formatted;
};
const getMessageIcon = (type) => {
    switch (type) {
        case "user":
            return (0, jsx_runtime_1.jsx)(fi_1.FiUser, {});
        case "assistant":
            return (0, jsx_runtime_1.jsx)(fi_1.FiCpu, {});
        case "system":
            return (0, jsx_runtime_1.jsx)(fi_1.FiSettings, {});
        default:
            return (0, jsx_runtime_1.jsx)(fi_1.FiCpu, {});
    }
};
const formatTimestamp = (timestamp) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1)
        return "Just now";
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    return timestamp.toLocaleDateString();
};
const ChatMessage = ({ message }) => {
    // Determine message type from isUser and status
    const getMessageType = () => {
        if (message.isUser)
            return "user";
        if (message.status === "pending" && !message.content.trim())
            return "system";
        if (message.status === "failed")
            return "system";
        return "assistant";
    };
    const messageType = getMessageType();
    // Only show thinking bubble for empty pending messages (true loading states)
    const isThinking = message.status === "pending" && !message.content.trim();
    return ((0, jsx_runtime_1.jsxs)(MessageContainer, { messageType: messageType, children: [(0, jsx_runtime_1.jsx)(Avatar, { messageType: messageType, children: getMessageIcon(messageType) }), (0, jsx_runtime_1.jsx)(MessageContent, { messageType: messageType, children: isThinking && !message.isUser ? ((0, jsx_runtime_1.jsx)(ThinkingComponent, {})) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(MessageText, { messageType: messageType, dangerouslySetInnerHTML: {
                                __html: formatContent(message.content),
                            } }), (0, jsx_runtime_1.jsx)(MessageTimestamp, { children: formatTimestamp(message.timestamp) })] })) })] }));
};
exports.ChatMessage = ChatMessage;
