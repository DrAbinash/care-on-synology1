// Appraisal, increment recommendations & PIP API — advisory, shadow-mode.
//
// Mounted at /api/appraisal behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") and ff_hr_annual_appraisals. Increment output is a
// RECOMMENDATION only — nothing alters payroll/salary. PIPs are confidential.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  appraisalCyclesTable, employeeAppraisalsTable, performanceImprovementPlansTable, performanceScoresTable,
} from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { notify } from "../lib/notifications";
import { recommendIncrement } from "../lib/performance/incrementEngine";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const appraisalRouter = Router();

appraisalRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_annual_appraisals")) { next(); return; }
  res.status(503).json({ error: "Annual appraisals are disabled. Enable ff_hr_annual_appraisals." });
});

function actorOf(req: Request) {
  const s = (req as StaffAuthRequest).staffSession;
  return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" };
}
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, extra: AuditExtra) => auditFromRequest(req, { ...actorOf(req), module: "appraisal", ...extra });
const idParam = z.coerce.number().int().positive();

// ── Cycles ──────────────────────────────────────────────────────────────────
appraisalRouter.get("/cycles", async (_req, res) => {
  res.json(await db.select().from(appraisalCyclesTable).orderBy(desc(appraisalCyclesTable.yearStart)));
});
appraisalRouter.post("/cycles", async (req, res) => {
  const p = z.object({ label: z.string().trim().min(1), yearStart: z.string(), yearEnd: z.string() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(appraisalCyclesTable).values({ label: p.data.label, yearStart: p.data.yearStart, yearEnd: p.data.yearEnd, createdByUserId: actorOf(req).userId }).returning();
    await audit(req, { action: "create", entityType: "appraisal_cycle", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "A cycle with that label exists" : msg });
  }
});

// ── Employee appraisals (with advisory increment recommendation) ────────────
appraisalRouter.get("/cycles/:cycleId/appraisals", async (req, res) => {
  const c = idParam.safeParse(req.params.cycleId);
  if (!c.success) { res.status(400).json({ error: "Invalid cycle id" }); return; }
  res.json(await db.select().from(employeeAppraisalsTable).where(eq(employeeAppraisalsTable.cycleId, c.data)).orderBy(desc(employeeAppraisalsTable.annualScoreAvg)));
});
appraisalRouter.get("/staff/:staffId/appraisals", async (req, res) => {
  const s = idParam.safeParse(req.params.staffId);
  if (!s.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select().from(employeeAppraisalsTable).where(eq(employeeAppraisalsTable.staffId, s.data)).orderBy(desc(employeeAppraisalsTable.createdAt)));
});
appraisalRouter.post("/appraisals", async (req, res) => {
  const p = z.object({
    cycleId: z.number().int().positive(), staffId: z.number().int().positive(),
    annualScoreAvg: z.number().optional(), strengths: z.string().optional().nullable(),
    improvementAreas: z.string().optional().nullable(), managerComments: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);

  // Compute the annual average from finalized performance_scores unless supplied.
  let avg = p.data.annualScoreAvg;
  if (avg === undefined) {
    const [row] = await db.select({ avg: sql<number>`avg(${performanceScoresTable.total})::float` }).from(performanceScoresTable).where(eq(performanceScoresTable.staffId, p.data.staffId));
    avg = row?.avg ?? undefined;
  }
  const rec = typeof avg === "number" ? recommendIncrement(avg) : null;

  try {
    const [row] = await db.insert(employeeAppraisalsTable).values({
      cycleId: p.data.cycleId, staffId: p.data.staffId,
      annualScoreAvg: typeof avg === "number" ? String(avg) : null,
      recommendationBand: rec?.band ?? null, recommendation: rec?.recommendation ?? null,
      strengths: p.data.strengths ?? null, improvementAreas: p.data.improvementAreas ?? null,
      managerComments: p.data.managerComments ?? null, createdByUserId: a.userId,
    }).returning();
    await audit(req, { action: "create", entityType: "employee_appraisal", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, annualScoreAvg: avg, recommendation: rec?.recommendation }) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "This staff already has an appraisal in this cycle" : msg });
  }
});
appraisalRouter.post("/appraisals/:id/decide", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ managementDecision: z.enum(["approved", "deferred", "rejected"]), employeeComments: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const [row] = await db.update(employeeAppraisalsTable).set({ managementDecision: p.data.managementDecision, employeeComments: p.data.employeeComments ?? undefined, decidedByUserId: a.userId, decidedAt: new Date() }).where(eq(employeeAppraisalsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "approve", entityType: "employee_appraisal", entityId: String(id.data), newValue: JSON.stringify({ managementDecision: p.data.managementDecision }) });
  await notify({ staffId: row.staffId, type: "appraisal", title: `Appraisal ${p.data.managementDecision}`, refType: "employee_appraisal", refId: String(row.id) });
  res.json(row);
});

// ── Performance Improvement Plans (confidential) ────────────────────────────
appraisalRouter.get("/pips", async (req, res) => {
  const s = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const rows = s.success && s.data
    ? await db.select().from(performanceImprovementPlansTable).where(eq(performanceImprovementPlansTable.staffId, s.data)).orderBy(desc(performanceImprovementPlansTable.createdAt))
    : await db.select().from(performanceImprovementPlansTable).orderBy(desc(performanceImprovementPlansTable.createdAt)).limit(200);
  res.json(rows);
});
appraisalRouter.post("/pips", async (req, res) => {
  const p = z.object({
    staffId: z.number().int().positive(), reason: z.string().trim().min(1), requiredActions: z.string().optional().nullable(),
    trainingAssigned: z.string().optional().nullable(), supervisorStaffId: z.number().int().positive().optional().nullable(),
    startDate: z.string().optional().nullable(), targetCategories: z.array(z.string()).optional(),
  }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(performanceImprovementPlansTable).values({
    staffId: p.data.staffId, reason: p.data.reason, requiredActions: p.data.requiredActions ?? null,
    trainingAssigned: p.data.trainingAssigned ?? null, supervisorStaffId: p.data.supervisorStaffId ?? null,
    startDate: p.data.startDate ?? null, targetCategories: p.data.targetCategories ?? null,
    status: "draft", createdByUserId: a.userId,
  }).returning();
  await audit(req, { action: "create", entityType: "performance_improvement_plan", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, reason: row.reason }) });
  res.status(201).json(row);
});
appraisalRouter.patch("/pips/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({
    status: z.enum(["draft", "active", "review_due", "improved", "extended", "failed", "closed"]).optional(),
    requiredActions: z.string().optional().nullable(), trainingAssigned: z.string().optional().nullable(),
    completionDate: z.string().optional().nullable(), outcome: z.string().optional().nullable(),
    employeeComments: z.string().optional().nullable(), managementDecision: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(performanceImprovementPlansTable).set(p.data).where(eq(performanceImprovementPlansTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "performance_improvement_plan", entityId: String(id.data), newValue: JSON.stringify({ status: row.status }) });
  res.json(row);
});

export default appraisalRouter;
