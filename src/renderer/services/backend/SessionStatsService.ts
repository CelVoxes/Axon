import { BackendClient } from "./BackendClient";
import { EventManager } from "../../utils/EventManager";

export interface SessionStatsUpdateOptions {
	force?: boolean;
	minIntervalMs?: number;
}

export class SessionStatsService {
	private static readonly MIN_INTERVAL_MS = 5000;
	private static lastFetchBySession = new Map<string, number>();

	static async update(
		client: BackendClient,
		sessionId?: string | null,
		options: SessionStatsUpdateOptions = {}
	): Promise<void> {
		try {
			const scoped = client.scopeSessionId(sessionId);
			const sid = (scoped || "").trim();
			if (!sid) return;

			const now = Date.now();
			const minInterval = Math.max(
				0,
				options.minIntervalMs ?? SessionStatsService.MIN_INTERVAL_MS
			);
			if (!options.force) {
				const lastFetch = SessionStatsService.lastFetchBySession.get(sid);
				if (typeof lastFetch === "number" && now - lastFetch < minInterval) {
					return;
				}
			}

			const stats = await client.getSessionStats(sid);
			SessionStatsService.lastFetchBySession.set(sid, now);
			EventManager.dispatchEvent("session-stats-updated", {
				sessionId: sid,
				stats,
				timestamp: now,
			});
		} catch (_) {
			// Silent best-effort
		}
	}
}
