// Performance module API — configurable, advisory, shadow-mode.
//
// Mounted at /api/performance behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") and the ff_hr_performance_scoring flag. The OFFICIAL
// score is computed server-side by the engine (never trusted from the client).
// Advisory only: finalizing a score writes performance_scores and changes NO
// payroll. Segregation of duties: a submitter can never approve their own event.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  performanceCategoriesTable,
  performanceRulesTable,
  performanceCyclesTable,
  performanceEventsTable,
  performanceScoresTable,
  performanceAppealsTable,
} from "@workspace/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { computeCycleScore, finalizeStaffCycleScore } from "../lib/performance/performanceService";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const performanceRouter = Router();

performanceRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_performance_scoring")) { next(); return; }
  res.status(503).json({ error: "Performance scoring is disabled. Enable ff_hr_performance_scoring." });
});

function actorOf(req: Request) {
  const s = (req as StaffAuthRequest).staffSession;
  return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" };
}
const idParam = z.coerce.number().int().positive();
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, extra: AuditExtra) =>
  auditFromRequest(req, { ...actorOf(req), module: "performance", ...extra });

// ── Category policy (configurable 100-point framework) ──────────────────────
performanceRouter.get("/categories", async (_req, res) => {
  res.json(await db.select().from(performanceCategoriesTable).orderBy(performanceCategoriesTable.sortOrder));
});
performanceRouter.post("/categories", async (req, res) => {
  const p = z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), maxMarks: z.number().int().min(0), strategy: z.enum(["deduction", "earned"]).optional(), baseline: z.number().int().optional().nullable(), sortOrder: z.number().int().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(performanceCategoriesTable).values({ key: p.data.key, label: p.data.label, maxMarks: p.data.maxMarks, strategy: p.data.strategy ?? "deduction", baseline: p.data.baseline ?? null, sortOrder: p.data.sortOrder ?? null }).returning();
    await audit(req, { action: "create", entityType: "performance_category", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "A category with that key exists" : msg });
  }
});
performanceRouter.patch("/categories/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ label: z.string().trim().min(1).optional(), maxMarks: z.number().int().min(0).optional(), strategy: z.enum(["deduction", "earned"]).optional(), baseline: z.number().int().optional().nullable(), sortOrder: z.number().int().optional().nullable(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(performanceCategoriesTable).set(p.data).where(eq(performanceCategoriesTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "performance_category", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});

// ── Rules (configurable; no penalty matrix is seeded — management defines it) ─
const ruleBody = z.object({
  code: z.string().trim().min(1), name: z.string().trim().min(1), categoryKey: z.string().trim().min(1), points: z.number().int(),
  evidenceRequired: z.boolean().optional(), responseRequired: z.boolean().optional(), approvalLevel: z.string().optional().nullable(),
  disqualifying: z.boolean().optional(), majorMisconduct: z.boolean().optional(), awardDisqualification: z.boolean().optional(),
  allowanceDisqualification: z.boolean().optional(), frequencyCap: z.number().int().optional().nullable(), isActive: z.boolean().optional(),
});
performanceRouter.get("/rules", async (_req, res) => {
  res.json(await db.select().from(performanceRulesTable).orderBy(performanceRulesTable.code));
});
performanceRouter.post("/rules", async (req, res) => {
  const p = ruleBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(performanceRulesTable).values({
      code: p.data.code, name: p.data.name, categoryKey: p.data.categoryKey, points: p.data.points,
      evidenceRequired: p.data.evidenceRequired ?? false, responseRequired: p.data.responseRequired ?? false, approvalLevel: p.data.approvalLevel ?? null,
      disqualifying: p.data.disqualifying ?? false, majorMisconduct: p.data.majorMisconduct ?? false,
      awardDisqualification: p.data.awardDisqualification ?? false, allowanceDisqualification: p.data.allowanceDisqualification ?? false,
      frequencyCap: p.data.frequencyCap ?? null,
    }).returning();
    await audit(req, { action: "create", entityType: "performance_rule", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "A rule with that code exists" : msg });
  }
});
performanceRouter.patch("/rules/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = ruleBody.partial().safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(performanceRulesTable).set(p.data).where(eq(performanceRulesTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "performance_rule", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});

// ── Cycles ──────────────────────────────────────────────────────────────────
performanceRouter.get("/cycles", async (_req, res) => {
  res.json(await db.select().from(performanceCyclesTable).orderBy(desc(performanceCyclesTable.periodStart)));
});
performanceRouter.post("/cycles", async (req, res) => {
  const p = z.object({ label: z.string().trim().min(1), periodStart: z.string(), periodEnd: z.string() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(performanceCyclesTable).values({ label: p.data.label, periodStart: p.data.periodStart, periodEnd: p.data.periodEnd, createdByUserId: actorOf(req).userId }).returning();
    await audit(req, { action: "create", entityType: "performance_cycle", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "A cycle with that label exists" : msg });
  }
});

// ── Events (workflow) ───────────────────────────────────────────────────────
performanceRouter.get("/cycles/:cycleId/staff/:staffId/events", async (req, res) => {
  const c = idParam.safeParse(req.params.cycleId), s = idParam.safeParse(req.params.staffId);
  if (!c.success || !s.success) { res.status(400).json({ error: "Invalid ids" }); return; }
  res.json(await db.select().from(performanceEventsTable).where(and(eq(performanceEventsTable.cycleId, c.data), eq(performanceEventsTable.staffId, s.data))).orderBy(desc(performanceEventsTable.eventDate)));
});
performanceRouter.post("/events", async (req, res) => {
  const p = z.object({
    cycleId: z.number().int().positive(), staffId: z.number().int().positive(), ruleId: z.number().int().positive().optional(),
    categoryKey: z.string().optional(), points: z.number().int().optional(), disqualifying: z.boolean().optional(),
    eventDate: z.string().optional(), description: z.string().optional().nullable(), notes: z.string().optional().nullable(), evidenceStorageKey: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  let categoryKey = p.data.categoryKey, points = p.data.points, disqualifying = p.data.disqualifying ?? false;
  if (p.data.ruleId) {
    const [rule] = await db.select().from(performanceRulesTable).where(eq(performanceRulesTable.id, p.data.ruleId));
    if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
    categoryKey = rule.categoryKey; points = rule.points; disqualifying = rule.disqualifying;
  }
  if (!categoryKey || typeof points !== "number") { res.status(400).json({ error: "categoryKey and points required (or a ruleId)" }); return; }
  const [row] = await db.insert(performanceEventsTable).values({
    cycleId: p.data.cycleId, staffId: p.data.staffId, ruleId: p.data.ruleId ?? null, categoryKey, points, disqualifying,
    eventDate: p.data.eventDate ?? new Date().toISOString().slice(0, 10), description: p.data.description ?? null, notes: p.data.notes ?? null,
    evidenceStorageKey: p.data.evidenceStorageKey ?? null, status: "submitted", submittedByUserId: a.userId, submittedByName: a.userName,
  }).returning();
  await audit(req, { action: "create", entityType: "performance_event", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, categoryKey, points, disqualifying }) });
  res.status(201).json(row);
});
performanceRouter.post("/events/:id/review", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ decision: z.enum(["approve", "reject", "return"]), note: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const [event] = await db.select().from(performanceEventsTable).where(eq(performanceEventsTable.id, id.data));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  // Segregation of duties: cannot approve your own submission.
  if (p.data.decision === "approve" && event.submittedByUserId && event.submittedByUserId === a.userId) {
    res.status(403).json({ error: "You cannot approve an event you submitted" }); return;
  }
  const status = p.data.decision === "approve" ? "approved" : p.data.decision === "reject" ? "rejected" : "returned";
  const [row] = await db.update(performanceEventsTable).set({ status, verifiedByUserId: a.userId, verifiedAt: new Date(), finalDecision: p.data.note ?? null }).where(eq(performanceEventsTable.id, id.data)).returning();
  await audit(req, { action: p.data.decision === "approve" ? "approve" : "edit", entityType: "performance_event", entityId: String(id.data), oldValue: JSON.stringify({ status: event.status }), newValue: JSON.stringify({ status }), reason: p.data.note ?? undefined });
  res.json(row);
});
performanceRouter.post("/events/:id/respond", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ response: z.string().trim().min(1) }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [row] = await db.update(performanceEventsTable).set({ employeeResponse: p.data.response, status: "employee_responded" }).where(eq(performanceEventsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  await audit(req, { action: "edit", entityType: "performance_event", entityId: String(id.data), newValue: JSON.stringify({ employeeResponse: p.data.response }) });
  res.json(row);
});

// ── Scores (live compute + finalize) ────────────────────────────────────────
performanceRouter.get("/cycles/:cycleId/staff/:staffId/score", async (req, res) => {
  const c = idParam.safeParse(req.params.cycleId), s = idParam.safeParse(req.params.staffId);
  if (!c.success || !s.success) { res.status(400).json({ error: "Invalid ids" }); return; }
  res.json(await computeCycleScore(c.data, s.data));
});
performanceRouter.post("/cycles/:cycleId/staff/:staffId/finalize", async (req, res) => {
  const c = idParam.safeParse(req.params.cycleId), s = idParam.safeParse(req.params.staffId);
  if (!c.success || !s.success) { res.status(400).json({ error: "Invalid ids" }); return; }
  const a = actorOf(req);
  const { result, scoreId } = await finalizeStaffCycleScore(c.data, s.data, a.userId);
  await audit(req, { action: "finalize", entityType: "performance_score", entityId: String(scoreId), newValue: JSON.stringify({ total: result.total, disqualified: result.disqualified }) });
  res.json({ scoreId, score: result });
});
performanceRouter.get("/staff/:staffId/scores", async (req, res) => {
  const s = idParam.safeParse(req.params.staffId);
  if (!s.success) { res.status(400).json({ error: "Invalid id" }); return; }
  res.json(await db.select().from(performanceScoresTable).where(eq(performanceScoresTable.staffId, s.data)).orderBy(desc(performanceScoresTable.finalizedAt)));
});

// ── Appeals ─────────────────────────────────────────────────────────────────
performanceRouter.get("/appeals", async (req, res) => {
  const s = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const rows = s.success && s.data
    ? await db.select().from(performanceAppealsTable).where(eq(performanceAppealsTable.staffId, s.data)).orderBy(desc(performanceAppealsTable.createdAt))
    : await db.select().from(performanceAppealsTable).orderBy(desc(performanceAppealsTable.createdAt));
  res.json(rows);
});
performanceRouter.post("/appeals", async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), eventId: z.number().int().positive().optional(), cycleId: z.number().int().positive().optional(), reason: z.string().trim().min(1) }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const [row] = await db.insert(performanceAppealsTable).values({ staffId: p.data.staffId, eventId: p.data.eventId ?? null, cycleId: p.data.cycleId ?? null, reason: p.data.reason }).returning();
  if (p.data.eventId) await db.update(performanceEventsTable).set({ appealStatus: "submitted" }).where(eq(performanceEventsTable.id, p.data.eventId));
  await audit(req, { action: "create", entityType: "performance_appeal", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, eventId: row.eventId }) });
  res.status(201).json(row);
});
performanceRouter.post("/appeals/:id/decide", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ status: z.enum(["upheld", "rejected", "under_review", "withdrawn"]), decision: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const [row] = await db.update(performanceAppealsTable).set({ status: p.data.status, decision: p.data.decision ?? null, decidedByUserId: a.userId, decidedAt: new Date() }).where(eq(performanceAppealsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Appeal not found" }); return; }
  await audit(req, { action: "approve", entityType: "performance_appeal", entityId: String(id.data), newValue: JSON.stringify({ status: p.data.status }), reason: p.data.decision ?? undefined });
  res.json(row);
});

export default performanceRouter;
