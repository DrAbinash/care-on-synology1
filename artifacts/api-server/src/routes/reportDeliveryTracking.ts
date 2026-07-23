// Staff-selected WhatsApp report delivery + read-receipt tracking + reminders.
//
// Mounted at /api/report-delivery-tracking behind requireStaffAuth +
// requireStaffPermission("/reports") and ff_report_delivery_receipts (Shadow
// Mode). Deliberately staff-driven: a staff member selects specific report(s)
// to send — there is NO bulk "send every report" path (the clinic has no infra
// to push all reports online). Every send records a receipt row that the Meta
// webhook later advances through sent → delivered → read. Additive,
// non-financial, audited.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { patientReportsTable, patientsTable, reportDeliveryReceiptsTable, reportSharesTable, whatsappSettingsTable, billsTable } from "@workspace/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { sendReportDelivery } from "./whatsapp";
import { ensurePublicToken } from "./patient-reports";
import { recordReceipt, markReminded, findRemindableReceipts } from "../lib/reportDeliveryReceipts";

export const reportDeliveryTrackingRouter = Router();
reportDeliveryTrackingRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_report_delivery_receipts")) { next(); return; }
  res.status(503).json({ error: "Report delivery tracking is disabled. Enable ff_report_delivery_receipts." });
});

function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
const audit = (req: Request, e: { action: string; entityType?: string; entityId?: string; newValue?: string; reason?: string }) =>
  auditFromRequest(req, { ...actorOf(req), module: "report_delivery", ...e });

function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

async function buildReportUrl(reportId: number): Promise<string | null> {
  const base = publicBaseUrl();
  if (!base) return null;
  const token = await ensurePublicToken(reportId);
  if (!token) return null;
  return `${base}/api/p/r/${token}/pdf`;
}

// ── Send selected reports ─────────────────────────────────────────────────────
const sendBody = z.object({ reportIds: z.array(z.coerce.number().int().positive()).min(1).max(50) });

reportDeliveryTrackingRouter.post("/send", async (req: Request, res: Response) => {
  const p = sendBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const actor = actorOf(req);
  const results: Array<{ reportId: number; ok: boolean; status: string; receiptId?: number | null; reason?: string }> = [];

  for (const reportId of p.data.reportIds) {
    const [report] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId)).limit(1);
    if (!report) { results.push({ reportId, ok: false, status: "skipped", reason: "Report not found" }); continue; }
    if (report.status !== "verified" && report.status !== "delivered") {
      results.push({ reportId, ok: false, status: "skipped", reason: "Report not verified yet" }); continue;
    }
    const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, report.patientId)).limit(1);
    if (!patient || !patient.phone) { results.push({ reportId, ok: false, status: "skipped", reason: "Patient has no phone" }); continue; }

    const reportUrl = (await buildReportUrl(reportId)) ?? "";
    const patientName = `${patient.firstName} ${patient.lastName}`.trim();
    const send = await sendReportDelivery({
      phone: patient.phone,
      patientName,
      reportNumber: report.reportNumber,
      testName: report.title,
      reportUrl,
    });

    if (send.skipped) { results.push({ reportId, ok: false, status: "skipped", reason: "WhatsApp disabled" }); continue; }

    const receiptId = await recordReceipt({
      reportId,
      patientId: report.patientId,
      providerMessageId: send.messageId ?? null,
      phone: patient.phone,
      reportNumber: report.reportNumber,
      testName: report.title,
      patientName,
      viewerUrl: reportUrl || null,
      status: send.ok ? "sent" : "failed",
      sentBy: actor.userId != null ? String(actor.userId) : null,
      sentByName: actor.userName,
      lastError: send.ok ? null : (send.error ?? "send failed"),
    });
    // Mirror into the canonical report_shares log the front desk already reads.
    await db.insert(reportSharesTable).values({
      reportId, channel: "whatsapp", recipient: patient.phone, sharedBy: actor.userName,
      status: send.ok ? "sent" : "failed", errorMessage: send.ok ? null : (send.error ?? null),
    }).catch(() => {});
    results.push({ reportId, ok: send.ok, status: send.ok ? "sent" : "failed", receiptId, reason: send.ok ? undefined : send.error });
  }

  const sent = results.filter((r) => r.ok).length;
  await audit(req, { action: "send", entityType: "report_delivery", entityId: p.data.reportIds.join(","), newValue: JSON.stringify({ sent, total: results.length }) });
  res.json({ sent, failed: results.length - sent, total: results.length, results });
});

