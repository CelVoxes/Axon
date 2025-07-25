"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JupyterViewer = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importDefault(require("react"));
const styled_components_1 = __importDefault(require("styled-components"));
const JupyterContainer = styled_components_1.default.div `
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	background-color: #1e1e1e;
`;
const JupyterHeader = styled_components_1.default.div `
	padding: 16px;
	background-color: #2d2d2d;
	border-bottom: 1px solid #404040;
	display: flex;
	align-items: center;
	justify-content: space-between;
`;
const JupyterTitle = styled_components_1.default.h3 `
	color: #ffffff;
	margin: 0;
	font-size: 16px;
	font-weight: 600;
`;
const JupyterStatus = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 8px;
	color: #4caf50;
	font-size: 14px;
`;
const StatusDot = styled_components_1.default.div `
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: #4caf50;
`;
const JupyterFrame = styled_components_1.default.iframe `
	width: 100%;
	height: calc(100% - 60px);
	border: none;
	background-color: white;
`;
const ActionButtons = styled_components_1.default.div `
	display: flex;
	gap: 12px;
`;
const ActionButton = styled_components_1.default.button `
	background-color: #007acc;
	color: white;
	border: none;
	padding: 8px 16px;
	border-radius: 4px;
	cursor: pointer;
	font-size: 14px;

	&:hover {
		background-color: #005a9e;
	}

	&.secondary {
		background-color: #404040;
		&:hover {
			background-color: #505050;
		}
	}
`;
const LoadingMessage = styled_components_1.default.div `
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #888;
	font-size: 14px;
	text-align: center;
`;
const LoadingSpinner = styled_components_1.default.div `
	width: 40px;
	height: 40px;
	border: 3px solid #404040;
	border-top: 3px solid #007acc;
	border-radius: 50%;
	animation: spin 1s linear infinite;
	margin-bottom: 16px;

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
`;
const JupyterViewer = ({ url }) => {
    const [isLoading, setIsLoading] = react_1.default.useState(true);
    const [error, setError] = react_1.default.useState(null);
    const openInBrowser = () => {
        window.open(url, "_blank");
    };
    const refreshJupyter = () => {
        setIsLoading(true);
        setError(null);
        // Trigger iframe reload
        const iframe = document.querySelector("iframe");
        if (iframe) {
            iframe.src = iframe.src;
        }
    };
    const handleIframeLoad = () => {
        setIsLoading(false);
        setError(null);
    };
    const handleIframeError = () => {
        setIsLoading(false);
        setError("Failed to load Jupyter Lab. You can open it in your browser instead.");
    };
    return ((0, jsx_runtime_1.jsxs)(JupyterContainer, { children: [(0, jsx_runtime_1.jsxs)(JupyterHeader, { children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)(JupyterTitle, { children: "Jupyter Lab" }), (0, jsx_runtime_1.jsxs)(JupyterStatus, { children: [(0, jsx_runtime_1.jsx)(StatusDot, {}), "Running on ", url] })] }), (0, jsx_runtime_1.jsxs)(ActionButtons, { children: [(0, jsx_runtime_1.jsx)(ActionButton, { className: "secondary", onClick: refreshJupyter, children: "Refresh" }), (0, jsx_runtime_1.jsx)(ActionButton, { onClick: openInBrowser, children: "Open in Browser" })] })] }), isLoading && ((0, jsx_runtime_1.jsxs)(LoadingMessage, { children: [(0, jsx_runtime_1.jsx)(LoadingSpinner, {}), (0, jsx_runtime_1.jsx)("div", { children: "Loading Jupyter Lab..." }), (0, jsx_runtime_1.jsx)("div", { style: { fontSize: "12px", marginTop: "8px", color: "#666" }, children: "If this takes too long, click \"Open in Browser\"" })] })), error && ((0, jsx_runtime_1.jsxs)(LoadingMessage, { children: [(0, jsx_runtime_1.jsx)("div", { style: { color: "#ff6b6b", marginBottom: "16px" }, children: error }), (0, jsx_runtime_1.jsx)(ActionButton, { onClick: openInBrowser, children: "Open in Browser" })] })), (0, jsx_runtime_1.jsx)(JupyterFrame, { src: url, onLoad: handleIframeLoad, onError: handleIframeError, style: { display: isLoading || error ? "none" : "block" }, title: "Jupyter Lab" })] }));
};
exports.JupyterViewer = JupyterViewer;
