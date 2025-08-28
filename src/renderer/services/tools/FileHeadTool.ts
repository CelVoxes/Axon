import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";

function head(text: string, lines: number) {
	const arr = text.split(/\r?\n/);
	return arr.slice(0, Math.max(0, lines)).join("\n");
}

export const FileHeadTool: ChatTool = {
	name: "head",
	description: "Show first N lines of a text file relative to workspace.",
	pattern: /^\/(head)\b[\s\S]*$/i,
	async run(input: string, ctx: ToolContext): Promise<ToolResult> {
		try {
			const ws = ctx.workspaceDir || "";
			const m = input.trim().match(/^\/head\s+(.+?)(?:\s+(\d+))?\s*$/i);
			if (!m)
				return { ok: false, message: "Usage: /head <relative/path> [lines]" };
			const rel = m[1];
			const lines = m[2] ? parseInt(m[2], 10) : 40;
			const target = ws ? `${ws}/${rel}` : rel;
			const content = await (window as any).electronAPI.readFile(target);
			let display = content;
			// crude heuristic for ipynb: show first code cell
			if (/\.ipynb$/i.test(rel)) {
				try {
					const nb = JSON.parse(content);
					const cells = Array.isArray(nb?.cells) ? nb.cells : [];
					const preview = cells
						.map((c: any, i: number) => {
							const src = Array.isArray(c?.source) ? c.source.join("") : "";
							const header =
								c?.cell_type === "markdown"
									? `# md cell ${i + 1}`
									: `# code cell ${i + 1}`;
							return `${header}\n${head(src, 20)}`;
						})
						.slice(0, 3)
						.join("\n\n---\n\n");
					display = preview || "(empty notebook)";
				} catch (_) {}
			} else {
				display = head(content, lines);
			}
            return {
                ok: true,
                message: `Read file > ${rel} (${lines} lines)`,
                code: display,
                codeLanguage: /\.json$/i.test(rel) ? "json" : "text",
                title: rel,
            };
		} catch (e) {
			return {
				ok: false,
				message: `head error: ${e instanceof Error ? e.message : String(e)}`,
			};
		}
	},
};
