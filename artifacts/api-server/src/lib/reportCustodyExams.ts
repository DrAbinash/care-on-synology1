/**
 * reportCustodyExams.ts — the bill is what the counter scans, so the examination
 * is what the counter must list.
 *
 * Both scanner operations used to enumerate `patient_reports` rows joined to the
 * bill. That is right for a report this app produced and empty for everything
 * else — and most radiology reports here are typed in Microsoft Word, which
 * reaches CARE as a file on `radiology_report_attachments` and never becomes a
 * `patient_reports` row at all. A clerk scanning such a bill saw nothing at all,
 * which is the same as telling them the counter does not apply to their work.
 *
 * So this module answers one question for both operations: **for this bill, what
 * examinations were billed, and where is each one's paper?**
 *
 *   • examinations come from `order_tests` (cancelled ones excluded), because a
 *     bill's order is what says what was bought;
 *   • an examination that has a report row keeps every check PR-3/PR-4 already
 *     made — its candidate is built by `buildCandidate`, not re-derived here;
 *   • an examination with no report row is a Word report: it is still named,
 *     still judged, and its paper is still accountable, but the only evidence it
 *     is signed is a clerk saying who signed it. That assertion is stored on the
 *     custody event, attributed, and never written into the clinical tables.
 *
 * Nothing here writes. The write is the one confirmation at the end of a batch.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  billsTable,
  orderTestsTable,
  ordersTable,
  patientsTable,
  patientReportsTable,
  reportCustodyEventsTable,
  testsTable,
} from "@workspace/db/schema";
import {
  buildCandidate,
  reasonMessage,
  recordOneReceipt,
  recordReceiptCandidate,
  type CandidateReport,
  type CustodyActor,
  type PaymentSnapshot,
  type ReceiptReason,
} from "./reportCustodyReceive";
import {
  judgeCandidateHandover,
  paymentIsSettled,
  recordHandoverCandidate,
  recordOneHandover,
  type BillContext,
  type HandoverCandidate,
  type HandoverReason,
  type RecipientCategory,
} from "./reportCustodyDeliver";

/** What the ledger says about one examination's paper, when there is no report row. */
export interface ExamPaperState {
  physicalState: string | null;
  receiptActorName: string | null;
  receiptAt: string | null;
  receiptEventId: number | null;
  /** Who signed the paper, as acknowledged by the clerk who received it. */
  paperSignedByName: string | null;
}

/** One billed examination, with whatever CARE knows about its report. */
export interface BillExamination {
  /** The line item that bought it. Null only for a report row this bill carries
   *  without a line — a hand-written report or an amendment — where the row is the
   *  whole identity and there is nothing to key the paper to. */
  orderTestId: number | null;
  testId: number | null;
  testName: string;
  /** Every examination has a candidate. For a report CARE produced it describes the
   *  row; for a Word report it describes the paper, with `reportId: null`. */
  candidate: CandidateReport;
  /** True when there is no report row — the Word case. */
  wordOnly: boolean;
  /** Physical state from whichever source holds it: the report row, or the ledger. */
  physicalState: string | null;
  /** The clerk-acknowledged signer of a Word report, once it has been received. */
  paperSignedByName: string | null;
  /** What the receive desk shows for this examination right now. */
  receiveVerdict: ReceiptReason;
  receiveMessage: string;
}

/** One billed examination, judged for the delivery desk instead of the receive one.
 *  The handover fields travel on the candidate, which is where both desks already
 *  read them from. */
export interface BillHandoverExamination extends BillExamination {
  candidate: HandoverCandidate;
}

/**
 * The label a counter says aloud.
 *
 * Matches `buildCandidate`'s shape on purpose: the two identities have to read the
 * same way in one list, or a Word report looks like a different kind of thing than
 * a Composer report to the person deciding which paper to hand over.
 */
