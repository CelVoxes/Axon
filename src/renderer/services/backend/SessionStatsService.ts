import { BackendClient } from "./BackendClient";
import { EventManager } from "../../utils/EventManager";

export class SessionStatsService {
  static async update(client: BackendClient, sessionId?: string | null): Promise<void> {
    try {
      const sid = (sessionId || "").trim();
      if (!sid) return;
      const stats = await client.getSessionStats(sid);
      EventManager.dispatchEvent("session-stats-updated", {
        sessionId: sid,
        stats,
        timestamp: Date.now(),
      });
    } catch (_) {
      // Silent best-effort
    }
  }
}

