/**
 * erpConnectivity.ts — automatic LAN failover for clinic staff.
 *
 * Staff bookmark https://caredeoghar.com/erp (required for ICICI Orange Pay).
 * When the public site is unreachable but the NAS is on the LAN, the app
 * redirects once to the LAN ERP URL (http://<nas-ip>:8888/erp) and preserves
 * the login session so counters do not need to switch URLs manually.
 *
 * HTTPS pages cannot probe HTTP LAN URLs (mixed content), so failover is:
 *   public /health fails (after retries) → redirect to LAN origin (same path).
 *
 * Login/portal pages never auto-redirect — staff choose the LAN link manually
 * so a flaky probe or wrong cached IP cannot block sign-in.
 */

import { ERP_SESSION_KEY } from "./staffSession";
import {
  erpLanOriginForHost,
  erpPublicOrigin,
  hydrateNetworkSettingsFromCache,
  isLanHostname,
  isPublicErpHostname,
  lanHostAlternates,
  preferredLanHost,
  recordWorkingLanHost,
} from "./networkProfiles";

export const ERP_CONNECTIVITY_MODE_KEY = "erp_connectivity_mode";
export const ERP_SESSION_HASH_PARAM = "_erp_sess";
/** Set when public probe failed on a login page — show manual LAN link. */
export const ERP_PUBLIC_PROBE_FAILED_KEY = "erp_public_probe_failed";

/** Lightweight liveness — no DB, always 200 when nginx+api are up. */
const HEALTH_PATH = "/health";
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_RETRIES = 3;
const PROBE_RETRY_DELAY_MS = 800;

export type ErpConnectivityMode =
  | "public"
  | "public_unavailable"
  | "lan"
  | "local";

export function getErpBasePath(): string {
  const base = (import.meta as { env: { BASE_URL?: string } }).env.BASE_URL || "/erp/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** Path inside the ERP SPA (no /erp prefix), e.g. "/login" or "/billing". */
export function erpPathFromBrowser(): string {
  const basePath = getErpBasePath().replace(/\/$/, "");
  let path = window.location.pathname;
  if (basePath && basePath !== "/" && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || "/";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

/**
 * Fix URLs like /erp/erp/login left by older LAN redirects or doubled wouter
 * base prefixes — rewrite the browser bar without a full reload.
 */
export function repairDoubledErpPath(): void {
  const basePath = getErpBasePath().replace(/\/$/, "");
  if (!basePath || basePath === "/") return;
  const doubled = `${basePath}${basePath}`;
  const path = window.location.pathname;
  if (!path.startsWith(doubled)) return;
  const fixed = `${basePath}${path.slice(doubled.length) || "/"}`;
  window.history.replaceState(
    null,
    "",
    fixed + window.location.search + window.location.hash,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Probe whether an ERP origin answers /health (process liveness, not DB). */
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
    // /health is 200 when the process is alive. Any HTTP response means the
    // origin is reachable — do NOT treat 503 from /api/healthz (DB starting)
    // as "public site down".
    return res.ok;
  } catch {
    return false;
  }
}

/** Retry the public probe — avoids redirecting on a single slow packet. */
export async function probeErpOriginWithRetries(
  origin: string,
  retries = PROBE_RETRIES,
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (await probeErpOrigin(origin)) return true;
    if (i < retries - 1) await delay(PROBE_RETRY_DELAY_MS);
  }
  return false;
}

export function currentConnectivityKind(): ErpConnectivityMode | "other" {
  const host = window.location.hostname;
  if (isLanHostname(host)) return "lan";
  if (isPublicErpHostname(host)) return "public";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  return "other";
}

/** True on staff login / portal entry routes — never auto-redirect here. */
export function isLoginOrPortalPath(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const base = getErpBasePath().replace(/\/$/, "");
  if (path === "/login" || path === "/portal") return true;
  if (path === `${base}/login` || path === `${base}/portal`) return true;
  if (path.endsWith("/login")) return true;
  return (
    path.includes("/portal/staff-login") ||
    path.includes("/portal/patient-login")
  );
}

/** Build the LAN ERP URL for the current page (path + query preserved). */
export function buildLanFailoverUrl(lanHost?: string): string {
  const host = lanHost ?? preferredLanHost();
  const lanRoot = erpLanOriginForHost(host).replace(/\/+$/, "");
  const path = erpPathFromBrowser();
  const suffix = path === "/" ? "/" : path;
  return `${lanRoot}${suffix}${window.location.search}`;
}

/** All LAN URLs staff can try (primary + optional alt NAS IP). */
export function buildLanFailoverOptions(): { host: string; url: string }[] {
  return lanHostAlternates().map((host) => ({
    host,
    url: buildLanFailoverUrl(host),
  }));
}

/** Build the public ERP URL for the current page. */
export function buildPublicErpUrl(): string {
  const pubRoot = erpPublicOrigin().replace(/\/+$/, "");
  const path = erpPathFromBrowser();
  const suffix = path === "/" ? "/" : path;
  return `${pubRoot}${suffix}${window.location.search}`;
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

function redirectToLanWithSession(lanHost?: string): void {
  let target = buildLanFailoverUrl(lanHost);
  try {
    const session = window.localStorage.getItem(ERP_SESSION_KEY);
    if (session) {
      target += `#${ERP_SESSION_HASH_PARAM}=${encodeSessionForHash(session)}`;
    }
  } catch {
    /* ignore */
  }
  window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "lan");
  window.sessionStorage.removeItem(ERP_PUBLIC_PROBE_FAILED_KEY);
  window.location.replace(target);
}

/**
 * Run once before React mounts. May redirect to the LAN ERP URL.
 * Returns when the app should continue on the current origin.
 */
export async function runErpConnectivityBootstrap(): Promise<void> {
  hydrateNetworkSettingsFromCache();
  repairDoubledErpPath();
  consumeSessionTransferHash();

  const kind = currentConnectivityKind();
  if (kind === "lan") {
    recordWorkingLanHost(window.location.hostname);
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "lan");
    window.sessionStorage.removeItem(ERP_PUBLIC_PROBE_FAILED_KEY);
    return;
  }
  if (kind !== "public") {
    return;
  }

  const publicOk = await probeErpOriginWithRetries(window.location.origin);
  if (publicOk) {
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "public");
    window.sessionStorage.removeItem(ERP_PUBLIC_PROBE_FAILED_KEY);
    return;
  }

  // Login/portal: never hijack the URL — offer LAN links in the UI instead.
  if (isLoginOrPortalPath()) {
    window.sessionStorage.setItem(ERP_PUBLIC_PROBE_FAILED_KEY, "1");
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "public_unavailable");
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

/** True when bootstrap detected public outage on a login page. */
export function shouldOfferLanFailover(): boolean {
  try {
    return window.sessionStorage.getItem(ERP_PUBLIC_PROBE_FAILED_KEY) === "1";
  } catch {
    return false;
  }
}
