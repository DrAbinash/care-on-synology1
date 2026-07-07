/**
 * ============================================================================
 *  Boundary API — ERP side
 * ============================================================================
 *  Exposes a minimal, stable HTTP contract for the standalone Radiology
 *  Service to read study/patient data and push finalized reports back.
 *
 *  Auth: a shared API key in the `X-Boundary-Key` header (BOUNDARY_API_KEY
 *  env var). This is NOT a staff session token — it's a server-to-server
 *  secret. The radiology service is the only consumer.
 *
 *  SSO: the radiology service verifies its SSO tokens against
 *  POST /api/boundary/auth/verify, which checks the ERP's portal_sessions
 *  table. The ERP nav links to the radiology service with ?sso=<token>,
 *  where <token> is a valid staff portal session token.
 *
 *  This route file is ADDITIVE — it does not modify any existing ERP
 *  route, table, or flow. Billing, accounting, and all existing
 *  radiology endpoints are untouched.
 * ============================================================================
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  radiologyStudiesTable,
  radiologyFilmIssuesTable,
  patientsTable,
  radiologyStudyTabsTable,
  radiologyQuickFindingsTable,
  radiologyProtocolsTable,
  radiologyQuickMeasurementsTable,
  ordersTable,
  orderTestsTable,
  billsTable,
  portalSessionsTable,
  usersTable,
  clinicSettingsTable,
} from "@workspace/db/schema";
import { and, eq, gt, inArray } from "drizzle-orm";

const router = Router();

// ── API key auth middleware ──────────────────────────────────────────────────
const BOUNDARY_KEY = process.env.BOUNDARY_API_KEY;

if (!BOUNDARY_KEY && process.env.NODE_ENV === "production") {
  console.warn(
    "[boundary] BOUNDARY_API_KEY not set — the radiology service will not be able to connect.",
  );
}

function requireBoundaryKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-boundary-key"];
  if (!BOUNDARY_KEY) {
    res.status(503).json({ error: "Boundary API not configured on the ERP" });
    return;
  }
  if (key !== BOUNDARY_KEY) {
    res.status(401).json({ error: "Invalid boundary API key" });
    return;
  }
  next();
}

// All boundary routes require the API key.
router.use(requireBoundaryKey);

// ── SSO: verify a staff portal session token ────────────────────────────────
// The radiology service calls this to confirm the ?sso=<token> it received
// is a real, non-expired ERP staff session. Returns the user's identity +
// permissions so the radiology service can mirror the ERP's access model.
router.post("/auth/verify", async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token) {
    res.status(400).json({ valid: false });
    return;
  }

  const [session] = await db
    .select()
    .from(portalSessionsTable)
    .where(
      and(
        eq(portalSessionsTable.token, token),
        eq(portalSessionsTable.scope, "staff"),
        gt(portalSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    res.json({ valid: false });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      permissions: usersTable.permissions,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.subjectId))
    .limit(1);

  if (!user || !user.isActive) {
    res.json({ valid: false });
    return;
  }

  let permissions: string[] = [];
  try {
    if (user.permissions) {
      const parsed = JSON.parse(user.permissions);
      if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === "string");
    }
  } catch {
    /* leave empty */
  }

  // Resolve display name from clinic settings or subject name
  const [name] = await db
    .select({ name: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, session.subjectId))
    .limit(1);

  res.json({
    valid: true,
    user: {
      id: user.id,
      name: session.subjectName || name?.name || "Unknown",
      role: (user.role ?? "").toLowerCase().replace(/[^a-z0-9]/g, "_"),
      permissions,
    },
  });
});

