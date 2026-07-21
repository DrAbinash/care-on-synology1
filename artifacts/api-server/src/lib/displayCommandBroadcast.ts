/**
 * displayCommandBroadcast.ts
 *
 * Tiny in-process pub/sub (same pattern as queueBroadcast.ts) that lets the
 * ERP's "Remote Control" panel (Settings ▸ Queue Display) push a command to
 * an unattended TV without anyone touching the physical screen — e.g. force
 * a reload after an admin edits settings, or to recover a frozen browser.
 *
 * ARCHITECTURE: Single-process (Docker, single-instance Synology NAS). If
 * the system ever scales horizontally, replace this EventEmitter with a
 * Redis Pub/Sub channel — the SSE endpoint shape doesn't need to change.
 *
 * USAGE:
 *   import { displayCommandBroadcaster } from "../lib/displayCommandBroadcast";
 *   displayCommandBroadcaster.send(roomKey, "reload");    // admin action
 *   displayCommandBroadcaster.on("display-command", handler); // SSE endpoint
 */

import EventEmitter from "node:events";

export type DisplayCommand = "reload";

export interface DisplayCommandEvent {
  roomKey: string;
  command: DisplayCommand;
  ts: number;
}

class DisplayCommandBroadcaster extends EventEmitter {
  send(roomKey: string, command: DisplayCommand): void {
    this.emit("display-command", { roomKey, command, ts: Date.now() } satisfies DisplayCommandEvent);
  }
}

export const displayCommandBroadcaster = new DisplayCommandBroadcaster();

// Allow many concurrent TV display connections (default Node limit is 10).
displayCommandBroadcaster.setMaxListeners(500);
