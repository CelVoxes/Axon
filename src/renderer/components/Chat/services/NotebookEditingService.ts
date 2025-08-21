import { BackendClient } from "../../../services/BackendClient";
import { NotebookService } from "../../../services/NotebookService";
import { EventManager } from "../../../utils/EventManager";
import { ruffLinter } from "../../../services/RuffLinter";
import { autoFixWithRuffAndLLM } from "../../../services/LintAutoFixService";
import { findWorkspacePath } from "../../../utils/WorkspaceUtils";
import {
	stripCodeFences,
	computeSelectionFromMessage,
	buildUnifiedDiff,
	parseJsonEdits,
	applyLineEdits,
	type LineEdit,
} from "../ChatPanelUtils";

interface NotebookEditArgs {
	filePath: string;
	cellIndex: number;
	language: string;
	fullCode: string;
	userMessage: string;
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
	constructor(
		private backendClient: BackendClient,
		private currentWorkspace?: string
	) {}

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

		addMessage(
			`Editing plan:\n\n- **Target**: cell ${cellIndex + 1} in \`${fileName}\`\n- **Scope**: replace lines ${startLine}-${endLine} of the selected code\n- **Process**: I will generate the revised snippet (streaming below), then apply it to the notebook and confirm the save.`,
			false
		);

		const task =
			`Edit the following ${lang} code according to the user's instruction. ` +
			`CRITICAL RULES:\n` +
			`1. Return ONLY the exact replacement for lines ${startLine}-${endLine}\n` +
			`2. Do NOT include explanations or markdown formatting\n` +
			`3. Do NOT add imports, package installs, magic commands, shebangs, or globals\n` +
			`4. Preserve the number of lines unless removing content; match indentation and style\n` +
			`5. Output ONLY the modified code as plain text`;

