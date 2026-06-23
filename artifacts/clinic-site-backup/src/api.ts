import type { SiteSettings, Page, Faq, Photo, Popup } from "./types";
import { API_BASE } from "./config";

let _previewToken = "";

export function setPreviewToken(token: string) {
  _previewToken = token;
}

function appendPreview(urlPath: string): string {
  if (!_previewToken) return urlPath;
  const sep = urlPath.includes("?") ? "&" : "?";
  return `${urlPath}${sep}preview_token=${encodeURIComponent(_previewToken)}`;
}

async function get<T>(path: string): Promise<T> {
  const url = API_BASE ? `${API_BASE}${path}` : path;
  const credentials: RequestCredentials = API_BASE ? "omit" : "same-origin";
  const res = await fetch(url, { credentials });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  settings:      () => get<SiteSettings>(appendPreview("/api/website/settings")),
  pages:         () => get<{ pages: Page[] }>(appendPreview("/api/website/pages")),
  page:          (id: number) => get<Page>(appendPreview(`/api/website/pages/${id}`)),
  faqs:          () => get<{ faqs: Faq[] }>(appendPreview("/api/website/faqs")),
  photos:        (category?: string) => get<{ photos: Photo[] }>(appendPreview(`/api/website/photos${category && category !== "general" ? `?category=${encodeURIComponent(category)}` : ""}`)),
  popups:        () => get<{ popups: Popup[] }>(appendPreview("/api/website/popups")),
  verifyPreview: (token: string) => get<{ valid: boolean }>(`/api/website/verify-preview?token=${encodeURIComponent(token)}`),
};
