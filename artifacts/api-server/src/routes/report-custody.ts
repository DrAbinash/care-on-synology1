/**
 * Report custody routes — the server half of the two scanner operations.
 *
 * `/scan` + `/receive` are the first (PR-3); `/bill`, `/handover/scan` and
 * `/handover` are the second (PR-4).
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
  handoverCandidatesForBill,
  isRecipientCategory,
  recordOneHandover,
  reportIdFromScannedCode,
  resolveBillForHandover,
  type BillContext,
  type HandoverCandidate,
} from "../lib/reportCustodyDeliver";

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

/** What the counter may show about a report — identity and state, never content. */
function publicCandidate(c: CandidateReport) {
  return {
    reportId: c.reportId,
    reportNumber: c.reportNumber,
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
  const outcome = await resolveScannedCode(code);

  // A scan that resolves to nothing is still worth keeping: "the same label
  // rejected four times today" is a printer or a barcode problem, and it is
  // invisible unless it is recorded. This is the ordinary scan-attempt log, NOT a
  // custody event — an attempt that changed nothing must not look like an act,
  // which is why it lands in `scan_audit_logs` and not `report_custody_events`.
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

  if (outcome.kind === "unknown") {
    await logAttempt({ reportId: null, patientId: null }, "failed", outcome.reason);
    res.status(422).json({
      outcome: "unknown",
      reason: outcome.reason,
      message: reasonMessage(outcome.reason),
    });
    return;
  }

  if (outcome.kind === "report") {
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
    return;
  }

  // A bill code pulls every report billed on it, each judged separately. The
  // clerk still confirms; nothing here writes.
  const candidates = (await Promise.all(outcome.reportIds.map((id) => buildCandidate(id)))).filter(
    (c): c is CandidateReport => c !== null,
  );
  await logAttempt(
    { reportId: candidates[0]?.reportId ?? null, patientId: candidates[0]?.patientId ?? null },
    "success",
    `BILL_RESOLVED ${outcome.billId} -> ${candidates.length} report(s)`,
  );
  res.json({
    outcome: "bill",
    scannedCode: outcome.scannedCode,
    billId: outcome.billId,
    candidates: candidates.map(publicCandidate),
  });
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

  const normalized: Array<{ reportId: number; scannedCode: string }> = [];
  for (const raw of items) {
    const reportId = typeof raw === "object" && raw !== null ? Number((raw as { reportId?: unknown }).reportId) : NaN;
    if (!Number.isFinite(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Every item needs a numeric reportId. Nothing was recorded." });
      return;
    }
    const scannedCode =
      typeof raw === "object" && raw !== null && typeof (raw as { scannedCode?: unknown }).scannedCode === "string"
        ? String((raw as { scannedCode: string }).scannedCode).slice(0, 512)
        : "";
    normalized.push({ reportId, scannedCode });
  }

  // One batch id for the clerk action, one request id for the HTTP call. They are
  // different: a retry of the same click must not double-record (the idempotency
  // key is derived from the request id), while the batch id is how the dashboard
  // says "these 40 reports arrived together, at 14:32, by this person".
  const batchId = typeof req.body?.batchId === "string" && req.body.batchId ? req.body.batchId : randomUUID();
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId ? req.body.requestId : randomUUID();

  const results = await Promise.all(
    normalized.map(async (item, index) => {
      const r = await recordOneReceipt({
        reportId: item.reportId,
        scannedCode: item.scannedCode,
        requestId,
        batchId,
        batchSeq: index + 1,
        actor,
      });
      if (r.ok) {
        return {
          reportId: item.reportId,
          scannedCode: item.scannedCode,
          ok: true as const,
          eventId: r.eventId,
          reason: "RECEIVED" satisfies ReceiptReason,
          message: reasonMessage("RECEIVED"),
          candidate: publicCandidate(r.candidate),
        };
      }
      return {
        reportId: item.reportId,
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

  const outcome = await resolveBillForHandover(code);
  if (outcome.kind === "unknown") {
    res.status(422).json({
      outcome: "unknown",
      reason: outcome.reason,
      message: outcome.reason === "AMBIGUOUS_BILL"
        ? "This bill number was issued by more than one book. Open the bill from its book and deliver from there."
        : "That is not a bill this clinic recognises.",
    });
    return;
  }

  const candidates = await handoverCandidatesForBill(outcome.bill);
  res.json({
    outcome: "bill",
    bill: outcome.bill,
    // Identity only, and only as much as a delivery desk needs to say a name aloud.
    patient: await patientOf(outcome.bill.patientId),
    candidates: candidates.map(publicHandover),
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

  const normalized: Array<{ reportId: number; scannedCode: string }> = [];
  for (const raw of items) {
    const reportId = Number((raw as { reportId?: unknown })?.reportId);
    if (!Number.isFinite(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Every item needs a numeric reportId. Nothing was recorded." });
      return;
    }
    const scannedCode = typeof (raw as { scannedCode?: unknown })?.scannedCode === "string"
      ? String((raw as { scannedCode: string }).scannedCode).slice(0, 512)
      : "";
    normalized.push({ reportId, scannedCode });
  }

  const batchId = typeof req.body?.batchId === "string" && req.body.batchId ? req.body.batchId : randomUUID();
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId ? req.body.requestId : randomUUID();

  const results = await Promise.all(
    normalized.map(async (item, index) => {
      const r = await recordOneHandover({
        reportId: item.reportId,
        scannedCode: item.scannedCode,
        bill,
        requestId,
        batchId,
        batchSeq: index + 1,
        recipientCategory,
        recipientName,
        paymentOverrideReason,
        actor,
      });
      if (r.ok) {
        return {
          reportId: item.reportId,
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
        reportId: item.reportId,
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

/** Re-read the bill from the code the clerk scanned. */
async function billFromCode(code: string): Promise<BillContext | null> {
  const outcome = await resolveBillForHandover(code);
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
