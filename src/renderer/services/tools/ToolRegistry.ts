import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: ChatTool[] = [];

  static getInstance(): ToolRegistry {
    if (!this.instance) this.instance = new ToolRegistry();
    return this.instance;
  }

  register(tool: ChatTool) {
    this.tools.push(tool);
  }

  find(input: string): ChatTool | undefined {
    return this.tools.find((t) => t.pattern.test(input.trim()))
  }

  async execute(input: string, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.find(input);
    if (!tool) return { ok: false, message: "Unknown tool" };
    return tool.run(input, ctx);
  }
}

