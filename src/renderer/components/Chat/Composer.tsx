import React from "react";
import styled from "styled-components";
import { FiSquare } from "react-icons/fi";
import { ConfigManager } from "../../services/ConfigManager";
import { Tooltip } from "@components/shared/Tooltip";

// Define styled components at module scope to avoid dynamic creation warnings
const MentionsBar = styled.div<{ $visible: boolean }>`
	display: ${(p) => (p.$visible ? "flex" : "none")};
	flex-wrap: wrap;
	gap: 6px;
	padding: 6px 8px;
	margin-bottom: 8px;
	background: #2d2d30;
	border: 1px solid #3e3e42;
	border-radius: 6px;
	max-height: 72px;
	overflow-y: auto;
`;

const MentionChip = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 3px 8px;
	border-radius: 12px;
	font-size: 12px;
	line-height: 16px;
	background: #374151;
	color: #e5e7eb;
	border: 1px solid #4b5563;
`;

interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	isProcessing: boolean;
	isLoading: boolean;
	disabled?: boolean;
	onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	mode?: "Agent" | "Ask";
	onModeChange?: (mode: "Agent" | "Ask") => void;
}

export const Composer: React.FC<ComposerProps> = ({
	value,
	onChange,
	onSend,
	onStop,
	isProcessing,
	isLoading,
	disabled,
	onKeyDown,
	mode = "Agent",
	onModeChange,
}) => {
	const [model, setModel] = React.useState<string>(
		ConfigManager.getInstance().getDefaultModel()
	);
	const models = React.useMemo(
		() => ConfigManager.getInstance().getAvailableModels(),
		[]
	);

	const [showModelMenu, setShowModelMenu] = React.useState(false);
	const [showModeMenu, setShowModeMenu] = React.useState(false);
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const rafIdRef = React.useRef<number | null>(null);

	const resizeTextarea = React.useCallback((el: HTMLTextAreaElement) => {
		// Read max-height from computed styles to avoid hardcoding
		const computed = window.getComputedStyle(el);
		const maxHeightStr = computed.maxHeight;
		const maxHeight = Number.isFinite(parseFloat(maxHeightStr))
			? parseFloat(maxHeightStr)
			: Number.POSITIVE_INFINITY;

		el.style.height = "auto";
		const next = Math.min(el.scrollHeight, maxHeight);
		if (el.style.height !== `${next}px`) {
			el.style.height = `${next}px`;
		}
	}, []);

	const applyModel = (next: string) => {
		setModel(next);
		ConfigManager.getInstance().setValue(
			"analysis",
			"defaultModel",
			next as any
		);
	};

	// Note: do not auto-close on outside click to avoid conflicts with
	// React synthetic event ordering. Menu closes on selection or toggle.
	const handleKeyDownInternal = (
		e: React.KeyboardEvent<HTMLTextAreaElement>
	) => {
		// First allow parent to intercept (e.g., mention navigation)
		if (onKeyDown) {
			onKeyDown(e);
		}
		if (e.defaultPrevented) return;
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSend();
		}
	};

	const handleTextareaChange = React.useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			onChange(e.target.value);
			const el = textareaRef.current || e.target;
			if (rafIdRef.current) {
				cancelAnimationFrame(rafIdRef.current);
			}
			rafIdRef.current = requestAnimationFrame(() => resizeTextarea(el));
		},
		[onChange, resizeTextarea]
	);

	// Ensure resize when value is updated programmatically
	React.useLayoutEffect(() => {
		if (!textareaRef.current) return;
		// Use rAF to run after DOM updates/paint
		if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
		rafIdRef.current = requestAnimationFrame(() => {
			if (textareaRef.current) resizeTextarea(textareaRef.current);
		});
	}, [value, resizeTextarea]);

	// Extract mention tokens (e.g., @alias and #cell references) and show them above the composer
	const mentionTokens = React.useMemo(() => {
		const tokens = new Set<string>();
		try {
			const atMatches = Array.from(value.matchAll(/@([^\s@]+)/g)).map(
				(m) => `@${m[1]}`
			);
			const hashMatches = Array.from(value.matchAll(/#([^\s#]+)/g)).map(
				(m) => `#${m[1]}`
			);
			for (const t of atMatches.concat(hashMatches)) {
				if (t.trim().length > 1) tokens.add(t);
			}
		} catch (_) {
			// ignore parse errors
		}
		return Array.from(tokens);
	}, [value]);

	return (
		<div className="chat-input-container">
			<MentionsBar $visible={mentionTokens.length > 0}>
				{mentionTokens.map((t) => (
					<MentionChip key={t} title={t}>
						{t}
					</MentionChip>
				))}
			</MentionsBar>
			<textarea
				value={value}
				onChange={handleTextareaChange}
				onKeyDown={handleKeyDownInternal}
				placeholder="Plan, analyze, or ask me anything"
				disabled={!!disabled || isLoading}
				rows={2}
				ref={textareaRef}
			/>

			<div className="chat-controls">
				<div className="chat-controls-left" style={{ display: "flex", gap: 8 }}>
					{/* Mode selector */}
					<Tooltip content="Select interaction mode" placement="top">
						<div
							className="pill pill-select"
							role="button"
							aria-haspopup="listbox"
							aria-expanded={showModeMenu}
							onMouseDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setShowModeMenu((s) => !s);
							}}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
							}}
						>
							<span>{mode}</span>
							<span className="caret">▾</span>
							{showModeMenu && (
								<div className="dropdown-menu" role="listbox">
									{(["Agent", "Ask"] as Array<"Agent" | "Ask">).map((m) => (
										<div
											key={m}
											role="option"
											aria-selected={m === mode}
											className={`dropdown-item ${m === mode ? "active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												e.stopPropagation();
												onModeChange && onModeChange(m);
												setShowModeMenu(false);
											}}
											onClick={(e) => {
												onModeChange && onModeChange(m);
												setShowModeMenu(false);
												e.stopPropagation();
											}}
										>
											{m}
										</div>
									))}
								</div>
							)}
						</div>
					</Tooltip>

					<Tooltip content="Select AI model" placement="top">
						<div
							className="pill pill-select"
							role="button"
							aria-haspopup="listbox"
							aria-expanded={showModelMenu}
							onMouseDown={(e) => {
								// Use mousedown to toggle once and avoid double toggle on click
								e.preventDefault();
								e.stopPropagation();
								console.log("[Composer] pill onMouseDown (toggle)", {
									target: (e.target as HTMLElement)?.className,
								});
								setShowModelMenu((s) => {
									const next = !s;
									console.log("[Composer] toggling showModelMenu ->", next);
									return next;
								});
							}}
							onClick={(e) => {
								// Do not toggle on click; just stop propagation
								e.preventDefault();
								e.stopPropagation();
								console.log("[Composer] pill onClick suppressed");
							}}
						>
							<span>{model}</span>
							<span className="caret">▾</span>
							{showModelMenu && (
								<div className="dropdown-menu" role="listbox">
									{models.map((m) => (
										<div
											key={m}
											role="option"
											aria-selected={m === model}
											className={`dropdown-item ${m === model ? "active" : ""}`}
											onMouseDown={(e) => {
												// Select on mousedown to avoid closing-open race
												e.preventDefault();
												e.stopPropagation();
												console.log("[Composer] menu item mousedown", {
													value: m,
												});
												applyModel(m);
												setShowModelMenu(false);
											}}
											onClick={(e) => {
												console.log("[Composer] menu item click", {
													value: m,
												});
												applyModel(m);
												setShowModelMenu(false);
												// prevent bubbling back to pill
												e.stopPropagation();
											}}
										>
											{m}
										</div>
									))}
								</div>
							)}
						</div>
					</Tooltip>
				</div>

				<Tooltip
					content={isProcessing ? "Stop generation" : "Send"}
					placement="left"
				>
					<button
						onClick={isProcessing ? onStop : onSend}
						disabled={
							!isProcessing && (!value.trim() || isLoading || !!disabled)
						}
						className={`send-button ${isProcessing ? "stop-mode" : ""}`}
					>
						{isProcessing ? (
							<FiSquare size={16} />
						) : isLoading ? (
							<div className="loading-dots">
								<span>•</span>
								<span>•</span>
								<span>•</span>
							</div>
						) : (
							<span
								style={{
									fontSize: "10px",
									fontWeight: "900",
									color: "#2d2d30",
								}}
							>
								▶
							</span>
						)}
					</button>
				</Tooltip>
			</div>
		</div>
	);
};