// ── Receipts list (tracking view) ─────────────────────────────────────────────
reportDeliveryTrackingRouter.get("/receipts", async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const patientId = z.coerce.number().int().positive().optional().safeParse(req.query.patientId);
  const conds = [];
  if (status && ["sent", "delivered", "read", "failed"].includes(status)) conds.push(eq(reportDeliveryReceiptsTable.status, status));
  if (patientId.success && patientId.data) conds.push(eq(reportDeliveryReceiptsTable.patientId, patientId.data));
  if (from) conds.push(gte(reportDeliveryReceiptsTable.sentAt, new Date(from)));
  if (to) conds.push(lte(reportDeliveryReceiptsTable.sentAt, new Date(to)));
  const rows = await db.select().from(reportDeliveryReceiptsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(reportDeliveryReceiptsTable.sentAt))
    .limit(500);
  res.json(rows);
});

// ── Receipts summary (counts by status) ───────────────────────────────────────
reportDeliveryTrackingRouter.get("/receipts/summary", async (_req: Request, res: Response) => {
  const rows = await db.select({ status: reportDeliveryReceiptsTable.status, count: sql<number>`count(*)::int` })
    .from(reportDeliveryReceiptsTable)
    .groupBy(reportDeliveryReceiptsTable.status);
  const summary = { sent: 0, delivered: 0, read: 0, failed: 0, total: 0 };
  for (const r of rows) {
    if (r.status in summary) (summary as Record<string, number>)[r.status] = Number(r.count);
    summary.total += Number(r.count);
  }
  res.json(summary);
});

// ── Manual reminder resend for an unread receipt ──────────────────────────────
reportDeliveryTrackingRouter.post("/remind/:id", async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [receipt] = await db.select().from(reportDeliveryReceiptsTable).where(eq(reportDeliveryReceiptsTable.id, id.data)).limit(1);
  if (!receipt) { res.status(404).json({ error: "Receipt not found" }); return; }
  if (receipt.status === "read") { res.status(400).json({ error: "Already read — no reminder needed" }); return; }

  const reportUrl = receipt.reportId ? ((await buildReportUrl(receipt.reportId)) ?? receipt.viewerUrl ?? "") : (receipt.viewerUrl ?? "");
  const send = await sendReportDelivery({
    phone: receipt.phone,
    patientName: receipt.patientName ?? "",
    reportNumber: receipt.reportNumber ?? "",
    testName: receipt.testName ?? "your report",
    reportUrl,
  });
  if (send.skipped) { res.status(503).json({ error: "WhatsApp disabled" }); return; }
  await markReminded(id.data, send.messageId ?? null);
  await audit(req, { action: "remind", entityType: "report_delivery", entityId: String(id.data), newValue: JSON.stringify({ ok: send.ok }) });
  res.json({ ok: send.ok, error: send.ok ? undefined : send.error });
});

// ── Delivery-mode settings (manual | auto) ────────────────────────────────────
// Surfaced under this feature so the WhatsApp settings route stays untouched.
// 'auto' keeps auto_send_on_verify = true so the existing on-verify auto-send
// path (routes/patient-reports.ts) fires with no change; 'manual' turns it off
// and staff send selected reports bill/test-wise from the tracking screen.
reportDeliveryTrackingRouter.get("/settings", async (_req: Request, res: Response) => {
  const [s] = await db.select().from(whatsappSettingsTable).limit(1);
  res.json({
    mode: s?.reportDeliveryMode ?? "manual",
    autoSendOnVerify: s?.autoSendOnVerify ?? false,
    whatsappEnabled: s?.enabled ?? false,
  });
});

