import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tcpProbe } from "../lib/pacs/providers.js";
import { getRadiologyConfig } from "../lib/pacs/pacsConfig.js";
import {
  radiologyStudiesTable, radiologyFilmIssuesTable, radiologyShareLinksTable,
  testsTable, patientsTable, ordersTable, orderTestsTable,
  billsTable, reportTemplatesTable, staffTable, radiologyPromptsTable,
  radiologyWorklistTable, radiologyAuditLogTable,
  pacsSettingsTable, dicomModalitiesTable, pacsLogsTable,
  radiologyConfigChangesTable,
  radiologyPriorityRulesTable,
  radiologistAssignmentRulesTable,
  radiologistSubspecialtiesTable,
  radiologistWorkloadsTable,
  usersTable,
  radiologyReportVerificationsTable,
  radiologyCriticalFindingsTable,
  radiologyTatTrackingTable,
  radiologyStructuredTemplatesTable,
  radiologyAiEnhancementsTable,
  radiologyDicomMeasurementsTable,
  teleradiologySitesTable,
  radiologyMultiSiteWorklistTable,
  dicomRoutingOptimizationLogTable,
  radiologyStudyLocksTable,
  radiologyChocolateFindingsTable,
  radiologyUserFindingsPreferencesTable,
  radiologyUserReportPreferencesTable,
  radiologyUserItemUsageLogsTable,
  radiologyInstitutionalStylesTable,
  usgMeasurementsTable,
  usgKeyImagesTable,
  usgReportDraftsTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { FULL_ACCESS_ROLES, type StaffAuthRequest } from "../middleware/requireStaffAuth.js";
import { computeStudyPriority } from "../lib/studyPriorityEngine";
import { getLockTtlSeconds } from "../lib/studyLocks";
import { lockExpiresAt } from "../lib/studyLockRules";
import { assignRadiologistToStudy } from "../lib/radiologistAssignment";
import { createVerificationRecord, recordPrelimReport, recordPeerReview, verifyReport, finalizeReport, getVerificationQueue } from "../lib/peerReview";
import { flagCriticalFinding, scanForCriticalFindings, getCriticalFindingsForStudy, acknowledgeFinding } from "../lib/criticalFindingsAlert";
import { startTatTracking, recordPrelimCompleted, recordFinalCompleted, getTatStats, getTatForStudy } from "../lib/tatTracker";
import { generateAiEnhancement, getAiEnhancement, acceptAiEnhancement, rejectAiEnhancement } from "../lib/aiReportEnhancer";
import { syncStudyToSite, getMultiSiteWorklist, getSites } from "../lib/multiSiteWorklist";
import { decideRouting, getRoutingStats } from "../lib/dicomRoutingOptimizer";
import { runMatchingEngineForWorklist } from "./internal-radiology";
import { calculateMatchScore } from "../lib/pacs/matchingEngine";
import { publishRadiologyStudyToMwl } from "../lib/pacs/publishRadiologyStudyToMwl";
import { logger } from "../lib/logger";

// Build an absolute https URL for share-link composition. Trusts the standard
// reverse-proxy headers `x-forwarded-proto` / `x-forwarded-host`. The proxy
// terminates TLS so we don't need a host allowlist for the dev environment;
// production deployments behind Replit's edge already canonicalise these.
function absoluteBase(req: { headers: Record<string, string | string[] | undefined>; protocol?: string }): string {
  const protoHdr = req.headers["x-forwarded-proto"];
  const hostHdr = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (Array.isArray(protoHdr) ? protoHdr[0] : protoHdr) || req.protocol || "https";
  const host = (Array.isArray(hostHdr) ? hostHdr[0] : hostHdr) || "";
  return `${proto}://${host}`;
}

export const radiologyRouter: IRouter = Router();

// Departments that map to a radiology workflow + their DICOM modality codes.
const MODALITY_MAP: Record<string, string> = {
  "X-Ray": "CR",
  "USG": "US",
  "MRI": "MR",
  "CT": "CT",
  "Mammography": "MG",
  "DEXA": "BMD",
};
const RADIOLOGY_DEPARTMENTS = Object.keys(MODALITY_MAP);

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function compactToday(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// Computes the next accession number candidate for a (date, modality) pair by
// taking MAX(seq) + 1 over today's rows. This is racy by itself — two concurrent
// callers can derive the same number — so callers MUST wrap the INSERT in a
// retry loop and call this again on `radiology_studies_accession_uq` collision.
async function nextAccessionNumber(modality: string): Promise<string> {
  const today = compactToday();
  const prefix = `ACC-${today}-${modality}-`;
  const result = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(CAST(SPLIT_PART(accession_number, '-', 4) AS INTEGER)), 0) + 1 AS n
      FROM ${radiologyStudiesTable}
     WHERE accession_number LIKE ${prefix + "%"}
  `);
  const rows = (result as unknown as { rows?: Array<{ n: number }> }).rows
    ?? (result as unknown as Array<{ n: number }>);
  const n = rows[0]?.n ?? 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

// Used by bills.ts to fan out studies for fresh orders. Idempotent per
// orderTestId via UNIQUE index `radiology_studies_order_test_uq`.
export async function generateStudiesForOrder(opts: {
  billId: number;
  orderId: number;
  patientId: number;
  priority?: "stat" | "emergency" | "urgent" | "vip" | "routine";
  dicomFields?: {
    studyDescription?: string;
    bodyPart?: string;
    scheduledStationAETitle?: string;
    referringDoctor?: string;
  };
}): Promise<Array<{ orderTestId: number; testName: string; modality: string; accessionNumber: string }>> {
  const orderTests = await db
    .select({
      orderTestId: orderTestsTable.id,
      testId: orderTestsTable.testId,
      testName: testsTable.name,
      department: testsTable.department,
      roomNumber: testsTable.roomNumber,
    })
    .from(orderTestsTable)
    .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .where(eq(orderTestsTable.orderId, opts.orderId));

  const out: Array<{ orderTestId: number; testName: string; modality: string; accessionNumber: string }> = [];
  for (const ot of orderTests) {
    const department = ot.department || "";
    if (!RADIOLOGY_DEPARTMENTS.includes(department)) continue; // skip non-radiology tests
    const modality = MODALITY_MAP[department] ?? "OT";

    // Resolve priority + reason BEFORE the insert so it lands in the single
    // INSERT for both branches — one committed write per study instead of an
    // insert followed by an applyPriorityToStudy UPDATE. Caller-supplied
    // priority (the billing desk always sends one) keeps its historical
    // "VIP Patient Flag" reason; otherwise the priority engine computes it.
    let priority: NonNullable<typeof opts.priority> = opts.priority ?? "routine";
    let priorityReason = "VIP Patient Flag";
    if (!opts.priority) {
      try {
        const priorityResult = await computeStudyPriority({
          modality,
          bodyPart: opts.dicomFields?.bodyPart ?? null,
          studyDescription: opts.dicomFields?.studyDescription ?? null,
          referringDoctor: opts.dicomFields?.referringDoctor ?? null,
        });
        priority = priorityResult.priority;
        priorityReason = priorityResult.reason;
      } catch {
        // Never block study creation on priority computation failure
        priority = "routine";
        priorityReason = "Default (priority engine unavailable)";
      }
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const accessionNumber = await nextAccessionNumber(modality);
      try {
        const [row] = await db.insert(radiologyStudiesTable).values({
          accessionNumber,
          billId: opts.billId,
          orderId: opts.orderId,
          orderTestId: ot.orderTestId,
          patientId: opts.patientId,
          testId: ot.testId,
          modality,
          department,
          roomNumber: ot.roomNumber || "",
          status: "scheduled",
          studyDate: todayISO(),
          priority,
          priorityReason,
          ...(opts.dicomFields?.studyDescription ? { studyDescription: opts.dicomFields.studyDescription } : {}),
          ...(opts.dicomFields?.bodyPart ? { bodyPart: opts.dicomFields.bodyPart } : {}),
          ...(opts.dicomFields?.scheduledStationAETitle ? { scheduledStationAETitle: opts.dicomFields.scheduledStationAETitle } : {}),
          ...(opts.dicomFields?.referringDoctor ? { referringDoctor: opts.dicomFields.referringDoctor } : {}),
        }).returning();

        // ── Auto-assignment (Phase 1 enterprise upgrade) ──
        try {
          await assignRadiologistToStudy(row.id, {
            modality,
            bodyPart: opts.dicomFields?.bodyPart ?? null,
            studyId: row.id,
          });
        } catch {
          // Never block study creation on assignment failure
        }

        // ── Antigravity MWL path: ERP names + accession → modality ──
        // Best-effort. Always inserts radiology_scheduled_procedures (queried by
        // the Windows MWL agent). Writes Orthanc .wl when ORTHANC_WORKLIST_DIR
        // is set. Return match uses accession (work id) + optional CARE-BILL.
        try {
          await publishRadiologyStudyToMwl({
            accessionNumber: row.accessionNumber,
            patientId: opts.patientId,
            billId: opts.billId,
            orderId: opts.orderId,
            modality,
            procedureName: ot.testName,
            studyDescription: opts.dicomFields?.studyDescription ?? ot.testName,
            referringDoctor: opts.dicomFields?.referringDoctor ?? row.referringDoctor ?? null,
            bodyPart: opts.dicomFields?.bodyPart ?? null,
            stationAeTitle: opts.dicomFields?.scheduledStationAETitle ?? null,
          });
        } catch {
          // Never block study creation on MWL publish failure
        }

        out.push({ orderTestId: ot.orderTestId, testName: ot.testName, modality, accessionNumber: row.accessionNumber });
        lastErr = null;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/radiology_studies_order_test_uq/i.test(msg)) {
          // already issued for this order test — idempotent skip
          lastErr = null;
          break;
        }
        if (/radiology_studies_accession_uq/i.test(msg)) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

// ── Missing-study reconciliation ────────────────────────────────────────────
// Safety net for the study fan-out: bills.ts fires generateStudiesForOrder
// without awaiting it (so the receipt prints without waiting on per-study
// accession allocation + radiologist assignment), and even before that the
// fan-out was log-and-continue — an error or a process restart could leave a
// PAID radiology test with no study row, invisible to the worklist. This
// sweep finds billed radiology order-tests from the last 48h that have no
// radiology_studies row and re-runs the (idempotent, unique-per-orderTest)
// fan-out for them. Called at startup and on an interval from index.ts.
export async function reconcileMissingStudies(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const missing = await db
    .selectDistinct({
      orderId: orderTestsTable.orderId,
      patientId: ordersTable.patientId,
      billId: billsTable.id,
    })
    .from(orderTestsTable)
    .innerJoin(testsTable, eq(testsTable.id, orderTestsTable.testId))
    .innerJoin(ordersTable, eq(ordersTable.id, orderTestsTable.orderId))
    .innerJoin(billsTable, eq(billsTable.orderId, ordersTable.id))
    .leftJoin(radiologyStudiesTable, eq(radiologyStudiesTable.orderTestId, orderTestsTable.id))
    .where(and(
      inArray(testsTable.department, RADIOLOGY_DEPARTMENTS),
      isNull(radiologyStudiesTable.id),
      sql`${billsTable.status} != 'cancelled'`,
      gte(billsTable.createdAt, cutoff),
    ));

  let recovered = 0;
  for (const row of missing) {
    try {
      // priority intentionally omitted: the priority engine computes it,
      // same as any non-billing-desk study creation.
      const created = await generateStudiesForOrder({
        billId: row.billId,
        orderId: row.orderId,
        patientId: row.patientId,
      });
      recovered += created.length;
      if (created.length > 0) {
        logger.warn({ orderId: row.orderId, billId: row.billId, created: created.length }, "reconciled missing radiology studies for billed order");
      }
    } catch (err) {
      logger.warn({ err, orderId: row.orderId }, "missing-study reconciliation failed for order");
    }
  }
  return recovered;
}

// ── Worklist ────────────────────────────────────────────────────────────────
// GET /api/radiology/worklist?date=&status=&modality=&search=&assigned=
//   assigned=unclaimed → studies awaiting a radiologist (acquired/in-prelim, no claim)
//   assigned=mine&staffId=NN → studies claimed by the given staff
radiologyRouter.get("/worklist", async (req, res) => {
  const date = (req.query.date as string) || todayISO();
  const status = (req.query.status as string) || "";
  const modality = (req.query.modality as string) || "";
  const search = (req.query.search as string)?.trim() || "";
  const assigned = (req.query.assigned as string) || "";
  // staffId is only meaningful for `assigned=mine`. Reject malformed values
  // (e.g. "undefined") with a 400 instead of silently coercing to 0 and
  // returning an empty worklist that looks like "you have no studies".
  const rawStaffId = req.query.staffId;
  let staffId: number | null = null;
  if (rawStaffId !== undefined && rawStaffId !== null && rawStaffId !== "") {
    const n = Number(rawStaffId);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400).json({ error: "Invalid staffId" });
      return;
    }
    staffId = n;
  }

  const conds = [eq(radiologyStudiesTable.studyDate, date)];
  if (status && status !== "all") conds.push(eq(radiologyStudiesTable.status, status));
  if (modality && modality !== "all") conds.push(eq(radiologyStudiesTable.modality, modality));
  if (assigned === "unclaimed") {
    conds.push(isNull(radiologyStudiesTable.assignedRadiologistId));
  } else if (assigned === "mine") {
    if (staffId === null) {
      res.status(400).json({ error: "assigned=mine requires staffId" });
      return;
    }
    conds.push(eq(radiologyStudiesTable.assignedRadiologistId, staffId));
  }

  const rows = await db
    .select({
      id: radiologyStudiesTable.id,
      accessionNumber: radiologyStudiesTable.accessionNumber,
      modality: radiologyStudiesTable.modality,
      department: radiologyStudiesTable.department,
      roomNumber: radiologyStudiesTable.roomNumber,
      status: radiologyStudiesTable.status,
      scheduledAt: radiologyStudiesTable.scheduledAt,
      startedAt: radiologyStudiesTable.startedAt,
      acquiredAt: radiologyStudiesTable.acquiredAt,
      deliveredAt: radiologyStudiesTable.deliveredAt,
      numImages: radiologyStudiesTable.numImages,
      studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
      technicianId: radiologyStudiesTable.technicianId,
      technicianName: radiologyStudiesTable.technicianName,
      assignedRadiologistId: radiologyStudiesTable.assignedRadiologistId,
      assignedRadiologistName: radiologyStudiesTable.assignedRadiologistName,
      claimedAt: radiologyStudiesTable.claimedAt,
      studyDate: radiologyStudiesTable.studyDate,
      prelimReportedAt: radiologyStudiesTable.prelimReportedAt,
      finalReportedAt: radiologyStudiesTable.finalReportedAt,
      hasPrelim: sql<boolean>`(${radiologyStudiesTable.prelimReport} IS NOT NULL AND length(${radiologyStudiesTable.prelimReport}) > 0)`,
      hasFinal: sql<boolean>`(${radiologyStudiesTable.finalReport} IS NOT NULL AND length(${radiologyStudiesTable.finalReport}) > 0)`,
      patientId: patientsTable.id,
      patientCode: patientsTable.patientId,
      patientName: sql<string>`COALESCE(${patientsTable.firstName} || ' ' || ${patientsTable.lastName}, '')`,
      patientPhone: patientsTable.phone,
      patientGender: patientsTable.gender,
      testId: testsTable.id,
      testCode: testsTable.code,
      testName: testsTable.name,
      billId: billsTable.id,
      billNumber: billsTable.billNumber,
      lockUserId: radiologyStudyLocksTable.userId,
      lockUserName: radiologyStudyLocksTable.userName,
      lockTime: radiologyStudyLocksTable.lockTime,
      lockLastActivityAt: radiologyStudyLocksTable.lastActivityAt,
      lockWorkstation: radiologyStudyLocksTable.workstation,
    })
    .from(radiologyStudiesTable)
    .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
    .leftJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
    .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
    .leftJoin(radiologyStudyLocksTable, eq(radiologyStudyLocksTable.studyId, radiologyStudiesTable.id))
    .where(and(...conds))
    .orderBy(asc(radiologyStudiesTable.scheduledAt));

  let filtered = rows;
  if (search) {
    const s = search.toLowerCase();
    filtered = rows.filter((r) =>
      r.accessionNumber.toLowerCase().includes(s) ||
      (r.patientName ?? "").toLowerCase().includes(s) ||
      (r.patientCode ?? "").toLowerCase().includes(s) ||
      (r.patientPhone ?? "").toLowerCase().includes(s) ||
      (r.testName ?? "").toLowerCase().includes(s) ||
      (r.testCode ?? "").toLowerCase().includes(s)
    );
  }
  res.json(filtered);
});

// GET /api/radiology/pacs-worklist/count — total rows in radiology_worklist (no filters).
// Used by the frontend debug panel to show the raw DB row count independent of filters.
radiologyRouter.get("/pacs-worklist/count", async (req, res) => {
  const result = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::text AS n FROM radiology_worklist`
  );
  const rows = (result as unknown as { rows?: Array<{ n: string }> }).rows
    ?? (result as unknown as Array<{ n: string }>);
  const totalRows = parseInt(rows[0]?.n ?? "0", 10);
  req.log.info({ totalRows }, "[pacs-worklist/count] DB row count");
  res.json({ totalRows });
});

