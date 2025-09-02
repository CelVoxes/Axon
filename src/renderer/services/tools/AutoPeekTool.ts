import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";
import { buildDatasetSnapshot } from "./DataSnapshotService";
import type { Dataset } from "../types";

function toRel(path: string, base?: string) {
	if (!base) return path;
	try {
		if (path.startsWith(base))
			return path.slice(base.length + (base.endsWith("/") ? 0 : 1));
	} catch (_) {}
	return path;
}

async function safeList(dir: string): Promise<string[]> {
	try {
		// @ts-ignore
		const items: string[] = await window.electronAPI.listDirectory(dir);
		return items || [];
	} catch (_) {
		return [];
	}
}

async function safeRead(file: string): Promise<string> {
	try {
		// @ts-ignore
		const content: string = await window.electronAPI.readFile(file);
		return content || "";
	} catch (_) {
		return "";
	}
}

function headText(text: string, maxLines = 40): string {
	const lines = (text || "").split(/\r?\n/);
	return lines.slice(0, maxLines).join("\n");
}

export const AutoPeekTool: ChatTool = {
	name: "peek",
	description:
		"Peek a workspace path: directory summary or file preview (csv/tsv/ipynb). Usage: /peek <relative/path>",
	pattern: /^\/(peek)\b[\s\S]*$/i,
	async run(input: string, ctx: ToolContext): Promise<ToolResult> {
		const ws = ctx.workspaceDir || "";
		const m = input.trim().match(/^\/peek\s+(.+)$/i);
		if (!m) return { ok: false, message: "Usage: /peek <relative/path>" };
		const rel = m[1].trim();
    // Support absolute paths (Unix/Mac: starts with '/', Windows: 'C:\\') as well as workspace-relative
    const isAbs = /^\//.test(rel) || /^[A-Za-z]:\\/.test(rel);
    const target = ws ? (isAbs ? rel : `${ws}/${rel}`) : rel;

		// Heuristic: directory vs file (listDirectory returns entries or throws)
		const entries = await safeList(target);
        if (entries.length > 0) {
            // Directory: reuse the shared snapshot builder for consistent output
            const ds: Dataset = {
                id: `peek-${Math.random().toString(36).slice(2, 8)}`,
                title: rel,
                organism: undefined,
                source: "Local",
                description: "Peeked directory",
                platform: "Local",
            } as any;
            (ds as any).localPath = target;
            (ds as any).isLocalDirectory = true;
            const snapshot = await buildDatasetSnapshot([ds], ws);
            return {
                ok: true,
                message: `Peek directory > ${rel}`,
                code: snapshot,
                codeLanguage: "text",
                title: rel,
            };
        }

		// File peek by extension
		const lower = rel.toLowerCase();
		if (/(\.csv|\.tsv|\.txt)$/.test(lower)) {
			const content = await safeRead(target);
			const preview = headText(content, 40);
			// crude delimiter detection
			const delim = lower.endsWith(".tsv") ? "\t" : ",";
			const first = preview.split(/\r?\n/)[0] || "";
			const colCount = first.split(delim).length;
            const msg = `Peek file > ${rel} (${colCount} columns)`;
			return {
				ok: true,
				message: msg,
				code: preview,
				codeLanguage: "text",
				title: rel,
			};
		}
		if (lower.endsWith(".ipynb")) {
			const content = await safeRead(target);
			try {
				const nb = JSON.parse(content);
				const cells: any[] = Array.isArray(nb?.cells) ? nb.cells : [];
				const summary = cells
					.slice(0, 6)
					.map((c, i) => {
						const isMd = c?.cell_type === "markdown";
						const src = Array.isArray(c?.source) ? c.source.join("") : "";
						const head = headText(src, 8);
						return `${isMd ? "# md" : "# code"} cell ${i + 1}\n${head}`;
					})
					.join("\n\n---\n\n");
            const msg = `Peek notebook > ${rel}: ${cells.length} cells (showing first ${Math.min(
                6,
                cells.length
            )})`;
				return {
					ok: true,
					message: msg,
					code: summary || "(empty)",
					codeLanguage: "text",
					title: rel,
				};
			} catch (e) {
				return {
					ok: false,
					message: `ipynb parse failed: ${
						e instanceof Error ? e.message : String(e)
					}`,
				};
			}
		}

		// Unknown file type: show first lines
		const content = await safeRead(target);
		const preview = headText(content, 40);
    const msg = preview ? `Peek file > ${rel}` : `Peek file > ${rel} (binary or empty)`;
		return {
			ok: true,
			message: msg,
			code: preview || "(no preview)",
			codeLanguage: "text",
			title: rel,
		};
	},
};