async function patientLabelOf(patientId: number): Promise<string> {
  const [p] = await db
    .select({
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!p?.firstName) return `Patient #${patientId}`;
  return `${p.firstName} ${p.lastName ?? ""} (${p.patientCode})`;
}

/**
 * The open custody state for one examination's paper, read from the ledger.
 *
 * Only examined for Word reports. A report row's own `physical_state` column is
 * still the fast projection for the Composer path — the ledger remains the
 * authority, and this is the same answer recomputed for the case where there is
 * no row to project onto.
 */
export async function loadExamPaperState(orderTestId: number): Promise<ExamPaperState> {
  const rows = await db
    .select({
      event: reportCustodyEventsTable.event,
      id: reportCustodyEventsTable.id,
      actorName: reportCustodyEventsTable.actorName,
      createdAt: reportCustodyEventsTable.createdAt,
      verification: reportCustodyEventsTable.verification,
    })
    .from(reportCustodyEventsTable)
    .where(
      and(
        eq(reportCustodyEventsTable.orderTestId, orderTestId),
        isNull(reportCustodyEventsTable.validUntil),
        inArray(reportCustodyEventsTable.event, [
          "RECEIVED_AT_DELIVERY_COUNTER",
          "PHYSICALLY_HANDED_OVER",
        ]),
      ),
    )
    .orderBy(desc(reportCustodyEventsTable.createdAt));

  const handover = rows.find((r) => r.event === "PHYSICALLY_HANDED_OVER");
  const receipt = rows.find((r) => r.event === "RECEIVED_AT_DELIVERY_COUNTER");
  const signedBy = (receipt?.verification as { paperSignedByName?: string } | null)?.paperSignedByName ?? null;

  return {
    physicalState: handover ? "HANDED_OVER" : receipt ? "AT_COUNTER" : null,
    receiptActorName: receipt?.actorName ?? null,
    receiptAt: receipt ? String(receipt.createdAt) : null,
    receiptEventId: receipt?.id ?? null,
    paperSignedByName: handover
      ? ((handover.verification as { paperSignedByName?: string } | null)?.paperSignedByName ?? signedBy)
      : signedBy,
  };
}

/**
 * The newest report row for one billed examination, if CARE has one.
 *
 * Two lookups, because the data has both shapes: `order_test_id` is what the
 * structured finalize writes, while older and pathology rows often carry only
 * the bill plus the test. The newest id wins — an amendment supersedes its
 * parent, and at a physical counter the paper in hand is the latest signed one.
 */
async function findReportRowForExam(args: {
  orderTestId: number;
  billId: number;
  testId: number;
}): Promise<number | null> {
  const byOrderTest = await db
    .select({ id: patientReportsTable.id })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.orderTestId, args.orderTestId))
    .orderBy(desc(patientReportsTable.id))
    .limit(1);
  if (byOrderTest[0]) return byOrderTest[0].id;

  const byBillAndTest = await db
    .select({ id: patientReportsTable.id })
    .from(patientReportsTable)
    .where(
      and(
        eq(patientReportsTable.billId, args.billId),
        eq(patientReportsTable.testId, args.testId),
        isNull(patientReportsTable.orderTestId),
      ),
    )
    .orderBy(desc(patientReportsTable.id))
    .limit(1);
  return byBillAndTest[0]?.id ?? null;
}

/**
 * A candidate for an examination whose report was produced outside CARE.
 *
 * Deliberately shaped like every other candidate so the two desks, the messages
 * and the ledger all read one structure. What it does NOT have is a report id, a
 * report number, or any clinical text — there is none to have.
 */