// GET /api/radiology/pacs-worklist?status=&modality=&search=
// Staff-authenticated view of radiology_worklist (PACS-pushed studies).
// Different from /api/radiology/worklist which queries radiology_studies (RIS-driven).
radiologyRouter.get("/pacs-worklist", async (req, res) => {
  try {
    const status = (req.query.status as string) || "";
    const modality = (req.query.modality as string) || "";
    const search = (req.query.search as string)?.trim() || "";

    req.log.info({ status: status || "all", modality: modality || "all", search: search || "" }, "[pacs-worklist] route hit — staff auth passed");

    const conds: ReturnType<typeof eq>[] = [];
    if (status && status !== "all") conds.push(eq(radiologyWorklistTable.status, status));
    if (modality && modality !== "all") conds.push(eq(radiologyWorklistTable.modality, modality));

    const rows = await db
      .select({
        id: radiologyWorklistTable.id,
        studyId: radiologyWorklistTable.studyId,
        patientId: radiologyWorklistTable.patientId,
        dicomPatientId: radiologyWorklistTable.dicomPatientId,
        patientMatchStatus: radiologyWorklistTable.patientMatchStatus,
        patientName: radiologyWorklistTable.patientName,
        age: radiologyWorklistTable.age,
        sex: radiologyWorklistTable.sex,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
        studyDate: radiologyWorklistTable.studyDate,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        aeTitle: radiologyWorklistTable.aeTitle,
        ipAddress: radiologyWorklistTable.ipAddress,
        port: radiologyWorklistTable.port,
        referringDoctor: radiologyWorklistTable.referringDoctor,
        weasisUrl: radiologyWorklistTable.weasisUrl,
        sourcePacs: radiologyWorklistTable.sourcePacs,
        sourceAeTitle: radiologyWorklistTable.sourceAeTitle,
        dicomMetadata: radiologyWorklistTable.dicomMetadata,
        status: radiologyWorklistTable.status,
        assignedRadiologist: radiologyWorklistTable.assignedRadiologist,
        // M1.6B1 — id-based assignment (organizational ownership)
        assignedRadiologistId: radiologyWorklistTable.assignedRadiologistId,
        assignedAt: radiologyWorklistTable.assignedAt,
        assignedByName: radiologyWorklistTable.assignedByName,
        aiDraftStatus: radiologyWorklistTable.aiDraftStatus,
        aiDraftJson: radiologyWorklistTable.aiDraftJson,
        aiFeedback: radiologyWorklistTable.aiFeedback,
        aiFeedbackAt: radiologyWorklistTable.aiFeedbackAt,
        reportId: radiologyWorklistTable.reportId,
        deliveryStatus: radiologyWorklistTable.deliveryStatus,
        createdAt: radiologyWorklistTable.createdAt,
        updatedAt: radiologyWorklistTable.updatedAt,
        // M1.6A — real lock columns.
        lockUserId: radiologyWorklistTable.lockUserId,
        lockUserName: radiologyWorklistTable.lockUserName,
        lockTime: radiologyWorklistTable.lockTime,
        lockLastActivityAt: radiologyWorklistTable.lockLastActivityAt,
        lockWorkstation: radiologyWorklistTable.lockWorkstation,
        // Phase C (unified worklist) — ADDITIVE fields only, no schema change.
        // UHID from the matched ERP patient; bill number resolved via the
        // linked study (radiology_studies.bill_id → bills.bill_number).
        uhid: patientsTable.patientId,
        billNumber: billsTable.billNumber,
        // Catalog test name when worklist row is linked to a billed study
        // (e.g. "MRI BRAIN PLAIN"); falls back to DICOM studyDescription in UI.
        testName: testsTable.name,
        // Priority REUSES the existing radiology_studies.priority column
        // (stat | emergency | urgent | routine | vip) via the same join —
        // no new table or column created (schema-growth minimization).
        priority: radiologyStudiesTable.priority,
        // R2.0 — canonical ultrasound integration: fold USG/Doppler
        // measurement + key-image counts and the latest report-draft status
        // into the ONE PACS worklist row, so USG studies never need a
        // separate worklist. Scalar subqueries (not a GROUP BY) to keep this
        // additive and avoid touching the existing filter/sort/pagination
        // logic above — each of the three tables already carries an index
        // on worklist_id (see usgMeasurements.ts), so this is cheap even
        // computed unconditionally for every row.
        usgMeasurementCount: sql<number>`(
          select count(*) from ${usgMeasurementsTable}
          where ${usgMeasurementsTable.worklistId} = ${radiologyWorklistTable.id}
        )`.mapWith(Number),
        usgKeyImageCount: sql<number>`(
          select count(*) from ${usgKeyImagesTable}
          where ${usgKeyImagesTable.worklistId} = ${radiologyWorklistTable.id}
        )`.mapWith(Number),
        usgReportStatus: sql<string | null>`(
          select ${usgReportDraftsTable.status} from ${usgReportDraftsTable}
          where ${usgReportDraftsTable.worklistId} = ${radiologyWorklistTable.id}
          order by ${usgReportDraftsTable.updatedAt} desc
          limit 1
        )`,
      })
      .from(radiologyWorklistTable)
      .leftJoin(patientsTable, eq(radiologyWorklistTable.patientId, patientsTable.id))
      .leftJoin(radiologyStudiesTable, eq(radiologyWorklistTable.studyId, radiologyStudiesTable.id))
      .leftJoin(billsTable, eq(radiologyStudiesTable.billId, billsTable.id))
      .leftJoin(testsTable, eq(radiologyStudiesTable.testId, testsTable.id))
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(500);

    // M1.6A — serve lock expiry SERVER-computed (lock_last_activity_at +
    // configured TTL), so no client derives it from its own clock or a
    // guessed TTL window.
    const lockTtlSeconds = await getLockTtlSeconds();
    const rowsWithExpiry = rows.map((r) => ({
      ...r,
      lockTtlSeconds,
      lockExpiresAt: lockExpiresAt(r, lockTtlSeconds)?.toISOString() ?? null,
    }));

    let filtered = rowsWithExpiry;
    if (search) {
      const s = search.toLowerCase();
      filtered = rowsWithExpiry.filter((r) =>
        (r.patientName ?? "").toLowerCase().includes(s) ||
        (r.accessionNumber ?? "").toLowerCase().includes(s) ||
        (r.studyDescription ?? "").toLowerCase().includes(s) ||
        ((r as any).testName ?? "").toLowerCase().includes(s) ||
        (r.referringDoctor ?? "").toLowerCase().includes(s) ||
        ((r as any).uhid ?? "").toLowerCase().includes(s) ||
        ((r as any).billNumber ?? "").toLowerCase().includes(s)
      );
    }

    req.log.info({ rowsReturned: filtered.length, rawRows: rows.length, status: status || "all", modality: modality || "all" }, "[pacs-worklist] query complete");
    res.json(filtered);
  } catch (err: any) {
    req.log.error(err, "[pacs-worklist] Route Error");
    res.status(500).json({ error: "Internal server error", message: err.message, stack: err.stack });
  }
});


/**
 * GET /api/radiology/pacs-worklist/:id/ai-draft
 * Retrieve the stored AI draft JSON for a worklist entry.
 */
radiologyRouter.get("/pacs-worklist/:id/ai-draft", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ aiDraftJson: radiologyWorklistTable.aiDraftJson, aiDraftStatus: radiologyWorklistTable.aiDraftStatus })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let draft: Record<string, unknown> | null = null;
  try {
    if (row.aiDraftJson) draft = JSON.parse(row.aiDraftJson) as Record<string, unknown>;
  } catch {
    draft = null;
  }

  res.json({
    id,
    aiDraftStatus: row.aiDraftStatus,
    draft,
    safetyNote: "AI Draft — Requires Radiologist Review",
  });
});

/**
 * POST /api/radiology/pacs-worklist/:id/ai-feedback
 * Phase 11: Radiologist feedback on an AI draft (thumbs up/down + optional text).
 */
