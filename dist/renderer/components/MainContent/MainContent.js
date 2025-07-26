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
const Notebook_1 = require("./Notebook");
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
const ControlBar = styled_components_1.default.div `
	height: 40px;
	background-color: #252526;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	gap: 8px;
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
const MainContent = (props) => {
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const [recentWorkspaces, setRecentWorkspaces] = (0, react_1.useState)([]);
    const recentWorkspacesRef = (0, react_1.useRef)([]);
    // Keep ref in sync with state
    (0, react_1.useEffect)(() => {
        recentWorkspacesRef.current = recentWorkspaces;
    }, [recentWorkspaces]);
    // Load recent workspaces from storage
    (0, react_1.useEffect)(() => {
        const loadRecentWorkspaces = async () => {
            try {
                const recent = await window.electronAPI.storeGet("recentWorkspaces");
                if (recent && Array.isArray(recent)) {
                    // Filter out null/undefined values and ensure all are strings
                    const validWorkspaces = recent.filter((w) => typeof w === "string" && w.length > 0);
                    setRecentWorkspaces(validWorkspaces);
                }
            }
            catch (error) {
                console.error("Error loading recent workspaces:", error);
            }
        };
        loadRecentWorkspaces();
    }, []);
    // Update recent workspaces when a new workspace is opened
    (0, react_1.useEffect)(() => {
        if (state.currentWorkspace && typeof state.currentWorkspace === "string") {
            const updateRecentWorkspaces = async () => {
                try {
                    const current = recentWorkspacesRef.current.filter((w) => w !== state.currentWorkspace);
                    const updated = [state.currentWorkspace, ...current].slice(0, 5); // Keep last 5
                    setRecentWorkspaces(updated);
                    await window.electronAPI.storeSet("recentWorkspaces", updated);
                }
                catch (error) {
                    console.error("Error updating recent workspaces:", error);
                }
            };
            updateRecentWorkspaces();
        }
    }, [state.currentWorkspace]); // Removed recentWorkspaces from dependencies
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
    const openRecentWorkspace = async (workspacePath) => {
        try {
            // Check if the workspace still exists
            const exists = await window.electronAPI
                .listDirectory(workspacePath)
                .catch(() => false);
            if (exists) {
                dispatch({ type: "SET_WORKSPACE", payload: workspacePath });
            }
            else {
                // Remove from recent if it doesn't exist
                const updated = recentWorkspacesRef.current.filter((w) => w !== workspacePath);
                setRecentWorkspaces(updated);
                await window.electronAPI.storeSet("recentWorkspaces", updated);
                console.warn(`Workspace ${workspacePath} no longer exists`);
            }
        }
        catch (error) {
            console.error("Error opening recent workspace:", error);
        }
    };
    const getWorkspaceDisplayName = (path) => {
        const parts = path.split("/");
        return parts[parts.length - 1] || path;
    };
    const getWorkspaceDisplayPath = (path) => {
        // Simple approach: just show the last two parts of the path
        const parts = path.split("/").filter((part) => part.length > 0);
        if (parts.length <= 2) {
            return path;
        }
        // Show last two directories
        return `.../${parts.slice(-2).join("/")}`;
    };
    const handleTabClose = (e, filePath) => {
        e.stopPropagation();
        dispatch({ type: "CLOSE_FILE", payload: filePath });
    };
    const renderTabBar = () => {
        if (state.openFiles.length === 0 && !state.currentWorkspace)
            return null;
        const tabs = [];
        // File tabs
        state.openFiles.forEach((filePath) => {
            const fileName = filePath.split("/").pop() || filePath;
            const isActive = state.activeFile === filePath;
            tabs.push((0, jsx_runtime_1.jsxs)(Tab, { isActive: isActive, onClick: () => dispatch({ type: "SET_ACTIVE_FILE", payload: filePath }), children: [fileName, (0, jsx_runtime_1.jsx)("span", { className: "close", onClick: (e) => handleTabClose(e, filePath), children: "\u00D7" })] }, filePath));
        });
        // Notebook tab (only show when workspace is open)
        if (state.currentWorkspace) {
            tabs.push((0, jsx_runtime_1.jsx)(Tab, { isActive: state.showNotebook, onClick: () => {
                    dispatch({ type: "SET_ACTIVE_FILE", payload: null });
                    dispatch({ type: "SET_SHOW_NOTEBOOK", payload: true });
                }, children: "Interactive Notebook" }, "notebook"));
        }
        return tabs;
    };
    const renderContent = () => {
        // Show notebook if it's active
        if (state.showNotebook) {
            return (0, jsx_runtime_1.jsx)(Notebook_1.Notebook, { workspacePath: state.currentWorkspace || undefined });
        }
        // Show file editor if a file is selected and open
        if (state.activeFile && state.openFiles.includes(state.activeFile)) {
            return (0, jsx_runtime_1.jsx)(FileEditor_1.FileEditor, { filePath: state.activeFile });
        }
        // Show welcome screen when no workspace is open or no files are active
        return ((0, jsx_runtime_1.jsxs)(EmptyState, { children: [(0, jsx_runtime_1.jsx)("div", { className: "app-logo", children: "NODE" }), (0, jsx_runtime_1.jsx)("div", { className: "title", children: "Welcome to Node" }), (0, jsx_runtime_1.jsxs)("div", { className: "subtitle", children: ["AI-powered biological data analysis platform", (0, jsx_runtime_1.jsx)("br", {}), "Open a workspace and start analyzing biological data with intelligent assistance"] }), (0, jsx_runtime_1.jsxs)(WelcomeActions, { children: [(0, jsx_runtime_1.jsxs)(ActionCard, { onClick: openWorkspace, children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: (0, jsx_runtime_1.jsx)(fi_1.FiFolder, { size: 24 }) }), (0, jsx_runtime_1.jsx)("div", { className: "label", children: "Open project" }), (0, jsx_runtime_1.jsx)("div", { className: "description", children: "Open an existing folder" })] }), (0, jsx_runtime_1.jsxs)(ActionCard, { onClick: () => {
                                console.log("Clone repo clicked");
                            }, children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: "\u2318" }), (0, jsx_runtime_1.jsx)("div", { className: "label", children: "Clone repo" }), (0, jsx_runtime_1.jsx)("div", { className: "description", children: "Clone from Git repository" })] })] }), (0, jsx_runtime_1.jsxs)(RecentProjects, { children: [(0, jsx_runtime_1.jsx)("div", { className: "section-title", children: "Recent projects" }), recentWorkspaces.length > 0 ? (recentWorkspaces.map((workspacePath, index) => ((0, jsx_runtime_1.jsxs)("div", { className: "project-item", onClick: () => openRecentWorkspace(workspacePath), children: [(0, jsx_runtime_1.jsx)("div", { className: "project-name", children: getWorkspaceDisplayName(workspacePath) }), (0, jsx_runtime_1.jsx)("div", { className: "project-path", children: getWorkspaceDisplayPath(workspacePath) })] }, workspacePath)))) : ((0, jsx_runtime_1.jsxs)("div", { className: "project-item", style: { opacity: 0.6, cursor: "default" }, children: [(0, jsx_runtime_1.jsx)("div", { className: "project-name", children: "No recent projects" }), (0, jsx_runtime_1.jsx)("div", { className: "project-path", children: "Open a project to see it here" })] }))] })] }));
    };
    return ((0, jsx_runtime_1.jsxs)(MainContainer, { ...props, children: [(() => {
                const tabs = renderTabBar();
                return tabs && tabs.length > 0 ? (0, jsx_runtime_1.jsx)(TabBar, { children: tabs }) : null;
            })(), state.currentWorkspace && ((0, jsx_runtime_1.jsx)(ControlBar, { children: (0, jsx_runtime_1.jsx)(StatusIndicator, { status: "running", children: "Workspace Open" }) })), (0, jsx_runtime_1.jsx)(ContentArea, { children: renderContent() })] }));
};
exports.MainContent = MainContent;
