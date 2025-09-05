import { Dataset } from "../types";

function toRel(path: string, base?: string) {
  if (!base) return path;
  try {
    if (path.startsWith(base)) return path.slice(base.length + (base.endsWith("/") ? 0 : 1));
  } catch (_) {}
  return path;
}

async function safeList(dir: string): Promise<string[]> {
  try {
    // @ts-ignore
    const items: any[] = await window.electronAPI.listDirectory(dir);
    const normalized = (items || []).map((entry: any) => {
      if (typeof entry === "string") {
        const base = entry.split("/").pop() || entry;
        return base;
      }
      if (entry && typeof entry === "object") {
        const name = (entry as any).name;
        const path = (entry as any).path;
        if (typeof name === "string" && name.trim()) return name;
        if (typeof path === "string" && path.trim()) {
          const base = path.split("/").pop() || path;
          return base;
        }
      }
      return String(entry);
    });
    return normalized;
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

function detectFlowMarkers(columns: string[]): {
  isFlowLike: boolean;
  hints: string[];
} {
  const cols = (columns || []).map((c) => (c || "").toString().trim());
  const lower = cols.map((c) => c.toLowerCase());
  const hints: string[] = [];

  const hasTime = lower.includes("time");
  const hasFSC = lower.some((c) => c.startsWith("fsc"));
  const hasSSC = lower.some((c) => c.startsWith("ssc"));
  const hasCD = cols.some((c) => /\bcd\d+/i.test(c));
  const hasFluor = cols.some((c) => /(fitc|pe|apc|percp|bv\d{2,3}|af\d{2,3}|a[0-9]{2,3}|b[0-9]{2,3})/i.test(c));

  if (hasTime) hints.push("Time");
  if (hasFSC) hints.push("FSC");
  if (hasSSC) hints.push("SSC");
  if (hasCD) hints.push("CD markers");
  if (hasFluor) hints.push("fluorochromes");

  const isFlowLike = hasFSC || hasSSC || hasCD || hasFluor;
  return { isFlowLike, hints };
}

export async function buildDatasetSnapshot(
  datasets: Dataset[],
  workingDir?: string
): Promise<string> {
  const lines: string[] = [];
  const q = (s: string | undefined | null) => JSON.stringify(String(s ?? ""));
  const qRel = (p?: string) => q(p ? toRel(p, workingDir) : "");

  for (const d of datasets || []) {
    const title = d.title || d.id;
    const localPath = (d as any).localPath as string | undefined;
    const isDir = Boolean((d as any).isLocalDirectory);

    lines.push(`- title: ${q(title)}`);
    lines.push(`  id: ${q(d.id)}`);
    lines.push(`  localPath: ${qRel(localPath)}`);
    lines.push(`  type: ${isDir ? "directory" : "file"}`);

    if (!localPath) continue;

    if (isDir) {
      const names = await safeList(localPath);
      const hasMtx = names.some((n) => /matrix\.mtx(\.gz)?$/i.test(n));
      const hasFeatures = names.some((n) => /(features|genes)\.tsv(\.gz)?$/i.test(n));
      const hasBarcodes = names.some((n) => /barcodes\.tsv(\.gz)?$/i.test(n));
      const shown = names.slice(0, 8);
      lines.push(`  directory:`);
      lines.push(`    contains:`);
      for (const n of shown) lines.push(`      - ${q(n)}`);
      if (names.length > shown.length) lines.push(`      - "..."`);
      lines.push(`    tenx:`);
      lines.push(`      matrix_mtx: ${hasMtx}`);
      lines.push(`      features_genes: ${hasFeatures}`);
      lines.push(`      barcodes: ${hasBarcodes}`);

      // CSV/TSV awareness
      const csvs = names.filter((n) => /\.(csv|tsv|txt)$/i.test(n));
      if (csvs.length > 0) {
        lines.push(`  delimited:`);
        lines.push(`    count: ${csvs.length}`);
        const ex = csvs.slice(0, 5);
        lines.push(`    examples:`);
        for (const e of ex) lines.push(`      - ${q(e)}`);
        if (csvs.length > ex.length) lines.push(`      - "..."`);

        // Preview header from first CSV/TSV
        const first = csvs[0];
        const full = `${localPath}/${first}`;
        const content = await safeRead(full);
        const head = (content || "").split(/\r?\n/)[0] || "";
        if (head) {
          const isTsv = /\.tsv$/i.test(first) || (!/,/.test(head) && /\t/.test(head));
          const delim = isTsv ? "\t" : ",";
          const cols = head.split(delim).map((s) => s.trim());
          lines.push(`    preview:`);
          lines.push(`      file: ${q(first)}`);
          lines.push(`      header:`);
          for (const c of cols) lines.push(`        - ${q(c)}`);
          try {
            const flow = detectFlowMarkers(cols);
            lines.push(`      flow_like: ${flow.isFlowLike}`);
            if (flow.hints.length > 0) {
              lines.push(`      hints:`);
              for (const h of flow.hints) lines.push(`        - ${q(h)}`);
            }
          } catch (_) {}
        }
      }
    } else {
      // File — show extension and relative name
      const rel = toRel(localPath, workingDir);
      const ext = (rel.split(".").pop() || "").toLowerCase();
      lines.push(`  file:`);
      lines.push(`    ext: .${ext}`);
    }
  }
  if (lines.length === 0) return "(no datasets)";
  return lines.join("\n");
}
