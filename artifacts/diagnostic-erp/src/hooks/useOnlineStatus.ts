import { useState, useEffect } from "react";

/**
 * Returns whether the ERP is reachable and updates reactively.
 *
 * P2-8 — the browser's online/offline events describe the NETWORK INTERFACE,
 * not the ERP. On the clinic LAN the failure that matters is the one where
 * Wi-Fi is up but the NAS is not answering: every save, print and verify in
 * the reporting workspace gates on this hook, and it used to say "online"
 * straight through an API that was down. While the browser claims online, the
 * hook probes `/api/health` — the no-auth, no-rate-limit liveness endpoint —
 * and reports offline only after two consecutive failed probes (a single
 * dropped packet must not flap the workspace's Save button) or immediately on
 * the browser's own offline event.
 */

/** How often the API is polled while the browser claims online. */
const HEALTH_PROBE_INTERVAL_MS = 15_000;

/** Consecutive failed probes before the hook reports the API unreachable. */
const HEALTH_PROBE_FAILURES_TO_FLIP = 2;

export function useOnlineStatus(): boolean {
  // Optimistic start: the browser's own claim, corrected by the first probe.
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [apiReachable, setApiReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const probe = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          consecutiveFailures = 0;
          setApiReachable(true);
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= HEALTH_PROBE_FAILURES_TO_FLIP) setApiReachable(false);
        }
      } catch {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= HEALTH_PROBE_FAILURES_TO_FLIP) setApiReachable(false);
      } finally {
        if (!cancelled) {
          clearTimer();
          timer = setTimeout(() => void probe(), HEALTH_PROBE_INTERVAL_MS);
        }
      }
    };

    const goOnline = () => {
      setIsOnline(true);
      // The browser regained a network, not the API: probe at once rather
      // than waiting out the interval.
      clearTimer();
      void probe();
    };
    const goOffline = () => {
      setIsOnline(false);
      setApiReachable(false);
      consecutiveFailures = HEALTH_PROBE_FAILURES_TO_FLIP;
      clearTimer();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    void probe();

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline && apiReachable;
}
