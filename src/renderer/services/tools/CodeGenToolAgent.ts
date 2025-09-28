import { BackendClient } from "../backend/BackendClient";
import { ToolRegistry } from "./ToolRegistry";
import { CodeGenerationRequest } from "../types";

export class CodeGenToolAgent {
  static buildToolsManifest(): string {
    return [
      { name: "ls", usage: "/ls [subdir] [ext=.ipynb|.py|.csv]" },
      { name: "head", usage: "/head <relative/path> [lines]" },
      { name: "probe", usage: "/probe <csv|h5ad> <relative/path>" },
    ]
      .map((t) => `- ${t.name}: usage: ${t.usage}`)
      .join("\n");
  }

  static systemPreamble(): string {
    return (
      "You are generating code for a Jupyter notebook cell.\n" +
      "Before writing code, you may inspect the workspace using tools. If needed, output a single line: \n" +
      'CALL_TOOL {"name":"ls","input":"/ls data"}\n' +
      "After receiving OBSERVATION, continue and provide the final code.\n" +
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

  static truncate(s: string, max = 2000): string {
    if (!s) return s;
    return s.length > max ? s.slice(0, max) + "\n... [truncated]" : s;
  }

  static async gatherObservations(
    backend: BackendClient,
    request: CodeGenerationRequest,
    workspaceDir?: string,
    maxCalls: number = 2
  ): Promise<string> {
    // Build a compact request context to help the model decide
    const datasets = (request.datasets || [])
      .map((d) => `- ${d.id}: ${d.title || ""}`)
      .join("\n");
    let workingContext = `${this.systemPreamble()}\n\nSTEP:\n${request.stepDescription}\n\nUSER QUESTION:\n${request.originalQuestion}\n\nDATASETS:\n${datasets}`;

    let observations = "";
    for (let i = 0; i < maxCalls; i++) {
      const question = `PLAN: Decide if a tool is needed. If yes, call it. Otherwise, write the final code.\nASSISTANT:`;
      const answer = await backend.askQuestion({
        question,
        context: workingContext,
        sessionId: backend.buildSessionId(workspaceDir || undefined),
      });
      const tool = this.parseToolCall(answer || "");
      if (!tool) break;

      // Execute tool via registry
      const reg = ToolRegistry.getInstance();
      const impl = reg.find(tool.input);
      if (!impl) {
        workingContext += `\n\nOBSERVATION: Unknown tool: ${tool.name}`;
        continue;
      }
      const result = await reg.execute(tool.input, { workspaceDir });
      const obsText = `${result.message || impl.name}\n${result.code || ""}`;
      observations += `\n\n[${impl.name}]\n${this.truncate(obsText)}`;
      workingContext += `\n\nOBSERVATION (${impl.name}):\n${this.truncate(obsText, 3000)}`;
    }
    return observations.trim();
  }
}
