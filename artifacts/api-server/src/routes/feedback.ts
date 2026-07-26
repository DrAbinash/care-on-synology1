// Staff-facing patient feedback / NPS dashboard + invite generation. Mounted at
// /api/feedback behind requireStaffAuth + requireStaffPermission("/reports") and
// ff_feedback_nps (Shadow Mode). The invite worker mints tokenized links for
// recently-delivered reports and WhatsApps them. Additive, non-financial.
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { feedbackRequestsTable, feedbackResponsesTable, patientReportsTable, patientsTable } from "@workspace/db/schema";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { npsBreakdown } from "../lib/npsEngine";
import { sendPlainWhatsappText } from "./whatsapp";
import { logger } from "../lib/logger";

const FEEDBACK_DELAY_DAYS = 1;   // send the invite this long after delivery
const FEEDBACK_EXPIRY_DAYS = 30; // link validity

export const feedbackRouter = Router();
feedbackRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_feedback_nps")) { next(); return; }
  res.status(503).json({ error: "Feedback / NPS is disabled. Enable ff_feedback_nps." });
});

function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }

feedbackRouter.get("/summary", async (_req, res) => {
  const rows = await db.select({ npsScore: feedbackResponsesTable.npsScore }).from(feedbackResponsesTable);
  res.json(npsBreakdown(rows.map((r) => r.npsScore)));
});

feedbackRouter.get("/responses", async (_req, res) => {
  const rows = await db.select({
    id: feedbackResponsesTable.id,
    npsScore: feedbackResponsesTable.npsScore,
    stars: feedbackResponsesTable.stars,
    comment: feedbackResponsesTable.comment,
    category: feedbackResponsesTable.category,
    submittedAt: feedbackResponsesTable.submittedAt,
    reportId: feedbackResponsesTable.reportId,
    patientName: feedbackRequestsTable.patientName,
    testName: feedbackRequestsTable.testName,
  })
    .from(feedbackResponsesTable)
    .leftJoin(feedbackRequestsTable, eq(feedbackRequestsTable.id, feedbackResponsesTable.requestId))
    .orderBy(desc(feedbackResponsesTable.submittedAt))
    .limit(500);
  res.json(rows);
});

feedbackRouter.get("/requests", async (_req, res) => {
  const rows = await db.select().from(feedbackRequestsTable).orderBy(desc(feedbackRequestsTable.createdAt)).limit(500);
  res.json(rows);
});

feedbackRouter.post("/run", async (req, res) => {
  const r = await runFeedbackInvites();
  auditFromRequest(req, { ...actorOf(req), module: "feedback", action: "run", newValue: JSON.stringify(r) });
  res.json(r);
});

function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Generate + send feedback invites for reports delivered ~FEEDBACK_DELAY_DAYS
 * ago that don't yet have an invite. Idempotent via the unique report_id on
 * feedback_requests. Never throws.
 */
export async function runFeedbackInvites(): Promise<{ skipped?: boolean; reason?: string; created: number; sent: number; failed: number }> {
  if (!(await isFeatureEnabledServer("ff_feedback_nps"))) return { skipped: true, reason: "disabled", created: 0, sent: 0, failed: 0 };
  const base = publicBaseUrl();
  const now = Date.now();
  const upper = new Date(now - FEEDBACK_DELAY_DAYS * 864e5);        // delivered at least this long ago
  const lower = new Date(now - (FEEDBACK_DELAY_DAYS + 30) * 864e5); // …but within the last month

  // Reports delivered in the window that have no feedback request yet.
  const candidates = await db.select({
    reportId: patientReportsTable.id,
    patientId: patientReportsTable.patientId,
    testName: patientReportsTable.title,
    firstName: patientsTable.firstName,
    lastName: patientsTable.lastName,
    phone: patientsTable.phone,
  })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientsTable.id, patientReportsTable.patientId))
    .leftJoin(feedbackRequestsTable, eq(feedbackRequestsTable.reportId, patientReportsTable.id))
    .where(and(
      gte(patientReportsTable.deliveredAt, lower),
      lte(patientReportsTable.deliveredAt, upper),
      isNull(feedbackRequestsTable.id),
    ))
    .limit(500);

  let created = 0, sent = 0, failed = 0;
  for (const c of candidates) {
    const token = crypto.randomBytes(24).toString("base64url");
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    let requestId: number | null = null;
    try {
      const [row] = await db.insert(feedbackRequestsTable).values({
        token, patientId: c.patientId, reportId: c.reportId, phone: c.phone ?? null,
        patientName: name, testName: c.testName, status: "pending",
        expiresAt: new Date(now + FEEDBACK_EXPIRY_DAYS * 864e5),
      }).onConflictDoNothing().returning({ id: feedbackRequestsTable.id });
      if (!row) continue; // another run already created it
      requestId = row.id;
      created++;
    } catch (err) { logger.warn({ err }, "[feedback] request insert failed"); continue; }

    if (!c.phone || !base) {
      await db.update(feedbackRequestsTable).set({ status: "sent", lastError: !c.phone ? "no phone" : "no base url" }).where(eq(feedbackRequestsTable.id, requestId));
      continue;
    }
    const link = `${base}/api/f/${token}`;
    const body = `Hello ${name || "there"}, thank you for choosing Care Diagnostics.${c.testName ? ` Your ${c.testName} report is ready.` : ""} Please share quick feedback (30 sec): ${link}`;
    const r = await sendPlainWhatsappText(c.phone, body, "feedback_invite");
    if (r.skipped) { return { skipped: true, reason: "WhatsApp disabled", created, sent, failed }; }
    if (r.ok) { await db.update(feedbackRequestsTable).set({ status: "sent", sentAt: new Date(), providerMessageId: r.messageId ?? null }).where(eq(feedbackRequestsTable.id, requestId)); sent++; }
    else { await db.update(feedbackRequestsTable).set({ status: "sent", lastError: r.error ?? "send failed" }).where(eq(feedbackRequestsTable.id, requestId)); failed++; }
  }
  return { created, sent, failed };
}

export default feedbackRouter;
