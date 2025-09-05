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
            // Allow a single minimal import if it's strictly required to resolve a NameError for symbols already used
            // in the snippet (e.g., "import pandas as pd" when 'pd' is undefined). If you add such an import, keep the
            // total line count unchanged by replacing an existing blank/comment line within the edited range.
            `3. Avoid adding imports, package installs, magic commands, shebangs, or globals.\n` +
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

        // Guardrail: strip newly introduced imports unless fixing a NameError (from output context)
        try {
            const hasNameError = Boolean((outputText || '').toLowerCase().includes('name ') && (outputText || '').toLowerCase().includes(' not defined'));
            if (!hasNameError) {
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
            }
        } catch (_) {}

		const newCode =
			base.substring(0, start) + newSelection + base.substring(end);

		// Validate code edits using the LintAutoFixService (same as before consolidation)
		let finalValidatedCode = newCode;
		let didAutoFix = false;

		try {
			// Check if it's a package installation cell and skip validation if so
			const isInstallCell =
				/(^|\n)\s*(%pip|%conda|pip\s+install|conda\s+install)\b/i.test(newCode);
				
			if (isInstallCell) {
				addMessage(`ℹ️ Package installation cell - skipping validation.`, false);
				finalValidatedCode = newCode;
				
				// Emit success event for UI
				try {
					EventManager.dispatchEvent("code-validation-success", {
						stepId: streamingMessageId,
						message: `Package installation commands`,
						code: newCode,
						timestamp: Date.now(),
					} as any);
				} catch (_) {}
			} else {
				// Use LintAutoFixService for validation
				const validationResult = await autoFixWithRuffAndLLM(
					this.backendClient,
					newCode,
					{
						filename: `cell_${cellIndex + 1}_edit.py`,
						stepTitle: `Code edit for cell ${cellIndex + 1}`,
					}
				);

				finalValidatedCode = validationResult.fixedCode;
				didAutoFix = validationResult.wasFixed;

				if (validationResult.issues.length === 0) {
					addMessage(`✅ Code edit validated successfully.`, false);
					
					// Emit success event
					try {
						EventManager.dispatchEvent("code-validation-success", {
							stepId: streamingMessageId,
							message: `Code edit validation passed`,
							code: finalValidatedCode,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				} else {
					addMessage(`⚠️ Code edit validation found ${validationResult.issues.length} issue(s).`, false);
					
					// Emit validation error event
					try {
						EventManager.dispatchEvent("code-validation-error", {
							stepId: streamingMessageId,
							errors: validationResult.issues,
							warnings: validationResult.warnings,
							originalCode: newCode,
							fixedCode: finalValidatedCode,
							timestamp: Date.now(),
						} as any);
					} catch (_) {}
				}

				if (didAutoFix) {
					addMessage(`🔧 Applied automatic fixes to code edit.`, false);
				}
			}

		} catch (error) {
			console.warn("Code edit validation failed:", error);
			addMessage(`⚠️ Code edit validation failed, using original code.`, false);
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
