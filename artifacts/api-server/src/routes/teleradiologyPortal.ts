/**
 * Teleradiology Portal API
 * External/night radiologists access this at /api/teleradiology-portal/*
 * Uses its own session table (teleradiology_sessions) independent of staff auth.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  teleradiologyUsersTable,
  teleradiologySessionsTable,
  teleradiologyAssignmentsTable,
  radiologyStudiesTable,
  patientsTable,
  testsTable,
  pacsSettingsTable,
} from "@workspace/db";
import { and, eq, gt, desc, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { rateLimit } from "express-rate-limit";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

const SESSION_TTL_HOURS = 12;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});

// ─── Session middleware ───────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
interface TeleRequest extends Request {
  teleUser?: typeof teleradiologyUsersTable.$inferSelect;
}

async function requireTeleSession(req: TeleRequest, res: Response, next: NextFunction): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = req as any;
  const token = (r.headers?.["authorization"] as string | undefined)?.replace("Bearer ", "").trim();
  if (!token) { r.status(401).json({ error: "No teleradiology session token" }); return; }

  const [session] = await db.select()
    .from(teleradiologySessionsTable)
    .where(and(
      eq(teleradiologySessionsTable.token, token),
      gt(teleradiologySessionsTable.expiresAt, new Date()),
    ));
  if (!session) { r.status(401).json({ error: "Invalid or expired session. Please log in again." }); return; }

  const [user] = await db.select()
    .from(teleradiologyUsersTable)
    .where(eq(teleradiologyUsersTable.id, session.userId));
  if (!user || !user.isActive) { r.status(401).json({ error: "Account disabled" }); return; }

  r.teleUser = user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (next as any)();
}

export const teleradiologyPortalRouter = Router();

// ─── POST /api/teleradiology-portal/login ────────────────────────────────────
teleradiologyPortalRouter.post("/login", loginLimiter, async (req, res): Promise<void> => {
  const { email, pin } = req.body as { email?: string; pin?: string };
  if (!email || !pin) { res.status(400).json({ error: "email and pin are required" }); return; }

  const [user] = await db.select().from(teleradiologyUsersTable)
    .where(eq(teleradiologyUsersTable.email, email.trim().toLowerCase()));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" }); return;
  }

  const valid = await bcrypt.compare(pin, user.pinHash);
  if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(teleradiologySessionsTable).values({
    userId: user.id,
    token,
    expiresAt,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const { pinHash: _, ...safeUser } = user;
  res.json({ token, user: safeUser, expiresAt });
});

// ─── POST /api/teleradiology-portal/logout ───────────────────────────────────
teleradiologyPortalRouter.post("/logout", async (req, res): Promise<void> => {
  const token = req.headers["authorization"]?.replace("Bearer ", "").trim();
  if (token) {
    await db.delete(teleradiologySessionsTable).where(eq(teleradiologySessionsTable.token, token));
  }
  res.json({ ok: true });
});

// ─── GET /api/teleradiology-portal/me ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
teleradiologyPortalRouter.get("/me", requireTeleSession as any, async (req, res): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).teleUser as typeof teleradiologyUsersTable.$inferSelect;
  const { pinHash: _, ...safeUser } = user;
  res.json(safeUser);
});

// ─── GET /api/teleradiology-portal/studies ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
teleradiologyPortalRouter.get("/studies", requireTeleSession as any, async (req, res): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).teleUser as typeof teleradiologyUsersTable.$inferSelect;

  const assignments = await db.select({
    assignmentId: teleradiologyAssignmentsTable.id,
    studyId: teleradiologyAssignmentsTable.studyId,
    priority: teleradiologyAssignmentsTable.priority,
    status: teleradiologyAssignmentsTable.status,
    isCritical: teleradiologyAssignmentsTable.isCritical,
    deadline: teleradiologyAssignmentsTable.deadline,
    assignedAt: teleradiologyAssignmentsTable.assignedAt,
    prelimReport: teleradiologyAssignmentsTable.prelimReport,
    finalReport: teleradiologyAssignmentsTable.finalReport,
    studyInstanceUID: radiologyStudiesTable.studyInstanceUid,
    accessionNumber: radiologyStudiesTable.accessionNumber,
    modality: radiologyStudiesTable.modality,
    studyDate: radiologyStudiesTable.studyDate,
    clinicalHistory: radiologyStudiesTable.clinicalHistory,
    patientFirstName: patientsTable.firstName,
    patientLastName: patientsTable.lastName,
  })
    .from(teleradiologyAssignmentsTable)
    .innerJoin(radiologyStudiesTable, eq(radiologyStudiesTable.id, teleradiologyAssignmentsTable.studyId))
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .where(
      and(
        eq(teleradiologyAssignmentsTable.teleradiologistId, user.id),
        or(
          eq(teleradiologyAssignmentsTable.status, "assigned"),
          eq(teleradiologyAssignmentsTable.status, "in_progress"),
          eq(teleradiologyAssignmentsTable.status, "submitted"),
        ),
      ),
    )
    .orderBy(desc(teleradiologyAssignmentsTable.assignedAt));

  // Try to fetch OHIF URL from PACS settings
  const ohifRow = await db.select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, "ohif_base_url"), eq(pacsSettingsTable.category, "viewer")))
    .limit(1);
  const ohifBase = ohifRow[0]?.value ?? null;

  const result = assignments.map((a) => ({
    ...a,
    patientName: [a.patientFirstName, a.patientLastName].filter(Boolean).join(" ") || "Unknown Patient",
    currentPrelim: a.prelimReport,
    currentFinal: a.finalReport,
    ohifUrl: (ohifBase && a.studyInstanceUID)
      ? `${ohifBase.replace(/\/$/, "")}/viewer?StudyInstanceUIDs=${a.studyInstanceUID}`
      : null,
  }));

  res.json(result);
});

// ─── POST /api/teleradiology-portal/assignments/:id/prelim ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
teleradiologyPortalRouter.post("/assignments/:id/prelim", requireTeleSession as any, async (req, res): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).teleUser as typeof teleradiologyUsersTable.$inferSelect;
  const assignmentId = Number(req.params["id"]);
  const { report, critical } = req.body as { report?: string; critical?: boolean };

  if (!report?.trim()) { res.status(400).json({ error: "report text is required" }); return; }

  const [assignment] = await db.select().from(teleradiologyAssignmentsTable)
    .where(and(
      eq(teleradiologyAssignmentsTable.id, assignmentId),
      eq(teleradiologyAssignmentsTable.teleradiologistId, user.id),
    ));
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }

  await db.update(teleradiologyAssignmentsTable).set({
    prelimReport: report.trim(),
    status: "submitted",
    isCritical: critical ?? assignment.isCritical,
    submittedAt: new Date(),
  }).where(eq(teleradiologyAssignmentsTable.id, assignmentId));

  // Also update the study's prelim report
  await db.update(radiologyStudiesTable).set({
    prelimReport: report.trim(),
    prelimReportedBy: user.name,
    prelimReportedAt: new Date(),
    status: "reported_preliminary",
  }).where(eq(radiologyStudiesTable.id, assignment.studyId));

  res.json({ ok: true });
});

// ─── POST /api/teleradiology-portal/assignments/:id/final ────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
teleradiologyPortalRouter.post("/assignments/:id/final", requireTeleSession as any, async (req, res): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).teleUser as typeof teleradiologyUsersTable.$inferSelect;
  if (!user.canDoFinalReport) {
    res.status(403).json({ error: "You are not authorised to submit final reports" }); return;
  }
  const assignmentId = Number(req.params["id"]);
  const { report, critical } = req.body as { report?: string; critical?: boolean };
  if (!report?.trim()) { res.status(400).json({ error: "report text is required" }); return; }

  const [assignment] = await db.select().from(teleradiologyAssignmentsTable)
    .where(and(
      eq(teleradiologyAssignmentsTable.id, assignmentId),
      eq(teleradiologyAssignmentsTable.teleradiologistId, user.id),
    ));
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }

  await db.update(teleradiologyAssignmentsTable).set({
    finalReport: report.trim(),
    status: "completed",
    isCritical: critical ?? assignment.isCritical,
    submittedAt: new Date(),
  }).where(eq(teleradiologyAssignmentsTable.id, assignmentId));

  await db.update(radiologyStudiesTable).set({
    finalReport: report.trim(),
    finalReportedBy: user.name,
    finalReportedAt: new Date(),
    status: "reported_final",
  }).where(eq(radiologyStudiesTable.id, assignment.studyId));

  res.json({ ok: true });
});

// ─── Staff admin endpoints (require staff auth) ───────────────────────────────
export const teleradiologyAdminRouter = Router();

/** GET /api/radiology/teleradiology/users */
teleradiologyAdminRouter.get("/users", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession || !FULL_ACCESS_ROLES.has(sReq.staffSession.role)) {
    res.status(403).json({ error: "Admin only" }); return;
  }
  const rows = await db.select().from(teleradiologyUsersTable).orderBy(teleradiologyUsersTable.name);
  res.json(rows.map(({ pinHash: _, ...u }) => u));
});

