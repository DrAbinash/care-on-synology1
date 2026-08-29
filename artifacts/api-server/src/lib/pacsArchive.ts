import { db } from "@workspace/db";
import {
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientsTable,
  patientReportsTable,
  radiologyAuditLogTable,
  radiologyPacsArchiveRevisionsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { chromium } from "playwright";
import { buildReportArtifact, type ReportArtifact } from "../routes/patient-reports.js";
import { logger } from "./logger.js";

import { getRadiologyConfig } from "./pacs/pacsConfig";

async function getOrthancConfig() {
  const cfg = await getRadiologyConfig();
  const url = cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, "");
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  return { url, user, pass };
}

function orthancHeaders(user: string, pass: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user && pass) {
    headers["Authorization"] = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

export async function archiveReportToPacs(
  studyId: number,
  opts: {
    /** D8 — PACS archives the LATEST signed version by default; pass
     *  "specific" to explicitly archive the historical row as-is (it renders
     *  with the superseded watermark). */
    versionMode?: "latest" | "specific";
  } = {},
): Promise<{ success: boolean; instanceId?: string; error?: string }> {
  logger.info({ studyId }, "[pacs-archive] Starting report archival to Orthanc");

  // 1. Fetch study
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);

  if (!study) {
    logger.error({ studyId }, "[pacs-archive] Study not found");
    return { success: false, error: "Study not found" };
  }

  // Set status to pending
  await db
    .update(radiologyStudiesTable)
    .set({ pacsArchiveStatus: "pending", pacsArchiveResponse: null })
    .where(eq(radiologyStudiesTable.id, studyId));

  await db.insert(radiologyAuditLogTable).values({
    accessionNumber: study.accessionNumber,
    action: "PACS_ARCHIVE_PENDING",
    actor: "system",
    details: JSON.stringify({ message: "PACS archive triggered, rendering PDF" }),
  }).catch(() => undefined);

  // BEND-1 — which revision this run is archiving, visible to the catch
  // block so per-revision failures are attributable.
  let archivedRevision: { resolvedReportId: number; rootReportId: number; sequenceNumber: number } | null = null;

  try {
    // 2. Fetch patient demographics
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, study.patientId))
      .limit(1);

    const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : "Patient";
    const patientIdStr = patient ? (patient.patientId || String(patient.id)) : String(study.patientId);
    
    let ageStr = "";
    if (patient?.dateOfBirth) {
      const dob = new Date(patient.dateOfBirth);
      if (!Number.isNaN(dob.getTime())) {
        const now = new Date();
        let years = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
        ageStr = `${years}Y`;
      }
    }
    const sexStr = patient?.gender || "O";

    // 3. Resolve report HTML. D8: amendments share the parent's studyId, so
    // whichever row this unordered pick lands on, buildReportArtifact resolves
    // the chain to the latest signed version (default) — the archived PDF can
    // never silently be a superseded report, and an explicitly historical
    // archive carries the superseded watermark baked into its HTML.
    //
    // Workspace finalize stores radiology_worklist.id on patient_reports.study_id;
    // legacy rows may still store radiology_studies.id. This archive entrypoint
    // always receives the billed study id — look up both namespaces.
    let htmlContent = "";
    let artifact: ReportArtifact | null = null;
    const [worklistForStudy] = await db
      .select({ id: radiologyWorklistTable.id })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.studyId, studyId))
      .limit(1);
    const reportStudyIds = worklistForStudy?.id != null
      ? [worklistForStudy.id, studyId]
      : [studyId];
    const [report] = await db
      .select()
      .from(patientReportsTable)
      .where(inArray(patientReportsTable.studyId, reportStudyIds))
      .limit(1);
    if (report) {
      artifact = await buildReportArtifact(report.id, { surface: "pacs", versionMode: opts.versionMode });
      htmlContent = artifact?.html || "";
    }

    if (!htmlContent) {
      // Fallback HTML layout for a study with no patient_reports row (legacy
      // free-text-only studies using radiology_studies.finalReport/
      // prelimReport directly, never promoted through the modern report
      // pipeline) — an edge case distinct from the primary buildReportArtifact
      // path above. R1.4: every field here is patient/study data, not
      // markup, and MUST be escaped — it previously was not.
      const esc = (v: unknown) => String(v ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      const finalReportText = study.finalReport || study.prelimReport || "No report body text entered.";
      htmlContent = `
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Radiology Report — ${esc(study.accessionNumber)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; padding: 20px; font-size: 13px; line-height: 1.6; }
            .header { border-bottom: 3px solid #4338ca; padding-bottom: 10px; margin-bottom: 15px; }
            .title { font-size: 20px; font-weight: 800; color: #1e1b4b; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11px; margin-bottom: 20px; }
            .meta div span { color: #64748b; display: block; font-size: 9px; text-transform: uppercase; }
            .meta div strong { font-size: 12px; }
            .body { white-space: pre-wrap; margin-top: 20px; }
            .footer { margin-top: 40px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">Care Diagnostics — Radiology Report</div>
          </div>
          <div class="meta">
            <div><span>Patient Name</span><strong>${esc(patientName)}</strong></div>
            <div><span>Patient ID</span><strong>${esc(patientIdStr)}</strong></div>
            <div><span>Age / Sex</span><strong>${esc(ageStr)} / ${esc(sexStr)}</strong></div>
            <div><span>Accession Number</span><strong>${esc(study.accessionNumber)}</strong></div>
            <div><span>Study Date</span><strong>${esc(study.studyDate || "")}</strong></div>
            <div><span>Modality</span><strong>${esc(study.modality)}</strong></div>
            <div><span>Referring Doctor</span><strong>${esc(study.referringDoctor || "Self")}</strong></div>
          </div>
          <h2>Report Findings</h2>
          <div class="body">${esc(finalReportText)}</div>
          <div class="footer">Please correlate clinically. Generated by internal archive server.</div>
        </body>
        </html>
      `;
    }

    // 4. Generate PDF using Playwright
    logger.info({ studyId }, "[pacs-archive] Rendering PDF with Playwright");
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle" });
      pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      });
    } finally {
      await browser.close();
    }

    // 5. Connect to Orthanc and post
    const { url, user, pass } = await getOrthancConfig();
    if (!url) {
      throw new Error("Orthanc PACS URL not configured in database or environment");
    }

    const studyInstanceUID = study.studyInstanceUid || "";
    const accessionNumber = study.accessionNumber || "";
    const studyDateRaw = study.studyDate ? String(study.studyDate).replace(/-/g, "") : "";
    const referringDoctor = study.referringDoctor || "";

    // D8 — the DICOM series states which revision was archived; a superseded
    // historical export is labeled as such (never presented as current).
    const v = artifact?.version;
    if (v) archivedRevision = { resolvedReportId: v.resolvedReportId, rootReportId: v.rootReportId, sequenceNumber: v.sequenceNumber };
    const versionLabel = v && v.totalVersions > 1
      ? ` v${v.sequenceNumber}/${v.totalVersions}${v.resolvedSuperseded ? " SUPERSEDED" : " (amended)"}`
      : "";
    const tags = {
      PatientName: patientName.replace(/\^/g, " "), // Clean caret character if any
      PatientID: patientIdStr,
      StudyInstanceUID: studyInstanceUID,
      AccessionNumber: accessionNumber,
      StudyDate: studyDateRaw,
      ReferringPhysicianName: referringDoctor,
      SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1", // Encapsulated PDF Storage
      Modality: "OT",
      SeriesDescription: `Radiology Report PDF${versionLabel}`.slice(0, 64),
    };

    logger.info({ studyId, url }, "[pacs-archive] Uploading encapsulated PDF DICOM to Orthanc");

    const response = await fetch(`${url}/tools/create-dicom`, {
      method: "POST",
      headers: orthancHeaders(user, pass),
      body: JSON.stringify({
        Tags: tags,
        Content: "data:application/pdf;base64," + pdfBuffer.toString("base64"),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orthanc server returned error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { ID?: string; Path?: string };
    const instanceId = result.ID || "";

    // 6. Persist status success
    await db
      .update(radiologyStudiesTable)
      .set({
        pacsArchiveStatus: "success",
        pacsArchiveResponse: JSON.stringify(result),
        pacsInstanceId: instanceId,
      })
      .where(eq(radiologyStudiesTable.id, studyId));

    // BEND-1 — per-REVISION archive record: the study columns above keep only
    // the latest attempt and overwrite pacsInstanceId; this preserves each
    // revision's Orthanc instance and flags older archived revisions as
    // superseded instead of silently losing their references.
    if (v) {
      await db.insert(radiologyPacsArchiveRevisionsTable)
        .values({
          studyId,
          reportId: v.resolvedReportId,
          rootReportId: v.rootReportId,
          sequenceNumber: v.sequenceNumber,
          status: "success",
          orthancInstanceId: instanceId,
          detail: JSON.stringify({ path: result.Path ?? null }),
          attemptedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: radiologyPacsArchiveRevisionsTable.reportId,
          set: { status: "success", orthancInstanceId: instanceId, attemptedAt: new Date(), updatedAt: new Date() },
        })
        .catch(() => undefined);
      await db.update(radiologyPacsArchiveRevisionsTable)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(and(
          eq(radiologyPacsArchiveRevisionsTable.studyId, studyId),
          ne(radiologyPacsArchiveRevisionsTable.reportId, v.resolvedReportId),
          eq(radiologyPacsArchiveRevisionsTable.status, "success"),
        ))
        .catch(() => undefined);
    }

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_SUCCESS",
      actor: "system",
      details: JSON.stringify({
        instanceId,
        path: result.Path,
        // D8 — auditable requested-vs-delivered record for the PACS surface.
        ...(v ? {
          requestedReportId: v.requestedReportId,
          deliveredReportId: v.resolvedReportId,
          reportVersion: `${v.sequenceNumber}/${v.totalVersions}`,
          superseded: v.resolvedSuperseded,
          chainWarnings: v.warnings,
        } : {}),
      }),
    }).catch(() => undefined);

    logger.info({ studyId, instanceId }, "[pacs-archive] Report archived successfully");
    return { success: true, instanceId };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ studyId, err }, "[pacs-archive] Report archival failed");

    // Persist status failure
    await db
      .update(radiologyStudiesTable)
      .set({
        pacsArchiveStatus: "failed",
        pacsArchiveResponse: JSON.stringify({ error: errorMsg }),
      })
      .where(eq(radiologyStudiesTable.id, studyId));

    // BEND-1 — per-revision failure record (only when the version resolved;
    // pre-resolution failures have no revision to attribute).
    if (archivedRevision) {
      await db.insert(radiologyPacsArchiveRevisionsTable)
        .values({
          studyId,
          reportId: archivedRevision.resolvedReportId,
          rootReportId: archivedRevision.rootReportId,
          sequenceNumber: archivedRevision.sequenceNumber,
          status: "failed",
          detail: JSON.stringify({ error: errorMsg.slice(0, 500) }),
          attemptedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: radiologyPacsArchiveRevisionsTable.reportId,
          set: { status: "failed", detail: JSON.stringify({ error: errorMsg.slice(0, 500) }), attemptedAt: new Date(), updatedAt: new Date() },
        })
        .catch(() => undefined);
    }

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_FAILURE",
      actor: "system",
      details: JSON.stringify({ error: errorMsg }),
    }).catch(() => undefined);

    return { success: false, error: errorMsg };
  }
}
