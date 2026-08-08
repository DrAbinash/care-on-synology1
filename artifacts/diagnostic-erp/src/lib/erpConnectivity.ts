/**
 * erpConnectivity.ts — automatic LAN failover for clinic staff.
 *
 * Staff bookmark https://caredeoghar.com/erp (required for ICICI Orange Pay).
 * When the public site is unreachable but the NAS is on the LAN, the app
 * redirects once to the LAN ERP URL (http://<nas-ip>:8888/erp) and preserves
 * the login session so counters do not need to switch URLs manually.
 *
 * HTTPS pages cannot probe HTTP LAN URLs (mixed content), so failover is:
 *   ERP shell probe fails → show manual LAN links (never auto-redirect).
 *
 * Login/portal pages never auto-redirect — staff choose the LAN link manually
 * so a flaky probe or wrong cached IP cannot block sign-in.
 */

import { ERP_SESSION_KEY } from "./staffSession";
import {
  erpLanOriginForHost,
  erpPublicOrigin,
  getLastWorkingLanHost as getLastWorkingLanHostFromProfiles,
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
/** Fired after a background login-page connectivity probe finishes. */
export const ERP_CONNECTIVITY_PROBE_DONE_EVENT = "erp-connectivity-probe-done";

/** Probe the ERP SPA shell — same path Synology/nginx always expose as /erp/. */
function erpShellProbeUrl(origin: string): string {
  const root = origin.replace(/\/+$/, "");
  const shell = `${getErpBasePath()}index.html`.replace(/\/{2,}/g, "/");
  return `${root}${shell}`;
}

const PROBE_TIMEOUT_MS = 4_000;
const PROBE_RETRIES = 3;
const PROBE_RETRY_DELAY_MS = 800;
/** Login pages must not block on a slow public /health — one quick try only. */
const LOGIN_PROBE_TIMEOUT_MS = 2_000;
const LOGIN_PROBE_RETRIES = 1;

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

/** Probe whether the ERP SPA shell is reachable on this origin. */
export async function probeErpOrigin(origin: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const url = erpShellProbeUrl(origin);
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) return true;
    // Some proxies disallow HEAD — fall back to a tiny GET.
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetch(url, { method: "GET", cache: "no-store" });
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/** Retry the public probe — avoids redirecting on a single slow packet. */
export async function probeErpOriginWithRetries(
  origin: string,
  retries = PROBE_RETRIES,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (await probeErpOrigin(origin, timeoutMs)) return true;
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

/** Login/portal pages mount immediately — probe runs in the background. */
export function shouldDeferConnectivityProbe(): boolean {
  return true;
}

/** True on the public ERP domain (caredeoghar.com) — show LAN login shortcuts. */
export function isOnPublicErpOrigin(): boolean {
  return currentConnectivityKind() === "public";
}

/** LAN staff-login URL — the path confirmed working on clinic NAS (:8888). */
export function buildLanStaffLoginUrl(lanHost?: string): string {
  const root = erpLanOriginForHost(lanHost ?? preferredLanHost()).replace(/\/+$/, "");
  return `${root}/portal/staff-login`;
}

/** All LAN staff-login URLs (primary + optional alt NAS IP). */
export function buildLanStaffLoginOptions(): { host: string; url: string }[] {
  const preferred = preferredLanHost();
  return lanHostAlternates()
    .map((host) => ({ host, url: buildLanStaffLoginUrl(host) }))
    .sort((a, b) => {
      if (a.host === preferred) return -1;
      if (b.host === preferred) return 1;
      return 0;
    });
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
  const preferred = preferredLanHost();
  const options = lanHostAlternates().map((host) => ({
    host,
    url: buildLanFailoverUrl(host),
  }));
  // Surface the last working NAS IP first on this workstation.
  return options.sort((a, b) => {
    if (a.host === preferred) return -1;
    if (b.host === preferred) return 1;
    return 0;
  });
}

/** Last LAN host that worked on this PC (for login-page hint). */
export function getLastWorkingLanHost(): string | null {
  return getLastWorkingLanHostFromProfiles();
}

/** Build the public ERP URL for the current page. */
export function buildPublicErpUrl(): string {
  const pubRoot = erpPublicOrigin().replace(/\/+$/, "");
  const path = erpPathFromBrowser();
  const suffix = path === "/" ? "/" : path;
  return `${pubRoot}${suffix}${window.location.search}`;
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

function notifyConnectivityProbeDone(): void {
  try {
    window.dispatchEvent(new CustomEvent(ERP_CONNECTIVITY_PROBE_DONE_EVENT));
  } catch {
    /* SSR */
  }
}

/** Synchronous path repair + session hash — safe before first React paint. */
export function runErpConnectivitySyncInit(): void {
  hydrateNetworkSettingsFromCache();
  repairDoubledErpPath();
  consumeSessionTransferHash();
}

async function runPublicConnectivityProbe(loginPage: boolean): Promise<void> {
  const publicOk = await probeErpOriginWithRetries(
    window.location.origin,
    loginPage ? LOGIN_PROBE_RETRIES : PROBE_RETRIES,
    loginPage ? LOGIN_PROBE_TIMEOUT_MS : PROBE_TIMEOUT_MS,
  );
  if (publicOk) {
    window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "public");
    window.sessionStorage.removeItem(ERP_PUBLIC_PROBE_FAILED_KEY);
    notifyConnectivityProbeDone();
    return;
  }

  // Never auto-redirect off caredeoghar.com — a bad probe (e.g. /health not
  // proxied on the public reverse proxy) used to hijack every page load. Staff
  // pick the LAN URL manually when the banner/links appear.
  window.sessionStorage.setItem(ERP_PUBLIC_PROBE_FAILED_KEY, "1");
  window.sessionStorage.setItem(ERP_CONNECTIVITY_MODE_KEY, "public_unavailable");
  notifyConnectivityProbeDone();
}

/**
 * Run once after React mounts (background). Never redirects — only sets
 * session flags so the UI can offer manual LAN links when needed.
 */
export async function runErpConnectivityBootstrap(): Promise<void> {
  runErpConnectivitySyncInit();

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

  await runPublicConnectivityProbe(isLoginOrPortalPath());
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
