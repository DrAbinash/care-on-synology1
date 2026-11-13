/**
 * deskBillAnnouncements.ts — one owner for the question "has every bill a desk
 * printed actually reached the ledger?"
 *
 * A bill the desk could not save lives in that browser's localStorage until it
 * replays (see artifacts/diagnostic-erp/src/lib/offlineBillingQueue.ts). The desk
 * announces what it is holding BEFORE it tries to replay, into
 * desk_bill_announcements. This module answers the only question that matters
 * about those announcements, and it is deliberately the ONLY place that decides
 * it — the ops street light and the API both call here, so the page and the
 * check can never disagree about what "outstanding" means.
 *
 * Delivery is DERIVED by joining to bills on client_ref, not claimed by the
 * client. A browser that dies, gets reimaged, or lies cannot close its own
 * witness; only a real non-cancelled bill can. The partial unique index
 * bills_client_ref_uidx is built on exactly `client_ref IS NOT NULL AND status
 * IS DISTINCT FROM 'cancelled'`, which is why the join predicate says the same
 * thing — a cancelled bill is not delivery.
 *
 * The grace window exists because the announcement is intentionally earlier than
 * the delivery: a healthy reconnect announces and replays inside one tick, so an
 * announcement still unmatched after `graceMinutes` is not "in flight", it is
 * stuck.
 *
 * Age is measured from first_announced_at, never last_announced_at. A desk with
 * a queue it cannot deliver re-announces that same queue on every 5-second sync
 * tick, so last_announced_at is always fresh — measured from it, a bill that has
 * been stuck for two days would be "0 minutes old" and this light would sit
 * green over exactly the outage it exists to catch. last_announced_at still
 * matters, as the desk's own statement that it holds the bill: a witness whose
 * last announcement is days old means that browser has stopped saying anything.
 */

import type { QueryFn } from "./operationsChecks";

export type DeskBillOutstandingRow = {
  clientRef: string;
  provisionalBillNumber: string | null;
  patientId: number | null;
  testCount: number;
  totalAmount: number;
  workstation: string | null;
  announcedBy: string | null;
  minutesUnsynced: number;
  lastError: string | null;
};

export type DeskBillWitnessSummary = {
  /** False when the witness table itself is absent (a DB that never ran the feature migration). */
  tablePresent: boolean;
  /** Rows ever recorded, any state — separates "nothing was announced" from "nothing was outstanding". */
  announcedTotal: number;
  outstandingCount: number;
  outstandingAmount: number;
  /** Age of the oldest outstanding announcement; null when nothing is outstanding. */
  oldestMinutes: number | null;
  rows: DeskBillOutstandingRow[];
};

/** Announcement age below which an unmatched client_ref is still just "in flight". */
export const DEFAULT_ANNOUNCE_GRACE_MINUTES = 20;

/** How many outstanding rows one caller may be handed. The count is always complete. */
export const DEFAULT_ANNOUNCE_ROW_LIMIT = 50;

const EMPTY: Omit<DeskBillWitnessSummary, "tablePresent"> = {
  announcedTotal: 0,
  outstandingCount: 0,
  outstandingAmount: 0,
  oldestMinutes: null,
  rows: [],
};

/**
 * Values interpolated into SQL text are limited to sanitized integers. Both
 * callers take these from env/threshold config rather than from a request, but
 * the predicate is what makes inlining safe regardless.
 */
function sanitizeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Postgres 42P01 — the table is not there. Anything else is a real fault and must propagate. */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return code === "42P01" || (message.includes("desk_bill_announcements") && message.includes("does not exist"));
}

