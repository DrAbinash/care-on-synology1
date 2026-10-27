/**
 * Report custody routes — the server half of the two scanner operations.
 *
 * `/scan` + `/receive` are the first (PR-3); `/bill`, `/handover/scan` and
 * `/handover` are the second (PR-4); `GET /queues` is the third (PR-5) and is the
 * only read here — it is gated on `view` because the dashboard is a different
 * entitlement from moving paper, and it answers "where is the paper", not "what
 * does the report say".
 *
 * Why these are new endpoints rather than more behaviour on `/api/resolve-barcode`:
 * the resolver answers "what is this code?" and several departments call it, so it
 * can only be gated as wide as its widest legitimate user. A custody write needs
 * the opposite — one named action, refused by default — and putting it on a shared
 * read endpoint would have meant either weakening the read or breaking a page that
 * shares it. So the reads stay where they are, and every write that puts a row in
 * `report_custody_events` lives behind `requireStaffSubPermission`.
 *
 * Failing closed here is not a risk of regression: no workflow calls these routes
 * yet, so the only thing an unassigned staff account loses is a button that did
 * not exist last week. An admin grants Report Delivery in Settings → Users.
 *
 * Neither write touches `patient_reports.status`. See the note at the head of
 * lib/reportCustodyDeliver.ts for why that is a money decision and not this one.
 *
 * **The bill QR is the code this counter runs on.** Most reports here are typed in
 * Microsoft Word and never become a `patient_reports` row, so a bill scan lists the
 * examination that was bought rather than the report rows that happen to exist —
 * and an examination with no row is still received, still judged, and still on the
 * ledger, keyed to `order_test_id` with no report id at all. A report number remains
 * accepted, because per-report barcode printing stays a future option, not a
 * precondition.
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, scanAuditLogsTable } from "@workspace/db/schema";
import { requireStaffAuth, requireStaffSubPermission, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { DELIVERY_MODULE } from "../lib/deliveryAccess";
import {
  RECEIVE_BATCH_LIMIT,
  candidateKey,
  reasonMessage,
  recordOneReceipt,
  resolveScannedCode,
  buildCandidate,
  type CandidateReport,
  type CustodyActor,
  type ReceiptReason,
} from "../lib/reportCustodyReceive";
import {
  buildHandoverCandidate,
  isRecipientCategory,
  recordOneHandover,
  reportIdFromScannedCode,
  resolveScannedBill,
  type BillContext,
  type HandoverCandidate,
  type RecipientCategory,
} from "../lib/reportCustodyDeliver";
import {
  listBillExaminations,
  listBillHandoverExaminations,
  recordExamHandover,
  recordExamReceipt,
  type BillExamination,
  type BillHandoverExamination,
} from "../lib/reportCustodyExams";
import { readCustodyQueues } from "../lib/reportCustodyQueues";

const router: IRouter = Router();
router.use(requireStaffAuth);

/**
 * The actor, read off the session. Nothing in this object is allowed to come from
 * the request body: a client-supplied staff name would let one clerk acknowledge
 * paper on a colleague's account and leave the ledger unable to tell.
 */
