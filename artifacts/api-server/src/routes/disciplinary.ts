// Disciplinary case management API — confidential, additive, non-financial.
// Mounted at /api/disciplinary behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") and ff_hr_disciplinary. Every step is audited; a
// suspension here does NOT change payroll. Audited + zod.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { disciplinaryActionsTable, staffTimelineEventsTable } from "@workspace/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { notify } from "../lib/notifications";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const disciplinaryRouter = Router();
disciplinaryRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_disciplinary")) { next(); return; }
  res.status(503).json({ error: "Disciplinary management is disabled. Enable ff_hr_disciplinary." });
});
function actorOf(req: Request) { const s = (req as StaffAuthRequest).staffSession; return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" }; }
type AuditExtra = { action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string };
const audit = (req: Request, e: AuditExtra) => auditFromRequest(req, { ...actorOf(req), module: "disciplinary", ...e });
const idParam = z.coerce.number().int().positive();
const TYPES = ["verbal_warning", "written_warning", "show_cause", "suspension", "inquiry", "termination_notice"] as const;

disciplinaryRouter.get("/", async (req, res) => {
  const s = z.coerce.number().int().positive().optional().safeParse(req.query.staffId);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const conds = [];
  if (s.success && s.data) conds.push(eq(disciplinaryActionsTable.staffId, s.data));
  if (status) conds.push(eq(disciplinaryActionsTable.status, status));
  res.json(await db.select().from(disciplinaryActionsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(disciplinaryActionsTable.createdAt)).limit(500));
});
disciplinaryRouter.get("/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(disciplinaryActionsTable).where(eq(disciplinaryActionsTable.id, id.data));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});
disciplinaryRouter.post("/", async (req, res) => {
  const p = z.object({ staffId: z.number().int().positive(), type: z.enum(TYPES), severity: z.enum(["minor", "major", "critical"]).optional(), reason: z.string().trim().min(1), description: z.string().optional().nullable(), incidentDate: z.string().optional().nullable(), evidenceStorageKey: z.string().optional().nullable(), relatedEventId: z.number().int().positive().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(disciplinaryActionsTable).values({ staffId: p.data.staffId, type: p.data.type, severity: p.data.severity ?? "minor", reason: p.data.reason, description: p.data.description ?? null, incidentDate: p.data.incidentDate ?? null, evidenceStorageKey: p.data.evidenceStorageKey ?? null, relatedEventId: p.data.relatedEventId ?? null, status: "draft" }).returning();
  await audit(req, { action: "create", entityType: "disciplinary_action", entityId: String(row.id), newValue: JSON.stringify({ staffId: row.staffId, type: row.type, severity: row.severity }) });
  res.status(201).json(row);
});
disciplinaryRouter.post("/:id/issue", async (req, res) => {
  const id = idParam.safeParse(req.params.id); if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const a = actorOf(req);
  const [row] = await db.update(disciplinaryActionsTable).set({ status: "issued", issuedByUserId: a.userId, issuedByName: a.userName, issuedAt: new Date() }).where(and(eq(disciplinaryActionsTable.id, id.data), eq(disciplinaryActionsTable.status, "draft"))).returning();
  if (!row) { res.status(409).json({ error: "Only a draft action can be issued" }); return; }
  await db.insert(staffTimelineEventsTable).values({ staffId: row.staffId, eventType: "warning", title: `Disciplinary: ${row.type.replace(/_/g, " ")}`, description: row.reason, sourceModule: "disciplinary", refType: "disciplinary_action", refId: String(row.id), visibility: "internal", createdByUserId: a.userId, createdByName: a.userName }).catch(() => {});
  await audit(req, { action: "approve", entityType: "disciplinary_action", entityId: String(id.data), newValue: JSON.stringify({ status: "issued" }), reason: row.reason });
  await notify({ staffId: row.staffId, type: "disciplinary", title: "A disciplinary action was issued", body: row.reason, refType: "disciplinary_action", refId: String(row.id) });
  res.json(row);
});
disciplinaryRouter.post("/:id/respond", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ response: z.string().trim().min(1) }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [row] = await db.update(disciplinaryActionsTable).set({ employeeResponse: p.data.response, respondedAt: new Date(), status: "responded" }).where(eq(disciplinaryActionsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "edit", entityType: "disciplinary_action", entityId: String(id.data), newValue: JSON.stringify({ status: "responded" }) });
  res.json(row);
});
disciplinaryRouter.post("/:id/close", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ outcome: z.string().trim().min(1) }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  const [row] = await db.update(disciplinaryActionsTable).set({ status: "closed", outcome: p.data.outcome, closedByUserId: a.userId, closedAt: new Date() }).where(eq(disciplinaryActionsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await audit(req, { action: "finalize", entityType: "disciplinary_action", entityId: String(id.data), newValue: JSON.stringify({ status: "closed", outcome: p.data.outcome }) });
  res.json(row);
});

export default disciplinaryRouter;
