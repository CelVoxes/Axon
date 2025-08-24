import { BackendClient } from "../backend/BackendClient";
import { NotebookService } from "../notebook/NotebookService";
import { EventManager } from "../../utils/EventManager";
import { autoFixWithRuffAndLLM } from "./LintAutoFixService";
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
			`Editing plan:\n\n- **Target**: cell ${
				cellIndex + 1
			} in \`${fileName}\`\n- **Scope**: replace lines ${startLine}-${endLine} of the selected code\n- **Process**: I will generate the revised snippet (streaming below), then apply it to the notebook and confirm the save.`,
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

					// Skip live notebook updates during streaming to avoid adding unvalidated code
					// The notebook will only be updated after validation and linting are complete
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

		const newCode =
			base.substring(0, start) + newSelection + base.substring(end);

		// Validate generated code with Ruff; if issues remain, auto-fix via backend LLM
		let validatedCode = newCode;
		let didAutoFix = false;
		try {
			// Skip linting for package installation cells (pip/conda magics or commands)
			const isInstallCell =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(newCode);
			if (isInstallCell) {
				// Keep code as-is; prefer not to mutate install commands
				addMessage(
					`ℹ️ Skipping lint/fix for package installation lines.`,
					false
				);
				validatedCode = newCode;
				
				// Emit validation success event for install cells so UI shows them properly
				try {
					EventManager.dispatchEvent("code-validation-success", {
						stepId: streamingMessageId,
						message: `Package installation commands (no linting needed)`,
						code: newCode,
						timestamp: Date.now(),
					} as any);
				} catch (_) {}
			} else {
				// Use unified Ruff+LLM validation service
				const fixed = await autoFixWithRuffAndLLM(
					this.backendClient,
					newCode,
					{
						filename: `cell_${cellIndex + 1}.py`,
						stepTitle: `Inline edit for cell ${cellIndex + 1}`,
					}
				);

				validatedCode = fixed.fixedCode;
				didAutoFix = fixed.wasFixed;

				if (fixed.issues.length > 0) {
					addMessage(
						`⚠️ Code validation found ${fixed.issues.length} issue${fixed.issues.length > 1 ? 's' : ''}`,
						false
					);

					// Emit validation error event so Chat can show the error list box
					try {
						EventManager.dispatchEvent("code-validation-error", {
							stepId: streamingMessageId,
							errors: fixed.issues,
							warnings: fixed.warnings,
							originalCode: newCode,
							fixedCode: fixed.fixedCode,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				} else {
					addMessage(`✅ Code validation passed.`, false);
				}

				if (fixed.wasFixed) {
					addMessage(`🔧 Applied code improvements and fixes.`, false);
				}

				if (fixed.warnings.length > 0) {
					addMessage(
						`ℹ️ ${fixed.warnings.length} warning${fixed.warnings.length > 1 ? 's' : ''} noted`,
						false
					);
				}

				if (!fixed.ruffSucceeded) {
					addMessage(`⚠️ Used LLM fallback validation`, false);
				}
			}
		} catch (error) {
			console.warn("Ruff validation or auto-fix failed:", error);
			validatedCode = newCode;
		}

		// Final linting check on the validated code BEFORE adding to notebook
		let finalValidatedCode = validatedCode;
		try {
			const isInstallCellFinal =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(
					validatedCode
				);
			if (isInstallCellFinal) {
				// No final lint for install lines, but set finalValidatedCode correctly
				finalValidatedCode = validatedCode;
				console.log(`Cell ${cellIndex + 1} is package installation - skipping final validation`);
				// Jump to the success path without logging error
				throw null; 
			}
			console.log(`Final validation check for cell ${cellIndex + 1}...`);
			// Quick validation check only (no fixes applied)
			const finalValidation = await autoFixWithRuffAndLLM(
				this.backendClient,
				validatedCode,
				{
					filename: `cell_${cellIndex + 1}_final.py`,
					stepTitle: `Final validation for cell ${cellIndex + 1}`,
				}
			);

			if (finalValidation.issues.length > 0 || finalValidation.warnings.length > 0) {
				console.warn(
					`Validation issues found in cell ${cellIndex + 1}:`,
					[...finalValidation.issues, ...finalValidation.warnings].join(", ")
				);
				// Emit validation event for final result
				try {
					EventManager.dispatchEvent("code-validation-error", {
						stepId: streamingMessageId,
						errors: finalValidation.issues,
						warnings: finalValidation.warnings,
						originalCode: validatedCode,
						fixedCode: finalValidation.fixedCode,
						timestamp: Date.now(),
					} as any);
				} catch (_) {}

				const errorCount = finalValidation.issues.length;
				const warningCount = finalValidation.warnings.length;
				
				// Show lint summary for errors, or warnings if there are many
				if (errorCount > 0 || warningCount >= 3) {
					const status = errorCount > 0 ? '⚠️' : 'ℹ️';
					let lintBlock = "```lint\n";
					lintBlock +=
						`LINT_SUMMARY: ${status} Found ${errorCount > 0 ? `${errorCount} error(s)` : ''}${
							errorCount > 0 && warningCount > 0 ? ' and ' : ''
						}${warningCount > 0 ? `${warningCount} warning(s)` : ''} in cell ${cellIndex + 1}` + "\n";
					if (errorCount > 0) {
						lintBlock += "Errors:\n";
						lintBlock += finalValidation.issues.map(issue => `- ${issue}`).join("\n") + "\n";
					}
					if (warningCount > 0) {
						lintBlock += "Warnings:\n";
						lintBlock += finalValidation.warnings.map(warning => `- ${warning}`).join("\n") + "\n";
					}
					lintBlock += "```";
					
					// Add lint summary to chat for visibility
					addMessage(lintBlock, false);
				} else if (warningCount > 0) {
					// For few warnings, just show a simple message
					addMessage(`ℹ️ ${warningCount} linting warning${warningCount > 1 ? 's' : ''} in cell ${cellIndex + 1}`, false);
				}

				// Use the final fixed code if available
				if (finalValidation.wasFixed && finalValidation.fixedCode !== validatedCode) {
					finalValidatedCode = finalValidation.fixedCode;
					console.log(`Applied final fixes to cell ${cellIndex + 1}`);
				}
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
						codeTitle: didAutoFix ? "Edited snippet (auto-fixed)" : "Edited snippet"
					},
				},
			});
		} catch (_) {}

		// ONLY AFTER highlighting is applied, add the validated code to notebook
		await notebookService.updateCellCode(filePath, cellIndex, finalValidatedCode);

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
		const summary = `Applied notebook edit:\n\n- **Cell**: ${
			cellIndex + 1
		}\n- **Lines**: ${startLine}-${endLine} (${originalLineCount} → ${newLineCount} lines)\n- **Status**: ${statusText}${validationText}`;

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
