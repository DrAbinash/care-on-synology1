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
 *   POST /finalize
 *   GET  /billing-status?accessions=A,B,C
 */
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
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM patient_reports WHERE report_number LIKE ${prefix + "%"}
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: Array<{ n: number }> }).rows ?? []) as Array<{
    n: number;
  }>;
  const n = Number(rows[0]?.n ?? 0);
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

    if (statusFilter !== "pending") {
      res.status(400).json({ error: "Only status=pending is supported" });
      return;
    }

    const conds = [inArray(radiologyWorklistTable.status, [...PENDING_STATUSES])];
    if (sinceValid) {
      conds.push(gte(radiologyWorklistTable.updatedAt, sinceValid));
    }

    const rows = await db
      .select({
        id: radiologyWorklistTable.id,
        accessionNumber: radiologyWorklistTable.accessionNumber,
        patientName: radiologyWorklistTable.patientName,
        age: radiologyWorklistTable.age,
        sex: radiologyWorklistTable.sex,
        referringDoctor: radiologyWorklistTable.referringDoctor,
        studyDescription: radiologyWorklistTable.studyDescription,
        modality: radiologyWorklistTable.modality,
        studyDate: radiologyWorklistTable.studyDate,
        studyInstanceUID: radiologyWorklistTable.studyInstanceUID,
        studyId: radiologyWorklistTable.studyId,
        testName: testsTable.name,
        billId: radiologyStudiesTable.billId,
        billedTestName: testsTable.name,
      })
      .from(radiologyWorklistTable)
      .leftJoin(radiologyStudiesTable, eq(radiologyWorklistTable.studyId, radiologyStudiesTable.id))
      .leftJoin(testsTable, eq(radiologyStudiesTable.testId, testsTable.id))
      .where(and(...conds))
      .orderBy(desc(radiologyWorklistTable.updatedAt))
      .limit(500);

    const billIds = rows
      .map((r) => r.billId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
    const billingMap = await billingStatusForBillIds([...new Set(billIds)]);

    res.json(
      rows.map((r) => ({
        worklistId: String(r.id),
        accessionNumber: r.accessionNumber ?? "",
        patientName: r.patientName,
        patientAge: r.age ?? "",
        patientGender: r.sex ?? "",
        referringDoctor: r.referringDoctor ?? "",
        testName: r.testName ?? r.studyDescription ?? "",
        modality: r.modality,
        studyDate: toIsoStudyDate(r.studyDate),
        studyInstanceUid: r.studyInstanceUID ?? null,
        billingStatus: r.billId != null ? (billingMap.get(r.billId) ?? null) : null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "reporting-studio worklist failed");
    res.status(500).json({ error: "worklist query failed" });
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
