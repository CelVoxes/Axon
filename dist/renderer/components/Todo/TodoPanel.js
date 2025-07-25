"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TodoPanel = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const styled_components_1 = __importDefault(require("styled-components"));
const fi_1 = require("react-icons/fi");
const AppContext_1 = require("../../context/AppContext");
const TodoContainer = styled_components_1.default.div `
	width: 300px;
	background-color: #252526;
	border-left: 1px solid #3e3e42;
	display: flex;
	flex-direction: column;
	overflow: hidden;
`;
const TodoHeader = styled_components_1.default.div `
	height: 35px;
	padding: 8px 12px;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: #cccccc;

	.close-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		padding: 2px;

		&:hover {
			color: #ffffff;
		}
	}
`;
const TodoList = styled_components_1.default.div `
	flex: 1;
	overflow-y: auto;
	padding: 8px;
`;
const TodoItem = styled_components_1.default.div `
	background: #2d2d30;
	border: 1px solid #3e3e42;
	border-radius: 4px;
	padding: 12px;
	margin-bottom: 8px;

	border-left: 3px solid
		${(props) => {
    switch (props.status) {
        case "completed":
            return "#4caf50";
        case "in_progress":
            return "#ff9800";
        case "cancelled":
            return "#f44336";
        default:
            return "#2196f3";
    }
}};
`;
const TodoContent = styled_components_1.default.div `
	font-size: 13px;
	color: #d4d4d4;
	margin-bottom: 8px;
	line-height: 1.4;
`;
const TodoMeta = styled_components_1.default.div `
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 11px;
	color: #858585;
`;
const TodoStatus = styled_components_1.default.div `
	display: flex;
	align-items: center;
	gap: 4px;

	color: ${(props) => {
    switch (props.status) {
        case "completed":
            return "#4caf50";
        case "in_progress":
            return "#ff9800";
        case "cancelled":
            return "#f44336";
        default:
            return "#2196f3";
    }
}};
`;
const TodoActions = styled_components_1.default.div `
	display: flex;
	gap: 4px;
`;
const ActionButton = styled_components_1.default.button `
	background: none;
	border: none;
	color: #858585;
	cursor: pointer;
	padding: 2px;

	&:hover {
		color: #d4d4d4;
	}
`;
const EmptyState = styled_components_1.default.div `
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: #858585;
	font-size: 13px;
	text-align: center;
	padding: 20px;
`;
const TodoPanel = ({ onClose }) => {
    const { state, dispatch } = (0, AppContext_1.useAppContext)();
    const getStatusIcon = (status) => {
        switch (status) {
            case "completed":
                return (0, jsx_runtime_1.jsx)(fi_1.FiCheck, { size: 12 });
            case "in_progress":
                return (0, jsx_runtime_1.jsx)(fi_1.FiPlay, { size: 12 });
            case "cancelled":
                return (0, jsx_runtime_1.jsx)(fi_1.FiX, { size: 12 });
            default:
                return (0, jsx_runtime_1.jsx)(fi_1.FiClock, { size: 12 });
        }
    };
    const getStatusText = (status) => {
        switch (status) {
            case "completed":
                return "Completed";
            case "in_progress":
                return "In Progress";
            case "cancelled":
                return "Cancelled";
            default:
                return "Pending";
        }
    };
    const handleStatusChange = (todoId, newStatus) => {
        dispatch({
            type: "UPDATE_TODO",
            payload: {
                id: todoId,
                updates: { status: newStatus },
            },
        });
    };
    const handleDelete = (todoId) => {
        dispatch({
            type: "DELETE_TODO",
            payload: todoId,
        });
    };
    const formatTime = (date) => {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    return ((0, jsx_runtime_1.jsxs)(TodoContainer, { children: [(0, jsx_runtime_1.jsxs)(TodoHeader, { children: ["TODO List", (0, jsx_runtime_1.jsx)("button", { className: "close-btn", onClick: onClose, children: (0, jsx_runtime_1.jsx)(fi_1.FiX, { size: 14 }) })] }), (0, jsx_runtime_1.jsx)(TodoList, { children: state.todos.length === 0 ? ((0, jsx_runtime_1.jsxs)(EmptyState, { children: [(0, jsx_runtime_1.jsx)(fi_1.FiAlertCircle, { size: 24, style: { marginBottom: "8px" } }), "No tasks yet", (0, jsx_runtime_1.jsx)("br", {}), (0, jsx_runtime_1.jsx)("small", { children: "Tasks will appear here when you request biological analysis" })] })) : (state.todos.map((todo) => ((0, jsx_runtime_1.jsxs)(TodoItem, { status: todo.status, children: [(0, jsx_runtime_1.jsx)(TodoContent, { children: todo.content }), (0, jsx_runtime_1.jsxs)(TodoMeta, { children: [(0, jsx_runtime_1.jsxs)(TodoStatus, { status: todo.status, children: [getStatusIcon(todo.status), getStatusText(todo.status)] }), (0, jsx_runtime_1.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [(0, jsx_runtime_1.jsx)("span", { children: formatTime(todo.updatedAt) }), (0, jsx_runtime_1.jsxs)(TodoActions, { children: [todo.status === "pending" && ((0, jsx_runtime_1.jsx)(ActionButton, { onClick: () => handleStatusChange(todo.id, "in_progress"), title: "Start task", children: (0, jsx_runtime_1.jsx)(fi_1.FiPlay, { size: 12 }) })), todo.status === "in_progress" && ((0, jsx_runtime_1.jsx)(ActionButton, { onClick: () => handleStatusChange(todo.id, "completed"), title: "Mark as completed", children: (0, jsx_runtime_1.jsx)(fi_1.FiCheck, { size: 12 }) })), (0, jsx_runtime_1.jsx)(ActionButton, { onClick: () => handleDelete(todo.id), title: "Delete task", children: (0, jsx_runtime_1.jsx)(fi_1.FiX, { size: 12 }) })] })] })] })] }, todo.id)))) })] }));
};
exports.TodoPanel = TodoPanel;
