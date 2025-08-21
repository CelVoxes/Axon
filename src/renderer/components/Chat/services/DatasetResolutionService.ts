import { LocalDatasetRegistry, LocalDatasetEntry } from "../../../services/LocalDatasetRegistry";
import { electronAPI } from "../../../utils/electronAPI";

// Cache for notebook paths to avoid repeated file system searches
const notebookPathCache = new Map<string, string>();
// Cache for parsed notebook content to avoid repeated file reads
const notebookContentCache = new Map<string, any>();

interface CellMentionContext {
	filePath: string;
	cellIndex0: number;
	language: string;
	code: string;
}

export class DatasetResolutionService {
	constructor(private localRegistry: LocalDatasetRegistry | null) {}

	// Resolve @mentions like @data.csv to indexed local datasets
	resolveAtMentions(text: string): LocalDatasetEntry[] {
		const registry = this.localRegistry;
		if (!registry) return [];
		const tokens = Array.from(text.matchAll(/@([^\s@]+)/g)).map((m) => m[1]);
		if (!tokens.length) return [];
		const resolved: LocalDatasetEntry[] = [];
		for (const t of tokens) {
			const matches = registry.resolveMention(t);
			for (const m of matches) resolved.push(m);
		}
		const byId = new Map<string, LocalDatasetEntry>();
		resolved.forEach((d) => byId.set(d.id, d));
		return Array.from(byId.values());
	}

