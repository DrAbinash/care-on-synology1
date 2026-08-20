/**
 * Internal Radiology RIS/PACS API
 *
 * These endpoints are NOT protected by staff session auth. Instead they use a
 * bearer token matching the INTERNAL_API_KEY environment secret — suitable for
 * server-to-server calls from Conquest PACS automation scripts.
 *
 * Mounted at: /api/internal  (see routes/index.ts)
 *
 * Endpoints:
 *   GET  /api/internal/patients/:patientId/contact
 *   POST /api/internal/radiology/studies        — study intake (upsert)
 *   POST /api/internal/radiology/report-status  — update worklist status
 *   POST /api/internal/radiology/ai-draft       — generate/return AI report draft
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  patientsTable,
  radiologyStudiesTable,
  radiologyWorklistTable,
  radiologyAuditLogTable,
  dicomNodesTable,
  dicomPullJobsTable,
  pacsLogsTable,
  dicomPullAgentLogsTable,
  dicomPullAgentStatusTable,
  pacsSettingsTable,
  radiologyScheduledProceduresTable,
  testsTable,
  billsTable,
  portalSessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, or, sql, inArray, gte, lte, desc, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { checkWriteLock } from "../lib/studyLocks";
import { todayIST } from "../lib/istDate";
import { createOrLinkPatientFromDicom, type DicomDemographics } from "../lib/dicomPatientCreator";
import { computeStudyPriority, applyPriorityToStudy } from "../lib/studyPriorityEngine";
import { assignRadiologistToStudy } from "../lib/radiologistAssignment";
import { runUsgExtraction, getUsgAdminSettings } from "../lib/usgExtractor";
import { isUltrasoundModality, isObstetricUsgStudy } from "../lib/usgModality";
import { checkPcpndtFormFCompliance, PCPNDT_OVERRIDE_ROLES } from "../lib/pcpndtCompliance";
import { auditLog } from "../lib/audit";
import { genderToDicomSex, sanitizeDicomSex } from "@workspace/pathology";
import { calculateMatchScore, normalizeAccessionKey, type DicomInput, type BilledTestInput } from "../lib/pacs/matchingEngine";
import { formatDicomPersonNameForDisplay, reconcileAccessionVsReferringDoctor } from "../lib/pacs/dicomNameNormalize";
import { shouldFallbackToAccessionLookup, isWorklistUidRaceViolation } from "../lib/radiologyWorklistDedup";
import { radiologyOpenFallbackPath, resolveRadiologyOpen } from "../lib/resolveRadiologyOpen";
import { runDicomIntakeAutomation } from "../lib/pacs/dicomIntakeAutomation";
import { cancelRadiologyMwlByAccession } from "../lib/pacs/cancelRadiologyStudyFromMwl";

export async function runMatchingEngineForWorklist(worklistId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);

  if (!row) return;

  if (!row.studyId) {
    await db
      .update(radiologyWorklistTable)
      .set({
        matchScore: "RED",
        matchPoints: 0,
        matchReasons: JSON.stringify(["No study linked to this worklist item"]),
        matchWarnings: JSON.stringify(["NO_LINKED_STUDY: No billed study linked"]),
      })
      .where(eq(radiologyWorklistTable.id, worklistId));
    return;
  }

  const [study] = await db
    .select({
      id: radiologyStudiesTable.id,
      patientId: radiologyStudiesTable.patientId,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
      studyDate: radiologyStudiesTable.studyDate,
      referringDoctor: radiologyStudiesTable.referringDoctor,
      patientName: sql<string>`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
      patientUHID: patientsTable.patientId,
      age: sql<string>`concat(${patientsTable.ageValue}, ' ', ${patientsTable.ageUnit})`,
      sex: patientsTable.gender,
      testName: testsTable.name,
      billNumber: billsTable.billNumber,
    })
    .from(radiologyStudiesTable)
    .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
    .where(eq(radiologyStudiesTable.id, row.studyId))
    .limit(1);

  if (!study) {
    await db
      .update(radiologyWorklistTable)
      .set({
        matchScore: "RED",
        matchPoints: 0,
        matchReasons: JSON.stringify(["Linked study not found in database"]),
        matchWarnings: JSON.stringify(["STUDY_NOT_FOUND: Billed study not found"]),
      })
      .where(eq(radiologyWorklistTable.id, worklistId));
    return;
  }

  const dicomInput: DicomInput = {
    patientName: row.patientName,
    dicomPatientId: row.dicomPatientId,
    age: row.age,
    sex: row.sex,
    modality: row.modality,
    studyDescription: row.studyDescription,
    accessionNumber: row.accessionNumber ?? "",
    studyDate: row.studyDate,
    studyTime: null,
    studyInstanceUID: row.studyInstanceUID,
    referringDoctor: row.referringDoctor,
  };

  const billInput: BilledTestInput = {
    id: study.id,
    patientId: study.patientId,
    patientName: String(study.patientName || ""),
    patientUHID: study.patientUHID,
    age: study.age,
    sex: study.sex,
    testName: study.testName,
    modality: study.modality,
    accessionNumber: study.accessionNumber,
    billNumber: study.billNumber,
    studyDate: study.studyDate,
    referringDoctor: study.referringDoctor,
  };

  const matchResult = calculateMatchScore(dicomInput, billInput);

  if (row.studyInstanceUID) {
    const dupStudies = await db
      .select({ id: radiologyWorklistTable.id, studyId: radiologyWorklistTable.studyId })
      .from(radiologyWorklistTable)
      .where(
        and(
          eq(radiologyWorklistTable.studyInstanceUID, row.studyInstanceUID),
          sql`${radiologyWorklistTable.id} != ${worklistId}`
        )
      );

    if (dupStudies.length > 0) {
      matchResult.warnings.push("DUPLICATE_UID: Duplicate StudyInstanceUID across multiple worklist records");
      const hasOtherStudyId = dupStudies.some(d => d.studyId && d.studyId !== row.studyId);
      if (hasOtherStudyId) {
        matchResult.warnings.push("STUDY_REUSED: Same DICOM study linked to multiple bills");
      }
      matchResult.score = "RED";
    }
  }

  if (row.studyId) {
    const multiStudies = await db
      .select({ id: radiologyWorklistTable.id, studyInstanceUID: radiologyWorklistTable.studyInstanceUID })
      .from(radiologyWorklistTable)
      .where(
        and(
          eq(radiologyWorklistTable.studyId, row.studyId),
          sql`${radiologyWorklistTable.id} != ${worklistId}`
        )
      );
    if (multiStudies.length > 0 && multiStudies.some(m => m.studyInstanceUID !== row.studyInstanceUID)) {
      matchResult.warnings.push("BILL_LINKED_TO_MULTIPLE_STUDIES: Same bill linked to multiple unrelated DICOM studies");
      matchResult.score = "RED";
    }
  }

  await db
    .update(radiologyWorklistTable)
    .set({
      matchScore: matchResult.score,
      matchPoints: matchResult.points,
      matchReasons: JSON.stringify(matchResult.reasons),
      matchWarnings: JSON.stringify(matchResult.warnings),
    })
    .where(eq(radiologyWorklistTable.id, worklistId));
}

const router = Router();

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Enforces INTERNAL_API_KEY authentication.
 * Used for all PACS automation endpoints (Conquest scripts, pull-agents, etc.).
 * These endpoints must never be callable from a browser staff session.
 */
function requireInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["INTERNAL_API_KEY"];
  if (!expected) {
    if (process.env["NODE_ENV"] === "production") {
      // In production the key MUST be set. Fail closed to prevent accidental
      // exposure of internal endpoints on a misconfigured deployment.
      logger.error("INTERNAL_API_KEY is not set in production — internal radiology endpoints are disabled");
      res.status(503).json({
        error: "Service unavailable: INTERNAL_API_KEY is not configured. Set this secret before using internal radiology endpoints.",
      });
      return;
    }
    // Development / staging: allow without key but log loudly.
    logger.warn("INTERNAL_API_KEY not set — internal radiology endpoints are unprotected (non-production only)");
    next();
    return;
  }
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Accepts EITHER a valid INTERNAL_API_KEY bearer token OR a valid staff JWT.
 *
 * This middleware is ONLY applied to the three endpoints the Radiologist
 * Cockpit calls directly from the browser (worklist detail, report-status,
 * ai-draft). All other PACS automation endpoints remain protected by
 * requireInternalApiKey exclusively.
 *
 * Security notes:
 * - INTERNAL_API_KEY path: same as before (server-to-server automation)
 * - Staff JWT path: validates token against portal_sessions table, checks
 *   user is active. Rejects inactive/expired sessions with 401.
 * - No permissions are weakened — staff members still need requireStaffPermission
 *   on any radiology module to have received a session in the first place.
 */
async function requireStaffOrInternalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!provided) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // 1. Try INTERNAL_API_KEY first (fast — no DB query needed)
  const expectedKey = process.env["INTERNAL_API_KEY"];
  if (expectedKey && provided === expectedKey) {
    next();
    return;
  }

  // 2. Try staff JWT session validation
  try {
    const [session] = await db
      .select()
      .from(portalSessionsTable)
      .where(
        and(
          eq(portalSessionsTable.token, provided),
          eq(portalSessionsTable.scope, "staff"),
          gt(portalSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(401).json({ error: "Invalid or expired session. Please log in again." });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id, isActive: usersTable.isActive, role: usersTable.role, permissions: usersTable.permissions })
      .from(usersTable)
      .where(eq(usersTable.id, session.subjectId))
      .limit(1);

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Staff account is inactive." });
      return;
    }

    // Touch last activity to keep the session alive
    await db
      .update(portalSessionsTable)
      .set({ lastActivityAt: new Date() })
      .where(eq(portalSessionsTable.id, session.id));

    // M1.6A — attach the validated staff identity (same shape/parsing as
    // requireStaffAuth) so handlers can enforce study-lock ownership. The
    // INTERNAL_API_KEY path above deliberately attaches nothing: server-to-
    // server automation is identity-less and never lock-gated.
    let permissions: string[] = [];
    try {
      const parsed = user.permissions ? JSON.parse(user.permissions) : [];
      if (Array.isArray(parsed)) permissions = parsed.filter((p): p is string => typeof p === "string");
    } catch { /* leave permissions empty */ }
    (req as StaffAuthRequest).staffSession = {
      id: session.id,
      subjectId: session.subjectId,
      subjectName: session.subjectName,
      role: normalizeRole(user.role),
      permissions,
      maxDiscount: null,
    };

    next();
  } catch (err) {
    logger.error({ err }, "requireStaffOrInternalAuth: DB error during staff JWT validation");
    res.status(500).json({ error: "Authentication service error" });
  }
}

router.use(requireStaffOrInternalAuth);


// ── Audit helper ─────────────────────────────────────────────────────────────

async function audit(opts: {
  worklistId?: number | null;
  accessionNumber?: string | null;
  action: string;
  actor?: string;
  details?: unknown;
}): Promise<void> {
  try {
    await db.insert(radiologyAuditLogTable).values({
      worklistId: opts.worklistId ?? null,
      accessionNumber: opts.accessionNumber ?? null,
      action: opts.action,
      actor: opts.actor ?? "system",
      details: opts.details !== undefined ? JSON.stringify(opts.details) : null,
    });
  } catch (err) {
    logger.error({ err }, "radiology audit log insert failed");
  }
}

// ── Patient contact lookup ────────────────────────────────────────────────────
// GET /api/internal/patients/:patientId/contact
// Accepts numeric DB id OR text UHID (patient_id field).

