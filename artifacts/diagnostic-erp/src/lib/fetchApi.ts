import { ERP_SESSION_KEY, type StaffSession, clearStaffSession } from "./staffSession";
import { executeDraftRescue } from "./draftRescue";

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
  // Save any in-progress report draft before destroying the session.
  // This prevents losing dictation text when the JWT expires mid-read.
  executeDraftRescue();
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

// ── Network retry helpers ────────────────────────────────────────────────────
//
// fetchApi retries automatically on transient network failures (fetch throws,
// no response received, or 502/503/504 from the server). This covers:
//   - LAN drop: fetch() rejects with TypeError "Failed to fetch"
//   - Server restart: 502/503 while the container comes back up
//   - Slow internet: request takes longer than the browser's default timeout
//
// Retries are NOT performed on 4xx errors (bad request, auth, validation) —
// those are deterministic and retrying would not help.
//
// Each retry uses exponential backoff with jitter so concurrent requests don't
// all slam the server at the same time when it comes back online.
//
// With clientRef idempotency on /api/orders and /api/bills, retrying a
// timed-out bill creation is safe — the server returns the already-created
// bill rather than producing a duplicate.

const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 400;  // first retry after ~400ms
const MAX_DELAY_MS  = 8000; // cap at 8s

function isTransientError(err: unknown, status?: number): boolean {
  // Network-level failure (no response): TypeError from fetch()
  if (err instanceof TypeError) return true;
  // Server-side transient: gateway errors and service unavailable
  if (status === 502 || status === 503 || status === 504) return true;
  return false;
}

function retryDelay(attempt: number): number {
  // Exponential backoff: 400ms, 800ms, 1600ms … capped at 8s, with ±20% jitter
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  return base * (0.8 + Math.random() * 0.4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { headers: buildHeaders(init), ...init });
}

export async function fetchApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Bail immediately if the browser reports no connectivity — no point
    // hammering the server when the LAN cable is literally unplugged.
    if (!navigator.onLine) {
      // Wait up to 10s for connectivity to return before giving up
      await new Promise<void>((resolve) => {
        const handler = () => { window.removeEventListener("online", handler); resolve(); };
        window.addEventListener("online", handler);
        setTimeout(() => { window.removeEventListener("online", handler); resolve(); }, 10_000);
      });
    }

    let res: Response | undefined;
    try {
      res = await doFetch(path, init);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        await sleep(retryDelay(attempt));
        continue;
      }
      // Last attempt or non-transient: surface the original network error
      throw new Error(
        navigator.onLine
          ? "Server not responding — please check your connection and try again."
          : "No internet connection — waiting for network to return."
      );
    }

    if (!res.ok) {
      // Retry on gateway errors only
      if (attempt < MAX_RETRIES && isTransientError(null, res.status)) {
        await sleep(retryDelay(attempt));
        continue;
      }

      if (res.status === 401) {
        if (isSessionAuthPath(path)) handleSessionExpiry();
      }
      const text = await res.text();
      let parsed: { error?: string; message?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* empty body or non-JSON error */ }
      throw new Error(parsed.error || parsed.message || text || res.statusText);
    }

    // Success
    const text = await res.text();
    if (!text.trim()) return {} as T;
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  // Should never reach here, but TypeScript needs a return path
  throw lastErr ?? new Error("Request failed after retries");
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
