// Recognition, allowances & notifications API — advisory, shadow-mode.
//
// Mounted at /api/recognition behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users"). Awards + allowances are advisory (management-approved);
// nothing grants money or changes payroll. Notifications are in-app only.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  notificationsTable, awardTypesTable, awardWinnersTable, allowanceEligibilityTable,
} from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { notify } from "../lib/notifications";
import { evaluateAllowance, DEFAULT_TRAVEL_RULE, DEFAULT_FOOD_RULE, type StaffMetrics, type AllowanceRule } from "../lib/performance/eligibilityEngine";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const recognitionRouter = Router();

function actorOf(req: Request) {
  const s = (req as StaffAuthRequest).staffSession;
  return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" };
}
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, extra: AuditExtra) => auditFromRequest(req, { ...actorOf(req), module: "recognition", ...extra });
const idParam = z.coerce.number().int().positive();
const flagGuard = (key: string) => async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer(key)) { next(); return; }
  res.status(503).json({ error: `Disabled (${key} is off)` });
};

// ── Notifications (in-app inbox) ────────────────────────────────────────────
recognitionRouter.get("/notifications", async (req, res) => {
  const userId = z.coerce.number().int().positive().optional().safeParse(req.query.userId);
  const staffId = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const unreadOnly = req.query.unread === "true";
  const conds = [];
  if (userId.success && userId.data) conds.push(eq(notificationsTable.userId, userId.data));
  if (staffId.success && staffId.data) conds.push(eq(notificationsTable.staffId, staffId.data));
  if (unreadOnly) conds.push(eq(notificationsTable.isRead, false));
  if (conds.length === 0) { res.status(400).json({ error: "userId or staffId required" }); return; }
  res.json(await db.select().from(notificationsTable).where(and(...conds)).orderBy(desc(notificationsTable.createdAt)).limit(100));
});
recognitionRouter.get("/notifications/unread-count", async (req, res) => {
  const userId = z.coerce.number().int().positive().optional().safeParse(req.query.userId);
  const staffId = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const conds = [eq(notificationsTable.isRead, false)];
  if (userId.success && userId.data) conds.push(eq(notificationsTable.userId, userId.data));
  else if (staffId.success && staffId.data) conds.push(eq(notificationsTable.staffId, staffId.data));
  else { res.status(400).json({ error: "userId or staffId required" }); return; }
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(notificationsTable).where(and(...conds));
  res.json({ count: row?.count ?? 0 });
});
recognitionRouter.post("/notifications/:id/read", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(notificationsTable).set({ isRead: true, readAt: new Date() }).where(eq(notificationsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── Awards (ff_hr_staff_awards) ─────────────────────────────────────────────
recognitionRouter.get("/awards/types", async (_req, res) => {
  res.json(await db.select().from(awardTypesTable).orderBy(awardTypesTable.name));
});
recognitionRouter.post("/awards/types", flagGuard("ff_hr_staff_awards"), async (req, res) => {
  const p = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), cadence: z.enum(["weekly", "monthly", "yearly", "custom"]).optional(), description: z.string().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(awardTypesTable).values({ code: p.data.code, name: p.data.name, cadence: p.data.cadence ?? "custom", description: p.data.description ?? null }).returning();
    await audit(req, { action: "create", entityType: "award_type", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "An award with that code exists" : msg });
  }
});
recognitionRouter.get("/awards/winners", async (req, res) => {
  const t = z.coerce.number().int().positive().optional().safeParse(req.query.awardTypeId);
  const rows = t.success && t.data
    ? await db.select().from(awardWinnersTable).where(eq(awardWinnersTable.awardTypeId, t.data)).orderBy(desc(awardWinnersTable.createdAt))
    : await db.select().from(awardWinnersTable).orderBy(desc(awardWinnersTable.createdAt)).limit(200);
  res.json(rows);
});
recognitionRouter.post("/awards/winners", flagGuard("ff_hr_staff_awards"), async (req, res) => {
  const p = z.object({ awardTypeId: z.number().int().positive(), staffId: z.number().int().positive(), periodLabel: z.string().trim().min(1), citation: z.string().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(awardWinnersTable).values({ awardTypeId: p.data.awardTypeId, staffId: p.data.staffId, periodLabel: p.data.periodLabel, citation: p.data.citation ?? null, approvedByUserId: a.userId, approvedByName: a.userName }).returning();
  await audit(req, { action: "approve", entityType: "award_winner", entityId: String(row.id), newValue: JSON.stringify(row) });
  await notify({ staffId: p.data.staffId, type: "award", title: "You received an award 🎉", body: p.data.citation ?? undefined, refType: "award_winner", refId: String(row.id) });
  res.status(201).json(row);
});

// ── Allowances (ff_hr_performance_allowances) ───────────────────────────────
function ruleFor(kind: "travel" | "food"): AllowanceRule {
  return kind === "travel" ? DEFAULT_TRAVEL_RULE : DEFAULT_FOOD_RULE;
}
// Live evaluation (no persist) — feed it the staff's metrics.
recognitionRouter.post("/allowances/evaluate", flagGuard("ff_hr_performance_allowances"), async (req, res) => {
  const p = z.object({ kind: z.enum(["travel", "food"]), metrics: z.record(z.string(), z.unknown()) }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  res.json(evaluateAllowance(p.data.metrics as StaffMetrics, ruleFor(p.data.kind)));
});
recognitionRouter.get("/allowances/eligibility", async (req, res) => {
  const s = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const rows = s.success && s.data
    ? await db.select().from(allowanceEligibilityTable).where(eq(allowanceEligibilityTable.staffId, s.data)).orderBy(desc(allowanceEligibilityTable.createdAt))
    : await db.select().from(allowanceEligibilityTable).orderBy(desc(allowanceEligibilityTable.createdAt)).limit(200);
  res.json(rows);
});
// Persist a computed eligibility (the engine decides the status server-side).
recognitionRouter.post("/allowances/eligibility", flagGuard("ff_hr_performance_allowances"), async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), kind: z.enum(["travel", "food"]), periodLabel: z.string().trim().min(1), metrics: z.record(z.string(), z.unknown()) }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const result = evaluateAllowance(p.data.metrics as StaffMetrics, ruleFor(p.data.kind));
  const [row] = await db.insert(allowanceEligibilityTable).values({
    staffId: p.data.staffId, allowanceKind: p.data.kind, periodLabel: p.data.periodLabel,
    status: result.status, reasons: result.reasons, metricsSnapshot: p.data.metrics,
  }).returning();
  await audit(req, { action: "create", entityType: "allowance_eligibility", entityId: String(row.id), newValue: JSON.stringify({ kind: p.data.kind, status: result.status }) });
  res.status(201).json({ row, result });
});
// Management decision (approve/reject) — advisory, no payroll effect.
recognitionRouter.post("/allowances/eligibility/:id/decide", flagGuard("ff_hr_performance_allowances"), async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ status: z.enum(["approved", "rejected", "on_hold"]) }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const [row] = await db.update(allowanceEligibilityTable).set({ status: p.data.status, approvedByUserId: a.userId, approvedByName: a.userName, decidedAt: new Date() }).where(eq(allowanceEligibilityTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "approve", entityType: "allowance_eligibility", entityId: String(id.data), newValue: JSON.stringify({ status: p.data.status }) });
  await notify({ staffId: row.staffId, type: "allowance", title: `Allowance ${p.data.status}`, body: `${row.allowanceKind} allowance for ${row.periodLabel}`, refType: "allowance_eligibility", refId: String(row.id) });
  res.json(row);
});

export default recognitionRouter;
