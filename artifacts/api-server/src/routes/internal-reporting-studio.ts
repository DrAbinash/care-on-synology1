/**
 * CARE ERP ↔ Reporting Studio Bridge
 *
 * Server-to-server endpoints the CARE Reporting Studio (separate Synology
 * deploy) calls with a static `x-api-key` matching REPORTING_STUDIO_API_KEY.
 * Not staff-session auth — the Studio has no ERP browser session.
 *
 * Mounted at: /api/internal/reporting-studio  (see routes/index.ts)
 *
 *   GET  /ping
 *   GET  /worklist?status=pending&since=<iso>
 *   GET  /audit          — dead-man last-sync + 24h/7d counters
 *   POST /finalize
 *   GET  /billing-status?accessions=A,B,C
 */
import { createHash } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  radiologyWorklistTable,
  radiologyStudiesTable,
  radiologyAuditLogTable,
  patientReportsTable,
  billsTable,
  billPaymentLinksTable,
  testsTable,
  patientsTable,
  bridgeSyncLogTable,
} from "@workspace/db/schema";
import { and, eq, inArray, gte, notInArray, sql, desc } from "drizzle-orm";
import { safeEqual } from "../lib/internalApiKeyAuth";
import { logger } from "../lib/logger";
import { autoLinkBilledStudyForWorklist } from "../lib/pacs/worklistBillingLink";
import { matchAllowsFinalize } from "../lib/radiologyIdentity";
import { isObstetricUsgStudy } from "../lib/usgModality";
import { checkPcpndtFormFCompliance } from "../lib/pcpndtCompliance";
import {
  mapBillToStudioStatus,
  isOpenUpiLinkStatus,
  type StudioBillingStatus,
} from "../lib/reportingStudioBilling";
import {
  validateStudioWorklistRow,
  detectSentinels,
  accumulateSentinels,
  emptySentinelCounters,
  buildRowsByModality,
  suppressMachineGhosts,
  type WorklistAuditMeta,
  type SentinelCounters,
} from "../lib/reportingStudioContract";

const router = Router();

const PENDING_STATUSES = ["STUDY_RECEIVED", "AI_DRAFT_READY", "REPORT_IN_PROGRESS"] as const;
const FINAL_STATUSES = new Set(["REPORT_FINAL", "DELIVERED"]);
const PDF_META_KEY = "reportingStudioPdfUrl";

