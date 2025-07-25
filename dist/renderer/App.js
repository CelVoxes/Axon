"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const Layout_1 = require("./components/Layout/Layout");
const Sidebar_1 = require("./components/Sidebar/Sidebar");
const ChatPanel_1 = require("./components/Chat/ChatPanel");
const MainContent_1 = require("./components/MainContent/MainContent");
const StatusBar_1 = require("./components/StatusBar/StatusBar");
const AppContext_1 = require("./context/AppContext");
const AppContent = () => {
    const { state } = (0, AppContext_1.useAppContext)();
    const [chatCollapsed, setChatCollapsed] = (0, react_1.useState)(true);
    (0, react_1.useEffect)(() => {
        // Show chat panel when a workspace is opened
        if (state.currentWorkspace) {
            setChatCollapsed(false);
        }
    }, [state.currentWorkspace]);
    return ((0, jsx_runtime_1.jsxs)(Layout_1.Layout, { children: [(0, jsx_runtime_1.jsx)(Layout_1.Layout.Header, {}), (0, jsx_runtime_1.jsxs)(Layout_1.Layout.Body, { children: [state.currentWorkspace && ((0, jsx_runtime_1.jsx)(Sidebar_1.Sidebar, { collapsed: false, onToggle: () => { }, "data-layout-role": "sidebar" })), (0, jsx_runtime_1.jsx)(MainContent_1.MainContent, { "data-layout-role": "main" }), !chatCollapsed && state.currentWorkspace && ((0, jsx_runtime_1.jsx)(ChatPanel_1.ChatPanel, { collapsed: false, onToggle: () => setChatCollapsed(!chatCollapsed), "data-layout-role": "chat" }))] }), (0, jsx_runtime_1.jsx)(StatusBar_1.StatusBar, {})] }));
};
const App = () => {
    return ((0, jsx_runtime_1.jsx)(AppContext_1.AppProvider, { children: (0, jsx_runtime_1.jsx)(AppContent, {}) }));
};
exports.App = App;