reportDeliveryTrackingRouter.put("/settings", async (req: Request, res: Response) => {
  const p = z.object({ mode: z.enum(["manual", "auto"]) }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const auto = p.data.mode === "auto";
  const [existing] = await db.select({ id: whatsappSettingsTable.id }).from(whatsappSettingsTable).limit(1);
  if (existing) {
    await db.update(whatsappSettingsTable).set({ reportDeliveryMode: p.data.mode, autoSendOnVerify: auto }).where(eq(whatsappSettingsTable.id, existing.id));
  } else {
    await db.insert(whatsappSettingsTable).values({ reportDeliveryMode: p.data.mode, autoSendOnVerify: auto });
  }
  await audit(req, { action: "edit", entityType: "delivery_mode", entityId: "whatsapp_settings", newValue: p.data.mode });
  res.json({ mode: p.data.mode, autoSendOnVerify: auto });
});

// ── Deliverable reports for MANUAL bill/test-wise selection ────────────────────
// Verified/delivered reports the staff can pick to send, with bill + test +
// patient context and the latest send status so the UI can group by bill and
// show what's already gone out.
reportDeliveryTrackingRouter.get("/deliverable", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const billId = z.coerce.number().int().positive().optional().safeParse(req.query.billId);
  const patientId = z.coerce.number().int().positive().optional().safeParse(req.query.patientId);
  const onlyUnsent = req.query.onlyUnsent === "true" || req.query.onlyUnsent === "1";

  const conds = [inArray(patientReportsTable.status, ["verified", "delivered"])];
  if (billId.success && billId.data) conds.push(eq(patientReportsTable.billId, billId.data));
  if (patientId.success && patientId.data) conds.push(eq(patientReportsTable.patientId, patientId.data));
  if (from) conds.push(gte(patientReportsTable.createdAt, new Date(from)));
  if (to) conds.push(lte(patientReportsTable.createdAt, new Date(to)));

  const lastStatus = sql<string | null>`(SELECT r.status FROM report_delivery_receipts r WHERE r.report_id = ${patientReportsTable.id} ORDER BY r.sent_at DESC LIMIT 1)`;
  let rows = await db.select({
    reportId: patientReportsTable.id,
    reportNumber: patientReportsTable.reportNumber,
    testName: patientReportsTable.title,
    reportStatus: patientReportsTable.status,
    type: patientReportsTable.type,
    billId: patientReportsTable.billId,
    billNumber: billsTable.billNumber,
    patientId: patientReportsTable.patientId,
    patientFirstName: patientsTable.firstName,
    patientLastName: patientsTable.lastName,
    phone: patientsTable.phone,
    createdAt: patientReportsTable.createdAt,
    lastSendStatus: lastStatus,
  })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientsTable.id, patientReportsTable.patientId))
    .leftJoin(billsTable, eq(billsTable.id, patientReportsTable.billId))
    .where(and(...conds))
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(500);

  if (onlyUnsent) rows = rows.filter((r) => !r.lastSendStatus || r.lastSendStatus === "failed");
  res.json(rows);
});

/**
 * Daily reminder pass for STAFF-SENT reports that remain unread. Only touches
 * receipts staff explicitly created (never a bulk scan of all reports), older
 * than 24h, capped at one reminder. Driven by cron.ts. Gated by the feature
 * flag + the master WhatsApp switch (via sendReportDelivery). Never throws.
 */
export async function runReportDeliveryReminders(): Promise<{ skipped?: boolean; reason?: string; sent: number; failed: number; total: number }> {
  if (!(await isFeatureEnabledServer("ff_report_delivery_receipts"))) {
    return { skipped: true, reason: "ff_report_delivery_receipts disabled", sent: 0, failed: 0, total: 0 };
  }
  const due = await findRemindableReceipts({ olderThanHours: 24, maxReminders: 1, limit: 200 });
  let sent = 0, failed = 0;
  for (const receipt of due) {
    const reportUrl = receipt.reportId ? ((await buildReportUrl(receipt.reportId)) ?? receipt.viewerUrl ?? "") : (receipt.viewerUrl ?? "");
    const send = await sendReportDelivery({
      phone: receipt.phone,
      patientName: receipt.patientName ?? "",
      reportNumber: receipt.reportNumber ?? "",
      testName: receipt.testName ?? "your report",
      reportUrl,
    });
    if (send.skipped) return { skipped: true, reason: "WhatsApp disabled", sent, failed, total: due.length };
    if (send.ok) sent++; else failed++;
    await markReminded(receipt.id, send.messageId ?? null);
  }
  return { sent, failed, total: due.length };
}

export default reportDeliveryTrackingRouter;