radiologyRouter.post("/pacs-worklist/:id/ai-feedback", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { verdict, notes } = req.body as { verdict?: "helpful" | "needs_improvement" | "inaccurate"; notes?: string };
  if (!verdict || !["helpful", "needs_improvement", "inaccurate"].includes(verdict)) {
    res.status(400).json({ error: "verdict must be helpful | needs_improvement | inaccurate" }); return;
  }

  const feedbackJson = JSON.stringify({
    verdict,
    notes: notes?.trim() ?? "",
    radiologist: sReq.staffSession.subjectName,
    radiologistId: sReq.staffSession.subjectId,
  });

  const [row] = await db
    .update(radiologyWorklistTable)
    .set({ aiFeedback: feedbackJson, aiFeedbackAt: new Date(), updatedAt: new Date() })
    .where(eq(radiologyWorklistTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Also log into the audit table for compliance
  await db.insert(radiologyAuditLogTable).values({
    worklistId: id,
    accessionNumber: row.accessionNumber ?? "",
    action: "AI_DRAFT_FEEDBACK",
    actor: sReq.staffSession.subjectName,
    details: feedbackJson,
  });

  res.json({ ok: true });
});

// GET /api/radiology/options — modalities + departments + status enum
radiologyRouter.get("/options", (_req, res) => {
  res.json({
    modalities: Object.entries(MODALITY_MAP).map(([department, code]) => ({ department, code })),
    statuses: ["scheduled", "in_progress", "acquired", "reported_preliminary", "reported_final", "delivered", "cancelled"],
  });
});

radiologyRouter.get("/:id/pacs-url", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [study] = await db
    .select({
      id: radiologyStudiesTable.id,
      studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
    })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, id));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }
  
  const cfg = await getRadiologyConfig();
  const orthancUrl = (cfg.orthanc.dicomWebUrl || "").replace(/\/dicom-web$/, "").replace(/\/$/, "");
  const studyInstanceUID = study.studyInstanceUid || "";
  
  const ohifBase = cfg.ohif.baseUrl || "";
  const wadoUrl = cfg.orthanc.wadoUrl || `${orthancUrl}/wado`;

  res.json({
    studyInstanceUID,
    orthancViewerUrl: orthancUrl ? `${orthancUrl}/app/explorer.html#study?uuid=${study.id}` : "",
    weasisUrl: orthancUrl && studyInstanceUID
      ? `weasis://$dicom:get -r "${wadoUrl}?requestType=WADO&studyUID=${studyInstanceUID}&contentType=application/dicom"`
      : "",
    ohifUrl: ohifBase && studyInstanceUID
      ? `${ohifBase}/viewer?StudyInstanceUIDs=${studyInstanceUID}`
      : null,
  });
});

// GET /api/radiology/technicians — radiology technicians for assignment dropdown
radiologyRouter.get("/technicians", async (_req, res) => {
  const rows = await db
    .select({
      id: staffTable.id,
      name: sql<string>`${staffTable.firstName} || ' ' || ${staffTable.lastName}`,
      role: staffTable.role,
      department: staffTable.department,
    })
    .from(staffTable)
    .where(eq(staffTable.isActive, true))
    .orderBy(asc(staffTable.firstName));
  // Soft-filter to radiology-relevant staff but keep everyone available.
  const ranked = rows.map((s) => ({
    ...s,
    isRadiology:
      /radio|tech|x-?ray|ct|mri|usg|sonograph/i.test(s.role || "") ||
      /radio|tech|imaging/i.test(s.department || ""),
  }));
  ranked.sort((a, b) => Number(b.isRadiology) - Number(a.isRadiology));
  res.json(ranked);
});

// GET /api/radiology/templates/:testId — report templates for a test
radiologyRouter.get("/templates/:testId", async (req, res) => {
  const testId = Number(req.params.testId);
  if (!Number.isFinite(testId)) { res.status(400).json({ error: "Invalid testId" }); return; }
  const rows = await db
    .select()
    .from(reportTemplatesTable)
    .where(eq(reportTemplatesTable.testId, testId))
    .orderBy(desc(reportTemplatesTable.isDefault), asc(reportTemplatesTable.name));
  res.json(rows);
});

// GET /api/radiology/studies/:id — single study with full detail
radiologyRouter.get("/studies/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, id));
  if (!row) { res.status(404).json({ error: "Study not found" }); return; }
  res.json(row);
});

// POST /api/radiology/studies — manual create (walk-in / external referral)
radiologyRouter.post("/studies", async (req, res) => {
  const body = req.body as {
    patientId: number;
    testId: number;
    department?: string;
    modality?: string;
    notes?: string;
    technicianId?: number;
    // DICOM MWL fields (optional at creation, required before in_progress)
    bodyPart?: string;
    studyDescription?: string;
    scheduledStationAETitle?: string;
    referringDoctor?: string;
  };
  if (!body.patientId || !body.testId) {
    res.status(400).json({ error: "patientId and testId required" }); return;
  }
  const department = body.department || "";
  const modality = body.modality || MODALITY_MAP[department] || "OT";
  let technicianName: string | null = null;
  if (body.technicianId) {
    const [s] = await db.select().from(staffTable).where(eq(staffTable.id, body.technicianId));
    if (s) technicianName = `${s.firstName} ${s.lastName}`.trim();
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const accessionNumber = await nextAccessionNumber(modality);
    try {
      const [row] = await db.insert(radiologyStudiesTable).values({
        accessionNumber,
        patientId: body.patientId,
        testId: body.testId,
        department: department || "X-Ray",
        modality,
        technicianId: body.technicianId ?? null,
        technicianName,
        notes: body.notes ?? null,
        status: "scheduled",
        studyDate: todayISO(),
        // DICOM MWL fields — optional at creation
        bodyPart:                body.bodyPart?.trim() || null,
        studyDescription:        body.studyDescription?.trim() || null,
        scheduledStationAETitle: body.scheduledStationAETitle?.trim() || null,
        referringDoctor:         body.referringDoctor?.trim() || null,
      }).returning();
      res.status(201).json(row); return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/radiology_studies_accession_uq/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
        continue;
      }
      throw err;
    }
  }
  res.status(500).json({ error: "Could not allocate accession number" });
});

// Valid DICOM modality codes accepted by MWL. Studies must use one of these
// before moving to in_progress (i.e., ready-for-scan) status.
const DICOM_MWL_MODALITIES = ["MR", "CT", "DX", "CR", "US", "MG"] as const;

// PATCH /api/radiology/studies/:id — update status, technician, num images, notes,
// and the new DICOM MWL fields (bodyPart, studyDescription, scheduledStationAETitle,
// referringDoctor). A study cannot move to in_progress unless all mandatory DICOM
// MWL fields are populated.
radiologyRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as {
    status?: string;
    technicianId?: number | null;
    numImages?: number;
    notes?: string;
    studyInstanceUid?: string;
    clinicalHistory?: string | null;
    // DICOM MWL fields
    bodyPart?: string | null;
    studyDescription?: string | null;
    scheduledStationAETitle?: string | null;
    referringDoctor?: string | null;
  };

  const updates: Partial<typeof radiologyStudiesTable.$inferInsert> = {};

  if (body.status !== undefined) {
    const valid = ["scheduled", "in_progress", "acquired", "reported_preliminary", "reported_final", "delivered", "cancelled"];
    if (!valid.includes(body.status)) { res.status(400).json({ error: "Invalid status" }); return; }

    // ── DICOM MWL gate: validate mandatory fields before allowing in_progress ─
    if (body.status === "in_progress") {
      // Fetch current study + patient in one join so we can check all
      // mandatory fields including demographics that live on the patient row.
      const [current] = await db
        .select({
          modality:                radiologyStudiesTable.modality,
          studyDescription:        radiologyStudiesTable.studyDescription,
          bodyPart:                radiologyStudiesTable.bodyPart,
          scheduledStationAETitle: radiologyStudiesTable.scheduledStationAETitle,
          referringDoctor:         radiologyStudiesTable.referringDoctor,
          gender:                  patientsTable.gender,
          phone:                   patientsTable.phone,
          dateOfBirth:             patientsTable.dateOfBirth,
        })
        .from(radiologyStudiesTable)
        .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
        .where(eq(radiologyStudiesTable.id, id));

      if (!current) { res.status(404).json({ error: "Study not found" }); return; }

      // Merge the pending update values with existing DB values so the caller
      // can set the MWL fields AND change status to in_progress in one PATCH.
      const effectiveModality   = current.modality;
      const effectiveStudyDesc  = (body.studyDescription  ?? current.studyDescription)?.trim();
      const effectiveBodyPart   = (body.bodyPart           ?? current.bodyPart)?.trim();
      const effectiveStationAE  = (body.scheduledStationAETitle ?? current.scheduledStationAETitle)?.trim();
      const effectiveRefDoc     = (body.referringDoctor    ?? current.referringDoctor)?.trim();

      const missing: string[] = [];
      if (!DICOM_MWL_MODALITIES.includes(effectiveModality as typeof DICOM_MWL_MODALITIES[number])) {
        missing.push(`modality must be one of ${DICOM_MWL_MODALITIES.join(", ")} (current: "${effectiveModality}")`);
      }
      if (!effectiveStudyDesc)  missing.push("studyDescription");
      if (!effectiveBodyPart)   missing.push("bodyPart");
      if (!effectiveStationAE)  missing.push("scheduledStationAETitle");
      if (!effectiveRefDoc)     missing.push("referringDoctor");
      if (!current.gender?.trim())     missing.push("patient sex/gender");
      if (!current.phone?.trim())      missing.push("patient mobile/phone");
      if (!current.dateOfBirth?.trim()) missing.push("patient date of birth");

      if (missing.length > 0) {
        res.status(422).json({
          error: "Cannot move to in_progress: mandatory DICOM MWL fields are missing",
          missing,
          hint: "Populate all required fields before marking the study as ready-for-scan.",
        });
        return;
      }
    }

    updates.status = body.status;
    if (body.status === "in_progress") updates.startedAt = new Date();
    if (body.status === "acquired") updates.acquiredAt = new Date();
    if (body.status === "delivered") updates.deliveredAt = new Date();
  }

  if (body.technicianId !== undefined) {
    if (body.technicianId === null) {
      updates.technicianId = null;
      updates.technicianName = null;
    } else {
      const [s] = await db.select().from(staffTable).where(eq(staffTable.id, body.technicianId));
      if (!s) { res.status(400).json({ error: "Technician not found" }); return; }
      updates.technicianId = body.technicianId;
      updates.technicianName = `${s.firstName} ${s.lastName}`.trim();
    }
  }
  if (body.numImages !== undefined) {
    const n = Number(body.numImages);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: "numImages must be >= 0" }); return; }
    updates.numImages = n;
  }
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.studyInstanceUid !== undefined) updates.studyInstanceUid = body.studyInstanceUid;
  if ("clinicalHistory" in body) updates.clinicalHistory = (body as { clinicalHistory?: string }).clinicalHistory ?? null;

  // DICOM MWL fields
  if ("bodyPart" in body) updates.bodyPart = body.bodyPart ?? null;
  if ("studyDescription" in body) updates.studyDescription = body.studyDescription ?? null;
  if ("scheduledStationAETitle" in body) updates.scheduledStationAETitle = body.scheduledStationAETitle ?? null;
  if ("referringDoctor" in body) updates.referringDoctor = body.referringDoctor ?? null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" }); return;
  }

  const [row] = await db.update(radiologyStudiesTable).set(updates).where(eq(radiologyStudiesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Study not found" }); return; }
  res.json(row);
});

// POST /api/radiology/studies/:id/report — save preliminary or final report.
// Body: { stage: "preliminary"|"final", body: string, reportedBy?: string, templateId?: number }
//
// Saving a preliminary advances status to reported_preliminary; saving a final
// advances to reported_final. We never downgrade — if a final already exists,
// posting a preliminary leaves status alone.
radiologyRouter.post("/:id/report", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const sReq = req as StaffAuthRequest;
  const session = sReq.staffSession;
  if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Verify lock ownership
  const [activeLock] = await db
    .select()
    .from(radiologyStudyLocksTable)
    .where(eq(radiologyStudyLocksTable.studyId, id))
    .limit(1);

  if (activeLock) {
    const now = Date.now();
    const isStale = (now - new Date(activeLock.lastActivityAt).getTime()) > 30 * 60 * 1000;
    if (activeLock.userId !== session.subjectId && !isStale) {
      res.status(409).json({ error: `Cannot save report: study is currently locked by ${activeLock.userName}` });
      return;
    }
  }

  const body = req.body as { stage?: string; body?: string; reportedBy?: string; templateId?: number };
  if (!body.stage || !["preliminary", "final"].includes(body.stage)) {
    res.status(400).json({ error: "stage must be 'preliminary' or 'final'" }); return;
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    res.status(400).json({ error: "body required" }); return;
  }

  const [existing] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Study not found" }); return; }

  const updates: Partial<typeof radiologyStudiesTable.$inferInsert> = {};
  if (body.templateId !== undefined) updates.templateId = body.templateId;
  if (body.stage === "preliminary") {
    updates.prelimReport = body.body;
    updates.prelimReportedBy = body.reportedBy ?? null;
    updates.prelimReportedAt = new Date();
    if (existing.status !== "reported_final" && existing.status !== "delivered") {
      updates.status = "reported_preliminary";
    }
  } else {
    updates.finalReport = body.body;
    updates.finalReportedBy = body.reportedBy ?? null;
    updates.finalReportedAt = new Date();
    if (existing.status !== "delivered") updates.status = "reported_final";
    // Saving the final report closes out the tele-radiology claim — the study
    // moves into the QC/verification pipeline and another radiologist should
    // not need to "release" it manually.
    updates.assignedRadiologistId = null;
    updates.assignedRadiologistName = null;
    updates.claimedAt = null;
  }

  const [row] = await db.update(radiologyStudiesTable).set(updates).where(eq(radiologyStudiesTable.id, id)).returning();
  res.json(row);
});

