// People Management platform API — the data layer for the 360° employee profile.
//
// Mounted at /api/people behind requireStaffAuth + requireStaffSubPermission
// ("/settings","users") (extends the existing HR gate — no new RBAC) and behind
// the ff_hr_staff_enhanced feature flag (Shadow Mode: dormant until enabled).
// Every mutation writes a hash-chained audit_logs row. NOTHING here is financial:
// no salary/advance/payroll field is read or written.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  staffTable,
  departmentsTable,
  usersTable,
  designationsTable,
  staffStatusHistoryTable,
  staffReportingLinesTable,
  staffDocumentsTable,
  staffUserLinksTable,
  skillsTable,
  staffSkillsTable,
  staffTimelineEventsTable,
} from "@workspace/db/schema";
import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import { auditFromRequest } from "../lib/audit";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { buildOrgChart, countReports, type OrgNode, type ReportingEdge } from "../lib/people/orgChart";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const peopleRouter = Router();

// Shadow-mode gate for the whole People platform.
peopleRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_staff_enhanced")) {
    next();
    return;
  }
  res.status(503).json({ error: "The People Management platform is disabled. Enable ff_hr_staff_enhanced." });
});

function actorOf(req: Request) {
  const s = (req as StaffAuthRequest).staffSession;
  return { userId: s?.subjectId ?? null, userName: s?.subjectName ?? "system", role: s?.role ?? "system" };
}

const idParam = z.coerce.number().int().positive();
const levelEnum = z.enum(["beginner", "intermediate", "advanced", "trainer"]);

// ── 360° employee profile (single source of truth) ──────────────────────────
peopleRouter.get("/staff/:id/profile", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  const staffId = id.data;

  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, staffId));
  if (!staff) { res.status(404).json({ error: "Staff not found" }); return; }

  const [reportsTo, directReports, skills, timeline, statusHistory, documents, link] = await Promise.all([
    db.select().from(staffReportingLinesTable).where(and(eq(staffReportingLinesTable.staffId, staffId), isNull(staffReportingLinesTable.effectiveTo))),
    db.select().from(staffReportingLinesTable).where(and(eq(staffReportingLinesTable.supervisorStaffId, staffId), isNull(staffReportingLinesTable.effectiveTo))),
    db.select({
      id: staffSkillsTable.id, skillId: staffSkillsTable.skillId, level: staffSkillsTable.level,
      certified: staffSkillsTable.certified, name: skillsTable.name, category: skillsTable.category,
    }).from(staffSkillsTable).innerJoin(skillsTable, eq(staffSkillsTable.skillId, skillsTable.id)).where(eq(staffSkillsTable.staffId, staffId)),
    db.select().from(staffTimelineEventsTable).where(eq(staffTimelineEventsTable.staffId, staffId)).orderBy(desc(staffTimelineEventsTable.occurredAt)).limit(50),
    db.select().from(staffStatusHistoryTable).where(eq(staffStatusHistoryTable.staffId, staffId)).orderBy(desc(staffStatusHistoryTable.effectiveFrom)),
    db.select({
      id: staffDocumentsTable.id, docType: staffDocumentsTable.docType, title: staffDocumentsTable.title,
      fileName: staffDocumentsTable.fileName, confidential: staffDocumentsTable.confidential, createdAt: staffDocumentsTable.createdAt,
    }).from(staffDocumentsTable).where(eq(staffDocumentsTable.staffId, staffId)).orderBy(desc(staffDocumentsTable.createdAt)),
    db.select().from(staffUserLinksTable).where(eq(staffUserLinksTable.staffId, staffId)),
  ]);

  // Resolve supervisor / report names.
  const relatedIds = [...new Set([...reportsTo.map((r) => r.supervisorStaffId), ...directReports.map((r) => r.staffId)])];
  const related = relatedIds.length
    ? await db.select({ id: staffTable.id, firstName: staffTable.firstName, lastName: staffTable.lastName, role: staffTable.role }).from(staffTable).where(inArray(staffTable.id, relatedIds))
    : [];
  const nameOf = new Map(related.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

  let linkedUser: { id: number; name: string; role: string } | null = null;
  if (link[0]) {
    const [u] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, link[0].userId));
    linkedUser = u ?? null;
  }

  res.json({
    staff,
    employment: { department: staff.department, role: staff.role, joiningDate: staff.joiningDate, isActive: staff.isActive },
    reportsTo: reportsTo.map((r) => ({ supervisorStaffId: r.supervisorStaffId, supervisorName: nameOf.get(r.supervisorStaffId) ?? null, relationship: r.relationship })),
    directReports: directReports.map((r) => ({ staffId: r.staffId, name: nameOf.get(r.staffId) ?? null })),
    skills, timeline, statusHistory, documents,
    identity: linkedUser,
  });
});

