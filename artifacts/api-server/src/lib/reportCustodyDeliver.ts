/**
 * reportCustodyDeliver.ts — the counter's "this paper left with this person" step.
 *
 * The second of the two scanner operations, and the one an audit turns over. Four
 * things about it are deliberate, and each is a decision someone will otherwise
 * "optimise" back out:
 *
 * **1. Nothing here writes `patient_reports.status`.** The legacy `delivered`
 * value means "shared via PDF/WhatsApp/Email/Print at least once", `/print` sets
 * it, and under the `report_delivered` commission policy it holds someone's payout.
 * Changing who may write it is a money-semantics change the owner ruled out of this
 * sequence, so a handover is recorded in `report_custody_events` and in
 * `physical_state` only. The ledger is the authority; `status` keeps meaning what
 * it meant yesterday.
 *
 * **2. Receipt first, then handover — and the check is real.** A report the
 * counter never acknowledged cannot be handed over. Without it, a clerk could
 * receipt and deliver in one click, and the two-timeline accountability that is the
 * whole reason this project exists would collapse into a single event.
 *
 * **3. Outstanding money uses the settlement rule the repository already has:**
 * `paidAmount >= totalAmount` net of refunds, NOT `balanceAmount == 0`, because
 * after a refund the balance column stays 0 while retained collection drops below
 * the bill total. That is `commissionCalc.ts:441-446`. Two answers to "is this bill
 * paid" is already one too many; this does not add a third.
 *
 * **4. The bill names the patient, and every report must agree.** The bill scan is
 * what says who is standing at the counter. A label left from the previous
 * patient's stack is refused by the server, not by the clerk's attention.
 */
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientReportsTable, reportCustodyEventsTable } from "@workspace/db/schema";
import {
  billNumberFromScannedCode,
  buildCandidate,
  resolveScannedCode,
  type CandidateReport,
  type CustodyActor,
  type PaymentSnapshot,
} from "./reportCustodyReceive";
import { findBillByNumber, ambiguousBillNumberMessage } from "./billByNumber";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recipient is a CATEGORY, not a name. The owner's ruling: the counter records
 *  that paper left with the patient or with somebody carrying it, and does not
 *  build a register of every person who touched a report. */
export const RECIPIENT_CATEGORIES = [
  "PATIENT",
  "FAMILY_MEMBER",
  "CARRYING_AGENT",
  "DOOR_DROP",
] as const;

export type RecipientCategory = (typeof RECIPIENT_CATEGORIES)[number];

export const RECIPIENT_LABEL: Record<RecipientCategory, string> = {
  PATIENT: "The patient themselves",
  FAMILY_MEMBER: "A family member holding the slip",
  CARRYING_AGENT: "A courier or carrying agent",
  DOOR_DROP: "Left at reception for collection",
};

export function isRecipientCategory(value: unknown): value is RecipientCategory {
  return typeof value === "string" && (RECIPIENT_CATEGORIES as readonly string[]).includes(value);
}

export type HandoverReason =
  | "DELIVERABLE"
  | "NOT_SIGNED"
  | "SUPERSEDED_REVISION"
  | "NOT_AT_COUNTER"
  | "ALREADY_HANDED_OVER"
  | "WRONG_PATIENT"
  | "PAYMENT_OUTSTANDING"
  | "REPORT_NOT_FOUND"
  | "NOT_A_BILL_CODE"
  | "AMBIGUOUS_BILL"
  | "CONCURRENT_DUPLICATE";

/**
 * Only the reasons this step owns. The clinical refusals are deliberately absent:
 * `NOT_SIGNED` and `SUPERSEDED_REVISION` already have wording in the receive
 * module, and re-typing them here is how two screens end up explaining one fact
 * two different ways.
 */
