import { ElectronClient } from "../utils/ElectronClient";

type ScanpySymbolDoc = {
	qualifiedName: string; // e.g. scanpy.pp.normalize_total
	modulePath: string; // e.g. scanpy.pp
	symbolName: string; // e.g. normalize_total
	signature?: string;
	docstring?: string;
	summary?: string;
};

type ScanpyIndex = {
	version: string | null;
	symbols: ScanpySymbolDoc[];
	createdAt: number;
};

/**
 * Service that builds a lightweight, local RAG index from the installed Scanpy docstrings
 * within the active Jupyter environment and retrieves relevant snippets for prompting.
 */
export class ScanpyDocsService {
	private static instance: ScanpyDocsService | null = null;

	// Cache per workspace+version: `${workspace}|${version}` → index
	private indexCache = new Map<string, ScanpyIndex>();
	private building = new Map<string, Promise<ScanpyIndex>>();

	static getInstance(): ScanpyDocsService {
		if (!this.instance) this.instance = new ScanpyDocsService();
		return this.instance;
	}

	private constructor() {}

	private makeCacheKey(workspaceDir: string, version: string | null): string {
		return `${workspaceDir}::${version ?? "unknown"}`;
	}

	async detectScanpyVersion(workspaceDir: string): Promise<string | null> {
		const py = [
			"import json",
			"try:",
			"    import scanpy as sc",
			"    print(json.dumps({'ok': True, 'version': getattr(sc, '__version__', None)}))",
			"except Exception as e:",
			"    print(json.dumps({'ok': False, 'error': str(e)}))",
		].join("\n");

		try {
			const res = await ElectronClient.executeJupyterCode(py, workspaceDir);
			const text = (res.output || "").trim();
			const obj = JSON.parse(text || "{}");
			if (obj && obj.ok) return obj.version || null;
			return null;
		} catch {
			return null;
		}
	}

	private async buildIndex(workspaceDir: string): Promise<ScanpyIndex | null> {
		const py = `import json, inspect, pkgutil
try:
    import scanpy as sc
    version = getattr(sc, '__version__', None)
    modules = {}
    # Collect top-level and submodules dynamically
    try:
        for m in ['scanpy']:
            mod = __import__(m, fromlist=['*'])
            modules[m] = mod
            if hasattr(mod, '__path__'):
                for info in pkgutil.walk_packages(mod.__path__, mod.__name__ + '.'):
                    try:
                        sub = __import__(info.name, fromlist=['*'])
                        modules[info.name] = sub
                    except Exception:
                        pass
    except Exception:
        pass
    entries = []
    seen = set()
    for name, mod in modules.items():
        try:
            for mem_name, obj in inspect.getmembers(mod):
                if callable(obj) and getattr(obj, '__module__', '').startswith('scanpy'):
                    module_path = getattr(obj, '__module__', name)
                    qual = module_path + '.' + getattr(obj, '__name__', mem_name)
                    if qual in seen:
                        continue
                    seen.add(qual)
                    try:
                        sig = str(inspect.signature(obj))
                    except Exception:
                        sig = None
                    doc = inspect.getdoc(obj) or ''
                    summary = doc.split('\n')[0] if doc else ''
                    entries.append({
                        'qualifiedName': qual,
                        'modulePath': module_path,
                        'symbolName': getattr(obj, '__name__', mem_name),
                        'signature': sig,
                        'docstring': doc,
                        'summary': summary,
                    })
        except Exception:
            pass
    # Keep a reasonable size to reduce prompt bloat
    # Sort by qualified name for stable order
    entries.sort(key=lambda x: x['qualifiedName'])
    print(json.dumps({'ok': True, 'version': version, 'entries': entries[:2000]}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))`;

		try {
			const res = await ElectronClient.executeJupyterCode(py, workspaceDir);
			const text = (res.output || "").trim();
			const obj = JSON.parse(text || "{}");
			if (!obj || !obj.ok) return null;
			const version: string | null = obj.version || null;
			const symbols: ScanpySymbolDoc[] = Array.isArray(obj.entries)
				? obj.entries.map((e: any) => ({
						qualifiedName: String(e.qualifiedName || ""),
						modulePath: String(e.modulePath || ""),
						symbolName: String(e.symbolName || ""),
						signature: e.signature ? String(e.signature) : undefined,
						docstring: e.docstring ? String(e.docstring) : undefined,
						summary: e.summary ? String(e.summary) : undefined,
				  }))
				: [];
			return { version, symbols, createdAt: Date.now() };
		} catch {
			return null;
		}
	}

