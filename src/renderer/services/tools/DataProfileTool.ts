import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";
import { CellExecutionService } from "../notebook/CellExecutionService";

function pyEscape(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildPython(targetDirAbs: string): string {
  const p = pyEscape(targetDirAbs);
  return `# /analyze-data tool: flow/spectral CSV bundle profiling + scaling detection
import os, re, json, warnings
from pathlib import Path
import numpy as np

warnings.filterwarnings("ignore", category=FutureWarning)

try:
    import pandas as pd
except Exception as e:
    print("ERROR: pandas is required for /analyze-data tool.")
    print("Install in notebook environment and retry: !pip install pandas")
    raise

target = Path("${p}")
print(f"[INFO] Target path: {target}")
if not target.exists():
    raise FileNotFoundError(f"Path does not exist: {target}")

# If a file is passed, use its parent as data root; prefer CSVs
base = target if target.is_dir() else target.parent
csv_files = sorted([p for p in base.glob("*.csv")])
if not csv_files:
    # Explore immediate subdirs as well
    for d in [x for x in base.iterdir() if x.is_dir()]:
        csv_files.extend(sorted([p for p in d.glob("*.csv")]))

csv_files = sorted(csv_files)
print(f"[INFO] Found {len(csv_files)} CSV files under {base}")
for p in csv_files[:5]:
    print("  -", p.name)
if len(csv_files) == 0:
    raise FileNotFoundError("No CSV files found to profile.")

# Count rows quickly (approx) by reading minimal content when possible
def _count_rows(path: Path) -> int:
    try:
        with path.open("rb") as f:
            # Count newlines; subtract header line (1)
            n = 0
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                n += chunk.count(b"\n")
            return max(0, n - 1)
    except Exception:
        try:
            return max(0, len(pd.read_csv(path, usecols=[0], nrows=100_000)) - 1)
        except Exception:
            return 0

sample_counts = [{"sample": f.stem, "file": f.name, "events": int(_count_rows(f))} for f in csv_files]
total_events = sum(x["events"] for x in sample_counts)
print(f"[INFO] Total events (approx): {total_events:,}")

# Sample rows per file for statistics (cap per-file for speed)
target_sample = min(200_000, max(50_000, total_events // 5 if total_events else 100_000))
per_file = max(5_000, target_sample // max(1, len(csv_files)))
frames = []
for f in csv_files:
    try:
        df = pd.read_csv(f, nrows=per_file, low_memory=False)
        df["__sample__"] = f.stem
        frames.append(df)
    except Exception as e:
        print(f"[WARN] Read failed for {f.name}: {e}")

if not frames:
    raise RuntimeError("Failed to sample any CSV rows for profiling.")
sample_df = pd.concat(frames, axis=0, ignore_index=True)

# Identify numeric marker-like columns (keep FSC/SSC)
meta_hints = {"time", "event", "events", "file", "filename", "__sample__", "sample", "batch"}
num_cols = [c for c in sample_df.columns if pd.api.types.is_numeric_dtype(sample_df[c])]
marker_cols = [c for c in num_cols if c.lower() not in meta_hints]
if not marker_cols:
    raise RuntimeError("No numeric marker-like columns detected.")

# Try using optional scale_detection helper
scale_status = None
try:
    from scale_detection import infer_scale_status
    scale_status = infer_scale_status(sample_df, marker_cols=marker_cols, hints={"kind": "cytometry"})
except Exception:
    # Fallback minimal heuristics
    def _col_stats(s):
        s = s.dropna().astype(float)
        if s.empty:
            return None
        q = s.quantile([0.5, 0.95, 0.99])
        return {
            "mean": float(s.mean()),
            "std": float(s.std(ddof=0) or 0.0),
            "min": float(s.min()),
            "p50": float(q.loc[0.5]),
            "p95": float(q.loc[0.95]),
            "p99": float(q.loc[0.99]),
            "max": float(s.max()),
            "neg_frac": float((s < 0).mean()),
        }
    stats = {c: _col_stats(sample_df[c]) for c in marker_cols[:128]}
    stats = {k: v for k, v in stats.items() if v is not None}
    m = max(1, len(stats))
    def v_std(v): return abs(v["mean"]) < 0.3 and 0.8 <= (v["std"] or 0) <= 1.2
    def v_arc(v): return v["p95"] < 20 and v["p99"] < 50 and 0.01 <= (v["neg_frac"] or 0) <= 0.2
    def v_log(v): return v["p99"] < 100 and v["min"] >= -1e-6 and (v["neg_frac"] or 0) < 0.005
    def v_raw(v): return v["p99"] >= 1e3 and (v["neg_frac"] or 0) < 0.001
    vs = {
        "standardized": sum(v_std(v) for v in stats.values()) / m,
        "arcsinh": sum(v_arc(v) for v in stats.values()) / m,
        "log": sum(v_log(v) for v in stats.values()) / m,
        "raw": sum(v_raw(v) for v in stats.values()) / m,
    }
    if vs["standardized"] >= 0.6:
        scale = "standardized"; action = "none"
    elif vs["arcsinh"] >= 0.5:
        scale = "arcsinh"; action = "none"
    elif vs["log"] >= 0.5:
        scale = "log"; action = "none"
    elif vs["raw"] >= 0.5:
        scale = "raw"; action = "arcsinh"
    else:
        scale = "unknown"; action = "inspect"
    scale_status = {
        "scale": scale,
        "standardized_like": vs["standardized"] >= 0.6,
        "arcsinh_like": vs["arcsinh"] >= 0.5,
        "log_like": vs["log"] >= 0.5,
        "raw_like": vs["raw"] >= 0.5,
        "votes": vs,
        "recommended_action": action,
        "analyzed_columns": list(stats.keys()),
    }

# Sidecar hints for spectral compensation
names = " ".join([f.name.lower() for f in csv_files])
has_sidecar = bool(re.search(r"\b(spill|spillover|unmix|unmixing)\b", names))

summary = {
    "root": str(base),
    "n_files": len(csv_files),
    "total_events_est": int(total_events),
    "marker_count": len(marker_cols),
    "scale_status": scale_status,
    "spectral_sidecar": has_sidecar,
    "samples": sample_counts,
}

print("\n[SUMMARY]")
print(json.dumps(summary, indent=2))

# Save artifacts under results/
out_dir = Path("results"); out_dir.mkdir(exist_ok=True, parents=True)
with (out_dir / "data_profile.json").open("w") as f:
    json.dump(summary, f, indent=2)
import pandas as _pd
_pd.DataFrame(sample_counts).to_csv(out_dir / "sample_event_counts.csv", index=False)
print(f"\n[OK] Wrote {out_dir/'data_profile.json'} and {out_dir/'sample_event_counts.csv'}")
`;
}

export const DataProfileTool: ChatTool = {
  name: "analyze-data",
  description:
    "Profile a data folder of CSVs (flow/spectral): sampling-based stats + scaling detection. Usage: /analyze-data <path>",
  pattern: /^\/(analyze\-data|analyze|profile)\b[\s\S]*$/i,
  async run(input: string, ctx: ToolContext): Promise<ToolResult> {
    const ws = ctx.workspaceDir || "";
    const m = input.trim().match(/^\/(analyze\-data|analyze|profile)\s+(.+)$/i);
    if (!m) return { ok: false, message: "Usage: /analyze-data <relative/path>" };
    const rel = m[2].trim();
    const isAbs = /^\//.test(rel) || /^[A-Za-z]:\\\\/.test(rel);
    const target = ws ? (isAbs ? rel : `${ws}/${rel}`) : rel;
    try {
      const exec = new CellExecutionService(ws || "");
      const code = buildPython(target);
      const result = await exec.executeCell(`tool-analyze-data-${Date.now()}`, code);
      if (result.status === "failed") {
        return { ok: false, message: `analyze-data failed: ${result.output || "Unknown error"}` };
      }
      return {
        ok: true,
        message: `Data profile > ${rel}`,
        code: result.output || "(no output)",
        codeLanguage: "text",
        title: rel,
      };
    } catch (e) {
      return { ok: false, message: `analyze-data error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

