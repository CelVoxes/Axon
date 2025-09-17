import React from "react";
import { EventManager } from "../../utils/EventManager";
import styled from "styled-components";
import { FiSquare, FiFolder, FiX } from "react-icons/fi";
import { getFileTypeIcon } from "../shared/utils";
import { ConfigManager } from "../../services/backend/ConfigManager";
import { Tooltip } from "@components/shared/Tooltip";

// Define styled components at module scope to avoid dynamic creation warnings
const MentionsBar = styled.div<{ $visible: boolean }>`
	display: ${(p) => (p.$visible ? "flex" : "none")};
	flex-wrap: wrap;

	background: #2d2d30;
	max-height: 72px;
	overflow-y: auto;
`;

const MentionChip = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 2px 6px;
	border-radius: 5px;
	font-size: 11px;
	line-height: 14px;
	background: #333;
	color: #e5e7eb;
`;

const TextareaWrapper = styled.div`
	position: relative;
	background: #1e1e1e;
	border: 1px solid #6c6c6c;
	border-radius: 6px;
	overflow: hidden;
`;

const HighlightOverlay = styled.div`
	position: absolute;
	inset: 0;
	padding: 8px 12px;
	pointer-events: none;
	font-family: inherit;
	font-size: var(--font-size-base);
	line-height: 1.4;
	white-space: pre-wrap;
	word-break: break-word;
	color: transparent;
	-webkit-text-fill-color: transparent;
	z-index: 1;
	background: transparent;
	min-height: 72px;
`;

const StyledTextarea = styled.textarea`
	position: relative;
	z-index: 2;
	width: 100%;
	background: transparent;
	border: none;
	color: #d4d4d4;
	-webkit-text-fill-color: #d4d4d4;
	caret-color: #d4d4d4;
	padding: 8px 12px;
	font-size: var(--font-size-base);
	font-family: inherit;
	resize: none;
	min-height: 72px;
	max-height: 120px;
	line-height: 1.4;
	box-sizing: border-box;

	&:focus {
		outline: none;
	}

	&::placeholder {
		color: #858585;
	}
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
	suggestedMentions?: Array<{ label: string; alias: string }>;
	onInsertAlias?: (alias: string) => void;
	// LLM session id used to show context window usage
	sessionId?: string;
}

export interface ComposerRef {
	focus: () => void;
}

