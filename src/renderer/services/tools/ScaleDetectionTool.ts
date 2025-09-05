import { ChatTool, ToolContext, ToolResult } from "./ToolTypes";

const PY_HELPER = `# scale_detection.py
"""
Lightweight helpers to infer whether a numeric matrix appears raw, log/arcsinh/logicle transformed,
or standardized, and suggest next steps. Heuristics are conservative and avoid double-transforming.

Usage:
    import pandas as pd
    from scale_detection import infer_scale_status

    status = infer_scale_status(df, marker_cols=None, sample=100_000, hints={"kind": "cytometry"})
    print(status)
"""
from __future__ import annotations
import math
from typing import Iterable, Optional, Dict, Any

import numpy as np
import pandas as pd


META_COL_HINTS = (
    "time", "event", "events", "file", "filename", "sample", "batch", "barcode",
)


def _select_numeric_columns(df: pd.DataFrame, marker_cols: Optional[Iterable[str]] = None) -> pd.Index:
    if marker_cols is not None:
        cols = [c for c in marker_cols if c in df.columns]
        num = [c for c in cols if pd.api.types.is_numeric_dtype(df[c])]
        return pd.Index(num)
    # Default: all numeric, exclude obvious meta
    cand = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    lower = {c: str(c).lower() for c in cand}
    keep = [c for c in cand if not any(h in lower[c] for h in META_COL_HINTS)]
    return pd.Index(keep or cand)


def _name_hints(cols: Iterable[str]) -> Dict[str, bool]:
    low = [str(c).lower() for c in cols]
    def any_sub(ss):
        return any(any(s in lc for s in ss) for lc in low)
    return {
        "arcsinh": any_sub(["arcsinh", "asinh"]),
        "logicle": any_sub(["logicle"]),
        "log": any_sub(["log", "log1p"]) and not any_sub(["blog", "dialog", "logic"]),
        "standardized": any_sub(["zscore", "z-score", "standardized", "scaled", "scale"]),
        "compensated": any_sub(["comp", "comp-", "unmix", "unmixed", "spill", "spillover"]),
    }


def infer_scale_status(
    df: pd.DataFrame,
    marker_cols: Optional[Iterable[str]] = None,
    sample: int = 100_000,
    hints: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Infer whether data appears 'raw', 'arcsinh', 'log', 'logicle', or 'standardized'.
    Returns a dictionary with:
      - scale: str in {raw, arcsinh, log, logicle, standardized, unknown}
      - standardized_like, arcsinh_like, log_like, raw_like: bools
      - votes: per-class fraction across columns
      - recommended_action: str (e.g., 'none', 'arcsinh', 'normalize_log1p', 'zscore')
      - analyzed_columns: list[str]
    """
    hints = hints or {}
    cols = _select_numeric_columns(df, marker_cols)
    if len(cols) == 0:
        return {
            "scale": "unknown", "reason": "no_numeric_columns", "votes": {},
            "analyzed_columns": []
        }
    # Sampling for speed
    n = len(df)
    if n > sample:
        idx = np.random.default_rng(42).choice(n, size=sample, replace=False)
        X = df.loc[df.index[idx], cols]
    else:
        X = df[cols]

    # Compute stats per column
    desc = X.describe(percentiles=[0.95, 0.99]).T  # count, mean, std, min, 50%, 95%, 99%, max
    # Negative fraction
    neg_frac = (X.lt(0).sum() / X.shape[0]).rename("neg_frac")
    stats = desc.join(neg_frac)

    # Column-wise flags
    is_std_col = stats.apply(lambda r: (abs(r["mean"]) < 0.3) and (0.8 <= (r["std"] or 0) <= 1.2), axis=1)
    is_arcsinh_col = stats.apply(
        lambda r: (r["95%"] < 20) and (r["99%"] < 50) and (0.01 <= (r["neg_frac"] or 0) <= 0.2), axis=1
    )
    is_log_col = stats.apply(
        lambda r: (r["99%"] < 100) and ((r["min"] or 0) >= -1e-6) and ((r["neg_frac"] or 0) < 0.005), axis=1
    )
    is_raw_col = stats.apply(
        lambda r: (r["99%"] >= 1e3) and ((r["neg_frac"] or 0) < 0.001), axis=1
    )

    # Votes
    m = max(1, len(cols))
    votes = {
        "standardized": float(is_std_col.sum()) / m,
        "arcsinh": float(is_arcsinh_col.sum()) / m,
        "log": float(is_log_col.sum()) / m,
        "raw": float(is_raw_col.sum()) / m,
    }

    # Name-based nudges (do not overrule strong signals)
    nh = _name_hints(cols)
    if nh["standardized"]:
        votes["standardized"] = max(votes["standardized"], 0.6)
    if nh["arcsinh"]:
        votes["arcsinh"] = max(votes["arcsinh"], 0.6)
    if nh["logicle"]:
        votes["log"] = max(votes["log"], 0.4)  # approximate bucket
    if nh["log"]:
        votes["log"] = max(votes["log"], 0.6)

    # Decision
    scale = "unknown"
    if votes["standardized"] >= 0.6:
        scale = "standardized"
    elif votes["arcsinh"] >= 0.5:
        scale = "arcsinh"
    elif votes["log"] >= 0.5:
        scale = "log"
    elif votes["raw"] >= 0.5:
        scale = "raw"

    # Suggest actions
    kind = str(hints.get("kind") or "").lower()  # e.g., 'cytometry', 'scrna', 'expression'
    if scale in ("standardized", "arcsinh", "log"):
        action = "none"
    elif scale == "raw":
        if kind.startswith("cyto"):
            action = "arcsinh"
        elif kind in ("scrna", "sc", "singlecell", "single_cell"):
            action = "normalize_log1p"
        else:
            action = "normalize_or_log"
    else:
        action = "inspect"

    return {
        "scale": scale,
        "standardized_like": votes["standardized"] >= 0.6,
        "arcsinh_like": votes["arcsinh"] >= 0.5,
        "log_like": votes["log"] >= 0.5,
        "raw_like": votes["raw"] >= 0.5,
        "votes": votes,
        "recommended_action": action,
        "analyzed_columns": list(cols),
        "name_hints": nh,
        "stats_preview": stats[["mean", "std", "min", "50%", "95%", "99%", "max", "neg_frac"]].head(8).to_dict(orient="index"),
    }
`;

export const ScaleDetectionTool: ChatTool = {
  name: "scale",
  description:
    "Emit a reusable Python helper to detect existing scaling/normalization and suggest next steps. Usage: /scale",
  pattern: /^\/(scale|detect-scale)\b[\s\S]*$/i,
  async run(_input: string, _ctx: ToolContext): Promise<ToolResult> {
    const code = PY_HELPER;
    return {
      ok: true,
      message: "Generated scale detection helper (save as scale_detection.py or paste into a notebook cell)",
      code,
      codeLanguage: "python",
      title: "scale_detection.py",
    };
  },
};

