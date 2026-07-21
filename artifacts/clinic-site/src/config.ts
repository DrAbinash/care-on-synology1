// Build-time configuration for portable hosting.
// On Replit (default) both values stay empty so the site uses same-origin
// requests via the shared proxy. When deploying to a third-party host where
// the API lives on a different domain, set these in `.env.production`:
//
//   VITE_API_BASE_URL=https://api.your-clinic.example
//   VITE_ASSET_BASE_URL=https://api.your-clinic.example
//
// Both should be the public origin of the api-server. They are baked into
// the static bundle at build time.

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, "");

export const API_BASE = stripTrailingSlash(
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "",
);

export const ASSET_BASE = stripTrailingSlash(
  (import.meta.env.VITE_ASSET_BASE_URL as string | undefined) ??
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    "",
);

/**
 * Resolve a CMS-stored URL. Absolute URLs (http://, https://, data:, mailto:,
 * tel:) are returned unchanged. Root-relative paths (e.g. "/uploads/x.png")
 * are prefixed with ASSET_BASE so they resolve when the site is hosted on a
 * different origin than the API/uploads server.
 *
 * Object-storage paths ("/objects/...") are also prefixed with the API base
 * so they hit the `/api/storage/objects/*` serving route.
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (/^([a-z]+:)?\/\//i.test(url) || /^(data|mailto|tel):/i.test(url)) return url;
  if (url.startsWith("/objects/")) return `${ASSET_BASE}/api/storage${url}`;
  if (url.startsWith("/")) return `${ASSET_BASE}${url}`;
  return url;
}
