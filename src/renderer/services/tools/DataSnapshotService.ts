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

export async function buildDatasetSnapshot(
  datasets: Dataset[],
  workingDir?: string
): Promise<string> {
  const lines: string[] = [];
  for (const d of datasets || []) {
    const title = d.title || d.id;
    const localPath = (d as any).localPath as string | undefined;
    const isDir = Boolean((d as any).isLocalDirectory);
    lines.push(`- ${title} (id=${d.id})`);
    if (!localPath) {
      lines.push(`  localPath: (none)`);
      continue;
    }
    lines.push(`  localPath: ${toRel(localPath, workingDir)}`);
    if (isDir) {
      const names = await safeList(localPath);
      const hasMtx = names.some((n) => /matrix\.mtx(\.gz)?$/i.test(n));
      const hasFeatures = names.some((n) => /(features|genes)\.tsv(\.gz)?$/i.test(n));
      const hasBarcodes = names.some((n) => /barcodes\.tsv(\.gz)?$/i.test(n));
      const show = names.slice(0, 8).join(", ");
      lines.push(`  dir contains: ${show}${names.length > 8 ? ", ..." : ""}`);
      lines.push(
        `  10x markers: matrix.mtx=${hasMtx}, features/genes=${hasFeatures}, barcodes=${hasBarcodes}`
      );
    } else {
      // File — show extension and relative name
      const rel = toRel(localPath, workingDir);
      const ext = (rel.split(".").pop() || "").toLowerCase();
      lines.push(`  file: .${ext}`);
    }
  }
  if (lines.length === 0) return "(no datasets)";
  return lines.join("\n");
}
