/**
 * Reading session mode — minimal chrome + auto-advance after finalize.
 * Persisted in localStorage so a radiologist's preference survives reload.
 */
const KEY = "radiology_reading_session_v1";

export type ReadingSessionState = {
  enabled: boolean;
  startedAt: string | null;
  completedInSession: number;
};

export function loadReadingSession(): ReadingSessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false, startedAt: null, completedInSession: 0 };
    const parsed = JSON.parse(raw) as Partial<ReadingSessionState>;
    return {
      enabled: Boolean(parsed.enabled),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      completedInSession: Number(parsed.completedInSession) || 0,
    };
  } catch {
    return { enabled: false, startedAt: null, completedInSession: 0 };
  }
}

export function saveReadingSession(state: ReadingSessionState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function toggleReadingSession(prev: ReadingSessionState): ReadingSessionState {
  if (prev.enabled) {
    const next = { enabled: false, startedAt: null, completedInSession: 0 };
    saveReadingSession(next);
    return next;
  }
  const next = { enabled: true, startedAt: new Date().toISOString(), completedInSession: 0 };
  saveReadingSession(next);
  return next;
}

export function bumpSessionCompleted(prev: ReadingSessionState): ReadingSessionState {
  if (!prev.enabled) return prev;
  const next = { ...prev, completedInSession: prev.completedInSession + 1 };
  saveReadingSession(next);
  return next;
}
