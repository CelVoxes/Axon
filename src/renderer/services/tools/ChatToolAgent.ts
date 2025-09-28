import { BackendClient } from "../backend/BackendClient";
import { ToolRegistry } from "./ToolRegistry";

interface AskWithToolsOptions {
  workspaceDir?: string;
  maxCalls?: number;
  sessionId?: string;
  addMessage?: (
    content: string,
    isUser: boolean,
    code?: string,
    codeLanguage?: string,
    codeTitle?: string,
    suggestions?: any,
    status?: "pending" | "completed" | "failed",
    isStreaming?: boolean
  ) => void;
}

/**
 * Minimal tool-calling loop for Ask mode: The model can request a tool via a CALL_TOOL JSON line.
 * Protocol: Model outputs a line starting with `CALL_TOOL {"name":"ls","input":"/ls data"}`
 * We execute, post an OBSERVATION back into context, and ask again.
 */
export class ChatToolAgent {
  static buildToolsManifest(): string {
    // Keep in sync with registered tools
    return [
      {
        name: "ls",
        usage: "/ls [subdir] [ext=.ipynb|.py|.csv]",
        purpose: "List files in the workspace (optionally filtered)",
      },
      {
        name: "head",
        usage: "/head <relative/path> [lines]",
        purpose: "Preview the first N lines (special handling for .ipynb)",
      },
    ]
      .map(
        (t) => `- ${t.name}: ${t.purpose}\n  usage: ${t.usage}`
      )
      .join("\n");
  }

  static buildSystemPreamble(): string {
    return (
      "You can improve answers by using tools to inspect the workspace.\n" +
      "If a tool would help, output a single line starting with CALL_TOOL followed by a JSON object:\n" +
      'CALL_TOOL {"name":"ls","input":"/ls data"}\n' +
      "After you receive the OBSERVATION, continue the reasoning and produce the final helpful answer.\n" +
      "Available tools:\n" +
      this.buildToolsManifest()
    );
  }

  static parseToolCall(text: string): { name: string; input: string } | null {
    const m = text.match(/^\s*CALL_TOOL\s+(\{[\s\S]*?\})\s*$/m);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj.name === "string" && typeof obj.input === "string") {
        return { name: obj.name, input: obj.input };
      }
    } catch (_) {}
    return null;
  }

  static truncate(s: string, max = 1500): string {
    if (!s) return s;
    return s.length > max ? s.slice(0, max) + "\n... [truncated]" : s;
  }

  static async askWithTools(
    backend: BackendClient,
    userMessage: string,
    context: string,
    options: AskWithToolsOptions = {}
  ): Promise<string> {
    const maxCalls = options.maxCalls ?? 2;
    const scopedOption = backend.scopeSessionId(options.sessionId);
    const sessId =
      scopedOption || backend.buildSessionId(options.workspaceDir || undefined);
    console.log(`🔧 ChatToolAgent: Using session ID: ${sessId}`);
    let workingContext = `${this.buildSystemPreamble()}\n\nCONTEXT:\n${context || ""}`;
    let lastAnswer = "";

    for (let i = 0; i <= maxCalls; i++) {
      const q =
        (i === 0
          ? `USER: ${userMessage}\nASSISTANT:`
          : `USER: Continue. You received observations above. Provide the final answer now.\nASSISTANT:`) +
        "\n\n";

      const answer = await backend.askQuestion({
        question: q,
        context: workingContext,
        sessionId: sessId,
      });
      lastAnswer = answer || "";

      const toolCall = this.parseToolCall(lastAnswer);
      if (!toolCall) break; // no tool call, use answer

      // Execute tool
      const registry = ToolRegistry.getInstance();
      const tool = registry.find(toolCall.input);
      if (!tool) {
        workingContext += `\n\nOBSERVATION: Unknown tool request ${toolCall.name}.`;
        continue;
      }
      const result = await registry.execute(toolCall.input, {
        workspaceDir: options.workspaceDir,
      });
      // Post tool result to chat as a code block for visibility (include which tool via result.message)
      options.addMessage?.(
        result.message || `Tool > ${tool.name}`,
        false,
        result.code,
        result.codeLanguage,
        result.title
      );

      const obsText =
        (result.message ? result.message + "\n" : "") + (result.code ? result.code : "");
      workingContext += `\n\nOBSERVATION (from ${tool.name}):\n${this.truncate(obsText, 3000)}`;
    }

    return lastAnswer;
  }
}