router.get("/patients/:patientId/contact", async (req, res) => {
  const param = req.params.patientId;
  const numericId = Number(param);

  const cond = Number.isInteger(numericId) && numericId > 0
    ? or(eq(patientsTable.id, numericId), eq(patientsTable.patientId, param))
    : eq(patientsTable.patientId, param);

  const [patient] = await db
    .select({
      id: patientsTable.id,
      patientId: patientsTable.patientId,
      firstName: patientsTable.firstName,
      lastName: patientsTable.lastName,
      dateOfBirth: patientsTable.dateOfBirth,
      gender: patientsTable.gender,
      phone: patientsTable.phone,
      email: patientsTable.email,
    })
    .from(patientsTable)
    .where(cond!);

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // Compute age from dateOfBirth (stored as ISO date string YYYY-MM-DD)
  let age = "";
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
      age = `${years}Y`;
    }
  }

  res.json({
    patientId: patient.patientId,
    dbId: patient.id,
    name: `${patient.firstName} ${patient.lastName}`.trim(),
    age,
    sex: patient.gender ?? "",
    mobile: patient.phone ?? "",
    email: patient.email ?? "",
  });
});

// ── Study intake (upsert) ─────────────────────────────────────────────────────
// POST /api/internal/radiology/studies
// Creates or updates a worklist entry. Deduplication via studyInstanceUID first,
// then accessionNumber.

router.post("/radiology/studies", async (req, res) => {
  const rawBody = req.body ?? {};
  logger.info({ body: rawBody }, "POST /api/internal/radiology/studies payload");

  try {
    const b = rawBody as Record<string, unknown>;

    const rawStudyId = b.studyId;
    const patientId = (b.patientId !== undefined ? String(b.patientId) : "") || (b.PatientID !== undefined ? String(b.PatientID) : "");
    // Clean DICOM PN syntax (LAST^FIRST^^^MD → "First Last, MD") so worklist
    // display and the billing match engine see the same readable form.
    const patientNameRaw = typeof b.patientName === "string" ? b.patientName.trim() : (typeof b.PatientName === "string" ? b.PatientName.trim() : "");
    const patientName = formatDicomPersonNameForDisplay(patientNameRaw) || patientNameRaw;
    const age = typeof b.age === "string" ? b.age.trim() || null : null;
    const sexRaw =
      (typeof b.sex === "string" ? b.sex.trim() : "")
      || (typeof b.patientSex === "string" ? b.patientSex.trim() : "")
      || (typeof b.PatientSex === "string" ? b.PatientSex.trim() : "");
    const sex = sexRaw ? sanitizeDicomSex(sexRaw) : null;
    const modality = typeof b.modality === "string" ? b.modality.trim() || "OT" : (typeof b.ModalitiesInStudy === "string" ? b.ModalitiesInStudy.trim() || "OT" : "OT");
    const studyDescription = typeof b.studyDescription === "string" ? b.studyDescription.trim() || null : (typeof b.StudyDescription === "string" ? b.StudyDescription.trim() || null : null);
    const studyDate = typeof b.studyDate === "string" ? b.studyDate.trim() || null : (typeof b.StudyDate === "string" ? b.StudyDate.trim() || null : null);
    const accessionNumberRaw = typeof b.accessionNumber === "string" ? b.accessionNumber.trim() : (typeof b.AccessionNumber === "string" ? b.AccessionNumber.trim() : "");
    const referringDoctorRaw = typeof b.referringDoctor === "string" ? b.referringDoctor.trim() || null : null;
    const referringFromTag = referringDoctorRaw
      ? (formatDicomPersonNameForDisplay(referringDoctorRaw) || referringDoctorRaw)
      : null;
    // MRI / billing sometimes type the referring doctor into Accession Number.
    const reconciledIds = reconcileAccessionVsReferringDoctor({
      accessionNumber: accessionNumberRaw,
      referringDoctor: referringFromTag,
    });
    const accessionNumber: string | null = reconciledIds.accessionNumber || null;
    const referringDoctor: string | null = reconciledIds.referringDoctor || null;
    const studyInstanceUID = typeof b.studyInstanceUID === "string" ? b.studyInstanceUID.trim() || null : (typeof b.StudyInstanceUID === "string" ? b.StudyInstanceUID.trim() || null : null);
    const aeTitle = typeof b.aeTitle === "string" ? b.aeTitle.trim() || null : null;
    const ipAddress = typeof b.ipAddress === "string" ? b.ipAddress.trim() || null : null;
    const port = typeof b.port === "number" ? b.port : null;
    const weasisUrl = typeof b.weasisUrl === "string" ? b.weasisUrl.trim() || null : null;
    const sourcePacs = typeof b.sourcePacs === "string" ? b.sourcePacs.trim() || null : null;
    const sourceAeTitle = typeof b.sourceAeTitle === "string" ? b.sourceAeTitle.trim() || null : null;
    const dicomMetadata = typeof b.dicomMetadata === "string" ? b.dicomMetadata.trim() || null : null;

    // At least one real identifier is still required — we can't file a
    // study with neither a UID nor an accession number to reference it by.
    if (!accessionNumber && !studyInstanceUID) {
      logger.warn("Missing both accessionNumber and studyInstanceUID");
      res.status(400).json({ success: false, error: "accessionNumber or studyInstanceUID is required" });
      return;
    }
    if (!patientName) {
      logger.warn("Missing patientName");
      res.status(400).json({ success: false, error: "patientName is required" });
      return;
    }

    let numericStudyId: number | undefined;
    if (typeof rawStudyId === "number") {
      numericStudyId = rawStudyId;
    } else if (typeof rawStudyId === "string" && /^\d+$/.test(rawStudyId.trim())) {
      numericStudyId = parseInt(rawStudyId.trim(), 10);
    }

    let formattedStudyDate = studyDate;
    if (studyDate && /^\d{8}$/.test(studyDate)) {
      formattedStudyDate = `${studyDate.slice(0, 4)}-${studyDate.slice(4, 6)}-${studyDate.slice(6, 8)}`;
    }

    // Patient Resolution
    const rawDicomPatientId = patientId || null;
    let resolvedPatientId: number | null = null;
    let patientMatchStatus = "UNMATCHED";

    if (rawDicomPatientId) {
      const numericId = Number(rawDicomPatientId);
      const matchCond = Number.isInteger(numericId) && numericId > 0
        ? or(eq(patientsTable.id, numericId), eq(patientsTable.patientId, rawDicomPatientId))
        : eq(patientsTable.patientId, rawDicomPatientId);

      const [matched] = await db
        .select({ id: patientsTable.id })
        .from(patientsTable)
        .where(matchCond!)
        .limit(1);

      if (matched) {
        resolvedPatientId = matched.id;
        patientMatchStatus = "MATCHED";
        logger.info({ patientId: resolvedPatientId }, "Matched existing patient");
      }
    }

    if (!resolvedPatientId) {
      try {
        const demo: DicomDemographics = {
          patientId: rawDicomPatientId ?? undefined,
          patientName,
          sex: sex ?? undefined,
          age: age ?? undefined,
          studyDate: studyDate ?? undefined,
          modality,
        };
        const result = await createOrLinkPatientFromDicom(demo);
        resolvedPatientId = result.patient.id;
        patientMatchStatus = result.isNew ? "AUTO_CREATED" : "MATCHED_BY_DEMOGRAPHICS";
        logger.info({ patientId: resolvedPatientId, status: patientMatchStatus }, "Auto-linked patient from DICOM");
      } catch (err) {
        logger.warn({ err }, "Auto-create patient failed");
      }
    }

    // 4-tier fallback matching cascade for radiology_studies
    const studySelectFields = {
      id: radiologyStudiesTable.id,
      status: radiologyStudiesTable.status,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
      modality: radiologyStudiesTable.modality,
      studyDescription: radiologyStudiesTable.studyDescription,
      referringDoctor: radiologyStudiesTable.referringDoctor,
      patientId: radiologyStudiesTable.patientId,
      studyDate: radiologyStudiesTable.studyDate,
      bodyPart: radiologyStudiesTable.bodyPart,
      orderTestId: radiologyStudiesTable.orderTestId,
      billId: radiologyStudiesTable.billId,
      department: radiologyStudiesTable.department,
      startedAt: radiologyStudiesTable.startedAt,
    };

    let rStudy: any = undefined;
    let matchMethod = "";

    // 1. Matched by numeric studyId
    if (numericStudyId) {
      const [row] = await db
        .select(studySelectFields)
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, numericStudyId))
        .limit(1);
      if (row) {
        rStudy = row;
        matchMethod = "matched by numeric studyId";
      }
    }

    // 2. Matched by accessionNumber (alnum-normalized — same key MWL + Match Center use)
    if (!rStudy && accessionNumber) {
      const accKey = normalizeAccessionKey(accessionNumber);
      if (accKey) {
        const [row] = await db
          .select(studySelectFields)
          .from(radiologyStudiesTable)
          .where(
            sql`lower(regexp_replace(coalesce(${radiologyStudiesTable.accessionNumber}, ''), '[^a-zA-Z0-9]', '', 'g')) = ${accKey}`,
          )
          .limit(1);
        if (row) {
          rStudy = row;
          matchMethod = "matched by accessionNumber";
        }
      }
    }

    // 3. Matched by StudyInstanceUID
    if (!rStudy && studyInstanceUID) {
      const [row] = await db
        .select(studySelectFields)
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.studyInstanceUid, studyInstanceUID))
        .limit(1);
      if (row) {
        rStudy = row;
        matchMethod = "matched by StudyInstanceUID";
      }
    }

    // 4. Matched by fallback demographics: patientId + studyDate + modality
    if (!rStudy && resolvedPatientId && formattedStudyDate && modality) {
      const [row] = await db
        .select(studySelectFields)
        .from(radiologyStudiesTable)
        .where(
          and(
            eq(radiologyStudiesTable.patientId, resolvedPatientId),
            eq(radiologyStudiesTable.studyDate, formattedStudyDate),
            sql`lower(${radiologyStudiesTable.modality}) = lower(${modality})`
          )
        )
        .limit(1);
      if (row) {
        rStudy = row;
        matchMethod = "matched by fallback demographics";
      }
    }

    // 5. Last safe fallback: patientName + studyDate + studyDescription
    if (!rStudy && resolvedPatientId && formattedStudyDate && studyDescription) {
      const [row] = await db
        .select(studySelectFields)
        .from(radiologyStudiesTable)
        .where(
          and(
            eq(radiologyStudiesTable.patientId, resolvedPatientId),
            eq(radiologyStudiesTable.studyDate, formattedStudyDate),
            sql`lower(${radiologyStudiesTable.studyDescription}) = lower(${studyDescription})`
          )
        )
        .limit(1);
      if (row) {
        rStudy = row;
        matchMethod = "matched by fallback demographics";
      }
    }

    // Log matching result clearly
    if (rStudy) {
      logger.info({ studyId: rStudy.id, matchMethod }, `PACS study link: ${matchMethod}`);
    } else {
      logger.info("PACS study link: no match found, created PACS-only worklist row");
    }

    let resolvedStudyId: number | null = rStudy ? rStudy.id : null;
    const previousStudyStatus: string | null = rStudy?.status ?? null;

    if (rStudy) {
      const updates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
        updatedAt: new Date(),
        status: "acquired",
        acquiredAt: new Date(),
      };

      if (!rStudy.startedAt && rStudy.status === "scheduled") {
        updates.startedAt = new Date();
      }

      if (studyInstanceUID && !rStudy.studyInstanceUid) {
        updates.studyInstanceUid = studyInstanceUID;
      }
      if (accessionNumber && !rStudy.accessionNumber) {
        updates.accessionNumber = accessionNumber;
      }
      if (modality && (!rStudy.modality || rStudy.modality === "OT")) {
        updates.modality = modality;
      }
      if (studyDescription && !rStudy.studyDescription) {
        updates.studyDescription = studyDescription;
      }
      if (referringDoctor && !rStudy.referringDoctor) {
        updates.referringDoctor = referringDoctor;
      }
      if (typeof b.bodyPart === "string" && b.bodyPart.trim() && !rStudy.bodyPart) {
        updates.bodyPart = b.bodyPart.trim();
      }

      await db
        .update(radiologyStudiesTable)
        .set(updates)
        .where(eq(radiologyStudiesTable.id, rStudy.id));

      await audit({
        accessionNumber: rStudy.accessionNumber || accessionNumber,
        action: "MWL_STATUS_UPDATED",
        actor: "pacs",
        details: { from: rStudy.status, to: "acquired", reason: `pacs study intake: ${matchMethod}` },
      });
    }

    // Worklist deduplication logic.
    //
    // study_instance_uid is the authoritative identifier (DB-enforced
    // unique via radiology_worklist_uid_uq). accession_number is NOT
    // unique — real DICOM data from misconfigured modalities can push the
    // same bogus accession text for genuinely different studies. So the
    // accession-based lookup is only used as a fallback when the incoming
    // study has no studyInstanceUID at all (older/incomplete PACS data);
    // it must never be used to "find" a match for a study that does have
    // a UID, or two unrelated studies sharing a bad accession would get
    // merged into one worklist row and silently overwrite each other.
    let existing: typeof radiologyWorklistTable.$inferSelect | undefined;
    if (studyInstanceUID) {
      const [row] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID))
        .limit(1);
      existing = row;
    } else if (shouldFallbackToAccessionLookup(studyInstanceUID, accessionNumber)) {
      const [row] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.accessionNumber, accessionNumber as string))
        .limit(1);
      existing = row;
    }

    const usgSettings = await getUsgAdminSettings();
    const isVoluson = sourceAeTitle === "Voluson" || (usgSettings.geAeTitle && sourceAeTitle === usgSettings.geAeTitle);
    const sourcePacsVal = isVoluson ? "Voluson Push" : (sourcePacs || "pacs");

    const values = {
      studyId: resolvedStudyId,
      patientId: resolvedPatientId,
      dicomPatientId: rawDicomPatientId,
      patientMatchStatus,
      patientName,
      age,
      sex,
      modality,
      studyDescription,
      studyDate,
      accessionNumber,
      studyInstanceUID,
      aeTitle,
      ipAddress,
      port,
      referringDoctor,
      weasisUrl,
      sourcePacs: sourcePacsVal,
      sourceAeTitle,
      dicomMetadata,
    };

    let row: typeof radiologyWorklistTable.$inferSelect;

    if (existing) {
      const [updated] = await db
        .update(radiologyWorklistTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(radiologyWorklistTable.id, existing.id))
        .returning();
      row = updated;
      logger.info({ worklistId: row.id, event: "updated" }, "Worklist entry updated");
      await audit({
        worklistId: row.id,
        accessionNumber,
        action: "STUDY_RECEIVED",
        actor: "pacs",
        details: { event: "updated", modality, studyDescription, sourcePacs, sourceAeTitle },
      });
    } else {
      try {
        const [inserted] = await db
          .insert(radiologyWorklistTable)
          .values({ ...values, status: "STUDY_RECEIVED" })
          .returning();
        row = inserted;
        logger.info({ worklistId: row.id, event: "created" }, "Worklist entry created");
        await audit({
          worklistId: row.id,
          accessionNumber,
          action: "STUDY_RECEIVED",
          actor: "pacs",
          details: { event: "created", modality, studyDescription, sourcePacs, sourceAeTitle },
        });
      } catch (insertErr: any) {
        // Race condition: two concurrent pushes for the same
        // studyInstanceUID both missed the SELECT above and both tried to
        // INSERT. Postgres's radiology_worklist_uid_uq index rejects the
        // loser with a 23505 — treat that as "someone else just created
        // it", re-fetch, and update instead of returning a 500. This is
        // the update-on-conflict behavior for repeated StudyInstanceUID.
        if (!isWorklistUidRaceViolation(insertErr, studyInstanceUID)) throw insertErr;

        logger.warn({ studyInstanceUID }, "Worklist insert race on studyInstanceUID — retrying as update");
        const [race] = await db
          .select()
          .from(radiologyWorklistTable)
          .where(eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID as string))
          .limit(1);
        if (!race) throw insertErr; // shouldn't happen, but don't swallow a real error

        const [updated] = await db
          .update(radiologyWorklistTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(radiologyWorklistTable.id, race.id))
          .returning();
        row = updated;
        logger.info({ worklistId: row.id, event: "updated-after-race" }, "Worklist entry updated (race retry)");
        await audit({
          worklistId: row.id,
          accessionNumber,
          action: "STUDY_RECEIVED",
          actor: "pacs",
          details: { event: "updated-after-race", modality, studyDescription, sourcePacs, sourceAeTitle },
        });
      }
    }

    if (row.studyId) {
      try {
        const priorityResult = await computeStudyPriority({
          modality,
          bodyPart: null,
          studyDescription,
          referringDoctor,
        });
        await applyPriorityToStudy(row.studyId, priorityResult.priority, priorityResult.reason);
        await assignRadiologistToStudy(row.studyId, {
          modality,
          bodyPart: null,
          studyId: row.studyId,
        });
        logger.info({ studyId: row.studyId }, "Auto-priority + assignment applied");
      } catch (err) {
        logger.warn({ err, studyId: row.studyId }, "Auto-priority/assignment failed");
      }
    }

    // Auto-trigger USG measurement extraction for ultrasound modality
    // studies. R2.0: was an exact `=== "US"` check — a PACS source sending
    // "USG"/"Doppler"/"OB US" etc. (anything RadiologyWorklist.tsx and
    // RadiologyReportingWorkspace.tsx now recognize via isUltrasoundModality)
    // never triggered auto-extraction, so those studies sat with no
    // measurements until someone manually clicked "Extract".
    // Fire-and-forget: never blocks the intake response.
    if (isUltrasoundModality(modality) && studyInstanceUID && (await getUsgAdminSettings()).pipelineEnabled !== false) {
      runUsgExtraction({
        worklistId: row.id,
        studyId: row.studyId ?? undefined,
        studyInstanceUID,
        accessionNumber: accessionNumber ?? undefined,
        patientId: row.patientId ?? undefined,
        dicomMetadataJson: dicomMetadata ?? undefined,
        triggeredBy: "auto",
      }).catch((err: unknown) => {
        logger.warn({ err, worklistId: row.id }, "USG auto-extraction failed silently");
      });
    }

    // Run matching engine to compute and store match score / warnings
    try {
      await runMatchingEngineForWorklist(row.id);
    } catch (matchErr) {
      logger.error({ err: matchErr, worklistId: row.id }, "Intake matching engine execution failed");
    }

    // Wire Orthanc arrival → queue token done + MWL cleanup + live UI refresh
    if (rStudy) {
      runDicomIntakeAutomation({
        worklistId: row.id,
        accessionNumber: rStudy.accessionNumber || accessionNumber,
        orderTestId: rStudy.orderTestId,
        billId: rStudy.billId,
        department: rStudy.department,
        previousStudyStatus,
      }).catch((err: unknown) => {
        logger.warn({ err, worklistId: row.id }, "dicom-intake automation failed silently");
      });
    }

    // DICOM → Ollama draft: enqueue per Settings → Radiology → AI (on arrival or scheduled).
    if (studyInstanceUID) {
      import("../lib/ai/schedulerService")
        .then(({ scheduleStudyOnDicomArrival }) =>
          scheduleStudyOnDicomArrival({
            studyInstanceUid: studyInstanceUID as string,
            modality: modality ?? null,
          }),
        )
        .catch((err: unknown) => {
          logger.warn({ err, worklistId: row.id }, "AI draft schedule on intake failed silently");
        });
    }

    logger.info({ worklistId: row.id, accessionNumber }, "POST /api/internal/radiology/studies success");
    res.status(201).json({ success: true, worklistId: row.id });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, body: rawBody }, "POST /api/internal/radiology/studies FAILED");
    res.status(500).json({ success: false, error: message });
    return;
  }
});

