import { useCallback, useRef } from "react";

export interface StreamingUpdateAPI<T> {
	enqueue: (key: string, value: T) => void;
}

/**
 * rAF-batched streaming state updates for smooth UI during code streaming.
 */
export function useStreamingUpdates<T>(
	onFlush: (pending: Record<string, T>) => void
): StreamingUpdateAPI<T> {
	const rafStateRef = useRef<{
		pending: Record<string, T>;
		scheduled: boolean;
	}>({
		pending: {},
		scheduled: false,
	});

	const schedule = useCallback(() => {
		if (rafStateRef.current.scheduled) return;
		rafStateRef.current.scheduled = true;
		requestAnimationFrame(() => {
			const pending = rafStateRef.current.pending;
			rafStateRef.current.pending = {} as Record<string, T>;
			rafStateRef.current.scheduled = false;
			onFlush(pending);
		});
	}, [onFlush]);

	const enqueue = useCallback(
		(key: string, value: T) => {
			rafStateRef.current.pending[key] = value;
			schedule();
		},
		[schedule]
	);

	return { enqueue };
}
