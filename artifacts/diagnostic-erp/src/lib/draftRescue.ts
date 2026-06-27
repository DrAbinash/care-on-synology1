/**
 * draftRescue.ts
 *
 * Emergency draft preservation when a 401 session expiry forces a page redirect.
 *
 * Problem: radiologist dictates for 10+ minutes, JWT expires, fetchApi redirects
 * to login — all in-memory findings text is lost because React state is destroyed.
 *
 * Solution:
 *   1. RadiologyCommandCenter registers a "rescue saver" callback here via
 *      registerDraftRescueSaver(). The callback captures current rawFindings +
 *      impression + accessionNumber from component state.
 *   2. When handleSessionExpiry() fires in fetchApi.ts, it calls
 *      executeDraftRescue() before redirecting. The callback writes to localStorage.
 *   3. On next login, RadiologyCommandCenter checks for a rescue draft matching
 *      the loaded study's accessionNumber and offers a restore banner.
 *
 * Storage key: "rcc_rescue_draft"
 * Value shape: { accessionNumber, rawFindings, impression, savedAt }
 *
 * The rescue draft is cleared when:
 *   - The radiologist clicks "Restore" (applied)
 *   - The radiologist clicks "Dismiss" (discarded)
 *   - The study is finalised (signed)
 */

export interface RescueDraft {
  accessionNumber: string;
  rawFindings: string;
  impression: string[];
  savedAt: string; // ISO timestamp
}

const RESCUE_KEY = "rcc_rescue_draft";

// Single registered saver — replaced each time RCC mounts
let _rescueSaver: (() => void) | null = null;

/** Called by RadiologyCommandCenter to register the current-state saver. */
export function registerDraftRescueSaver(fn: () => void): void {
  _rescueSaver = fn;
}

/** Called by RadiologyCommandCenter on unmount to deregister. */
export function deregisterDraftRescueSaver(): void {
  _rescueSaver = null;
}

/** Called by fetchApi before redirecting on session expiry. */
export function executeDraftRescue(): void {
  try {
    if (_rescueSaver) _rescueSaver();
  } catch {
    // Never throw during session expiry — the redirect must proceed
  }
}

/** Write a rescue draft to localStorage. Called from inside the RCC callback. */
export function writeRescueDraft(draft: RescueDraft): void {
  try {
    localStorage.setItem(RESCUE_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

/** Read the rescue draft. Returns null if none saved or JSON is invalid. */
export function readRescueDraft(): RescueDraft | null {
  try {
    const raw = localStorage.getItem(RESCUE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RescueDraft;
  } catch {
    return null;
  }
}

/** Clear the rescue draft after it has been applied or dismissed. */
export function clearRescueDraft(): void {
  try {
    localStorage.removeItem(RESCUE_KEY);
  } catch { /* ignore */ }
}
