// Employee self-service API — /api/self-service/* scoped to the CALLER'S OWN
// staff record.
//
// Mounted at /api/self-service behind requireStaffAuth ONLY (self-scoped — never
// accepts a client-supplied staffId) + ff_hr_employee_self_service. The caller
// (a users session) is resolved to their staff record via the 1:1
// staff_user_links. (Prefix is /api/self-service, not /api/my, to avoid
// shadowing the existing /api/my/quick-doctors route.)
//
// SECURITY: every GET here returns data scoped to the caller. All
// /api/self-service/* paths MUST be listed in NETWORK_ONLY_PREFIXES in
// artifacts/diagnostic-erp/public/sw.js (done) so the service worker never
// serves one user's cached data to the next.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  staffTable, staffUserLinksTable, staffSkillsTable, skillsTable, staffTimelineEventsTable,
  staffDocumentsTable, staffAttendanceTable, staffStatusHistoryTable,
  leaveRequestsTable, leaveBalancesTable, notificationsTable,
} from "@workspace/db/schema";
import { and, eq, gte, lte, desc, or } from "drizzle-orm";
import { isFeatureEnabledServer } from "../lib/featureFlags";
import { auditFromRequest } from "../lib/audit";
import { computeCycleScore } from "../lib/performance/performanceService";
import { recordStaffPunch } from "../lib/attendance/attendanceIngestion";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";

export const mySelfServiceRouter = Router();
mySelfServiceRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isFeatureEnabledServer("ff_hr_employee_self_service")) { next(); return; }
  res.status(503).json({ error: "Employee self-service is disabled. Enable ff_hr_employee_self_service." });
});

function callerUserId(req: Request): number | null {
  return (req as StaffAuthRequest).staffSession?.subjectId ?? null;
}
async function resolveOwnStaffId(req: Request): Promise<number | null> {
  const uid = callerUserId(req);
  if (!uid) return null;
  const [link] = await db.select({ staffId: staffUserLinksTable.staffId }).from(staffUserLinksTable).where(eq(staffUserLinksTable.userId, uid));
  return link?.staffId ?? null;
}
async function requireOwnStaff(req: Request, res: Response): Promise<number | null> {
  const staffId = await resolveOwnStaffId(req);
  if (!staffId) { res.status(404).json({ error: "No staff record is linked to your account. Ask HR to link your profile." }); return null; }
  return staffId;
}

mySelfServiceRouter.get("/me", async (req, res) => {
  const staffId = await resolveOwnStaffId(req);
  if (!staffId) { res.json({ linked: false }); return; }
  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, staffId));
  res.json({ linked: true, staffId, staff });
});

mySelfServiceRouter.get("/profile", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  const [staff, skills, timeline, documents, status] = await Promise.all([
    db.select().from(staffTable).where(eq(staffTable.id, staffId)),
    db.select({ id: staffSkillsTable.id, level: staffSkillsTable.level, certified: staffSkillsTable.certified, name: skillsTable.name, category: skillsTable.category }).from(staffSkillsTable).innerJoin(skillsTable, eq(staffSkillsTable.skillId, skillsTable.id)).where(eq(staffSkillsTable.staffId, staffId)),
    db.select().from(staffTimelineEventsTable).where(and(eq(staffTimelineEventsTable.staffId, staffId), eq(staffTimelineEventsTable.visibility, "employee_visible"))).orderBy(desc(staffTimelineEventsTable.occurredAt)).limit(50),
    db.select({ id: staffDocumentsTable.id, docType: staffDocumentsTable.docType, title: staffDocumentsTable.title, fileName: staffDocumentsTable.fileName, createdAt: staffDocumentsTable.createdAt }).from(staffDocumentsTable).where(eq(staffDocumentsTable.staffId, staffId)).orderBy(desc(staffDocumentsTable.createdAt)),
    db.select().from(staffStatusHistoryTable).where(eq(staffStatusHistoryTable.staffId, staffId)).orderBy(desc(staffStatusHistoryTable.effectiveFrom)).limit(1),
  ]);
  res.json({ staff: staff[0], skills, timeline, documents, status: status[0] ?? null });
});

