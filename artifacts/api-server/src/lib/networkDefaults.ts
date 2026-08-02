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
export const DEFAULT_OHIF_BASE_URL = `http://${NETWORK_LAN_HOST}:${OHIF_HTTP_PORT}`;
export const DEFAULT_ERP_BASE_URL = `http://${NETWORK_LAN_HOST}:${ERP_HTTP_PORT}`;
export const DEFAULT_WADO_URL = `${DEFAULT_ORTHANC_BASE_URL}/wado`;
export const DEFAULT_DICOMWEB_URL = `${DEFAULT_ORTHANC_BASE_URL}/dicom-web`;
