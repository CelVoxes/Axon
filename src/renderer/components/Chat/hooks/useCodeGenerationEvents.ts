import { useEffect, useRef, useCallback } from "react";
import { EventManager } from "../../../utils/EventManager";
import {
	CodeGenerationStartedEvent,
	CodeGenerationChunkEvent,
	CodeGenerationCompletedEvent,
	CodeGenerationFailedEvent,
	CodeValidationErrorEvent,
} from "../../../services/types";

interface UseCodeGenerationEventsProps {
	analysisDispatch: any;
	setIsProcessing: (value: boolean) => void;
	setProgressMessage: (value: string) => void;
	setValidationErrors: (errors: string[]) => void;
	setValidationSuccessMessage: (message: string) => void;
	scheduleProcessingStop: (delayMs?: number) => void;
	cancelProcessingStop: () => void;
	enqueueStreamingUpdate: (stepId: string, content: string) => void;
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
		Map<string, { messageId: string; accumulatedCode: string; lastShownCode?: string }>
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

			// Clear any lingering validation banners when a new generation starts
			setValidationErrors([]);
			setValidationSuccessMessage("");

			// Create new streaming message
			const messageId = `streaming-${stepId}`;
			activeStreams.current.set(stepId, { messageId, accumulatedCode: "" });

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

			// Update progress + mark global streaming as active
			setIsProcessing(true);
			setProgressMessage(`Generating: ${stepDescription || "step"}`);
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
			const updated = (customEvent.detail as any)?.accumulatedCode;
			if (typeof updated === "string") {
				stream.accumulatedCode = updated;
			} else {
				// Fallback: append chunk if accumulatedCode is not provided
				const chunk = (customEvent.detail as any)?.chunk || "";
				stream.accumulatedCode += chunk;
			}

