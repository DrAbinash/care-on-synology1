import { ERP_SESSION_KEY, type StaffSession, clearStaffSession } from "./staffSession";

function getStaffToken(): string | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(ERP_SESSION_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffSession;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

function buildHeaders(init?: RequestInit): Record<string, string> {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  const token = getStaffToken();
  if (token) base["Authorization"] = `Bearer ${token}`;
  return { ...base, ...(init?.headers as Record<string, string> | undefined) };
}

// When the server returns 401 on a GENUINE session endpoint, clear the session
// and redirect back to the portal login page so the user sees a clear message.
//
// IMPORTANT: Only portal/session management endpoints should trigger this.
// A 401 from ANY other endpoint (internal APIs, permission-gated routes,
// feature endpoints) must NOT clear the session or redirect. Those errors
// must surface as toasts/error states only, without destroying the user session.
function handleSessionExpiry(): void {
  clearStaffSession();
  try { window.localStorage.removeItem("portal_staff_session"); } catch { /* ignore */ }
  const base = (import.meta as { env: { BASE_URL: string } }).env.BASE_URL || "/";
  const portalUrl = `${base}portal`.replace(/\/+/g, "/").replace(":/", "://");
  // Only redirect if not already on the portal page to avoid redirect loops.
  if (!window.location.pathname.includes("/portal")) {
    window.location.href = portalUrl;
  }
}

// Only these paths legitimately expire a staff session on 401.
// All other paths (including /api/internal/*, /api/radiology/*, etc.)
// returning 401 are auth-layer mismatches that must NOT log the user out.
const SESSION_AUTH_PATHS = [
  "/api/portal/staff-login",
  "/api/portal/staff-session",
  "/api/portal/refresh",
  "/api/staff/me",
];

function isSessionAuthPath(path: string): boolean {
  return SESSION_AUTH_PATHS.some(p => path.includes(p));
}

export async function fetchApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: buildHeaders(init),
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401) {
      // ONLY clear session when a session-management endpoint returns 401.
      // This covers: staff-login, session validation, session refresh.
      // Internal API endpoints (/api/internal/*), feature APIs returning 401
      // due to INTERNAL_API_KEY mismatch, and permission-gated module APIs
      // must NOT trigger logout — they are surfaced as error messages.
      if (isSessionAuthPath(path)) {
        handleSessionExpiry();
      }
      // For all other 401s: fall through and throw the error.
      // The calling React Query query/mutation will handle it (toast, etc.).
    }
    const text = await res.text();
    let parsed: { error?: string; message?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* empty body or non-JSON error */ }
    throw new Error(parsed.error || parsed.message || text || res.statusText);
  }
  // Some successful responses (e.g. legacy empty JSON bodies) may not contain
  // valid JSON. Gracefully fall back so the UI doesn't crash.
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    fetchApi<T>(path, { method: "DELETE", ...(body ? { body: JSON.stringify(body) } : {}) }),
};
