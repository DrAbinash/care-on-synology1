import { useEffect, useRef, useState } from "react";

/**
 * useLocalDraftBackup — protects typed report text against tab crashes,
 * accidental navigation, and temporary API failures.
 *
 * Every `debounceMs` after the last edit, the provided snapshot is written
 * to localStorage under a per-study key. On mount, if a backup exists,
 * `restoreAvailable` becomes true and the caller can show a "Restore
 * unsaved work?" banner; `restore()` returns the snapshot, `discard()`
 * deletes it. `clear()` must be called after a successful finalize so
 * finalized-report text never lingers on a shared workstation.
 *
 * Storage is per-browser localStorage only — nothing is sent anywhere.
 */

export function useLocalDraftBackup<T extends object>(opts: {
  storageKey: string;
  snapshot: T;
  /** Set false until the initial server draft has loaded, so we don't
   *  immediately overwrite a good backup with empty initial state. */
  enabled: boolean;
  debounceMs?: number;
}) {
  const { storageKey, snapshot, enabled, debounceMs = 2000 } = opts;
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const backupRef = useRef<T | null>(null);
  const checkedForKeyRef = useRef<string | null>(null);

  // Check once PER KEY whether a backup exists for this study. Re-checking on
  // key change matters (M1.4): switching studies in a mounted workspace must
  // load the NEW study's backup — the old once-per-mount check left the
  // previous study's snapshot in backupRef, so restore()/peek() on study B
  // could hand back study A's report text (cross-patient restore).
  useEffect(() => {
    if (checkedForKeyRef.current === storageKey) return;
    checkedForKeyRef.current = storageKey;
    backupRef.current = null;
    setRestoreAvailable(false);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        backupRef.current = JSON.parse(raw) as T;
        setRestoreAvailable(true);
      }
    } catch {
      /* corrupt backup — ignore */
    }
  }, [storageKey]);

  // Debounced write of the current snapshot.
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch {
        /* storage full/blocked — non-fatal */
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [storageKey, snapshot, enabled, debounceMs]);

  function restore(): T | null {
    setRestoreAvailable(false);
    return backupRef.current;
  }

  /** M1.4 — non-consuming look at the stored backup so callers can decide
   *  whether it is actually NEWER than the server draft before offering the
   *  restore banner. Does not change restoreAvailable. */
  function peek(): T | null {
    return backupRef.current;
  }

  function discard() {
    setRestoreAvailable(false);
    backupRef.current = null;
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }

  function clear() {
    discard();
    try { localStorage.removeItem(`${storageKey}_history`); } catch { /* ignore */ }
  }

  // ── Snapshot history (Phase 3) ─────────────────────────────────────────────
  // In addition to the rolling "latest" backup above, a snapshot of the
  // report is appended once per minute (only if content changed), capped at
  // MAX_SNAPSHOTS. Any snapshot can be restored — protecting against "I
  // accidentally deleted a paragraph five minutes ago", not just crashes.
  const MAX_SNAPSHOTS = 30;
  const historyKey = `${storageKey}_history`;
  const [historyVersion, setHistoryVersion] = useState(0); // bump to refresh listings
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      try {
        const history: Array<{ ts: number; data: T }> = JSON.parse(localStorage.getItem(historyKey) || "[]");
        const latest = history[history.length - 1];
        const current = JSON.stringify(snapshotRef.current);
        if (latest && JSON.stringify(latest.data) === current) return; // unchanged — skip
        history.push({ ts: Date.now(), data: snapshotRef.current });
        while (history.length > MAX_SNAPSHOTS) history.shift();
        localStorage.setItem(historyKey, JSON.stringify(history));
        setHistoryVersion((v) => v + 1);
      } catch { /* storage full/blocked — non-fatal */ }
    }, 60_000);
    return () => clearInterval(timer);
  }, [enabled, historyKey]);

  function listSnapshots(): Array<{ ts: number }> {
    void historyVersion; // subscribe to refreshes
    try {
      const history: Array<{ ts: number; data: T }> = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return history.map(({ ts }) => ({ ts })).reverse(); // newest first
    } catch {
      return [];
    }
  }

  function restoreSnapshot(ts: number): T | null {
    try {
      const history: Array<{ ts: number; data: T }> = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return history.find((s) => s.ts === ts)?.data ?? null;
    } catch {
      return null;
    }
  }

  return { restoreAvailable, restore, peek, discard, clear, listSnapshots, restoreSnapshot };
}
