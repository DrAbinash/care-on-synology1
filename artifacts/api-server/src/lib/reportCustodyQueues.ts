/**
 * reportCustodyQueues.ts — the four queues the delivery counter reads.
 *
 * The owner's brief (2026-10-26) is deliberately small: Awaiting Receipt, At
 * Counter, Handed Over, Discrepancies, and per entry the bill number, patient,
 * examination, current custody state, and the receiving and delivering staff
 * with their times. No charts, no analytics. So this file is four READS and
 * nothing else — every write path stays where it is, and the ledger
 * (`report_custody_events`) is the source for three of the four queues because
 * the ledger, not a projection, is what answers "who handled this paper".
 *
 * Three rules that shape the whole file:
 *
 *  • **"Not measured" is a real answer.** The go-live cutoff is a value the
 *    clinic has to choose. While it is NULL, Awaiting Receipt returns
 *    `not_measured` with the sentence that tells an admin where to set it —
 *    rather than defaulting to "everything ever signed" (years of false backlog)
 *    or to "today" (hides the backlog that is actually there). Same principle
 *    the counter's money snapshot uses.
 *
 *  • **A queue cannot show paper CARE has never been told about.** Most
 *    radiology reports here are typed in Word and become no row at all, so
 *    Awaiting Receipt can only be *proven* for reports this app produced. That
 *    limitation is returned as a `reason` on the queue and printed on the
 *    screen; silently under-reporting the pile would be worse than admitting it.
 *    The other three queues are unaffected — Word paper is in the ledger the
 *    moment the counter receives it, keyed to its examination.
 *
 *  • **Discrepancies is computed, not a queue someone has to feed.** Nothing in
 *    this stack writes `CUSTODY_DISCREPANCY_RECORDED` yet, so a dashboard that
 *    only listed stored discrepancy rows would be decoration. The rules here —
 *    handed over without ever being received, the counter holding paper for a
 *    revision that has since been amended, and `patient_reports.physical_state`
 *    disagreeing with the ledger — are derivable from data that already exists,
 *    and each names something a supervisor can act on.
 *
 * Nothing here returns report body text or an impression: the counter identifies
 * paper, it is not a place to read it.
 */
import { sql, type SQL } from "drizzle-orm";
import { db, clinicSettingsTable } from "@workspace/db";
import { isReportClinicallyAuthorized } from "./reportAuthorization";

/** Rows fetched per queue before the UI shows "showing N of total". */
export const QUEUE_ROW_LIMIT_DEFAULT = 100;
export const QUEUE_ROW_LIMIT_MAX = 200;

/**
 * How far back the "Handed Over" queue looks. Unlike the others this is a
 * *window*, because handover is a terminal state: an unbounded list grows every
 * day forever and stops being readable. Per-request, capped.
 */
export const HANDED_OVER_WINDOW_DAYS_DEFAULT = 7;
export const HANDED_OVER_WINDOW_DAYS_MAX = 90;

export const RECEIPT_EVENT = "RECEIVED_AT_DELIVERY_COUNTER";
export const HANDOVER_EVENT = "PHYSICALLY_HANDED_OVER";

export type QueueId = "awaitingReceipt" | "atCounter" | "handedOver" | "discrepancies";

export type DiscrepancyCode =
  | "RECORDED_BY_SUPERVISOR"
  | "HANDED_OVER_WITHOUT_RECEIPT"
  | "PAPER_SUPERSEDED_BY_AMENDMENT"
  | "PROJECTION_AHEAD_OF_LEDGER"
  | "PROJECTION_BEHIND_LEDGER";

