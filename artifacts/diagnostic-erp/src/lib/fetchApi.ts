import { ERP_SESSION_KEY, type StaffSession, clearStaffSession } from "./staffSession";
import { executeDraftRescue } from "./draftRescue";

export function getStaffToken(): string | null {
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

// Server error messages that unambiguously mean the STAFF SESSION ITSELF is
// dead — the token is invalid, expired, idle-timed-out, or the underlying
// account was deactivated (see api-server requireStaffAuth). When the server
// returns any of these on ANY endpoint, every subsequent authenticated
// request will fail the same way, so the only correct response is to clear
// the session and send the user back to the login page — regardless of which
// endpoint surfaced it. Without this, a stale token in localStorage lets the
// app render the authenticated shell (which then fails to load its data with
// an inline "please log in again" error) instead of showing the login page.
//
// This is deliberately distinct from a permission error (403) or an
// auth-layer-mismatch 401 (e.g. "Staff authentication required" from a route
// that mounts the wrong middleware): those must NOT destroy the session, so
// they are matched by neither the path allowlist nor these markers.
const SESSION_DEAD_MARKERS = [
  "invalid or expired staff session",
  "session expired due to inactivity",
  "staff account is inactive or no longer exists",
];

export function isSessionDeadMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return SESSION_DEAD_MARKERS.some(marker => m.includes(marker));
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

// Thrown only when every retry above was exhausted without ever getting a
// response back (LAN/NAS unreachable) — never for a 4xx/5xx the server
// actually answered with. Callers that need to fall back to an offline queue
// (see offlineBillingQueue.ts) match on this instead of parsing err.message.
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

// After a NETWORK-level failure (no response at all), wait for connectivity
// to return before burning the next retry — capped so a browser that
// misreports navigator.onLine (common on LAN-only clinic PCs with no internet
// uplink) can't stall a retry for long. Never called before the first
// attempt, and never after an HTTP error (a status code proves the server is
// reachable regardless of what navigator.onLine claims).
const RETRY_ONLINE_WAIT_MS = 8_000;
function waitForOnline(maxMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = () => { window.removeEventListener("online", handler); resolve(); };
    window.addEventListener("online", handler);
    setTimeout(() => { window.removeEventListener("online", handler); resolve(); }, maxMs);
  });
}

// Shared retry pacing + DevTools breadcrumb for both retry classes (network
// throw and 5xx gateway status) so silent retry delays stay diagnosable and
// the two paths cannot drift apart.
async function backoffBeforeRetry(path: string, init: RequestInit | undefined, attempt: number, reason: string, networkLevelFailure: boolean): Promise<void> {
  const delay = retryDelay(attempt);
  console.warn(`[fetchApi] ${init?.method ?? "GET"} ${path} ${reason} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${Math.round(delay)}ms`);
  await sleep(delay);
  if (networkLevelFailure && !navigator.onLine) {
    await waitForOnline(RETRY_ONLINE_WAIT_MS);
  }
}

async function doFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { headers: buildHeaders(init), ...init });
}

// Shared by fetchApi (below) and fetchApiBlob: the auth/retry/error-handling
// core, returning the raw successful Response so each caller reads the body
// its own way (text/JSON vs. binary).
async function fetchWithRetry(path: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // ALWAYS attempt the request, even when navigator.onLine is false. The
    // ERP talks to a LAN server: browsers routinely report "offline" on
    // clinic PCs with no internet uplink (or with VPN/virtual adapters) while
    // the NAS is perfectly reachable. The old behaviour — sleeping up to 10s
    // BEFORE every attempt, including the first — silently added ~10s to
    // every request (~20s per bill save) on such machines. The offline signal
    // is now consulted only between retries after a real network failure
    // (see backoffBeforeRetry).
    let res: Response | undefined;
    try {
      res = await doFetch(path, init);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        await backoffBeforeRetry(path, init, attempt, "failed with a network error", true);
        continue;
      }
      // Last attempt or non-transient: surface the original network error
      throw new NetworkError(
        navigator.onLine
          ? "Server not responding — please check your connection and try again."
          : "No internet connection — waiting for network to return."
      );
    }

    if (!res.ok) {
      // Retry on gateway errors only. No online-wait here: an HTTP status
      // means the server answered, so connectivity is proven.
      if (attempt < MAX_RETRIES && isTransientError(null, res.status)) {
        await backoffBeforeRetry(path, init, attempt, `got ${res.status}`, false);
        continue;
      }

      const text = await res.text();
      let parsed: { error?: string; message?: string } = {};
      try { parsed = JSON.parse(text); } catch { /* empty body or non-JSON error */ }
      const message = parsed.error || parsed.message || text || res.statusText;

      // A 401 expires the session when it comes from a genuine session
      // endpoint OR when the server explicitly signals the session is dead
      // (via the error body) on ANY other endpoint. The latter covers the
      // stale-tab case: a leftover token in localStorage passes the client
      // guard, but the first authenticated request the page fires comes back
      // "invalid or expired staff session" — we clear it and redirect to the
      // login page rather than leaving the stale authenticated shell up.
      if (res.status === 401 && (isSessionAuthPath(path) || isSessionDeadMessage(message))) {
        handleSessionExpiry();
      }
      throw new Error(message);
    }

    return res;
  }

  // Should never reach here, but TypeScript needs a return path
  throw lastErr ?? new Error("Request failed after retries");
}

export async function fetchApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithRetry(path, init);
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

// Same auth/retry/error handling as fetchApi, but reads the body as a Blob
// instead of text/JSON — for binary responses (generated PDFs, etc.) where
// fetchApi's res.text() would corrupt the bytes by decoding them as UTF-8.
export async function fetchApiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetchWithRetry(path, init);
  return res.blob();
}

// Downloads a staff-authed file (CSV/JSON/generated script exports, etc.) as
// a save-file dialog with the given filename. A plain `window.open(url)` /
// `<a href>` navigation to one of these routes can never carry
// Authorization: Bearer <token> (this app has no cookie-session fallback),
// so it 401s instead of downloading — fetches the file as an authenticated
// Blob first, then triggers the download via a synthetic <a download>.
export async function downloadAuthenticatedFile(path: string, filename: string): Promise<void> {
  const blob = await fetchApiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  get: <T>(path: string) => fetchApi<T>(path),
  getBlob: (path: string) => fetchApiBlob(path),
  downloadFile: (path: string, filename: string) => downloadAuthenticatedFile(path, filename),
  post: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    fetchApi<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    fetchApi<T>(path, { method: "DELETE", ...(body ? { body: JSON.stringify(body) } : {}) }),
};
