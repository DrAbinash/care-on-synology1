/**
 * In-process pub/sub for radiology worklist updates (PACS intake, status changes).
 * Display clients subscribe via GET /api/radiology/pacs-worklist-stream (SSE).
 */

import EventEmitter from "node:events";

export interface RadiologyUpdateEvent {
  worklistId?: number;
  ts: number;
}

class RadiologyBroadcaster extends EventEmitter {
  broadcast(worklistId?: number): void {
    this.emit("radiology-update", { worklistId, ts: Date.now() } satisfies RadiologyUpdateEvent);
  }
}

export const radiologyBroadcaster = new RadiologyBroadcaster();
radiologyBroadcaster.setMaxListeners(500);