export interface QueueEntry {
  /** Unique across queues and rules, for keys and for a later drill-down. */
  key: string;
  billNumber: string | null;
  patientName: string;
  patientCode: string;
  examination: string;
  /** Null for Word paper — the examination is the only identity it has. */
  reportNumber: string | null;
  state: "AWAITING_RECEIPT" | "AT_COUNTER" | "HANDED_OVER" | "DISCREPANCY";
  receivedByName: string | null;
  receivedAt: string | null;
  deliveredByName: string | null;
  deliveredAt: string | null;
  recipientName: string | null;
  recipientCategory: string | null;
  /** Set when payment or signature was overridden to let this through. */
  overrideReason: string | null;
  /** Discrepancies only. */
  issue: DiscrepancyCode | null;
  issueDetail: string | null;
}

export interface Queue {
  id: QueueId;
  status: "measured" | "not_measured";
  /** What this queue cannot see, or why it is not measured. Printed as-is. */
  reason: string | null;
  /** Rows that match, before the cap — so a truncated queue still counts right. */
  total: number;
  truncated: boolean;
  rows: QueueEntry[];
}

export interface CustodyQueues {
  generatedAt: string;
  goLive: { configured: boolean; at: string | null };
  handedOverSince: string;
  handedOverDays: number;
  limit: number;
  queues: Record<QueueId, Queue>;
}

export interface QueueOptions {
  /** Injected for tests; the clock is never read inside a helper. */
  now?: Date;
  limit?: number;
  handedOverDays?: number;
  /** Tests pass a transaction so their fixtures roll back with the test. */
  tx?: typeof db;
}

/**
 * The one SELECT for every ledger-backed queue. Kept as a single fragment so
 * the At Counter, Handed Over and discrepancy reads cannot drift apart on what
 * identifies an entry — the WHERE clauses differ, the identity columns do not.
 * `count(*) OVER()` is the honest pre-cap total.
 *
 * These are raw SQL, so they name PHYSICAL tables: the Drizzle export called
 * `testsTable` is the table `diagnostic_tests`.
 */
const LEDGER_SELECT: SQL = sql`
  SELECT
    e.id,
    e.event,
    e.report_id,
    e.order_test_id,
    e.report_number,
    b.bill_number,
    TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS patient_name,
    p.patient_id AS patient_code,
    COALESCE(NULLIF(TRIM(e.test_name), ''), pr.title, 'Examination') AS examination,
    e.actor_name,
    e.created_at,
    -- "Who took this paper in" is a question a HANDED-OVER row still has to
    -- answer, and the ledger holds the receipt as a separate event. Without
    -- these two columns the accountability entry the whole feature exists for
    -- would name the clerk who handed the report out and lose the one who
    -- acknowledged it. For a receipt row the subquery simply returns itself.
    (SELECT r.actor_name FROM report_custody_events r
      WHERE r.event = ${RECEIPT_EVENT} AND r.valid_until IS NULL
        AND (r.report_id = e.report_id OR (e.order_test_id IS NOT NULL AND r.order_test_id = e.order_test_id))
      ORDER BY r.created_at DESC LIMIT 1) AS received_actor_name,
    (SELECT r.created_at FROM report_custody_events r
      WHERE r.event = ${RECEIPT_EVENT} AND r.valid_until IS NULL
        AND (r.report_id = e.report_id OR (e.order_test_id IS NOT NULL AND r.order_test_id = e.order_test_id))
      ORDER BY r.created_at DESC LIMIT 1) AS received_at,
    e.recipient_name,
    e.recipient_category,
    e.override_reason,
    e.verification,
    pr.physical_state,
    count(*) OVER() AS queue_total
  FROM report_custody_events e
  JOIN patients p ON p.id = e.patient_id
  LEFT JOIN bills b ON b.id = e.bill_id
  LEFT JOIN patient_reports pr ON pr.id = e.report_id
`;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

