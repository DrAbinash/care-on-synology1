/**
 * queueBroadcast.ts
 *
 * Tiny in-process pub/sub for Server-Sent Event (SSE) queue updates.
 *
 * WHY: Queue.tsx and Display.tsx both poll (/api/test-tokens/today and
 * /api/display/queue) on a timer (5 s and 4 s respectively). That works
 * fine but means:
 *   • A patient called at the desk appears on the TV 0–4 s later.
 *   • A TV running 24 / 7 makes ~21,600 HTTP round-trips per day.
 *
 * With SSE the Display TV subscribes once and receives a push within
 * milliseconds of any queue mutation. Polling stays as a fallback.
 *
 * ARCHITECTURE: Single-process (Docker, single-instance Synology NAS).
 * If the system ever scales horizontally, replace this EventEmitter with
 * a Redis Pub/Sub channel — the SSE endpoint shape doesn't need to change.
 *
 * USAGE:
 *   import { queueBroadcaster } from "../lib/queueBroadcast";
 *   queueBroadcaster.broadcast(ledgerId);          // after any queue mutation
 *   queueBroadcaster.on("queue-update", handler);  // in SSE endpoint
 *   queueBroadcaster.off("queue-update", handler); // on SSE disconnect
 */

import EventEmitter from "node:events";

export interface QueueUpdateEvent {
  /** Which ledger changed, or undefined = broadcast to everyone. */
  ledgerId?: number;
  ts: number;
}

class QueueBroadcaster extends EventEmitter {
  /**
   * Call this after any successful test-token mutation (PATCH status, POST /call).
   * The display SSE endpoint picks this up and pushes fresh queue data to clients.
   */
  broadcast(ledgerId?: number): void {
    this.emit("queue-update", { ledgerId, ts: Date.now() } satisfies QueueUpdateEvent);
  }
}

export const queueBroadcaster = new QueueBroadcaster();

// Allow many concurrent TV display connections (default Node limit is 10 — warn
// and reject further listeners). 500 is more than enough for a clinic LAN.
queueBroadcaster.setMaxListeners(500);
