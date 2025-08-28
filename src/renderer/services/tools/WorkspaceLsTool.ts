import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";

function toRel(path: string, base?: string) {
	if (!base) return path;
	try {
		if (path.startsWith(base))
			return path.slice(base.length + (base.endsWith("/") ? 0 : 1));
	} catch (_) {}
	return path;
}

export const WorkspaceLsTool: ChatTool = {
	name: "ls",
	description: "List workspace files (optionally filter by extension)",
	pattern: /^\/(ls)\b[\s\S]*$/i,
	async run(input: string, ctx: ToolContext): Promise<ToolResult> {
		try {
			const ws = ctx.workspaceDir || "";
			// parse simple args: /ls [subdir] [ext=.ipynb|.py|.csv]
			const m = input.trim().match(/^\/ls\s*(.*)$/i);
			const argStr = (m?.[1] || "").trim();
			const parts = argStr.split(/\s+/).filter(Boolean);
			let sub = "";
			let ext = "";
			for (const p of parts) {
				if (/^ext=/i.test(p)) ext = p.replace(/^ext=/i, "");
				else sub = p;
			}
			const target = sub ? `${ws}/${sub}` : ws;
			const items: string[] = await (window as any).electronAPI.listDirectory(
				target
			);
			let filtered = items;
			if (ext)
				filtered = items.filter((f) =>
					f.toLowerCase().endsWith(ext.toLowerCase())
				);
            const relTarget = toRel(target, ws) || ".";
            const lines = filtered.map((f) => `- ${toRel(f, ws)}`).join("\n");
            const message = filtered.length
                ? `List directory > ${relTarget}${ext ? ` (ext:${ext})` : ""}`
                : `List directory > ${relTarget} — no files${ext ? ` (ext:${ext})` : ""}`;
            return {
                ok: true,
                message,
                code: lines,
                codeLanguage: "text",
                title: "Listing",
            };
		} catch (e) {
			return {
				ok: false,
				message: `ls error: ${e instanceof Error ? e.message : String(e)}`,
			};
		}
	},
};
