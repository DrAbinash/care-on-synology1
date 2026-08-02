/**
 * erpConnectivity.ts — automatic LAN failover for clinic staff.
 *
 * Staff bookmark https://caredeoghar.com/erp (required for ICICI Orange Pay).
 * When the public site is unreachable but the NAS is on the LAN, the app
 * redirects once to the LAN ERP URL (http://<nas-ip>:8888/erp) and preserves
 * the login session so counters do not need to switch URLs manually.
 *
 * HTTPS pages cannot probe HTTP LAN URLs (mixed content), so failover is:
 *   public /api/healthz fails → redirect to LAN origin (same path).
 */

import { ERP_SESSION_KEY } from "./staffSession";
import {
  erpLanOrigin,
  erpPublicOrigin,
  hydrateNetworkSettingsFromCache,
  isLanHostname,
  isPublicErpHostname,
} from "./networkProfiles";

export const ERP_CONNECTIVITY_MODE_KEY = "erp_connectivity_mode";
export const ERP_SESSION_HASH_PARAM = "_erp_sess";

const HEALTH_PATH = "/api/healthz";
const PROBE_TIMEOUT_MS = 4_500;

export type ErpConnectivityMode =
  | "public"
  | "public_unavailable"
  | "lan"
  | "local";

export function getErpBasePath(): string {
  const base = (import.meta as { env: { BASE_URL?: string } }).env.BASE_URL || "/erp/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** Probe whether an ERP origin answers /api/healthz. */
export async function probeErpOrigin(origin: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const root = origin.replace(/\/+$/, "");
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${root}${HEALTH_PATH}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function currentConnectivityKind(): ErpConnectivityMode | "other" {
  const host = window.location.hostname;
  if (isLanHostname(host)) return "lan";
  if (isPublicErpHostname(host)) return "public";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  return "other";
}

/** Build the LAN ERP URL for the current page (path + query preserved). */
export function buildLanFailoverUrl(): string {
  const lanRoot = erpLanOrigin().replace(/\/+$/, "");
  const basePath = getErpBasePath().replace(/\/$/, "");
  let path = window.location.pathname;
  if (!path.startsWith(basePath)) {
    path = `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return `${lanRoot}${path}${window.location.search}`;
}

/** Build the public ERP URL for the current page. */
export function buildPublicErpUrl(): string {
  const pubRoot = erpPublicOrigin().replace(/\/+$/, "");
  const basePath = getErpBasePath().replace(/\/$/, "");
  let path = window.location.pathname;
  if (!path.startsWith(basePath)) {
    path = `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return `${pubRoot}${path}${window.location.search}`;
}

function encodeSessionForHash(raw: string): string {
  return encodeURIComponent(btoa(unescape(encodeURIComponent(raw))));
}

function decodeSessionFromHash(encoded: string): string | null {
  try {
    return decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
  } catch {
    return null;
  }
}

/**
 * After a LAN redirect, restore the staff session from the one-time URL hash
 * fragment (localStorage does not carry across origins).
 */
export function consumeSessionTransferHash(): boolean {
  const hash = window.location.hash;
  if (!hash.includes(ERP_SESSION_HASH_PARAM)) return false;

  const match = hash.match(new RegExp(`${ERP_SESSION_HASH_PARAM}=([^&]+)`));
  if (match?.[1]) {
    const session = decodeSessionFromHash(match[1]);
    if (session) {
      try {
        window.localStorage.setItem(ERP_SESSION_KEY, session);
      } catch {
        /* private mode */
      }
    }
  }

  const cleaned = hash
    .replace(new RegExp(`#?&?${ERP_SESSION_HASH_PARAM}=[^&]*`), "")
    .replace(/^#$/, "");
  const nextUrl = window.location.pathname + window.location.search + (cleaned ? cleaned : "");
  window.history.replaceState(null, "", nextUrl);
  return true;
}

function redirectToLanWithSession(): void {
  let target = buildLanFailoverUrl();
  try {
    const session = window.localStorage.getItem(ERP_SESSION_KEY);
    if (session) {
      target += `#${ERP_SESSION_HASH_PARAM}=${encodeSessionForHash(session)}`;
    }
  } catch {
    /* ignore */
  }
  window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "lan");
  window.location.replace(target);
}

/**
 * Run once before React mounts. May redirect to the LAN ERP URL.
 * Returns when the app should continue on the current origin.
 */
export async function runErpConnectivityBootstrap(): Promise<void> {
  hydrateNetworkSettingsFromCache();
  consumeSessionTransferHash();

  const kind = currentConnectivityKind();
  if (kind === "lan") {
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "lan");
    return;
  }
  if (kind !== "public") {
    return;
  }

  const publicOk = await probeErpOrigin(window.location.origin);
  if (publicOk) {
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "public");
    return;
  }

  // Cannot probe HTTP LAN from HTTPS (mixed content) — redirect directly.
  redirectToLanWithSession();
  await new Promise(() => {
    /* redirect in flight */
  });
}

/** True when the SPA is running on the LAN ERP URL. */
export function isOnLanErpOrigin(): boolean {
  return currentConnectivityKind() === "lan";
}

/** Public ERP origin for optional fail-back (card payments / ICICI). */
export function getPublicErpOrigin(): string {
  return erpPublicOrigin();
}
