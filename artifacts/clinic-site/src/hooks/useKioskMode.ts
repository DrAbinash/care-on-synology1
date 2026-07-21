/**
 * useKioskMode.ts — best-effort unattended-TV hardening for the queue
 * display board: keep the screen awake, stay fullscreen, recover from
 * stale/frozen state, and discourage accidentally leaving the page.
 *
 * IMPORTANT — what this CANNOT do from inside a webpage, by design of the
 * browser security model:
 *   - Auto-launch the URL on device boot / after a power outage. That's OS
 *     or browser configuration (e.g. an Android TV app set to "launch on
 *     boot", or a kiosk browser like Fully Kiosk Browser / Chrome launched
 *     with --kiosk pointed at the saved TV URL). See the Remote Control
 *     card in Settings ▸ Queue Display (TV) for setup guidance shown there.
 *   - Block OS-level exits (Alt+Tab, the Android home/back button, task
 *     switching, notification shade). Browsers deliberately don't expose
 *     that to JS. A dedicated kiosk browser app (with its own PIN-locked
 *     kiosk mode) is required for a fully tamper-proof screen — this hook
 *     only handles what a normal browser tab can do on its own: wake lock,
 *     requesting fullscreen, re-entering it if exited, and reloading on
 *     network recovery or data staleness.
 */

import { useEffect, useRef, useState } from "react";

export interface KioskOptions {
  roomKey: string;
  displayToken: string;
  wakeLock: boolean;
  autoFullscreen: boolean;
  autoReload: boolean;
  preventExit: boolean;
  /** Timestamp (ms) of the last successful live-data update; used by the
   *  staleness watchdog to force-reload if the page appears stuck. */
  lastDataAt: number | null;
}

// No fresh queue data in this long → assume the tab is stuck and reload.
const STALE_RELOAD_MS = 3 * 60_000;

export function useKioskMode(opts: KioskOptions) {
  const { roomKey, displayToken, wakeLock, autoFullscreen, autoReload, preventExit, lastDataAt } = opts;
  const [needsFullscreenTap, setNeedsFullscreenTap] = useState(false);
  const wakeLockRef = useRef<{ release?: () => Promise<void> } | null>(null);

  // ── Wake Lock — keep the screen from sleeping ───────────────────────────
  useEffect(() => {
    if (!wakeLock || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let cancelled = false;
    const request = async () => {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      } catch {
        // Most commonly thrown when the document isn't visible yet —
        // the visibilitychange listener below retries once it is.
      }
    };
    request();
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible" && !wakeLockRef.current) request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [wakeLock]);

  // ── Fullscreen — attempt automatically, fall back to a one-tap overlay ─
  useEffect(() => {
    if (!autoFullscreen || typeof document === "undefined") return;
    const enter = () => document.documentElement.requestFullscreen?.().catch(() => {});
    enter();
    const onChange = () => {
      const inFullscreen = !!document.fullscreenElement;
      setNeedsFullscreenTap(!inFullscreen);
      // Kiosk browsers / configured devices grant this without a user
      // gesture; regular desktop browsers require a tap, hence the overlay.
      if (!inFullscreen && preventExit) enter();
    };
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [autoFullscreen, preventExit]);

  const tapToEnterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // ── Reload when the network comes back after an outage ─────────────────
  useEffect(() => {
    if (!autoReload) return;
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [autoReload]);

  // ── Staleness watchdog — force-reload if live data has stopped flowing ─
  useEffect(() => {
    if (!autoReload) return;
    const t = setInterval(() => {
      if (lastDataAt && Date.now() - lastDataAt > STALE_RELOAD_MS) {
        window.location.reload();
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [autoReload, lastDataAt]);

  // ── Remote reload command from Settings ▸ Queue Display ▸ Remote Control ─
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const qs = displayToken ? `?displayToken=${encodeURIComponent(displayToken)}` : "";
    const es = new EventSource(`/api/settings/queue-display/${roomKey}/stream${qs}`);
    es.onmessage = (evt) => {
      if (!evt.data || evt.data.startsWith(":")) return;
      try {
        const { command } = JSON.parse(evt.data);
        if (command === "reload") window.location.reload();
      } catch { /* ignore malformed event */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [roomKey, displayToken]);

  // ── Heartbeat — lets Settings ▸ Queue Display ▸ Displays Overview show
  // accurate online/last-seen status, and lets the staff offline-TV alert
  // scheduler know this screen is actually alive.
  useEffect(() => {
    const qs = displayToken ? `?displayToken=${encodeURIComponent(displayToken)}` : "";
    const ping = () => {
      fetch(`/api/settings/queue-display/${roomKey}/heartbeat${qs}`, { method: "POST" }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 30_000);
    return () => clearInterval(t);
  }, [roomKey, displayToken]);

  // ── Discourage accidental exit (best-effort — see module docblock) ─────
  useEffect(() => {
    if (!preventExit) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [preventExit]);

  return { needsFullscreenTap, tapToEnterFullscreen };
}
