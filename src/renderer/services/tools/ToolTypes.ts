export interface ToolContext {
  workspaceDir?: string;
}

export interface ToolResult {
  ok: boolean;
  message?: string; // plain text message
  code?: string; // code block content
  codeLanguage?: string; // e.g., 'bash', 'text', 'diff', 'json'
  title?: string; // optional header/title for the code block
}

export interface ChatTool {
  name: string;
  description: string;
  pattern: RegExp; // slash command pattern e.g., /^\/ls(\s+.*)?$/i
  run(input: string, ctx: ToolContext): Promise<ToolResult>;
}

