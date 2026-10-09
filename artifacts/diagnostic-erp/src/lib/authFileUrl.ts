import { getStaffToken } from "./fetchApi";

/**
 * Append the staff session token to a same-origin file URL.
 *
 * `<img>`, `EventSource` and bare `fetch()` cannot attach an
 * `Authorization: Bearer` header, so the routes that serve clinical files
 * accept the session token as `?staffToken=` — the convention already used by
 * the worklist SSE stream, expense attachments and the ERP DICOMweb proxy
 * (`lib/browserDicomWeb.ts`). This is the shared version for file URLs.
 *
 * Idempotent: an URL that already carries a token is returned unchanged, so a
 * component that re-wraps a prop it wrapped one render earlier cannot produce
 * `?staffToken=a&staffToken=b`.
 */
export function withStaffToken(path: string | null | undefined): string {
  const target = (path ?? "").trim();
  if (!target) return "";
  const token = getStaffToken();
  if (!token) return target;
  if (/[?&]staffToken=/.test(target)) return target;
  const sep = target.includes("?") ? "&" : "?";
  return `${target}${sep}staffToken=${encodeURIComponent(token)}`;
}
