import { useEffect, useRef, useCallback } from "react";
import { EventManager } from "../../../utils/EventManager";
import { ensureDisplayNewlines } from "../../../utils/CodeTextUtils";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationPrecheckEvent,
	CodeValidationErrorEvent,
	CodeValidationSuccessEvent,
	CodeValidationTimings,
} from "../../../services/types";

// LCS-based diff that shows minimal additions/removals (bounded for performance)
function generateFastDiff(
	prevNormalized: string,
	nextNormalized: string,
	addMessage: (
		content: string,
		isUser: boolean,
		code?: string,
		codeLanguage?: string,
		codeTitle?: string
	) => void
): void {
	const oldLines = prevNormalized.split("\n");
	const newLines = nextNormalized.split("\n");

	// Myers O(ND) diff for scalability
	const diffOps = myersOps(oldLines, newLines);

	const diffLines: string[] = [];
	for (const op of diffOps) {
		if (op.t === "+") diffLines.push(`+ ${op.s ?? ""}`);
		else if (op.t === "-") diffLines.push(`- ${op.s ?? ""}`);
		// skip unchanged to keep chat concise
	}

		if (diffLines.length > 0) {
			const diffBody = diffLines.join("\n");
			if (diffBody.trim().length > 0) {
				addMessage(
					"Lint auto-fix made changes:",
					false,
					diffBody,
					"diff",
					"Lint adjustments"
				);
		} else {
			const lengthDiff = nextNormalized.length - prevNormalized.length;
			const lineDiff =
				nextNormalized.split("\n").length - prevNormalized.split("\n").length;
			addMessage(
				`Lint auto-fix adjusted formatting (${
					lengthDiff > 0 ? "+" : ""
				}${lengthDiff} chars, ${lineDiff > 0 ? "+" : ""}${lineDiff} lines).`,
				false
			);
		}
		return;
	}

	// Fallback: texts differ but no visible per-line changes (edge cases)
	const lengthDiff = nextNormalized.length - prevNormalized.length;
	const lineDiff =
		nextNormalized.split("\n").length - prevNormalized.split("\n").length;
	addMessage(
		`Lint auto-fix adjusted formatting (${
			lengthDiff > 0 ? "+" : ""
		}${lengthDiff} chars, ${lineDiff > 0 ? "+" : ""}${lineDiff} lines).`,
		false
	);
}

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0ms";
	if (ms < 1) return `${ms.toFixed(2)}ms`;
	if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
	const seconds = ms / 1000;
	if (seconds < 10) return `${seconds.toFixed(2)}s`;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = seconds / 60;
	return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
}

function formatValidationTimings(
	timings?: CodeValidationTimings | null
): string | null {
	if (!timings) return null;
	const MIN_SEGMENT_MS = 5;
	const segments: string[] = [];

	const lintBreakdown = () => {
		const breakdown: string[] = [];
		const lint = timings.lintBreakdown;
		if (lint?.ruffMs && lint.ruffMs >= MIN_SEGMENT_MS) {
			breakdown.push(`ruff ${formatDuration(lint.ruffMs)}`);
		}
		if (lint?.llmMs && lint.llmMs >= MIN_SEGMENT_MS) {
			breakdown.push(`llm ${formatDuration(lint.llmMs)}`);
		}
		if (lint?.recheckMs && lint.recheckMs >= MIN_SEGMENT_MS) {
			breakdown.push(`recheck ${formatDuration(lint.recheckMs)}`);
		}
		return breakdown;
	};

	if (timings.lintMs > 0) {
		const base = `lint ${formatDuration(timings.lintMs)}`;
		const breakdown = lintBreakdown();
		segments.push(
			breakdown.length ? `${base} (${breakdown.join(", ")})` : base
		);
	}

	if (timings.enhancementMs >= MIN_SEGMENT_MS) {
		segments.push(`enhance ${formatDuration(timings.enhancementMs)}`);
	}

	if (timings.executionMs >= MIN_SEGMENT_MS) {
		segments.push(`exec ${formatDuration(timings.executionMs)}`);
	}

	if (timings.restMs >= MIN_SEGMENT_MS) {
		segments.push(`rest ${formatDuration(timings.restMs)}`);
	}

	segments.push(`total ${formatDuration(timings.totalMs)}`);

	return segments.join(" • ");
}