const HANDOVER_MESSAGE: Partial<Record<HandoverReason, string>> = {
  DELIVERABLE: "Ready to hand over.",
  NOT_AT_COUNTER:
    "Not received at the counter yet. Receive it first — one scan and one confirmation — then hand it over.",
  ALREADY_HANDED_OVER: "Already handed over. There is nothing further to record.",
  WRONG_PATIENT:
    "This report belongs to a different patient than the bill being delivered against. Hand it over on its own bill.",
  PAYMENT_OUTSTANDING:
    "Payment is not fully collected on this bill. Give the reason for handing it over anyway — it is recorded with your name.",
  REPORT_NOT_FOUND: "No report with that number exists.",
  NOT_A_BILL_CODE: "Scan the patient's bill QR, or type the bill number printed on the slip.",
  CONCURRENT_DUPLICATE: "Another clerk handed this over moments ago, so it was not recorded twice.",
};

function handoverMessage(reason: HandoverReason, candidate: CandidateReport | null): string {
  if (reason === "AMBIGUOUS_BILL") return ambiguousBillNumberMessage("");
  // Same sentence the receive screen would have used, from the same table.
  if (reason === "NOT_SIGNED" || reason === "SUPERSEDED_REVISION") {
    return candidate?.message ?? HANDOVER_MESSAGE.REPORT_NOT_FOUND!;
  }
  return HANDOVER_MESSAGE[reason] ?? HANDOVER_MESSAGE.REPORT_NOT_FOUND!;
}

/**
 * The settlement test, net of refunds — the same arithmetic `commissionCalc.ts`
 * applies at :441-446. Named so a delivery screen cannot invent its own.
 */
export function paymentIsSettled(paid: number, total: number): boolean {
  return paid + 0.005 >= total;
}

export interface BillContext {
  billId: number;
  billNumber: string;
  patientId: number;
  payment: PaymentSnapshot;
  settled: boolean;
}

export interface HandoverCandidate extends CandidateReport {
  handoverVerdict: HandoverReason;
  handoverMessage: string;
  /** The only refusal a reason can clear. */
  needsPaymentOverride: boolean;
}

/**
 * Judge one report for handover against the bill it is being delivered on.
 *
 * Pure, so the ORDER is testable, and the order is the policy: already-gone is
 * stated first because it ends the conversation; the patient match comes before
 * the clinical checks because a wrong-patient label is the incident the owner is
 * trying to be able to prevent; money comes last because it is the one refusal an
 * honest reason can release.
 */
export function judgeHandover(input: {
  exists: boolean;
  authorized: boolean;
  superseded: boolean;
  physicalState: string | null;
  reportPatientId: number | null;
  billPatientId: number | null;
  settled: boolean;
}): HandoverReason {
  if (!input.exists) return "REPORT_NOT_FOUND";
  if (input.physicalState === "HANDED_OVER") return "ALREADY_HANDED_OVER";
  if (input.billPatientId != null && input.reportPatientId !== input.billPatientId) return "WRONG_PATIENT";
  if (!input.authorized) return "NOT_SIGNED";
  if (input.superseded) return "SUPERSEDED_REVISION";
  if (input.physicalState !== "AT_COUNTER") return "NOT_AT_COUNTER";
  if (!input.settled) return "PAYMENT_OUTSTANDING";
  return "DELIVERABLE";
}

/**
 * Resolve the scanned bill and the patient it names.
 *
 * Accepts only a bill here — deliberately. A report number belongs to the per
 * sheet scan that follows, so that "I am giving this report" is its own recorded
 * act rather than something inferred from a bill.
 */
export async function resolveBillForHandover(code: string): Promise<
  | { kind: "bill"; bill: BillContext }
  | { kind: "unknown"; reason: HandoverReason }
> {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return { kind: "unknown", reason: "NOT_A_BILL_CODE" };

  const billNumber = billNumberFromCode(trimmed);
  if (!billNumber) return { kind: "unknown", reason: "NOT_A_BILL_CODE" };

  const hit = await findBillByNumber(billNumber);
  if (hit.status === "not_found") return { kind: "unknown", reason: "NOT_A_BILL_CODE" };
  // Two books can print the same number. Guessing which patient's paper this is
  // would be the exact failure the ledger exists to make visible.
  if (hit.status === "ambiguous") return { kind: "unknown", reason: "AMBIGUOUS_BILL" };

  const bill = hit.bill;
  return {
    kind: "bill",
    bill: {
      billId: bill.id,
      billNumber: bill.billNumber,
      patientId: bill.patientId,
      settled: paymentIsSettled(Number(bill.paidAmount), Number(bill.totalAmount)),
      payment: {
        status: "measured",
        billId: bill.id,
        billNumber: bill.billNumber,
        ledgerId: bill.ledgerId,
        total: bill.totalAmount,
        paid: bill.paidAmount,
        balance: bill.balanceAmount,
        billStatus: bill.status,
      },
    },
  };
}