function requireStudioKey(req: Request, res: Response, next: NextFunction): void {
  const key = process.env["REPORTING_STUDIO_API_KEY"];
  if (!key) {
    res.status(503).json({ error: "REPORTING_STUDIO_API_KEY not configured" });
    return;
  }
  const provided = req.header("x-api-key") ?? "";
  if (!provided || !safeEqual(provided, key)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.use(requireStudioKey);

function erpVersion(): string {
  return process.env["ERP_VERSION"] || process.env["npm_package_version"] || "0.0.0";
}

/**
 * Stable studio source id for bridge_sync_log — prefer explicit header so
 * admins can label studios; otherwise fingerprint the API key (never store
 * the raw secret).
 */
export function studioSourceId(req: Request): string {
  const header =
    (req.header("x-studio-id") ?? req.header("x-reporting-studio-source") ?? "").trim();
  if (header) return header.slice(0, 128);
  const key = req.header("x-api-key") ?? "";
  const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `key:${fingerprint}`;
}

async function recordBridgeSyncLog(input: {
  sourceId: string;
  rowsServed: number;
  rowsByModality: Record<string, number>;
  sentinelCounters: SentinelCounters;
  validationFailures: number;
  statusFilter: string;
}): Promise<void> {
  await db.insert(bridgeSyncLogTable).values({
    sourceId: input.sourceId,
    syncedAt: new Date(),
    rowsServed: input.rowsServed,
    rowsByModality: input.rowsByModality,
    sentinelCounters: input.sentinelCounters,
    validationFailures: input.validationFailures,
    statusFilter: input.statusFilter,
  });
}

function toIsoStudyDate(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  // Common DICOM / worklist date forms: YYYYMMDD or YYYY-MM-DD
  const compact = raw.replace(/[^0-9]/g, "");
  if (compact.length >= 8) {
    const y = compact.slice(0, 4);
    const m = compact.slice(4, 6);
    const day = compact.slice(6, 8);
    const parsed = new Date(`${y}-${m}-${day}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return raw;
}

/**
 * Highway Rule — Bill Desk is the single source of truth for patient age.
 *
 * Priority:
 *  1. patients.age_value / age_unit (bill desk)
 *  2. patients.date_of_birth (bill desk)
 *  3. radiology_worklist.age (MWL/machine) — only when age_value is null,
 *     and hard-rejected when the parsed number is > 110 (kills dummy "126"
 *     ages derived from 1900-01-01 DOBs that machines sometimes push).
 */
function ageFor(r: {
  age: string | null;
  patientDob: string | null;
  patientAgeValue: number | null;
  patientAgeUnit: string | null;
}): string {
  // PRIORITY 1 — Bill Desk age_value / age_unit
  if (r.patientAgeValue != null && Number.isFinite(r.patientAgeValue)) {
    if (r.patientAgeValue > 110 || r.patientAgeValue < 0) return "";
    const unit = (r.patientAgeUnit ?? "").toLowerCase();
    if (unit.startsWith("month")) return `${r.patientAgeValue}M`;
    if (unit.startsWith("day")) return `${r.patientAgeValue}D`;
    return String(r.patientAgeValue);
  }

  // PRIORITY 2 — Bill Desk DOB
  const dob = (r.patientDob ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(dob)) {
    const years = Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000);
    if (years > 0 && years < 130) return String(years);
  }

  // PRIORITY 3 — Machine/MWL age only when bill-desk age_value is null
  if (r.patientAgeValue == null && r.age && r.age.trim()) {
    const raw = r.age.trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 110) return "";
    return raw;
  }

  return "";
}

function mergePdfUrlIntoMetadata(
  existing: string | null | undefined,
  pdfUrl: string,
): string {
  let meta: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      meta = { previousDicomMetadata: existing };
    }
  }
  meta[PDF_META_KEY] = pdfUrl;
  return JSON.stringify(meta);
}

function buildReportBody(reportText: {
  technique?: string;
  findings?: string;
  impression?: string;
  recommendation?: string;
}): string {
  const sections: Array<[string, string | undefined]> = [
    ["Technique", reportText.technique],
    ["Findings", reportText.findings],
    ["Impression", reportText.impression],
    ["Recommendation", reportText.recommendation],
  ];
  return sections
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([h, v]) => `<h3>${h}</h3>\n<p>${String(v).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

async function nextReportNumber(): Promise<string> {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `RPT-${stamp}-`;
  const [{ n = 0 }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM patient_reports WHERE report_number LIKE ${prefix + "%"}
  `).then((r) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows ?? [])) as unknown as [{ n: number }];
  return `${prefix}${String(n + 1).padStart(3, "0")}`;
}

async function billingStatusForBillIds(
  billIds: number[],
): Promise<Map<number, StudioBillingStatus>> {
  const out = new Map<number, StudioBillingStatus>();
  if (billIds.length === 0) return out;

  const bills = await db
    .select({ id: billsTable.id, status: billsTable.status })
    .from(billsTable)
    .where(inArray(billsTable.id, billIds));

  const links = await db
    .select({ billId: billPaymentLinksTable.billId, status: billPaymentLinksTable.status })
    .from(billPaymentLinksTable)
    .where(inArray(billPaymentLinksTable.billId, billIds));

  const openUpi = new Set<number>();
  for (const link of links) {
    if (isOpenUpiLinkStatus(link.status)) openUpi.add(link.billId);
  }

  for (const bill of bills) {
    out.set(bill.id, mapBillToStudioStatus(bill.status, openUpi.has(bill.id)));
  }
  return out;
}

// ── GET /ping ────────────────────────────────────────────────────────────────
router.get("/ping", (_req, res) => {
  res.json({ ok: true, version: erpVersion() });
});

// ── GET /worklist ────────────────────────────────────────────────────────────
router.get("/worklist", async (req, res) => {
  try {
    const statusFilter = String(req.query.status ?? "pending").toLowerCase();
    const sinceRaw = typeof req.query.since === "string" ? req.query.since.trim() : "";
    const sinceDate = sinceRaw ? new Date(sinceRaw) : null;
    const sinceValid = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

    // v6.14: ?status=all returns the full day's record (pending + final)
    // so the studio can do billing follow-up without flipping tabs.
    // ?status=pending (default) keeps the legacy behaviour.
    // ?status=reported/final/delivered filters to those specific statuses.
    const SUPPORTED = new Set(["pending", "all", "reported", "final", "delivered"]);
    if (!SUPPORTED.has(statusFilter)) {
      res.status(400).json({ error: `Unsupported status '${statusFilter}'. Supported: pending | all | reported | final | delivered` });
      return;
    }

    // Map the filter to the worklist status enum values.
    // PENDING_STATUSES covers the "waiting to be reported" bucket.
    // FINAL_STATUSES covers "REPORT_FINAL" and "DELIVERED".
    const statusValues: string[] =
      statusFilter === "pending" ? [...PENDING_STATUSES]
      : statusFilter === "reported" || statusFilter === "final" ? ["REPORT_FINAL"]
      : statusFilter === "delivered" ? ["DELIVERED"]
      : [...PENDING_STATUSES, "REPORT_FINAL", "DELIVERED"]; // all

    const conds = [inArray(radiologyWorklistTable.status, statusValues)];
    if (sinceValid) {
      conds.push(gte(radiologyWorklistTable.updatedAt, sinceValid));
    }

    const rows = await db
      .select({
        id: radiologyWorklistTable.id,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        patientId: radiologyWorklistTable.patientId,
        patientName: radiologyWorklistTable.patientName,
        patientPhone: patientsTable.phone,
        patientAddress: patientsTable.address,
        patientDob: patientsTable.dateOfBirth,
        patientAgeValue: patientsTable.ageValue,
        patientAgeUnit: patientsTable.ageUnit,
        patientGender: patientsTable.gender,
        age: radiologyWorklistTable.age,
        sex: radiologyWorklistTable.sex,
        referringDoctor: radiologyWorklistTable.referringDoctor,
        studyReferringDoctor: radiologyStudiesTable.referringDoctor,
        studyDescription: radiologyWorklistTable.studyDescription,
        modality: radiologyWorklistTable.modality,
        studyDate: radiologyWorklistTable.studyDate,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        studyId: radiologyWorklistTable.studyId,
        testName: testsTable.name,
        billId: radiologyStudiesTable.billId,
        billNumber: billsTable.billNumber,
        billedTestName: testsTable.name,
        // v6.14: include worklist status so the studio can freeze REPORTED
        // rows (don't overwrite finalized reports on re-sync).
        status: radiologyWorklistTable.status,
      })
      .from(radiologyWorklistTable)
      .leftJoin(radiologyStudiesTable, eq(radiologyWorklistTable.studyId, radiologyStudiesTable.id))
      .leftJoin(testsTable, eq(radiologyStudiesTable.testId, testsTable.id))
      .leftJoin(patientsTable, eq(radiologyWorklistTable.patientId, patientsTable.id))
      .leftJoin(billsTable, eq(radiologyStudiesTable.billId, billsTable.id))
      .where(and(...conds))
      .orderBy(desc(radiologyWorklistTable.updatedAt))
      .limit(500);

    const billIds = rows
      .map((r) => r.billId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
    const billingMap = await billingStatusForBillIds([...new Set(billIds)]);

    const sourceId = studioSourceId(req);
    let validationFailures = 0;
    let sentinels = emptySentinelCounters();

    const payloadRows = rows.map((r) => {
      const refWorklist = (r.referringDoctor ?? "").trim();
      const refStudy = (r.studyReferringDoctor ?? "").trim();
      const referringDoctorWasBlank = !refWorklist && !refStudy;
      const referringDoctor =
        refWorklist || refStudy || "Self/Walk-in";

      const mapped = {
        worklistId: String(r.id),
        accessionNumber: r.accessionNumber ?? "",
        patientName: r.patientName,
        // v6.14: surface the ERP worklist status so the studio can freeze
        // REPORTED rows (don't overwrite a finalized report) and skip
        // DELIVERED rows from billing follow-up.
        status: r.status,
        // USG Studio v6 bridge extension — additive, optional for callers:
        // bill-desk demographics so Form F and the patient header never need
        // retyping. Studios built against PR #639 ignore unknown keys.
        patientId: r.patientId ?? null,
        patientPhone: r.patientPhone ?? "",
        patientAddress: r.patientAddress ?? "",
        billNumber: r.billNumber ?? "",
        patientAge: ageFor(r),
        patientGender: (r.sex ?? "") || (r.patientGender ?? ""),
        referringDoctor,
        testName: r.testName ?? r.studyDescription ?? "",
        modality: r.modality,
        studyDate: toIsoStudyDate(r.studyDate),
        studyInstanceUid: r.studyInstanceUID ?? null,
        billingStatus: r.billId != null ? (billingMap.get(r.billId) ?? null) : null,
      };

      // Contract validation — never silently drop; log + count failures.
      const validated = validateStudioWorklistRow(mapped);
      if (!validated.ok) {
        validationFailures += 1;
        for (const issue of validated.issues) {
          logger.error(
            {
              worklistId: issue.worklistId || mapped.worklistId,
              field: issue.field,
              message: issue.message,
              sourceId,
            },
            "reporting-studio worklist contract validation failed",
          );
        }
      }

      const flags = detectSentinels({
        patientAge: mapped.patientAge,
        sourceAge: r.age,
        patientDob: r.patientDob,
        accessionNumber: mapped.accessionNumber,
        referringDoctor: mapped.referringDoctor,
        referringDoctorWasBlank,
      });
      sentinels = accumulateSentinels(sentinels, flags);

      return mapped;
    });

    // Orthanc→ERP sync can create unbilled "ghost" rows alongside Bill Desk
    // truth for the same patientName. Prefer billed rows; never drop a lone row.
    const { rows: dedupedRows, suppressed: ghostsSuppressed } =
      suppressMachineGhosts(payloadRows);
    if (ghostsSuppressed.length > 0) {
      logger.info(
        {
          sourceId,
          suppressed: ghostsSuppressed.length,
          worklistIds: ghostsSuppressed.map((r) => r.worklistId),
        },
        "reporting-studio suppressed unbilled machine ghost worklist rows",
      );
    }

    const rowsByModality = buildRowsByModality(dedupedRows);
    const syncedAt = new Date().toISOString();
    const meta: WorklistAuditMeta = {
      syncedAt,
      rowsServed: dedupedRows.length,
      rowsByModality,
      validationFailures,
      sentinels,
      sourceId,
    };

    logger.info(
      {
        sourceId,
        rowsServed: meta.rowsServed,
        ghostsSuppressed: ghostsSuppressed.length,
        rowsByModality,
        validationFailures,
        sentinels,
        statusFilter,
      },
      "reporting-studio worklist served",
    );

    try {
      await recordBridgeSyncLog({
        sourceId,
        rowsServed: meta.rowsServed,
        rowsByModality,
        sentinelCounters: sentinels,
        validationFailures,
        statusFilter,
      });
    } catch (err) {
      // Audit write must not fail the studio pull — but it must be LOUD.
      logger.error({ err, sourceId }, "reporting-studio bridge_sync_log write failed");
    }

    // Additive envelope: row objects unchanged; meta is new. Studios that
    // previously expected a bare array should read `.rows` (or ignore `.meta`).
    res.json({ rows: dedupedRows, meta });
  } catch (err) {
    logger.error({ err }, "reporting-studio worklist failed");
    res.status(500).json({ error: "worklist query failed" });
  }
});

// ── GET /audit ───────────────────────────────────────────────────────────────
// Dead-man view: last pull per studio, 24h/7d row counts, sentinel + validation
// totals. Same x-api-key gate as the rest of the bridge.
router.get("/audit", async (_req, res) => {
  try {
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000);
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const recent = await db
      .select()
      .from(bridgeSyncLogTable)
      .where(gte(bridgeSyncLogTable.syncedAt, since7d))
      .orderBy(desc(bridgeSyncLogTable.syncedAt))
      .limit(5000);

    const lastBySource = new Map<
      string,
      {
        sourceId: string;
        syncedAt: string;
        minutesAgo: number;
        rowsServed: number;
        validationFailures: number;
        sentinels: SentinelCounters;
        statusFilter: string | null;
      }
    >();

    let rows24h = 0;
    let rows7d = 0;
    let pulls24h = 0;
    let pulls7d = 0;
    const sentinels24h = emptySentinelCounters();
    const sentinels7d = emptySentinelCounters();
    let validationFailures24h = 0;
    let validationFailures7d = 0;

    for (const row of recent) {
      const syncedAt = row.syncedAt instanceof Date ? row.syncedAt : new Date(row.syncedAt);
      const syncedMs = syncedAt.getTime();
      const counters = (row.sentinelCounters ?? emptySentinelCounters()) as SentinelCounters;

      if (!lastBySource.has(row.sourceId)) {
        lastBySource.set(row.sourceId, {
          sourceId: row.sourceId,
          syncedAt: syncedAt.toISOString(),
          minutesAgo: Math.max(0, Math.round((now - syncedMs) / 60_000)),
          rowsServed: row.rowsServed,
          validationFailures: row.validationFailures,
          sentinels: counters,
          statusFilter: row.statusFilter,
        });
      }

      rows7d += row.rowsServed;
      pulls7d += 1;
      validationFailures7d += row.validationFailures;
      sentinels7d.ageSuspicious += counters.ageSuspicious ?? 0;
      sentinels7d.placeholderDob += counters.placeholderDob ?? 0;
      sentinels7d.blankAccession += counters.blankAccession ?? 0;
      sentinels7d.blankReferringDoctor += counters.blankReferringDoctor ?? 0;

      if (syncedMs >= since24h.getTime()) {
        rows24h += row.rowsServed;
        pulls24h += 1;
        validationFailures24h += row.validationFailures;
        sentinels24h.ageSuspicious += counters.ageSuspicious ?? 0;
        sentinels24h.placeholderDob += counters.placeholderDob ?? 0;
        sentinels24h.blankAccession += counters.blankAccession ?? 0;
        sentinels24h.blankReferringDoctor += counters.blankReferringDoctor ?? 0;
      }
    }

    const lastSyncPerStudio = [...lastBySource.values()].sort(
      (a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime(),
    );

    res.json({
      ok: true,
      asOf: new Date(now).toISOString(),
      lastSyncPerStudio,
      totals24h: {
        pulls: pulls24h,
        rowsServed: rows24h,
        validationFailures: validationFailures24h,
        sentinels: sentinels24h,
      },
      totals7d: {
        pulls: pulls7d,
        rowsServed: rows7d,
        validationFailures: validationFailures7d,
        sentinels: sentinels7d,
      },
    });
  } catch (err) {
    logger.error({ err }, "reporting-studio audit failed");
    res.status(500).json({ error: "audit query failed" });
  }
});

// ── GET /billing-status ──────────────────────────────────────────────────────
router.get("/billing-status", async (req, res) => {
  try {
    const raw = typeof req.query.accessions === "string" ? req.query.accessions : "";
    const accessions = raw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (accessions.length === 0) {
      res.json({});
      return;
    }

    const rows = await db
      .select({
        accessionNumber: radiologyWorklistTable.accessionNumber,
        billId: radiologyStudiesTable.billId,
        studyAccession: radiologyStudiesTable.accessionNumber,
      })
      .from(radiologyWorklistTable)
      .leftJoin(radiologyStudiesTable, eq(radiologyWorklistTable.studyId, radiologyStudiesTable.id))
      .where(inArray(radiologyWorklistTable.accessionNumber, accessions));

    // Also resolve accessions that exist only on radiology_studies (billed, no PACS row).
    const found = new Set(rows.map((r) => r.accessionNumber).filter(Boolean) as string[]);
    const missing = accessions.filter((a) => !found.has(a));
    let studyOnly: Array<{ accessionNumber: string; billId: number | null }> = [];
    if (missing.length > 0) {
      studyOnly = await db
        .select({
          accessionNumber: radiologyStudiesTable.accessionNumber,
          billId: radiologyStudiesTable.billId,
        })
        .from(radiologyStudiesTable)
        .where(inArray(radiologyStudiesTable.accessionNumber, missing));
    }

    const billIds = [...rows, ...studyOnly]
      .map((r) => r.billId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
    const billingMap = await billingStatusForBillIds([...new Set(billIds)]);

    const result: Record<string, StudioBillingStatus> = {};
    for (const r of rows) {
      if (!r.accessionNumber) continue;
      const status = r.billId != null ? billingMap.get(r.billId) ?? null : null;
      if (status != null) result[r.accessionNumber] = status;
    }
    for (const r of studyOnly) {
      const status = r.billId != null ? billingMap.get(r.billId) ?? null : null;
      if (status != null) result[r.accessionNumber] = status;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, "reporting-studio billing-status failed");
    res.status(500).json({ error: "billing-status query failed" });
  }
});

// ── POST /finalize ───────────────────────────────────────────────────────────
router.post("/finalize", async (req, res) => {
  try {
    const b = (req.body ?? {}) as {
      accessionNumber?: string;
      worklistId?: string | number;
      reportText?: {
        technique?: string;
        findings?: string;
        impression?: string;
        recommendation?: string;
      };
      radiologistName?: string;
      radiologistRegNumber?: string;
      finalizedAt?: string;
      pdfUrl?: string;
    };

    const accessionNumber = typeof b.accessionNumber === "string" ? b.accessionNumber.trim() : "";
    const worklistIdNum =
      b.worklistId != null && String(b.worklistId).trim() !== ""
        ? Number(b.worklistId)
        : NaN;

    if (!accessionNumber && !Number.isFinite(worklistIdNum)) {
      res.status(400).json({ ok: false, error: "accessionNumber or worklistId is required" });
      return;
    }

    let existing: typeof radiologyWorklistTable.$inferSelect | undefined;
    if (Number.isFinite(worklistIdNum)) {
      const [row] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, worklistIdNum))
        .limit(1);
      existing = row;
    }
    if (!existing && accessionNumber) {
      const [row] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.accessionNumber, accessionNumber))
        .orderBy(desc(radiologyWorklistTable.updatedAt))
        .limit(1);
      existing = row;
    }

    if (!existing) {
      res.status(404).json({ ok: false, error: "Worklist entry not found" });
      return;
    }

    // Idempotent: already finalized → success, no duplicate billing/report.
    if (FINAL_STATUSES.has(existing.status)) {
      if (typeof b.pdfUrl === "string" && b.pdfUrl.trim()) {
        await db
          .update(radiologyWorklistTable)
          .set({
            dicomMetadata: mergePdfUrlIntoMetadata(existing.dicomMetadata, b.pdfUrl.trim()),
            updatedAt: new Date(),
          })
          .where(eq(radiologyWorklistTable.id, existing.id));
      }
      res.json({ ok: true, idempotent: true });
      return;
    }

    // Same billing-link helper the ERP UI uses before finalize.
    const linkResult = await autoLinkBilledStudyForWorklist(existing.id, "reporting-studio");
    if (linkResult.linked && linkResult.studyId) {
      const [refreshed] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.id, existing.id))
        .limit(1);
      if (refreshed) existing = refreshed;
    }

    if (!matchAllowsFinalize(existing)) {
      res.status(409).json({
        ok: false,
        error:
          "Match Center identity is unresolved. Resolve GREEN or APPROVED in the ERP before finalizing from Studio.",
      });
      return;
    }

    if (isObstetricUsgStudy(existing.modality, existing.studyDescription)) {
      const compliance = await checkPcpndtFormFCompliance(existing.patientId);
      if (!compliance.compliant) {
        res.status(409).json({
          ok: false,
          error:
            "Obstetric/fetal ultrasound requires a complete PCPNDT Form F before finalize. Complete Form F in the ERP, then retry.",
        });
        return;
      }
    }

    const radiologistName =
      (typeof b.radiologistName === "string" && b.radiologistName.trim()) || "Reporting Studio";
    const finalizedAt =
      typeof b.finalizedAt === "string" && !Number.isNaN(new Date(b.finalizedAt).getTime())
        ? new Date(b.finalizedAt)
        : new Date();
    const reportText = b.reportText ?? {};
    const bodyHtml = buildReportBody(reportText);
    const impression =
      typeof reportText.impression === "string" ? reportText.impression.trim() : "";

    let reportId: number | null = existing.reportId ?? null;

    // Create patient_reports when a billed study (patient + test) is linked —
    // mirrors radiologyReportLifecycle.finalizeRadiologyReport.
    if (!reportId && existing.studyId) {
      const [study] = await db
        .select()
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, existing.studyId))
        .limit(1);

      if (study?.patientId && study.testId) {
        const [test] = await db
          .select({ name: testsTable.name })
          .from(testsTable)
          .where(eq(testsTable.id, study.testId))
          .limit(1);

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const reportNumber = await nextReportNumber();
            const [created] = await db
              .insert(patientReportsTable)
              .values({
                reportNumber,
                type: "radiology",
                patientId: study.patientId,
                testId: study.testId,
                orderTestId: study.orderTestId,
                orderId: study.orderId,
                billId: study.billId,
                studyId: existing.id,
                title: `${test?.name ?? study.modality} — Report`,
                body: bodyHtml,
                impression: impression || null,
                status: "pending_verification",
                signedByName: radiologistName,
                signedAt: finalizedAt,
                createdBy: radiologistName,
                parameters: JSON.stringify({
                  modality: existing.modality,
                  studyDescription: existing.studyDescription,
                  accessionNumber: existing.accessionNumber,
                  studyInstanceUID: existing.studyInstanceUID,
                  radiologistRegNumber: b.radiologistRegNumber ?? null,
                  source: "reporting-studio",
                  ...(typeof b.pdfUrl === "string" && b.pdfUrl.trim()
                    ? { reportingStudioPdfUrl: b.pdfUrl.trim() }
                    : {}),
                }),
              })
              .returning();
            reportId = created.id;

            // Mirror peerReview.finalizeReport on the billed study row.
            await db
              .update(radiologyStudiesTable)
              .set({
                finalReport: bodyHtml,
                finalReportedBy: radiologistName,
                finalReportedAt: finalizedAt,
                status: "reported_final",
                updatedAt: new Date(),
              })
              .where(eq(radiologyStudiesTable.id, study.id));
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/duplicate key|unique/i.test(msg) || attempt === 2) {
              logger.error({ err }, "reporting-studio patient_reports insert failed");
              res.status(500).json({ ok: false, error: "Failed to create patient report" });
              return;
            }
          }
        }
      }
    }

    const updates: Partial<typeof radiologyWorklistTable.$inferInsert> = {
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      assignedRadiologist: radiologistName,
      updatedAt: new Date(),
      lockUserId: null,
      lockUserName: null,
      lockTime: null,
      lockLastActivityAt: null,
      lockWorkstation: null,
    };
    if (reportId) updates.reportId = reportId;
    if (typeof b.pdfUrl === "string" && b.pdfUrl.trim()) {
      updates.dicomMetadata = mergePdfUrlIntoMetadata(existing.dicomMetadata, b.pdfUrl.trim());
    }

    const [updated] = await db
      .update(radiologyWorklistTable)
      .set(updates)
      .where(
        and(
          eq(radiologyWorklistTable.id, existing.id),
          notInArray(radiologyWorklistTable.status, ["REPORT_FINAL", "DELIVERED"]),
        ),
      )
      .returning();

    if (!updated) {
      // Concurrent finalize won the race — still idempotent success.
      res.json({ ok: true, idempotent: true });
      return;
    }

    await db.insert(radiologyAuditLogTable).values({
      worklistId: existing.id,
      accessionNumber: existing.accessionNumber,
      action: "REPORT_FINAL",
      actor: radiologistName,
      details: JSON.stringify({
        source: "reporting-studio",
        reportId,
        radiologistRegNumber: b.radiologistRegNumber ?? null,
        finalizedAt: finalizedAt.toISOString(),
        pdfUrl: typeof b.pdfUrl === "string" ? b.pdfUrl : null,
        linkedStudyId: linkResult.studyId ?? existing.studyId ?? null,
      }),
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "reporting-studio finalize failed");
    const message = err instanceof Error ? err.message : "finalize failed";
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
