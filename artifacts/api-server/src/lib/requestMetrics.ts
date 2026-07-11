/**
 * requestMetrics.ts — in-memory API request metrics for the admin
 * Diagnostics page.
 *
 * WHY IN-MEMORY (not a DB table):
 *   This exists purely to help Dr. Abinash / a developer spot slow or
 *   failing endpoints. Writing a DB row on every single API request would
 *   add load to Postgres on every request — the opposite of what a
 *   performance diagnostics tool should do. A bounded in-memory ring
 *   buffer plus rolling per-endpoint aggregates costs ~nothing and needs
 *   no migration. The trade-off — history resets on container restart —
 *   is fine for a "what's slow right now" tool.
 *
 * WHAT IS NEVER RECORDED:
 *   Only method, normalized path, status code, duration (ms), and the
 *   caller's role are recorded. Request/response bodies, headers,
 *   query strings, auth tokens, and payment details are never touched
 *   by this module — see recordRequest() below, which only accepts those
 *   five primitive fields.
 */

const MAX_RECENT = 500;
const SLOW_THRESHOLD_MS = 1000;

export interface RequestLogEntry {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  role: string;
  timestamp: string; // ISO
}

interface EndpointStats {
  method: string;
  path: string; // normalized, e.g. "/api/patients/:id"
  count: number;
  totalMs: number;
  maxMs: number;
  slowCount: number; // requests over SLOW_THRESHOLD_MS
  errorCount: number; // status >= 500
}

const recent: RequestLogEntry[] = [];
const statsByKey = new Map<string, EndpointStats>();

/** Replaces numeric ID segments so /api/patients/482 and /api/patients/501
 *  aggregate under the same endpoint instead of fragmenting stats. */
export function normalizePath(rawPath: string): string {
  return rawPath
    .split("?")[0]
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) ? ":id" : seg))
    .join("/");
}

export function recordRequest(entry: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  role: string;
}): void {
  const normalized = normalizePath(entry.path);

  recent.push({
    method: entry.method,
    path: normalized,
    statusCode: entry.statusCode,
    durationMs: Math.round(entry.durationMs),
    role: entry.role || "anonymous",
    timestamp: new Date().toISOString(),
  });
  if (recent.length > MAX_RECENT) recent.shift();

  const key = `${entry.method} ${normalized}`;
  const existing = statsByKey.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += entry.durationMs;
    existing.maxMs = Math.max(existing.maxMs, entry.durationMs);
    if (entry.durationMs > SLOW_THRESHOLD_MS) existing.slowCount += 1;
    if (entry.statusCode >= 500) existing.errorCount += 1;
  } else {
    statsByKey.set(key, {
      method: entry.method,
      path: normalized,
      count: 1,
      totalMs: entry.durationMs,
      maxMs: entry.durationMs,
      slowCount: entry.durationMs > SLOW_THRESHOLD_MS ? 1 : 0,
      errorCount: entry.statusCode >= 500 ? 1 : 0,
    });
  }
}

export function getRecentRequests(limit = 200): RequestLogEntry[] {
  return recent.slice(-limit).reverse();
}

export function getEndpointStats(): Array<EndpointStats & { avgMs: number }> {
  return Array.from(statsByKey.values())
    .map((s) => ({ ...s, avgMs: Math.round(s.totalMs / s.count) }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

export function getSlowThresholdMs(): number {
  return SLOW_THRESHOLD_MS;
}

export function resetMetrics(): void {
  recent.length = 0;
  statsByKey.clear();
}