// ── Worklist: studies ready for reporting ────────────────────────────────────
// GET /api/boundary/studies?modality=MR,CT&status=acquired
router.get("/studies", async (req, res) => {
  const modalityParam = (req.query.modality as string) || "";
  const statusParam = (req.query.status as string) || "acquired";

  const modalities = modalityParam
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  const statuses = statusParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Build the query
  let query = db.select().from(radiologyStudiesTable);
  const conditions = [];
  if (statuses.length > 0) {
    conditions.push(inArray(radiologyStudiesTable.status, statuses));
  }
  if (modalities.length > 0) {
    conditions.push(inArray(radiologyStudiesTable.modality, modalities));
  }

  const rows = conditions.length
    ? await db
        .select()
        .from(radiologyStudiesTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    : await db.select().from(radiologyStudiesTable);

  // Enrich with patient names + bill status
  const studies = await Promise.all(
    rows.map(async (s: typeof radiologyStudiesTable.$inferSelect) => {
      const [patient] = await db
        .select({
          firstName: patientsTable.firstName,
          lastName: patientsTable.lastName,
          ageValue: patientsTable.ageValue,
          ageUnit: patientsTable.ageUnit,
          gender: patientsTable.gender,
        })
        .from(patientsTable)
        .where(eq(patientsTable.id, s.patientId))
        .limit(1);

      let billStatus: string | null = null;
      if (s.billId) {
        const [bill] = await db
          .select({ status: billsTable.status })
          .from(billsTable)
          .where(eq(billsTable.id, s.billId))
          .limit(1);
        billStatus = bill?.status ?? null;
      }

      const age =
        patient?.ageValue != null
          ? `${patient.ageValue} ${patient.ageUnit ?? "y"}`
          : null;

      return {
        id: s.id,
        accessionNumber: s.accessionNumber,
        patientId: s.patientId,
        patientName: patient
          ? `${patient.firstName} ${patient.lastName}`
          : "Unknown",
        age,
        sex: patient?.gender ?? null,
        modality: s.modality,
        studyDescription: s.studyDescription,
        bodyPart: s.bodyPart,
        studyDate: s.studyDate ? s.studyDate.toISOString() : null,
        referringDoctor: s.referringDoctor,
        clinicalHistory: s.clinicalHistory,
        status: s.status,
        priority: s.priority,
        assignedRadiologistId: s.assignedRadiologistId,
        assignedRadiologistName: s.assignedRadiologistName,
        studyInstanceUid: s.studyInstanceUid,
        weasisUrl: null, // filled by PACS settings if configured
        ohifUrl: null, // filled by PACS settings if configured
        billStatus,
      };
    }),
  );

  // Sort: priority (stat first) then date (newest first)
  const priorityOrder: Record<string, number> = {
    stat: 0, emergency: 0, urgent: 1, vip: 1, routine: 2,
  };
  (studies as Array<{ priority: string; studyDate: string | null }>).sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return (b.studyDate ?? "").localeCompare(a.studyDate ?? "");
  });

  res.json({ studies });
});

// ── Study detail: study + patient + order context ───────────────────────────
// GET /api/boundary/studies/:accession
router.get("/studies/:accession", async (req, res) => {
  const { accession } = req.params;
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.accessionNumber, accession))
    .limit(1);

  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, study.patientId))
    .limit(1);

  res.json({
    study: {
      id: study.id,
      accessionNumber: study.accessionNumber,
      patientId: study.patientId,
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
      age:
        patient?.ageValue != null
          ? `${patient.ageValue} ${patient.ageUnit ?? "y"}`
          : null,
      sex: patient?.gender ?? null,
      modality: study.modality,
      studyDescription: study.studyDescription,
      bodyPart: study.bodyPart,
      studyDate: study.studyDate ? study.studyDate.toISOString() : null,
      referringDoctor: study.referringDoctor,
      clinicalHistory: study.clinicalHistory,
      status: study.status,
      priority: study.priority,
      assignedRadiologistId: study.assignedRadiologistId,
      assignedRadiologistName: study.assignedRadiologistName,
      studyInstanceUid: study.studyInstanceUid,
      weasisUrl: null,
      ohifUrl: null,
      billStatus: null,
    },
    patient: patient
      ? {
          id: patient.id,
          patientId: patient.patientId,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          phone: patient.phone,
          ageValue: patient.ageValue,
          ageUnit: patient.ageUnit,
        }
      : null,
  });
});

// ── Report callback: push finalized report text ─────────────────────────────
// POST /api/boundary/studies/:accession/report
// The radiology service calls this when a report is finalized. The ERP
// stores the text exactly as it would if a radiologist had typed it
// directly — so the existing print, delivery, and patient-portal flows
// work unchanged.
router.post("/studies/:accession/report", async (req, res) => {
  const { accession } = req.params;
  const { status, finalReportText, reportedBy, reportedAt } = req.body ?? {};

  if (typeof finalReportText !== "string" || !finalReportText.trim()) {
    res.status(400).json({ error: "finalReportText is required" });
    return;
  }

  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.accessionNumber, accession))
    .limit(1);

  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  await db
    .update(radiologyStudiesTable)
    .set({
      finalReport: finalReportText,
      finalReportedBy: typeof reportedBy === "string" ? reportedBy : null,
      finalReportedAt: reportedAt ? new Date(reportedAt) : new Date(),
      status: status === "reported_final" ? "reported_final" : study.status,
      updatedAt: new Date(),
    })
    .where(eq(radiologyStudiesTable.id, study.id));

  res.json({ ok: true });
});

