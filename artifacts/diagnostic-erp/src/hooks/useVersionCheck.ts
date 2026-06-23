import { useState, useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 60_000; // check every minute

/**
 * Polls GET /api/version every minute. Returns `updateAvailable = true` the
 * first time the server's startedAt timestamp differs from the one seen on
 * the initial page load — which happens whenever a new deployment restarts
 * the server process.
 *
 * The check is skipped while the browser tab is hidden (visibilitychange)
 * to avoid waking up idle tabs unnecessarily.
 */
export function useVersionCheck(): { updateAvailable: boolean; dismiss: () => void } {
  const initialToken = useRef<number | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { startedAt } = (await res.json()) as { startedAt: number };

        if (initialToken.current === null) {
          // First successful response — record baseline.
          initialToken.current = startedAt;
        } else if (startedAt !== initialToken.current) {
          // Server restarted since the page loaded → new deployment available.
          setUpdateAvailable(true);
          return; // Stop polling once we've detected an update.
        }
      } catch {
        // Network error — silently ignore and retry next interval.
      }

      // Schedule next check only when the tab is visible.
      if (document.visibilityState === "visible") {
        timer = setTimeout(check, POLL_INTERVAL_MS);
      }
    }

    // Kick off the first check immediately, then resume polling on tab focus.
    void check();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !updateAvailable) {
        clearTimeout(timer);
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []); // run once on mount

  const dismiss = () => setUpdateAvailable(false);

  return { updateAvailable, dismiss };
}
