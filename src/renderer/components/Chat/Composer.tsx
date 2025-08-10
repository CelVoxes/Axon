import React from "react";
import { FiSquare } from "react-icons/fi";
import { ConfigManager } from "../../services/ConfigManager";

interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	isProcessing: boolean;
	isLoading: boolean;
	disabled?: boolean;
	onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
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
}) => {
	const [model, setModel] = React.useState<string>(
		ConfigManager.getInstance().getDefaultModel()
	);
	const models = React.useMemo(
		() => ConfigManager.getInstance().getAvailableModels(),
		[]
	);

	const [showModelMenu, setShowModelMenu] = React.useState(false);
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const rafIdRef = React.useRef<number | null>(null);

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
			rafIdRef.current = requestAnimationFrame(() => {
				const maxHeight = 120;
				// Measure first without forcing multiple reflows
				el.style.height = "auto";
				const next = Math.min(el.scrollHeight, maxHeight);
				if (el.style.height !== `${next}px`) {
					el.style.height = `${next}px`;
				}
			});
		},
		[onChange]
	);

	return (
		<div className="chat-input-container">
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
				<div className="chat-controls-left">
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
						title="Select model"
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
				</div>

				<button
					onClick={isProcessing ? onStop : onSend}
					disabled={!isProcessing && (!value.trim() || isLoading || !!disabled)}
					className={`send-button ${isProcessing ? "stop-mode" : ""}`}
					title={isProcessing ? "Stop" : "Send"}
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
							style={{ fontSize: "10px", fontWeight: "900", color: "#2d2d30" }}
						>
							▶
						</span>
					)}
				</button>
			</div>
		</div>
	);
};
