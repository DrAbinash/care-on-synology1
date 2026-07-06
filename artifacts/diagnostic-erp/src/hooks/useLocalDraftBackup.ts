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
  const checkedRef = useRef(false);

  // On first mount: check once whether a backup exists for this study.
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
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

  function discard() {
    setRestoreAvailable(false);
    backupRef.current = null;
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }

  function clear() {
    discard();
  }

  return { restoreAvailable, restore, discard, clear };
}