/** POST /api/radiology/teleradiology/users — create teleradiologist */
teleradiologyAdminRouter.post("/users", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession || !FULL_ACCESS_ROLES.has(sReq.staffSession.role)) {
    res.status(403).json({ error: "Admin only" }); return;
  }
  const { name, email, pin, role = "TELERADIOLOGIST", specialty, qualifications, phone, canDoFinalReport = false, canUseAI = false } =
    req.body as {
      name: string; email: string; pin: string;
      role?: string; specialty?: string; qualifications?: string; phone?: string;
      canDoFinalReport?: boolean; canUseAI?: boolean;
    };
  if (!name || !email || !pin) { res.status(400).json({ error: "name, email and pin are required" }); return; }
  const pinHash = await bcrypt.hash(pin, 10);
  const [user] = await db.insert(teleradiologyUsersTable).values({
    name, email: email.trim().toLowerCase(),
    pinHash, role, specialty: specialty ?? null, qualifications: qualifications ?? null,
    phone: phone ?? null, canDoFinalReport, canUseAI,
    createdBy: sReq.staffSession.subjectName,
  }).returning();
  if (!user) { res.status(500).json({ error: "Insert failed" }); return; }
  const { pinHash: _, ...safeUser } = user;
  res.status(201).json(safeUser);
});

