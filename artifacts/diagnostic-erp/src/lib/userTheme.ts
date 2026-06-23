import { useState, useEffect, useCallback } from "react";
import { api } from "./fetchApi";
import { readStaffSession, writeStaffSession } from "./staffSession";

const LS_PREFIX = "sidebar_theme_user_";
const CHANGE_EVENT = "user-theme-change";

export function getUserTheme(userId: number | string): string | null {
  try {
    return window.localStorage.getItem(LS_PREFIX + userId) ?? null;
  } catch {
    return null;
  }
}

// Keep the in-memory ERP session in sync so the next render passes an updated
// serverTheme and re-resolves the effective theme without requiring a re-login.
function syncSessionTheme(userId: number | string, themeId: string | null): void {
  try {
    const sess = readStaffSession();
    if (sess && sess.user.id === Number(userId)) {
      writeStaffSession({ ...sess, user: { ...sess.user, sidebarTheme: themeId } });
    }
  } catch { /* ignore */ }
}

// Seed the per-user localStorage cache from a server-provided value.
// Does NOT dispatch CHANGE_EVENT — callers that need reactivity call setLocal directly.
function seedLocalCache(userId: number | string, themeId: string): void {
  try {
    window.localStorage.setItem(LS_PREFIX + userId, themeId);
  } catch { /* ignore */ }
}

export function setUserTheme(userId: number | string, themeId: string): void {
  try {
    window.localStorage.setItem(LS_PREFIX + userId, themeId);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId: String(userId), themeId } }));
  } catch { /* ignore */ }
  void api.patch(`/api/users/${userId}/sidebar-theme`, { sidebarTheme: themeId })
    .then(() => syncSessionTheme(userId, themeId))
    .catch(() => {});
}

export function clearUserTheme(userId: number | string): void {
  try {
    window.localStorage.removeItem(LS_PREFIX + userId);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId: String(userId), themeId: null } }));
  } catch { /* ignore */ }
  void api.patch(`/api/users/${userId}/sidebar-theme`, { sidebarTheme: null })
    .then(() => syncSessionTheme(userId, null))
    .catch(() => {});
}

/**
 * React hook for the per-user sidebar theme.
 *
 * Precedence (highest → lowest):
 *   1. Account value (`serverTheme`, non-null) — the DB-persisted preference
 *      passed in from `session.user.sidebarTheme`. A non-null server value always
 *      wins over a stale local cache, ensuring cross-device consistency.
 *      When `serverTheme` is non-null it is also written into localStorage so the
 *      cache stays warm for offline / no-session loads.
 *   2. localStorage (`sidebar_theme_user_<id>`) — used when the account has no
 *      stored preference (`serverTheme` is null or unavailable).
 *   3. Callers should then fall back to the clinic-wide default and "navy".
 *
 * @param userId       Authenticated user id (or null/undefined when not signed in).
 * @param serverTheme  `session.user.sidebarTheme` from the staff-login response.
 *                     Kept current by `syncSessionTheme` after every write/clear.
 */
export function useUserTheme(
  userId: number | string | null | undefined,
  serverTheme?: string | null,
): {
  userTheme: string | null;
  setTheme: (id: string) => void;
  clearTheme: () => void;
} {
  // serverTheme ?? localStorage ?? null
  // • non-null serverTheme (account preference set) → account wins
  // • null/undefined serverTheme (no preference or no session) → fall back to local cache
  function resolve(): string | null {
    if (userId == null) return null;
    return serverTheme ?? getUserTheme(userId) ?? null;
  }

  const [userTheme, setLocal] = useState<string | null>(resolve);

  useEffect(() => {
    if (userId == null) { setLocal(null); return; }

    // When the server provides a concrete value, seed localStorage so the cache
    // stays populated for offline use and CHANGE_EVENT handlers stay consistent.
    if (serverTheme != null) {
      seedLocalCache(userId, serverTheme);
    }

    setLocal(resolve());

    const handler = (e: Event) => {
      const { userId: uid } = (e as CustomEvent<{ userId: string; themeId: string | null }>).detail;
      if (uid !== String(userId)) return;
      // After setUserTheme/clearUserTheme both localStorage and the session have
      // been updated. Read localStorage here; the next render will deliver the
      // refreshed serverTheme so the effect re-runs and confirms the resolved value.
      setLocal(getUserTheme(userId));
    };

    // Cross-tab sync: the `storage` event fires in every OTHER tab when
    // localStorage is written. This lets a theme change in one tab propagate
    // instantly to all sibling tabs without a reload.
    const storageHandler = (e: StorageEvent) => {
      if (e.key !== LS_PREFIX + String(userId)) return;
      setLocal(e.newValue ?? null);
    };

    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [userId, serverTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback((id: string) => {
    if (userId != null) setUserTheme(userId, id);
  }, [userId]);

  const clearTheme = useCallback(() => {
    if (userId != null) clearUserTheme(userId);
  }, [userId]);

  return { userTheme, setTheme, clearTheme };
}
