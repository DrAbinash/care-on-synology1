/**
 * reportCustodyReceive.ts — the counter's "this signed paper is physically here"
 * step, and the ledger row that records it.
 *
 * The owner's driver for this whole project is a lost or disputed report, so
 * every part of this file is written to survive that argument:
 *
 *  • **Who** comes from the authenticated session, never the request body. A
 *    client-supplied name would let a clerk attribute the acknowledgment to a
 *    colleague, and nothing in the row would show it.
 *  • **What** is re-read from the database at confirm time, item by item. The
 *    review list the clerk saw is a hint, not the payload — a report amended,
 *    withdrawn or countersigned between scan and confirm is caught here.
 *  • **Whether it may be received at all** is `isReportClinicallyAuthorized`
 *    plus the amendment chain: an unsigned report never enters the ledger, and a
 *    superseded revision is refused instead of quietly receipted.
 *  • **Payment and verification evidence** is snapshotted into the event, because
 *    the bill can be amended or cancelled later and the event must still say what
 *    was true at the counter.
 *
 * Batching is per-item on purpose (~180 reports/day; one bad label must not void
 * a clerk's whole morning). Each item commits in its own transaction, and the
 * partial unique index `rce_open_receipt_uq` — not application logic — is what
 * makes two clerks receiving the same report the same minute impossible.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable, patientsTable, patientReportsTable, reportCustodyEventsTable, testsTable,
} from "@workspace/db/schema";
import { isReportClinicallyAuthorized, UNSIGNED_REPORT_REFUSAL } from "./reportAuthorization";
import { resolveReportVersion } from "./radiologyReportVersion";
import { resolveWorklistFromStudyRef } from "./radiologyIdentity";
import { findBillByNumber } from "./billByNumber";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The owner's cap: one Confirm click acknowledges at most this many reports. */
export const RECEIVE_BATCH_LIMIT = 100;

/** Report numbers are `RPT-YYYYMMDD-NNN` (routes/patient-reports.ts:1688-1696). */
const REPORT_NUMBER_RE = /^RPT-\d{8}-\d{3,}$/i;

export type ReceiptReason =
  | "RECEIVED"
  | "NOT_A_REPORT_CODE"
  | "REPORT_NOT_FOUND"
  | "NOT_SIGNED"
  | "SUPERSEDED_REVISION"
  | "ALREADY_AT_COUNTER"
  | "ALREADY_HANDED_OVER"
  | "CONCURRENT_DUPLICATE";

/**
 * Money as the counter is entitled to see it. `no_bill_linked` is its own case
 * rather than a row of zeros: a queue that reports ₹0.00 outstanding for a
 * report that was never billed is a number nobody can act on, and the owner's
 * rule for counters with no data is "not measured", never zero.
 */
export type PaymentSnapshot =
  | {
      status: "measured";
      billId: number;
      billNumber: string;
      ledgerId: number;
      total: string;
      paid: string;
      balance: string;
      billStatus: string;
    }
  | { status: "no_bill_linked" }
  | { status: "bill_not_found"; billId: number };

export interface CandidateReport {
  reportId: number;
  reportNumber: string;
  /** Which authoring path produced the paper — `care_composer` or, later, a
   *  registered Word report. Carried into the event so the ledger can be read
   *  per origin once Word joins it. */
  origin: string | null;
  patientId: number;
  patientLabel: string;
  testName: string | null;
  status: string;
  signedByName: string | null;
  signedAt: string | null;
  revision: number;
  totalVersions: number;
  superseded: boolean;
  accessionNumber: string | null;
  physicalState: string | null;
  billId: number | null;
  orderId: number | null;
  orderTestId: number | null;
  /** Money as measured at the counter, snapshotted into the event. */
  payment: PaymentSnapshot;
  verdict: ReceiptReason;
  /** The sentence the clerk reads. One place, so the screen and the ledger agree. */
  message: string;
  /** Populated only for the refusal a clerk can actually resolve — "someone
   *  already did this" is useless without who and when. */
  alreadyReceived: { actorName: string; at: string } | null;
}


export interface CustodyActor {
  userId: number;
  name: string;
  role: string;
  sessionId: number;
  ip: string | null;
  userAgent: string | null;
}

/**
 * The checks, as a pure function of what was read from the database — so every
 * branch is testable without a row in a table, and so the ORDER is decided in
 * one place. Order is load-bearing: a report that is both superseded and already
 * handed over must read as handed over (that is the fact that ends the
 * conversation), and an unsigned row must never reach the "already received"
 * branch, or a draft looks already handled.
 */