// ── Designations master ─────────────────────────────────────────────────────
const designationBody = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().optional(),
  departmentId: z.number().int().positive().optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional().nullable(),
});

peopleRouter.get("/designations", async (_req, res) => {
  res.json(await db.select().from(designationsTable).orderBy(designationsTable.name));
});
peopleRouter.post("/designations", async (req, res) => {
  const p = designationBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(designationsTable).values({
      name: p.data.name, code: p.data.code ?? null, departmentId: p.data.departmentId ?? null,
      description: p.data.description ?? null, isActive: p.data.isActive ?? true, sortOrder: p.data.sortOrder ?? null,
    }).returning();
    await auditFromRequest(req, { ...actorOf(req), action: "create", module: "people", entityType: "designation", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") || msg.includes("duplicate") ? 409 : 500).json({ error: msg.includes("unique") ? "A designation with that name already exists" : msg });
  }
});
peopleRouter.patch("/designations/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = designationBody.partial().safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [existing] = await db.select().from(designationsTable).where(eq(designationsTable.id, id.data));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (Object.keys(p.data).length === 0) { res.json(existing); return; }
  const [row] = await db.update(designationsTable).set(p.data).where(eq(designationsTable.id, id.data)).returning();
  await auditFromRequest(req, { ...actorOf(req), action: "edit", module: "people", entityType: "designation", entityId: String(id.data), oldValue: JSON.stringify(existing), newValue: JSON.stringify(row) });
  res.json(row);
});
peopleRouter.delete("/designations/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(designationsTable).where(eq(designationsTable.id, id.data));
  await auditFromRequest(req, { ...actorOf(req), action: "delete", module: "people", entityType: "designation", entityId: String(id.data) });
  res.json({ success: true });
});

// ── Skills master + staff skill matrix ──────────────────────────────────────
peopleRouter.get("/skills", async (_req, res) => {
  res.json(await db.select().from(skillsTable).orderBy(skillsTable.sortOrder, skillsTable.name));
});
peopleRouter.post("/skills", async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1), category: z.string().optional().nullable(), description: z.string().optional().nullable(), sortOrder: z.number().int().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  try {
    const [row] = await db.insert(skillsTable).values({ name: p.data.name, category: p.data.category ?? null, description: p.data.description ?? null, sortOrder: p.data.sortOrder ?? null }).returning();
    await auditFromRequest(req, { ...actorOf(req), action: "create", module: "people", entityType: "skill", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "That skill already exists" : msg });
  }
});
peopleRouter.patch("/skills/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ name: z.string().trim().min(1).optional(), category: z.string().optional().nullable(), description: z.string().optional().nullable(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  if (Object.keys(p.data).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(skillsTable).set(p.data).where(eq(skillsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await auditFromRequest(req, { ...actorOf(req), action: "edit", module: "people", entityType: "skill", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});

peopleRouter.get("/staff/:id/skills", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select({
    id: staffSkillsTable.id, skillId: staffSkillsTable.skillId, level: staffSkillsTable.level, certified: staffSkillsTable.certified,
    name: skillsTable.name, category: skillsTable.category,
  }).from(staffSkillsTable).innerJoin(skillsTable, eq(staffSkillsTable.skillId, skillsTable.id)).where(eq(staffSkillsTable.staffId, id.data)));
});
peopleRouter.post("/staff/:id/skills", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ skillId: z.number().int().positive(), level: levelEnum.optional(), certified: z.boolean().optional(), notes: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request", details: p.success ? undefined : p.error.issues }); return; }
  const a = actorOf(req);
  try {
    const [row] = await db.insert(staffSkillsTable).values({
      staffId: id.data, skillId: p.data.skillId, level: p.data.level ?? "beginner", certified: p.data.certified ?? false,
      notes: p.data.notes ?? null, assessedByUserId: a.userId, assessedAt: new Date(),
    }).returning();
    await auditFromRequest(req, { ...a, action: "create", module: "people", entityType: "staff_skill", entityId: String(row.id), newValue: JSON.stringify(row) });
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    res.status(msg.includes("unique") ? 409 : 500).json({ error: msg.includes("unique") ? "That staff member already has this skill" : msg });
  }
});
peopleRouter.patch("/staff-skills/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ level: levelEnum.optional(), certified: z.boolean().optional(), notes: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [row] = await db.update(staffSkillsTable).set({ ...p.data, assessedByUserId: actorOf(req).userId, assessedAt: new Date() }).where(eq(staffSkillsTable.id, id.data)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await auditFromRequest(req, { ...actorOf(req), action: "edit", module: "people", entityType: "staff_skill", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});
peopleRouter.delete("/staff-skills/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(staffSkillsTable).where(eq(staffSkillsTable.id, id.data));
  await auditFromRequest(req, { ...actorOf(req), action: "delete", module: "people", entityType: "staff_skill", entityId: String(id.data) });
  res.json({ success: true });
});