function myersOps(
	a: string[],
	b: string[]
): Array<{ t: " " | "+" | "-"; s: string }> {
	const N = a.length;
	const M = b.length;
	const max = N + M;
	const offset = max;
	const v: number[] = Array(2 * max + 1).fill(0);
	const trace: number[][] = [];

	let found = false;
	for (let D = 0; D <= max; D++) {
		for (let k = -D; k <= D; k += 2) {
			let x: number;
			if (k === -D || (k !== D && v[offset + k - 1] < v[offset + k + 1])) {
				x = v[offset + k + 1];
			} else {
				x = v[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < N && y < M && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= N && y >= M) {
				trace.push(v.slice());
				found = true;
				break;
			}
		}
		if (found) break;
		trace.push(v.slice());
	}

	// Backtrack to build ops
	const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
	let x = N;
	let y = M;
	for (let D = trace.length - 1; D >= 0; D--) {
		const vD = trace[D];
		const k = x - y;
		let prevK: number;
		if (k === -D || (k !== D && vD[offset + k - 1] < vD[offset + k + 1])) {
			prevK = k + 1; // insertion
		} else {
			prevK = k - 1; // deletion
		}
		const prevX = vD[offset + prevK];
		const prevY = prevX - prevK;

		// Diagonal (matches)
		while (x > prevX && y > prevY) {
			ops.push({ t: " ", s: a[x - 1] });
			x--;
			y--;
		}
		if (D > 0) {
			if (x === prevX) {
				ops.push({ t: "+", s: b[y - 1] });
				y--;
			} else {
				ops.push({ t: "-", s: a[x - 1] });
				x--;
			}
		}
	}

	return ops.reverse();
}

interface UseCodeGenerationEventsProps {
	analysisDispatch: any;
	setIsProcessing: (value: boolean) => void;
	setProgressMessage: (value: string) => void;
	setValidationErrors: (errors: string[]) => void;
	setValidationSuccessMessage: (message: string) => void;
	scheduleProcessingStop: (delayMs?: number) => void;
	cancelProcessingStop: () => void;
	enqueueStreamingUpdate?: (stepId: string, content: string) => void;
	addMessage: (
		content: string,
		isUser: boolean,
		code?: string,
		codeLanguage?: string,
		codeTitle?: string,
		suggestions?: any,
		status?: "pending" | "completed" | "failed",
		isStreaming?: boolean
	) => void;
}

export function useCodeGenerationEvents({
	analysisDispatch,
	setIsProcessing,
	setProgressMessage,
	setValidationErrors,
	setValidationSuccessMessage,
	scheduleProcessingStop,
	cancelProcessingStop,
	enqueueStreamingUpdate,
	addMessage,
}: UseCodeGenerationEventsProps) {
	const activeStreams = useRef<
		Map<
			string,
			{
				messageId: string;
				accumulatedCode: string;
				lastShownCode?: string;
				reasoningMessageId?: string;
				reasoningAccum?: string;
				validationTimings?: CodeValidationTimings;
			}
		>
	>(new Map());

	const updateGlobalStreamingFlag = useCallback(() => {
		// Toggle global streaming based on active streams
		analysisDispatch({
			type: "SET_STREAMING",
			payload: activeStreams.current.size > 0,
		});
	}, [analysisDispatch]);

	const handleCodeGenerationStarted = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationStartedEvent>;
			const { stepId, stepDescription } = customEvent.detail;
			const suppressCodePlaceholder = Boolean((customEvent.detail as any)?.suppressCodePlaceholder);

			try {
				console.log(
					`[Chat] ▶️ Starting code generation for: ${stepDescription || stepId}`
				);
			} catch (_) {}

			// Clear any lingering validation banners when a new generation starts
			setValidationErrors([]);
			setValidationSuccessMessage("");

			// Create new streaming message (merge with any prior placeholder)
			const messageId = `streaming-${stepId}`;
			const prev = (activeStreams.current.get(stepId) as any) || {};
            activeStreams.current.set(stepId, {
                messageId,
                accumulatedCode: prev.accumulatedCode || "",
                reasoningMessageId: prev.reasoningMessageId,
                reasoningAccum: prev.reasoningAccum,
                reasoningStartMs: prev.reasoningStartMs || Date.now(),
            } as any);

            // Ensure a reasoning placeholder exists so the UI can show
            // the compact "Thought for Xs >" header even before deltas arrive
            let stream = activeStreams.current.get(stepId) as any;
            if (!stream.reasoningMessageId) {
                stream.reasoningMessageId = `reasoning-${stepId}`;
                stream.reasoningAccum = '';
                stream.reasoningStartMs = Date.now();
                analysisDispatch({
                    type: 'ADD_MESSAGE',
                    payload: {
                        id: stream.reasoningMessageId,
                        content: '',
                        code: '',
                        codeLanguage: 'reasoning',
                        codeTitle: 'Thought',
                        isUser: false,
                        isStreaming: true,
                        status: 'pending' as any,
                    },
                });
            }

            if (!suppressCodePlaceholder) {
                analysisDispatch({
                    type: "ADD_MESSAGE",
                    payload: {
                        id: messageId,
                        content: "", // Start with empty content for streaming
                        code: "", // Ensure a CodeBlock mounts immediately
                        codeLanguage: "python",
                        isUser: false,
                        isStreaming: true,
                    },
                });
            }

			// Update progress + mark global streaming as active
			setIsProcessing(true);
			setProgressMessage(`Generating: ${stepDescription || "step"}`);
			// Also update analysis status so UI reflecting status prefers latest
			analysisDispatch({
				type: "SET_ANALYSIS_STATUS",
				payload: `Generating: ${stepDescription || "step"}`,
			});
			cancelProcessingStop();
			updateGlobalStreamingFlag();
		},
		[
			analysisDispatch,
			setIsProcessing,
			setProgressMessage,
			setValidationErrors,
			setValidationSuccessMessage,
			cancelProcessingStop,
			updateGlobalStreamingFlag,
		]
	);

	const handleCodeGenerationChunk = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationChunkEvent>;
			const { stepId } = customEvent.detail as any;

			const stream = activeStreams.current.get(stepId);
			if (!stream) return;

			// Prefer authoritative accumulatedCode from event (already cleaned of duplicate imports)
			let updated = (customEvent.detail as any)?.accumulatedCode as
				| string
				| undefined;
			if (typeof updated === "string") {
				stream.accumulatedCode = updated;
			} else {
				// Fallback: append chunk if accumulatedCode is not provided
				const chunk = (customEvent.detail as any)?.chunk || "";
				stream.accumulatedCode += chunk;
			}

			// Send raw code content for streaming (no markdown wrapping)
			if (enqueueStreamingUpdate) {
				enqueueStreamingUpdate(stepId, stream.accumulatedCode);
			}
		},
		[enqueueStreamingUpdate]
	);

	const handleCodeGenerationCompleted = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationCompletedEvent>;
			const { stepId, stepDescription, finalCode, success } =
				customEvent.detail;

			try {
				console.log(
					`[Chat] ✅ Code generation finished for: ${
						stepDescription || stepId
					} (len=${(finalCode || "").length}, success=${success})`
				);
			} catch (_) {}

			const stream = activeStreams.current.get(stepId);
			if (stream) {
				// Close reasoning stream message if present
				if (stream.reasoningMessageId) {
					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: stream.reasoningMessageId,
							updates: { isStreaming: false, status: "completed" as any },
						},
					});
				}
				// Close the streaming message
				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							code: finalCode,
							codeLanguage: "python",
							// Keep streaming indicator until validation success/error arrives
							isStreaming: true,
							status: "pending" as any,
						},
					},
				});

				// Track what we showed to compare later with validated code
				(stream as any).lastShownCode = finalCode;

				// Set a timeout fallback in case validation events never arrive
				const timeoutId = setTimeout(() => {
					if (activeStreams.current.has(stepId)) {
						console.warn(
							`Validation timeout for step ${stepId}, marking as completed without validation`
						);
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.messageId,
								updates: { isStreaming: false, status: "completed" as any },
							},
						});
						activeStreams.current.delete(stepId);
						updateGlobalStreamingFlag();
						if (activeStreams.current.size === 0) {
							setIsProcessing(false);
							setProgressMessage("");
						}
					}
				}, 30000); // 30 second timeout

				// Store timeout ID to cancel it if validation events arrive
				(stream as any).validationTimeoutId = timeoutId;
			}
		},
		[
			analysisDispatch,
			updateGlobalStreamingFlag,
			setIsProcessing,
			setProgressMessage,
		]
	);

	const handleValidationPrecheck = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeValidationPrecheckEvent>;
			const { errors = [], warnings = [], timings } = customEvent.detail;
			const errorCount = Array.isArray(errors) ? errors.length : 0;
			const warningList = Array.isArray(warnings) ? warnings : [];
			const warningCount = warningList.length;
			const timingsLabel = formatValidationTimings(timings);
			const summaryLines: string[] = [];
			summaryLines.push("```lint");
			if (errorCount === 0 && warningCount === 0) {
				summaryLines.push("PRECHECK: ✅ No lint issues detected");
			} else {
				const headerParts: string[] = [];
				if (errorCount) headerParts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
				if (warningCount) headerParts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
				summaryLines.push(`PRECHECK: ⚠️ ${headerParts.join(" and ")} found`);
				if (errorCount) {
					summaryLines.push("Errors:");
					summaryLines.push(errors.map((e: string) => `- ${e}`).join("\n"));
				}
			}
			if (warningCount) {
				summaryLines.push("Warnings:");
				summaryLines.push(warningList.map((w: string) => `- ${w}`).join("\n"));
			}
			if (timingsLabel) {
				summaryLines.push(`Timing: ${timingsLabel}`);
			}
			summaryLines.push("(Auto-fix will run next)");
			summaryLines.push("```");
			addMessage(summaryLines.join("\n"), false);
		},
		[addMessage]
	);

	const handleCodeGenerationFailed = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationFailedEvent>;
			const { stepId, stepDescription, error } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (stream) {
				if (stream.reasoningMessageId) {
					analysisDispatch({
						type: "UPDATE_MESSAGE",
						payload: {
							id: stream.reasoningMessageId,
							updates: { isStreaming: false, status: "failed" as any },
						},
					});
				}
				// Clear validation timeout if it exists since generation failed
				if ((stream as any).validationTimeoutId) {
					clearTimeout((stream as any).validationTimeoutId);
				}

				analysisDispatch({
					type: "UPDATE_MESSAGE",
					payload: {
						id: stream.messageId,
						updates: {
							content: `Code generation failed for: ${stepDescription}\n\nError: ${error}`,
							isStreaming: false,
							status: "failed" as any,
						},
					},
				});
				activeStreams.current.delete(stepId);
				updateGlobalStreamingFlag();
				if (activeStreams.current.size === 0) {
					scheduleProcessingStop(2500);
				}
			}
		},
		[analysisDispatch, updateGlobalStreamingFlag, scheduleProcessingStop]
	);

	const handleValidationError = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeValidationErrorEvent>;
			const {
				errors = [],
				warnings = [],
				originalCode,
				fixedCode,
				stepId,
				timings,
			} = customEvent.detail;

			const baseErrors = Array.isArray(errors) ? errors : [];
			const displayErrors = [...baseErrors];
			const timingsLabel = formatValidationTimings(timings);
			if (timingsLabel) {
				displayErrors.push(`Timing — ${timingsLabel}`);
			}

			// Set validation errors for display (UI will show them)
			setValidationSuccessMessage("");
			setValidationErrors(displayErrors);

			// Also post a chat message summarizing the errors with optional diff
			try {
				const warningList = Array.isArray(warnings) ? warnings : [];
				const errorCount = baseErrors.length;
				const warningCount = warningList.length;
				// Build collapsible lint block for chat using a custom "lint" fenced block
				let summary = "";
				summary += "```lint\n";
				summary += `LINT_SUMMARY: ⚠️ Found ${errorCount} error(s)${
					warningCount ? ` and ${warningCount} warning(s)` : ""
				}`;
				summary += "\n";
				if (errorCount) {
					summary += "Errors:\n";
					summary += baseErrors.map((e: string) => `- ${e}`).join("\n");
					summary += "\n";
				}
				if (warningCount) {
					summary += "Warnings:\n";
					summary += warningList.map((w: string) => `- ${w}`).join("\n");
					summary += "\n";
				}
				if (timingsLabel) {
					summary += `Timing: ${timingsLabel}\n`;
				}
				summary += "```";
				// Show lint summary and optional LCS diff
				addMessage(summary, false);

				if (
					originalCode &&
					fixedCode &&
					typeof originalCode === "string" &&
					typeof fixedCode === "string" &&
					originalCode.trim() !== fixedCode.trim()
				) {
					// Use LCS diff for validation errors too
					generateFastDiff(
						originalCode,
						fixedCode,
						(content, isUser, code, lang, title) => {
							addMessage(content, isUser, code, lang, title);
						}
					);
				}

				// Mark streaming message as completed now
				try {
					const stream = activeStreams.current.get(stepId as any);
					if (stream) {
						// Clear validation timeout if it exists
						if ((stream as any).validationTimeoutId) {
							clearTimeout((stream as any).validationTimeoutId);
						}
						(stream as any).validationTimings = timings;

						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.messageId,
								updates: { isStreaming: false, status: "failed" as any },
							},
						});
						activeStreams.current.delete(customEvent.detail.stepId as any);
						updateGlobalStreamingFlag();
						if (activeStreams.current.size === 0) {
							setIsProcessing(false);
							setProgressMessage("");
						}
					}
				} catch (_) {}
			} catch (_) {
				// Ignore chat summary failures
			}
		},
		[
			setValidationSuccessMessage,
			setValidationErrors,
			analysisDispatch,
			updateGlobalStreamingFlag,
			setIsProcessing,
			setProgressMessage,
		]
	);

	const handleValidationSuccess = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeValidationSuccessEvent>;
			const { stepId, message, code, timings } = customEvent.detail;
			// Clear any previous errors/warnings when lints pass
			setValidationErrors([]);
			const baseMessage = typeof message === "string" ? message.trim() : "";
			const timingsLabel = formatValidationTimings(timings);
			const finalMessage = (() => {
				if (timingsLabel && baseMessage) return `${baseMessage} — ${timingsLabel}`;
				if (timingsLabel) return `Timing — ${timingsLabel}`;
				return baseMessage || "No linter errors found";
			})();
			setValidationSuccessMessage(finalMessage.trim());
			// Skip adding lint success message to reduce chat clutter
			const warningList = Array.isArray(customEvent.detail.warnings)
				? customEvent.detail.warnings
				: [];
			try {
				const summaryLines: string[] = [];
				summaryLines.push("```lint");
				if (warningList.length > 0) {
					summaryLines.push(
						`LINT_SUMMARY: ⚠️ No errors, ${warningList.length} warning(s)`
					);
					summaryLines.push("Warnings:");
					summaryLines.push(
						warningList.map((w: string) => `- ${w}`).join("\n")
					);
				} else {
					summaryLines.push("LINT_SUMMARY: ✅ No errors or warnings");
				}
				if (timingsLabel) {
					summaryLines.push(`Timing: ${timingsLabel}`);
				}
				summaryLines.push("```");
				addMessage(summaryLines.join("\n"), false);
			} catch (_) {}
			// Do not attach validated code to chat (to reduce clutter)

			// Mark streaming message as completed now
			try {
				const stream = activeStreams.current.get(stepId);
				if (stream) {
					// Clear validation timeout if it exists
					if ((stream as any).validationTimeoutId) {
						clearTimeout((stream as any).validationTimeoutId);
					}
					(stream as any).validationTimings = timings;

					// If validated code is provided and differs, show a fast summary
					if (
						typeof code === "string" &&
						code.length > 0 &&
						stream.lastShownCode
					) {
						const prev = (stream as any).lastShownCode || "";
						const next = code;

						// Fast comparison: normalize and check if different
						const prevNormalized = prev.trim().replace(/\r\n/g, "\n");
						const nextNormalized = next.trim().replace(/\r\n/g, "\n");

						if (prevNormalized !== nextNormalized) {
							// Use LCS-based diff that shows actual changes
							generateFastDiff(prevNormalized, nextNormalized, addMessage);

							analysisDispatch({
								type: "UPDATE_MESSAGE",
								payload: {
									id: stream.messageId,
									updates: {
										code: next,
										codeLanguage: "python",
										isStreaming: false,
										status: "completed" as any,
									},
								},
							});
							(stream as any).lastShownCode = next;
						} else {
							analysisDispatch({
								type: "UPDATE_MESSAGE",
								payload: {
									id: stream.messageId,
									updates: { isStreaming: false, status: "completed" as any },
								},
							});
						}
					} else {
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.messageId,
								updates: { isStreaming: false, status: "completed" as any },
							},
						});
					}
                        // Also finalize reasoning timer if present
                        try {
                            if (stream.reasoningMessageId) {
                                const startMs = (stream as any).reasoningStartMs || Date.now();
                                const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
                                analysisDispatch({
                                    type: 'UPDATE_MESSAGE',
                                    payload: {
                                        id: stream.reasoningMessageId,
                                        updates: { isStreaming: false, status: 'completed' as any, reasoningSeconds: secs },
                                    },
                                });
                            }
                        } catch (_) {}

                        activeStreams.current.delete(stepId);
					updateGlobalStreamingFlag();
					if (activeStreams.current.size === 0) {
						scheduleProcessingStop(2500);
					}
				}
			} catch (_) {}
		},
		[
			setValidationErrors,
			setValidationSuccessMessage,
			analysisDispatch,
			updateGlobalStreamingFlag,
			scheduleProcessingStop,
		]
	);

	useEffect(() => {
		let isMounted = true;

		const wrappedHandlers = {
			handleCodeGenerationStarted: (event: Event) => {
				if (isMounted) handleCodeGenerationStarted(event);
			},
			handleCodeGenerationChunk: (event: Event) => {
				if (isMounted) handleCodeGenerationChunk(event);
			},
			handleCodeGenerationCompleted: (event: Event) => {
				if (isMounted) handleCodeGenerationCompleted(event);
			},
			handleCodeGenerationReasoning: (event: Event) => {
				if (!isMounted) return;
				try {
					const custom = event as CustomEvent<{
						stepId: string;
						delta: string;
					}>;
					const stepId = (custom.detail as any)?.stepId as string;
					const delta = (custom.detail as any)?.delta as string;
					if (!stepId || typeof delta !== "string" || delta.length === 0)
						return;
					let stream = activeStreams.current.get(stepId) as any;
            if (!stream) {
                // Create a placeholder so reasoning can appear before code starts
                stream = { messageId: "", accumulatedCode: "", reasoningStartMs: Date.now() } as any;
                activeStreams.current.set(stepId, stream);
						// Mark as processing so the UI shows the three-dot animation
						setIsProcessing(true);
						setProgressMessage("Planning…");
						updateGlobalStreamingFlag();
					}
					if (!stream.reasoningMessageId) {
						stream.reasoningMessageId = `reasoning-${stepId}`;
						stream.reasoningAccum = "";
						(stream as any).reasoningStartMs = (stream as any).reasoningStartMs || Date.now();
						analysisDispatch({
							type: "ADD_MESSAGE",
							payload: {
								id: stream.reasoningMessageId,
								content: "",
								code: `${delta}`,
								codeLanguage: "reasoning",
								codeTitle: "Thought",
								isUser: false,
								isStreaming: true,
								status: "pending" as any,
							},
						});
					} else {
						stream.reasoningAccum = (stream.reasoningAccum || "") + delta;
						analysisDispatch({
							type: "UPDATE_MESSAGE",
							payload: {
								id: stream.reasoningMessageId,
								updates: {
									code: (stream.reasoningAccum || ""),
									codeLanguage: "reasoning",
									isStreaming: true,
									status: "pending" as any,
								},
							},
						});
					}
				} catch (_) {}
			},
            handleCodeGenerationSummary: (event: Event) => {
                if (!isMounted) return;
                try {
                    const custom = event as CustomEvent<{ stepId: string; summary: string }>;
                    const stepId = (custom.detail as any)?.stepId as string;
                    const text = (custom.detail as any)?.summary || "";
                    // Do not add a separate summary message; only finalize the thought timer
                    // Stop the reasoning timer by marking the reasoning message as completed and persist duration
                    const stream = activeStreams.current.get(stepId) as any;
                    if (stream && stream.reasoningMessageId) {
                        const startMs = (stream as any).reasoningStartMs || Date.now();
                        const secs = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
                        analysisDispatch({
                            type: 'UPDATE_MESSAGE',
                            payload: {
                                id: stream.reasoningMessageId,
                                updates: { isStreaming: false, status: 'completed' as any, reasoningSeconds: secs },
                            },
                        });
                    }
                } catch (_) {}
            },
			handleCodeGenerationFailed: (event: Event) => {
				if (isMounted) handleCodeGenerationFailed(event);
			},
			handleValidationPrecheck: (event: Event) => {
				if (isMounted) handleValidationPrecheck(event);
			},
			handleValidationError: (event: Event) => {
				if (isMounted) handleValidationError(event);
			},
			handleValidationSuccess: (event: Event) => {
				if (isMounted) handleValidationSuccess(event);
			},
		};

		// Add event listeners
		EventManager.addEventListener(
			"code-generation-started",
			wrappedHandlers.handleCodeGenerationStarted
		);
		EventManager.addEventListener(
			"code-generation-chunk",
			wrappedHandlers.handleCodeGenerationChunk
		);
		EventManager.addEventListener(
			"code-generation-completed",
			wrappedHandlers.handleCodeGenerationCompleted
		);
		EventManager.addEventListener(
			"code-generation-reasoning",
			wrappedHandlers.handleCodeGenerationReasoning
		);
		EventManager.addEventListener(
			"code-generation-summary",
			wrappedHandlers.handleCodeGenerationSummary
		);
		EventManager.addEventListener(
			"code-generation-failed",
			wrappedHandlers.handleCodeGenerationFailed
		);
		EventManager.addEventListener(
			"code-validation-precheck",
			wrappedHandlers.handleValidationPrecheck
		);
		EventManager.addEventListener(
			"code-validation-error",
			wrappedHandlers.handleValidationError
		);
		EventManager.addEventListener(
			"code-validation-success",
			wrappedHandlers.handleValidationSuccess
		);

		return () => {
			isMounted = false;
			EventManager.removeEventListener(
				"code-generation-started",
				wrappedHandlers.handleCodeGenerationStarted
			);
			EventManager.removeEventListener(
				"code-generation-chunk",
				wrappedHandlers.handleCodeGenerationChunk
			);
			EventManager.removeEventListener(
				"code-generation-completed",
				wrappedHandlers.handleCodeGenerationCompleted
			);
			EventManager.removeEventListener(
				"code-generation-reasoning",
				wrappedHandlers.handleCodeGenerationReasoning
			);
			EventManager.removeEventListener(
				"code-generation-summary",
				wrappedHandlers.handleCodeGenerationSummary
			);
			EventManager.removeEventListener(
				"code-generation-failed",
				wrappedHandlers.handleCodeGenerationFailed
			);
			EventManager.removeEventListener(
				"code-validation-precheck",
				wrappedHandlers.handleValidationPrecheck
			);
			EventManager.removeEventListener(
				"code-validation-error",
				wrappedHandlers.handleValidationError
			);
			EventManager.removeEventListener(
				"code-validation-success",
				wrappedHandlers.handleValidationSuccess
			);
		};
	}, [
		handleCodeGenerationStarted,
		handleCodeGenerationChunk,
		handleCodeGenerationCompleted,
		handleCodeGenerationFailed,
		handleValidationPrecheck,
		handleValidationError,
		handleValidationSuccess,
	]);

	return {
		activeStreams: activeStreams.current,
	};
}
