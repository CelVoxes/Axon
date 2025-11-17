/**
 * Helpers to share workspace/chat session scope across renderer modules
 * without requiring direct React context access.
 */

type Getter = () => unknown;

const trimString = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
};

const coalesceString = (...getters: Getter[]): string | undefined => {
	for (const getter of getters) {
		try {
			const value = getter();
			const trimmed = trimString(value);
			if (trimmed) {
				return trimmed;
			}
		} catch (_) {
			// ignore accessor errors and continue
		}
	}
	return undefined;
};

/**
 * Best-effort detection of the active workspace directory.
 */
export function getWorkspaceScope(): string | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	return coalesceString(
		() => (window as any).__axonWorkspace,
		() => (window as any).currentWorkspace,
		() => (window as any)?.electronAPI?.getCurrentWorkspace?.()
	);
}

/**
 * Best-effort detection of the active chat session identifier.
 */
export function getActiveChatSessionId(): string | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	return coalesceString(
		() => (window as any).__axonAnalysisState?.activeChatSessionId,
		() => (window as any).analysisState?.activeChatSessionId
	);
}