function actorOf(req: StaffAuthRequest): CustodyActor | null {
  const s = req.staffSession;
  if (!s) return null;
  return {
    userId: s.subjectId,
    name: s.subjectName,
    role: s.role,
    sessionId: s.id,
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}

/** Two books can print the same number, so the number alone is not an identity.
 *  Both desks refuse with this one sentence rather than each inventing a phrasing
 *  for the same fact. */
const AMBIGUOUS_BILL_SENTENCE =
  "This bill number was issued by more than one book. Open the bill from its book and work the counter there.";

/** What the counter may show about a report — identity and state, never content. */
function publicCandidate(c: CandidateReport) {
  return {
    /** Stable across both identities, so one screen can key a list on it: a report
     *  row when CARE produced one, the billed examination when the paper came out
     *  of Word and there is no row to name. */
    rowKey: candidateKey(c),
    reportId: c.reportId,
    reportNumber: c.reportNumber,
    origin: c.origin,
    orderTestId: c.orderTestId,
    patientId: c.patientId,
    patientLabel: c.patientLabel,
    testName: c.testName,
    status: c.status,
    signedByName: c.signedByName,
    signedAt: c.signedAt,
    revision: c.revision,
    totalVersions: c.totalVersions,
    superseded: c.superseded,
    physicalState: c.physicalState,
    accessionNumber: c.accessionNumber,
    billId: c.billId,
    payment: c.payment,
    verdict: c.verdict,
    message: c.message,
    alreadyReceived: c.alreadyReceived,
  };
}

/** What both desks show about the examination itself: what was bought, and where
 *  its paper is. The report's identity and verdict travel inside `candidate`. */
function examIdentity(exam: BillExamination) {
  return {
    orderTestId: exam.orderTestId,
    testId: exam.testId,
    testName: exam.testName,
    /** True when CARE holds no report row for it — the report was typed in Word,
     *  so the desk needs a name on the paper before it can accept it. */
    wordOnly: exam.wordOnly,
    paperSignedByName: exam.paperSignedByName,
    physicalState: exam.physicalState,
  };
}

/** The receive desk's row. */
function publicExam(exam: BillExamination) {
  return { ...examIdentity(exam), candidate: publicCandidate(exam.candidate) };
}

/** One item on a confirmation, in whichever identity the paper has.
 *
 * A report row when CARE produced the report, or the billed examination when the
 * report was typed in Word and there is no row to point at. One parser for both
 * desks, because a delivery confirmation names the same two identities.
 */
type NormalizedCustodyItem =
  | {
      kind: "report";
      rowKey: string;
      reportId: number;
      orderTestId: null;
      scannedCode: string;
      paperSignedByName: null;
    }
  | {
      kind: "exam";
      rowKey: string;
      reportId: null;
      orderTestId: number;
      scannedCode: string;
      paperSignedByName: string | null;
    };

function parseCustodyItem(raw: unknown): { item: NormalizedCustodyItem } | { error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const reportId = Number(o.reportId);
  const orderTestId = Number(o.orderTestId);
  const hasReport = Number.isFinite(reportId) && reportId > 0;
  const hasExam = Number.isFinite(orderTestId) && orderTestId > 0;
  if (hasReport && hasExam) {
    return { error: "An item names both a report and an examination. Nothing was recorded." };
  }
  if (!hasReport && !hasExam) {
    return { error: "Every item needs a reportId or an orderTestId. Nothing was recorded." };
  }
  const scannedCode = typeof o.scannedCode === "string" ? o.scannedCode.slice(0, 512) : "";
  const signedBy = typeof o.paperSignedByName === "string" ? o.paperSignedByName.trim().slice(0, 120) : "";
  if (hasReport) {
    return {
      item: { kind: "report", rowKey: `report:${reportId}`, reportId, orderTestId: null, scannedCode, paperSignedByName: null },
    };
  }
  // The clerk's named signature belongs on the examination branch only: a report
  // row carries its own signer, and accepting a name for it here would let a
  // request overwrite what the clinician actually signed.
  return {
    item: { kind: "exam", rowKey: `exam:${orderTestId}`, reportId: null, orderTestId, scannedCode, paperSignedByName: signedBy || null },
  };
}

// ─── POST /api/report-custody/scan ──────────────────────────────────────────
// One scanned code, validated, NOTHING WRITTEN. The clerk builds a review list
// from these and a single Confirm click at the end records the batch — scanning
// must never mark a report physically received.
router.post("/scan", requireStaffSubPermission(DELIVERY_MODULE, "receive"), async (req: StaffAuthRequest, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const actor = actorOf(req);
  if (!actor) { res.status(401).json({ error: "Staff authentication required" }); return; }
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  const page = typeof req.body?.page === "string" ? req.body.page.slice(0, 64) : "report-delivery-receive";
  const logAttempt = async (
    linked: { reportId: number | null; patientId: number | null },
    status: "success" | "failed",
    details: string,
  ) => {
    await db
      .insert(scanAuditLogsTable)
      .values({
        userId: actor.userId,
        username: actor.name,
        method: "counter_scanner",
        linkedPatientId: linked.patientId,
        linkedReportId: linked.reportId,
        page,
        status,
        details: details.slice(0, 2000),
        scannedCode: code.slice(0, 512),
      })
      .catch(() => { /* never fail a scan because the audit insert did */ });
  };

  // The bill is asked first, because in this clinic the bill QR is the code that
  // exists: reports are typed in Word and have no barcode of their own. A report
  // number is still accepted, and is what a per-sheet scan will use if printing
  // labels is ever turned on.
  const billRead = await resolveScannedBill(code);
  if (billRead.kind === "bill") {
    const examinations = await listBillExaminations(billRead.bill);
    await logAttempt(
      { reportId: null, patientId: billRead.bill.patientId },
      "success",
      `BILL_RESOLVED ${billRead.bill.billId} -> ${examinations.length} examination(s)`,
    );
    res.json({
      outcome: "bill",
      scannedCode: code,
      billId: billRead.bill.billId,
      bill: billRead.bill,
      // "Display the patient and examinations associated with the bill": the bill
      // is what names the person standing at the counter.
      patient: await patientOf(billRead.bill.patientId),
      examinations: examinations.map(publicExam),
    });
    return;
  }
  // Two books can print the same number, and guessing whose paper this is would be
  // the exact failure the ledger exists to make visible. Stop here rather than
  // falling through to the report arm, which would answer "not a report code".
  if (billRead.reason === "AMBIGUOUS_BILL") {
    await logAttempt({ reportId: null, patientId: null }, "failed", "AMBIGUOUS_BILL");
    res.status(422).json({
      outcome: "unknown",
      reason: "AMBIGUOUS_BILL",
      // The same sentence the delivery desk gives, from one place in this file.
      message: AMBIGUOUS_BILL_SENTENCE,
    });
    return;
  }

  const outcome = await resolveScannedCode(code);

  // A scan that resolves to nothing is still worth keeping: "the same label
  // rejected four times today" is a printer or a barcode problem, and it is
  // invisible unless it is recorded. This is the ordinary scan-attempt log, NOT a
  // custody event — an attempt that changed nothing must not look like an act,
  // which is why it lands in `scan_audit_logs` and not `report_custody_events`.
  if (outcome.kind === "unknown") {
    await logAttempt({ reportId: null, patientId: null }, "failed", outcome.reason);
    res.status(422).json({
      outcome: "unknown",
      reason: outcome.reason,
      message: reasonMessage(outcome.reason),
    });
    return;
  }

  // Unreachable in one piece of configuration: `resolveScannedBill` above already
  // took every bill this clinic recognises. It stays because the two resolvers read
  // the same tables separately, and a code that means "bill" to one of them must not
  // be answered with `outcome.reportId` from the other.
  if (outcome.kind !== "report") {
    await logAttempt({ reportId: null, patientId: null }, "failed", "NOT_A_REPORT_CODE");
    res.status(422).json({
      outcome: "unknown",
      reason: "NOT_A_REPORT_CODE",
      message: reasonMessage("NOT_A_REPORT_CODE"),
    });
    return;
  }

  const candidate = await buildCandidate(outcome.reportId);
  if (!candidate) {
    await logAttempt({ reportId: null, patientId: null }, "failed", "REPORT_NOT_FOUND");
    res.status(404).json({ outcome: "unknown", reason: "REPORT_NOT_FOUND", message: reasonMessage("REPORT_NOT_FOUND") });
    return;
  }
  await logAttempt(
    { reportId: candidate.reportId, patientId: candidate.patientId },
    candidate.verdict === "RECEIVED" ? "success" : "failed",
    candidate.verdict,
  );
  // 200 even for a refusal: the scan was understood, the report just is not
  // receivable, and the clerk needs the reason inline in the review list.
  res.json({ outcome: "report", scannedCode: outcome.scannedCode, candidate: publicCandidate(candidate) });
});

// ─── POST /api/report-custody/receive ───────────────────────────────────────
// The one explicit confirmation behind a batch of validated scans.
router.post("/receive", requireStaffSubPermission(DELIVERY_MODULE, "receive"), async (req: StaffAuthRequest, res) => {
  const actor = actorOf(req);
  if (!actor) { res.status(401).json({ error: "Staff authentication required" }); return; }

  const items = Array.isArray(req.body?.items) ? (req.body.items as unknown[]) : null;
  if (!items || items.length === 0) {
    res.status(400).json({ error: "items is required — nothing was recorded" });
    return;
  }
  if (items.length > RECEIVE_BATCH_LIMIT) {
    // The cap is the owner's, and it is enforced server-side: a browser tab that
    // lost its list would otherwise be able to receipt the whole month.
    res.status(400).json({
      error: `A single confirmation covers at most ${RECEIVE_BATCH_LIMIT} reports. Nothing was recorded; split the batch.`,
      limit: RECEIVE_BATCH_LIMIT,
    });
    return;
  }

  const normalized: NormalizedCustodyItem[] = [];
  for (const raw of items) {
    const parsed = parseCustodyItem(raw);
    if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
    normalized.push(parsed.item);
  }

  // One batch id for the clerk action, one request id for the HTTP call. They are
  // different: a retry of the same click must not double-record (the idempotency
  // key is derived from the request id), while the batch id is how the dashboard
  // says "these 40 reports arrived together, at 14:32, by this person".
  const batchId = typeof req.body?.batchId === "string" && req.body.batchId ? req.body.batchId : randomUUID();
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId ? req.body.requestId : randomUUID();

  const results = await Promise.all(
    normalized.map(async (item, index) => {
      const shared = {
        scannedCode: item.scannedCode,
        requestId,
        batchId,
        batchSeq: index + 1,
        actor,
      };
      // Two identities, one act. The examination-keyed branch is the Word report:
      // no row exists, so the clerk's named signature travels with the item and is
      // recorded on the event — never into a clinical table.
      const r = item.kind === "report"
        ? await recordOneReceipt({ ...shared, reportId: item.reportId })
        : await recordExamReceipt({
            ...shared,
            orderTestId: item.orderTestId,
            paperSignedByName: item.paperSignedByName,
          });
      const identity = {
        rowKey: item.rowKey,
        reportId: item.reportId,
        orderTestId: item.orderTestId,
      };
      if (r.ok) {
        return {
          ...identity,
          scannedCode: item.scannedCode,
          ok: true as const,
          eventId: r.eventId,
          reason: "RECEIVED" satisfies ReceiptReason,
          message: reasonMessage("RECEIVED"),
          candidate: publicCandidate(r.candidate),
        };
      }
      return {
        ...identity,
        scannedCode: item.scannedCode,
        ok: false as const,
        reason: r.reason,
        // The ledger's own words, not a second copy of them in the client.
        message: r.candidate?.message ?? reasonMessage(r.reason),
        candidate: r.candidate ? publicCandidate(r.candidate) : null,
      };
    }),
  );

  const received = results.filter((r) => r.ok).length;
  res.json({
    batchId,
    requestId,
    received,
    refused: results.length - received,
    // Per-item, in the order scanned. Not all-or-nothing: a clerk who gets 39 of
    // 40 must be told which one failed and why, not asked to start over.
    results,
  });
});

// ═══ DELIVER REPORTS ════════════════════════════════════════════════════════

/** The handover view of a candidate: identity, state, and the one verdict that
 *  matters here. Report content is still absent — this is a delivery desk. */
function publicHandover(c: HandoverCandidate) {
  return {
    ...publicCandidate(c),
    handoverVerdict: c.handoverVerdict,
    handoverMessage: c.handoverMessage,
    needsPaymentOverride: c.needsPaymentOverride,
  };
}

/** The delivery desk's row: the same examination, judged for handing over. */
function publicHandoverExam(exam: BillHandoverExamination) {
  return { ...examIdentity(exam), candidate: publicHandover(exam.candidate) };
}

/**
 * Step 1 of the handover: scan the patient's bill QR.
 *
 * The bill is what names the patient, so it is read from the database here and
 * returned with every report billed on it, each already judged. Nothing is
 * written — the write is the single Confirm at the end.
 */
router.post("/bill", requireStaffSubPermission(DELIVERY_MODULE, "handover"), async (req: StaffAuthRequest, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  const outcome = await resolveScannedBill(code);
  if (outcome.kind === "unknown") {
    res.status(422).json({
      outcome: "unknown",
      reason: outcome.reason,
      message: outcome.reason === "AMBIGUOUS_BILL"
        ? AMBIGUOUS_BILL_SENTENCE
        : "That is not a bill this clinic recognises.",
    });
    return;
  }

  // Every examination bought on the bill, each judged for handover. A Word report
  // is in this list because the examination is in it; a report CARE produced is in
  // it because its row is. Nothing here is written, and nothing here is ticked —
  // the bill scan cannot know which pieces of paper are on the counter.
  const examinations = await listBillHandoverExaminations(outcome.bill);
  res.json({
    outcome: "bill",
    bill: outcome.bill,
    // Identity only, and only as much as a delivery desk needs to say a name aloud.
    patient: await patientOf(outcome.bill.patientId),
    examinations: examinations.map(publicHandoverExam),
  });
});

/**
 * Step 2: scan the report sheet itself. One code, one verdict against the bill
 * already established. Still nothing written — a sheet being picked up is not a
 * sheet being handed over.
 */
router.post("/handover/scan", requireStaffSubPermission(DELIVERY_MODULE, "handover"), async (req: StaffAuthRequest, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const billCode = typeof req.body?.billCode === "string" ? req.body.billCode.trim() : "";
  if (!code || !billCode) { res.status(400).json({ error: "code and billCode are both required" }); return; }

  const bill = await billFromCode(billCode);
  if (!bill) {
    res.status(422).json({ outcome: "unknown", reason: "NOT_A_BILL_CODE", message: "The bill for this handover could not be read. Scan it again." });
    return;
  }

  const resolved = await reportIdFromScannedCode(code);
  if (typeof resolved === "string") {
    res.status(422).json({ outcome: "unknown", reason: resolved, message: resolved });
    return;
  }
  const candidate = await buildHandoverCandidate(resolved, bill);
  if (!candidate) {
    res.status(404).json({ outcome: "unknown", reason: "REPORT_NOT_FOUND", message: "No report with that number." });
    return;
  }
  res.json({ outcome: "report", scannedCode: code, candidate: publicHandover(candidate) });
});

/**
 * Step 3: the one explicit confirmation. Each report the clerk ticked becomes its
 * own `PHYSICALLY_HANDED_OVER` event, in its own transaction.
 *
 * The bill is re-resolved from the scanned code rather than taken from the client,
 * because the bill is what decides the patient — and the patient is the thing a
 * wrong-patient handover turns on.
 */
router.post("/handover", requireStaffSubPermission(DELIVERY_MODULE, "handover"), async (req: StaffAuthRequest, res) => {
  const actor = actorOf(req);
  if (!actor) { res.status(401).json({ error: "Staff authentication required" }); return; }

  const billCode = typeof req.body?.billCode === "string" ? req.body.billCode.trim() : "";
  const bill = billCode ? await billFromCode(billCode) : null;
  if (!bill) {
    res.status(422).json({ error: "The bill for this handover could not be read. Nothing was recorded." });
    return;
  }

  const items = Array.isArray(req.body?.items) ? (req.body.items as unknown[]) : null;
  if (!items || items.length === 0) {
    res.status(400).json({ error: "items is required — nothing was handed over" });
    return;
  }
  if (items.length > RECEIVE_BATCH_LIMIT) {
    res.status(400).json({ error: `One confirmation covers at most ${RECEIVE_BATCH_LIMIT} reports. Nothing was recorded.` });
    return;
  }

  // Recipient is a category, never a free-typed name. Somebody's relative is not
  // an identity the counter is asked to verify, and inventing a field for it would
  // make the ledger look like a register of people rather than of paper.
  if (!isRecipientCategory(req.body?.recipientCategory)) {
    res.status(400).json({
      error: "Say who the paper went to by category: patient, family member, carrying agent, or left for collection.",
      allowed: ["PATIENT", "FAMILY_MEMBER", "CARRYING_AGENT", "DOOR_DROP"],
    });
    return;
  }
  const recipientCategory = req.body.recipientCategory as Parameters<typeof recordOneHandover>[0]["recipientCategory"];
  const recipientName = typeof req.body?.recipientName === "string" && req.body.recipientName.trim()
    ? req.body.recipientName.trim().slice(0, 120)
    : null;
  const paymentOverrideReason = typeof req.body?.paymentOverrideReason === "string" && req.body.paymentOverrideReason.trim()
    ? req.body.paymentOverrideReason.trim().slice(0, 500)
    : null;

  const normalized: NormalizedCustodyItem[] = [];
  for (const raw of items) {
    const parsed = parseCustodyItem(raw);
    if ("error" in parsed) { res.status(400).json({ error: parsed.error }); return; }
    normalized.push(parsed.item);
  }

  const batchId = typeof req.body?.batchId === "string" && req.body.batchId ? req.body.batchId : randomUUID();
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId ? req.body.requestId : randomUUID();

  const results = await Promise.all(
    normalized.map(async (item, index) => {
      const shared = {
        scannedCode: item.scannedCode,
        bill,
        requestId,
        batchId,
        batchSeq: index + 1,
        recipientCategory,
        recipientName,
        paymentOverrideReason,
        actor,
      };
      // The same two identities as the receive desk, and deliberately no signer
      // name on this one: who signed a Word report is what the clerk who RECEIVED
      // it said. A delivery request that could restate it would let the second
      // account overwrite the first.
      const r = item.kind === "report"
        ? await recordOneHandover({ ...shared, reportId: item.reportId })
        : await recordExamHandover({ ...shared, orderTestId: item.orderTestId });
      const identity = {
        rowKey: item.rowKey,
        reportId: item.reportId,
        orderTestId: item.orderTestId,
      };
      if (r.ok) {
        return {
          ...identity,
          scannedCode: item.scannedCode,
          ok: true as const,
          eventId: r.eventId,
          reason: "DELIVERABLE" as const,
          message: "Handed over and recorded.",
          overrodePayment: Boolean(r.candidate.needsPaymentOverride),
          candidate: publicHandover(r.candidate),
        };
      }
      return {
        ...identity,
        scannedCode: item.scannedCode,
        ok: false as const,
        reason: r.reason,
        message: r.candidate?.handoverMessage ?? "Could not be handed over.",
        candidate: r.candidate ? publicHandover(r.candidate) : null,
      };
    }),
  );

  const handed = results.filter((r) => r.ok).length;
  res.json({
    batchId,
    requestId,
    billNumber: bill.billNumber,
    handed,
    refused: results.length - handed,
    // Partial delivery is expected, not an error: a patient who collects one
    // report today and the other on Monday must be able to finish the half they
    // came for.
    results,
  });
});

/**
 * ─── GET /api/report-custody/queues ──────────────────────────────────────────
 *
 * The dashboard's four queues, read straight from the custody ledger. Gated on
 * the module's own `view` action, and it returns identity and physical state
 * only — bill number, patient, examination, who moved the paper and when. No
 * body, no impression: a queue is not a place to read a report.
 *
 * `?limit=` and `?handedOverDays=` are clamped by the library, not here, so a
 * hand-typed large number cannot turn a dashboard poll into a full-ledger scan.
 */
router.get("/queues", requireStaffSubPermission(DELIVERY_MODULE, "view"), async (req: StaffAuthRequest, res) => {
  try {
    const queues = await readCustodyQueues({
      limit: req.query.limit == null ? undefined : Number(req.query.limit),
      handedOverDays: req.query.handedOverDays == null ? undefined : Number(req.query.handedOverDays),
    });
    res.json(queues);
  } catch (err) {
    console.error("[GET /api/report-custody/queues]", err);
    res.status(500).json({ error: "The delivery queues could not be read. Nothing was changed." });
  }
});

/** Re-read the bill from the code the clerk scanned. */
async function billFromCode(code: string): Promise<BillContext | null> {
  const outcome = await resolveScannedBill(code);
  return outcome.kind === "bill" ? outcome.bill : null;
}

/** Name and patient code — enough to say "is this Mrs X?" and nothing more. */
async function patientOf(patientId: number): Promise<{ patientId: number; name: string; patientCode: string } | null> {
  const [p] = await db
    .select({
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      patientCode: patientsTable.patientId,
    })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!p) return null;
  return { patientId, name: `${p.firstName} ${p.lastName ?? ""}`.trim(), patientCode: p.patientCode };
}

export default router;
