import { ToolRegistry } from "./ToolRegistry";
import { WorkspaceLsTool } from "./WorkspaceLsTool";
import { FileHeadTool } from "./FileHeadTool";
import { PythonProbeTool } from "./PythonProbeTool";
import { AutoPeekTool } from "./AutoPeekTool";

// Initialize registry with built-in tools
const registry = ToolRegistry.getInstance();
registry.register(WorkspaceLsTool);
registry.register(FileHeadTool);
registry.register(PythonProbeTool);
registry.register(AutoPeekTool);

export class ChatToolService {
	static isToolCommand(text: string): boolean {
		return text.trim().startsWith("/");
	}

	static async tryHandle(
		message: string,
		workspaceDir: string | undefined,
		addMessage: (
			content: string,
			isUser: boolean,
			code?: string,
			codeLanguage?: string,
			codeTitle?: string,
			suggestions?: any,
			status?: "pending" | "completed" | "failed",
			isStreaming?: boolean
		) => void
	): Promise<boolean> {
		if (!this.isToolCommand(message)) return false;

		const tool = ToolRegistry.getInstance().find(message);
		if (!tool) {
			addMessage(`Unknown tool. Try /ls or /head`, false);
			return true;
		}
		const result = await ToolRegistry.getInstance().execute(message, {
			workspaceDir,
		});
		if (!result.ok) {
			addMessage(result.message || "Tool failed", false);
			return true;
		}
		// Post message + optional code block
		addMessage(
			result.message || tool.name,
			false,
			result.code,
			result.codeLanguage,
			result.title
		);
		return true;
	}
}
