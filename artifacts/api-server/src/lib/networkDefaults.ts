/**
 * networkDefaults.ts — Single source of truth for network host/port fallbacks.
 *
 * GOVERNANCE (DEVELOPMENT_PRINCIPLES.md — "Never Hardcode"):
 * Before this module, the LAN IP, Tailscale IP, and public domain were
 * hardcoded in ~10 backend files. They now live HERE ONLY, and every value
 * is overridable via environment variables (see .env.example).
 *
 * Priority order used across the system remains unchanged:
 *   1. Admin settings in the database (pacs_settings table)
 *   2. Environment variables (below)
 *   3. The defaults in this file (identical to the previous hardcoded
 *      values, so behavior is byte-for-byte preserved on existing deployments)
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Clinic LAN address of the Synology NAS (Orthanc, OHIF, ERP all live here). */
export const NETWORK_LAN_HOST =
  process.env.NETWORK_LAN_HOST || "172.16.1.139";

/** Tailscale VPN address of the same NAS, for remote reading from home. */
export const NETWORK_TAILSCALE_HOST =
  process.env.NETWORK_TAILSCALE_HOST || "100.65.255.115";

/** Public domain (Cloudflare-fronted). No scheme, no path. */
export const NETWORK_PUBLIC_DOMAIN =
  process.env.NETWORK_PUBLIC_DOMAIN || "caredeoghar.com";

/** Full public base URL. PUBLIC_BASE_URL (existing var) still wins if set. */
export const NETWORK_PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  `https://${NETWORK_PUBLIC_DOMAIN}`;

/** Standard service ports on the NAS. */
export const ORTHANC_HTTP_PORT = intFromEnv("ORTHANC_HTTP_PORT", 8042);
export const ORTHANC_DICOM_PORT = intFromEnv("ORTHANC_DICOM_PORT", 4242);
export const OHIF_HTTP_PORT = intFromEnv("OHIF_HTTP_PORT", 3010);
export const ERP_HTTP_PORT = intFromEnv("ERP_HTTP_PORT", 8888);
export const CONQUEST_DICOM_PORT = intFromEnv("CONQUEST_DICOM_PORT", 5678);

/** Convenience builders (LAN defaults, matching previous hardcoded strings). */
export const DEFAULT_ORTHANC_BASE_URL = `http://${NETWORK_LAN_HOST}:${ORTHANC_HTTP_PORT}`;
/**
 * Legacy LAN HTTP OHIF origin (`http://<NAS>:3010`).
 * Still used for same-origin OHIF-nginx `/dicom-web` proxy defaults and any
 * non-browser tooling that talks to the container port directly.
 * Do NOT use this as the browser-facing OHIF viewer base — HTTPS ERP pages
 * cannot embed plain HTTP, and "Load Clinic Viewer Defaults" must not revert
 * production to an IP:port URL.
 */
export const DEFAULT_OHIF_BASE_URL = `http://${NETWORK_LAN_HOST}:${OHIF_HTTP_PORT}`;

function resolveOhifBrowserBaseUrl(): string {
  const dedicated =
    process.env.OHIF_PUBLIC_BASE_URL?.trim() ||
    process.env.OHIF_BROWSER_BASE_URL?.trim();
  if (dedicated) return dedicated.replace(/\/+$/, "");
  // OHIF_URL is historically the browser-facing viewer URL, but clinic
  // deployments often still set it to http://<LAN>:3010. Only reuse it when
  // it is already HTTPS so load-defaults cannot reintroduce mixed content.
  const ohifUrl = process.env.OHIF_URL?.trim();
  if (ohifUrl && /^https:\/\//i.test(ohifUrl)) return ohifUrl.replace(/\/+$/, "");
  return "https://ohif.caredeoghar.com";
}

/**
 * Browser-facing OHIF base (Synology HTTPS reverse proxy + Pi-hole split DNS).
 * Override with OHIF_PUBLIC_BASE_URL or OHIF_BROWSER_BASE_URL. HTTPS OHIF_URL
 * is accepted; plain-HTTP OHIF_URL is ignored for this default.
 */
export const DEFAULT_OHIF_BROWSER_BASE_URL = resolveOhifBrowserBaseUrl();
export const DEFAULT_ERP_BASE_URL = `http://${NETWORK_LAN_HOST}:${ERP_HTTP_PORT}`;
export const DEFAULT_WADO_URL = `${DEFAULT_ORTHANC_BASE_URL}/wado`;
export const DEFAULT_DICOMWEB_URL = `${DEFAULT_ORTHANC_BASE_URL}/dicom-web`;

/**
 * Values written by POST /api/radiology/pacs-settings/load-defaults.
 * `ohif_base_url` is the HTTPS clinic hostname; `dicom_web_base_url` stays on
 * the LAN OHIF nginx proxy (`:3010/dicom-web` → Orthanc). Do not point
 * DICOMweb at `https://ohif.caredeoghar.com/dicom-web` unless that path is
 * confirmed on the Synology RP (Cloudflare currently 404s it).
 */
export const DEFAULT_VIEWER_SETTINGS: Record<string, string> = {
  ohif_base_url: DEFAULT_OHIF_BROWSER_BASE_URL,
  dicom_web_base_url: `${DEFAULT_OHIF_BASE_URL}/dicom-web`,
  ohif_study_url_template:
    "{OHIF_BASE_URL}/viewer?StudyInstanceUIDs={studyInstanceUID}",
  wado_uri_base_url: DEFAULT_WADO_URL,
  weasis_manifest_url_template: `weasis://$dicom:get -w "${DEFAULT_WADO_URL}?requestType=WADO&studyUID={studyInstanceUID}&contentType=application/dicom"`,
  pacs_ip: NETWORK_LAN_HOST,
  pacs_port: "4242",
  pacs_ae_title: "ORTHANC2",
  viewer_mode: "BOTH",
  default_viewer: "WEASIS",
  ohif_enabled: "true",
  weasis_enabled: "true",
};