mySelfServiceRouter.get("/attendance", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const conds = [eq(staffAttendanceTable.staffId, staffId)];
  if (from) conds.push(gte(staffAttendanceTable.attendanceDate, from));
  if (to) conds.push(lte(staffAttendanceTable.attendanceDate, to));
  res.json(await db.select().from(staffAttendanceTable).where(and(...conds)).orderBy(desc(staffAttendanceTable.attendanceDate)).limit(200));
});

mySelfServiceRouter.get("/score", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  const cycleId = z.coerce.number().int().positive().safeParse(req.query.cycleId);
  if (!cycleId.success) { res.status(400).json({ error: "cycleId required" }); return; }
  if (!(await isFeatureEnabledServer("ff_hr_performance_scoring"))) { res.status(503).json({ error: "Performance scoring disabled" }); return; }
  res.json(await computeCycleScore(cycleId.data, staffId));
});

mySelfServiceRouter.get("/leave", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  const [requests, balances] = await Promise.all([
    db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.staffId, staffId)).orderBy(desc(leaveRequestsTable.fromDate)).limit(100),
    db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.staffId, staffId)),
  ]);
  res.json({ requests, balances });
});
mySelfServiceRouter.post("/leave", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  if (!(await isFeatureEnabledServer("ff_hr_leave"))) { res.status(503).json({ error: "Leave management disabled" }); return; }
  const p = z.object({ leaveTypeId: z.number().int().positive(), fromDate: z.string(), toDate: z.string(), days: z.number().positive(), halfDay: z.boolean().optional(), reason: z.string().optional().nullable() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const [row] = await db.insert(leaveRequestsTable).values({ staffId, leaveTypeId: p.data.leaveTypeId, fromDate: p.data.fromDate, toDate: p.data.toDate, days: String(p.data.days), halfDay: p.data.halfDay ?? false, reason: p.data.reason ?? null, createdByUserId: callerUserId(req) }).returning();
  res.status(201).json(row);
});

mySelfServiceRouter.get("/notifications", async (req, res) => {
  const uid = callerUserId(req); const staffId = await resolveOwnStaffId(req);
  const conds = [];
  if (uid) conds.push(eq(notificationsTable.userId, uid));
  if (staffId) conds.push(eq(notificationsTable.staffId, staffId));
  if (conds.length === 0) { res.json([]); return; }
  const rows = await db.select().from(notificationsTable).where(conds.length === 1 ? conds[0] : or(...conds)).orderBy(desc(notificationsTable.createdAt)).limit(50);
  res.json(rows);
});

// Mobile GPS check-in — records a raw punch (source mobile_gps) for the caller.
mySelfServiceRouter.post("/attendance/check-in", async (req, res) => {
  const staffId = await requireOwnStaff(req, res); if (staffId == null) return;
  if (!(await isFeatureEnabledServer("ff_hr_attendance_management"))) { res.status(503).json({ error: "Attendance management is disabled. Enable ff_hr_attendance_management." }); return; }
  const p = z.object({ action: z.enum(["in", "out"]), lat: z.number(), lng: z.number(), accuracy: z.number().optional() }).safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: "Invalid request", details: p.error.issues }); return; }
  const [staff] = await db.select().from(staffTable).where(eq(staffTable.id, staffId));
  if (!staff) { res.status(404).json({ error: "Staff not found" }); return; }
  const result = await recordStaffPunch(req, {
    staff, requestedAction: p.data.action, sourceKind: "mobile_gps", deviceId: "mobile",
    raw: { lat: p.data.lat, lng: p.data.lng, accuracy: p.data.accuracy ?? null },
  });
  if (!result.ok) { res.status(409).json({ error: result.error }); return; }
  await auditFromRequest(req, { userId: callerUserId(req), userName: `${staff.firstName} ${staff.lastName}`, role: "staff", action: "create", module: "attendance", entityType: "attendance", entityId: String(staffId), newValue: JSON.stringify({ action: result.action, source: "mobile_gps" }), reason: "Mobile GPS check-in" });
  res.json({ action: result.action, duplicate: result.duplicate, attendance: result.attendance });
});

export default mySelfServiceRouter;