// ── Tele-radiology: claim / unclaim / assign ────────────────────────────────
// POST /api/radiology/:id/claim
// Claims a study for remote/night reading using the *authenticated* staff
// identity — the request body is no longer trusted for identity. Cleared
// automatically when a final report is saved or by explicit unclaim.
radiologyRouter.post("/:id/claim", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const session = req.staffSession;
  if (!session) { res.status(401).json({ error: "Staff session required" }); return; }

  const [existing] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Study not found" }); return; }
  if (existing.assignedRadiologistId && existing.assignedRadiologistId !== session.subjectId) {
    res.status(409).json({ error: `Already claimed by ${existing.assignedRadiologistName ?? "another radiologist"}` });
    return;
  }
  const [row] = await db.update(radiologyStudiesTable).set({
    assignedRadiologistId: session.subjectId,
    assignedRadiologistName: session.subjectName,
    claimedAt: existing.claimedAt ?? new Date(),
  }).where(eq(radiologyStudiesTable.id, id)).returning();
  res.json(row);
});

// POST /api/radiology/:id/unclaim — release a claim. Only the radiologist who
// holds the claim (or admin/super_admin) may release it.
radiologyRouter.post("/:id/unclaim", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const session = req.staffSession;
  if (!session) { res.status(401).json({ error: "Staff session required" }); return; }

  const [existing] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Study not found" }); return; }
  const isPrivileged = session.role === "admin" || session.role === "super_admin";
  if (existing.assignedRadiologistId && existing.assignedRadiologistId !== session.subjectId && !isPrivileged) {
    res.status(403).json({ error: "Only the assigned radiologist or an admin can release this claim." });
    return;
  }
  const [row] = await db.update(radiologyStudiesTable).set({
    assignedRadiologistId: null,
    assignedRadiologistName: null,
    claimedAt: null,
  }).where(eq(radiologyStudiesTable.id, id)).returning();
  res.json(row);
});

// POST /api/radiology/:id/share-link  { audience?: "patient"|"radiologist", expiresInHours?: number }
// Returns a tokenised URL that opens the public study viewer. Only one active
// link per (study, audience) — older active ones are revoked. The "radiologist"
// audience exposes the draft report and is restricted to the assigned
// radiologist or to admin/super_admin staff.
radiologyRouter.post("/:id/share-link", async (req: StaffAuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const session = req.staffSession;
  if (!session) { res.status(401).json({ error: "Staff session required" }); return; }
  const b = (req.body ?? {}) as { audience?: string; expiresInHours?: number };
  const audience = b.audience === "radiologist" ? "radiologist" : "patient";
  const hours = Math.min(Math.max(Number(b.expiresInHours) || (audience === "radiologist" ? 24 : 168), 1), 24 * 90);
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  if (audience === "radiologist") {
    const isPrivileged = session.role === "admin" || session.role === "super_admin";
    const isAssigned = study.assignedRadiologistId === session.subjectId;
    if (!isPrivileged && !isAssigned) {
      res.status(403).json({ error: "Only the assigned radiologist (or an admin) can mint a tele-radiology link. Claim the study first." });
      return;
    }
  }

  // Revoke prior active links for the same (study, audience).
  await db.update(radiologyShareLinksTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(radiologyShareLinksTable.studyId, id),
      eq(radiologyShareLinksTable.audience, audience),
      isNull(radiologyShareLinksTable.revokedAt),
    ));

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  await db.insert(radiologyShareLinksTable).values({
    token, studyId: id, audience,
    createdBy: session.subjectName,
    expiresAt,
  });
  const url = `${absoluteBase(req)}/api/teleradiology/share/${token}`;
  res.json({ token, url, audience, expiresAt });
});

// ── Film / CD / Print Issuance ──────────────────────────────────────────────
// GET /api/radiology/studies/:id/issues
radiologyRouter.get("/:id/issues", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(radiologyFilmIssuesTable)
    .where(eq(radiologyFilmIssuesTable.studyId, id))
    .orderBy(desc(radiologyFilmIssuesTable.issuedAt));
  res.json(rows);
});

// POST /api/radiology/studies/:id/issues
radiologyRouter.post("/:id/issues", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { issueType?: string; quantity?: number; issuedBy?: string; receivedBy?: string; notes?: string };
  if (!body.issueType || !["film", "cd", "print"].includes(body.issueType)) {
    res.status(400).json({ error: "issueType must be film, cd, or print" }); return;
  }
  // Quantity is required — silently defaulting to 1 has caused inventory
  // drift when the UI forgot to send it on multi-film/CD issues.
  if (body.quantity === undefined || body.quantity === null) {
    res.status(400).json({ error: "Invalid request", details: [{ path: ["quantity"], message: "quantity is required" }] });
    return;
  }
  const qty = Number(body.quantity);
  if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: "Invalid request", details: [{ path: ["quantity"], message: "quantity must be a positive integer" }] }); return; }

  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, id));
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  const [row] = await db.insert(radiologyFilmIssuesTable).values({
    studyId: id,
    issueType: body.issueType,
    quantity: qty,
    issuedBy: body.issuedBy ?? null,
    receivedBy: body.receivedBy ?? null,
    notes: body.notes ?? null,
  }).returning();

  // Issuing a film/CD/print after the final is reported moves the study to
  // "delivered" — once a patient has received their physical artifact the
  // workflow is complete.
  if (study.status === "reported_final") {
    await db.update(radiologyStudiesTable)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(radiologyStudiesTable.id, id));
  }

  res.status(201).json(row);
});

// ── Saved AI prompts ─────────────────────────────────────────────────────────
// GET  /api/radiology/prompts?testName=&modality=
// POST /api/radiology/prompts   { name, content, testName?, modality? }
// DELETE /api/radiology/prompts/:id

radiologyRouter.get("/prompts", async (req, res) => {
  const rows = await db
    .select()
    .from(radiologyPromptsTable)
    .orderBy(asc(radiologyPromptsTable.createdAt));
  res.json(rows);
});

radiologyRouter.post("/prompts", async (req, res) => {
  const body = req.body as { name?: string; content?: string; testName?: string; modality?: string };
  if (!body.name?.trim() || !body.content?.trim()) {
    res.status(400).json({ error: "name and content are required" }); return;
  }
  const [row] = await db.insert(radiologyPromptsTable).values({
    name: body.name.trim(),
    content: body.content.trim(),
    testName: body.testName?.trim() || null,
    modality: body.modality?.trim() || null,
  }).returning();
  res.status(201).json(row);
});

radiologyRouter.delete("/prompts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(radiologyPromptsTable).where(eq(radiologyPromptsTable.id, id));
  res.json({ ok: true });
});

// ── Stats for the page header ───────────────────────────────────────────────
radiologyRouter.get("/stats/today", async (_req, res) => {
  const date = todayISO();
  const rows = await db
    .select({ status: radiologyStudiesTable.status, count: sql<number>`count(*)::int` })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.studyDate, date))
    .groupBy(radiologyStudiesTable.status);
  const counts: Record<string, number> = {
    scheduled: 0, in_progress: 0, acquired: 0,
    reported_preliminary: 0, reported_final: 0, delivered: 0, cancelled: 0,
  };
  for (const r of rows) counts[r.status] = r.count;
  res.json({ date, counts });
});

// avoid unused-import warnings while keeping these handy for future filters
void ilike;
void or;
void gte;
void lte;
void ordersTable;

// ── PACS Dashboard ─────────────────────────────────────────────────────────
// GET /api/radiology/pacs-dashboard
radiologyRouter.get("/pacs-dashboard", async (_req, res) => {
  const today = todayISO();

  // Worklist status breakdown (all time)
  const statusRows = await db
    .select({ status: radiologyWorklistTable.status, count: sql<number>`count(*)::int` })
    .from(radiologyWorklistTable)
    .groupBy(radiologyWorklistTable.status);

  // Modality breakdown (all time)
  const modalityRows = await db
    .select({ modality: radiologyWorklistTable.modality, count: sql<number>`count(*)::int` })
    .from(radiologyWorklistTable)
    .groupBy(radiologyWorklistTable.modality);

  // Today's counts
  const todayRows = await db
    .select({ status: radiologyWorklistTable.status, count: sql<number>`count(*)::int` })
    .from(radiologyWorklistTable)
    .where(sql`DATE(${radiologyWorklistTable.createdAt}) = ${today}::date`)
    .groupBy(radiologyWorklistTable.status);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const byModality: Record<string, number> = {};
  for (const r of modalityRows) byModality[r.modality] = r.count;

  const todayTotal = todayRows.reduce((s, r) => s + r.count, 0);
  const todayReported = todayRows
    .filter((r) => r.status === "REPORT_FINAL" || r.status === "DELIVERED")
    .reduce((s, r) => s + r.count, 0);

  // Recent PACS log events
  const recentEvents = await db
    .select()
    .from(pacsLogsTable)
    .orderBy(sql`created_at DESC`)
    .limit(30);

  res.json({
    worklist: {
      total: Object.values(byStatus).reduce((s, n) => s + n, 0),
      byStatus,
      byModality,
      todayTotal,
      todayReported,
    },
    recentEvents,
  });
});

// ── Conquest integration status ────────────────────────────────────────────
// GET /api/radiology/conquest-status
// Staff-gated health probe used by the PACS Dashboard badge.
// Returns whether Conquest host is configured and when the last study arrived.
radiologyRouter.get("/conquest-status", async (_req, res) => {
  const [hostSetting] = await db
    .select({ value: pacsSettingsTable.value })
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, "conquest_host"), eq(pacsSettingsTable.category, "conquest")))
    .limit(1);

  const configured = !!(hostSetting?.value?.trim());

  const [lastStudy] = await db
    .select({ createdAt: radiologyWorklistTable.createdAt, accessionNumber: radiologyWorklistTable.accessionNumber })
    .from(radiologyWorklistTable)
    .orderBy(desc(radiologyWorklistTable.createdAt))
    .limit(1);

  const lastReceived = lastStudy?.createdAt ?? null;
  const lastAccession = lastStudy?.accessionNumber ?? null;

  const status: "ready" | "not-configured" | "no-activity" = configured
    ? lastReceived ? "ready" : "no-activity"
    : "not-configured";

  res.json({ configured, status, lastStudyReceived: lastReceived, lastAccessionNumber: lastAccession });
});

// ── PACS Logs ──────────────────────────────────────────────────────────────
// GET /api/radiology/pacs-logs?severity=&limit=
radiologyRouter.get("/pacs-logs", async (req, res) => {
  const severity = (req.query.severity as string) || "all";
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const conds = severity && severity !== "all"
    ? [eq(pacsLogsTable.severity, severity)]
    : [];

  const rows = await db
    .select()
    .from(pacsLogsTable)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(sql`created_at DESC`)
    .limit(limit);

  res.json(rows);
});