// ── Reporting hierarchy + derived org chart ─────────────────────────────────
peopleRouter.get("/staff/:id/reporting", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select().from(staffReportingLinesTable).where(eq(staffReportingLinesTable.staffId, id.data)).orderBy(desc(staffReportingLinesTable.effectiveFrom)));
});
peopleRouter.post("/staff/:id/reporting", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ supervisorStaffId: z.number().int().positive(), relationship: z.string().optional(), effectiveFrom: z.string().optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request", details: p.success ? undefined : p.error.issues }); return; }
  if (p.data.supervisorStaffId === id.data) { res.status(400).json({ error: "A staff member cannot report to themselves" }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(staffReportingLinesTable).values({
    staffId: id.data, supervisorStaffId: p.data.supervisorStaffId, relationship: p.data.relationship ?? "primary",
    effectiveFrom: p.data.effectiveFrom ?? new Date().toISOString().slice(0, 10), createdByUserId: a.userId,
  }).returning();
  await auditFromRequest(req, { ...a, action: "create", module: "people", entityType: "reporting_line", entityId: String(row.id), newValue: JSON.stringify(row) });
  res.status(201).json(row);
});
peopleRouter.delete("/reporting/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(staffReportingLinesTable).where(eq(staffReportingLinesTable.id, id.data));
  await auditFromRequest(req, { ...actorOf(req), action: "delete", module: "people", entityType: "reporting_line", entityId: String(id.data) });
  res.json({ success: true });
});
peopleRouter.get("/org-chart", async (_req, res) => {
  const staff = await db.select({ id: staffTable.id, firstName: staffTable.firstName, lastName: staffTable.lastName, role: staffTable.role, department: staffTable.department, isActive: staffTable.isActive }).from(staffTable).where(eq(staffTable.isActive, true));
  const lines = await db.select({ staffId: staffReportingLinesTable.staffId, supervisorStaffId: staffReportingLinesTable.supervisorStaffId }).from(staffReportingLinesTable).where(isNull(staffReportingLinesTable.effectiveTo));
  const nodes: OrgNode[] = staff.map((s) => ({ staffId: s.id, name: `${s.firstName} ${s.lastName}`, designation: s.role, department: s.department, isActive: s.isActive }));
  const edges: ReportingEdge[] = lines.map((l) => ({ staffId: l.staffId, supervisorStaffId: l.supervisorStaffId }));
  const { roots } = buildOrgChart(nodes, edges);
  res.json({ roots, headcount: nodes.length, topLevel: roots.map((r) => ({ staffId: r.staffId, name: r.name, reports: countReports(r) })) });
});

// ── Employment status history (legal record) ────────────────────────────────
peopleRouter.get("/staff/:id/status-history", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select().from(staffStatusHistoryTable).where(eq(staffStatusHistoryTable.staffId, id.data)).orderBy(desc(staffStatusHistoryTable.effectiveFrom)));
});
peopleRouter.post("/staff/:id/status-history", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ status: z.string().trim().min(1), previousStatus: z.string().optional().nullable(), effectiveFrom: z.string().optional(), reason: z.string().optional().nullable(), notes: z.string().optional().nullable() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request", details: p.success ? undefined : p.error.issues }); return; }
  const a = actorOf(req);
  const effectiveFrom = p.data.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const [row] = await db.insert(staffStatusHistoryTable).values({
    staffId: id.data, status: p.data.status, previousStatus: p.data.previousStatus ?? null, effectiveFrom,
    reason: p.data.reason ?? null, notes: p.data.notes ?? null, changedByUserId: a.userId, changedByName: a.userName,
  }).returning();
  // A status change is a lifecycle event → feed the 360° timeline.
  await db.insert(staffTimelineEventsTable).values({
    staffId: id.data, eventType: "status_change", title: `Status → ${p.data.status}`,
    description: p.data.reason ?? null, sourceModule: "staff", refType: "staff_status_history", refId: String(row.id),
    createdByUserId: a.userId, createdByName: a.userName,
  }).catch(() => {});
  await auditFromRequest(req, { ...a, action: "create", module: "people", entityType: "status_history", entityId: String(row.id), newValue: JSON.stringify(row), reason: p.data.reason ?? undefined });
  res.status(201).json(row);
});