export const Composer = React.forwardRef<ComposerRef, ComposerProps>(
	(
		{
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
			suggestedMentions = [],
			onInsertAlias,
			sessionId,
		},
		ref
	) => {
		const [model, setModel] = React.useState<string>(
			ConfigManager.getInstance().getDefaultModel()
		);
    const [models, setModels] = React.useState<string[]>(
        ConfigManager.getInstance().getAvailableModels()
    );

    // Fetch models/default from backend to avoid duplication and keep in sync
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { BackendClient } = await import("../../services/backend/BackendClient");
                const bc = new BackendClient();
                const conf = await bc.getLLMConfig();
                if (!conf) return;
                if (cancelled) return;
                // Update models list from backend
                if (Array.isArray(conf.available_models) && conf.available_models.length > 0) {
                    setModels(conf.available_models);
                    // Also migrate ConfigManager so other parts stay consistent
                    const cm = ConfigManager.getInstance();
                    cm.setValue("analysis", "defaultModel", (conf.default_model || cm.getDefaultModel()) as any);
                    // Persist backend-provided models list
                    (cm as any).config.analysis.availableModels = conf.available_models as any;
                }
                // Update selected model if backend specifies a different default
                if (typeof conf.default_model === 'string' && conf.default_model && conf.default_model !== model) {
                    setModel(conf.default_model);
                }
            } catch (e) {
                // Ignore; use local defaults
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

		const [showModelMenu, setShowModelMenu] = React.useState(false);
		const [showModeMenu, setShowModeMenu] = React.useState(false);
		const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
		const modelMenuRef = React.useRef<HTMLDivElement>(null);
		const modeMenuRef = React.useRef<HTMLDivElement>(null);

		// Expose focus method via ref
		React.useImperativeHandle(
			ref,
			() => ({
				focus: () => {
					textareaRef.current?.focus();
				},
			}),
			[]
		);

		// Close menus when clicking outside
		React.useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				const target = event.target as Node;

				// Close model menu if clicking outside
				if (
					showModelMenu &&
					modelMenuRef.current &&
					!modelMenuRef.current.contains(target)
				) {
					setShowModelMenu(false);
				}

				// Close mode menu if clicking outside
				if (
					showModeMenu &&
					modeMenuRef.current &&
					!modeMenuRef.current.contains(target)
				) {
					setShowModeMenu(false);
				}
			};

			document.addEventListener("mousedown", handleClickOutside);
			return () => {
				document.removeEventListener("mousedown", handleClickOutside);
			};
		}, [showModelMenu, showModeMenu]);
		const rafIdRef = React.useRef<number | null>(null);
		const [hoveredMention, setHoveredMention] = React.useState<string | null>(
			null
		);

		// Insert an "@" mention trigger above the composer to show available items
		const handleOpenMentions = React.useCallback(() => {
			const alreadyInMention = /@([^\s@]*)$/.test(value);
			const nextValue = alreadyInMention
				? value
				: value + (value.length === 0 || value.endsWith(" ") ? "" : " ") + "@";
			onChange(nextValue);
			// Focus textarea after updating
			requestAnimationFrame(() => {
				textareaRef.current?.focus();
			});
		}, [value, onChange]);

		const handleInsertAlias = React.useCallback(
			(alias: string) => {
				if (onInsertAlias) {
					onInsertAlias(alias);
					return;
				}
				// Fallback: insert locally and focus
				const needsSpace = value.length > 0 && !value.endsWith(" ");
				const next = `${value}${needsSpace ? " " : ""}${alias} `;
				onChange(next);
				requestAnimationFrame(() => textareaRef.current?.focus());
			},
			[value, onChange, onInsertAlias]
		);

		const escapeRegExp = (s: string) =>
			s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		const removeMention = React.useCallback(
			(alias: string) => {
				const esc = escapeRegExp(alias);
				// Match start or whitespace before, and whitespace or end after
				const re = new RegExp(`(^|\\s)@${esc}(?=\\s|$)`, "g");
				let next = value.replace(re, (m, p1) => p1);
				// Collapse repeated spaces introduced by removal
				next = next.replace(/\s{2,}/g, " ");
				onChange(next);
			},
			[value, onChange]
		);

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

		// Debounced mention token calculation to avoid expensive regex on every keystroke
		const [mentionTokens, setMentionTokens] = React.useState<string[]>([]);
		const [mentionedFileAliases, setMentionedFileAliases] = React.useState<
			string[]
		>([]);
		const mentionDebounceRef = React.useRef<NodeJS.Timeout | null>(null);

		React.useEffect(() => {
			if (mentionDebounceRef.current) {
				clearTimeout(mentionDebounceRef.current);
			}

			mentionDebounceRef.current = setTimeout(() => {
				// Extract mention tokens (e.g., @alias and #cell references)
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
				setMentionTokens(Array.from(tokens));

				// Aliases explicitly mentioned with @ in the composer (without the leading @)
				const seen = new Set<string>();
				const list: string[] = [];
				try {
					for (const m of value.matchAll(/@([^\s@]+)/g)) {
						const alias = String(m[1] || "").trim();
						if (alias && !seen.has(alias)) {
							seen.add(alias);
							list.push(alias);
						}
					}
				} catch (_) {}
				setMentionedFileAliases(list);
			}, 100); // 100ms debounce for regex operations

			return () => {
				if (mentionDebounceRef.current) {
					clearTimeout(mentionDebounceRef.current);
				}
			};
		}, [value]);

		// Context window usage indicator state
		const [ctxUsage, setCtxUsage] = React.useState<{
			approxTokens: number;
			limitTokens: number;
			nearLimit: boolean;
		} | null>(null);

		// Lazy-load BackendClient to query session stats
		const backendRef = React.useRef<any>(null);
		React.useEffect(() => {
			let interval: any;
			(async () => {
				try {
					const { BackendClient } = await import(
						"../../services/backend/BackendClient"
					);
					backendRef.current = new BackendClient();
				} catch (e) {
					backendRef.current = null;
				}
				const fetchStats = async () => {
					if (!sessionId || !backendRef.current) {
						setCtxUsage(null);
						return;
					}
					try {
						const s = await backendRef.current.getSessionStats(sessionId);
						setCtxUsage({
							approxTokens: Number(s?.approx_tokens || 0),
							limitTokens: Number(s?.limit_tokens || 128000),
							nearLimit: Boolean(s?.near_limit),
						});
					} catch (_) {
						// ignore errors
					}
				};
				// Initial fetch and polling
				fetchStats();
				interval = setInterval(fetchStats, 3000);

				// Event-driven refresh on session activity (no polling delay)
				EventManager.addEventListener("session-stats-updated", (event: any) => {
					try {
						const detail = (event as CustomEvent).detail as any;
						if (!detail || !detail.sessionId || !detail.stats) return;
						if (detail.sessionId !== sessionId) return;
						setCtxUsage({
							approxTokens: Number(detail.stats?.approx_tokens || 0),
							limitTokens: Number(detail.stats?.limit_tokens || 128000),
							nearLimit: Boolean(detail.stats?.near_limit),
						});
					} catch (_) {}
				});
			})();

			return () => {
				if (interval) clearInterval(interval);
			};
		}, [sessionId]);

		const usagePercent = React.useMemo(() => {
			if (!ctxUsage) return 0;
			const pct =
				ctxUsage.limitTokens > 0
					? Math.min(
							100,
							Math.max(0, (ctxUsage.approxTokens / ctxUsage.limitTokens) * 100)
					  )
					: 0;
			return pct;
		}, [ctxUsage]);

		const usageColor = React.useMemo(() => {
			const pct = usagePercent;
			if (pct >= 85) return "#ef4444"; // red
			if (pct >= 60) return "#f59e0b"; // amber
			return "#10b981"; // green
		}, [usagePercent]);

		const highlightMarkup = React.useMemo(() => {
			if (!value) {
				return "&nbsp;";
			}
			const escapeHtml = (input: string) =>
				input
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;");

			let html = escapeHtml(value);
			html = html.replace(/\r\n|\r|\n/g, "<br />");
			html = html.replace(/(@[^\s@]+)/g, '<span class="composer-tag">$1</span>');
			html = html.replace(/(#[^\s#]+)/g, '<span class="composer-tag">$1</span>');
			return html;
		}, [value]);

		return (
			<div className="chat-input-container">
				{/* Top actions above composer */}
				<div
					style={{
						display: "flex",
						justifyContent: "flex-start",
						marginBottom: 8,
					}}
				>
					<Tooltip
						content="Insert a mention (@) to add files, data, or cells"
						placement="top"
					>
						<div
							className="pill pill-select"
							role="button"
							aria-label="Insert @ mention"
							onMouseDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								handleOpenMentions();
							}}
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
							}}
						>
							<span style={{ fontWeight: 700 }}>@</span>
						</div>
					</Tooltip>

					{/* Mentioned files (from current input) */}
					<div
						style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 6 }}
					>
						{mentionedFileAliases.map((alias) => {
							const label = alias.split("/").pop() || alias;
							const isDir = alias.endsWith("/") || !label.includes(".");
							return (
								<MentionChip
									key={`m-${alias}`}
									title={alias}
									style={{ cursor: "default" }}
									onMouseEnter={() => setHoveredMention(alias)}
									onMouseLeave={() =>
										setHoveredMention((prev) => (prev === alias ? null : prev))
									}
								>
									<span
										style={{
											display: "inline-flex",
											alignItems: "center",
											opacity: 0.85,
											fontSize: 12,
										}}
									>
										{hoveredMention === alias ? (
											<span
												role="button"
												aria-label={`Remove ${alias}`}
												onMouseDown={(e) => {
													e.preventDefault();
													e.stopPropagation();
													removeMention(alias);
												}}
												style={{ display: "inline-flex", alignItems: "center" }}
											>
												<FiX size={12} />
											</span>
										) : isDir ? (
											<FiFolder size={12} />
										) : (
											getFileTypeIcon(label)
										)}
									</span>
									<span style={{ fontSize: 11 }}>{label}</span>
								</MentionChip>
							);
						})}

						{/* Quick add suggestions */}
						{suggestedMentions.slice(0, 6).map((s) => (
							<MentionChip
								key={s.alias}
								onMouseDown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									handleInsertAlias(s.alias);
								}}
								title={s.alias}
								style={{ cursor: "pointer", fontSize: 11, padding: "2px 6px" }}
							>
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										opacity: 0.8,
									}}
								>
									<span style={{ fontSize: 12 }}>
										{(() => {
											const label = s.alias.split("/").pop() || s.alias;
											const isDir =
												s.alias.endsWith("/") || !label.includes(".");
											return isDir ? (
												<FiFolder size={12} />
											) : (
												getFileTypeIcon(label)
											);
										})()}
									</span>
								</span>
								<span style={{ fontSize: 11 }}>{s.label}</span>
							</MentionChip>
						))}
					</div>
				</div>
				<MentionsBar $visible={false} />
				<TextareaWrapper className="composer-textarea-wrapper">
					<HighlightOverlay
						className="composer-highlight"
						aria-hidden="true"
						dangerouslySetInnerHTML={{ __html: highlightMarkup }}
					/>
					<StyledTextarea
						value={value}
						onChange={handleTextareaChange}
						onKeyDown={handleKeyDownInternal}
						placeholder={
							mode === "Ask" ? "Ask a question" : "Plan, search, build anything"
						}
						disabled={!!disabled || isLoading}
						rows={2}
						ref={textareaRef}
					/>
				</TextareaWrapper>

				<div className="chat-controls">
					<div
						className="chat-controls-left"
						style={{ display: "flex", gap: 8 }}
					>
						{/* Mode selector */}
						<Tooltip content="Select interaction mode" placement="top">
							<div
								ref={modeMenuRef}
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
												className={`dropdown-item ${
													m === mode ? "active" : ""
												}`}
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
								ref={modelMenuRef}
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
												className={`dropdown-item ${
													m === model ? "active" : ""
												}`}
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

					{/* Right-side cluster: context usage + send/stop button */}
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						{sessionId && ctxUsage ? (
							<Tooltip
								content={`${ctxUsage.approxTokens.toLocaleString()} / ${ctxUsage.limitTokens.toLocaleString()} tokens`}
								placement="top"
							>
								<div
									aria-label="Context usage"
									role="img"
									title="Context window usage"
									style={{
										width: 22,
										height: 22,
										borderRadius: "50%",
										// Grayish ring
										background: `conic-gradient(#888 ${usagePercent}%,rgb(65, 65, 65) ${usagePercent}%)`,
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										color: "#777777",
										fontSize: 10,
										fontWeight: 700,
										boxShadow: "none",
									}}
								>
									<span style={{ transform: "scale(0.9)" }}>
										{Math.round(usagePercent)}%
									</span>
								</div>
							</Tooltip>
						) : null}

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
										fontWeight: 900,
										color: "#2d2d30",
									}}
								>
									▶
								</span>
							)}
						</button>
					</div>
				</div>
			</div>
		);
	}
);

// Add display name for better debugging
Composer.displayName = "Composer";