// ── Report status update ──────────────────────────────────────────────────────
// POST /api/internal/radiology/report-status

router.post("/radiology/report-status", async (req, res) => {
  const b = (req.body ?? {}) as {
    /** radiology_worklist.id — preferred when accession/UID are missing or stale. */
    worklistId?: number;
    studyId?: number;
    accessionNumber?: string;
    studyInstanceUID?: string;
    status?: string;
    deliveryStatus?: string;
    reportId?: number;
    actor?: string;
    auditDetails?: unknown;
    // PCPNDT override (admin/super_admin only, audited) — see the
    // REPORT_FINAL compliance gate below.
    pcpndtOverride?: boolean;
    pcpndtOverrideReason?: string;
    /** Admin-only: allow REPORT_FINAL without a signed patient report row. */
    softFinalOverride?: boolean;
    softFinalReason?: string;
  };

  // Find worklist row — worklist id first (canonical workspace key), then UID/accession.
  let existing: typeof radiologyWorklistTable.$inferSelect | undefined;
  if (b.worklistId) {
    const [row] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, b.worklistId));
    existing = row;
  }
  if (!existing && b.studyInstanceUID) {
    const [row] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyInstanceUID, b.studyInstanceUID));
    existing = row;
  }
  if (!existing && b.accessionNumber) {
    const [row] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.accessionNumber, b.accessionNumber));
    existing = row;
  }
  if (!existing && b.studyId) {
    const [row] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyId, b.studyId));
    existing = row;
  }

  if (!existing) {
    res.status(404).json({ error: "Worklist entry not found" });
    return;
  }

  // Soft Final (status-only REPORT_FINAL without a signed patient report) is
  // admin/owner override only — radiologists must use workspace Finalize & Sign.
  // Canonical finalizeRadiologyReport always sets deliveryStatus READY_TO_SEND
  // (even when the patient-report row is skipped for unbilled studies).
  // INTERNAL_API_KEY automation (no staffSession) is unchanged.
  const ADMIN_SOFT_FINAL_ROLES = new Set(["admin", "super_admin", "owner"]);
  const isCanonicalFinalize = b.deliveryStatus === "READY_TO_SEND";
  if (
    b.status === "REPORT_FINAL" &&
    !b.reportId &&
    !isCanonicalFinalize &&
    (req as StaffAuthRequest).staffSession
  ) {
    const sessionRole = normalizeRole((req as StaffAuthRequest).staffSession?.role ?? "");
    const softOverride = b.softFinalOverride === true;
    if (!softOverride || !ADMIN_SOFT_FINAL_ROLES.has(sessionRole)) {
      res.status(409).json({
        error: "SOFT_FINAL_BLOCKED",
        message:
          "Marking a study Final without a signed report is blocked. Open the Reporting Workspace and use Finalize & Sign, or use Admin mark final with a reason.",
      });
      return;
    }
    const session = (req as StaffAuthRequest).staffSession;
    await auditLog({
      userId: session?.subjectId ?? null,
      userName: session?.subjectName ?? "system",
      role: sessionRole || "system",
      action: "soft_final_override",
      module: "radiology",
      entityType: "radiology_worklist",
      entityId: String(existing.id),
      newValue: JSON.stringify({ accessionNumber: existing.accessionNumber }),
      reason: typeof b.softFinalReason === "string" && b.softFinalReason.trim().length >= 3
        ? b.softFinalReason.trim()
        : "admin soft final (no signed reportId)",
    });
  }

  // PCPNDT server-side finalize guard. The canonical Radiology Reporting
  // Workspace's finalizeReport() already blocks this client-side
  // (isObstetricUsgStudy() in the frontend's lib/usgModality.ts), but that
  // is a UI-level guard only — a direct call to this endpoint (bypassing the
  // client entirely) would otherwise still be able to flip an obstetric/
  // fetal ultrasound study to REPORT_FINAL with zero PCPNDT Form F
  // compliance check. This is the authoritative, DB-verified check (reads
  // `existing.modality`/`existing.studyDescription` from the worklist row
  // itself, never trusts client-supplied values) and covers BOTH the billed
  // path (which also creates a patient_reports row — see the equivalent
  // guard in patient-reports.ts POST /) and the unbilled path (where this
  // report-status call is the ONLY finalize-adjacent write that happens).
  // Only the legacy, PCPNDT-compliant pipeline (routes/usgReports.ts,
  // UsgReporting.tsx) may finalize these studies — see
  // docs/usg-reporting/platform-consolidation-pr-b.md §17-18.
  // Roadmap §1.4 step 2 (docs/usg-reporting/pcpndt-canonical-roadmap.md):
  // upgraded from a blanket block to the real shared Form F verification
  // (lib/pcpndtCompliance.ts — the same check the legacy usgReports.ts
  // finalize enforces). Compliant obstetric studies proceed; non-compliant
  // ones are refused with the exact missing fields. Step 4: admin/
  // super_admin may override with a documented reason (audited), mirroring
  // the legacy finalize-force gate. Note: the billed path also passes the
  // equivalent gate in patient-reports.ts POST /; this covers the unbilled
  // path where this status flip is the only finalize-adjacent write.
  if (b.status === "REPORT_FINAL" && isObstetricUsgStudy(existing.modality, existing.studyDescription)) {
    const compliance = await checkPcpndtFormFCompliance(existing.patientId);
    if (!compliance.compliant) {
      const overrideReason = typeof b.pcpndtOverrideReason === "string" ? b.pcpndtOverrideReason.trim() : "";
      const sessionRole = (req as StaffAuthRequest).staffSession?.role ?? "";
      if (b.pcpndtOverride === true && PCPNDT_OVERRIDE_ROLES.has(sessionRole) && overrideReason.length >= 3) {
        const session = (req as StaffAuthRequest).staffSession;
        await auditLog({
          userId: session?.subjectId ?? null,
          userName: session?.subjectName ?? "system",
          role: sessionRole || "system",
          action: "pcpndt_override_finalize",
          module: "radiology",
          entityType: "radiology_worklist",
          entityId: String(existing.id),
          newValue: JSON.stringify({
            patientId: existing.patientId,
            complianceErrors: compliance.errors,
          }),
          reason: overrideReason,
        });
      } else {
        res.status(409).json({
          error: "pcpndt_compliance_required",
          message:
            "This is an obstetric/fetal ultrasound study and its PCPNDT Form F record is missing or incomplete. Complete and verify Form F for this patient (Form F page), then finalize again. An admin/super_admin may override with a documented reason (pcpndtOverride + pcpndtOverrideReason).",
          validationErrors: compliance.errors,
          formFId: compliance.formFId,
        });
        return;
      }
    }
  }

  // M1.6A — a status flip (finalize) by a STAFF session is refused while
  // another user actively holds the study lock: two radiologists must never
  // finalize the same study over each other. The INTERNAL_API_KEY automation
  // path carries no session and is never lock-gated.
  const staffSession = (req as StaffAuthRequest).staffSession;
  if (staffSession) {
    const gate = await checkWriteLock(existing.id, staffSession.subjectId);
    if (gate.blocked) {
      res.status(409).json({
        error: "LOCKED_BY_OTHER",
        lockedBy: gate.lockedBy,
        message: `This study is currently being reported by ${gate.lockedBy}.`,
      });
      return;
    }
  }

  const VALID_STATUSES = ["STUDY_RECEIVED", "AI_DRAFT_READY", "REPORT_IN_PROGRESS", "REPORT_FINAL", "DELIVERED"];
  const VALID_DELIVERY = ["READY_TO_SEND", "SENT"];

  const updates: Partial<typeof radiologyWorklistTable.$inferInsert> = { updatedAt: new Date() };
  if (b.status && VALID_STATUSES.includes(b.status)) updates.status = b.status;
  if (b.deliveryStatus && VALID_DELIVERY.includes(b.deliveryStatus)) updates.deliveryStatus = b.deliveryStatus;
  if (b.reportId) updates.reportId = b.reportId;
  // Completed studies hold no locks (M1.6A): the flip to REPORT_FINAL /
  // DELIVERED clears the lock server-side — release-on-finalize is
  // authoritative here, never a client courtesy call.
  if (b.status === "REPORT_FINAL" || b.status === "DELIVERED") {
    updates.lockUserId = null;
    updates.lockUserName = null;
    updates.lockTime = null;
    updates.lockLastActivityAt = null;
    updates.lockWorkstation = null;
  }

  const [updated] = await db
    .update(radiologyWorklistTable)
    .set(updates)
    .where(eq(radiologyWorklistTable.id, existing.id))
    .returning();

  const changes: string[] = [];
  if (b.status) changes.push(`status → ${b.status}`);
  if (b.deliveryStatus) changes.push(`deliveryStatus → ${b.deliveryStatus}`);

  await audit({
    worklistId: existing.id,
    accessionNumber: existing.accessionNumber,
    action: "REPORT_STATUS_UPDATED",
    actor: b.actor ?? "system",
    details: { changes, ...(typeof b.auditDetails === "object" && b.auditDetails ? b.auditDetails : {}) },
  });

  if (b.status === "REPORT_FINAL" && existing.studyId) {
    import("../lib/pacsArchive.js").then(({ archiveReportToPacs }) => {
      archiveReportToPacs(existing.studyId!);
    }).catch(err => {
      logger.error({ err }, "Failed to load pacsArchive helper in report-status");
    });
  }

  res.json(updated);
});

