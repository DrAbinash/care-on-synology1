import { ERP_SESSION_KEY, type StaffSession, clearStaffSession, readStaffSession } from "./staffSession";

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

// When the server returns 401 the staff session has expired. Clear it and
// redirect back to the portal login page so the user sees a clear message
// rather than mysterious "No data" / silent failures across the app.
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

export async function fetchApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: buildHeaders(init),
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401) {
      const isSuperAdminRoute = 
        path.includes("/api/super-admin") || 
        path.includes("/api/backup") || 
        path.includes("/api/system") || 
        path.includes("/api/admin/audit-logs") || 
        path.includes("/api/admin/role-permissions") || 
        path.includes("/api/admin/system-health") || 
        path.includes("/api/commission") || 
        path.includes("/api/doctor-ledger");
      if (!isSuperAdminRoute) {
        const session = readStaffSession();
        const role = session?.user?.role ? session.user.role.toLowerCase().replace(/[^a-z0-9]/g, "_").trim() : "";
        const isSuperAdmin = role === "superadmin" || role === "super" || role === "owner" || role === "super_admin";
        if (!isSuperAdmin) {
          handleSessionExpiry();
        }
      }
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
