import { useEffect, useRef } from "react";
import { EventManager } from "../../../utils/EventManager";
import { findWorkspacePath } from "../../../utils/WorkspaceUtils";

interface CodeEditContext {
	filePath?: string;
	cellIndex?: number;
	language?: string;
	selectedText: string;
	fullCode?: string;
	selectionStart?: number;
	selectionEnd?: number;
	outputText?: string;
	hasErrorOutput?: boolean;
}

interface UseChatEventsProps {
	uiState: any;
	uiDispatch: any;
	workspaceState: any;
	composerRef: React.RefObject<any>;
	setInputValue: (value: string) => void;
	inputValueRef: React.MutableRefObject<string>;
	setCodeEditContext: (context: CodeEditContext | null) => void;
	codeEditContextRef: React.MutableRefObject<CodeEditContext | null>;
}

export function useChatEvents({
	uiState,
	uiDispatch,
	workspaceState,
	composerRef,
	setInputValue,
	inputValueRef,
	setCodeEditContext,
	codeEditContextRef,
}: UseChatEventsProps) {
	useEffect(() => {
		// Deduplicate rapid successive events (e.g., multiple notebooks emitting)
		let lastPayloadKey = "";
		let lastAt = 0;
		const DEDUPE_MS = 250;

		const cleanup = EventManager.createManagedListener(
			"chat-edit-selection",
			(event) => {
				const detail = event.detail || {};
				const snippet: string = String(detail.selectedText || "");
				const lang: string = String(detail.language || "python");
				const filePath: string = String(detail.filePath || "");
				const cellIndex: string = String(
					detail.cellIndex === 0 || detail.cellIndex
						? String(detail.cellIndex)
						: ""
				);
				const payloadKey = `${filePath}|${cellIndex}|${lang}|${snippet}`;
				const now = Date.now();
				if (payloadKey === lastPayloadKey && now - lastAt < DEDUPE_MS) {
					return;
				}
				lastPayloadKey = payloadKey;
				lastAt = now;

				const ctx: CodeEditContext = {
					filePath: detail.filePath,
					cellIndex: detail.cellIndex,
					language: detail.language,
					selectedText: detail.selectedText,
					fullCode: detail.fullCode,
					selectionStart: detail.selectionStart,
					selectionEnd: detail.selectionEnd,
				};
				setCodeEditContext(ctx);
				codeEditContextRef.current = ctx;
				// Ensure chat opens and is focused
				if (!uiState.showChatPanel || uiState.chatCollapsed) {
					uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
					uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
					// Focus the composer after the chat panel opens
					setTimeout(() => composerRef.current?.focus(), 100);
				} else {
					// If chat is already open, focus immediately
					composerRef.current?.focus();
				}
			}
		);
		return cleanup;
	}, [uiDispatch, uiState.showChatPanel, uiState.chatCollapsed, composerRef, setCodeEditContext, codeEditContextRef]);

	useEffect(() => {
		const onAddOutput = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");

			// Build a cell mention like @relative/path#N
			let alias = "";
			try {
				const wsRoot =
					findWorkspacePath({
						filePath: d.filePath || "",
						currentWorkspace: workspaceState.currentWorkspace || undefined,
					}) ||
					workspaceState.currentWorkspace ||
					"";
				const rel =
					d.filePath && wsRoot && String(d.filePath).startsWith(wsRoot)
						? String(d.filePath).slice(wsRoot.length + 1)
						: String(d.filePath || "");
				const cellNum =
					typeof d.cellIndex === "number" ? d.cellIndex + 1 : undefined;
				alias = rel ? `@${rel}${cellNum ? `#${cellNum}` : ""}` : "";
			} catch (_) {
				/* ignore */
			}

			// Add the mention and the actual output/error content for user visibility
			if (alias) {
				// Clear any existing input and start fresh with the mention
				const mentionText = alias;

				// Add the prompt and the actual output/error content
				const outputType = Boolean(d.hasError) ? "Error" : "Output";
				const outputPrompt = `\n\nPlease explain this ${outputType.toLowerCase()} from the ${lang} cell and suggest how to fix any issues:`;

				// Include the actual output/error content so user can see what they're asking about
				const outputContent = out.trim()
					? `\n\n\`\`\`\n${out.trim()}\n\`\`\``
					: "";

				const final = mentionText + " " + outputPrompt + outputContent;
				setInputValue(final);
				inputValueRef.current = final;
			} else {
				// Fallback to old behavior if no alias
				const prefix = `Please review the ${lang} cell output and fix any issues.`;
				const body = `\n\nCell: (referenced cell)\n`;
				const prefill = prefix + body;
				setInputValue(prefill);
				inputValueRef.current = prefill;
			}

			// For "Ask Chat" on output, don't auto-trigger edit mode
			// Instead, let the user have a conversation about the error/output
			// They can explicitly ask for code changes if needed

			// IMPORTANT: Clear any existing codeEditContext to prevent it from
			// getting stuck on a previous cell when user asks about a different cell
			setCodeEditContext(null);
			codeEditContextRef.current = null;

			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
				// Focus the composer after the chat panel opens
				setTimeout(() => composerRef.current?.focus(), 100);
			} else {
				// If chat is already open, focus immediately
				composerRef.current?.focus();
			}
		};

		const onFixError = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");
			const prefix = `The following ${lang} cell failed. Fix the code to resolve the error. Return only the corrected code.`;
			// Mention the cell, avoid embedding large blocks
			let alias = "";
			try {
				const wsRoot =
					findWorkspacePath({
						filePath: d.filePath || "",
						currentWorkspace: workspaceState.currentWorkspace || undefined,
					}) ||
					workspaceState.currentWorkspace ||
					"";
				const rel =
					d.filePath && wsRoot && String(d.filePath).startsWith(wsRoot)
						? String(d.filePath).slice(wsRoot.length + 1)
						: String(d.filePath || "");
				const cellNum =
					typeof d.cellIndex === "number" ? d.cellIndex + 1 : undefined;
				alias = rel ? `@${rel}${cellNum ? `#${cellNum}` : ""}` : "";
			} catch (_) {
				/* ignore */
			}
			const body = `\n\nCell: ${alias || "(referenced cell)"}\n`;
			const prefill = prefix + body;
			setInputValue(prefill);
			inputValueRef.current = prefill;
			const ctx: CodeEditContext = {
				filePath: d.filePath,
				cellIndex: d.cellIndex,
				language: d.language,
				selectedText: code,
				fullCode: code,
				selectionStart: 0,
				selectionEnd: code.length,
				outputText: out,
				hasErrorOutput: true,
			};
			// Replace any existing context with this new error-fixing context
			setCodeEditContext(ctx);
			codeEditContextRef.current = ctx;
			if (!uiState.showChatPanel || uiState.chatCollapsed) {
				uiDispatch({ type: "SET_SHOW_CHAT_PANEL", payload: true });
				uiDispatch({ type: "SET_CHAT_COLLAPSED", payload: false });
				// Focus the composer after the chat panel opens
				setTimeout(() => composerRef.current?.focus(), 100);
			} else {
				// If chat is already open, focus immediately
				composerRef.current?.focus();
			}
		};

		window.addEventListener("chat-add-output", onAddOutput as EventListener);
		window.addEventListener("chat-fix-error", onFixError as EventListener);
		return () => {
			window.removeEventListener(
				"chat-add-output",
				onAddOutput as EventListener
			);
			window.removeEventListener("chat-fix-error", onFixError as EventListener);
		};
	}, [
		uiDispatch,
		uiState.showChatPanel,
		uiState.chatCollapsed,
		workspaceState.currentWorkspace,
		composerRef,
		setInputValue,
		inputValueRef,
		setCodeEditContext,
		codeEditContextRef,
	]);
}