			// Send raw code content for streaming (no markdown wrapping)
			enqueueStreamingUpdate(stepId, stream.accumulatedCode);
		},
		[enqueueStreamingUpdate]
	);

	const handleCodeGenerationCompleted = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationCompletedEvent>;
			const { stepId, stepDescription, finalCode, success } =
				customEvent.detail;

    const stream = activeStreams.current.get(stepId);
    if (stream) {
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

	const handleCodeGenerationFailed = useCallback(
		(event: Event) => {
			const customEvent = event as CustomEvent<CodeGenerationFailedEvent>;
			const { stepId, stepDescription, error } = customEvent.detail;

			const stream = activeStreams.current.get(stepId);
			if (stream) {
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
			const { errors, warnings, originalCode, fixedCode, stepId } =
				customEvent.detail as any;

			// Set validation errors for display (UI will show them)
			setValidationSuccessMessage("");
			setValidationErrors(errors);

			// Also post a chat message summarizing the errors with optional diff
			try {
				const errorCount = errors?.length || 0;
				const warningCount = warnings?.length || 0;
				// Build collapsible lint block for chat using a custom "lint" fenced block
				let summary = "";
				summary += "```lint\n";
				summary += `LINT_SUMMARY: ⚠️ Found ${errorCount} error(s)${
					warningCount ? ` and ${warningCount} warning(s)` : ""
				}`;
				summary += "\n";
				if (errorCount) {
					summary += "Errors:\n";
						summary += errors.map((e: string) => `- ${e}`).join("\n");
					summary += "\n";
				}
				if (warningCount) {
					summary += "Warnings:\n";
						summary += warnings.map((w: string) => `- ${w}`).join("\n");
					summary += "\n";
				}
				summary += "```";
				// Build a separate diff block message for proper highlighting via CodeBlock
				if (
					originalCode &&
					fixedCode &&
					typeof originalCode === "string" &&
					typeof fixedCode === "string"
				) {
					const oldLines = originalCode.split("\n");
					const newLines = fixedCode.split("\n");
					const m = oldLines.length;
					const n = newLines.length;
					const lcs: number[][] = Array.from({ length: m + 1 }, () =>
						Array(n + 1).fill(0)
					);
					for (let i = 1; i <= m; i++) {
						for (let j = 1; j <= n; j++) {
							lcs[i][j] =
								oldLines[i - 1] === newLines[j - 1]
									? lcs[i - 1][j - 1] + 1
									: Math.max(lcs[i - 1][j], lcs[i][j - 1]);
						}
					}
					const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
					let i = m,
						j = n;
					while (i > 0 || j > 0) {
						if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
							ops.push({ t: " ", s: oldLines[i - 1] });
							i--;
							j--;
						} else if (j > 0 && (i === 0 || lcs[i][j - 1] > lcs[i - 1][j])) {
							ops.push({ t: "+", s: newLines[j - 1] });
							j--;
						} else if (i > 0) {
							ops.push({ t: "-", s: oldLines[i - 1] });
							i--;
						}
					}
					ops.reverse();
					const diffBody = ops
						.map((o) => (o.t === " " ? `  ${o.s}` : `${o.t} ${o.s}`))
						.join("\n");
					// Post lint summary (text), then a highlighted diff block
					addMessage(summary, false);
					addMessage(
						"Validation changes",
						false,
						diffBody,
						"diff",
						"Diff vs generated"
					);
				} else {
					addMessage(summary, false);
				}
				
				// Mark streaming message as completed now
				try {
					const stream = activeStreams.current.get(
						customEvent.detail.stepId as any
					);
					if (stream) {
						// Clear validation timeout if it exists
						if ((stream as any).validationTimeoutId) {
							clearTimeout((stream as any).validationTimeoutId);
						}

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
			const customEvent = event as CustomEvent<{
				stepId: string;
				message?: string;
			}>;
			const { message, stepId, code } = (customEvent.detail as any) || {};
			// Clear any previous errors/warnings when lints pass
			setValidationErrors([]);
			setValidationSuccessMessage(message || "No linter errors found");
			// Skip adding lint success message to reduce chat clutter
			// Do not attach validated code to chat (to reduce clutter)

			// Mark streaming message as completed now
			try {
				const stream = activeStreams.current.get(stepId);
				if (stream) {
					// Clear validation timeout if it exists
					if ((stream as any).validationTimeoutId) {
						clearTimeout((stream as any).validationTimeoutId);
					}


					// If validated code is provided and differs, show a highlighted diff and update code block
					if (typeof code === "string" && code.length > 0) {
						const prev = (stream as any).lastShownCode || "";
						const next = code;
						if (prev !== next) {
							const oldLines = prev.split("\n");
							const newLines = next.split("\n");
							const m = oldLines.length;
							const n = newLines.length;
							const lcs: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
							for (let i = 1; i <= m; i++) {
								for (let j = 1; j <= n; j++) {
									lcs[i][j] = oldLines[i - 1] === newLines[j - 1]
										? lcs[i - 1][j - 1] + 1
										: Math.max(lcs[i - 1][j], lcs[i][j - 1]);
								}
							}
							const ops: Array<{ t: " " | "+" | "-"; s: string }> = [];
							let i = m, j = n;
							while (i > 0 || j > 0) {
								if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
									ops.push({ t: " ", s: oldLines[i - 1] });
									i--; j--;
								} else if (j > 0 && (i === 0 || lcs[i][j - 1] > lcs[i - 1][j])) {
									ops.push({ t: "+", s: newLines[j - 1] });
									j--;
								} else if (i > 0) {
									ops.push({ t: "-", s: oldLines[i - 1] });
									i--;
								}
							}
							ops.reverse();
							const diffBody = ops.map(o => (o.t === " " ? `  ${o.s}` : `${o.t} ${o.s}`)).join("\n");

							addMessage(
								"Final code saved to notebook differs from streamed code. Changes:",
								false,
								diffBody,
								"diff",
								"Validation changes"
							);

							analysisDispatch({
								type: "UPDATE_MESSAGE",
								payload: {
									id: stream.messageId,
									updates: { code: next, codeLanguage: "python", isStreaming: false, status: "completed" as any },
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
			handleCodeGenerationFailed: (event: Event) => {
				if (isMounted) handleCodeGenerationFailed(event);
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
			"code-generation-failed",
			wrappedHandlers.handleCodeGenerationFailed
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
				"code-generation-failed",
				wrappedHandlers.handleCodeGenerationFailed
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
		handleValidationError,
		handleValidationSuccess,
	]);

	return {
		activeStreams: activeStreams.current,
	};
}