export function shapeWordExamCandidate(args: {
  orderTestId: number;
  testId: number;
  testName: string;
  patientLabel: string;
  bill: BillContext;
  state: ExamPaperState;
  paperSignedByName: string | null;
}): CandidateReport {
  const signedByName = (args.paperSignedByName ?? args.state.paperSignedByName ?? "").trim() || null;
  const verdict = args.state.physicalState === "HANDED_OVER"
    ? "ALREADY_HANDED_OVER"
    : args.state.physicalState === "AT_COUNTER"
      ? "ALREADY_AT_COUNTER"
      : signedByName
        ? "RECEIVED"
        : "WORD_REPORT_NOT_REGISTERED";

  return {
    reportId: null,
    reportNumber: null,
    origin: "word_registered",
    patientId: args.bill.patientId,
    patientLabel: args.patientLabel,
    testName: args.testName,
    status: "word_report",
    signedByName,
    signedAt: args.state.receiptAt,
    revision: 1,
    totalVersions: 1,
    superseded: false,
    accessionNumber: null,
    physicalState: args.state.physicalState,
    billId: args.bill.billId,
    orderId: args.bill.orderId,
    orderTestId: args.orderTestId,
    payment: args.bill.payment,
    verdict,
    // A Word paper's clinical authorization is the clerk's named acknowledgment on
    // the receipt. Without it there is nothing to authorise the handover, so this
    // stays false and the delivery desk refuses it — the owner's rule that no
    // unsigned or unauthorised report may leave, applied to paper CARE never saw.
    authorized: verdict === "RECEIVED" || verdict === "ALREADY_AT_COUNTER",
    message: reasonMessage(verdict),
    alreadyReceived:
      args.state.receiptActorName && args.state.receiptAt
        ? { actorName: args.state.receiptActorName, at: args.state.receiptAt }
        : null,
  };
}

/**
 * Every billed examination on a bill, each with its report and its paper state.
 *
 * The listing is deliberately the UNION of two things, because neither alone is
 * the truth at a counter:
 *
 *   • every `order_tests` line the bill bought — which is where a Word report
 *     lives, since it never became a `patient_reports` row;
 *   • every `patient_reports` row carrying this bill that no line consumed —
 *     which is where a report row written by hand, or an amendment, or a second
 *     report for one test still lives.
 *
 * Enumerating only the first would drop paper that exists; enumerating only the
 * second is the bug this module was written to fix. A delivery desk that silently
 * omits a report is worse than one that refuses it.
 */
export async function listBillExaminations(bill: BillContext): Promise<BillExamination[]> {
  const [orderRows, reportRows] = await Promise.all([
    db
      .select({
        orderTestId: orderTestsTable.id,
        testId: orderTestsTable.testId,
        // The bill shows a renamed line item when one was typed, so the counter
        // must show the same words the patient's receipt shows.
        displayName: orderTestsTable.displayName,
        testName: testsTable.name,
      })
      .from(orderTestsTable)
      .leftJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
      .where(
        and(
          eq(orderTestsTable.orderId, bill.orderId),
          // A cancelled line item was never performed, so its paper cannot be
          // arriving at the counter — listing it would invite a receipt for it.
          sql`${orderTestsTable.status} IS DISTINCT FROM 'cancelled'`,
        ),
      )
      .orderBy(asc(orderTestsTable.id)),
    db
      .select({
        id: patientReportsTable.id,
        testId: patientReportsTable.testId,
        orderTestId: patientReportsTable.orderTestId,
      })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.billId, bill.billId))
      .orderBy(asc(patientReportsTable.id)),
  ]);

  const patientLabel = await patientLabelOf(bill.patientId);
  const out: BillExamination[] = [];
  const consumed = new Set<number>();

  for (const row of orderRows) {
    const testName = (row.displayName ?? row.testName ?? `Test #${row.testId}`).trim();
    const reportId = await findReportRowForExam({
      orderTestId: row.orderTestId,
      billId: bill.billId,
      testId: row.testId,
    });

    if (reportId != null && consumed.has(reportId)) {
      // Two lines can buy the same test — a repeat study on one bill — and one
      // report row is one sheet of paper. Listing it under both lines would let a
      // single confirmation record the same arrival twice, and the clerk would be
      // told they received two reports when two copies of one left the desk.
      continue;
    }

    if (reportId != null) {
      const candidate = await buildCandidate(reportId);
      if (!candidate) continue;
      consumed.add(reportId);
      out.push(rowExamination(row.orderTestId, row.testId, testName, candidate));
      continue;
    }

    const state = await loadExamPaperState(row.orderTestId);
    const candidate = shapeWordExamCandidate({
      orderTestId: row.orderTestId,
      testId: row.testId,
      testName,
      patientLabel,
      bill,
      state,
      paperSignedByName: null,
    });
    out.push({
      orderTestId: row.orderTestId,
      testId: row.testId,
      testName,
      candidate,
      wordOnly: true,
      physicalState: state.physicalState,
      paperSignedByName: state.paperSignedByName,
      receiveVerdict: candidate.verdict,
      receiveMessage: candidate.message,
    });
  }

  // Rows this bill carries that no line item claimed. They are counted, not
  // guessed at: the clerk is shown the report and its own verdict, exactly as
  // before, and a hand-written or amended report cannot vanish from the desk
  // because the order was rebuilt under it.
  for (const row of reportRows) {
    if (consumed.has(row.id)) continue;
    const candidate = await buildCandidate(row.id);
    if (!candidate) continue;
    consumed.add(row.id);
    out.push(rowExamination(row.orderTestId, row.testId, candidate.testName ?? null, candidate));
  }

  return out;
}