export function judgeReceipt(input: {
  exists: boolean;
  status: string | null;
  signedAt?: Date | string | null;
  signatureId?: number | null;
  superseded: boolean;
  physicalState: string | null;
}): { verdict: ReceiptReason; authorized: boolean } {
  if (!input.exists) return { verdict: "REPORT_NOT_FOUND", authorized: false };
  if (input.physicalState === "HANDED_OVER") return { verdict: "ALREADY_HANDED_OVER", authorized: false };
  const authorized = isReportClinicallyAuthorized({
    status: input.status,
    signedAt: input.signedAt,
    signatureId: input.signatureId,
  });
  if (!authorized) return { verdict: "NOT_SIGNED", authorized: false };
  if (input.superseded) return { verdict: "SUPERSEDED_REVISION", authorized: true };
  if (input.physicalState === "AT_COUNTER") return { verdict: "ALREADY_AT_COUNTER", authorized: true };
  return { verdict: "RECEIVED", authorized: true };
}

const REASON_MESSAGE: Record<ReceiptReason, string> = {
  RECEIVED: "Signed report received at the delivery counter.",
  NOT_A_REPORT_CODE:
    "Not a report number or a bill code. Scan the report's RPT number, or the patient's bill QR.",
  REPORT_NOT_FOUND: "No report carries that number.",
  NOT_SIGNED: UNSIGNED_REPORT_REFUSAL,
  SUPERSEDED_REVISION:
    "A newer signed amendment exists for this report. Receive the latest version, or record a discrepancy.",
  ALREADY_AT_COUNTER:
    "Already received at the counter. Receive it again only after a supervisor records a correction.",
  ALREADY_HANDED_OVER: "Already handed to the patient. There is nothing left to receive.",
  CONCURRENT_DUPLICATE: "Another clerk recorded this moments ago, so it was not recorded twice.",
};

export function reasonMessage(reason: ReceiptReason): string {
  return REASON_MESSAGE[reason];
}

/**
 * What a scanned code is allowed to mean at the counter.
 *
 * Deliberately narrower than `/api/resolve-barcode`. A patient code, phone number
 * or UHID resolves there — and here would pull up a patient's whole report
 * history, which is not something anyone should be able to acknowledge in batch by
 * typing a phone number. A code names exactly one report, or one bill and the
 * reports billed on it.
 */
export async function resolveScannedCode(code: string): Promise<
  | { kind: "report"; reportId: number; scannedCode: string }
  | { kind: "bill"; billId: number; reportIds: number[]; scannedCode: string }
  | { kind: "unknown"; reason: ReceiptReason }
> {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return { kind: "unknown", reason: "NOT_A_REPORT_CODE" };

  if (REPORT_NUMBER_RE.test(trimmed)) {
    const [row] = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.reportNumber, trimmed.toUpperCase()))
      .limit(1);
    return row
      ? { kind: "report", reportId: row.id, scannedCode: trimmed }
      : { kind: "unknown", reason: "REPORT_NOT_FOUND" };
  }

  const billNumber = billNumberFromScannedCode(trimmed);
  if (billNumber) {
    // `findBillByNumber` refuses to guess when two books issued the same number.
    // An ambiguous bill is not a report identity either, so it stops here rather
    // than picking a patient.
    const hit = await findBillByNumber(billNumber);
    if (hit.status !== "found") return { kind: "unknown", reason: "NOT_A_REPORT_CODE" };
    const rows = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.billId, hit.bill.id))
      .orderBy(patientReportsTable.id);
    return rows.length === 0
      ? { kind: "unknown", reason: "REPORT_NOT_FOUND" }
      : { kind: "bill", billId: hit.bill.id, reportIds: rows.map((r) => r.id), scannedCode: trimmed };
  }

  return { kind: "unknown", reason: "NOT_A_REPORT_CODE" };
}

/**
 * The bill payloads the counter already accepts.
 *
 * Re-implemented server-side rather than imported from a page: `ScanStation.tsx`
 * and `ReportDelivery.tsx` each keep a private copy of this parser, and a custody
 * decision cannot depend on browser code. Exported because which shapes count as a
 * bill is a rule, not an implementation detail — a 14-digit string is a patient's
 * mobile number and must not be looked up as a bill.
 */