function clampInt(raw: number | undefined, fallback: number, max: number): number {
  const n = Math.trunc(Number(raw ?? fallback));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** The cutoff, or null when nobody has chosen one. A missing settings row is not configured. */
export async function readGoLiveCutoff(handle: typeof db = db): Promise<Date | null> {
  try {
    const [row] = await handle
      .select({ at: clinicSettingsTable.reportDeliveryGoLiveAt })
      .from(clinicSettingsTable)
      .limit(1);
    const value = row?.at ?? null;
    return value instanceof Date ? value : null;
  } catch {
    // Schema lag — the column arrives with its own migration. Treating it as
    // "not configured" is the direction that cannot print a wrong backlog.
    return null;
  }
}

type LedgerRow = {
  id: number;
  event: string;
  report_id: number | null;
  order_test_id: number | null;
  report_number: string | null;
  bill_number: string | null;
  patient_name: string | null;
  patient_code: string | null;
  examination: string | null;
  actor_name: string;
  created_at: Date | string;
  received_actor_name: string | null;
  received_at: Date | string | null;
  recipient_name: string | null;
  recipient_category: string | null;
  override_reason: string | null;
  verification: unknown;
  physical_state: string | null;
  queue_total: string | number | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/** `count(*) OVER()` arrives as text through the driver. */
function totalOf(rows: LedgerRow[]): number {
  if (rows.length === 0) return 0;
  const n = Number(rows[0].queue_total ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * One ledger event → one entry. Which staff column it fills is decided by the
 * EVENT, not by the caller: a receipt names who took the paper in, a handover
 * names who sent it out, and getting that backwards is exactly the kind of
 * wrong-but-plausible answer a dispute would be argued over.
 *
 * The receiving clerk is read from the ledger's own open receipt rather than
 * from the row, so a handed-over entry names BOTH acts — the paper that left
 * the clinic was acknowledged by one person and passed on by another, and the
 * second name without the first is half the accountability this table exists
 * for.
 */
function entryOf(r: LedgerRow, over: Partial<QueueEntry>): QueueEntry {
  const isHandover = r.event === HANDOVER_EVENT;
  const at = iso(r.created_at);
  return {
    key: `${isHandover ? "handover" : "receipt"}:${r.id}`,
    billNumber: r.bill_number ?? null,
    patientName: r.patient_name || "(patient without a name)",
    patientCode: r.patient_code ?? "",
    examination: r.examination || "Examination",
    reportNumber: r.report_number ?? null,
    state: isHandover ? "HANDED_OVER" : "AT_COUNTER",
    receivedByName: r.received_actor_name ?? null,
    receivedAt: iso(r.received_at),
    deliveredByName: isHandover ? r.actor_name : null,
    deliveredAt: isHandover ? at : null,
    recipientName: r.recipient_name ?? null,
    recipientCategory: r.recipient_category ?? null,
    overrideReason: r.override_reason ?? null,
    issue: null,
    issueDetail: null,
    ...over,
  };
}

function measured(id: QueueId, rows: QueueEntry[], total: number, reason: string | null = null): Queue {
  return { id, status: "measured", reason, total, truncated: total > rows.length, rows };
}

function notMeasured(id: QueueId, reason: string): Queue {
  return { id, status: "not_measured", reason, total: 0, truncated: false, rows: [] };
}

const NOT_MEASURED_AWAITING =
  "Not measured: no go-live date is set, so CARE cannot tell historical paper apart from a backlog. "
  + "Set it in Settings → Clinic → Report delivery go-live. Reports signed before that date are never "
  + "listed as overdue, and can still be received or handed over by scanning the bill.";

const AWAITING_RECEIPT_BLIND_SPOT =
  "CARE can only list paper it holds a record of. A report typed in Word is not a record, so it does "
  + "not appear here until it is received — receive it by scanning the bill at the counter.";

/**
 * Awaiting Receipt — signed CARE reports with no open custody event.
 *
 * The SQL narrows to the release rule and excludes anything the ledger already
 * holds; each surviving row is then re-passed through
 * `isReportClinicallyAuthorized`, because that predicate is the clinic's single
 * authority on "may this leave" and a queue that disagrees with the counter's
 * own refusal is worse than no queue.
 */
async function readAwaitingReceipt(cutoff: Date, limit: number, handle: typeof db): Promise<Queue> {
  const rows = rowsOf<Record<string, unknown>>(await handle.execute(sql`
    SELECT
      pr.id,
      pr.report_number,
      pr.status,
      pr.signed_at,
      pr.signature_id,
      b.bill_number,
      TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS patient_name,
      p.patient_id AS patient_code,
      COALESCE(NULLIF(TRIM(t.name), ''), pr.title, 'Examination') AS examination,
      count(*) OVER() AS queue_total
    FROM patient_reports pr
    JOIN patients p ON p.id = pr.patient_id
    LEFT JOIN bills b ON b.id = pr.bill_id
    LEFT JOIN diagnostic_tests t ON t.id = pr.test_id
    WHERE pr.status <> 'draft'
      AND (pr.signed_at IS NOT NULL OR pr.signature_id IS NOT NULL OR pr.status IN ('verified', 'delivered'))
      AND COALESCE(pr.signed_at, pr.created_at) >= ${cutoff}
      -- The counter holds the paper once either event is open, whichever key it used:
      -- a Composer receipt by report id, or a Word receipt of the same examination.
      AND NOT EXISTS (
        SELECT 1 FROM report_custody_events e
        WHERE e.valid_until IS NULL
          AND e.event IN (${RECEIPT_EVENT}, ${HANDOVER_EVENT})
          AND (e.report_id = pr.id OR (pr.order_test_id IS NOT NULL AND e.order_test_id = pr.order_test_id))
      )
    ORDER BY COALESCE(pr.signed_at, pr.created_at) ASC
    LIMIT ${limit}
  `));

  const entries: QueueEntry[] = [];
  let dropped = 0;
  for (const r of rows) {
    const authorized = isReportClinicallyAuthorized({
      status: String(r.status ?? ""),
      signedAt: (r.signed_at as Date | string | null) ?? null,
      signatureId: r.signature_id == null ? null : Number(r.signature_id),
    });
    // The SQL and this predicate are the same rule stated twice. If they ever
    // disagree, the stored count is no longer the queue's count.
    if (!authorized) dropped += 1;
    else entries.push({
      key: `awaiting:${Number(r.id)}`,
      billNumber: (r.bill_number as string | null) ?? null,
      patientName: String(r.patient_name ?? "") || "(patient without a name)",
      patientCode: String(r.patient_code ?? ""),
      examination: String(r.examination ?? "Examination"),
      reportNumber: (r.report_number as string | null) ?? null,
      state: "AWAITING_RECEIPT",
      receivedByName: null,
      receivedAt: null,
      deliveredByName: null,
      deliveredAt: null,
      recipientName: null,
      recipientCategory: null,
      overrideReason: null,
      issue: null,
      issueDetail: null,
    });
  }

  const windowTotal = rows.length > 0 ? Number(rows[0].queue_total ?? 0) : 0;
  if (dropped > 0) return measured("awaitingReceipt", entries, entries.length, AWAITING_RECEIPT_BLIND_SPOT);
  const total = Number.isFinite(windowTotal) ? windowTotal : entries.length;
  return measured("awaitingReceipt", entries, total, AWAITING_RECEIPT_BLIND_SPOT);
}

/**
 * Discrepancies — what the existing data can prove, plus any row a supervisor
 * recorded. Newest first, capped: a supervisor reads this to act, not to count.
 */
async function readDiscrepancies(limit: number, handle: typeof db): Promise<Queue> {
  const entries: QueueEntry[] = [];
  const seen = new Set<string>();
  const push = (e: QueueEntry) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    entries.push(e);
  };

  // 1. Recorded by a supervisor (the correction path's vocabulary).
  const recorded = rowsOf<LedgerRow>(await handle.execute(sql`${LEDGER_SELECT}
    WHERE e.outcome = 'discrepancy' AND e.valid_until IS NULL
    ORDER BY e.created_at DESC LIMIT ${limit}
  `));
  for (const r of recorded) {
    const detail = String(
      (r.verification as { message?: string; reason?: string } | null)?.message
        ?? (r.verification as { reason?: string } | null)?.reason
        ?? r.override_reason
        ?? "A supervisor recorded a discrepancy against this paper.",
    );
    push(entryOf(r, {
      key: `discrepancy:recorded:${r.id}`,
      state: "DISCREPANCY",
      issue: "RECORDED_BY_SUPERVISOR",
      issueDetail: detail,
    }));
  }

  // 2. Handed over with no open receipt. The partial unique indexes bound each
  //    event on its own, so this ordering break is only visible in the ledger.
  const orphanHandovers = rowsOf<LedgerRow>(await handle.execute(sql`${LEDGER_SELECT}
    WHERE e.event = ${HANDOVER_EVENT} AND e.valid_until IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM report_custody_events r
        WHERE r.event = ${RECEIPT_EVENT} AND r.valid_until IS NULL
          AND (r.report_id = e.report_id OR (e.order_test_id IS NOT NULL AND r.order_test_id = e.order_test_id))
      )
    ORDER BY e.created_at DESC LIMIT ${limit}
  `));
  for (const r of orphanHandovers) {
    push(entryOf(r, {
      key: `discrepancy:unreceived:${r.id}`,
      state: "DISCREPANCY",
      issue: "HANDED_OVER_WITHOUT_RECEIPT",
      issueDetail: "Handed over at the counter with no receipt recorded first. The paper is with the "
        + "patient, but CARE has no record of it ever arriving.",
    }));
  }

  // 3. Every open custody event, checked against the clinical record.
  const openEvents = rowsOf<LedgerRow>(await handle.execute(sql`${LEDGER_SELECT}
    WHERE e.valid_until IS NULL AND e.event IN (${RECEIPT_EVENT}, ${HANDOVER_EVENT})
    ORDER BY e.created_at DESC LIMIT ${limit * 2}
  `));

  const superseded = new Set<number>();
  const openReportIds = [...new Set(openEvents.map((r) => r.report_id).filter((v): v is number => v != null))];
  if (openReportIds.length > 0) {
    const links = rowsOf<{ original_report_id: number }>(await handle.execute(sql`
      SELECT original_report_id FROM patient_report_amendments
      WHERE original_report_id IN (${sql.join(openReportIds.map((id) => sql`${id}`), sql`, `)})
    `));
    for (const l of links) superseded.add(Number(l.original_report_id));
  }

  for (const r of openEvents) {
    if (r.report_id == null) continue;

    // 3a. The counter holds paper for a revision that has since been amended.
    if (superseded.has(r.report_id)) {
      push(entryOf(r, {
        key: `discrepancy:superseded:${r.id}`,
        state: "DISCREPANCY",
        issue: "PAPER_SUPERSEDED_BY_AMENDMENT",
        issueDetail: "This report has been amended since the paper was logged. The copy at the counter is "
          + "the superseded version and must not be handed out.",
      }));
    }

    // 3b. The derived projection lags the ledger.
    const expected = r.event === HANDOVER_EVENT ? "HANDED_OVER" : "AT_COUNTER";
    if (r.physical_state != null && String(r.physical_state) !== expected) {
      push(entryOf(r, {
        key: `discrepancy:projection:${r.id}`,
        state: "DISCREPANCY",
        issue: "PROJECTION_BEHIND_LEDGER",
        issueDetail: `The report record says "${String(r.physical_state)}" while the ledger's open event says `
          + `"${expected}". The ledger is the authority; the record needs re-deriving.`,
      }));
    }
  }

  // 3c. The projection claims paper the ledger has no open event for. There is
  //     deliberately no staff name or time here: an act that was never recorded
  //     must not be shown as though one was.
  const ahead = rowsOf<Record<string, unknown>>(await handle.execute(sql`
    SELECT pr.id, pr.report_number, b.bill_number,
           TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS patient_name,
           p.patient_id AS patient_code,
           COALESCE(NULLIF(TRIM(t.name), ''), pr.title, 'Examination') AS examination,
           pr.physical_state
    FROM patient_reports pr
    JOIN patients p ON p.id = pr.patient_id
    LEFT JOIN bills b ON b.id = pr.bill_id
    LEFT JOIN diagnostic_tests t ON t.id = pr.test_id
    WHERE pr.physical_state IN ('AT_COUNTER', 'HANDED_OVER')
      AND NOT EXISTS (
        SELECT 1 FROM report_custody_events e
        WHERE e.valid_until IS NULL AND e.report_id = pr.id
          AND e.event IN (${RECEIPT_EVENT}, ${HANDOVER_EVENT})
      )
    ORDER BY pr.physical_state_at DESC NULLS LAST LIMIT ${limit}
  `));
  for (const r of ahead) {
    push({
      key: `discrepancy:projection-ahead:${Number(r.id)}`,
      billNumber: (r.bill_number as string | null) ?? null,
      patientName: String(r.patient_name ?? "") || "(patient without a name)",
      patientCode: String(r.patient_code ?? ""),
      examination: String(r.examination ?? "Examination"),
      reportNumber: (r.report_number as string | null) ?? null,
      state: "DISCREPANCY",
      receivedByName: null,
      receivedAt: null,
      deliveredByName: null,
      deliveredAt: null,
      recipientName: null,
      recipientCategory: null,
      overrideReason: null,
      issue: "PROJECTION_AHEAD_OF_LEDGER",
      issueDetail: `The report record says "${String(r.physical_state ?? "")}" but the ledger holds no open `
        + "event to back it. The paper's physical state is being claimed without a recorded act.",
    });
  }

  return measured("discrepancies", entries.slice(0, limit), entries.length);
}

/** The four queues, in one call, from the ledger and the clinical record. */
export async function readCustodyQueues(options: QueueOptions = {}): Promise<CustodyQueues> {
  const handle = (options.tx ?? db) as typeof db;
  const limit = clampInt(options.limit, QUEUE_ROW_LIMIT_DEFAULT, QUEUE_ROW_LIMIT_MAX);
  const days = clampInt(options.handedOverDays, HANDED_OVER_WINDOW_DAYS_DEFAULT, HANDED_OVER_WINDOW_DAYS_MAX);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const atCounter = rowsOf<LedgerRow>(await handle.execute(sql`${LEDGER_SELECT}
    WHERE e.event = ${RECEIPT_EVENT} AND e.valid_until IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM report_custody_events h
        WHERE h.event = ${HANDOVER_EVENT} AND h.valid_until IS NULL
          AND (h.report_id = e.report_id OR (e.order_test_id IS NOT NULL AND h.order_test_id = e.order_test_id))
      )
    ORDER BY e.created_at DESC LIMIT ${limit}
  `));

  const handedOver = rowsOf<LedgerRow>(await handle.execute(sql`${LEDGER_SELECT}
    WHERE e.event = ${HANDOVER_EVENT} AND e.valid_until IS NULL AND e.created_at >= ${since}
    ORDER BY e.created_at DESC LIMIT ${limit}
  `));

  const cutoff = await readGoLiveCutoff(handle);
  const awaiting = cutoff
    ? await readAwaitingReceipt(cutoff, limit, handle)
    : notMeasured("awaitingReceipt", NOT_MEASURED_AWAITING);
  const discrepancies = await readDiscrepancies(limit, handle);

  return {
    generatedAt: now.toISOString(),
    goLive: { configured: cutoff != null, at: cutoff ? cutoff.toISOString() : null },
    handedOverSince: since.toISOString(),
    handedOverDays: days,
    limit,
    queues: {
      awaitingReceipt: awaiting,
      atCounter: measured("atCounter", atCounter.map((r) => entryOf(r, {})), totalOf(atCounter)),
      handedOver: measured(
        "handedOver",
        handedOver.map((r) => entryOf(r, {})),
        totalOf(handedOver),
        `Last ${days} day(s). Older handovers stay on the ledger and are still found by scanning the bill.`,
      ),
      discrepancies,
    },
  };
}
