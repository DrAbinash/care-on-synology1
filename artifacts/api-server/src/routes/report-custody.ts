/**
 * Report custody routes — the two scanner operations' server half.
 *
 * PR-3 ships RECEIVE. PR-4 adds DELIVER here.
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
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { scanAuditLogsTable } from "@workspace/db/schema";
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

export default router;