// ── AI draft generation ───────────────────────────────────────────────────────
// POST /api/internal/radiology/ai-draft
//
// Tries Gemini if configured; falls back to structured template-based placeholder.
// SAFETY: AI output is NEVER automatically set to REPORT_FINAL. The radiologist
// must explicitly click "Save Final Report" in the UI.

const RADIOLOGY_TEMPLATES: Record<string, { technique: string; findings: string; impression: string; recommendation: string }> = {
  "MRI Brain Plain": {
    technique: "Multiplanar, multisequence MRI of the brain was performed using T1W, T2W, FLAIR, DWI, GRE/SWI sequences on a [field strength] Tesla MRI scanner without contrast administration.",
    findings: `<b>Brain Parenchyma:</b>
Grey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality identified.

<b>Ventricles and Sulci:</b>
Ventricles are normal in size and configuration. Basal cisterns are patent. Cortical sulci show age-appropriate prominence.

<b>Corpus Callosum:</b>
Normal morphology and signal.

<b>Cerebellum and Brainstem:</b>
No signal abnormality. Normal foliation of cerebellar hemispheres. Brainstem is normal.

<b>Basal Ganglia and Thalami:</b>
Normal signal and morphology bilaterally.

<b>Posterior Fossa:</b>
No mass lesion or extra-axial collection. Foramen magnum is patent.

<b>Calvarium and Orbits:</b>
No aggressive bony lesion. Orbits appear normal.

<b>Visualized Paranasal Sinuses and Mastoid Air Cells:</b>
Clear.`,
    impression: "• No acute intracranial abnormality identified on plain MRI brain.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings and symptoms. MRI Brain with contrast is recommended if clinically indicated.",
  },
  "MRI Brain With Contrast": {
    technique: "Multiplanar, multisequence MRI of the brain was performed using T1W, T2W, FLAIR, DWI, GRE/SWI sequences followed by T1W post-gadolinium contrast sequences on a [field strength] Tesla MRI scanner.",
    findings: `<b>Brain Parenchyma (Pre-contrast):</b>
Grey-white matter differentiation is preserved. No focal signal abnormality.

<b>Post-Contrast Enhancement:</b>
No abnormal parenchymal, leptomeningeal, or pachymeningeal enhancement identified.

<b>Ventricles and Sulci:</b>
Normal in size and configuration.

<b>Corpus Callosum:</b>
Normal morphology and signal.

<b>Cerebellum and Brainstem:</b>
No lesion or enhancement.

<b>Basal Ganglia and Thalami:</b>
Normal signal bilaterally. No abnormal enhancement.

<b>Calvarium and Orbits:</b>
No aggressive bony lesion or abnormal enhancement.`,
    impression: "• No abnormal intracranial enhancement detected.\n• No mass lesion, abscess, or leptomeningeal disease identified.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings. Repeat MRI recommended if symptoms persist.",
  },
  "MRI LS Spine": {
    technique: "Multiplanar, multisequence MRI of the lumbar spine was performed using T1W and T2W sequences in sagittal and axial planes.",
    findings: `<b>Vertebral Alignment:</b>
Normal lumbar lordosis maintained. No listhesis.

<b>Vertebral Bodies:</b>
Height, morphology, and marrow signal of all lumbar vertebral bodies appear within normal limits.

<b>Intervertebral Discs:</b>
L1-L2: Normal height and signal.
L2-L3: Normal height and signal.
L3-L4: Normal height and signal.
L4-L5: Mild disc desiccation noted. No significant disc herniation or canal compromise.
L5-S1: Mild disc desiccation. No significant disc herniation.

<b>Spinal Canal:</b>
Adequate calibre at all levels. No significant central canal stenosis.

<b>Neural Foramina:</b>
No significant foraminal narrowing.

<b>Conus Medullaris:</b>
Terminating at L1-L2 level — within normal limits.

<b>Paravertebral Soft Tissues:</b>
Unremarkable.`,
    impression: "• Mild degenerative disc changes at L4-L5 and L5-S1 without significant neural compromise.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings. Physiotherapy and conservative management may be considered.",
  },
  "MRI Cervical Spine": {
    technique: "Multiplanar, multisequence MRI of the cervical spine was performed using T1W and T2W sequences in sagittal and axial planes.",
    findings: `<b>Vertebral Alignment:</b>
Normal cervical lordosis maintained. No listhesis.

<b>Vertebral Bodies:</b>
Height, morphology, and marrow signal are within normal limits.

<b>Intervertebral Discs:</b>
C2-C3 through C6-C7: No significant disc herniation, disc desiccation, or canal compromise.

<b>Spinal Canal:</b>
Adequate calibre at all levels. No significant central canal stenosis.

<b>Neural Foramina:</b>
No significant foraminal narrowing.

<b>Spinal Cord:</b>
Normal in calibre and signal throughout.

<b>Paravertebral Soft Tissues:</b>
Unremarkable.`,
    impression: "• No significant disc herniation or cord signal abnormality on MRI cervical spine.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings and neurological examination.",
  },
  "CT Brain": {
    technique: "Non-contrast CT of the brain was performed using standard axial sections with coronal and sagittal reformats.",
    findings: `<b>Brain Parenchyma:</b>
No hyperdense or hypodense lesion identified. Grey-white matter differentiation is preserved.

<b>Ventricles:</b>
Lateral, third, and fourth ventricles are normal in size and configuration.

<b>Basal Cisterns:</b>
Patent. No effacement.

<b>Midline Structures:</b>
No midline shift.

<b>Extra-Axial Spaces:</b>
No subdural, epidural, or subarachnoid haemorrhage.

<b>Posterior Fossa:</b>
Cerebellum and brainstem appear normal. No mass lesion.

<b>Calvarium:</b>
No fracture or lytic/sclerotic lesion.

<b>Visualized Paranasal Sinuses and Mastoid Air Cells:</b>
Clear.`,
    impression: "• No acute intracranial haemorrhage, infarct, or space-occupying lesion on CT brain.\n• [Add specific findings if applicable.]",
    recommendation: "MRI brain is recommended for further evaluation if clinically indicated.",
  },
  "X-Ray Chest": {
    technique: "PA view chest X-ray obtained in full inspiration.",
    findings: `<b>Lung Fields:</b>
Both lung fields are clear. No consolidation, collapse, cavity, or pleural effusion.

<b>Hila:</b>
Bilateral hilar shadows are within normal limits.

<b>Mediastinum:</b>
Superior mediastinum appears normal in width. Trachea is centrally placed.

<b>Heart:</b>
Cardiothoracic ratio is within normal limits (< 50%). Cardiac contours are normal.

<b>Diaphragm:</b>
Both hemidiaphragms are dome-shaped and at normal levels. Costophrenic angles are sharp.

<b>Bony Thorax:</b>
Ribs, clavicles, and visible shoulder joints appear normal. No fracture.`,
    impression: "• No active cardiopulmonary pathology detected on chest X-ray.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings. High-resolution CT chest recommended if indicated.",
  },
  "USG Abdomen": {
    technique: "Real-time B-mode ultrasound of the abdomen was performed using a [frequency] MHz probe.",
    findings: `<b>Liver:</b>
Normal in size and echogenicity. No focal lesion, biliary dilatation, or ascites. Portal vein diameter within normal limits.

<b>Gallbladder:</b>
Normal in size. Wall thickness within normal limits. No calculi or polyp. No pericholecystic fluid.

<b>Common Bile Duct:</b>
Not dilated. Diameter within normal limits.

<b>Pancreas:</b>
Visualised portions appear normal in echogenicity and outline. No focal lesion or ductal dilatation.

<b>Spleen:</b>
Normal in size and echogenicity.

<b>Kidneys:</b>
Both kidneys are normal in size, shape, and echogenicity. Corticomedullary differentiation maintained. No hydronephrosis, calculus, or focal lesion.

<b>Urinary Bladder:</b>
Adequately filled. Walls appear normal. No intraluminal lesion.

<b>Aorta and IVC:</b>
No significant dilatation or wall abnormality in the visualised portions.`,
    impression: "• No sonographic abnormality detected in the abdomen.\n• [Add specific findings if applicable.]",
    recommendation: "Please correlate with clinical findings and laboratory investigations.",
  },
};

