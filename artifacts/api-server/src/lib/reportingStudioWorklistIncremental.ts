/**
 * Incremental + paginated worklist helpers for
 * GET /api/internal/reporting-studio/worklist.
 *
 * Pure helpers — unit-tested like orthancPurgePeriod (no Express / DB).
 */
export const WORKLIST_INCREMENTAL_DEFAULT_LIMIT = 200;
export const WORKLIST_INCREMENTAL_MAX_LIMIT = 500;
/** Legacy full-list hard cap (unchanged). */
export const WORKLIST_LEGACY_LIMIT = 500;

/**
 * REPORTING_WORKLIST_INCREMENTAL — default ON.
 * Off values: 0 / false / off / no (case-insensitive).
 * Rollback: set REPORTING_WORKLIST_INCREMENTAL=0 (or false) and restart api-server.
 */
export function isReportingWorklistIncrementalEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.REPORTING_WORKLIST_INCREMENTAL ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/** Epoch ms (digits only) or ISO-8601 / Date-parseable string. */
export function parseSinceWatermark(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d{10,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    // 10-digit → seconds; 13-digit → ms
    const ms = trimmed.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseWorklistLimit(
  raw: string | undefined | null,
  fallback = WORKLIST_INCREMENTAL_DEFAULT_LIMIT,
): number {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, WORKLIST_INCREMENTAL_MAX_LIMIT);
}

/** Keyset cursor on radiology_worklist.id (positive integer). */
export function parseWorklistCursor(raw: string | undefined | null): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export type IncrementalQueryInput = {
  since?: string | null;
  limit?: string | null;
  cursor?: string | null;
};

export type ParsedIncrementalQuery = {
  /** True when the client asked for the incremental envelope. */
  requested: boolean;
  since: Date | null;
  limit: number;
  cursor: number | null;
};

export function parseIncrementalQuery(input: IncrementalQueryInput): ParsedIncrementalQuery {
  const sinceRaw = input.since != null ? String(input.since).trim() : "";
  const limitRaw = input.limit != null ? String(input.limit).trim() : "";
  const cursorRaw = input.cursor != null ? String(input.cursor).trim() : "";
  const requested = Boolean(sinceRaw || limitRaw || cursorRaw);
  return {
    requested,
    since: parseSinceWatermark(sinceRaw || null),
    // When only `since`/`cursor` is sent, still page with the default limit.
    limit: parseWorklistLimit(limitRaw || null),
    cursor: parseWorklistCursor(cursorRaw || null),
  };
}

/** Effective change time: updatedAt when set, else createdAt. */
export function rowChangeAt(row: {
  updatedAt?: Date | string | null;
  createdAt: Date | string;
}): Date {
  const u = row.updatedAt;
  if (u != null && u !== "") {
    const d = u instanceof Date ? u : new Date(u);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const c = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  return c;
}

/**
 * Exclusive watermark: changeAt > since (boundary excluded).
 * Studios should send lastSyncAt − 5 minutes overlap and upsert the delta.
 */
export function isAfterSince(
  row: { updatedAt?: Date | string | null; createdAt: Date | string },
  since: Date | null,
): boolean {
  if (!since) return true;
  return rowChangeAt(row).getTime() > since.getTime();
}

export type IncrementalPageResult<T extends { id: number }> = {
  page: T[];
  nextCursor: string | null;
  truncated: boolean;
};

/**
 * In-memory keyset page (mirrors SQL: changeAt > since, id > cursor, ORDER BY id ASC).
 * Used for unit tests and the <500ms 2k-row fixture check.
 */
export function pageIncrementalRows<T extends {
  id: number;
  updatedAt?: Date | string | null;
  createdAt: Date | string;
}>(
  rows: T[],
  opts: { since: Date | null; cursor: number | null; limit: number },
): IncrementalPageResult<T> {
  const limit = Math.min(
    Math.max(1, opts.limit),
    WORKLIST_INCREMENTAL_MAX_LIMIT,
  );
  const filtered = rows
    .filter((r) => isAfterSince(r, opts.since))
    .filter((r) => (opts.cursor == null ? true : r.id > opts.cursor))
    .sort((a, b) => a.id - b.id);

  const slice = filtered.slice(0, limit + 1);
  const truncated = slice.length > limit;
  const page = truncated ? slice.slice(0, limit) : slice;
  const nextCursor =
    truncated && page.length > 0 ? String(page[page.length - 1]!.id) : null;
  return { page, nextCursor, truncated };
}

export type IncrementalWorklistResponse<T> = {
  orders: T[];
  nextCursor: string | null;
  serverTime: number;
  truncated: boolean;
};

export function buildIncrementalResponse<T>(
  orders: T[],
  nextCursor: string | null,
  truncated: boolean,
  serverTime = Date.now(),
): IncrementalWorklistResponse<T> {
  return { orders, nextCursor, serverTime, truncated };
}