/** A row-backed examination entry: the report exists, so the row is the identity. */
function rowExamination(
  orderTestId: number | null,
  testId: number | null,
  testName: string | null,
  candidate: CandidateReport,
): BillExamination {
  return {
    orderTestId,
    testId,
    testName: testName ?? candidate.testName ?? "",
    candidate,
    wordOnly: false,
    physicalState: candidate.physicalState,
    paperSignedByName: null,
    receiveVerdict: candidate.verdict,
    receiveMessage: candidate.message,
  };
}

/**
 * The delivery desk's view of the same list: every billed examination, each judged
 * against the bill the clerk scanned.
 *
 * Only the judgement differs from the receive desk, so the read is shared. Two
 * listings is how one bill ends up showing three reports to the person receiving
 * and four to the person handing over.
 */
export async function listBillHandoverExaminations(
  bill: BillContext,
): Promise<BillHandoverExamination[]> {
  const exams = await listBillExaminations(bill);
  return exams.map((exam) => ({ ...exam, candidate: judgeCandidateHandover(exam.candidate, bill) }));
}

/**
 * One examination's paper, described as a candidate — resolving its own bill.
 *
 * The bill is looked up rather than accepted from the request: the examination is
 * what the clerk pointed at, and the bill that bought it is a fact in the
 * database. It also means a Word receipt cannot be recorded against a bill the
 * examination does not belong to, which is the wrong-patient mistake in its other
 * form.
 */
export async function buildExamCandidate(
  orderTestId: number,
  paperSignedByName: string | null,
): Promise<{ candidate: CandidateReport; bill: BillContext; testId: number } | null> {
  const [row] = await db
    .select({
      orderTestId: orderTestsTable.id,
      testId: orderTestsTable.testId,
      orderId: ordersTable.id,
      patientId: ordersTable.patientId,
      displayName: orderTestsTable.displayName,
      testName: testsTable.name,
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      ledgerId: billsTable.ledgerId,
      total: billsTable.totalAmount,
      paid: billsTable.paidAmount,
      balance: billsTable.balanceAmount,
      billStatus: billsTable.status,
    })
    .from(orderTestsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderTestsTable.orderId))
    .innerJoin(
      billsTable,
      and(eq(billsTable.orderId, orderTestsTable.orderId), sql`${billsTable.status} IS DISTINCT FROM 'cancelled'`),
    )
    .leftJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(orderTestsTable.id, orderTestId))
    .limit(1);
  if (!row) return null;

  const payment: PaymentSnapshot = {
    status: "measured",
    billId: row.billId,
    billNumber: row.billNumber,
    ledgerId: row.ledgerId,
    total: row.total,
    paid: row.paid,
    balance: row.balance,
    billStatus: row.billStatus,
  };
  const bill: BillContext = {
    billId: row.billId,
    billNumber: row.billNumber,
    orderId: row.orderId,
    patientId: row.patientId,
    payment,
    settled: paymentIsSettled(Number(row.paid), Number(row.total)),
  };
  const state = await loadExamPaperState(row.orderTestId);
  return {
    candidate: shapeWordExamCandidate({
      orderTestId: row.orderTestId,
      testId: row.testId,
      testName: (row.displayName ?? row.testName ?? `Test #${row.testId}`).trim(),
      patientLabel: await patientLabelOf(row.patientId),
      bill,
      state,
      paperSignedByName,
    }),
    bill,
    testId: row.testId,
  };
}