// Normalise template name lookup — case-insensitive, trim whitespace.
function findTemplate(key: string): typeof RADIOLOGY_TEMPLATES[string] | undefined {
  if (!key) return undefined;
  const k = key.trim().toLowerCase();
  for (const [name, tpl] of Object.entries(RADIOLOGY_TEMPLATES)) {
    if (name.toLowerCase() === k) return tpl;
  }
  return undefined;
}

function buildTemplateFromModality(modality: string, studyDescription: string): typeof RADIOLOGY_TEMPLATES[string] {
  // Best-effort fuzzy match by studyDescription first, then modality.
  const desc = `${studyDescription} ${modality}`.toLowerCase();
  if (desc.includes("brain") && (desc.includes("contrast") || desc.includes("ce"))) return RADIOLOGY_TEMPLATES["MRI Brain With Contrast"]!;
  if (desc.includes("brain") && desc.includes("mri")) return RADIOLOGY_TEMPLATES["MRI Brain Plain"]!;
  if ((desc.includes("ls") || desc.includes("lumbar")) && desc.includes("spine")) return RADIOLOGY_TEMPLATES["MRI LS Spine"]!;
  if ((desc.includes("cervical") || desc.includes("neck")) && desc.includes("spine")) return RADIOLOGY_TEMPLATES["MRI Cervical Spine"]!;
  if (desc.includes("ct") && desc.includes("brain")) return RADIOLOGY_TEMPLATES["CT Brain"]!;
  if (desc.includes("chest") || desc.includes("cxr")) return RADIOLOGY_TEMPLATES["X-Ray Chest"]!;
  if (desc.includes("usg") || desc.includes("abdomen") || desc.includes("ultrasound")) return RADIOLOGY_TEMPLATES["USG Abdomen"]!;

  const m = modality.toUpperCase();
  if (m === "MR") return RADIOLOGY_TEMPLATES["MRI Brain Plain"]!;
  if (m === "CT") return RADIOLOGY_TEMPLATES["CT Brain"]!;
  if (m === "CR" || m === "DX") return RADIOLOGY_TEMPLATES["X-Ray Chest"]!;
  if (m === "US") return RADIOLOGY_TEMPLATES["USG Abdomen"]!;
  return RADIOLOGY_TEMPLATES["X-Ray Chest"]!;
}

function buildFormattedHtml(opts: {
  patientName: string;
  age: string;
  sex: string;
  studyDescription: string;
  accessionNumber: string;
  studyDate: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
}): string {
  const { patientName, age, sex, studyDescription, accessionNumber, studyDate, technique, findings, impression, recommendation } = opts;
  return `<div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; padding: 16px;">
<p style="font-weight: bold; margin: 0;">Patient: ${patientName} &nbsp;|&nbsp; Age/Sex: ${age} / ${sex} &nbsp;|&nbsp; Accession: ${accessionNumber} &nbsp;|&nbsp; Date: ${studyDate}</p>
<hr style="border: 2px solid #000; margin: 8px 0;" />
<p style="text-align: center; font-weight: bold; text-decoration: underline; font-size: 15px;">${studyDescription.toUpperCase()}</p>

<p><b>TECHNIQUE:</b><br/>${technique}</p>

<p><b>FINDINGS / OBSERVATIONS:</b><br/>${findings.replace(/\n/g, "<br/>")}</p>

<p><b>IMPRESSION:</b><br/>${impression.replace(/\n/g, "<br/>")}</p>

<p><b>RECOMMENDATION:</b><br/>${recommendation}</p>

<p style="font-style: italic; color: #555; margin-top: 16px;">Please correlate with clinical findings.</p>
</div>`;
}

router.post("/radiology/ai-draft", async (req, res) => {
  const b = (req.body ?? {}) as {
    studyId?: number;
    modality?: string;
    studyDescription?: string;
    clinicalHistory?: string;
    rawFindings?: string;
    templateId?: number;
    templateName?: string;
    // Context for demographics in HTML output
    patientName?: string;
    age?: string;
    sex?: string;
    accessionNumber?: string;
    studyDate?: string;
  };

  const modality = b.modality?.trim() || "OT";
  const studyDescription = b.studyDescription?.trim() || modality;
  const patientName = b.patientName?.trim() || "Patient";
  const age = b.age?.trim() || "";
  const sex = b.sex?.trim() || "";
  const accessionNumber = b.accessionNumber?.trim() || "";
  const studyDate = b.studyDate?.trim() || todayIST();

  // Mark worklist entry as AI_DRAFT_READY (look up by studyId if provided)
  let worklistRow: typeof radiologyWorklistTable.$inferSelect | undefined;
  if (b.studyId) {
    const [r] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, b.studyId));
    worklistRow = r;
  }

  // Resolve template
  const tpl = (b.templateName ? findTemplate(b.templateName) : undefined)
    ?? buildTemplateFromModality(modality, studyDescription);

  const title = `${studyDescription} — Report`;

  // If raw findings provided, incorporate into the findings section.
  let findings = tpl.findings;
  if (b.rawFindings?.trim()) {
    findings = `<b>RADIOLOGIST FINDINGS:</b><br/>${b.rawFindings.trim()}<br/><br/>${findings}`;
  }
  if (b.clinicalHistory?.trim()) {
    findings = `<b>CLINICAL HISTORY:</b><br/>${b.clinicalHistory.trim()}<br/><br/>${findings}`;
  }

  // Attempt Gemini generation if key present.
  let aiGenerated = false;
  try {
    const hasGemini = !!(process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] || process.env["GEMINI_API_KEY"]);
    if (hasGemini && (b.rawFindings?.trim() || b.clinicalHistory?.trim())) {
      const { geminiGenerate } = await import("@workspace/integrations-gemini-ai");
      const prompt = `You are an expert radiologist. Generate a structured radiology report.
Study: ${studyDescription}
Modality: ${modality}
${b.clinicalHistory ? `Clinical History: ${b.clinicalHistory}` : ""}
${b.rawFindings ? `Raw Findings / Dictation: ${b.rawFindings}` : ""}

Return a JSON object with these exact keys: title, technique, findings (HTML with <b> headings), impression (bullet points), recommendation.
Respond ONLY with the JSON object, no markdown fences.`;

      const raw = await geminiGenerate(prompt, { maxTokens: 4096 });
      // Strip markdown fences if model adds them anyway
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as {
        title?: string; technique?: string; findings?: string;
        impression?: string; recommendation?: string;
      };
      if (parsed.findings) {
        findings = parsed.findings;
        if (parsed.impression) tpl.impression = parsed.impression;
        if (parsed.recommendation) tpl.recommendation = parsed.recommendation;
        if (parsed.technique) tpl.technique = parsed.technique;
        aiGenerated = true;
      }
    }
  } catch {
    // Fall through to template-based output silently
  }

  const draft = {
    title,
    technique: tpl.technique,
    findings,
    impression: tpl.impression,
    recommendation: tpl.recommendation,
    formattedReportHtml: buildFormattedHtml({
      patientName, age, sex, studyDescription, accessionNumber, studyDate,
      technique: tpl.technique, findings, impression: tpl.impression,
      recommendation: tpl.recommendation,
    }),
    formattedReportText: [
      `Patient: ${patientName} | Age/Sex: ${age} / ${sex} | Accession: ${accessionNumber} | Date: ${studyDate}`,
      "─────────────────────────────────",
      studyDescription.toUpperCase(),
      "",
      "TECHNIQUE:",
      tpl.technique,
      "",
      "FINDINGS:",
      findings.replace(/<[^>]+>/g, ""),
      "",
      "IMPRESSION:",
      tpl.impression,
      "",
      "RECOMMENDATION:",
      tpl.recommendation,
      "",
      "Please correlate with clinical findings.",
    ].join("\n"),
    aiGenerated,
    templateUsed: b.templateName ?? studyDescription,
  };

  // Update worklist status if we found a row
  if (worklistRow) {
    await db
      .update(radiologyWorklistTable)
      .set({
        status: "AI_DRAFT_READY",
        aiDraftStatus: "READY",
        aiDraftJson: JSON.stringify(draft),
        updatedAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, worklistRow.id));

    await audit({
      worklistId: worklistRow.id,
      accessionNumber: worklistRow.accessionNumber,
      action: "AI_DRAFT_GENERATED",
      actor: "system",
      details: { aiGenerated, templateUsed: draft.templateUsed },
    });
  }

  res.json(draft);
});

