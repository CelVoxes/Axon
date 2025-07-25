"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileEditor = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const styled_components_1 = __importDefault(require("styled-components"));
const react_2 = __importDefault(require("@monaco-editor/react"));
const EditorContainer = styled_components_1.default.div `
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
`;
const EditorHeader = styled_components_1.default.div `
	height: 30px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	font-size: 12px;
	color: #cccccc;
`;
const EditorContent = styled_components_1.default.div `
	flex: 1;

	.monaco-editor {
		background-color: #1e1e1e !important;
	}
`;
const FileEditor = ({ filePath }) => {
    const [content, setContent] = (0, react_1.useState)("");
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const [hasChanges, setHasChanges] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => {
        loadFile();
    }, [filePath]);
    const loadFile = async () => {
        try {
            setIsLoading(true);
            const fileContent = await window.electronAPI.readFile(filePath);
            setContent(fileContent);
            setHasChanges(false);
        }
        catch (error) {
            console.error("Error loading file:", error);
            setContent(`// Error loading file: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            setIsLoading(false);
        }
    };
    const saveFile = async () => {
        try {
            await window.electronAPI.writeFile(filePath, content);
            setHasChanges(false);
        }
        catch (error) {
            console.error("Error saving file:", error);
        }
    };
    const handleEditorChange = (value) => {
        if (value !== undefined) {
            setContent(value);
            setHasChanges(true);
        }
    };
    const getLanguage = (filePath) => {
        const extension = filePath.split(".").pop()?.toLowerCase();
        switch (extension) {
            case "py":
                return "python";
            case "r":
                return "r";
            case "js":
                return "javascript";
            case "ts":
                return "typescript";
            case "json":
                return "json";
            case "md":
                return "markdown";
            case "yml":
            case "yaml":
                return "yaml";
            case "sh":
                return "shell";
            case "sql":
                return "sql";
            default:
                return "plaintext";
        }
    };
    const fileName = filePath.split("/").pop() || filePath;
    if (isLoading) {
        return ((0, jsx_runtime_1.jsx)(EditorContainer, { children: (0, jsx_runtime_1.jsxs)("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    color: "#858585",
                }, children: ["Loading ", fileName, "..."] }) }));
    }
    return ((0, jsx_runtime_1.jsxs)(EditorContainer, { children: [(0, jsx_runtime_1.jsxs)(EditorHeader, { children: [fileName, " ", hasChanges && "(modified)", hasChanges && ((0, jsx_runtime_1.jsx)("button", { onClick: saveFile, style: {
                            marginLeft: "auto",
                            background: "#0e639c",
                            border: "none",
                            color: "white",
                            padding: "2px 8px",
                            borderRadius: "2px",
                            fontSize: "11px",
                            cursor: "pointer",
                        }, children: "Save" }))] }), (0, jsx_runtime_1.jsx)(EditorContent, { children: (0, jsx_runtime_1.jsx)(react_2.default, { height: "100%", language: getLanguage(filePath), theme: "vs-dark", value: content, onChange: handleEditorChange, options: {
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: "on",
                        wordWrap: "on",
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        renderWhitespace: "selection",
                        tabSize: 2,
                    } }) })] }));
};
exports.FileEditor = FileEditor;
