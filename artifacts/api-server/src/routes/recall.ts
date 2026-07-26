// Recall / follow-up engine API — additive, non-financial, feature-flagged
// (ff_recall_engine, Shadow Mode). Mounted at /api/recall behind
// requireStaffAuth + requireStaffPermission("/reports"). Rules map reports to a
// follow-up interval; a daily job queues a recall due intervalDays after a
// report is delivered, then WhatsApps the patient. Audited + zod.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { recallRulesTable, recallQueueTable, patientReportsTable, patientsTable } from "@workspace/db/schema";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { computeDueDate, matchRule, istDateOnly, composeRecallMessage } from "../lib/recallEngine";
import { sendPlainWhatsappText } from "./whatsapp";
import { logger } from "../lib/logger";

export const recallRouter = Router();
recallRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_recall_engine")) { next(); return; }
  res.status(503).json({ error: "Recall engine is disabled. Enable ff_recall_engine." });
});

function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
const audit = (req: Request, e: { action: string; entityType?: string; entityId?: string; newValue?: string; reason?: string }) =>
  auditFromRequest(req, { ...actorOf(req), module: "recall", ...e });
const idParam = z.coerce.number().int().positive();

// ── Rules ─────────────────────────────────────────────────────────────────────
const ruleBody = z.object({
  label: z.string().trim().min(1),
  matchType: z.enum(["all", "test"]),
  matchValue: z.string().trim().optional().nullable(),
  intervalDays: z.number().int().min(1).max(3650),
  messageTemplate: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

recallRouter.get("/rules", async (_req, res) => res.json(await db.select().from(recallRulesTable).orderBy(desc(recallRulesTable.createdAt))));

recallRouter.post("/rules", async (req, res) => {
  const p = ruleBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(recallRulesTable).values({
    label: p.data.label, matchType: p.data.matchType, matchValue: p.data.matchValue ?? null,
    intervalDays: p.data.intervalDays, messageTemplate: p.data.messageTemplate ?? "", enabled: p.data.enabled ?? true,
    createdBy: a.userName,
  }).returning();
  await audit(req, { action: "create", entityType: "recall_rule", entityId: String(row.id), newValue: JSON.stringify(row) });
  res.status(201).json(row);
});

recallRouter.patch("/rules/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); const p = ruleBody.partial().safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields" }); return; }
  // messageTemplate is a NOT NULL column — coerce a cleared value to "" and keep
  // it out of the update entirely when the caller didn't send it.
  const { messageTemplate: mt, ...rest } = p.data;
  const set = { ...rest, ...(mt === undefined ? {} : { messageTemplate: mt ?? "" }) };
  const [row] = await db.update(recallRulesTable).set(set).where(eq(recallRulesTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "recall_rule", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});

recallRouter.delete("/rules/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(recallRulesTable).where(eq(recallRulesTable.id, id.data));
  await audit(req, { action: "delete", entityType: "recall_rule", entityId: String(id.data) });
  res.json({ success: true });
});

// ── Queue ─────────────────────────────────────────────────────────────────────
recallRouter.get("/queue", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [];
  if (status && ["pending", "sent", "snoozed", "opted_out", "cancelled"].includes(status)) conds.push(eq(recallQueueTable.status, status));
  const rows = await db.select().from(recallQueueTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(recallQueueTable.dueDate)
    .limit(500);
  res.json(rows);
});

recallRouter.get("/queue/summary", async (_req, res) => {
  const rows = await db.select({ status: recallQueueTable.status, count: sql<number>`count(*)::int` }).from(recallQueueTable).groupBy(recallQueueTable.status);
  const summary: Record<string, number> = { pending: 0, sent: 0, snoozed: 0, opted_out: 0, cancelled: 0, total: 0 };
  for (const r of rows) { summary[r.status] = Number(r.count); summary.total += Number(r.count); }
  res.json(summary);
});

// Act on a queue entry: snooze (push due date), cancel, or opt the patient out.
recallRouter.patch("/queue/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ action: z.enum(["snooze", "cancel", "opt_out"]), dueDate: z.string().optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const set: Record<string, unknown> = {};
  if (p.data.action === "snooze") { set.status = "snoozed"; if (p.data.dueDate) set.dueDate = p.data.dueDate; }
  else if (p.data.action === "cancel") set.status = "cancelled";
  else if (p.data.action === "opt_out") set.status = "opted_out";
  const [row] = await db.update(recallQueueTable).set(set).where(eq(recallQueueTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: p.data.action, entityType: "recall_queue", entityId: String(id.data) });
  res.json(row);
});

