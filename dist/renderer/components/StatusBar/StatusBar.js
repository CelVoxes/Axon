"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBar = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const styled_components_1 = __importDefault(require("styled-components"));
const AppContext_1 = require("../../context/AppContext");
const StatusBarContainer = styled_components_1.default.div `
	height: 24px;
	background: #007acc;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 12px;
	font-size: 12px;
	color: white;
	flex-shrink: 0;
	border-top: 1px solid #005a9e;
`;
const StatusLeft = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 12px;
`;
const StatusRight = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 12px;
`;
const StatusItem = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 6px;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.1);
	font-weight: 500;
	cursor: pointer;
	transition: background-color 0.2s;

	&:hover {
		background: rgba(255, 255, 255, 0.2);
	}
`;
const StatusBar = () => {
    const { state } = (0, AppContext_1.useAppContext)();
    return ((0, jsx_runtime_1.jsxs)(StatusBarContainer, { children: [(0, jsx_runtime_1.jsx)(StatusLeft, { children: (0, jsx_runtime_1.jsx)(StatusItem, { children: state.currentWorkspace
                        ? `Workspace: ${state.currentWorkspace}`
                        : "No workspace" }) }), (0, jsx_runtime_1.jsx)(StatusRight, { children: (0, jsx_runtime_1.jsx)(StatusItem, { children: "Ready" }) })] }));
};
exports.StatusBar = StatusBar;