// ── DICOM event ingestion ─────────────────────────────────────────────────────
// POST /api/internal/radiology/dicom-event
// Called by Conquest Lua hooks and the Python PACS agent to log events.
// Any actor with INTERNAL_API_KEY can write; logs are then visible in PacsLogs.

router.post("/radiology/dicom-event", async (req, res) => {
  const b = (req.body ?? {}) as {
    message?: string;
    severity?: string;
    source?: string;
    eventType?: string;
    logType?: string;
    studyInstanceUid?: string;
    accessionNumber?: string;
    patientId?: string;
    modality?: string;
    payload?: unknown;
    errorStack?: string;
  };

  if (!b.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const VALID_SEV = ["info", "warning", "error", "debug"];
  const payloadStr = b.payload != null
    ? (typeof b.payload === "string" ? b.payload : JSON.stringify(b.payload))
    : null;

  const [row] = await db.insert(pacsLogsTable).values({
    message:          b.message.trim(),
    severity:         VALID_SEV.includes(b.severity ?? "") ? b.severity! : "info",
    source:           b.source ?? null,
    eventType:        b.eventType ?? null,
    logType:          b.logType ?? "dicom-event",
    studyInstanceUid: b.studyInstanceUid ?? null,
    accessionNumber:  b.accessionNumber ?? null,
    patientId:        b.patientId ?? null,
    modality:         b.modality ?? null,
    payload:          payloadStr,
    errorStack:       b.errorStack ?? null,
  }).returning();

  res.status(201).json(row);
});

// ── Orthanc OnStoredInstance webhook (low-latency auto-push) ──────────────────
// POST /api/internal/radiology/orthanc-webhook   { orthancStudyId }
//
// The background /changes poller (lib/pacs/orthancChangesPoller.ts) is the
// reliable baseline; this endpoint is the near-instant fast path, called by a
// tiny Orthanc-side Lua hook (docker/orthanc/erp_notify.lua) the moment a study
// stabilises. It fetches the study from Orthanc and runs the SAME intake
// (incl. USG SR extraction) the poller uses, so the two paths are identical and
// idempotent — a study pushed by both is upserted once.
router.post("/radiology/orthanc-webhook", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const orthancStudyId = typeof b.orthancStudyId === "string" ? b.orthancStudyId.trim() : "";
  if (!orthancStudyId) {
    res.status(400).json({ success: false, error: "orthancStudyId is required" });
    return;
  }
  try {
    const { ingestOrthancStudyId } = await import("../lib/pacs/orthancChangesPoller");
    const ok = await ingestOrthancStudyId(orthancStudyId);
    res.json({ success: ok });
  } catch (err) {
    logger.error({ err, orthancStudyId }, "orthanc-webhook ingest failed");
    res.status(502).json({ success: false, error: "Ingest failed" });
  }
});

// ── Worklist read endpoints ───────────────────────────────────────────────────
// GET /api/internal/radiology/worklist?status=&modality=&date=
router.get("/radiology/worklist", async (req, res) => {
  const status = (req.query.status as string) || "";
  const modality = (req.query.modality as string) || "";

  const conds = [];
  if (status && status !== "all") conds.push(eq(radiologyWorklistTable.status, status));
  if (modality && modality !== "all") conds.push(eq(radiologyWorklistTable.modality, modality));

  const rows = await db
    .select()
    .from(radiologyWorklistTable)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(sql`created_at DESC`)
    .limit(200);

  res.json(rows);
});

// GET /api/internal/radiology/resolve-open?orderId=&patientId=&uhid=&modality=&patientName=
// Deep-link helper for Hope (and other partners): map a CARE order/patient/UHID to
// the Reporting Workspace worklist id. Falls back to a filtered worklist path
// when the MRI/CT study has not arrived in PACS yet.
router.get("/radiology/resolve-open", async (req, res) => {
  const orderIdRaw = req.query.orderId;
  const patientIdRaw = req.query.patientId;
  const uhid = typeof req.query.uhid === "string" ? req.query.uhid.trim() : null;
  const modality = typeof req.query.modality === "string" ? req.query.modality : null;
  const patientName = typeof req.query.patientName === "string" ? req.query.patientName : null;

  const orderId = orderIdRaw != null && orderIdRaw !== "" ? Number(orderIdRaw) : null;
  const patientId = patientIdRaw != null && patientIdRaw !== "" ? Number(patientIdRaw) : null;

  const hasOrder = orderId != null && Number.isFinite(orderId);
  const hasPatient = patientId != null && Number.isFinite(patientId);
  if (!hasOrder && !hasPatient && !uhid) {
    res.status(400).json({
      error: "Provide orderId, patientId, and/or uhid",
      fallbackPath: radiologyOpenFallbackPath({ modality, patientName }),
    });
    return;
  }

  try {
    const target = await resolveRadiologyOpen({
      orderId: hasOrder ? orderId : null,
      patientId: hasPatient ? patientId : null,
      modality,
      uhid,
    });

    if (!target) {
      res.status(404).json({
        error: "No radiology study ready for reporting yet",
        fallbackPath: radiologyOpenFallbackPath({ modality, patientName }),
      });
      return;
    }

    res.json({
      ...target,
      reportPath: `/radiology/report/${target.worklistId}`,
      fallbackPath: radiologyOpenFallbackPath({ modality: target.modality || modality, patientName }),
    });
  } catch (err) {
    logger.error({ err, orderId, patientId, uhid, modality }, "resolve-open failed");
    res.status(500).json({
      error: "Failed to resolve radiology open target",
      fallbackPath: radiologyOpenFallbackPath({ modality, patientName }),
    });
  }
});

// POST /api/internal/radiology/send-report-to-hope
// Push a finalized radiology report to Hope immediately (outbox + dispatch).
router.post("/radiology/send-report-to-hope", async (req, res) => {
  const reportId = req.body?.reportId != null ? Number(req.body.reportId) : null;
  const worklistId = req.body?.worklistId != null ? Number(req.body.worklistId) : null;
  if ((reportId == null || !Number.isFinite(reportId)) && (worklistId == null || !Number.isFinite(worklistId))) {
    res.status(400).json({ error: "Provide reportId and/or worklistId" });
    return;
  }
  try {
    const { emitReportToHope } = await import("../services/integration/emitReportToHope");
    const result = await emitReportToHope({
      reportId: reportId != null && Number.isFinite(reportId) ? reportId : null,
      worklistId: worklistId != null && Number.isFinite(worklistId) ? worklistId : null,
      dispatchNow: true,
    });
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404
        : result.code === "NOT_SIGNED" ? 409
        : result.code === "NO_REFERRAL" ? 409
        : 500;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err, reportId, worklistId }, "send-report-to-hope failed");
    res.status(500).json({ ok: false, error: "Failed to send report to Hope", code: "EMIT_FAILED" });
  }
});

// GET /api/internal/radiology/worklist/:id
router.get("/radiology/worklist/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  let [row] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let autoLinkMeta: { linked: boolean; studyId?: number; matchPoints?: number; matchScore?: string; reason?: string } | null = null;
  if (row.patientId && !row.studyId) {
    try {
      const { autoLinkBilledStudyForWorklist } = await import("../lib/pacs/worklistBillingLink");
      const link = await autoLinkBilledStudyForWorklist(id, "worklist-entry-load");
      autoLinkMeta = link;
      if (link.linked && link.studyId) {
        row = { ...row, studyId: link.studyId };
      }
    } catch {
      /* non-blocking */
    }
  }

  let pacsArchiveStatus = "none";
  let pacsArchiveResponse = null;
  let pacsInstanceId = null;
  let priority: string | null = null;
  let billNumber: string | null = null;
  let uhid: string | null = null;

  if (row.studyId) {
    const [study] = await db
      .select({
        pacsArchiveStatus: radiologyStudiesTable.pacsArchiveStatus,
        pacsArchiveResponse: radiologyStudiesTable.pacsArchiveResponse,
        pacsInstanceId: radiologyStudiesTable.pacsInstanceId,
        // Phase D (Reading Room) — reuse existing columns, no schema change
        priority: radiologyStudiesTable.priority,
        billId: radiologyStudiesTable.billId,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, row.studyId));

    if (study) {
      pacsArchiveStatus = study.pacsArchiveStatus || "none";
      pacsArchiveResponse = study.pacsArchiveResponse;
      pacsInstanceId = study.pacsInstanceId;
      priority = study.priority ?? null;
      if (study.billId) {
        const [bill] = await db
          .select({ billNumber: billsTable.billNumber })
          .from(billsTable)
          .where(eq(billsTable.id, study.billId));
        billNumber = bill?.billNumber ?? null;
      }
    }
  }

  if (row.patientId) {
    const [pat] = await db
      .select({ uhid: patientsTable.patientId })
      .from(patientsTable)
      .where(eq(patientsTable.id, row.patientId));
    uhid = pat?.uhid ?? null;
  }

  res.json({
    ...row,
    pacsArchiveStatus,
    pacsArchiveResponse,
    pacsInstanceId,
    // Phase D additive fields (safe for old clients — extra keys ignored)
    priority,
    billNumber,
    uhid,
    autoLinkMeta,
  });
});

// GET /api/internal/radiology/audit/:worklistId
router.get("/radiology/audit/:worklistId", async (req, res) => {
  const id = Number(req.params.worklistId);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select()
    .from(radiologyAuditLogTable)
    .where(eq(radiologyAuditLogTable.worklistId, id))
    .orderBy(sql`created_at DESC`);
  res.json(rows);
});

// GET /api/internal/radiology/templates — list available template names
router.get("/radiology/templates", (_req, res) => {
  res.json(Object.keys(RADIOLOGY_TEMPLATES).map((name) => ({ name })));
});

// ── DICOM Pull Job Agent Endpoints ────────────────────────────────────────────
// These are called by the dicom-pull-agent service running on the Conquest
// server machine. Auth: same INTERNAL_API_KEY bearer token.


// GET /api/internal/dicom/pull-jobs/pending
// The pull agent calls this every POLL_INTERVAL_MS to get queued jobs.
// Returns jobs with status='pending', including the parent node details
// so the agent has host/port/aeTitle/conquestAeTitle in one round-trip.
router.get("/dicom/pull-jobs/pending", async (_req, res) => {
  const jobs = await db.select().from(dicomPullJobsTable)
    .where(eq(dicomPullJobsTable.status, "pending"))
    .orderBy(dicomPullJobsTable.createdAt)
    .limit(10);

  if (jobs.length === 0) {
    res.json({ jobs: [] });
    return;
  }

  // Attach node details to each job
  const nodeIds = [...new Set(jobs.map((j) => j.nodeId))];
  const nodes = await db.select().from(dicomNodesTable)
    .where(inArray(dicomNodesTable.id, nodeIds));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  res.json({
    jobs: jobs.map((j) => ({ ...j, node: nodeMap.get(j.nodeId) ?? null })),
  });
});

// PATCH /api/internal/dicom/pull-jobs/:jobId/claim
// Agent calls this immediately before starting work to prevent duplicate processing.
router.patch("/dicom/pull-jobs/:jobId/claim", async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) {
    res.status(400).json({ error: "Invalid jobId" });
    return;
  }
  const [job] = await db.select().from(dicomPullJobsTable)
    .where(eq(dicomPullJobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "pending") {
    // Another agent already claimed it
    res.status(409).json({ error: `Job already in status '${job.status}'` });
    return;
  }
  const agentId = String(req.body?.agentId ?? "unknown");
  const [updated] = await db.update(dicomPullJobsTable).set({
    status: "running",
    agentId,
    startedAt: new Date(),
  }).where(eq(dicomPullJobsTable.id, jobId)).returning();
  res.json(updated);
});

