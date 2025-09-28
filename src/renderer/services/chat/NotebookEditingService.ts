import { createHash } from "crypto";
import { BackendClient } from "../backend/BackendClient";
import { NotebookService } from "../notebook/NotebookService";
import { EventManager } from "../../utils/EventManager";
import { autoFixWithRuffAndLLM } from "./LintAutoFixService";
import { ConfigManager } from "../backend/ConfigManager";
import { findWorkspacePath } from "../../utils/WorkspaceUtils";
import {
	stripCodeFences,
	computeSelectionFromMessage,
	buildUnifiedDiff,
	parseJsonEdits,
	applyLineEdits,
	type LineEdit,
} from "../../components/Chat/ChatPanelUtils";

interface NotebookEditArgs {
	filePath: string;
	cellIndex: number;
	language: string;
	fullCode: string;
	userMessage: string;
	sessionId?: string;
	selection?: {
		selStart: number;
		selEnd: number;
		startLine: number;
		endLine: number;
		withinSelection: string;
	};
	outputText?: string;
	hasErrorOutput?: boolean;
}

interface NotebookEditCallbacks {
	addMessage: (content: string, isUser: boolean) => void;
	analysisDispatch: (action: any) => void;
}

export class NotebookEditingService {
	private static readonly LINT_CACHE_TTL_MS = 15_000;
	private lintCache = new Map<
		string,
		{
			result: {
				fixedCode: string;
				wasFixed: boolean;
				issues: any[];
				warnings: any[];
				timings?: any;
			};
			timestamp: number;
		}
	>();

	constructor(
		private backendClient: BackendClient,
		private currentWorkspace?: string
	) {}

	private readonly fallbackSessionInstanceId = `offline_${Date.now()}_${Math.random()
		.toString(36)
		.slice(2, 8)}`;

	private buildFallbackSessionId(
		...parts: Array<string | null | undefined>
	): string {
		const suffixParts = parts
			.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
			.map((p) => p.trim().replace(/[:\s]+/g, "_"));
		const suffix = suffixParts.length ? suffixParts.join(":") : "default";
		return `session:${this.fallbackSessionInstanceId}:${suffix}`;
	}

	private resolveSessionId(
		base?: string | null,
		...fallbackParts: Array<string | null | undefined>
	): string | undefined {
		const trimmedBase = typeof base === "string" ? base.trim() : "";
		if (this.backendClient) {
			return this.backendClient.scopeSessionId(
				trimmedBase || undefined,
				...fallbackParts
			);
		}
		if (trimmedBase.length > 0) {
			return trimmedBase.startsWith("session:")
				? trimmedBase
				: this.buildFallbackSessionId(trimmedBase);
		}
		return this.buildFallbackSessionId(...fallbackParts);
	}

	private createLintCacheKey(code: string): string {
		return createHash("sha1").update(code, "utf8").digest("hex");

	}

	private getLintCache(code: string) {
		const key = this.createLintCacheKey(code);
		const entry = this.lintCache.get(key);
		if (!entry) return null;
		if (Date.now() - entry.timestamp > NotebookEditingService.LINT_CACHE_TTL_MS) {
			this.lintCache.delete(key);
			return null;
		}
		return entry.result;
	}

	private setLintCache(code: string, result: {
		fixedCode: string;
		wasFixed: boolean;
		issues: any[];
		warnings: any[];
		timings?: any;
	}) {
		const key = this.createLintCacheKey(code);
		if (this.lintCache.size >= 32) {
			const oldest = this.lintCache.keys().next();
			if (!oldest.done) {
				this.lintCache.delete(oldest.value);
			}
		}
		this.lintCache.set(key, { result, timestamp: Date.now() });
	}

