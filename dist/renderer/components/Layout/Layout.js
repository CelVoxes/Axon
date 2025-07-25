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
exports.Layout = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const styled_components_1 = __importDefault(require("styled-components"));
const LayoutContainer = styled_components_1.default.div `
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: #0f0f0f;
	color: #ffffff;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
		Ubuntu, Cantarell, sans-serif;
`;
const LayoutHeader = styled_components_1.default.div `
	height: 40px;
	background: linear-gradient(180deg, #1e1e1e 0%, #1a1a1a 100%);
	border-bottom: 1px solid #2a2a2a;
	display: flex;
	align-items: center;
	padding: 0 16px;
	flex-shrink: 0;
	-webkit-app-region: drag;

	/* Make buttons in header clickable */
	button {
		-webkit-app-region: no-drag;
	}
`;
const LayoutBodyContainer = styled_components_1.default.div `
	flex: 1;
	display: flex;
	overflow: hidden;
	position: relative;
`;
const ResizablePane = styled_components_1.default.div `
	width: ${(props) => props.width}px;
	min-width: ${(props) => props.minWidth}px;
	max-width: ${(props) => props.maxWidth}px;
	flex-shrink: 0;
	overflow: hidden;
	position: relative;
`;
const MainPane = styled_components_1.default.div `
	flex: 1;
	overflow: hidden;
	background: #151515;
	position: relative;
`;
const Resizer = styled_components_1.default.div `
	width: 4px;
	background: transparent;
	cursor: col-resize;
	position: relative;
	transition: background-color 0.2s ease;

	&:hover {
		background: #0ea5e9;
	}

	&:active {
		background: #0284c7;
	}

	&::before {
		content: "";
		position: absolute;
		top: 0;
		left: -2px;
		right: -2px;
		bottom: 0;
		z-index: 10;
	}
`;
const Layout = ({ children }) => {
    return (0, jsx_runtime_1.jsx)(LayoutContainer, { children: children });
};
const LayoutWithSubComponents = Layout;
exports.Layout = LayoutWithSubComponents;
const Header = ({ children }) => {
    return (0, jsx_runtime_1.jsx)(LayoutHeader, { children: children });
};
const Body = ({ children }) => {
    const [leftPaneWidth, setLeftPaneWidth] = (0, react_1.useState)(240);
    const [rightPaneWidth, setRightPaneWidth] = (0, react_1.useState)(380);
    const [isResizingLeft, setIsResizingLeft] = (0, react_1.useState)(false);
    const [isResizingRight, setIsResizingRight] = (0, react_1.useState)(false);
    const handleMouseDown = (side) => (e) => {
        e.preventDefault();
        if (side === "left") {
            setIsResizingLeft(true);
        }
        else {
            setIsResizingRight(true);
        }
    };
    react_1.default.useEffect(() => {
        const handleMouseMove = (e) => {
            if (isResizingLeft) {
                const newWidth = Math.max(200, Math.min(500, e.clientX));
                setLeftPaneWidth(newWidth);
            }
            else if (isResizingRight) {
                const newWidth = Math.max(300, Math.min(600, window.innerWidth - e.clientX));
                setRightPaneWidth(newWidth);
            }
        };
        const handleMouseUp = () => {
            setIsResizingLeft(false);
            setIsResizingRight(false);
        };
        if (isResizingLeft || isResizingRight) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        }
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [isResizingLeft, isResizingRight]);
    const childrenArray = react_1.default.Children.toArray(children);
    const leftPane = childrenArray.find((child) => child?.props?.["data-layout-role"] === "sidebar");
    const mainPane = childrenArray.find((child) => child?.props?.["data-layout-role"] === "main");
    const rightPane = childrenArray.find((child) => child?.props?.["data-layout-role"] === "chat");
    return ((0, jsx_runtime_1.jsxs)(LayoutBodyContainer, { children: [leftPane && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(ResizablePane, { width: leftPaneWidth, minWidth: 200, maxWidth: 500, children: leftPane }), (0, jsx_runtime_1.jsx)(Resizer, { onMouseDown: handleMouseDown("left") })] })), (0, jsx_runtime_1.jsx)(MainPane, { children: mainPane }), rightPane && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)(Resizer, { onMouseDown: handleMouseDown("right") }), (0, jsx_runtime_1.jsx)(ResizablePane, { width: rightPaneWidth, minWidth: 300, maxWidth: 600, children: rightPane })] }))] }));
};
LayoutWithSubComponents.Header = Header;
LayoutWithSubComponents.Body = Body;