// PATCH /api/internal/dicom/pull-jobs/:jobId
// Agent calls this when the job finishes (success, failed, or partial).
router.patch("/dicom/pull-jobs/:jobId", async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) {
    res.status(400).json({ error: "Invalid jobId" });
    return;
  }
  const [job] = await db.select().from(dicomPullJobsTable)
    .where(eq(dicomPullJobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const b = req.body ?? {};
  const status = ["completed", "failed", "partial"].includes(b.status) ? b.status : "failed";
  const [updated] = await db.update(dicomPullJobsTable).set({
    status,
    studiesFound:       typeof b.studiesFound  === "number" ? b.studiesFound  : job.studiesFound,
    studiesPulled:      typeof b.studiesPulled === "number" ? b.studiesPulled : job.studiesPulled,
    studiesFailed:      typeof b.studiesFailed === "number" ? b.studiesFailed : job.studiesFailed,
    studyInstanceUIDs:  typeof b.studyInstanceUIDs === "string" ? b.studyInstanceUIDs : job.studyInstanceUIDs,
    errorMessage:       typeof b.errorMessage === "string" ? b.errorMessage : job.errorMessage,
    agentId:            typeof b.agentId === "string" ? b.agentId : job.agentId,
    completedAt:        new Date(),
  }).where(eq(dicomPullJobsTable.id, jobId)).returning();

  // Update the node's lastPullAt / lastPullStatus
  const pullStatus = status === "completed" ? "success" : status === "partial" ? "partial" : "failed";
  const pullMsg = status === "completed"
    ? `${updated.studiesPulled ?? 0} studies pulled`
    : updated.errorMessage ?? status;
  await db.update(dicomNodesTable).set({
    lastPullAt: new Date(),
    lastPullStatus: pullStatus,
    lastPullMessage: pullMsg,
  }).where(eq(dicomNodesTable.id, job.nodeId));

  res.json(updated);
});

// ── Helpers: DICOM formatting ─────────────────────────────────────────────────

// Map internal gender strings → DICOM sex codes M / F / O (exact match only).
function dicomSex(gender: string | null | undefined): "M" | "F" | "O" {
  return genderToDicomSex(gender) ?? "O";
}

// ISO date string (YYYY-MM-DD) or null → DICOM date string (YYYYMMDD) or null
function dicomDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return isoDate.replace(/-/g, "").slice(0, 8);
}

