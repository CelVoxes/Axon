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
}

export const Composer: React.FC<ComposerProps> = ({
	value,
	onChange,
	onSend,
	onStop,
	isProcessing,
	isLoading,
	disabled,
}) => {
	const [model, setModel] = React.useState<string>(
		ConfigManager.getInstance().getDefaultModel()
	);
	const models = React.useMemo(
		() => ConfigManager.getInstance().getAvailableModels(),
		[]
	);

	const [showModelMenu, setShowModelMenu] = React.useState(false);

	const applyModel = (next: string) => {
		console.log("[Composer] applyModel ->", next);
		setModel(next);
		ConfigManager.getInstance().setValue(
			"analysis",
			"defaultModel",
			next as any
		);
	};

	// Debug: log lifecycle and state changes
	React.useEffect(() => {
		console.log("[Composer] mounted");
	}, []);

	React.useEffect(() => {
		console.log("[Composer] showModelMenu:", showModelMenu);
	}, [showModelMenu]);

	// Note: do not auto-close on outside click to avoid conflicts with
	// React synthetic event ordering. Menu closes on selection or toggle.
	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSend();
		}
	};

	const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		onChange(e.target.value);
		// Auto-resize textarea
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
	};

	return (
		<div className="chat-input-container">
			<textarea
				value={value}
				onChange={handleTextareaChange}
				onKeyPress={handleKeyPress}
				placeholder="Plan, analyze, or ask me anything"
				disabled={!!disabled || isLoading}
				rows={2}
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