export function billNumberFromScannedCode(raw: string): string | null {
  const qr = raw.match(/\/api\/verify\/bill\/([A-Za-z0-9-]+)/);
  if (qr) return qr[1]!;
  if (raw.startsWith("BILL:")) return raw.slice(5);
  // Printed bill numbers are a `yyyymm` book stamp plus a 4-digit sequence, so
  // exactly 10 digits. Anything longer is a phone number, not a bill.
  if (/^\d{10}$/.test(raw)) return raw;
  return null;
}

async function loadPayment(billId: number | null): Promise<PaymentSnapshot> {
  if (billId == null) return { status: "no_bill_linked" };
  const [bill] = await db
    .select({
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      ledgerId: billsTable.ledgerId,
      total: billsTable.totalAmount,
      paid: billsTable.paidAmount,
      balance: billsTable.balanceAmount,
      billStatus: billsTable.status,
    })
    .from(billsTable)
    .where(eq(billsTable.id, billId))
    .limit(1);
  if (!bill) return { status: "bill_not_found", billId };
  return { status: "measured", ...bill };
}

/**
 * One report, read the way the counter needs it, with its verdict. Null means the
 * id is not a report at all.
 */
export async function buildCandidate(reportId: number): Promise<CandidateReport | null> {
  const [row] = await db
    .select({
      id: patientReportsTable.id,
      reportNumber: patientReportsTable.reportNumber,
      origin: patientReportsTable.origin,
      patientId: patientReportsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
      status: patientReportsTable.status,
      signedAt: patientReportsTable.signedAt,
      signedByName: patientReportsTable.signedByName,
      signatureId: patientReportsTable.signatureId,
      billId: patientReportsTable.billId,
      orderId: patientReportsTable.orderId,
      orderTestId: patientReportsTable.orderTestId,
      studyId: patientReportsTable.studyId,
      physicalState: patientReportsTable.physicalState,
      testName: testsTable.name,
    })
    .from(patientReportsTable)
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .leftJoin(patientsTable, eq(patientsTable.id, patientReportsTable.patientId))
    .where(eq(patientReportsTable.id, reportId))
    .limit(1);
  if (!row) return null;

  // `specific` mode gives THIS row's ordinal and whether a newer one exists. The
  // default `latest` mode would resolve the scan forward to the amendment, which
  // is exactly wrong at a physical counter: the paper in the clerk's hand *is*
  // the older revision, and that is the fact worth recording.
  const version = await resolveReportVersion(reportId, { mode: "specific" });
  const { verdict } = judgeReceipt({
    exists: true,
    status: row.status,
    signedAt: row.signedAt,
    signatureId: row.signatureId,
    superseded: version?.superseded ?? false,
    physicalState: row.physicalState,
  });

  return {
    reportId: row.id,
    reportNumber: row.reportNumber,
    origin: row.origin,
    patientId: row.patientId,
    patientLabel: row.firstName
      ? `${row.firstName} ${row.lastName ?? ""} (${row.patientCode})`
      : `Patient #${row.patientId}`,
    testName: row.testName,
    status: row.status,
    signedByName: row.signedByName,
    signedAt: row.signedAt ? String(row.signedAt) : null,
    revision: version?.sequenceNumber ?? 1,
    totalVersions: version?.totalVersions ?? 1,
    superseded: version?.superseded ?? false,
    accessionNumber: await loadAccession(row.studyId),
    physicalState: row.physicalState,
    billId: row.billId,
    orderId: row.orderId,
    orderTestId: row.orderTestId,
    payment: await loadPayment(row.billId),
    verdict,
    message: REASON_MESSAGE[verdict],
    alreadyReceived:
      verdict === "ALREADY_AT_COUNTER" ? await loadOpenReceipt(reportId) : null,
  };
}

/** The open counter receipt for this report, if one exists. */
async function loadOpenReceipt(
  reportId: number,
): Promise<{ actorName: string; at: string } | null> {
  const [row] = await db
    .select({
      actorName: reportCustodyEventsTable.actorName,
      createdAt: reportCustodyEventsTable.createdAt,
    })
    .from(reportCustodyEventsTable)
    .where(
      and(
        eq(reportCustodyEventsTable.reportId, reportId),
        eq(reportCustodyEventsTable.event, "RECEIVED_AT_DELIVERY_COUNTER"),
        isNull(reportCustodyEventsTable.validUntil),
      ),
    )
    .orderBy(desc(reportCustodyEventsTable.createdAt))
    .limit(1);
  return row ? { actorName: row.actorName, at: String(row.createdAt) } : null;
}

