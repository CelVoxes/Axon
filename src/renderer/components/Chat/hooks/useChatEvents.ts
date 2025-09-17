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
	}, [
		uiDispatch,
		uiState.showChatPanel,
		uiState.chatCollapsed,
		composerRef,
		setCodeEditContext,
		codeEditContextRef,
	]);

	useEffect(() => {
		const onAddOutput = (e: Event) => {
			const ce = e as CustomEvent;
			const d = ce.detail || {};
			const lang: string = String(d.language || "python").toLowerCase();
			const code: string = String(d.code || "");
			const out: string = String(d.output || "");

			// Build a concise cell mention. Prefer #N to keep composer clean.
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
				alias = cellNum ? `#${cellNum}` : rel ? `@${rel}` : "";
			} catch (_) {
				/* ignore */
			}

			// Add the mention and prompt; include a trimmed output snippet so the LLM sees context
			if (alias) {
				// Clear any existing input and start fresh with the mention
				const mentionText = alias;
				const outputType = Boolean(d.hasError) ? "error" : "output";
				// Truncate output for composer to avoid huge messages
				const raw = (out || "").toString();
				const getLimit = (key: string, fallback: number) => {
					try {
						const v =
							(window.localStorage && window.localStorage.getItem(key)) || "";
						const n = parseInt(v as string, 10);
						return !Number.isNaN(n) && n > 0 ? n : fallback;
					} catch {
						return fallback;
					}
				};
				const maxChars = getLimit("axon.askChatOutputChars", 2000);
				const maxLines = getLimit("axon.askChatOutputLines", 60);
				const lines = raw.split(/\r?\n/);
				const clippedLines = lines.slice(0, maxLines);
				let clipped = clippedLines.join("\n");
				if (clipped.length > maxChars) clipped = clipped.slice(0, maxChars);
				const snipNotice =
					raw.length > clipped.length || lines.length > clippedLines.length
						? `\n... [truncated]`
						: "";
				const snippet = clipped
					? `\n\n\`\`\`text\n${clipped}${snipNotice}\n\`\`\``
					: "";
				const final = `${mentionText} Please fix if there is an error in the output.${snippet}`;
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

			// Stash cell context (code + output) so Ask mode can include it for the LLM.
			// This does NOT force an edit; it only provides additional context.
			const ctx: CodeEditContext = {
				filePath: d.filePath,
				cellIndex: d.cellIndex,
				language: lang,
				selectedText: code,
				fullCode: code,
				selectionStart: 0,
				selectionEnd: code.length,
				outputText: out,
				hasErrorOutput: Boolean(d.hasError),
			};
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
				alias = cellNum ? `#${cellNum}` : rel ? `@${rel}` : "";
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