// ── Activity timeline ───────────────────────────────────────────────────────
peopleRouter.get("/staff/:id/timeline", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select().from(staffTimelineEventsTable).where(eq(staffTimelineEventsTable.staffId, id.data)).orderBy(desc(staffTimelineEventsTable.occurredAt)).limit(200));
});
peopleRouter.post("/staff/:id/timeline", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ eventType: z.string().trim().min(1), title: z.string().trim().min(1), description: z.string().optional().nullable(), visibility: z.enum(["internal", "employee_visible"]).optional() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request", details: p.success ? undefined : p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(staffTimelineEventsTable).values({
    staffId: id.data, eventType: p.data.eventType, title: p.data.title, description: p.data.description ?? null,
    visibility: p.data.visibility ?? "internal", sourceModule: "manual", createdByUserId: a.userId, createdByName: a.userName,
  }).returning();
  await auditFromRequest(req, { ...a, action: "create", module: "people", entityType: "timeline_event", entityId: String(row.id), newValue: JSON.stringify(row) });
  res.status(201).json(row);
});

// ── HR document vault (metadata; bytes via presigned object storage) ─────────
peopleRouter.get("/staff/:id/documents", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  res.json(await db.select().from(staffDocumentsTable).where(eq(staffDocumentsTable.staffId, id.data)).orderBy(desc(staffDocumentsTable.createdAt)));
});
peopleRouter.post("/staff/:id/documents", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({
    docType: z.string().trim().min(1), title: z.string().optional().nullable(), storageKey: z.string().trim().min(1),
    fileName: z.string().optional().nullable(), mimeType: z.string().optional().nullable(), sizeBytes: z.number().int().optional().nullable(),
    confidential: z.boolean().optional(), notes: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request", details: p.success ? undefined : p.error.issues }); return; }
  const a = actorOf(req);
  const [row] = await db.insert(staffDocumentsTable).values({
    staffId: id.data, docType: p.data.docType, title: p.data.title ?? null, storageKey: p.data.storageKey,
    fileName: p.data.fileName ?? null, mimeType: p.data.mimeType ?? null, sizeBytes: p.data.sizeBytes ?? null,
    confidential: p.data.confidential ?? true, uploadedByUserId: a.userId, uploadedByName: a.userName, notes: p.data.notes ?? null,
  }).returning();
  await auditFromRequest(req, { ...a, action: "create", module: "people", entityType: "staff_document", entityId: String(row.id), newValue: JSON.stringify({ docType: row.docType, fileName: row.fileName, confidential: row.confidential }) });
  res.status(201).json(row);
});
peopleRouter.delete("/documents/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(staffDocumentsTable).where(eq(staffDocumentsTable.id, id.data));
  await db.delete(staffDocumentsTable).where(eq(staffDocumentsTable.id, id.data));
  await auditFromRequest(req, { ...actorOf(req), action: "delete", module: "people", entityType: "staff_document", entityId: String(id.data), oldValue: existing ? JSON.stringify({ docType: existing.docType, fileName: existing.fileName }) : undefined });
  res.json({ success: true });
});

// ── Identity link: strict 1:1 staff ↔ users ─────────────────────────────────
peopleRouter.get("/staff/:id/user-link", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  const [link] = await db.select().from(staffUserLinksTable).where(eq(staffUserLinksTable.staffId, id.data));
  res.json(link ?? null);
});
peopleRouter.put("/staff/:id/user-link", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const p = z.object({ userId: z.number().int().positive() }).safeParse(req.body);
  if (!id.success || !p.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const a = actorOf(req);
  // Enforce strict 1:1: the target user must not already be linked to a different staff.
  const [userTaken] = await db.select().from(staffUserLinksTable).where(eq(staffUserLinksTable.userId, p.data.userId)).limit(1);
  if (userTaken && userTaken.staffId !== id.data) { res.status(409).json({ error: "That ERP user is already linked to another staff member" }); return; }
  const [existing] = await db.select().from(staffUserLinksTable).where(eq(staffUserLinksTable.staffId, id.data));
  let row;
  if (existing) {
    [row] = await db.update(staffUserLinksTable).set({ userId: p.data.userId, linkedByUserId: a.userId, linkedByName: a.userName }).where(eq(staffUserLinksTable.staffId, id.data)).returning();
  } else {
    [row] = await db.insert(staffUserLinksTable).values({ staffId: id.data, userId: p.data.userId, linkedByUserId: a.userId, linkedByName: a.userName }).returning();
  }
  await auditFromRequest(req, { ...a, action: existing ? "edit" : "create", module: "people", entityType: "staff_user_link", entityId: String(id.data), newValue: JSON.stringify(row) });
  res.json(row);
});
peopleRouter.delete("/staff/:id/user-link", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid staff id" }); return; }
  await db.delete(staffUserLinksTable).where(eq(staffUserLinksTable.staffId, id.data));
  await auditFromRequest(req, { ...actorOf(req), action: "delete", module: "people", entityType: "staff_user_link", entityId: String(id.data) });
  res.json({ success: true });
});

export default peopleRouter;