async function loadAccession(studyId: number | null): Promise<string | null> {
  if (!studyId) return null;
  const worklist = await resolveWorklistFromStudyRef(studyId);
  return worklist?.accessionNumber ?? null;
}

class ConcurrentDuplicate extends Error {}

/**
 * Record one report's arrival at the counter. Its own transaction, so a refused
 * item cannot roll back the items already accepted.
 *
 * Returns the ledger row id, or the reason it was not recorded — never a thrown
 * error for a business refusal. The insert carries no `ON CONFLICT UPDATE`: the
 * event is the record, and a conflict means someone else already recorded it.
 */
export async function recordOneReceipt(args: {
  reportId: number;
  scannedCode: string;
  /** Client-generated once per Confirm click, so a retried request cannot create
   *  a second event for the same act. */
  requestId: string;
  batchId: string;
  batchSeq: number;
  actor: CustodyActor;
}): Promise<
  | { ok: true; eventId: number; candidate: CandidateReport }
  | { ok: false; reason: ReceiptReason; candidate: CandidateReport | null }
> {
  const candidate = await buildCandidate(args.reportId);
  if (!candidate) return { ok: false, reason: "REPORT_NOT_FOUND", candidate: null };

  const idempotencyKey = `${args.requestId}:${candidate.reportId}:${candidate.revision}`;

  // A retry of the SAME confirmation is the same act, and must come back as the
  // event it already created. Checked before anything else, because the
  // open-receipt index below would otherwise answer "another clerk recorded this"
  // to a person resending their own click — technically a refusal, and the wrong
  // sentence for an audit to read.
  const [replay] = await db
    .select({ id: reportCustodyEventsTable.id })
    .from(reportCustodyEventsTable)
    .where(eq(reportCustodyEventsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (replay) return { ok: true, eventId: replay.id, candidate };

  if (candidate.verdict !== "RECEIVED") return { ok: false, reason: candidate.verdict, candidate };

  try {
    const eventId = await db.transaction(async (tx) => {
      const inserted = await insertReceiptEvent(tx, candidate, args, idempotencyKey);
      if (!inserted) throw new ConcurrentDuplicate();
      await tx
        .update(patientReportsTable)
        .set({ physicalState: "AT_COUNTER", physicalStateAt: new Date() })
        .where(eq(patientReportsTable.id, candidate.reportId));
      return inserted;
    });
    return { ok: true, eventId, candidate: { ...candidate, physicalState: "AT_COUNTER" } };
  } catch (err) {
    if (err instanceof ConcurrentDuplicate) return { ok: false, reason: "CONCURRENT_DUPLICATE", candidate };
    throw err;
  }
}

async function insertReceiptEvent(
  tx: DbTx,
  candidate: CandidateReport,
  args: { scannedCode: string; batchId: string; batchSeq: number; actor: CustodyActor },
  idempotencyKey: string,
): Promise<number | null> {
  const verification = {
    // Named so a reader can tell which rule was applied, six months and one
    // policy change from now.
    rule: "signed_or_countersigned",
    status: candidate.status,
    signedByName: candidate.signedByName,
    signedAt: candidate.signedAt,
    revision: candidate.revision,
    totalVersions: candidate.totalVersions,
    superseded: candidate.superseded,
    accessionNumber: candidate.accessionNumber,
    clinicalTextStored: false,
  };

  const [event] = await tx
    .insert(reportCustodyEventsTable)
    .values({
      event: "RECEIVED_AT_DELIVERY_COUNTER",
      outcome: "completed",
      reportId: candidate.reportId,
      reportRevision: candidate.revision,
      reportNumber: candidate.reportNumber,
      origin: candidate.origin,
      patientId: candidate.patientId,
      billId: candidate.billId,
      orderId: candidate.orderId,
      orderTestId: candidate.orderTestId,
      accessionNumber: candidate.accessionNumber,
      // Test NAME only. A custody row that carried report body text would put
      // clinical content in a table the delivery dashboard reads.
      testName: candidate.testName,
      actorUserId: args.actor.userId,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      sessionId: args.actor.sessionId,
      sessionIp: args.actor.ip,
      sessionUserAgent: args.actor.userAgent,
      scannedCode: args.scannedCode,
      verification,
      paymentSnapshot: candidate.payment,
      batchId: args.batchId,
      batchSeq: args.batchSeq,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: reportCustodyEventsTable.id });

  return event?.id ?? null;
}
