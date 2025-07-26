"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainContent = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const styled_components_1 = __importDefault(require("styled-components"));
const fi_1 = require("react-icons/fi");
const AppContext_1 = require("../../context/AppContext");
const FileEditor_1 = require("./FileEditor");
const JupyterViewer_1 = require("./JupyterViewer");
const MainContainer = styled_components_1.default.div `
	flex: 1;
	display: flex;
	flex-direction: column;
	background-color: #151515;
	overflow: hidden;
	height: 100%;
`;
const TabBar = styled_components_1.default.div `
	height: 35px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	overflow-x: auto;
`;
const Tab = styled_components_1.default.div `
	padding: 8px 16px;
	font-size: 13px;
	cursor: pointer;
	border-right: 1px solid #3e3e42;
	background-color: ${(props) => (props.isActive ? "#1e1e1e" : "transparent")};
	color: ${(props) => (props.isActive ? "#ffffff" : "#cccccc")};
	white-space: nowrap;

	&:hover {
		background-color: ${(props) => (props.isActive ? "#1e1e1e" : "#383838")};
	}

	.close {
		margin-left: 8px;
		opacity: 0.6;

		&:hover {
			opacity: 1;
		}
	}
`;
const JupyterTab = (0, styled_components_1.default)(Tab) `
	background-color: ${(props) => (props.isActive ? "#1e1e1e" : "#3e4751")};
	border-left: 3px solid #f37626;
`;
const ControlBar = styled_components_1.default.div `
	height: 40px;
	background-color: #252526;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	gap: 8px;
`;
const ControlButton = styled_components_1.default.button `
	background: #3c3c3c;
	border: 1px solid #6c6c6c;
	color: #d4d4d4;
	padding: 6px 12px;
	border-radius: 2px;
	cursor: pointer;
	font-size: 12px;
	display: flex;
	align-items: center;
	gap: 6px;

	&:hover:not(:disabled) {
		background: #464647;
	}

	&:disabled {
		background: #3c3c3c;
		color: #858585;
		cursor: not-allowed;
	}
`;
const ContentArea = styled_components_1.default.div `
	flex: 1;
	overflow: hidden;
	position: relative;
`;
const EmptyState = styled_components_1.default.div `
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #858585;
	font-size: 14px;
	padding: 40px;

	.app-logo {
		font-size: 48px;
		margin-bottom: 20px;
		color: #007acc;
		font-weight: bold;
		letter-spacing: 2px;
	}

	.title {
		font-size: 24px;
		margin-bottom: 8px;
		color: #cccccc;
		font-weight: 600;
	}

	.subtitle {
		margin-bottom: 32px;
		color: #858585;
		text-align: center;
		line-height: 1.5;
	}
`;
const WelcomeActions = styled_components_1.default.div `
	display: flex;
	gap: 16px;
	margin-bottom: 40px;
	flex-wrap: wrap;
	justify-content: center;
`;
const ActionCard = styled_components_1.default.button `
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 24px;
	min-width: 140px;
	height: 120px;
	background-color: #2d2d2d;
	border: 1px solid #404040;
	border-radius: 8px;
	color: #cccccc;
	font-size: 14px;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: #383838;
		border-color: #007acc;
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.icon {
		margin-bottom: 12px;
		font-size: 24px;
	}

	.label {
		font-weight: 500;
	}

	.description {
		font-size: 12px;
		color: #858585;
		margin-top: 4px;
		text-align: center;
	}
`;
const RecentProjects = styled_components_1.default.div `
	margin-top: 32px;
	width: 100%;
	max-width: 600px;

	.section-title {
		font-size: 16px;
		color: #cccccc;
		margin-bottom: 16px;
		font-weight: 600;
	}

	.project-item {
		display: flex;
		align-items: center;
		padding: 12px;
		background-color: #2d2d2d;
		border-radius: 6px;
		margin-bottom: 8px;
		cursor: pointer;
		transition: background-color 0.2s ease;

		&:hover {
			background-color: #383838;
		}

		.project-name {
			font-weight: 500;
			color: #cccccc;
			margin-right: 8px;
		}

		.project-path {
			color: #858585;
			font-size: 12px;
			margin-left: auto;
		}
	}
`;
const StatusIndicator = styled_components_1.default.div `
	font-size: 12px;
	color: #858585;

	${(props) => {
    if (props.status === "running") {
        return `color: #00ff00;`;
    }
    else if (props.status === "starting") {
        return `color: #ffff00;`;
    }
    else {
        return `color: #ff0000;`;
    }
}}
`;
const MainContent = (props) => {
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const [jupyterStatus, setJupyterStatus] = (0, react_1.useState)("stopped");
    const openWorkspace = async () => {
        try {
            const result = await window.electronAPI.showOpenDialog({
                properties: ["openDirectory", "createDirectory"],
                title: "Select Workspace Folder",
            });
            if (!result.canceled && result.filePaths.length > 0) {
                const workspacePath = result.filePaths[0];
                dispatch({ type: "SET_WORKSPACE", payload: workspacePath });
            }
        }
        catch (error) {
            console.error("Error opening workspace:", error);
        }
    };
    (0, react_1.useEffect)(() => {
        // Listen for Jupyter events
        window.electronAPI.onJupyterReady((data) => {
            setJupyterStatus("running");
            dispatch({ type: "SET_JUPYTER_URL", payload: data.url });
        });
        window.electronAPI.onJupyterError((error) => {
            console.error("Jupyter error:", error);
            setJupyterStatus("stopped");
        });
        return () => {
            window.electronAPI.removeAllListeners("jupyter-ready");
            window.electronAPI.removeAllListeners("jupyter-error");
        };
    }, []);
    const startJupyter = async () => {
        if (jupyterStatus !== "stopped")
            return;
        setJupyterStatus("starting");
        try {
            const workingDir = state.currentWorkspace || process.cwd();
            const result = await window.electronAPI.startJupyter(workingDir);
            if (!result.success) {
                setJupyterStatus("stopped");
                console.error("Failed to start Jupyter:", result.error);
            }
        }
        catch (error) {
            setJupyterStatus("stopped");
            console.error("Error starting Jupyter:", error);
        }
    };
    const stopJupyter = async () => {
        try {
            await window.electronAPI.stopJupyter();
            setJupyterStatus("stopped");
            dispatch({ type: "SET_JUPYTER_URL", payload: null });
        }
        catch (error) {
            console.error("Error stopping Jupyter:", error);
        }
    };
    const handleTabClose = (e, filePath) => {
        e.stopPropagation();
        dispatch({ type: "CLOSE_FILE", payload: filePath });
    };
    const renderTabBar = () => {
        if (state.openFiles.length === 0 && !state.jupyterUrl)
            return null;
        const tabs = [];
        // File tabs
        state.openFiles.forEach((filePath) => {
            const fileName = filePath.split("/").pop() || filePath;
            const isActive = state.activeFile === filePath;
            tabs.push((0, jsx_runtime_1.jsxs)(Tab, { isActive: isActive, onClick: () => dispatch({ type: "SET_ACTIVE_FILE", payload: filePath }), children: [fileName, (0, jsx_runtime_1.jsx)("span", { className: "close", onClick: (e) => handleTabClose(e, filePath), children: "\u00D7" })] }, filePath));
        });
        // Jupyter tab
        if (state.jupyterUrl) {
            tabs.push((0, jsx_runtime_1.jsx)(JupyterTab, { isActive: !state.activeFile, onClick: () => dispatch({ type: "SET_ACTIVE_FILE", payload: null }), children: "Jupyter Lab" }, "jupyter"));
        }
        return tabs;
    };
    const renderContent = () => {
        // Show file editor if a file is selected and open
        if (state.activeFile && state.openFiles.includes(state.activeFile)) {
            return (0, jsx_runtime_1.jsx)(FileEditor_1.FileEditor, { filePath: state.activeFile });
        }
        // Show Jupyter if URL is available and no file is selected
        if (state.jupyterUrl && !state.activeFile) {
            return (0, jsx_runtime_1.jsx)(JupyterViewer_1.JupyterViewer, { url: state.jupyterUrl });
        }
        // Show welcome screen when no workspace is open or no files are active
        return ((0, jsx_runtime_1.jsxs)(EmptyState, { children: [(0, jsx_runtime_1.jsx)("div", { className: "app-logo", children: "NODE" }), (0, jsx_runtime_1.jsx)("div", { className: "title", children: "Welcome to Node" }), (0, jsx_runtime_1.jsxs)("div", { className: "subtitle", children: ["AI-powered biological data analysis platform", (0, jsx_runtime_1.jsx)("br", {}), "Open a workspace and start analyzing biological data with intelligent assistance"] }), (0, jsx_runtime_1.jsxs)(WelcomeActions, { children: [(0, jsx_runtime_1.jsxs)(ActionCard, { onClick: openWorkspace, children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: (0, jsx_runtime_1.jsx)(fi_1.FiFolder, { size: 24 }) }), (0, jsx_runtime_1.jsx)("div", { className: "label", children: "Open project" }), (0, jsx_runtime_1.jsx)("div", { className: "description", children: "Open an existing folder" })] }), (0, jsx_runtime_1.jsxs)(ActionCard, { onClick: () => {
                                console.log("Clone repo clicked");
                            }, children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: "\u2318" }), (0, jsx_runtime_1.jsx)("div", { className: "label", children: "Clone repo" }), (0, jsx_runtime_1.jsx)("div", { className: "description", children: "Clone from Git repository" })] })] }), (0, jsx_runtime_1.jsxs)(RecentProjects, { children: [(0, jsx_runtime_1.jsx)("div", { className: "section-title", children: "Recent projects" }), (0, jsx_runtime_1.jsxs)("div", { className: "project-item", onClick: () => {
                                dispatch({
                                    type: "SET_WORKSPACE",
                                    payload: "/Users/onur-lumc/Desktop/BioRAG",
                                });
                                // The useEffect in Sidebar will handle file tree loading
                            }, children: [(0, jsx_runtime_1.jsx)("div", { className: "project-name", children: "BioRAG" }), (0, jsx_runtime_1.jsx)("div", { className: "project-path", children: "~/Desktop" })] })] })] }));
    };
    return ((0, jsx_runtime_1.jsxs)(MainContainer, { ...props, children: [(() => {
                const tabs = renderTabBar();
                return tabs && tabs.length > 0 ? (0, jsx_runtime_1.jsx)(TabBar, { children: tabs }) : null;
            })(), state.currentWorkspace && jupyterStatus === "running" && ((0, jsx_runtime_1.jsxs)(ControlBar, { children: [(0, jsx_runtime_1.jsx)(StatusIndicator, { status: jupyterStatus, children: "Jupyter Running" }), (0, jsx_runtime_1.jsxs)(ControlButton, { onClick: stopJupyter, children: [(0, jsx_runtime_1.jsx)(fi_1.FiSquare, { size: 14 }), "Stop Jupyter"] })] })), state.currentWorkspace && jupyterStatus === "starting" && ((0, jsx_runtime_1.jsx)(ControlBar, { children: (0, jsx_runtime_1.jsx)(StatusIndicator, { status: jupyterStatus, children: "Starting Jupyter..." }) })), (0, jsx_runtime_1.jsx)(ContentArea, { children: renderContent() })] }));
};
exports.MainContent = MainContent;