export async function summarizeDeskBillWitnesses(
  query: QueryFn,
  opts: { graceMinutes?: number; rowLimit?: number } = {},
): Promise<DeskBillWitnessSummary> {
  const grace = sanitizeInt(opts.graceMinutes ?? DEFAULT_ANNOUNCE_GRACE_MINUTES, DEFAULT_ANNOUNCE_GRACE_MINUTES, 0, 1440);
  const limit = sanitizeInt(opts.rowLimit ?? DEFAULT_ANNOUNCE_ROW_LIMIT, DEFAULT_ANNOUNCE_ROW_LIMIT, 1, 500);

  // Shared predicate: announced, still pending, older than the grace window, and
  // with no non-cancelled bill carrying the same client_ref.
  const openWhere = `
    a.state = 'pending'
    AND a.first_announced_at < NOW() - (${grace} * INTERVAL '1 minute')
    AND NOT EXISTS (
      SELECT 1 FROM bills b
      WHERE b.client_ref = a.client_ref AND b.status <> 'cancelled'
    )`;

  let totals: Array<Record<string, unknown>>;
  try {
    totals = await query(
      `SELECT
         (SELECT count(*) FROM desk_bill_announcements)::int AS announced_total,
         count(a.id)::int AS outstanding_count,
         COALESCE(sum(a.total_amount), 0)::numeric AS outstanding_amount,
         EXTRACT(EPOCH FROM (NOW() - min(a.first_announced_at)))::int AS oldest_seconds
       FROM desk_bill_announcements a
       WHERE ${openWhere}`,
    );
  } catch (err) {
    if (isMissingTable(err)) return { tablePresent: false, ...EMPTY };
    throw err;
  }

  const t = totals[0] ?? {};
  const summary: DeskBillWitnessSummary = {
    tablePresent: true,
    announcedTotal: Number(t.announced_total ?? 0),
    outstandingCount: Number(t.outstanding_count ?? 0),
    outstandingAmount: Number(t.outstanding_amount ?? 0),
    oldestMinutes:
      t.outstanding_count == null || Number(t.outstanding_count) === 0
        ? null
        : Math.max(0, Math.round(Number(t.oldest_seconds ?? 0) / 60)),
    rows: [],
  };

  if (summary.outstandingCount === 0) return summary;

  const rows = await query(
    `SELECT
       a.client_ref,
       a.provisional_bill_number,
       a.patient_id,
       a.test_count,
       a.total_amount,
       a.workstation,
       a.announced_by,
       a.last_error,
       EXTRACT(EPOCH FROM (NOW() - a.first_announced_at))::int AS unsynced_seconds
     FROM desk_bill_announcements a
     WHERE ${openWhere}
     ORDER BY a.first_announced_at ASC
     LIMIT ${limit}`,
  );

  summary.rows = rows.map((r) => ({
    clientRef: String(r.client_ref),
    provisionalBillNumber: r.provisional_bill_number == null ? null : String(r.provisional_bill_number),
    patientId: r.patient_id == null ? null : Number(r.patient_id),
    testCount: Number(r.test_count ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    workstation: r.workstation == null ? null : String(r.workstation),
    announcedBy: r.announced_by == null ? null : String(r.announced_by),
    minutesUnsynced: Math.max(0, Math.round(Number(r.unsynced_seconds ?? 0) / 60)),
    lastError: r.last_error == null ? null : String(r.last_error),
  }));

  return summary;
}

/**
 * The announcement the desk sends is client-supplied, so it is coerced here
 * rather than trusted: an unusable client_ref would poison the unique index and
 * a hostile amount would only distort an alarm, so both are refused cheaply.
 */
export type DeskAnnouncementInput = {
  clientRef: string;
  state: "pending" | "withdrawn";
  provisionalBillNumber: string | null;
  patientId: number | null;
  testCount: number;
  totalAmount: number;
  workstation: string | null;
  lastError: string | null;
};

const CLIENT_REF_MAX_LEN = 64;
const PROVISIONAL_MAX_LEN = 40;

/** null = this item is not announceable and should be skipped, not a request failure. */
export function coerceAnnouncement(raw: unknown): DeskAnnouncementInput | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const clientRef = typeof b.clientRef === "string" ? b.clientRef.trim() : "";
  if (clientRef.length === 0 || clientRef.length > CLIENT_REF_MAX_LEN) return null;

  const asInt = (v: unknown, max: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : 0;
  };
  const asAmount = (v: unknown): number => {
    const n = Number(v);
    // A bill is money, and a witness alarm must not be inflated by garbage.
    return Number.isFinite(n) && n > 0 ? Math.min(10_000_000, Math.round(n * 100) / 100) : 0;
  };
  const asText = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const pid = Number(b.patientId);

  return {
    clientRef,
    state: b.state === "withdrawn" ? "withdrawn" : "pending",
    provisionalBillNumber: asText(b.provisionalBillNumber, PROVISIONAL_MAX_LEN),
    patientId: Number.isFinite(pid) && pid > 0 ? Math.round(pid) : null,
    testCount: asInt(b.testCount, 10_000),
    totalAmount: asAmount(b.totalAmount),
    workstation: asText(b.workstation, 120),
    lastError: asText(b.lastError, 300),
  };
}