/**
 * The bill numbers the counter can be handed: the QR URL from the printed slip,
 * the legacy `BILL:` prefix, or the bare printed number. `resolveScannedCode` uses
 * the same parser for the receive step, so one scanned code means one thing.
 */
function billNumberFromCode(raw: string): string | null {
  const url = raw.match(/\/api\/verify\/bill\/([A-Za-z0-9-]+)/);
  if (url) return url[1]!;
  return billNumberFromScannedCode(raw);
}

/** One report, judged against the bill. Null when the id is not a report. */
export async function buildHandoverCandidate(
  reportId: number,
  bill: BillContext,
): Promise<HandoverCandidate | null> {
  const candidate = await buildCandidate(reportId);
  if (!candidate) return null;

  const handoverVerdict = judgeHandover({
    exists: true,
    authorized: candidate.authorized,
    superseded: candidate.superseded,
    physicalState: candidate.physicalState,
    reportPatientId: candidate.patientId,
    billPatientId: bill.patientId,
    settled: bill.settled,
  });

  return {
    ...candidate,
    handoverVerdict,
    handoverMessage: handoverMessage(handoverVerdict, candidate),
    needsPaymentOverride: handoverVerdict === "PAYMENT_OUTSTANDING",
  };
}

/**
 * Every report billed on this bill, each judged. The clerk ticks some of them:
 * partial delivery is normal, because a patient often collects one report today and
 * the other on Monday, and each half must be its own event.
 */
export async function handoverCandidatesForBill(bill: BillContext): Promise<HandoverCandidate[]> {
  const rows = await db
    .select({ id: patientReportsTable.id })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.billId, bill.billId))
    .orderBy(patientReportsTable.id);
  const candidates = await Promise.all(rows.map((r) => buildHandoverCandidate(r.id, bill)));
  return candidates.filter((c): c is HandoverCandidate => c !== null);
}

/** The report numbers a scanned code names, for the per-sheet scan step. */
export async function reportIdFromScannedCode(code: string): Promise<HandoverReason | number> {
  const outcome = await resolveScannedCode(code);
  if (outcome.kind === "report") return outcome.reportId;
  if (outcome.kind === "bill") return "NOT_A_BILL_CODE";
  return outcome.reason === "REPORT_NOT_FOUND" ? "REPORT_NOT_FOUND" : "NOT_A_BILL_CODE";
}

class ConcurrentHandover extends Error {}

/**
 * Record one handover, in its own transaction, so a report that turns out to be
 * somebody else's does not cancel the ones already given.
 */
export async function recordOneHandover(args: {
  reportId: number;
  scannedCode: string;
  bill: BillContext;
  /** Generated once per Confirm click and reused on a retry of that click. */
  requestId: string;
  batchId: string;
  batchSeq: number;
  recipientCategory: RecipientCategory;
  recipientName: string | null;
  /** Mandatory when the bill is short; recorded with the actor who gave it. */
  paymentOverrideReason: string | null;
  actor: CustodyActor;
}): Promise<
  | { ok: true; eventId: number; candidate: HandoverCandidate }
  | { ok: false; reason: HandoverReason; candidate: HandoverCandidate | null }
