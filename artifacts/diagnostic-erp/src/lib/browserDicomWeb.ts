/**
 * Same-origin DICOMweb base for browser QIDO/WADO used by Report Images /
 * Print Images. Proxied through the ERP API (staff session + Orthanc auth)
 * so it works even when Orthanc :8042 is blocked by CORS / Basic auth from
 * the SPA — while the OHIF iframe can still use its own /dicom-web proxy.
 *
 * Raw `fetch()` / `<img src>` to this path 401s because staff auth is Bearer
 * (no cookie session). Every browser QIDO/WADO call must attach the token.
 */
import { getStaffToken } from "./fetchApi";

export const BROWSER_DICOMWEB_BASE = "/api/radiology/dicom-web";

function isErpDicomWebUrl(url: string): boolean {
  return url.includes("/api/radiology/dicom-web");
}

/** Headers for QIDO JSON against the ERP DICOMweb proxy. */
export function dicomWebHeaders(accept = "application/dicom+json"): HeadersInit {
  const headers: Record<string, string> = { Accept: accept };
  const token = getStaffToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function dicomWebFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(dicomWebHeaders());
  if (init?.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }
  const token = getStaffToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * `<img src>` cannot send Authorization. The staff-auth middleware already
 * accepts `?staffToken=` (same pattern as the worklist SSE stream).
 */
export function withDicomWebAuth(url: string | null | undefined): string | null {
  if (!url) return null;
  const token = getStaffToken();
  if (!token || !isErpDicomWebUrl(url) || /[?&]staffToken=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}staffToken=${encodeURIComponent(token)}`;
}
