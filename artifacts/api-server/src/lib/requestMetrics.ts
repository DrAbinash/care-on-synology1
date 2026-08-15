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

export type LatencySummary = {
  count: number;
  slowCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  avgMs: number | null;
};

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

/** Nearest-rank percentile on a pre-sorted ascending array. */
export function percentileNearestRank(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (p <= 0) return sortedAsc[0]!;
  if (p >= 100) return sortedAsc[sortedAsc.length - 1]!;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, rank))]!;
}

export function summarizeDurations(durationsMs: number[], slowThresholdMs = SLOW_THRESHOLD_MS): LatencySummary {
  if (durationsMs.length === 0) {
    return { count: 0, slowCount: 0, p50Ms: null, p95Ms: null, maxMs: null, avgMs: null };
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const total = sorted.reduce((s, n) => s + n, 0);
  return {
    count: sorted.length,
    slowCount: sorted.filter((n) => n > slowThresholdMs).length,
    p50Ms: percentileNearestRank(sorted, 50),
    p95Ms: percentileNearestRank(sorted, 95),
    maxMs: sorted[sorted.length - 1]!,
    avgMs: Math.round(total / sorted.length),
  };
}

/** Paths as recorded under app.use("/api", …) — no /api prefix. */
export function isBillSavePath(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  const p = path.split("?")[0] || "";
  return p === "/bills" || p === "/bills/";
}

export function isPatientSearchPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  const p = path.split("?")[0] || "";
  return p === "/patients" || p === "/patients/";
}

export function getRequestsSince(sinceMs: number): RequestLogEntry[] {
  return recent.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= sinceMs;
  });
}

export function getLatencyForMatcher(
  match: (method: string, path: string) => boolean,
  windowMs: number,
  nowMs = Date.now(),
): LatencySummary {
  const since = nowMs - windowMs;
  const durations = getRequestsSince(since)
    .filter((r) => match(r.method, r.path))
    .map((r) => r.durationMs);
  return summarizeDurations(durations);
}

export function getRequestsPerMinute(nowMs = Date.now()): number {
  return getRequestsSince(nowMs - 60_000).length;
}

export function getSlowEndpointsInWindow(windowMs: number, limit = 8, nowMs = Date.now()): Array<{
  method: string;
  path: string;
  count: number;
  slowCount: number;
  p95Ms: number | null;
  maxMs: number | null;
}> {
  const since = nowMs - windowMs;
  const byKey = new Map<string, number[]>();
  for (const r of getRequestsSince(since)) {
    const key = `${r.method} ${r.path}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r.durationMs);
    byKey.set(key, arr);
  }
  const rows = [...byKey.entries()].map(([key, durations]) => {
    const [method, ...rest] = key.split(" ");
    const summary = summarizeDurations(durations);
    return {
      method: method || "?",
      path: rest.join(" ") || "/",
      count: summary.count,
      slowCount: summary.slowCount,
      p95Ms: summary.p95Ms,
      maxMs: summary.maxMs,
    };
  });
  return rows
    .filter((r) => r.slowCount > 0 || (r.p95Ms != null && r.p95Ms >= SLOW_THRESHOLD_MS))
    .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
    .slice(0, limit);
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