// ── Status callback: update study status ────────────────────────────────────
// POST /api/boundary/studies/:accession/status
// Called when a radiologist opens a study (→ in_progress).
router.post("/studies/:accession/status", async (req, res) => {
  const { accession } = req.params;
  const { status } = req.body ?? {};

  const validStatuses = ["in_progress", "reported_preliminary", "reported_final", "delivered"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.accessionNumber, accession))
    .limit(1);

  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "in_progress" && !study.startedAt) {
    update.startedAt = new Date();
  }

  await db.update(radiologyStudiesTable).set(update).where(eq(radiologyStudiesTable.id, study.id));
  res.json({ ok: true });
});

// ── Delivery callback: mark study as delivered + log film/CD/print issuance ─
// POST /api/boundary/studies/:accession/deliver
// Called after the report is printed and handed to the patient. Records the
// physical artifact issuance in radiology_film_issues and updates the study
// status to "delivered", so the ERP's delivery tracking stays in sync.
router.post("/studies/:accession/deliver", async (req, res) => {
  const accession = String(req.params.accession);
  const { issueType = "print", quantity = 1, issuedBy } = req.body ?? {};

  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.accessionNumber, accession))
    .limit(1);

  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  // Log the physical artifact issuance
  await db.insert(radiologyFilmIssuesTable).values({
    studyId: study.id,
    issueType: typeof issueType === "string" ? issueType : "print",
    quantity: Number(quantity) || 1,
    issuedBy: typeof issuedBy === "string" ? issuedBy : null,
    issuedAt: new Date(),
  });

  // Mark the study as delivered
  await db
    .update(radiologyStudiesTable)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(radiologyStudiesTable.id, study.id));

  res.json({ ok: true });
});
// GET /api/boundary/seed/reporting-content
//   Returns all study tabs + quick findings + protocols + measurements from
//   the ERP, so the radiology service can seed its own DB on first setup.
//   Read-only. The radiology service upserts these into its own tables.
router.get("/seed/reporting-content", async (_req, res) => {
  const [tabs, findings, protocols, measurements] = await Promise.all([
    db.select().from(radiologyStudyTabsTable),
    db.select().from(radiologyQuickFindingsTable),
    db.select().from(radiologyProtocolsTable),
    db.select().from(radiologyQuickMeasurementsTable),
  ]);

  type Tab = typeof radiologyStudyTabsTable.$inferSelect;
  type Finding = typeof radiologyQuickFindingsTable.$inferSelect;
  type Protocol = typeof radiologyProtocolsTable.$inferSelect;
  type Measurement = typeof radiologyQuickMeasurementsTable.$inferSelect;

  res.json({
    tabs: tabs.map((t: Tab) => ({
      name: t.name,
      sortOrder: t.sortOrder,
      isActive: t.isActive,
      modality: "MRI", // ERP tabs don't have a modality column; default MRI
      techniqueText: t.techniqueText ?? "",
      normalText: t.normalText ?? "",
    })),
    findings: findings.map((f: Finding) => ({
      studyType: f.studyType,
      label: f.label,
      findingText: f.findingText ?? "",
      impressionText: f.impressionText ?? "",
      techniqueText: f.techniqueText ?? "",
      recommendationText: f.recommendationText ?? "",
      tags: f.tags ?? "",
      suggests: f.suggests ?? "",
      properties: f.properties ?? "",
      category: f.category ?? null,
      sortOrder: f.sortOrder,
      isActive: f.isActive,
    })),
    protocols: protocols.map((p: Protocol) => ({
      name: p.name,
      studyType: p.studyType,
      region: p.studyType, // alias
      modality: p.modality || "MRI",
      checklistJson: p.checklistJson ?? "[]",
      techniqueText: p.techniqueText ?? "",
      normalText: p.normalText ?? "",
      recommendationText: p.recommendationText ?? "",
      requiredMeasurements: p.requiredMeasurements ?? "",
      isGoldStandard: p.isGoldStandard,
      sortOrder: p.sortOrder,
      isActive: p.isActive,
    })),
    measurements: measurements.map((m: Measurement) => ({
      studyType: m.studyType,
      label: m.label,
      templateText: m.templateText ?? "",
      unit: m.unit ?? "",
      sortOrder: m.sortOrder,
      isActive: m.isActive,
    })),
  });
});

export default router;
