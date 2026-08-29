/**
 * Shared OHIF / Weasis network preference for Reporting Workspace.
 *
 * AUTO probe (LAN → Tailscale → …) often picks the wrong path once Tailscale
 * is linked — opaque no-cors probes look "up" on both, and a stale route
 * cache sticks for 15s. Staff need an explicit LAN | Tailscale control with
 * LAN as the clinic-floor default.
 */

import {
  isConcreteMode,
  localStorageRouteCache,
  type NetworkMode,
} from "./studyLaunchService";

/** Same key Open Study and the embedded OHIF viewer share. */
export const VIEWER_NETWORK_MODE_KEY = "viewer_network_mode_override";

/** Clinic-floor default — low latency to Orthanc/OHIF on the NAS. */
export const DEFAULT_VIEWER_NETWORK_MODE: NetworkMode = "LAN";

/** Same-tab sync when Open Study or the embed toggle changes the mode. */
export const VIEWER_NETWORK_MODE_EVENT = "care:viewer-network-mode";

const EMBED_MODES: NetworkMode[] = ["LAN", "TAILSCALE", "AUTO"];

export function isEmbedNetworkMode(v: string): v is NetworkMode {
  return (EMBED_MODES as readonly string[]).includes(v) || isConcreteMode(v);
}

/** Read stored override; empty / invalid → LAN (not AUTO). */
export function readViewerNetworkMode(
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null,
): NetworkMode {
  if (!storage) return DEFAULT_VIEWER_NETWORK_MODE;
  try {
    const raw = storage.getItem(VIEWER_NETWORK_MODE_KEY);
    if (raw === "AUTO" || (raw && isConcreteMode(raw))) return raw as NetworkMode;
  } catch {
    /* private mode */
  }
  return DEFAULT_VIEWER_NETWORK_MODE;
}

/** Persist preference and drop the short-lived AUTO route cache so the next
 *  planStudyLaunch respects the new choice immediately. */
export function writeViewerNetworkMode(
  mode: NetworkMode,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(VIEWER_NETWORK_MODE_KEY, mode);
  } catch {
    /* private mode */
  }
  try {
    localStorageRouteCache(storage).invalidate();
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VIEWER_NETWORK_MODE_EVENT, { detail: mode }));
  }
}

export function embedNetworkModeOptions(): Array<{ id: NetworkMode; label: string; hint: string }> {
  return [
    { id: "LAN", label: "LAN", hint: "Clinic network — fastest when on site" },
    { id: "TAILSCALE", label: "Tailscale", hint: "VPN path — use off-site or when LAN fails" },
    { id: "AUTO", label: "Auto", hint: "Probe LAN then Tailscale (legacy)" },
  ];
}