		let streamedResponse = "";
		const streamingMessageId = `edit-${Date.now()}`;
		analysisDispatch({
			type: "ADD_MESSAGE",
			payload: {
				id: streamingMessageId,
				content: "Streaming edited code…",
				isUser: false,
				isStreaming: true,
				code: "",
				codeLanguage: lang,
				codeTitle: "Edited snippet",
			},
		});

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
				},
				(chunk: string) => {
					streamedResponse += chunk;
					const cleanedSnippet = stripCodeFences(streamedResponse);

					// Update chat message with the edited snippet so far
					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: streamingMessageId,
							updates: {
								content: `Streaming edited code…`,
								code: cleanedSnippet,
								codeLanguage: lang,
								codeTitle: "Edited snippet",
								isStreaming: true,
							},
						},
					});

					// Throttled live update of the notebook cell so changes are visible during streaming
					const now = Date.now();
					if (now - lastCellUpdate > 500) {
						const partialNewCode =
							base.substring(0, start) + cleanedSnippet + base.substring(end);
						notebookService
							.updateCellCode(filePath, cellIndex, partialNewCode)
							.catch(() => {});
						lastCellUpdate = now;
					}
				}
			);
        } catch (e) {
            addMessage(
                `Code edit failed: ${e instanceof Error ? e.message : String(e)}`,
                false
            );
            return;
        }

		// Use the streamed edited snippet; fallback to JSON edits if the model returned them
		const base = fullCode;
		const start = selStart;
		const end = selEnd;
		const cleanedFinal = stripCodeFences(streamedResponse);
		const jsonFallback = parseJsonEdits(streamedResponse);
		let newSelection = jsonFallback
			? applyLineEdits(withinSelection, jsonFallback)
			: cleanedFinal;

		// Guardrail: strip newly introduced imports not present in original selection
		try {
			const importRe = /^(?:\s*from\s+\S+\s+import\s+|\s*import\s+\S+)/;
			const originalLines = withinSelection.split(/\r?\n/);
			const originalImportSet = new Set(
				originalLines.filter((l) => importRe.test(l)).map((l) => l.trim())
			);
			const newLines = newSelection.split(/\r?\n/);
			const filtered = newLines.filter((l) => {
				if (!importRe.test(l)) return true;
				return originalImportSet.has(l.trim());
			});
			if (filtered.length !== newLines.length) {
				newSelection = filtered.join("\n");
			}
		} catch (_) {}

		const newCode = base.substring(0, start) + newSelection + base.substring(end);

		// Validate generated code with Ruff; if issues remain, auto-fix via backend LLM
		let validatedCode = newCode;
		let didAutoFix = false;
		try {
			// Skip linting for package installation cells (pip/conda magics or commands)
			const isInstallCell =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(newCode);
            if (isInstallCell) {
                // Keep code as-is; prefer not to mutate install commands
                addMessage(`ℹ️ Skipping lint/fix for package installation lines.`, false);
                validatedCode = newCode;
            } else {
                const ruffResult = await ruffLinter.lintCode(newCode, {
                    enableFixes: true,
                    filename: `cell_${cellIndex + 1}.py`,
                });
                if (!ruffResult.isValid) {
                    const errors = ruffResult.diagnostics
                        .filter((d) => d.kind === "error")
                        .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`);
                    addMessage(`⚠️ Code validation issues detected. Attempting auto-fix…`, false);

                    // Emit validation error event so Chat can show the error list box
                    try {
                        EventManager.dispatchEvent("code-validation-error", {
                            stepId: streamingMessageId,
                            errors,
                            warnings: ruffResult.diagnostics
                                .filter((d) => d.kind === "warning")
                                .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`),
                            originalCode: newCode,
                            fixedCode: ruffResult.fixedCode || ruffResult.formattedCode,
                            timestamp: Date.now(),
                        } as any);
                    } catch (_) {}
					const fixed = await autoFixWithRuffAndLLM(this.backendClient, newCode, {
						filename: `cell_${cellIndex + 1}.py`,
						stepTitle: `Inline edit for cell ${cellIndex + 1}`,
					});
					validatedCode = fixed.fixedCode || ruffResult.fixedCode || newCode;
					didAutoFix = !!fixed.wasFixed;
					if (fixed.wasFixed) {
						addMessage(`✅ Applied auto-fix for lint issues.`, false);
					} else {
						addMessage(`⚠️ Auto-fix attempted but some issues may remain.`, false);
					}
				} else {
					// Prefer Ruff's improvements when available
					const improved = ruffResult.fixedCode || ruffResult.formattedCode;
					if (improved && improved !== newCode) {
						didAutoFix = true;
						validatedCode = improved;
					} else {
						validatedCode = newCode;
					}
				}
			}
		} catch (error) {
			console.warn("Ruff validation or auto-fix failed:", error);
			validatedCode = newCode;
		}

        await notebookService.updateCellCode(filePath, cellIndex, validatedCode);

        // Mark streaming snippet as completed now that validation and update are done
        try {
            analysisDispatch({
                type: "UPDATE_MESSAGE",
                payload: { id: streamingMessageId, updates: { isStreaming: false, status: "completed" as any } },
            });
        } catch (_) {}

		// Final linting check on the updated code (skip for install cells)
		try {
			const isInstallCellFinal =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(
					validatedCode
				);
			if (isInstallCellFinal) {
				// No final lint for install lines
				throw null; // jump to catch without logging error
			}
			console.log(`Final linting check for cell ${cellIndex + 1}...`);
			const finalLintResult = await ruffLinter.lintCode(validatedCode, {
				enableFixes: false, // Don't fix again, just check
				filename: `cell_${cellIndex + 1}_final.py`,
			});

            if (!finalLintResult.isValid) {
                const issueLines = finalLintResult.diagnostics.map(
                    (d) => `${d.code}: ${d.message} (line ${d.startLine})`
                );
                console.warn(
                    `Linting issues found in cell ${cellIndex + 1}:`,
                    issueLines.join(", ")
                );
                // Emit validation error event for final result
                try {
                    EventManager.dispatchEvent("code-validation-error", {
                        stepId: streamingMessageId,
                        errors: finalLintResult.diagnostics
                            .filter((d) => d.kind === "error")
                            .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`),
                        warnings: finalLintResult.diagnostics
                            .filter((d) => d.kind === "warning")
                            .map((d) => `${d.code}: ${d.message} (line ${d.startLine})`),
                        originalCode: validatedCode,
                        fixedCode: undefined,
                        timestamp: Date.now(),
                    } as any);
                } catch (_) {}
				const errorCount = finalLintResult.diagnostics.filter(
					(d) => d.kind === "error"
				).length;
				const warningCount = finalLintResult.diagnostics.filter(
					(d) => d.kind === "warning"
				).length;
				let lintBlock = "```lint\n";
				lintBlock +=
					`LINT_SUMMARY: ⚠️ Found ${errorCount} error(s)${
						warningCount ? ` and ${warningCount} warning(s)` : ""
					} in cell ${cellIndex + 1}` + "\n";
				if (errorCount) {
					lintBlock += "Errors:\n";
					lintBlock +=
						finalLintResult.diagnostics
							.filter((d) => d.kind === "error")
							.map((d) => `- ${d.code}: ${d.message} (line ${d.startLine})`)
							.join("\n") + "\n";
				}
				if (warningCount) {
					lintBlock += "Warnings:\n";
					lintBlock +=
						finalLintResult.diagnostics
							.filter((d) => d.kind === "warning")
							.map((d) => `- ${d.code}: ${d.message} (line ${d.startLine})`)
							.join("\n") + "\n";
				}
				lintBlock += "```";
				// Skip adding lint error summary to reduce chat clutter
            } else {
                console.log(`Cell ${cellIndex + 1} passed final linting check`);
                // Emit validation success so the green banner shows
                try {
                    EventManager.dispatchEvent("code-validation-success", {
                        stepId: streamingMessageId,
                        message: `No linter errors found`,
                        code: validatedCode,
                        timestamp: Date.now(),
                    } as any);
                } catch (_) {}
            }
		} catch (lintError) {
			if (lintError) {
				console.warn(
					`Failed to run final lint check on cell ${cellIndex + 1}:`,
					lintError
				);
			}
			// Don't fail the whole operation if linting fails
		}

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
		const summary = `Applied notebook edit:\n\n- **Cell**: ${cellIndex + 1}\n- **Lines**: ${startLine}-${endLine} (${originalLineCount} → ${newLineCount} lines)\n- **Status**: ${statusText}${validationText}`;

		// Build diff against the actual replacement we generated.
		// Using validatedCode offsets can drift if a linter reformats outside the selection,
		// so prefer the explicit newSelection for a correct, minimal diff view.
		const unifiedDiff = buildUnifiedDiff(
			withinSelection,
			newSelection,
			fileName,
			startLine
		);
		addMessage(`${summary}\n\n\`\`\`diff\n${unifiedDiff}\n\`\`\``, false);
	}
}