// POST /api/radiology/pacs-logs
radiologyRouter.post("/pacs-logs", async (req, res) => {
  const b = (req.body ?? {}) as {
    message?: string; severity?: string; source?: string; eventType?: string;
    logType?: string; studyInstanceUid?: string; accessionNumber?: string;
    patientId?: string; modality?: string; payload?: string; errorStack?: string;
  };
  if (!b.message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

  const VALID_SEV = ["info", "warning", "error", "debug"];
  const [row] = await db.insert(pacsLogsTable).values({
    message:          b.message.trim(),
    severity:         VALID_SEV.includes(b.severity ?? "") ? b.severity! : "info",
    source:           b.source ?? null,
    eventType:        b.eventType ?? null,
    logType:          b.logType ?? null,
    studyInstanceUid: b.studyInstanceUid ?? null,
    accessionNumber:  b.accessionNumber ?? null,
    patientId:        b.patientId ?? null,
    modality:         b.modality ?? null,
    payload:          b.payload ?? null,
    errorStack:       b.errorStack ?? null,
  }).returning();
  res.status(201).json(row);
});

// ── PACS Settings ──────────────────────────────────────────────────────────
// GET /api/radiology/pacs-settings
radiologyRouter.get("/pacs-settings", async (_req, res) => {
  const rows = await db.select().from(pacsSettingsTable).orderBy(pacsSettingsTable.category, pacsSettingsTable.key);
  res.json(rows);
});

// POST /api/radiology/pacs-settings  (upsert by key+category)
radiologyRouter.post("/pacs-settings", async (req, res) => {
  const staffReq = req as StaffAuthRequest;
  if (!FULL_ACCESS_ROLES.has(staffReq.staffSession?.role ?? "")) {
    res.status(403).json({ error: "Admin or super-admin access required to modify PACS settings." });
    return;
  }
  const b = (req.body ?? {}) as { key?: string; value?: string; category?: string; isSecret?: boolean; id?: number; reason?: string };
  if (!b.key?.trim()) { res.status(400).json({ error: "key is required" }); return; }

  const key = b.key.trim();
  const category = b.category?.trim() || "general";
  const changedBy = staffReq.staffSession?.subjectId ?? null;
  const changedByName = staffReq.staffSession?.subjectName ?? "SYSTEM";
  const changeReason = b.reason || "Updated via settings panel";

  // Check if row exists to get old value
  const [existing] = await db
    .select()
    .from(pacsSettingsTable)
    .where(and(eq(pacsSettingsTable.key, key), eq(pacsSettingsTable.category, category)))
    .limit(1);

  const oldValue = existing ? existing.value : null;
  const newValue = b.value ?? null;

  let row;
  if (b.id) {
    [row] = await db.update(pacsSettingsTable)
      .set({ value: newValue, isSecret: b.isSecret ?? false, updatedAt: new Date() })
      .where(eq(pacsSettingsTable.id, b.id))
      .returning();
  } else {
    [row] = await db.insert(pacsSettingsTable)
      .values({ key, value: newValue, category, isSecret: b.isSecret ?? false })
      .onConflictDoUpdate({
        target: [pacsSettingsTable.key, pacsSettingsTable.category],
        set: { value: newValue, isSecret: b.isSecret ?? false, updatedAt: new Date() },
      })
      .returning();
  }

  if (oldValue !== newValue) {
    await db.insert(radiologyConfigChangesTable).values({
      key,
      category,
      oldValue,
      newValue,
      reason: changeReason,
      changedBy,
      changedByName,
    });
  }

  // Premium Report master switch → canonical presentation template (R1.1/R1.2).
  if (key === "premium_layout_enabled" && category === "premium" && oldValue !== newValue) {
    const { writeActiveSelection } = await import("../lib/presentationTemplateStore.js");
    const templateKey = newValue === "true" ? "care-premium" : "care-classic";
    await writeActiveSelection("standard", templateKey, { id: changedBy, name: changedByName });
  }

  res.json(row);
});

// DELETE /api/radiology/pacs-settings/:id
radiologyRouter.delete("/pacs-settings/:id", async (req, res) => {
  const staffReq = req as StaffAuthRequest;
  if (!FULL_ACCESS_ROLES.has(staffReq.staffSession?.role ?? "")) {
    res.status(403).json({ error: "Admin or super-admin access required to delete PACS settings." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(pacsSettingsTable).where(eq(pacsSettingsTable.id, id));
  res.json({ ok: true });
});

// ── DICOM Modalities ───────────────────────────────────────────────────────
// GET /api/radiology/modalities
radiologyRouter.get("/modalities", async (_req, res) => {
  const rows = await db.select().from(dicomModalitiesTable).orderBy(dicomModalitiesTable.machineName);
  res.json(rows);
});

// POST /api/radiology/modalities  (insert or update)
radiologyRouter.post("/modalities", async (req, res) => {
  const b = (req.body ?? {}) as {
    id?: number;
    machineName?: string; modality?: string; aeTitle?: string;
    ipAddress?: string; port?: number; location?: string; manufacturer?: string;
    autoSendEnabled?: boolean; isActive?: boolean;
    queryEnabled?: boolean; retrieveEnabled?: boolean;
    pollingEnabled?: boolean; pollingIntervalSeconds?: number;
    retrieveMethod?: string; preferredTransferSyntax?: string;
    destinationPacs?: string;
    watchFolderPath?: string; cStorePort?: number;
    usbAutoImportEnabled?: boolean; nonDicomImportEnabled?: boolean;
    autoPushToConquest?: boolean; autoCreateWorklist?: boolean; autoNotifyRadiologist?: boolean;
    notes?: string;
  };

  if (b.id) {
    const updates: Partial<typeof dicomModalitiesTable.$inferInsert> = { updatedAt: new Date() };
    if (b.machineName          !== undefined) updates.machineName          = b.machineName;
    if (b.modality             !== undefined) updates.modality             = b.modality;
    if (b.aeTitle              !== undefined) updates.aeTitle              = b.aeTitle;
    if (b.ipAddress            !== undefined) updates.ipAddress            = b.ipAddress;
    if (b.port                 !== undefined) updates.port                 = b.port;
    if (b.location             !== undefined) updates.location             = b.location;
    if (b.manufacturer         !== undefined) updates.manufacturer         = b.manufacturer;
    if (b.autoSendEnabled      !== undefined) updates.autoSendEnabled      = b.autoSendEnabled;
    if (b.isActive             !== undefined) updates.isActive             = b.isActive;
    if (b.queryEnabled         !== undefined) updates.queryEnabled         = b.queryEnabled;
    if (b.retrieveEnabled      !== undefined) updates.retrieveEnabled      = b.retrieveEnabled;
    if (b.pollingEnabled       !== undefined) updates.pollingEnabled       = b.pollingEnabled;
    if (b.pollingIntervalSeconds !== undefined) updates.pollingIntervalSeconds = b.pollingIntervalSeconds;
    if (b.retrieveMethod       !== undefined) updates.retrieveMethod       = b.retrieveMethod;
    if (b.preferredTransferSyntax !== undefined) updates.preferredTransferSyntax = b.preferredTransferSyntax;
    if (b.destinationPacs      !== undefined) updates.destinationPacs      = b.destinationPacs;
    if (b.watchFolderPath      !== undefined) updates.watchFolderPath      = b.watchFolderPath;
    if (b.cStorePort           !== undefined) updates.cStorePort           = b.cStorePort;
    if (b.usbAutoImportEnabled  !== undefined) updates.usbAutoImportEnabled  = b.usbAutoImportEnabled;
    if (b.nonDicomImportEnabled !== undefined) updates.nonDicomImportEnabled = b.nonDicomImportEnabled;
    if (b.autoPushToConquest   !== undefined) updates.autoPushToConquest   = b.autoPushToConquest;
    if (b.autoCreateWorklist   !== undefined) updates.autoCreateWorklist   = b.autoCreateWorklist;
    if (b.autoNotifyRadiologist !== undefined) updates.autoNotifyRadiologist = b.autoNotifyRadiologist;
    if (b.notes                !== undefined) updates.notes                = b.notes;
    const [row] = await db.update(dicomModalitiesTable).set(updates).where(eq(dicomModalitiesTable.id, b.id)).returning();
    res.json(row);
  } else {
    if (!b.machineName?.trim()) { res.status(400).json({ error: "machineName is required" }); return; }
    const [row] = await db.insert(dicomModalitiesTable).values({
      machineName:            b.machineName.trim(),
      modality:               b.modality ?? null,
      aeTitle:                b.aeTitle ?? null,
      ipAddress:              b.ipAddress ?? null,
      port:                   b.port ?? null,
      location:               b.location ?? null,
      manufacturer:           b.manufacturer ?? null,
      autoSendEnabled:        b.autoSendEnabled ?? true,
      isActive:               b.isActive ?? true,
      queryEnabled:           b.queryEnabled ?? true,
      retrieveEnabled:        b.retrieveEnabled ?? true,
      pollingEnabled:         b.pollingEnabled ?? false,
      pollingIntervalSeconds: b.pollingIntervalSeconds ?? 300,
      retrieveMethod:         b.retrieveMethod ?? "C_MOVE",
      preferredTransferSyntax: b.preferredTransferSyntax ?? null,
      destinationPacs:        b.destinationPacs ?? "CONQUEST",
      watchFolderPath:        b.watchFolderPath ?? null,
      cStorePort:             b.cStorePort ?? null,
      usbAutoImportEnabled:   b.usbAutoImportEnabled ?? false,
      nonDicomImportEnabled:  b.nonDicomImportEnabled ?? false,
      autoPushToConquest:     b.autoPushToConquest ?? true,
      autoCreateWorklist:     b.autoCreateWorklist ?? true,
      autoNotifyRadiologist:  b.autoNotifyRadiologist ?? false,
      notes:                  b.notes ?? null,
    }).returning();
    res.status(201).json(row);
  }
});

// POST /api/radiology/modalities/:id/echo-test — upgraded handler lives in
// pacsEnterprise.ts (tries real DICOM C-ECHO via echoscu, TCP fallback).
// This stub is intentionally removed; the new handler is mounted first.

// DELETE /api/radiology/modalities/:id
radiologyRouter.delete("/modalities/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(dicomModalitiesTable).where(eq(dicomModalitiesTable.id, id));
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1 — Enterprise Radiology: Priority Rules CRUD
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/radiology/priority-rules
radiologyRouter.get("/priority-rules", async (_req, res) => {
  const rows = await db
    .select()
    .from(radiologyPriorityRulesTable)
    .orderBy(asc(radiologyPriorityRulesTable.priority), asc(radiologyPriorityRulesTable.sortOrder));
  res.json(rows);
});

// POST /api/radiology/priority-rules
radiologyRouter.post("/priority-rules", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const allowed = [
    "name", "priority", "bodyPartPattern", "studyDescPattern", "modalityList",
    "referringDoctorPattern", "keywords", "locationPattern",
    "sortOrder", "isActive",
  ];
  const values: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  const [row] = await db.insert(radiologyPriorityRulesTable).values(values as any).returning();
  res.status(201).json(row);
});

// PATCH /api/radiology/priority-rules/:id
radiologyRouter.patch("/priority-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const allowed = [
    "name", "priority", "bodyPartPattern", "studyDescPattern", "modalityList",
    "referringDoctorPattern", "keywords", "locationPattern",
    "sortOrder", "isActive",
  ];
  const values: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  const [row] = await db
    .update(radiologyPriorityRulesTable)
    .set(values as any)
    .where(eq(radiologyPriorityRulesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /api/radiology/priority-rules/:id
radiologyRouter.delete("/priority-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(radiologyPriorityRulesTable).where(eq(radiologyPriorityRulesTable.id, id));
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1 — Enterprise Radiology: Assignment Rules CRUD
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/radiology/assignment-rules
radiologyRouter.get("/assignment-rules", async (_req, res) => {
  const rows = await db
    .select()
    .from(radiologistAssignmentRulesTable)
    .orderBy(asc(radiologistAssignmentRulesTable.modality), asc(radiologistAssignmentRulesTable.sortOrder));
  res.json(rows);
});

// POST /api/radiology/assignment-rules
radiologyRouter.post("/assignment-rules", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const allowed = [
    "modality", "bodyPart", "subspecialty", "shiftStart", "shiftEnd",
    "primaryRadiologistId", "backupRadiologistId", "isActive", "sortOrder",
  ];
  const values: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  const [row] = await db.insert(radiologistAssignmentRulesTable).values(values as any).returning();
  res.status(201).json(row);
});

// PATCH /api/radiology/assignment-rules/:id
radiologyRouter.patch("/assignment-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const allowed = [
    "modality", "bodyPart", "subspecialty", "shiftStart", "shiftEnd",
    "primaryRadiologistId", "backupRadiologistId", "isActive", "sortOrder",
  ];
  const values: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (body[k] !== undefined) values[k] = body[k];
  }
  const [row] = await db
    .update(radiologistAssignmentRulesTable)
    .set(values as any)
    .where(eq(radiologistAssignmentRulesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /api/radiology/assignment-rules/:id
radiologyRouter.delete("/assignment-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(radiologistAssignmentRulesTable).where(eq(radiologistAssignmentRulesTable.id, id));
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1 — Enterprise Radiology: Radiologist subspecialties & workload
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/radiology/radiologists
radiologyRouter.get("/radiologists", async (_req, res) => {
  const users = await db.select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.role, "radiologist"));
  const workloads = await db.select().from(radiologistWorkloadsTable);
  const subspecialties = await db.select().from(radiologistSubspecialtiesTable);
  const out = users.map((u) => ({
    ...u,
    workload: workloads.find((w) => w.userId === u.id) ?? null,
    subspecialties: subspecialties.filter((s) => s.userId === u.id).map((s) => s.subspecialty),
  }));
  res.json(out);
});

// GET /api/radiology/radiologists/:id/subspecialties
radiologyRouter.get("/radiologists/:id/subspecialties", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db
    .select()
    .from(radiologistSubspecialtiesTable)
    .where(eq(radiologistSubspecialtiesTable.userId, id));
  res.json(rows);
});

// POST /api/radiology/radiologists/:id/subspecialties
radiologyRouter.post("/radiologists/:id/subspecialties", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const subspecialty = String(req.body.subspecialty || "").trim();
  if (!subspecialty) { res.status(400).json({ error: "subspecialty required" }); return; }
  const [row] = await db
    .insert(radiologistSubspecialtiesTable)
    .values({ userId, subspecialty })
    .onConflictDoNothing()
    .returning();
  res.status(201).json(row);
});

// DELETE /api/radiology/radiologists/:id/subspecialties/:subId
radiologyRouter.delete("/radiologists/:id/subspecialties/:subId", async (req, res) => {
  const subId = Number(req.params.subId);
  if (!Number.isFinite(subId)) { res.status(400).json({ error: "Invalid subId" }); return; }
  await db.delete(radiologistSubspecialtiesTable).where(eq(radiologistSubspecialtiesTable.id, subId));
  res.json({ ok: true });
});

// ── Phase 2 — Report verification workflow ──

// GET /api/radiology/verifications
radiologyRouter.get("/verifications", async (req, res) => {
  const status = (req.query.status as string) || "";
  const rows = status
    ? await db.select().from(radiologyReportVerificationsTable).where(eq(radiologyReportVerificationsTable.status, status)).orderBy(desc(radiologyReportVerificationsTable.updatedAt)).limit(100)
    : await db.select().from(radiologyReportVerificationsTable).orderBy(desc(radiologyReportVerificationsTable.updatedAt)).limit(100);
  res.json(rows);
});

// POST /api/radiology/studies/:id/prelim
radiologyRouter.post("/studies/:id/prelim", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { reportText?: string; radiologistId?: number };
  if (!body.reportText || !body.radiologistId) { res.status(400).json({ error: "reportText and radiologistId required" }); return; }
  await createVerificationRecord(id);
  await recordPrelimReport(id, body.radiologistId, body.reportText);
  await recordPrelimCompleted(id);

  // Scan for critical findings in the prelim report
  const findings = scanForCriticalFindings(body.reportText);
  for (const f of findings) {
    f.studyId = id;
    await flagCriticalFinding(f);
  }
  res.json({ ok: true });
});

// POST /api/radiology/studies/:id/peer-review
radiologyRouter.post("/studies/:id/peer-review", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { reviewerId?: number; notes?: string };
  if (!body.reviewerId) { res.status(400).json({ error: "reviewerId required" }); return; }
  await recordPeerReview(id, body.reviewerId, body.notes);
  res.json({ ok: true });
});

// POST /api/radiology/studies/:id/verify
radiologyRouter.post("/studies/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as { verifierId?: number };
  if (!body.verifierId) { res.status(400).json({ error: "verifierId required" }); return; }
  await verifyReport(id, body.verifierId);
  res.json({ ok: true });
});

// POST /api/radiology/studies/:id/final
radiologyRouter.post("/studies/:id/final", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const sReq = req as StaffAuthRequest;
  const session = sReq.staffSession;
  if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Verify matching engine status before finalization
  const [worklistRow] = await db
    .select()
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyId, id))
    .limit(1);

  if (!worklistRow) {
    res.status(400).json({
      error: "mismatch_protection_triggered",
      message: "No DICOM study is linked to this billing order. Please link a study in Match Center first."
    });
    return;
  }

  if (worklistRow.matchScore !== "GREEN" && worklistRow.matchDecision !== "APPROVED") {
    const reason = worklistRow.matchScore === "YELLOW" ? "needs review" : "mismatch / possible wrong study";
    const warnings = worklistRow.matchWarnings ? JSON.parse(worklistRow.matchWarnings) : [];
    res.status(400).json({
      error: "mismatch_protection_triggered",
      message: `Report finalization is blocked. Match score is ${worklistRow.matchScore} (${reason}). Authorized manual approval/override is required in Match Center.`,
      warnings
    });
    return;
  }

  // Verify lock ownership
  const [activeLock] = await db
    .select()
    .from(radiologyStudyLocksTable)
    .where(eq(radiologyStudyLocksTable.studyId, id))
    .limit(1);

  if (activeLock) {
    const now = Date.now();
    const isStale = (now - new Date(activeLock.lastActivityAt).getTime()) > 30 * 60 * 1000;
    if (activeLock.userId !== session.subjectId && !isStale) {
      res.status(409).json({ error: `Cannot finalize report: study is currently locked by ${activeLock.userName}` });
      return;
    }
  }

  const body = req.body as { reportText?: string; radiologistId?: number };
  if (!body.reportText || !body.radiologistId) { res.status(400).json({ error: "reportText and radiologistId required" }); return; }
  await finalizeReport(id, body.radiologistId, body.reportText);
  await recordFinalCompleted(id);

  // Automatically release the lock on finalization
  await db.delete(radiologyStudyLocksTable).where(eq(radiologyStudyLocksTable.studyId, id)).catch(() => undefined);

  // Trigger PACS archival asynchronously (non-blocking)
  import("../lib/pacsArchive.js").then(({ archiveReportToPacs }) => {
    archiveReportToPacs(id);
  }).catch(err => {
    req.log?.error({ err }, "Failed to load pacsArchive helper in finalize");
  });

  res.json({ ok: true });
});