	async resolveWorkspaceAndCellMentions(
		userMessage: string,
		currentWorkspace: string,
		activeFile?: string
	): Promise<{
		workspaceResolved: LocalDatasetEntry[];
		cellMentionContext: CellMentionContext | null;
	}> {
		const tokens = Array.from(userMessage.matchAll(/@([^\s@]+)/g)).map((m) => m[1]);
		const hashTokens = Array.from(userMessage.matchAll(/#(all|\d+)/gi)).map((m) => m[1]);
		const workspaceResolved: LocalDatasetEntry[] = [];
		let cellMentionContext: CellMentionContext | null = null;

		// If user referenced cells with #N/#all, resolve them against the active notebook
		if (hashTokens.length > 0 && activeFile && activeFile.endsWith(".ipynb")) {
			try {
				// Use cached notebook content if available
				let nb = notebookContentCache.get(activeFile);
				if (!nb) {
					const content = await window.electronAPI.readFile(activeFile);
					nb = JSON.parse(content);
					notebookContentCache.set(activeFile, nb);
				}
				const cells = Array.isArray(nb?.cells) ? nb.cells : [];
				const wantAll = hashTokens.some((t) => String(t).toLowerCase() === "all");
				const targetIndices = wantAll
					? cells.map((_: unknown, i: number) => i)
					: hashTokens
							.map((t) => parseInt(String(t), 10))
							.filter((n) => Number.isInteger(n) && n >= 1 && n <= cells.length)
							.map((n) => n - 1);

				if (targetIndices.length > 0) {
					for (const idx0 of targetIndices) {
						const c = cells[idx0];
						if (!c) continue;
						const srcArr: string[] = Array.isArray(c.source) ? c.source : [];
						const code = srcArr.join("");
						const lang = c.cell_type === "markdown" ? "markdown" : "python";
						if (!cellMentionContext) {
							cellMentionContext = {
								filePath: activeFile,
								cellIndex0: idx0,
								language: lang,
								code,
							};
						}
					}
				}
			} catch {
				// ignore
			}
		}

		// Resolve only @-style tokens and explicit notebook path references here.
		// Avoid re-processing #N/#all hash tokens which were already handled above.
		if (tokens.length > 0) {
			const registry = this.localRegistry;
			for (const token of tokens) {
				// Heuristic: consider anything with a slash or starting with / as a path
				const looksLikePath = token.startsWith("/") || token.includes("/");
				// Handle notebook cell reference like path.ipynb#3
				const cellRefMatch = token.match(/^(.*\.ipynb)#(\d+)$/i);
				if (cellRefMatch) {
					const pathPart = cellRefMatch[1];
					const index1Based = parseInt(cellRefMatch[2], 10);
					if (!Number.isNaN(index1Based) && index1Based >= 1) {
						let candidatePath = "";
						if (pathPart.startsWith("/")) {
							// Absolute path
							candidatePath = pathPart;
						} else if (currentWorkspace) {
							// Smart notebook resolution (cached)
							candidatePath = notebookPathCache.get(pathPart) || "";
							console.log(
								`💾 Cache lookup for ${pathPart}: ${candidatePath || "NOT FOUND"}`
							);

							if (!candidatePath) {
								candidatePath = await this.findNotebookPath(
									pathPart,
									currentWorkspace,
									activeFile
								);
								notebookPathCache.set(pathPart, candidatePath);
							} else {
								console.log(`📋 Using cached path: ${candidatePath}`);
							}
						}
						if (candidatePath) {
							const cellContext = await this.extractCellFromNotebook(
								candidatePath,
								index1Based - 1
							);
							if (cellContext && !cellMentionContext) {
								cellMentionContext = cellContext;
							}
						}
					}
					// skip normal path handling for cell references
					continue;
				}
				if (!looksLikePath) continue;

				const candidatePath = token.startsWith("/")
					? token
					: currentWorkspace
					? `${currentWorkspace}/${token}`
					: "";
				if (!candidatePath) continue;

				try {
					const info = await electronAPI.getFileInfo(candidatePath);
					if (info?.success && info.data) {
						if (registry) {
							const entry = await registry.addFromPath(candidatePath, token);
							if (entry) workspaceResolved.push(entry);
						}
					}
				} catch (_) {
					// ignore failures; not a valid path
				}
			}
		}

		return { workspaceResolved, cellMentionContext };
	}

	private async findNotebookPath(
		pathPart: string,
		currentWorkspace: string,
		activeFile?: string
	): Promise<string> {
		// FAST: Check if it's the currently active file
		console.log(`⚡ Active file: ${activeFile}`);
		console.log(`⚡ Looking for: ${pathPart}`);

		if (activeFile && activeFile.endsWith(pathPart)) {
			console.log(`⚡ Using active file: ${activeFile}`);
			return activeFile;
		} else if (activeFile) {
			// FAST: Try current directory (where active file is)
			const activeDir = activeFile.split("/").slice(0, -1).join("/");
			const testPath = `${activeDir}/${pathPart}`;
			console.log(`⚡ Testing same directory: ${testPath}`);
			try {
				const info = await window.electronAPI.getFileInfo(testPath);
				if (info && "size" in info) {
					console.log(`⚡ Found in active directory: ${testPath}`);
					return testPath;
				} else {
					console.log(`⚡ Not in active directory, info:`, info);
				}
			} catch (e) {
				console.log(`⚡ Error checking active directory:`, e);
			}
		} else {
			// FALLBACK: Try to find it by searching only the immediate subdirectories
			console.log(`⚡ No active file, trying subdirectories...`);
			try {
				const directories = await window.electronAPI.listDirectory(currentWorkspace);
				for (const dir of directories) {
					if (dir.isDirectory) {
						const testPath = `${dir.path}/${pathPart}`;
						try {
							const info = await window.electronAPI.getFileInfo(testPath);
							if (info && "size" in info) {
								console.log(`⚡ Found in subdirectory: ${testPath}`);
								return testPath;
							}
						} catch (e) {
							// Continue to next directory
						}
					}
				}
			} catch (e) {
				console.log(`⚡ Error listing directories:`, e);
			}
		}

		// FALLBACK: Only if we couldn't find it anywhere else
		const fallbackPath = `${currentWorkspace}/${pathPart}`;
		console.log(`⚡ Using fallback path: ${fallbackPath}`);
		return fallbackPath;
	}

	private async extractCellFromNotebook(
		notebookPath: string,
		cellIndex0: number
	): Promise<CellMentionContext | null> {
		try {
			console.log(`🔍 About to read notebook from: ${notebookPath}`);
			// Check cache first
			let nb = notebookContentCache.get(notebookPath);
			if (!nb) {
				const fileContent = await window.electronAPI.readFile(notebookPath);
				nb = JSON.parse(fileContent);
				notebookContentCache.set(notebookPath, nb);
			}
			const cell = Array.isArray(nb?.cells) ? nb.cells[cellIndex0] : null;
			if (cell) {
				const srcArr: string[] = Array.isArray(cell.source) ? cell.source : [];
				const code = srcArr.join("");
				const lang = cell.cell_type === "markdown" ? "markdown" : "python";
				return {
					filePath: notebookPath,
					cellIndex0,
					language: lang,
					code,
				};
			}
		} catch (_) {
			// ignore
		}
		return null;
	}

	// Clear caches
	static clearCaches() {
		notebookPathCache.clear();
		notebookContentCache.clear();
	}
}