// Manual "run now" — generate due recalls then send them.
recallRouter.post("/run", async (req, res) => {
  const gen = await runRecallGeneration();
  const sent = await runRecallSends();
  await audit(req, { action: "run", entityType: "recall", newValue: JSON.stringify({ gen, sent }) });
  res.json({ generated: gen, sent });
});

// ── Workers (also driven by cron.ts) ──────────────────────────────────────────

/** Scan recently-delivered reports and queue a recall per matching enabled rule
 *  (idempotent via the unique index). Returns how many new rows were queued. */
export async function runRecallGeneration(): Promise<{ queued: number; scanned: number; skipped?: string }> {
  if (!(await isFeatureEnabledServer("ff_recall_engine"))) return { queued: 0, scanned: 0, skipped: "disabled" };
  const rules = await db.select().from(recallRulesTable).where(eq(recallRulesTable.enabled, true));
  if (rules.length === 0) return { queued: 0, scanned: 0, skipped: "no rules" };

  const lookbackDays = Math.min(3650, Math.max(...rules.map((r) => r.intervalDays)) + 30);
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const reports = await db.select({
    reportId: patientReportsTable.id,
    patientId: patientReportsTable.patientId,
    testName: patientReportsTable.title,
    deliveredAt: patientReportsTable.deliveredAt,
    firstName: patientsTable.firstName,
    lastName: patientsTable.lastName,
    phone: patientsTable.phone,
  })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientsTable.id, patientReportsTable.patientId))
    .where(and(isNotNull(patientReportsTable.deliveredAt), gte(patientReportsTable.deliveredAt, cutoff)))
    .limit(5000);

  let queued = 0;
  for (const rep of reports) {
    if (!rep.deliveredAt) continue;
    for (const rule of rules) {
      if (!matchRule({ testName: rep.testName }, rule)) continue;
      const name = `${rep.firstName ?? ""} ${rep.lastName ?? ""}`.trim();
      const dueDate = computeDueDate(rep.deliveredAt, rule.intervalDays);
      const message = composeRecallMessage(rule.messageTemplate, { name, testName: rep.testName ?? "", days: rule.intervalDays });
      try {
        const inserted = await db.insert(recallQueueTable).values({
          patientId: rep.patientId, reportId: rep.reportId, ruleId: rule.id,
          testName: rep.testName, phone: rep.phone ?? null, patientName: name,
          dueDate, channel: rule.channel, messageSnapshot: message,
        }).onConflictDoNothing().returning({ id: recallQueueTable.id });
        if (inserted.length > 0) queued++;
      } catch (err) { logger.warn({ err }, "[recall] queue insert failed (non-fatal)"); }
    }
  }
  return { queued, scanned: reports.length };
}

/** Send every pending recall due on/before today via WhatsApp. */
export async function runRecallSends(): Promise<{ skipped?: boolean; reason?: string; sent: number; failed: number; total: number }> {
  if (!(await isFeatureEnabledServer("ff_recall_engine"))) return { skipped: true, reason: "disabled", sent: 0, failed: 0, total: 0 };
  const today = istDateOnly(new Date());
  const due = await db.select().from(recallQueueTable)
    .where(and(eq(recallQueueTable.status, "pending"), lte(recallQueueTable.dueDate, today)))
    .limit(500);

  let sent = 0, failed = 0;
  for (const entry of due) {
    if (!entry.phone) {
      await db.update(recallQueueTable).set({ status: "cancelled", lastError: "no phone" }).where(eq(recallQueueTable.id, entry.id));
      failed++; continue;
    }
    const r = await sendPlainWhatsappText(entry.phone, entry.messageSnapshot ?? "", "recall_followup");
    if (r.skipped) return { skipped: true, reason: "WhatsApp disabled", sent, failed, total: due.length };
    if (r.ok) {
      await db.update(recallQueueTable).set({ status: "sent", sentAt: new Date(), providerMessageId: r.messageId ?? null }).where(eq(recallQueueTable.id, entry.id));
      sent++;
    } else {
      await db.update(recallQueueTable).set({ lastError: r.error ?? "send failed", remindersCount: sql`${recallQueueTable.remindersCount} + 1` }).where(eq(recallQueueTable.id, entry.id));
      failed++;
    }
  }
  return { sent, failed, total: due.length };
}

export default recallRouter;
