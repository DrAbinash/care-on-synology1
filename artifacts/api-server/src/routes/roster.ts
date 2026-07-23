// Duty roster & shift scheduling API — additive, non-financial, shadow-mode.
// Mounted at /api/roster behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") and ff_hr_roster. Audited + zod.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { shiftTemplatesTable, dutyRostersTable, holidayCalendarTable } from "@workspace/db/schema";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const rosterRouter = Router();
rosterRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_roster")) { next(); return; }
  res.status(503).json({ error: "Duty roster is disabled. Enable ff_hr_roster." });
});
function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, e: AuditExtra) => auditFromRequest(req, { ...actorOf(req), module: "roster", ...e });
const idParam = z.coerce.number().int().positive();

// ── Shift templates ─────────────────────────────────────────────────────────
const shiftBody = z.object({ name: z.string().trim().min(1), code: z.string().optional().nullable(), startTime: z.string(), endTime: z.string(), crossMidnight: z.boolean().optional(), graceMinutes: z.number().int().optional(), breakMinutes: z.number().int().optional(), color: z.string().optional().nullable(), isActive: z.boolean().optional() });
rosterRouter.get("/shift-templates", async (_req, res) => res.json(await db.select().from(shiftTemplatesTable).orderBy(shiftTemplatesTable.name)));
rosterRouter.post("/shift-templates", async (req, res) => {
  const p = shiftBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(shiftTemplatesTable).values({ name: p.data.name, code: p.data.code ?? null, startTime: p.data.startTime, endTime: p.data.endTime, crossMidnight: p.data.crossMidnight ?? false, graceMinutes: p.data.graceMinutes ?? 10, breakMinutes: p.data.breakMinutes ?? 0, color: p.data.color ?? null }).returning();
    await audit(req, { action: "create", entityType: "shift_template", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) { const m = err instanceof Error ? err.message : "Failed"; res.status(m.includes("unique") ? 409 : 500).json({ error: m.includes("unique") ? "A shift with that name exists" : m }); }
});
rosterRouter.patch("/shift-templates/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); const p = shiftBody.partial().safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields" }); return; }
  const [row] = await db.update(shiftTemplatesTable).set(p.data).where(eq(shiftTemplatesTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "shift_template", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});
rosterRouter.delete("/shift-templates/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(shiftTemplatesTable).where(eq(shiftTemplatesTable.id, id.data));
  await audit(req, { action: "delete", entityType: "shift_template", entityId: String(id.data) });
  res.json({ success: true });
});

// ── Roster assignments ──────────────────────────────────────────────────────
rosterRouter.get("/", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const staffId = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const conds = [];
  if (from) conds.push(gte(dutyRostersTable.dutyDate, from));
  if (to) conds.push(lte(dutyRostersTable.dutyDate, to));
  if (staffId.success && staffId.data) conds.push(eq(dutyRostersTable.staffId, staffId.data));
  res.json(await db.select().from(dutyRostersTable).where(conds.length ? and(...conds) : undefined).orderBy(dutyRostersTable.dutyDate).limit(1000));
});
rosterRouter.post("/", async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), dutyDate: z.string(), shiftTemplateId: z.number().int().positive().optional().nullable(), status: z.string().optional(), notes: z.string().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(dutyRostersTable).values({ staffId: p.data.staffId, dutyDate: p.data.dutyDate, shiftTemplateId: p.data.shiftTemplateId ?? null, status: p.data.status ?? "scheduled", notes: p.data.notes ?? null, createdByUserId: a.userId })
    .onConflictDoUpdate({ target: [dutyRostersTable.staffId, dutyRostersTable.dutyDate], set: { shiftTemplateId: p.data.shiftTemplateId ?? null, status: p.data.status ?? "scheduled", notes: p.data.notes ?? null } })
    .returning();
  await audit(req, { action: "create", entityType: "duty_roster", entityId: String(row.id), newValue: JSON.stringify(row) });
  res.status(201).json(row);
});
rosterRouter.delete("/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(dutyRostersTable).where(eq(dutyRostersTable.id, id.data));
  await audit(req, { action: "delete", entityType: "duty_roster", entityId: String(id.data) });
  res.json({ success: true });
});

// ── Holidays ────────────────────────────────────────────────────────────────
rosterRouter.get("/holidays", async (_req, res) => res.json(await db.select().from(holidayCalendarTable).orderBy(desc(holidayCalendarTable.holidayDate))));
rosterRouter.post("/holidays", async (req, res) => {
  const p = z.object({ holidayDate: z.string(), name: z.string().trim().min(1), type: z.enum(["public", "optional", "restricted"]).optional() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(holidayCalendarTable).values({ holidayDate: p.data.holidayDate, name: p.data.name, type: p.data.type ?? "public" }).returning();
    await audit(req, { action: "create", entityType: "holiday", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) { const m = err instanceof Error ? err.message : "Failed"; res.status(m.includes("unique") ? 409 : 500).json({ error: m.includes("unique") ? "That date is already a holiday" : m }); }
});
rosterRouter.delete("/holidays/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(holidayCalendarTable).where(eq(holidayCalendarTable.id, id.data));
  await audit(req, { action: "delete", entityType: "holiday", entityId: String(id.data) });
  res.json({ success: true });
});

export default rosterRouter;
