/**
 * Best-effort reporting workspace telemetry (Lane B).
 * Never blocks typing/finalize. Flushes to local ring + optional keepalive POST.
 */

export type WorkspaceTelemetryEvent = {
  type:
    | "study_open"
    | "format_apply"
    | "abnormal_strip_click"
    | "quick_finding_toggle"
    | "voice_catalog_apply"
    | "finalize"
    | "save_and_next";
  at: number;
  studyId?: number | null;
  modality?: string | null;
  region?: string | null;
  billedTestName?: string | null;
  referringDoctorId?: number | null;
  formatId?: string | null;
  formatName?: string | null;
  findingId?: number | null;
  meta?: Record<string, string | number | boolean | null>;
};

const RING_KEY = "care_workspace_telemetry_v1";
const RING_MAX = 200;
const FLUSH_EVERY = 20;

let buffer: WorkspaceTelemetryEvent[] = [];

function readRing(storage: Storage | null): WorkspaceTelemetryEvent[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkspaceTelemetryEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRing(events: WorkspaceTelemetryEvent[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(RING_KEY, JSON.stringify(events.slice(-RING_MAX)));
  } catch { /* ignore */ }
}

async function postEvents(events: WorkspaceTelemetryEvent[]): Promise<void> {
  if (typeof fetch !== "function" || events.length === 0) return;
  try {
    await fetch("/api/radiology/workspace-telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
      credentials: "same-origin",
    });
  } catch {
    /* best-effort */
  }
}

export function trackWorkspaceEvent(
  event: Omit<WorkspaceTelemetryEvent, "at"> & { at?: number },
  storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
): void {
  const full: WorkspaceTelemetryEvent = { ...event, at: event.at ?? Date.now() };
  buffer.push(full);
  const ring = [...readRing(storage), full].slice(-RING_MAX);
  writeRing(ring, storage);
  if (buffer.length >= FLUSH_EVERY || full.type === "finalize" || full.type === "study_open") {
    const batch = buffer;
    buffer = [];
    void postEvents(batch);
  }
}

/** Test helper — drain in-memory buffer without posting. */
export function __drainTelemetryBufferForTests(): WorkspaceTelemetryEvent[] {
  const out = buffer;
  buffer = [];
  return out;
}