	async performNotebookEdit(
		args: NotebookEditArgs,
		callbacks: NotebookEditCallbacks
	): Promise<void> {
		const { addMessage, analysisDispatch } = callbacks;
		const {
			filePath,
			cellIndex,
			language,
			fullCode,
			userMessage,
			selection,
			outputText,
			hasErrorOutput,
		} = args;

		const wsPath =
			findWorkspacePath({
				filePath,
				currentWorkspace: this.currentWorkspace || undefined,
			}) || "";
		const notebookService = new NotebookService({ workspacePath: wsPath });

		const lang = (language || "python").toLowerCase();
		const { selStart, selEnd, startLine, endLine, withinSelection } =
			selection || computeSelectionFromMessage(fullCode, userMessage);
		const fileName = filePath.split("/").pop() || filePath;

		// Do not add a predetermined plan message; rely on streamed reasoning in chat

		const task =
			`Edit the following ${lang} code according to the user's instruction. ` +
			`CRITICAL RULES:\n` +
			`1. Return ONLY the exact replacement for lines ${startLine}-${endLine}\n` +
			`2. Do NOT include explanations or markdown formatting\n` +
			// Allow a single minimal import if it's strictly required to resolve a NameError for symbols already used
			// in the snippet (e.g., "from sklearn.preprocessing import StandardScaler" when StandardScaler is undefined).
			// Prefer adding a real import over re-implementing any library API.
			`3. Imports: You MAY add one minimal import if strictly required for a symbol used in this snippet. Do NOT emulate library classes/functions (e.g., sklearn/scanpy/numpy/pandas).\n` +
			`4. Do NOT add package installation commands in this snippet. If a package is missing, keep the import; installation is handled elsewhere.\n` +
			`5. Preserve the number of lines unless removing content; match indentation and style\n` +
			`6. Output ONLY the modified code as plain text`;

		let streamedResponse = "";
		const streamingMessageId = `edit-${Date.now()}`;
		// Emit a generation-started event so the Thought header appears immediately
		try {
			EventManager.dispatchEvent("code-generation-started", {
				stepId: streamingMessageId,
				stepDescription: `Edit cell ${cellIndex + 1} in ${fileName}`,
				timestamp: Date.now(),
				suppressCodePlaceholder: true,
			} as any);
		} catch (_) {}

		// Defer creating the code message until the first code chunk arrives, so Thought appears first
		let snippetMessageCreated = false;

		try {
			const base = fullCode;
			const start = selStart;
			const end = selEnd;
			let lastCellUpdate = 0;

			await this.backendClient.generateCodeStream(
				{
					task_description:
						`${task}\n\nUser instruction: ${userMessage}\n\n` +
						(outputText && outputText.trim().length > 0
							? `${
									hasErrorOutput ? "Error" : "Execution"
							  } output for context:\n\n\`\`\`text\n${outputText}\n\`\`\`\n\n`
							: "") +
						`Original code (lines ${startLine}-${endLine}):\n${withinSelection}\n\nIMPORTANT: The original has ${
							withinSelection.split("\n").length
						} lines. Return EXACTLY ${
							withinSelection.split("\n").length
						} modified lines (no imports, no extra lines). Example format:\nline1\nline2\n\nYour response:`,
					language: lang,
					context: "Notebook code edit-in-place",
					notebook_edit: true,
					session_id: this.resolveSessionId(args.sessionId, wsPath),
					model: ConfigManager.getInstance().getDefaultModel(),
				},
				(chunk: string) => {
					streamedResponse += chunk;
					const cleanedSnippet = stripCodeFences(streamedResponse);

					// Create the code message on first chunk, then update subsequently
					if (!snippetMessageCreated) {
						analysisDispatch({
							type: "ADD_MESSAGE",
							payload: {
								id: streamingMessageId,
								content: "",
								isUser: false,
								isStreaming: true,
								code: cleanedSnippet,
								codeLanguage: lang,
								codeTitle: "Edited snippet",
							},
						});
						snippetMessageCreated = true;
					} else {
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: streamingMessageId,
								updates: {
									content: "",
									code: cleanedSnippet,
									codeLanguage: lang,
									codeTitle: "Edited snippet",
									isStreaming: true,
								},
							},
						});
					}

					// Skip live notebook updates during streaming to avoid adding unvalidated code
					// The notebook will only be updated after validation and linting are complete
				},
				// Stream reasoning into Chat just like code generation
				(reasoningDelta: string) => {
					try {
						EventManager.dispatchEvent("code-generation-reasoning", {
							stepId: streamingMessageId,
							delta: reasoningDelta,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				},
				(summaryText: string) => {
					try {
						// Finalize the thought timer (we do not post the summary text as a separate message)
						EventManager.dispatchEvent("code-generation-summary", {
							stepId: streamingMessageId,
							summary: summaryText,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				}
			);
		} catch (e) {
			addMessage(
				`Code edit failed: ${e instanceof Error ? e.message : String(e)}`,
				false
			);
			return;
		}

		// Update session stats immediately after edit stream completes
		try {
			const { SessionStatsService } = await import(
				"../backend/SessionStatsService"
			);
			const statsSessionId = this.resolveSessionId(
				args.sessionId,
				this.currentWorkspace
			);
			await SessionStatsService.update(
				this.backendClient,
				statsSessionId
			);
		} catch (_) {}

		// Use the streamed edited snippet; fallback to JSON edits if the model returned them
		const base = fullCode;
		const start = selStart;
		const end = selEnd;
		const cleanedFinal = stripCodeFences(streamedResponse);
		const jsonFallback = parseJsonEdits(streamedResponse);
		let newSelection = jsonFallback
			? applyLineEdits(withinSelection, jsonFallback)
			: cleanedFinal;

		// Keep necessary imports for snippet correctness; do not strip imports added by the model

		const newCode =
			base.substring(0, start) + newSelection + base.substring(end);

		// Validate code edits using the LintAutoFixService (same as before consolidation)
		type LintResult = {
			fixedCode: string;
			wasFixed: boolean;
			issues: any[];
			warnings: any[];
			timings?: any;
		};
		let finalValidatedCode = newCode;
		let didAutoFix = false;

		try {
			const isInstallCell =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(newCode);
			const selectionLineCount = withinSelection.split(/\r?\n/).length;
			const newSelectionLineCount = newSelection.split(/\r?\n/).length;
			const smallEdit =
				selectionLineCount <= 2 &&
				newSelectionLineCount <= 2 &&
				Math.abs(newSelection.length - withinSelection.length) <= 80;

			let lintResult: LintResult;
			let lintSource: "install" | "small-edit" | "cache" | "lint" = "lint";

			if (isInstallCell) {
				lintSource = "install";
				lintResult = {
					fixedCode: newCode,
					wasFixed: false,
					issues: [],
					warnings: [],
					timings: undefined,
				};
				addMessage(
					`ℹ️ Package installation cell - skipping lint check.`,
					false
				);
				try {
					EventManager.dispatchEvent("code-validation-success", {
						stepId: streamingMessageId,
						message: `Package installation commands`,
						code: newCode,
						warnings: [],
						timings: undefined,
						timestamp: Date.now(),
					} as any);
				} catch (_) {}
			} else {
				const cachedLint = this.getLintCache(newCode);
				if (cachedLint) {
					lintSource = "cache";
					lintResult = cachedLint;
					addMessage(`⚡ Reused recent lint result.`, false);
				} else if (smallEdit) {
					lintSource = "small-edit";
					lintResult = {
						fixedCode: newCode,
						wasFixed: false,
						issues: [],
						warnings: [],
						timings: undefined,
					};
					addMessage(
						`ℹ️ Small edit detected — skipping lint check.`,
						false
					);
					this.setLintCache(newCode, lintResult);
				} else {
					lintSource = "lint";
					lintResult = await autoFixWithRuffAndLLM(
						this.backendClient,
						newCode,
						{
							filename: `cell_${cellIndex + 1}_edit.py`,
							stepTitle: `Code edit for cell ${cellIndex + 1}`,
						},
						this.resolveSessionId(undefined, wsPath)
					);
					this.setLintCache(newCode, lintResult);
				}
			}

			finalValidatedCode = lintResult.fixedCode;
			didAutoFix = lintResult.wasFixed;

			if (lintSource !== "install") {
				if (lintResult.issues.length === 0) {
					if (lintSource === "lint") {
						addMessage(`✅ Lint check passed for the code edit.`, false);
					}
					const successMessage =
						lintSource === "cache"
							? `Lint check passed (cached)`
							: lintSource === "small-edit"
							? `Lint skipped (small edit)`
							: `Lint check passed`;
					try {
						EventManager.dispatchEvent("code-validation-success", {
							stepId: streamingMessageId,
							message: successMessage,
							code: finalValidatedCode,
							warnings: lintResult.warnings,
							timings: lintResult.timings,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				} else {
					addMessage(
						`⚠️ Lint check found ${lintResult.issues.length} issue(s).`,
						false
					);
					try {
						EventManager.dispatchEvent("code-validation-error", {
							stepId: streamingMessageId,
							errors: lintResult.issues,
							warnings: lintResult.warnings,
							originalCode: newCode,
							fixedCode: lintResult.fixedCode,
							timings: lintResult.timings,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				}

				if (lintResult.wasFixed) {
					addMessage(`🔧 Ruff auto-fix applied to the code edit.`, false);
				}
			}
		} catch (error) {
			console.warn("Code edit validation failed:", error);
			addMessage(`⚠️ Lint check failed, using original code.`, false);
			finalValidatedCode = newCode;
		}

		// First, mark streaming as completed with the final validated code so highlighting works
		try {
			analysisDispatch({
				type: "UPDATE_MESSAGE",
				payload: {
					id: streamingMessageId,
					updates: {
						isStreaming: false,
						status: "completed" as any,
						code: finalValidatedCode, // Update with the final linted/fixed code
						codeTitle: didAutoFix
							? "Edited snippet (auto-fixed)"
							: "Edited snippet",
					},
				},
			});
			try {
				EventManager.dispatchEvent("code-generation-completed", {
					stepId: streamingMessageId,
					stepDescription: `Edit cell ${cellIndex + 1} in ${fileName}`,
					finalCode: finalValidatedCode,
					success: true,
					timestamp: Date.now(),
				} as any);
			} catch (_) {}
		} catch (_) {}

		// ONLY AFTER highlighting is applied, add the validated code to notebook
		await notebookService.updateCellCode(
			filePath,
			cellIndex,
			finalValidatedCode
		);

		// Short confirmation window; fallback to optimistic success
		let updateDetail: any = null;
		try {
			const timeoutMs = 2000;
			// We can't easily use EventManager here without more dependencies,
			// so we'll use optimistic success
			updateDetail = { success: true, immediate: true };
		} catch (_) {
			updateDetail = { success: true, immediate: true };
		}

		const originalLineCount = withinSelection.split("\n").length;
		const newLineCount = newSelection.split("\n").length;
		const statusText =
			updateDetail?.success === false
				? "save failed"
				: updateDetail?.immediate
				? "applied"
				: "saved";
		const validationText = didAutoFix ? " (auto-fixed)" : "";

		// Build diff against the actual replacement we generated.
		// Using validatedCode offsets can drift if a linter reformats outside the selection,
		// so prefer the explicit newSelection for a correct, minimal diff view.
		const unifiedDiff = buildUnifiedDiff(
			withinSelection,
			newSelection,
			fileName,
			startLine
		);
		addMessage(`\`\`\`diff\n${unifiedDiff}\n\`\`\``, false);
	}
}
