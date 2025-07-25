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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sidebar = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const styled_components_1 = __importDefault(require("styled-components"));
const fi_1 = require("react-icons/fi");
const AppContext_1 = require("../../context/AppContext");
const SidebarContainer = styled_components_1.default.div `
	width: 100%;
	height: 100%;
	background-color: #1a1a1a;
	border-right: 1px solid #2a2a2a;
	display: flex;
	flex-direction: column;
	overflow: hidden;
`;
const SidebarHeader = styled_components_1.default.div `
	padding: 8px 12px;
	font-size: 11px;
	font-weight: 600;
	color: #cccccc;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
`;
const SidebarContent = styled_components_1.default.div `
	flex: 1;
	overflow-y: auto;
	padding: 8px 0;
`;
const FileTree = styled_components_1.default.div `
	font-size: 13px;
`;
const FileItem = styled_components_1.default.div `
	display: flex;
	align-items: center;
	padding: 4px 8px 4px ${(props) => 8 + props.level * 16}px;
	cursor: pointer;
	color: #cccccc;
	height: 22px;

	&:hover {
		background-color: #37373d;
	}

	.icon {
		margin-right: 6px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.name {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
`;
const BreadcrumbNav = styled_components_1.default.div `
	padding: 8px 12px;
	font-size: 12px;
	color: #858585;
	border-bottom: 1px solid #3e3e42;
	background-color: #2d2d30;
	display: flex;
	align-items: center;
	gap: 4px;

	.nav-item {
		cursor: pointer;
		color: #007acc;

		&:hover {
			text-decoration: underline;
		}
	}

	.separator {
		color: #858585;
	}
`;
const Sidebar = ({ collapsed, onToggle, ...props }) => {
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const [currentPath, setCurrentPath] = (0, react_1.useState)("");
    const [currentFiles, setCurrentFiles] = (0, react_1.useState)([]);
    // Load file tree when workspace changes
    (0, react_1.useEffect)(() => {
        if (state.currentWorkspace) {
            setCurrentPath(state.currentWorkspace);
            loadDirectory(state.currentWorkspace);
        }
    }, [state.currentWorkspace]);
    // Listen for file tree refresh events from the autonomous agent
    (0, react_1.useEffect)(() => {
        const handleRefresh = () => {
            if (currentPath) {
                loadDirectory(currentPath);
            }
        };
        window.addEventListener("refreshFileTree", handleRefresh);
        return () => window.removeEventListener("refreshFileTree", handleRefresh);
    }, [currentPath]);
    const loadDirectory = async (dirPath) => {
        try {
            const files = await window.electronAPI.listDirectory(dirPath);
            // Sort: directories first, then files, both alphabetically
            const sortedFiles = files.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            setCurrentFiles(sortedFiles);
        }
        catch (error) {
            console.error("Error loading directory:", error);
            setCurrentFiles([]);
        }
    };
    const handleItemClick = (item) => {
        if (item.isDirectory) {
            // Navigate into the directory
            setCurrentPath(item.path);
            loadDirectory(item.path);
        }
        else {
            // Open the file
            dispatch({ type: "OPEN_FILE", payload: item.path });
            dispatch({ type: "SET_ACTIVE_FILE", payload: item.path });
        }
    };
    const navigateToParent = () => {
        if (!state.currentWorkspace || currentPath === state.currentWorkspace) {
            return;
        }
        const parentPath = currentPath.split("/").slice(0, -1).join("/");
        if (parentPath && parentPath.length >= state.currentWorkspace.length) {
            setCurrentPath(parentPath);
            loadDirectory(parentPath);
        }
    };
    const navigateToWorkspaceRoot = () => {
        if (state.currentWorkspace) {
            setCurrentPath(state.currentWorkspace);
            loadDirectory(state.currentWorkspace);
        }
    };
    const getBreadcrumbs = () => {
        if (!state.currentWorkspace || !currentPath)
            return [];
        const workspaceName = state.currentWorkspace.split("/").pop() || "Workspace";
        const relativePath = currentPath.replace(state.currentWorkspace, "");
        if (!relativePath || relativePath === "/") {
            return [{ name: workspaceName, path: state.currentWorkspace }];
        }
        const parts = relativePath.split("/").filter(Boolean);
        const breadcrumbs = [{ name: workspaceName, path: state.currentWorkspace }];
        let buildPath = state.currentWorkspace;
        for (const part of parts) {
            buildPath += "/" + part;
            breadcrumbs.push({ name: part, path: buildPath });
        }
        return breadcrumbs;
    };
    return ((0, jsx_runtime_1.jsxs)(SidebarContainer, { collapsed: false, ...props, children: [(0, jsx_runtime_1.jsx)(SidebarHeader, { children: "Explorer" }), state.currentWorkspace && ((0, jsx_runtime_1.jsx)(BreadcrumbNav, { children: getBreadcrumbs().map((crumb, index, array) => ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [(0, jsx_runtime_1.jsx)("span", { className: "nav-item", onClick: () => {
                                setCurrentPath(crumb.path);
                                loadDirectory(crumb.path);
                            }, children: crumb.name }), index < array.length - 1 && (0, jsx_runtime_1.jsx)("span", { className: "separator", children: "/" })] }, crumb.path))) })), (0, jsx_runtime_1.jsx)(SidebarContent, { children: state.currentWorkspace ? ((0, jsx_runtime_1.jsxs)(FileTree, { children: [currentPath !== state.currentWorkspace && ((0, jsx_runtime_1.jsxs)(FileItem, { isDirectory: true, level: 0, onClick: navigateToParent, children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: (0, jsx_runtime_1.jsx)(fi_1.FiChevronRight, { size: 12, style: { transform: "rotate(180deg)" } }) }), (0, jsx_runtime_1.jsx)("div", { className: "name", children: ".." })] })), currentFiles.map((item) => ((0, jsx_runtime_1.jsxs)(FileItem, { isDirectory: item.isDirectory, level: 0, onClick: () => handleItemClick(item), children: [(0, jsx_runtime_1.jsx)("div", { className: "icon", children: item.isDirectory ? ((0, jsx_runtime_1.jsx)(fi_1.FiChevronRight, { size: 12 })) : ((0, jsx_runtime_1.jsx)(fi_1.FiFile, { size: 12 })) }), (0, jsx_runtime_1.jsx)("div", { className: "name", children: item.name })] }, item.path)))] })) : ((0, jsx_runtime_1.jsx)("div", { style: { padding: "16px", textAlign: "center", color: "#858585" }, children: "No workspace opened" })) })] }));
};
exports.Sidebar = Sidebar;