> {
  const candidate = await buildHandoverCandidate(args.reportId, args.bill);
  if (!candidate) return { ok: false, reason: "REPORT_NOT_FOUND", candidate: null };

  const idempotencyKey = `${args.requestId}:${candidate.reportId}:${candidate.revision}`;
  const [replay] = await db
    .select({ id: reportCustodyEventsTable.id })
    .from(reportCustodyEventsTable)
    .where(eq(reportCustodyEventsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (replay) return { ok: true, eventId: replay.id, candidate };

  if (candidate.handoverVerdict === "PAYMENT_OUTSTANDING" && !args.paymentOverrideReason) {
    // Its own instruction, not the generic line: what the clerk must do next is
    // give a reason, and the refusal should say so.
    return {
      ok: false,
      reason: "PAYMENT_OUTSTANDING",
      candidate: { ...candidate, handoverMessage: HANDOVER_MESSAGE.PAYMENT_OUTSTANDING! },
    };
  }
  // DELIVERABLE and PAYMENT_OUTSTANDING-with-a-reason are the two that proceed.
  if (candidate.handoverVerdict !== "DELIVERABLE" && candidate.handoverVerdict !== "PAYMENT_OUTSTANDING") {
    return { ok: false, reason: candidate.handoverVerdict, candidate };
  }

  const overrode = candidate.handoverVerdict === "PAYMENT_OUTSTANDING";

  try {
    const eventId = await db.transaction(async (tx) => {
      const inserted = await insertHandoverEvent(tx, candidate, args, idempotencyKey, overrode);
      if (!inserted) throw new ConcurrentHandover();
      await tx
        .update(patientReportsTable)
        .set({ physicalState: "HANDED_OVER", physicalStateAt: new Date() })
        .where(eq(patientReportsTable.id, candidate.reportId));
      return inserted;
    });
    return { ok: true, eventId, candidate: { ...candidate, physicalState: "HANDED_OVER" } };
  } catch (err) {
    if (err instanceof ConcurrentHandover) return { ok: false, reason: "CONCURRENT_DUPLICATE", candidate };
    throw err;
  }
}

async function insertHandoverEvent(
  tx: DbTx,
  candidate: HandoverCandidate,
  args: {
    scannedCode: string;
    bill: BillContext;
    batchId: string;
    batchSeq: number;
    recipientCategory: RecipientCategory;
    recipientName: string | null;
    paymentOverrideReason: string | null;
    actor: CustodyActor;
  },
  idempotencyKey: string,
  overrode: boolean,
): Promise<number | null> {
  const verification = {
    rule: "signed_or_countersigned",
    status: candidate.status,
    signedByName: candidate.signedByName,
    signedAt: candidate.signedAt,
    revision: candidate.revision,
    totalVersions: candidate.totalVersions,
    superseded: candidate.superseded,
    accessionNumber: candidate.accessionNumber,
    clinicalTextStored: false,
    // A chain of custody is only a chain if the previous link is named. Read off
    // the row BEFORE this transaction moves it, so it is evidence and not intent.
    precededByReceipt: candidate.physicalState === "AT_COUNTER",
    reportOwnBillId: candidate.billId,
    scannedBillNumber: args.bill.billNumber,
  };

  const [event] = await tx
    .insert(reportCustodyEventsTable)
    .values({
      event: "PHYSICALLY_HANDED_OVER",
      // An override is not a discrepancy. The discrepancy queue is for paper that
      // is missing or mismatched; a handover agreed against an outstanding balance
      // happened exactly as described, and is searchable by `override_reason`.
      outcome: "completed",
      reportId: candidate.reportId,
      reportRevision: candidate.revision,
      reportNumber: candidate.reportNumber,
      origin: candidate.origin,
      patientId: candidate.patientId,
      // The bill the patient stood at, which is the bill the clerk scanned, not
      // whichever row the report happens to point at.
      billId: args.bill.billId,
      orderId: candidate.orderId,
      orderTestId: candidate.orderTestId,
      accessionNumber: candidate.accessionNumber,
      testName: candidate.testName,
      actorUserId: args.actor.userId,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      sessionId: args.actor.sessionId,
      sessionIp: args.actor.ip,
      sessionUserAgent: args.actor.userAgent,
      scannedCode: args.scannedCode,
      verification,
      paymentSnapshot: args.bill.payment,
      recipientCategory: args.recipientCategory,
      recipientName: args.recipientName,
      overrideReason: overrode ? args.paymentOverrideReason : null,
      overrideByUserId: overrode ? args.actor.userId : null,
      batchId: args.batchId,
      batchSeq: args.batchSeq,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: reportCustodyEventsTable.id });

  return event?.id ?? null;
}