// Date/timestamp → DICOM date (YYYYMMDD)
function dicomDateFromTs(ts: Date | string | null | undefined): string | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}${mo}${dy}`;
}

// Date/timestamp → DICOM time (HHMMSS)
function dicomTimeFromTs(ts: Date | string | null | undefined): string | null {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

// Build DICOM PatientName "LAST^FIRST"
function dicomPatientName(firstName: string | null, lastName: string | null): string {
  const last = (lastName ?? "").trim().toUpperCase();
  const first = (firstName ?? "").trim().toUpperCase();
  return last ? `${last}^${first}` : first;
}

// Map internal status → MWL status
function toMwlStatus(internalStatus: string): string {
  switch (internalStatus) {
    case "scheduled": return "SCHEDULED";
    case "in_progress": return "IN_PROGRESS";
    case "acquired": return "COMPLETED";
    case "reported_preliminary":
    case "reported_final":
    case "delivered": return "COMPLETED";
    case "cancelled": return "CANCELLED";
    default: return "SCHEDULED";
  }
}

// Map MWL status → internal status
function fromMwlStatus(mwlStatus: string): string {
  switch (mwlStatus.toUpperCase()) {
    case "SCHEDULED": return "scheduled";
    case "ARRIVED":   return "scheduled";   // arrived but not scanning yet
    case "IN_PROGRESS": return "in_progress";
    case "COMPLETED": return "acquired";
    case "CANCELLED": return "cancelled";
    default: return "scheduled";
  }
}

// ── GET /api/internal/radiology/mwl-orders ───────────────────────────────────
//
// Returns scheduled radiology orders in DICOM Modality Worklist (MWL) JSON.
// Filters: status=SCHEDULED|IN_PROGRESS|all  modality=MR|CT|...  date=YYYY-MM-DD
// Auth: Bearer INTERNAL_API_KEY

router.get("/radiology/mwl-orders", async (req, res) => {
  const mwlStatus = ((req.query.status as string) || "SCHEDULED").toUpperCase();
  const modality  = (req.query.modality as string) || "";
  const dateParam = (req.query.date as string) || "";

  // Translate MWL status filter → internal status list
  let internalStatuses: string[];
  if (mwlStatus === "ALL") {
    internalStatuses = ["scheduled", "in_progress", "acquired", "cancelled"];
  } else if (mwlStatus === "COMPLETED") {
    internalStatuses = ["acquired", "reported_preliminary", "reported_final", "delivered"];
  } else if (mwlStatus === "IN_PROGRESS") {
    internalStatuses = ["in_progress"];
  } else if (mwlStatus === "CANCELLED") {
    internalStatuses = ["cancelled"];
  } else {
    internalStatuses = ["scheduled"];
  }

  const conds = [
    internalStatuses.length === 1
      ? eq(radiologyStudiesTable.status, internalStatuses[0]!)
      : sql`${radiologyStudiesTable.status} = ANY(${internalStatuses})`,
  ];
  if (modality && modality !== "all") {
    conds.push(eq(radiologyStudiesTable.modality, modality));
  }
  if (dateParam) {
    // dateParam = YYYY-MM-DD → filter by study_date
    conds.push(eq(radiologyStudiesTable.studyDate, dateParam));
  }

  const rows = await db
    .select({
      id:                      radiologyStudiesTable.id,
      accessionNumber:         radiologyStudiesTable.accessionNumber,
      modality:                radiologyStudiesTable.modality,
      studyDescription:        radiologyStudiesTable.studyDescription,
      bodyPart:                radiologyStudiesTable.bodyPart,
      scheduledAt:             radiologyStudiesTable.scheduledAt,
      studyDate:               radiologyStudiesTable.studyDate,
      status:                  radiologyStudiesTable.status,
      scheduledStationAETitle: radiologyStudiesTable.scheduledStationAETitle,
      referringDoctor:         radiologyStudiesTable.referringDoctor,
      testId:                  radiologyStudiesTable.testId,
      orderId:                 radiologyStudiesTable.orderId,
      department:              radiologyStudiesTable.department,
      // patient fields
      patientDbId:   patientsTable.id,
      patientUhid:   patientsTable.patientId,
      firstName:     patientsTable.firstName,
      lastName:      patientsTable.lastName,
      gender:        patientsTable.gender,
      dateOfBirth:   patientsTable.dateOfBirth,
      phone:         patientsTable.phone,
    })
    .from(radiologyStudiesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .where(and(...conds))
    .orderBy(radiologyStudiesTable.scheduledAt)
    .limit(500);

  const mwlOrders = rows.map((r) => ({
    orderId:                 r.id,
    status:                  toMwlStatus(r.status),
    internalStatus:          r.status,
    // Patient demographics
    patientId:               r.patientUhid ?? String(r.patientDbId ?? ""),
    patientName:             dicomPatientName(r.firstName, r.lastName),
    sex:                     dicomSex(r.gender),
    patientSex:              dicomSex(r.gender),
    patientBirthDate:        dicomDate(r.dateOfBirth),
    phone:                   r.phone ?? null,
    // Study identification
    accessionNumber:         r.accessionNumber,
    testId:                  r.testId,
    modality:                r.modality,
    studyDescription:        r.studyDescription ?? null,
    bodyPart:                r.bodyPart ?? null,
    referringDoctor:         r.referringDoctor ?? null,
    // Schedule
    scheduledDate:           dicomDateFromTs(r.scheduledAt),
    scheduledTime:           dicomTimeFromTs(r.scheduledAt),
    scheduledStationAETitle: r.scheduledStationAETitle ?? null,
    department:              r.department ?? null,
  }));

  res.json(mwlOrders);
});

// ── POST /api/internal/radiology/mwl-order-status ────────────────────────────
//
// Update status of a radiology order from an MWL lifecycle event.
// Body: { orderId?, accessionNumber?, status, actor? }
// Valid statuses: SCHEDULED, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED
// Auth: Bearer INTERNAL_API_KEY

router.post("/radiology/mwl-order-status", async (req, res) => {
  const b = (req.body ?? {}) as {
    orderId?:        number;
    accessionNumber?: string;
    status?:         string;
    actor?:          string;
  };

  const VALID_MWL = ["SCHEDULED", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const mwlStatus = b.status?.toUpperCase().trim();
  if (!mwlStatus || !VALID_MWL.includes(mwlStatus)) {
    res.status(400).json({
      error: `status is required and must be one of: ${VALID_MWL.join(", ")}`,
    });
    return;
  }

  // Locate the study
  let study: typeof radiologyStudiesTable.$inferSelect | undefined;
  if (b.orderId) {
    const [r] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, b.orderId));
    study = r;
  }
  if (!study && b.accessionNumber) {
    const [r] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.accessionNumber, b.accessionNumber.trim()));
    study = r;
  }
  if (!study) {
    res.status(404).json({ error: "Radiology order not found — supply orderId or accessionNumber" });
    return;
  }

  const internalStatus = fromMwlStatus(mwlStatus);
  const updates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
    status: internalStatus,
    updatedAt: new Date(),
  };
  if (internalStatus === "in_progress" && !study.startedAt) updates.startedAt = new Date();
  if (internalStatus === "acquired"    && !study.acquiredAt) updates.acquiredAt = new Date();

  const [updated] = await db
    .update(radiologyStudiesTable)
    .set(updates)
    .where(eq(radiologyStudiesTable.id, study.id))
    .returning();

  // Agent-reported CANCELLED → drop Orthanc .wl + scheduled procedure (best-effort).
  if (mwlStatus === "CANCELLED" && updated.accessionNumber) {
    cancelRadiologyMwlByAccession(updated.accessionNumber, "mwl-order-status CANCELLED").catch((err) => {
      logger.warn({ err, accessionNumber: updated.accessionNumber }, "MWL cancel after mwl-order-status failed");
    });
  }

  await audit({
    accessionNumber: study.accessionNumber,
    action: "MWL_STATUS_UPDATED",
    actor: b.actor ?? "mwl-agent",
    details: { from: study.status, to: internalStatus, mwlStatus },
  });

  res.json({
    orderId:        updated.id,
    accessionNumber: updated.accessionNumber,
    internalStatus: updated.status,
    mwlStatus:      toMwlStatus(updated.status),
  });
});

// ── DICOM Pull Agent — internal endpoints ─────────────────────────────────────
// POST /api/internal/dicom-agent/heartbeat
// Called by the pull agent at the end of every poll cycle. Upserts the status
// row for (agentName, agentHost). Also optionally logs a HEARTBEAT event.

router.post("/dicom-agent/heartbeat", async (req, res) => {
  const b = (req.body ?? {}) as {
    agentName?: string;
    agentHost?: string;
    sourceAeTitle?: string;
    sourceIp?: string;
    modality?: string;
    status?: string;
    message?: string;
    stats?: {
      studiesFoundToday?: number;
      studiesPulledToday?: number;
      failedToday?: number;
    };
  };

  const agentName = b.agentName?.trim() || "default";
  const agentHost = b.agentHost?.trim() || "unknown";
  const now = new Date();
  const statusUpper = (b.status ?? "INFO").toUpperCase();
  const isError = statusUpper === "FAILED";
  const isSuccess = statusUpper === "SUCCESS";

  const [existing] = await db
    .select({ id: dicomPullAgentStatusTable.id })
    .from(dicomPullAgentStatusTable)
    .where(
      and(
        eq(dicomPullAgentStatusTable.agentName, agentName),
        eq(dicomPullAgentStatusTable.agentHost, agentHost),
      ),
    )
    .limit(1);

  type StatusPatch = Partial<typeof dicomPullAgentStatusTable.$inferInsert>;
  const patch: StatusPatch = {
    lastHeartbeatAt: now,
    isOnline: true,
  };
  if (isSuccess) patch.lastSuccessfulPullAt = now;
  if (isError) {
    patch.lastErrorAt = now;
    patch.lastErrorMessage = b.message ?? null;
  }
  if (b.stats?.studiesFoundToday  !== undefined) patch.studiesFoundToday  = b.stats.studiesFoundToday;
  if (b.stats?.studiesPulledToday !== undefined) patch.studiesPulledToday = b.stats.studiesPulledToday;
  if (b.stats?.failedToday        !== undefined) patch.failedToday        = b.stats.failedToday;

  if (existing) {
    await db.update(dicomPullAgentStatusTable)
      .set(patch)
      .where(eq(dicomPullAgentStatusTable.id, existing.id));
  } else {
    await db.insert(dicomPullAgentStatusTable).values({
      agentName,
      agentHost,
      lastHeartbeatAt: now,
      isOnline: true,
      lastSuccessfulPullAt: isSuccess ? now : null,
      lastErrorAt: isError ? now : null,
      lastErrorMessage: isError ? (b.message ?? null) : null,
      studiesFoundToday:  b.stats?.studiesFoundToday  ?? 0,
      studiesPulledToday: b.stats?.studiesPulledToday ?? 0,
      failedToday:        b.stats?.failedToday        ?? 0,
    });
  }

  // Optional: log the heartbeat itself so operators can see pulse in the log table.
  if (b.message) {
    try {
      await db.insert(dicomPullAgentLogsTable).values({
        agentName,
        agentHost,
        eventType: "HEARTBEAT",
        sourceAeTitle: b.sourceAeTitle ?? null,
        sourceIp:      b.sourceIp      ?? null,
        modality:      b.modality      ?? null,
        status:        statusUpper,
        message:       b.message,
      });
    } catch { /* non-fatal */ }
  }

  res.json({ ok: true, agentName, agentHost });
});

// POST /api/internal/dicom-agent/log
// Called by the pull agent for every operational event (C-ECHO, C-FIND, C-MOVE,
// C-STORE, ERP_POST, etc.). Also side-effects the status row when relevant.

router.post("/dicom-agent/log", async (req, res) => {
  const b = (req.body ?? {}) as {
    agentName?: string;
    agentHost?: string;
    eventType?: string;
    sourceAeTitle?: string;
    sourceIp?: string;
    modality?: string;
    studyInstanceUID?: string;
    accessionNumber?: string;
    patientName?: string;
    patientId?: string | number;
    status?: string;
    message?: string;
    rawPayload?: unknown;
  };

  if (!b.eventType?.trim() || !b.message?.trim()) {
    res.status(400).json({ error: "eventType and message are required" });
    return;
  }

  const agentName   = b.agentName?.trim()   || "default";
  const agentHost   = b.agentHost?.trim()   || "unknown";
  const statusUpper = (b.status ?? "INFO").toUpperCase();
  const eventType   = b.eventType.toUpperCase();

  const [inserted] = await db.insert(dicomPullAgentLogsTable).values({
    agentName,
    agentHost,
    eventType,
    sourceAeTitle: b.sourceAeTitle ?? null,
    sourceIp:      b.sourceIp      ?? null,
    modality:      b.modality?.toUpperCase() ?? null,
    studyInstanceUID: b.studyInstanceUID ?? null,
    accessionNumber:  b.accessionNumber  ?? null,
    patientName:   b.patientName ?? null,
    patientId:     b.patientId !== undefined ? String(b.patientId) : null,
    status:        statusUpper,
    message:       b.message,
    rawPayload:    b.rawPayload ? JSON.stringify(b.rawPayload) : null,
  }).returning({ id: dicomPullAgentLogsTable.id });

  // Side-effect: update status row if applicable
  if (statusUpper === "FAILED") {
    try {
      await db.update(dicomPullAgentStatusTable)
        .set({ lastErrorAt: new Date(), lastErrorMessage: b.message ?? null })
        .where(and(
          eq(dicomPullAgentStatusTable.agentName, agentName),
          eq(dicomPullAgentStatusTable.agentHost, agentHost),
        ));
    } catch { /* non-fatal */ }
  }
  if (statusUpper === "SUCCESS" && (eventType === "C_MOVE" || eventType === "C_GET" || eventType === "C_STORE")) {
    try {
      await db.update(dicomPullAgentStatusTable)
        .set({ lastSuccessfulPullAt: new Date() })
        .where(and(
          eq(dicomPullAgentStatusTable.agentName, agentName),
          eq(dicomPullAgentStatusTable.agentHost, agentHost),
        ));
    } catch { /* non-fatal */ }
  }

  res.json({ ok: true, id: inserted?.id ?? null });
});

// ── GET /api/internal/dicom-agent/config ─────────────────────────────────────
// Returns the full pull-agent configuration so the Windows/local agent can
// auto-fetch it every 5 minutes without manual config.json editing.
// Reads from dicomNodesTable (the new unified schema) and maps fields to the
// shape expected by both the legacy Windows agent and the new local bridge.
router.get("/dicom-agent/config", requireInternalApiKey, async (_req, res) => {
  const [settingsRows, nodes] = await Promise.all([
    db.select().from(pacsSettingsTable).where(eq(pacsSettingsTable.category, "conquest")),
    db.select().from(dicomNodesTable)
      .where(eq(dicomNodesTable.isActive, true))
      .orderBy(dicomNodesTable.aeTitle),
  ]);

  const sm: Record<string, string> = {};
  for (const row of settingsRows) {
    if (row.key && row.value != null) sm[row.key] = row.value;
  }

  // Map dicomNodesTable fields to the modality shape the agent expects
  const modalities = nodes.map((n) => ({
    id: n.id,
    machineName: n.aeTitle,
    aeTitle: n.aeTitle,
    ipAddress: n.host,
    host: n.host,
    port: n.port,
    modality: n.modality,
    location: n.location,
    description: n.description,
    isActive: n.isActive,
    autoPull: n.autoPull,
    pullIntervalSeconds: n.pullIntervalSeconds,
    queryLookbackHours: n.queryLookbackHours,
    conquestAeTitle: n.conquestAeTitle,
    conquestHost: n.conquestHost,
    conquestPort: n.conquestPort,
    preferredRetrieveMethod: n.preferredRetrieveMethod,
    watchFolderPath: n.watchFolderPath ?? "",
    processedFolderPath: n.processedFolderPath ?? "",
    failedFolderPath: n.failedFolderPath ?? "",
    name: n.name ?? n.aeTitle,
    allowNonDicomImages: n.allowNonDicomImages ?? false,
    maxUploadSizeMB: n.maxUploadSizeMB ?? 512,
    thumbnailPreview: n.thumbnailPreview ?? true,
    multiFrameSupport: n.multiFrameSupport ?? true,
  }));

  res.json({
    conquest: {
      host:    sm["conquest_host"]    ?? "127.0.0.1",
      port:    Number(sm["conquest_port"]    ?? 5678),
      aeTitle: sm["conquest_ae"]      ?? "CONQUEST1",
    },
    modalities,
    pullSettings: {
      pollIntervalMs:     Number(sm["pull_interval_ms"]     ?? 300_000),
      agentAeTitle:       sm["agent_ae_title"]              ?? "DIAGNO_AGENT",
      maxConcurrentJobs:  Number(sm["max_concurrent_jobs"]  ?? 3),
    },
    erpSettings: {
      heartbeatEndpoint: "/api/internal/dicom-agent/heartbeat",
      logEndpoint:       "/api/internal/dicom-agent/log",
      configEndpoint:    "/api/internal/dicom-agent/config",
    },
  });
});

// ── GET /api/internal/radiology/mwl ──────────────────────────────────────────
// Structured MWL JSON for the Windows DICOM MWL SCP agent.
// Returns scheduled procedures so the agent can serve DICOM C-FIND responses
// to imaging equipment (MRI, CT, X-Ray, Ultrasound).
// Protected by Bearer INTERNAL_API_KEY (requireInternalApiKey middleware).
router.get("/radiology/mwl", async (req, res) => {
  const { modality, date, status } = req.query as Record<string, string | undefined>;

  const conds = [];
  // Default: only scheduled + sent_to_mwl (not yet completed/cancelled)
  const statusFilter = status?.toUpperCase() ?? "ACTIVE";
  if (statusFilter === "ACTIVE") {
    conds.push(
      or(
        eq(radiologyScheduledProceduresTable.status, "SCHEDULED"),
        eq(radiologyScheduledProceduresTable.status, "SENT_TO_MWL"),
      )!,
    );
  } else if (statusFilter !== "ALL") {
    conds.push(eq(radiologyScheduledProceduresTable.status, statusFilter));
  }
  if (modality) conds.push(eq(radiologyScheduledProceduresTable.modality, modality.toUpperCase()));
  if (date) {
    const compact = date.replace(/-/g, "");
    conds.push(eq(radiologyScheduledProceduresTable.scheduledDate, compact));
  }

  const rows = await db
    .select()
    .from(radiologyScheduledProceduresTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(radiologyScheduledProceduresTable.createdAt))
    .limit(500);

  // Map to DICOM MWL-compatible field names
  const procedures = rows.map((r) => ({
    accessionNumber:             r.accessionNumber,
    studyDescription:            r.studyDescription ?? r.procedureName ?? "",
    requestedProcedureId:        r.procedureCode ?? r.accessionNumber,
    requestedProcedureDescription: r.procedureName ?? r.studyDescription ?? "",
    modality:                    r.modality ?? "OT",
    scheduledDate:               r.scheduledDate ?? "",
    scheduledTime:               r.scheduledTime ?? "",
    stationAeTitle:              r.stationAeTitle ?? "",
    bodyPartExamined:            r.bodyPartExamined ?? "",
    patientName:                 (r.patientName ?? "").toUpperCase().replace(/\s+/g, "^"),
    patientId:                   r.patientId ?? "",
    patientSex:                  sanitizeDicomSex(r.patientSex) ?? "",
    sex:                         sanitizeDicomSex(r.patientSex) ?? "",
    patientDob:                  (r.patientDob ?? "").replace(/-/g, ""),
    patientAge:                  r.patientAge ?? "",
    referringPhysicianName:      (r.referringDoctor ?? "").toUpperCase().replace(/\s+/g, "^"),
    status:                      r.status,
    sourceBillId:                r.sourceBillId ?? null,
    sourceOrderId:               r.sourceOrderId ?? null,
    id:                          r.id,
  }));

  res.json({
    count: procedures.length,
    fetchedAt: new Date().toISOString(),
    procedures,
  });
});

export default router;
