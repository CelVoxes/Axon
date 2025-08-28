import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";
import { CellExecutionService } from "../notebook/CellExecutionService";

function buildProbeCode(kind: "h5ad" | "csv", absPath: string): string {
	const p = absPath.replace(/"/g, '\\"');
	if (kind === "h5ad") {
		return `from pathlib import Path
try:
    import anndata as ad
    p = Path("${p}")
    print("exists:", p.exists())
    if p.exists():
        adata = ad.read_h5ad(str(p))
        print("shape:", adata.shape)
        print("obs columns:", list(adata.obs.columns)[:12])
        print("var.shape:", adata.var.shape)
        try:
            print("var head:", list(adata.var_names[:10]))
        except Exception as e:
            print("var head error:", e)
except Exception as e:
    print("ERROR:", e)
`;
	}
	// csv
	return `from pathlib import Path
try:
    import pandas as pd
    p = Path("${p}")
    print("exists:", p.exists())
    if p.exists():
        df = pd.read_csv(str(p), nrows=5)
        print("columns:", list(df.columns))
        print("head:\n", df.head().to_string())
except Exception as e:
    print("ERROR:", e)
`;
}

export const PythonProbeTool: ChatTool = {
	name: "probe",
	description:
		"Probe data using the Python kernel (csv, h5ad). Usage: /probe <csv|h5ad> <relative/path>",
	pattern: /^\/(probe)\b[\s\S]*$/i,
	async run(input: string, ctx: ToolContext): Promise<ToolResult> {
		const ws = ctx.workspaceDir || "";
		const m = input.trim().match(/^\/probe\s+(csv|h5ad)\s+(.+)$/i);
		if (!m)
			return { ok: false, message: "Usage: /probe <csv|h5ad> <relative/path>" };
		const kind = m[1].toLowerCase() as "csv" | "h5ad";
		const rel = m[2];
		const target = ws ? `${ws}/${rel}` : rel;
		try {
			const exec = new CellExecutionService(ws || "");
			const code = buildProbeCode(kind, target);
			const result = await exec.executeCell(`tool-probe-${Date.now()}`, code);
			if (result.status === "failed") {
				return {
					ok: false,
					message: `probe failed: ${result.output || "Unknown error"}`,
				};
			}
      return {
        ok: true,
        message: `Python probe > ${rel} (${kind})`,
        code: result.output || "(no output)",
        codeLanguage: "text",
        title: rel,
      };
		} catch (e) {
			return {
				ok: false,
				message: `probe error: ${e instanceof Error ? e.message : String(e)}`,
			};
		}
	},
};
