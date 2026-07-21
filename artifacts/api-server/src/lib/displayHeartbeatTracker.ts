/**
 * displayHeartbeatTracker.ts
 *
 * In-memory "is this TV alive" tracker for the queue-display boards. The
 * kiosk hook (clinic-site/src/hooks/useKioskMode.ts) pings
 * POST /api/settings/queue-display/:roomKey/heartbeat every ~30s; this
 * module just remembers the last time each roomKey was heard from.
 *
 * Deliberately in-memory, not persisted: a heartbeat is a best-effort
 * liveness signal, not an audit record. A server restart resetting "last
 * seen" to unknown is fine — every TV re-pings within 30s of the restart.
 *
 * Also tracks per-room "last alerted at" so the staff-offline-alert
 * scheduler (see cron.ts) can cool down between WhatsApp sends instead of
 * re-alerting every poll cycle while a TV stays dark.
 */

class DisplayHeartbeatTracker {
  private lastSeen = new Map<string, number>();
  private lastAlertedAt = new Map<string, number>();

  touch(roomKey: string): void {
    this.lastSeen.set(roomKey, Date.now());
  }

  getLastSeen(roomKey: string): number | null {
    return this.lastSeen.get(roomKey) ?? null;
  }

  isOnline(roomKey: string, thresholdMs = 90_000): boolean {
    const seen = this.lastSeen.get(roomKey);
    return !!seen && Date.now() - seen < thresholdMs;
  }

  getLastAlertedAt(roomKey: string): number | null {
    return this.lastAlertedAt.get(roomKey) ?? null;
  }

  markAlerted(roomKey: string): void {
    this.lastAlertedAt.set(roomKey, Date.now());
  }

  clearAlert(roomKey: string): void {
    this.lastAlertedAt.delete(roomKey);
  }

  snapshot(): Record<string, { lastSeenAt: number | null; online: boolean }> {
    const roomKeys = new Set([...this.lastSeen.keys()]);
    const out: Record<string, { lastSeenAt: number | null; online: boolean }> = {};
    for (const roomKey of roomKeys) {
      out[roomKey] = { lastSeenAt: this.getLastSeen(roomKey), online: this.isOnline(roomKey) };
    }
    return out;
  }
}

export const displayHeartbeatTracker = new DisplayHeartbeatTracker();
