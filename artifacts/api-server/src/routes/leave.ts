// Leave management API — additive, non-financial, shadow-mode.
// Mounted at /api/leave behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") and ff_hr_leave. Approving a request deducts from the
// leave balance (advisory ledger — NOT payroll). Audited + zod.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { leaveTypesTable, leaveBalancesTable, leaveRequestsTable, staffTimelineEventsTable } from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { notify } from "../lib/notifications";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const leaveRouter = Router();
leaveRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_leave")) { next(); return; }
  res.status(503).json({ error: "Leave management is disabled. Enable ff_hr_leave." });
});
function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, e: AuditExtra) => auditFromRequest(req, { ...actorOf(req), module: "leave", ...e });
const idParam = z.coerce.number().int().positive();

// ── Leave types ─────────────────────────────────────────────────────────────
leaveRouter.get("/types", async (_req, res) => res.json(await db.select().from(leaveTypesTable).orderBy(leaveTypesTable.name)));
leaveRouter.post("/types", async (req, res) => {
  const p = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), paid: z.boolean().optional(), maxDaysPerYear: z.number().optional().nullable(), countsAsAttendance: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(leaveTypesTable).values({ code: p.data.code, name: p.data.name, paid: p.data.paid ?? true, maxDaysPerYear: p.data.maxDaysPerYear != null ? String(p.data.maxDaysPerYear) : null, countsAsAttendance: p.data.countsAsAttendance ?? true }).returning();
    await audit(req, { action: "create", entityType: "leave_type", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) { const m = err instanceof Error ? err.message : "Failed"; res.status(m.includes("unique") ? 409 : 500).json({ error: m.includes("unique") ? "A leave type with that code exists" : m }); }
});
leaveRouter.patch("/types/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ name: z.string().optional(), paid: z.boolean().optional(), maxDaysPerYear: z.number().optional().nullable(), countsAsAttendance: z.boolean().optional(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const patch: Record<string, unknown> = { ...p.data };
  if (p.data.maxDaysPerYear !== undefined) patch.maxDaysPerYear = p.data.maxDaysPerYear != null ? String(p.data.maxDaysPerYear) : null;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No fields" }); return; }
  const [row] = await db.update(leaveTypesTable).set(patch).where(eq(leaveTypesTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "leave_type", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});

// ── Balances ────────────────────────────────────────────────────────────────
leaveRouter.get("/balances", async (req, res) => {
  const s = idParam.safeParse(req.query.staffId);
  if (!s.success) { res.status(400).json({ error: "staffId required" }); return; }
  const year = z.coerce.number().int().optional().safeParse(req.query.year);
  const conds = [eq(leaveBalancesTable.staffId, s.data)];
  if (year.success && year.data) conds.push(eq(leaveBalancesTable.year, year.data));
  res.json(await db.select().from(leaveBalancesTable).where(and(...conds)));
});
leaveRouter.post("/balances", async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), leaveTypeId: z.number().int().positive(), year: z.number().int(), entitled: z.number() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const [row] = await db.insert(leaveBalancesTable).values({ staffId: p.data.staffId, leaveTypeId: p.data.leaveTypeId, year: p.data.year, entitled: String(p.data.entitled) })
    .onConflictDoUpdate({ target: [leaveBalancesTable.staffId, leaveBalancesTable.leaveTypeId, leaveBalancesTable.year], set: { entitled: String(p.data.entitled) } }).returning();
  await audit(req, { action: "edit", entityType: "leave_balance", entityId: String(row.id), newValue: JSON.stringify(row) });
  res.status(201).json(row);
});

// ── Requests ────────────────────────────────────────────────────────────────
leaveRouter.get("/requests", async (req, res) => {
  const s = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [];
  if (s.success && s.data) conds.push(eq(leaveRequestsTable.staffId, s.data));
  if (status) conds.push(eq(leaveRequestsTable.status, status));
  res.json(await db.select().from(leaveRequestsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(leaveRequestsTable.fromDate)).limit(500));
});
leaveRouter.post("/requests", async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), leaveTypeId: z.number().int().positive(), fromDate: z.string(), toDate: z.string(), days: z.number().positive(), halfDay: z.boolean().optional(), reason: z.string().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(leaveRequestsTable).values({ staffId: p.data.staffId, leaveTypeId: p.data.leaveTypeId, fromDate: p.data.fromDate, toDate: p.data.toDate, days: String(p.data.days), halfDay: p.data.halfDay ?? false, reason: p.data.reason ?? null, createdByUserId: a.userId }).returning();
  await audit(req, { action: "create", entityType: "leave_request", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, days: row.days }) });
  res.status(201).json(row);
});
leaveRouter.post("/requests/:id/decide", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const result = await db.transaction(async (tx) => {
    const [reqRow] = await tx.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id.data)).for("update");
    if (!reqRow) return { notFound: true as const };
    if (reqRow.status !== "submitted") return { conflict: `Already ${reqRow.status}` };
    const [updated] = await tx.update(leaveRequestsTable).set({ status: p.data.decision, approverUserId: a.userId, approverName: a.userName, decidedAt: new Date(), decisionNote: p.data.note ?? null }).where(eq(leaveRequestsTable.id, id.data)).returning();
    if (p.data.decision === "approved") {
      const year = Number(reqRow.fromDate.slice(0, 4));
      await tx.insert(leaveBalancesTable).values({ staffId: reqRow.staffId, leaveTypeId: reqRow.leaveTypeId, year, entitled: "0", used: reqRow.days })
        .onConflictDoUpdate({ target: [leaveBalancesTable.staffId, leaveBalancesTable.leaveTypeId, leaveBalancesTable.year], set: { used: sql`${leaveBalancesTable.used} + ${reqRow.days}::numeric` } });
      await tx.insert(staffTimelineEventsTable).values({ staffId: reqRow.staffId, eventType: "leave_approved", title: `Leave approved (${reqRow.days} day(s))`, sourceModule: "leave", refType: "leave_request", refId: String(reqRow.id), visibility: "employee_visible", createdByUserId: a.userId, createdByName: a.userName });
    }
    return { updated, staffId: reqRow.staffId };
  }).catch((e: Error) => ({ error: e.message }));
  if ("error" in result) { res.status(500).json({ error: result.error }); return; }
  if ("notFound" in result) { res.status(404).json({ error: "Not found" }); return; }
  if ("conflict" in result) { res.status(409).json({ error: result.conflict }); return; }
  await audit(req, { action: "approve", entityType: "leave_request", entityId: String(id.data), newValue: JSON.stringify({ decision: p.data.decision }), reason: p.data.note ?? undefined });
  await notify({ staffId: result.staffId, type: "leave", title: `Leave ${p.data.decision}`, refType: "leave_request", refId: String(id.data) });
  res.json(result.updated);
});
leaveRouter.post("/requests/:id/cancel", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(leaveRequestsTable).set({ status: "cancelled" }).where(and(eq(leaveRequestsTable.id, id.data), eq(leaveRequestsTable.status, "submitted"))).returning();
  if (!row) { res.status(409).json({ error: "Only a submitted request can be cancelled" }); return; }
  await audit(req, { action: "edit", entityType: "leave_request", entityId: String(id.data), newValue: JSON.stringify({ status: "cancelled" }) });
  res.json(row);
});

export default leaveRouter;
