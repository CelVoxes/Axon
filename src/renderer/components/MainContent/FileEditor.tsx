import React, { useState, useEffect } from "react";
import styled from "styled-components";
import Editor from "@monaco-editor/react";

const EditorContainer = styled.div`
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
`;

const EditorHeader = styled.div`
	height: 30px;
	background-color: #2d2d30;
	border-bottom: 1px solid #3e3e42;
	display: flex;
	align-items: center;
	padding: 0 12px;
	font-size: 12px;
	color: #cccccc;
`;

const EditorContent = styled.div`
	flex: 1;

	.monaco-editor {
		background-color: #1e1e1e !important;
	}
`;

interface FileEditorProps {
	filePath: string;
}

export const FileEditor: React.FC<FileEditorProps> = ({ filePath }) => {
	const [content, setContent] = useState<string>("");
	const [isLoading, setIsLoading] = useState(true);
	const [hasChanges, setHasChanges] = useState(false);

	useEffect(() => {
		loadFile();
	}, [filePath]);

	const loadFile = async () => {
		try {
			setIsLoading(true);
			const fileContent = await window.electronAPI.readFile(filePath);
			setContent(fileContent);
			setHasChanges(false);
		} catch (error) {
			console.error("Error loading file:", error);
			setContent(
				`// Error loading file: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		} finally {
			setIsLoading(false);
		}
	};

	const saveFile = async () => {
		try {
			await window.electronAPI.writeFile(filePath, content);
			setHasChanges(false);
		} catch (error) {
			console.error("Error saving file:", error);
		}
	};

	const handleEditorChange = (value: string | undefined) => {
		if (value !== undefined) {
			setContent(value);
			setHasChanges(true);
		}
	};

	const getLanguage = (filePath: string): string => {
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
		return (
			<EditorContainer>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						height: "100%",
						color: "#858585",
					}}
				>
					Loading {fileName}...
				</div>
			</EditorContainer>
		);
	}

	return (
		<EditorContainer>
			<EditorHeader>
				{fileName} {hasChanges && "(modified)"}
				{hasChanges && (
					<button
						onClick={saveFile}
						style={{
							marginLeft: "auto",
							background: "#0e639c",
							border: "none",
							color: "white",
							padding: "2px 8px",
							borderRadius: "2px",
							fontSize: "11px",
							cursor: "pointer",
						}}
					>
						Save
					</button>
				)}
			</EditorHeader>

			<EditorContent>
				<Editor
					height="100%"
					language={getLanguage(filePath)}
					theme="vs-dark"
					value={content}
					onChange={handleEditorChange}
					options={{
						minimap: { enabled: false },
						fontSize: 13,
						lineNumbers: "on",
						wordWrap: "on",
						automaticLayout: true,
						scrollBeyondLastLine: false,
						renderWhitespace: "selection",
						tabSize: 2,
					}}
				/>
			</EditorContent>
		</EditorContainer>
	);
};