// POST /api/radiology/studies/:id/archive-retry
radiologyRouter.post("/studies/:id/archive-retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { archiveReportToPacs } = await import("../lib/pacsArchive.js");
  const result = await archiveReportToPacs(id);
  res.json(result);
});

// ── Phase 2 — Critical findings ──

// GET /api/radiology/critical-findings
radiologyRouter.get("/critical-findings", async (req, res) => {
  const studyId = Number(req.query.studyId || "0");
  if (studyId) {
    const rows = await getCriticalFindingsForStudy(studyId);
    res.json(rows);
  } else {
    const rows = await db
      .select()
      .from(radiologyCriticalFindingsTable)
      .where(isNull(radiologyCriticalFindingsTable.acknowledgedAt))
      .orderBy(desc(radiologyCriticalFindingsTable.createdAt))
      .limit(100);
    res.json(rows);
  }
});

// POST /api/radiology/critical-findings
radiologyRouter.post("/critical-findings", async (req, res) => {
  const body = req.body as { studyId: number; finding: string; severity: "critical" | "urgent" | "significant"; category?: string };
  if (!body.studyId || !body.finding || !body.severity) { res.status(400).json({ error: "studyId, finding, severity required" }); return; }
  const row = await flagCriticalFinding(body);
  res.status(201).json(row);
});

// PATCH /api/radiology/critical-findings/:id/acknowledge
// PR 3: identity now comes from the authenticated session (client-supplied
// clinicianName is accepted only as a legacy fallback when no session name
// exists) and the shared engine makes the acknowledge idempotent.
radiologyRouter.patch("/critical-findings/:id/acknowledge", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid finding id" }); return; }
  const session = (req as StaffAuthRequest).staffSession;
  const name = session?.subjectName?.trim() || String(req.body?.clinicianName || "").trim();
  if (!name) { res.status(400).json({ error: "No authenticated identity available" }); return; }
  const result = await acknowledgeFinding(id, { name, role: session?.role ?? "staff" });
  if (result.outcome === "not_found") { res.status(404).json({ error: "Critical finding not found" }); return; }
  res.json({ ok: true, outcome: result.outcome });
});

// ── Phase 2 — TAT tracking ──

// GET /api/radiology/tat/stats
radiologyRouter.get("/tat/stats", async (req, res) => {
  const days = Math.min(Number(req.query.days || 7), 30);
  const stats = await getTatStats(days);
  res.json(stats);
});

// GET /api/radiology/tat/:studyId
radiologyRouter.get("/tat/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  if (!Number.isFinite(studyId)) { res.status(400).json({ error: "Invalid studyId" }); return; }
  const row = await getTatForStudy(studyId);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── Phase 3 — Structured templates ──

// GET /api/radiology/structured-templates
radiologyRouter.get("/structured-templates", async (req, res) => {
  const modality = (req.query.modality as string) || "";
  const conds = [];
  if (modality) conds.push(eq(radiologyStructuredTemplatesTable.modality, modality));
  const rows = await db
    .select()
    .from(radiologyStructuredTemplatesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(radiologyStructuredTemplatesTable.sortOrder));
  res.json(rows);
});

// POST /api/radiology/structured-templates
radiologyRouter.post("/structured-templates", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const allowed = ["name", "modality", "bodyPart", "description", "template", "isActive", "sortOrder"];
  const values: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) values[k] = body[k];
  const [row] = await db.insert(radiologyStructuredTemplatesTable).values(values as any).returning();
  res.status(201).json(row);
});

// PATCH /api/radiology/structured-templates/:id
radiologyRouter.patch("/structured-templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const allowed = ["name", "modality", "bodyPart", "description", "template", "isActive", "sortOrder"];
  const values: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) if (body[k] !== undefined) values[k] = body[k];
  const [row] = await db.update(radiologyStructuredTemplatesTable).set(values as any).where(eq(radiologyStructuredTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /api/radiology/structured-templates/:id
radiologyRouter.delete("/structured-templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(radiologyStructuredTemplatesTable).where(eq(radiologyStructuredTemplatesTable.id, id));
  res.json({ ok: true });
});

// ── Phase 3 — AI enhancement ──

// POST /api/radiology/studies/:id/ai-enhance
radiologyRouter.post("/studies/:id/ai-enhance", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await generateAiEnhancement(id);
  res.json(result ?? { error: "Could not generate enhancement" });
});

// GET /api/radiology/studies/:id/ai-enhance
radiologyRouter.get("/studies/:id/ai-enhance", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const row = await getAiEnhancement(id);
  if (!row) { res.status(404).json({ error: "No enhancement found" }); return; }
  res.json(row);
});

// POST /api/radiology/ai-enhancements/:id/accept
radiologyRouter.post("/ai-enhancements/:id/accept", async (req, res) => {
  const id = Number(req.params.id);
  const reviewerId = Number(req.body.reviewerId || 0);
  if (!Number.isFinite(id) || !Number.isFinite(reviewerId)) { res.status(400).json({ error: "Invalid id or reviewerId" }); return; }
  await acceptAiEnhancement(id, reviewerId);
  res.json({ ok: true });
});

// POST /api/radiology/ai-enhancements/:id/reject
radiologyRouter.post("/ai-enhancements/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const reviewerId = Number(req.body.reviewerId || 0);
  if (!Number.isFinite(id) || !Number.isFinite(reviewerId)) { res.status(400).json({ error: "Invalid id or reviewerId" }); return; }
  await rejectAiEnhancement(id, reviewerId);
  res.json({ ok: true });
});

// ── Phase 3 — DICOM measurements ──

// GET /api/radiology/studies/:id/measurements
radiologyRouter.get("/studies/:id/measurements", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(radiologyDicomMeasurementsTable).where(eq(radiologyDicomMeasurementsTable.studyId, id));
  res.json(rows);
});

// POST /api/radiology/studies/:id/measurements
radiologyRouter.post("/studies/:id/measurements", async (req, res) => {
  const studyId = Number(req.params.id);
  if (!Number.isFinite(studyId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Record<string, unknown>;
  const allowed = ["measurementType", "value", "unit", "referenceRange", "dicomTag", "notes"];
  const values: Record<string, unknown> = { studyId };
  for (const k of allowed) if (body[k] !== undefined) values[k] = body[k];
  const [row] = await db.insert(radiologyDicomMeasurementsTable).values(values as any).returning();
  res.status(201).json(row);
});

// ── Phase 4 — Multi-site / Teleradiology ──

// GET /api/radiology/sites
radiologyRouter.get("/sites", async (_req, res) => {
  const rows = await getSites();
  res.json(rows);
});

// POST /api/radiology/sites
radiologyRouter.post("/sites", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const allowed = ["name", "code", "pacsUrl", "aeTitle", "modalityList", "isActive", "timezoneOffset"];
  const values: Record<string, unknown> = {};
  for (const k of allowed) if (body[k] !== undefined) values[k] = body[k];
  const [row] = await db.insert(teleradiologySitesTable).values(values as any).returning();
  res.status(201).json(row);
});

// GET /api/radiology/multi-site-worklist
radiologyRouter.get("/multi-site-worklist", async (req, res) => {
  const siteId = Number(req.query.siteId || 0) || undefined;
  const rows = await getMultiSiteWorklist(siteId);
  res.json(rows);
});

// POST /api/radiology/studies/:id/sync-site
radiologyRouter.post("/studies/:id/sync-site", async (req, res) => {
  const studyId = Number(req.params.id);
  const siteId = Number(req.body.siteId || 0);
  const externalAccession = String(req.body.externalAccession || "").trim() || undefined;
  if (!Number.isFinite(studyId) || !Number.isFinite(siteId)) { res.status(400).json({ error: "Invalid studyId or siteId" }); return; }
  await syncStudyToSite(studyId, siteId, externalAccession);
  res.json({ ok: true });
});

// POST /api/radiology/studies/:id/route-decision
radiologyRouter.post("/studies/:id/route-decision", async (req, res) => {
  const studyId = Number(req.params.id);
  if (!Number.isFinite(studyId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId));
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }
  const result = await decideRouting(study.studyInstanceUid ?? studyId.toString(), study.modality, study.priority, study.scheduledStationAETitle ?? undefined);
  res.json(result);
});