/**
 * Receive the paper for one examination.
 *
 * Same act, same transaction, same idempotency rule as receiving a report row —
 * only the identity of the paper differs, so the recording is not reimplemented.
 */
export async function recordExamReceipt(args: {
  orderTestId: number;
  /** Required the first time. Ignored once a receipt exists, because a second
   *  clerk did not witness the signature and must not overwrite the first one's
   *  account of it. */
  paperSignedByName: string | null;
  scannedCode: string;
  requestId: string;
  batchId: string;
  batchSeq: number;
  actor: CustodyActor;
}): Promise<
  | { ok: true; eventId: number; candidate: CandidateReport }
  | { ok: false; reason: ReceiptReason; candidate: CandidateReport | null }
> {
  const built = await buildExamCandidate(args.orderTestId, args.paperSignedByName);
  if (!built) return { ok: false, reason: "REPORT_NOT_FOUND", candidate: null };

  // Where CARE has a row, the row is the identity — always, even when a request
  // names the examination instead. Recording the same paper twice under two keys
  // would leave one sheet with two custody states, which is the precise failure
  // this ledger exists to make impossible.
  const reportId = await findReportRowForExam({
    orderTestId: args.orderTestId,
    billId: built.bill.billId,
    testId: built.testId,
  });
  if (reportId != null) return recordOneReceipt({ ...args, reportId });

  return recordReceiptCandidate(built.candidate, args);
}

/**
 * Hand an examination's paper over, against the bill the clerk scanned.
 *
 * The bill is checked rather than assumed. A tick list comes from the server, so
 * only a hand-written request can name an examination from another bill — and the
 * answer it gets has to be a refusal, not an event that files the paper under a
 * bill that never bought it.
 */
export async function recordExamHandover(args: {
  orderTestId: number;
  scannedCode: string;
  bill: BillContext;
  requestId: string;
  batchId: string;
  batchSeq: number;
  recipientCategory: RecipientCategory;
  recipientName: string | null;
  paymentOverrideReason: string | null;
  actor: CustodyActor;
}): Promise<
  | { ok: true; eventId: number; candidate: HandoverCandidate }
  | { ok: false; reason: HandoverReason; candidate: HandoverCandidate | null }
> {
  const built = await buildExamCandidate(args.orderTestId, null);
  if (!built) return { ok: false, reason: "REPORT_NOT_FOUND", candidate: null };

  const reportId = await findReportRowForExam({
    orderTestId: args.orderTestId,
    billId: built.bill.billId,
    testId: built.testId,
  });
  if (reportId != null) {
    const { orderTestId: _exam, ...rowArgs } = args;
    return recordOneHandover({ ...rowArgs, reportId });
  }

  if (built.bill.billId !== args.bill.billId) {
    return {
      ok: false,
      reason: "NOT_ON_THIS_BILL",
      candidate: judgeCandidateHandover(built.candidate, args.bill),
    };
  }

  return recordHandoverCandidate(judgeCandidateHandover(built.candidate, args.bill), args);
}