	private sanitizeForPrompt(text?: string, maxLen: number = 600): string {
		if (!text) return "";
		let clean = String(text).replace(/```/g, "``").trim();
		if (clean.length > maxLen) clean = clean.slice(0, maxLen) + "...";
		return clean;
	}

	private scoreRelevance(query: string, entry: ScanpySymbolDoc): number {
		const hay = `${entry.qualifiedName} ${entry.signature || ""} ${
			entry.docstring || ""
		}`.toLowerCase();
		const terms = Array.from(
			new Set(
				query
					.toLowerCase()
					.replace(/[^a-z0-9_\.\s]/g, " ")
					.split(/\s+/)
					.filter(Boolean)
			)
		);
		let score = 0;
		for (const t of terms) {
			if (t.length < 3) continue;
			if (hay.includes(t)) score += 1;
		}
		// Prefer canonical API modules
		if (/\bscanpy\.pp\./.test(entry.qualifiedName)) score += 0.5;
		if (/\bscanpy\.tl\./.test(entry.qualifiedName)) score += 0.5;
		if (/\bscanpy\.pl\./.test(entry.qualifiedName)) score += 0.25;
		return score;
	}

	private async getOrCreateIndex(
		workspaceDir: string
	): Promise<ScanpyIndex | null> {
		const version = await this.detectScanpyVersion(workspaceDir);
		const key = this.makeCacheKey(workspaceDir, version);
		if (this.indexCache.has(key)) return this.indexCache.get(key)!;
		if (this.building.has(key)) return this.building.get(key)!;

		const promise = (async () => {
			const idx = await this.buildIndex(workspaceDir);
			if (idx) this.indexCache.set(key, idx);
			this.building.delete(key);
			return idx!;
		})();
		this.building.set(key, promise);
		return promise;
	}

	async retrieveRelevantDocs(
		workspaceDir: string,
		userQuery: string,
		maxItems: number = 8
	): Promise<{ version: string | null; items: ScanpySymbolDoc[] } | null> {
		const idx = await this.getOrCreateIndex(workspaceDir);
		if (!idx || !idx.symbols || idx.symbols.length === 0) return null;
		const scored = idx.symbols
			.map((e) => ({ e, s: this.scoreRelevance(userQuery, e) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, Math.max(1, maxItems))
			.map((x) => x.e);
		return { version: idx.version, items: scored };
	}

	async buildRagContextForRequest(
		stepDescription: string,
		originalQuestion: string,
		workspaceDir: string
	): Promise<string> {
		try {
			const mergedQuery = [originalQuestion || "", stepDescription || ""]
				.join("\n")
				.trim();
			const found = await this.retrieveRelevantDocs(
				workspaceDir,
				mergedQuery,
				8
			);
			if (!found || !found.items || found.items.length === 0) return "";
			const header = found.version
				? `Scanpy version detected in environment: ${found.version}`
				: "Scanpy version could not be detected";
			const lines: string[] = [
				header,
				"Use only APIs present below when writing code.",
			];
			for (const item of found.items) {
				const sig = item.signature
					? `${item.symbolName}${item.signature}`
					: item.symbolName;
				const summary = this.sanitizeForPrompt(item.summary, 200);
				const doc = this.sanitizeForPrompt(item.docstring, 500);
				lines.push(
					[
						`Function: ${item.qualifiedName}`,
						summary ? `Summary: ${summary}` : "",
						sig ? `Signature: ${sig}` : "",
						doc ? `Doc: ${doc}` : "",
					]
						.filter(Boolean)
						.join("\n")
				);
			}
			return lines.join("\n\n");
		} catch (e) {
			return "";
		}
	}
}