// GET /api/radiology/routing-stats
radiologyRouter.get("/routing-stats", async (req, res) => {
  const hours = Math.min(Number(req.query.hours || 24), 168);
  const stats = await getRoutingStats(hours);
  res.json(stats);
});

// ── Study Locking & Concurrent Reporting Protection ──

// GET /api/radiology/locks — get all active locks (admin view)
radiologyRouter.get("/locks", async (req: StaffAuthRequest, res) => {
  try {
    const locks = await db.select().from(radiologyStudyLocksTable);
    const now = Date.now();
    const formatted = locks.map(l => {
      const isStale = (now - new Date(l.lastActivityAt).getTime()) > 30 * 60 * 1000;
      return { ...l, isStale };
    });
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/studies/:id/lock — check lock status
radiologyRouter.get("/studies/:id/lock", async (req: StaffAuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid study ID" }); return; }

    const [lock] = await db
      .select()
      .from(radiologyStudyLocksTable)
      .where(eq(radiologyStudyLocksTable.studyId, id))
      .limit(1);

    if (!lock) {
      res.json({ locked: false });
      return;
    }

    const now = Date.now();
    const isStale = (now - new Date(lock.lastActivityAt).getTime()) > 30 * 60 * 1000;
    const isMine = lock.userId === req.staffSession?.subjectId;

    res.json({
      locked: !isStale || isMine,
      lock: {
        userId: lock.userId,
        userName: lock.userName,
        lockTime: lock.lockTime,
        lastActivityAt: lock.lastActivityAt,
        workstation: lock.workstation,
        isStale,
        isMine,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/studies/:id/lock — acquire or heartbeat lock
radiologyRouter.post("/studies/:id/lock", async (req: StaffAuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid study ID" }); return; }
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Staff session required" }); return; }

    const { workstation, force } = req.body as { workstation?: string; force?: boolean };

    // Fetch study metadata
    const [study] = await db
      .select({
        accessionNumber: radiologyStudiesTable.accessionNumber,
        studyInstanceUid: radiologyStudiesTable.studyInstanceUid,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, id))
      .limit(1);

    if (!study) { res.status(404).json({ error: "Study not found" }); return; }

    const [existing] = await db
      .select()
      .from(radiologyStudyLocksTable)
      .where(eq(radiologyStudyLocksTable.studyId, id))
      .limit(1);

    const now = Date.now();
    const isStale = existing ? (now - new Date(existing.lastActivityAt).getTime()) > 30 * 60 * 1000 : false;
    const isMine = existing ? existing.userId === session.subjectId : false;
    const isAdmin = session.role === "admin" || session.role === "super_admin";

    const acquireLock = async (actionType: "LOCK_ACQUIRED" | "LOCK_OVERRIDDEN" | "LOCK_RECLAIMED") => {
      if (existing) {
        await db.delete(radiologyStudyLocksTable).where(eq(radiologyStudyLocksTable.studyId, id));
      }
      const [newLock] = await db
        .insert(radiologyStudyLocksTable)
        .values({
          studyId: id,
          studyInstanceUid: study.studyInstanceUid || "",
          userId: session.subjectId,
          userName: session.subjectName,
          workstation: workstation || null,
        })
        .returning();

      await db.insert(radiologyAuditLogTable).values({
        accessionNumber: study.accessionNumber,
        action: actionType,
        actor: session.subjectName,
        details: JSON.stringify({
          userId: session.subjectId,
          userName: session.subjectName,
          workstation: workstation || null,
          previousLock: existing ? { userId: existing.userId, userName: existing.userName } : null,
        }),
      }).catch(() => undefined);

      return newLock;
    };

    if (!existing) {
      const lock = await acquireLock("LOCK_ACQUIRED");
      res.json({ success: true, lock });
    } else if (isMine) {
      const [updated] = await db
        .update(radiologyStudyLocksTable)
        .set({ lastActivityAt: new Date() })
        .where(eq(radiologyStudyLocksTable.studyId, id))
        .returning();
      res.json({ success: true, lock: updated });
    } else if (isStale) {
      const lock = await acquireLock("LOCK_RECLAIMED");
      res.json({ success: true, lock });
    } else if (force && isAdmin) {
      const lock = await acquireLock("LOCK_OVERRIDDEN");
      res.json({ success: true, lock });
    } else {
      res.status(409).json({
        success: false,
        error: `Study is currently locked by ${existing.userName}`,
        lock: {
          userId: existing.userId,
          userName: existing.userName,
          lockTime: existing.lockTime,
          lastActivityAt: existing.lastActivityAt,
          workstation: existing.workstation,
          isStale: false,
          isMine: false,
        }
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/radiology/studies/:id/lock — release lock
radiologyRouter.delete("/studies/:id/lock", async (req: StaffAuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid study ID" }); return; }
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Staff session required" }); return; }

    const [existing] = await db
      .select()
      .from(radiologyStudyLocksTable)
      .where(eq(radiologyStudyLocksTable.studyId, id))
      .limit(1);

    if (!existing) {
      res.json({ success: true, message: "No active lock found" });
      return;
    }

    const isMine = existing.userId === session.subjectId;
    const isAdmin = session.role === "admin" || session.role === "super_admin";

    if (!isMine && !isAdmin) {
      res.status(403).json({ error: "Only the lock owner or an admin can release this lock" });
      return;
    }

    await db.delete(radiologyStudyLocksTable).where(eq(radiologyStudyLocksTable.studyId, id));

    const [study] = await db
      .select({ accessionNumber: radiologyStudiesTable.accessionNumber })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, id))
      .limit(1);

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study?.accessionNumber || "",
      action: "LOCK_RELEASED",
      actor: session.subjectName,
      details: JSON.stringify({
        releasedBy: session.subjectName,
        releasedById: session.subjectId,
        lockOwner: existing.userName,
        lockOwnerId: existing.userId,
        isAdminOverride: !isMine && isAdmin,
      }),
    }).catch(() => undefined);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/chocolate-findings — retrieve configurable tiles
radiologyRouter.get("/chocolate-findings", async (req, res) => {
  try {
    const modality = req.query.modality ? String(req.query.modality) : undefined;
    const bodyPart = req.query.bodyPart ? String(req.query.bodyPart) : undefined;

    const conds = [];
    if (modality) {
      conds.push(eq(radiologyChocolateFindingsTable.modality, modality));
    }
    if (bodyPart) {
      conds.push(eq(radiologyChocolateFindingsTable.bodyPart, bodyPart));
    }

    const rows = await db
      .select()
      .from(radiologyChocolateFindingsTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(radiologyChocolateFindingsTable.sortOrder), asc(radiologyChocolateFindingsTable.shortName));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/chocolate-findings — add a new finding tile
radiologyRouter.post("/chocolate-findings", async (req: StaffAuthRequest, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const allowed = [
      "modality", "bodyPart", "groupName", "shortName", "findingText", "impressionText", "isCritical", "sortOrder"
    ];
    const values: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) values[k] = body[k];
    }
    const [row] = await db.insert(radiologyChocolateFindingsTable).values(values as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/radiology/chocolate-findings/:id — edit a finding tile
radiologyRouter.patch("/chocolate-findings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = req.body as Record<string, unknown>;
    const allowed = [
      "modality", "bodyPart", "groupName", "shortName", "findingText", "impressionText", "isCritical", "sortOrder"
    ];
    const values: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) values[k] = body[k];
    }
    const [row] = await db
      .update(radiologyChocolateFindingsTable)
      .set(values as any)
      .where(eq(radiologyChocolateFindingsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/radiology/chocolate-findings/:id — delete finding tile
radiologyRouter.delete("/chocolate-findings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(radiologyChocolateFindingsTable).where(eq(radiologyChocolateFindingsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/user-findings-preferences
radiologyRouter.get("/user-findings-preferences", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    let [pref] = await db
      .select()
      .from(radiologyUserFindingsPreferencesTable)
      .where(eq(radiologyUserFindingsPreferencesTable.userId, session.subjectId))
      .limit(1);

    if (!pref) {
      [pref] = await db
        .insert(radiologyUserFindingsPreferencesTable)
        .values({ userId: session.subjectId })
        .returning();
    }

    res.json(pref);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/user-findings-preferences
radiologyRouter.post("/user-findings-preferences", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { favoriteFindingIds, customFindingsJson } = req.body as { favoriteFindingIds?: string; customFindingsJson?: string };
    const values: Record<string, unknown> = {};
    if (favoriteFindingIds !== undefined) values.favoriteFindingIds = favoriteFindingIds;
    if (customFindingsJson !== undefined) values.customFindingsJson = customFindingsJson;

    const [updated] = await db
      .update(radiologyUserFindingsPreferencesTable)
      .set(values as any)
      .where(eq(radiologyUserFindingsPreferencesTable.userId, session.subjectId))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/user-report-preferences
radiologyRouter.get("/user-report-preferences", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    let [pref] = await db
      .select()
      .from(radiologyUserReportPreferencesTable)
      .where(eq(radiologyUserReportPreferencesTable.userId, session.subjectId))
      .limit(1);

    if (!pref) {
      [pref] = await db
        .insert(radiologyUserReportPreferencesTable)
        .values({ userId: session.subjectId })
        .returning();
    }

    res.json(pref);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/user-report-preferences
radiologyRouter.post("/user-report-preferences", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    const body = req.body as Record<string, unknown>;
    const allowed = ["favoriteFindings", "favoriteImpressions", "favoriteTemplates", "personalMacros"];
    const values: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) values[k] = body[k];
    }

    const [updated] = await db
      .update(radiologyUserReportPreferencesTable)
      .set(values as any)
      .where(eq(radiologyUserReportPreferencesTable.userId, session.subjectId))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/user-item-usage — retrieve analytics and recent items
radiologyRouter.get("/user-item-usage", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    const logs = await db
      .select()
      .from(radiologyUserItemUsageLogsTable)
      .where(eq(radiologyUserItemUsageLogsTable.userId, session.subjectId))
      .orderBy(desc(radiologyUserItemUsageLogsTable.usedAt))
      .limit(100);

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/user-item-usage — log usage event
radiologyRouter.post("/user-item-usage", async (req: StaffAuthRequest, res) => {
  try {
    const session = req.staffSession;
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { itemType, itemId, itemLabel } = req.body as { itemType: string; itemId: string; itemLabel: string };
    if (!itemType || !itemId || !itemLabel) {
      res.status(400).json({ error: "itemType, itemId, itemLabel required" });
      return;
    }

    const [log] = await db
      .insert(radiologyUserItemUsageLogsTable)
      .values({
        userId: session.subjectId,
        itemType,
        itemId,
        itemLabel,
      })
      .returning();

    res.json(log);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Anti-Forgery DICOM & Billing Matching Endpoints ──

// GET /api/radiology/pacs-worklist — list PACS studies and match statuses
radiologyRouter.get("/pacs-worklist", async (req, res) => {
  try {
    const list = await db
      .select({
        id: radiologyWorklistTable.id,
        studyId: radiologyWorklistTable.studyId,
        patientId: radiologyWorklistTable.patientId,
        dicomPatientId: radiologyWorklistTable.dicomPatientId,
        patientMatchStatus: radiologyWorklistTable.patientMatchStatus,
        patientName: radiologyWorklistTable.patientName,
        age: radiologyWorklistTable.age,
        sex: radiologyWorklistTable.sex,
        modality: radiologyWorklistTable.modality,
        studyDescription: radiologyWorklistTable.studyDescription,
        studyDate: radiologyWorklistTable.studyDate,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        aeTitle: radiologyWorklistTable.aeTitle,
        referringDoctor: radiologyWorklistTable.referringDoctor,
        weasisUrl: radiologyWorklistTable.weasisUrl,
        sourcePacs: radiologyWorklistTable.sourcePacs,
        status: radiologyWorklistTable.status,
        matchScore: radiologyWorklistTable.matchScore,
        matchPoints: radiologyWorklistTable.matchPoints,
        matchReasons: radiologyWorklistTable.matchReasons,
        matchWarnings: radiologyWorklistTable.matchWarnings,
        matchDecision: radiologyWorklistTable.matchDecision,
        matchApprovedBy: radiologyWorklistTable.matchApprovedBy,
        matchApprovedAt: radiologyWorklistTable.matchApprovedAt,
        matchOverrideReason: radiologyWorklistTable.matchOverrideReason,
        // Join fields if study linked
        billedTestName: testsTable.name,
        billedPatientName: sql`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
        billedPatientUHID: patientsTable.patientId,
        billedAccessionNumber: radiologyStudiesTable.accessionNumber,
        billedModality: radiologyStudiesTable.modality,
        billedStudyDate: radiologyStudiesTable.studyDate,
        billNumber: billsTable.billNumber,
      })
      .from(radiologyWorklistTable)
      .leftJoin(radiologyStudiesTable, eq(radiologyStudiesTable.id, radiologyWorklistTable.studyId))
      .leftJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
      .leftJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
      .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
      .orderBy(desc(radiologyWorklistTable.createdAt))
      .limit(100);

    res.json(list);
  } catch (err: any) {
    logger.error({ err }, "Error fetching pacs worklist");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/pacs-worklist/:id/matching-candidates — find billed studies matching PACS modality/names
radiologyRouter.get("/pacs-worklist/:id/matching-candidates", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [worklistItem] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, id))
      .limit(1);

    if (!worklistItem) {
      res.status(404).json({ error: "Worklist item not found" });
      return;
    }

    const studies = await db
      .select({
        id: radiologyStudiesTable.id,
        accessionNumber: radiologyStudiesTable.accessionNumber,
        status: radiologyStudiesTable.status,
        modality: radiologyStudiesTable.modality,
        studyDescription: radiologyStudiesTable.studyDescription,
        studyDate: radiologyStudiesTable.studyDate,
        patientId: radiologyStudiesTable.patientId,
        patientName: sql`concat(${patientsTable.firstName}, ' ', ${patientsTable.lastName})`,
        patientUHID: patientsTable.patientId,
        age: sql`concat(${patientsTable.ageValue}, ' ', ${patientsTable.ageUnit})`,
        sex: patientsTable.gender,
        testName: testsTable.name,
        billNumber: billsTable.billNumber,
      })
      .from(radiologyStudiesTable)
      .innerJoin(patientsTable, eq(patientsTable.id, radiologyStudiesTable.patientId))
      .innerJoin(testsTable, eq(testsTable.id, radiologyStudiesTable.testId))
      .leftJoin(billsTable, eq(billsTable.id, radiologyStudiesTable.billId))
      .orderBy(desc(radiologyStudiesTable.createdAt))
      .limit(100);

    const candidates = studies.map(s => {
      const dicomInput = {
        patientName: worklistItem.patientName,
        dicomPatientId: worklistItem.dicomPatientId,
        age: worklistItem.age,
        sex: worklistItem.sex,
        modality: worklistItem.modality,
        studyDescription: worklistItem.studyDescription,
        accessionNumber: worklistItem.accessionNumber ?? "",
        studyDate: worklistItem.studyDate,
        studyTime: null,
        studyInstanceUID: worklistItem.studyInstanceUID,
        referringDoctor: worklistItem.referringDoctor,
      };

      const billInput = {
        id: s.id,
        patientId: s.patientId,
        patientName: String(s.patientName || ""),
        patientUHID: s.patientUHID,
        age: String(s.age || ""),
        sex: s.sex,
        testName: s.testName,
        modality: s.modality,
        accessionNumber: s.accessionNumber,
        billNumber: s.billNumber,
        studyDate: s.studyDate,
      };

      const match = calculateMatchScore(dicomInput, billInput);
      return {
        study: s,
        matchScore: match.score,
        matchPoints: match.points,
        matchReasons: match.reasons,
        matchWarnings: match.warnings,
      };
    });

    candidates.sort((a, b) => b.matchPoints - a.matchPoints);
    res.json({ success: true, candidates });
  } catch (err: any) {
    logger.error({ err }, "Error in matching-candidates");
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/radiology/frequent-referring-doctors
 * Top referring-doctor names from recent worklist rows — the short list
 * radiologists need as one-tap chips in Reporting Workspace.
 */
radiologyRouter.get("/frequent-referring-doctors", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 24) : 12;
    const rows = await db.execute<{ name: string; count: string }>(sql`
      SELECT trim(referring_doctor) AS name, COUNT(*)::text AS count
        FROM radiology_worklist
       WHERE referring_doctor IS NOT NULL
         AND trim(referring_doctor) <> ''
         AND created_at >= NOW() - INTERVAL '120 days'
       GROUP BY trim(referring_doctor)
       ORDER BY COUNT(*) DESC, trim(referring_doctor) ASC
       LIMIT ${limit}
    `);
    const list = ((rows as unknown as { rows?: Array<{ name: string; count: string }> }).rows
      ?? (rows as unknown as Array<{ name: string; count: string }>))
      .map((r) => ({ name: r.name, count: Number(r.count) || 0 }))
      .filter((r) => r.name);
    res.json({ doctors: list });
  } catch (err: any) {
    logger.error({ err }, "frequent-referring-doctors failed");
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/radiology/pacs-worklist/:id/referring-doctor
 * One-tap referring-doctor fix from Reporting Workspace. Updates the worklist
 * row and the linked radiology_studies row when present (report header + MWL).
 */
radiologyRouter.patch("/pacs-worklist/:id/referring-doctor", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid worklist id" });
      return;
    }
    const raw = (req.body as { referringDoctor?: unknown } | undefined)?.referringDoctor;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "referringDoctor string required (empty clears)" });
      return;
    }
    const referringDoctor = raw.trim() || null;

    const [worklistItem] = await db
      .select({
        id: radiologyWorklistTable.id,
        studyId: radiologyWorklistTable.studyId,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        referringDoctor: radiologyWorklistTable.referringDoctor,
      })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, id))
      .limit(1);

    if (!worklistItem) {
      res.status(404).json({ error: "Worklist item not found" });
      return;
    }

    await db
      .update(radiologyWorklistTable)
      .set({ referringDoctor, updatedAt: new Date() })
      .where(eq(radiologyWorklistTable.id, id));

    if (worklistItem.studyId) {
      await db
        .update(radiologyStudiesTable)
        .set({ referringDoctor, updatedAt: new Date() })
        .where(eq(radiologyStudiesTable.id, worklistItem.studyId));
    }

    await db.insert(radiologyAuditLogTable).values({
      worklistId: id,
      accessionNumber: worklistItem.accessionNumber,
      action: "REFERRING_DOCTOR_SET",
      actor: (req as StaffAuthRequest).staffSession?.subjectName || "staff",
      details: JSON.stringify({
        from: worklistItem.referringDoctor,
        to: referringDoctor,
      }),
    });

    res.json({ ok: true, referringDoctor });
  } catch (err: any) {
    logger.error({ err }, "Error setting referring doctor");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/pacs-worklist/:id/auto-link-billed-study — link worklist to billed radiology_studies when patient is billed but study_id is null
radiologyRouter.post("/pacs-worklist/:id/auto-link-billed-study", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const { autoLinkBilledStudyForWorklist } = await import("../lib/pacs/worklistBillingLink");
    const actor = (req as { staffSession?: { subjectName?: string } }).staffSession?.subjectName || "staff";
    const result = await autoLinkBilledStudyForWorklist(id, actor);
    if (result.linked && result.studyId) {
      const { runMatchingEngineForWorklist } = await import("./internal-radiology");
      try { await runMatchingEngineForWorklist(id); } catch { /* non-blocking */ }
    }
    res.json({ success: result.linked, ...result });
  } catch (err: unknown) {
    logger.error({ err }, "Error in auto-link-billed-study");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/radiology/pacs-worklist/:id/link-study — manually bind a studyId to worklist row
radiologyRouter.post("/pacs-worklist/:id/link-study", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { studyId } = req.body;
    if (isNaN(id) || !studyId) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const [worklistItem] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, id))
      .limit(1);

    if (!worklistItem) {
      res.status(404).json({ error: "Worklist item not found" });
      return;
    }

    const [study] = await db
      .select()
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, studyId))
      .limit(1);

    if (!study) {
      res.status(404).json({ error: "Study not found" });
      return;
    }

    const oldLinkedStudyId = worklistItem.studyId;

    await db
      .update(radiologyWorklistTable)
      .set({
        studyId,
        patientId: study.patientId,
        updatedAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, id));

    const updates: Partial<typeof radiologyStudiesTable.$inferInsert> = {
      updatedAt: new Date(),
      status: "acquired",
      acquiredAt: new Date(),
    };
    if (worklistItem.studyInstanceUID && !study.studyInstanceUid) {
      updates.studyInstanceUid = worklistItem.studyInstanceUID;
    }
    await db
      .update(radiologyStudiesTable)
      .set(updates)
      .where(eq(radiologyStudiesTable.id, studyId));

    await db.insert(radiologyAuditLogTable).values({
      worklistId: id,
      accessionNumber: worklistItem.accessionNumber,
      action: "MANUAL_LINK",
      actor: (req as any).staffSession?.subjectName || "staff",
      details: JSON.stringify({
        studyId,
        accessionNumber: study.accessionNumber,
        oldLinkedStudyId,
      }),
    });

    await runMatchingEngineForWorklist(id);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Error in link-study");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radiology/pacs-worklist/:id/match-decision — approve, reject, or override match
radiologyRouter.post("/pacs-worklist/:id/match-decision", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { decision, overrideReason } = req.body;
    if (isNaN(id) || !decision) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    const [worklistItem] = await db
      .select()
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, id))
      .limit(1);

    if (!worklistItem) {
      res.status(404).json({ error: "Worklist item not found" });
      return;
    }

    const actor = (req as any).staffSession?.subjectName || "staff";

    await db
      .update(radiologyWorklistTable)
      .set({
        matchDecision: decision,
        matchApprovedBy: decision === "APPROVED" ? actor : null,
        matchApprovedAt: decision === "APPROVED" ? new Date() : null,
        matchOverrideReason: overrideReason || null,
        updatedAt: new Date(),
      })
      .where(eq(radiologyWorklistTable.id, id));

    await db.insert(radiologyAuditLogTable).values({
      worklistId: id,
      accessionNumber: worklistItem.accessionNumber,
      action: `MATCH_${decision}`,
      actor,
      details: JSON.stringify({
        overrideReason,
        matchScore: worklistItem.matchScore,
        matchPoints: worklistItem.matchPoints,
      }),
    });

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Error in match-decision");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radiology/institutional-style
radiologyRouter.get("/institutional-style", async (req, res) => {
  try {
    const [style] = await db
      .select()
      .from(radiologyInstitutionalStylesTable)
      .limit(1);
    if (!style) {
      res.json({
        id: 1,
        presetName: "Care Diagnostics Default",
        sectionOrder: "Technique,Findings,Impression",
        showClinicalHistory: true,
        showComparison: true,
        showRecommendation: true,
        showCriticalCommunication: true,
        showMeasurements: true,
        headingStyle: "underlined",
        abnormalEmphasis: "bold_abnormal",
        spacing: "standard",
        printLayout: "letterhead",
        margins: "standard",
        fontSize: "standard",
        showRadiologistName: true,
        showDegree: true,
        showRegNumber: true,
        showDigitalSignature: true,
        showTimestamp: true,
        showQrVerification: true,
      });
      return;
    }
    res.json(style);
  } catch (err: any) {
    logger.error({ err }, "Error fetching institutional style");
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/radiology/institutional-style
radiologyRouter.put("/institutional-style", async (req, res) => {
  try {
    const body = req.body;
    const [style] = await db
      .select()
      .from(radiologyInstitutionalStylesTable)
      .limit(1);

    const values = {
      presetName: body.presetName || "Care Diagnostics Default",
      sectionOrder: body.sectionOrder || "Technique,Findings,Impression",
      showClinicalHistory: body.showClinicalHistory !== false,
      showComparison: body.showComparison !== false,
      showRecommendation: body.showRecommendation !== false,
      showCriticalCommunication: body.showCriticalCommunication !== false,
      showMeasurements: body.showMeasurements !== false,
      headingStyle: body.headingStyle || "underlined",
      abnormalEmphasis: body.abnormalEmphasis || "bold_abnormal",
      spacing: body.spacing || "standard",
      printLayout: body.printLayout || "letterhead",
      margins: body.margins || "standard",
      fontSize: body.fontSize || "standard",
      showRadiologistName: body.showRadiologistName !== false,
      showDegree: body.showDegree !== false,
      showRegNumber: body.showRegNumber !== false,
      showDigitalSignature: body.showDigitalSignature !== false,
      showTimestamp: body.showTimestamp !== false,
      showQrVerification: body.showQrVerification !== false,
      updatedAt: new Date(),
    };

    if (style) {
      const [updated] = await db
        .update(radiologyInstitutionalStylesTable)
        .set(values)
        .where(eq(radiologyInstitutionalStylesTable.id, style.id))
        .returning();
      res.json(updated);
    } else {
      const [inserted] = await db
        .insert(radiologyInstitutionalStylesTable)
        .values({ id: 1, ...values })
        .returning();
      res.json(inserted);
    }
  } catch (err: any) {
    logger.error({ err }, "Error updating institutional style");
    res.status(500).json({ error: err.message });
  }
});

export default radiologyRouter;