/** POST /api/radiology/studies/:studyId/assign */
teleradiologyAdminRouter.post("/studies/:studyId/assign", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const studyId = Number(req.params["studyId"]);
  const { teleradiologistId, priority = "ROUTINE", deadline, comments } =
    req.body as { teleradiologistId: number; priority?: string; deadline?: string; comments?: string };

  if (!teleradiologistId) { res.status(400).json({ error: "teleradiologistId required" }); return; }

  const [existing] = await db.select().from(teleradiologyAssignmentsTable)
    .where(and(eq(teleradiologyAssignmentsTable.studyId, studyId), eq(teleradiologyAssignmentsTable.teleradiologistId, teleradiologistId)));
  if (existing) { res.status(409).json({ error: "Already assigned to this radiologist" }); return; }

  const [row] = await db.insert(teleradiologyAssignmentsTable).values({
    studyId, teleradiologistId, priority,
    assignedBy: sReq.staffSession.subjectName,
    deadline: deadline ? new Date(deadline) : null,
    comments: comments ?? null,
  }).returning();

  // Update study fields
  const [teleUser] = await db.select({ name: teleradiologyUsersTable.name })
    .from(teleradiologyUsersTable).where(eq(teleradiologyUsersTable.id, teleradiologistId));
  if (teleUser) {
    await db.update(radiologyStudiesTable).set({
      assignedRadiologistId: teleradiologistId,
      assignedRadiologistName: teleUser.name,
      claimedAt: new Date(),
    }).where(eq(radiologyStudiesTable.id, studyId));
  }

  res.status(201).json(row);
});

/** DELETE /api/radiology/teleradiology/assignments/:id */
teleradiologyAdminRouter.delete("/assignments/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  await db.update(teleradiologyAssignmentsTable).set({
    status: "assigned",
    unassignedAt: new Date(),
    unassignedBy: sReq.staffSession.subjectName,
  }).where(eq(teleradiologyAssignmentsTable.id, id));
  res.json({ ok: true });
});

/** GET /api/radiology/teleradiology/assignments */
teleradiologyAdminRouter.get("/assignments", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db.select({
    id: teleradiologyAssignmentsTable.id,
    studyId: teleradiologyAssignmentsTable.studyId,
    priority: teleradiologyAssignmentsTable.priority,
    status: teleradiologyAssignmentsTable.status,
    isCritical: teleradiologyAssignmentsTable.isCritical,
    deadline: teleradiologyAssignmentsTable.deadline,
    assignedAt: teleradiologyAssignmentsTable.assignedAt,
    radiologistName: teleradiologyUsersTable.name,
    accessionNumber: radiologyStudiesTable.accessionNumber,
    modality: radiologyStudiesTable.modality,
    patientFirstName: patientsTable.firstName,
    patientLastName: patientsTable.lastName,
  })
    .from(teleradiologyAssignmentsTable)
    .innerJoin(teleradiologyUsersTable, eq(teleradiologyUsersTable.id, teleradiologyAssignmentsTable.teleradiologistId))
    .innerJoin(radiologyStudiesTable, eq(radiologyStudiesTable.id, teleradiologyAssignmentsTable.studyId))
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .orderBy(desc(teleradiologyAssignmentsTable.assignedAt))
    .limit(200);

  res.json(rows);
});
