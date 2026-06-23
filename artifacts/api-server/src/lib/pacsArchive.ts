import { db } from "@workspace/db";
import {
  radiologyStudiesTable,
  patientsTable,
  patientReportsTable,
  radiologyAuditLogTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { chromium } from "playwright";
import { buildReportHtml } from "../routes/patient-reports.js";
import { logger } from "./logger.js";

function getOrthancConfig() {
  const url = (process.env.ORTHANC_URL || "").replace(/\/$/, "");
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

export async function archiveReportToPacs(studyId: number): Promise<{ success: boolean; instanceId?: string; error?: string }> {
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

    // 3. Resolve report HTML
    let htmlContent = "";
    const [report] = await db
      .select()
      .from(patientReportsTable)
      .where(eq(patientReportsTable.studyId, studyId))
      .limit(1);

    if (report) {
      htmlContent = await buildReportHtml(report.id, false) || "";
    }

    if (!htmlContent) {
      // Fallback HTML layout using study + patient data
      const finalReportText = study.finalReport || study.prelimReport || "No report body text entered.";
      htmlContent = `
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Radiology Report — ${study.accessionNumber}</title>
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
            <div><span>Patient Name</span><strong>${patientName}</strong></div>
            <div><span>Patient ID</span><strong>${patientIdStr}</strong></div>
            <div><span>Age / Sex</span><strong>${ageStr} / ${sexStr}</strong></div>
            <div><span>Accession Number</span><strong>${study.accessionNumber}</strong></div>
            <div><span>Study Date</span><strong>${study.studyDate || ""}</strong></div>
            <div><span>Modality</span><strong>${study.modality}</strong></div>
            <div><span>Referring Doctor</span><strong>${study.referringDoctor || "Self"}</strong></div>
          </div>
          <h2>Report Findings</h2>
          <div class="body">${finalReportText}</div>
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
    const { url, user, pass } = getOrthancConfig();
    if (!url) {
      throw new Error("Orthanc PACS URL not configured in environment (ORTHANC_URL)");
    }

    const studyInstanceUID = study.studyInstanceUid || "";
    const accessionNumber = study.accessionNumber || "";
    const studyDateRaw = study.studyDate ? String(study.studyDate).replace(/-/g, "") : "";
    const referringDoctor = study.referringDoctor || "";

    const tags = {
      PatientName: patientName.replace(/\^/g, " "), // Clean caret character if any
      PatientID: patientIdStr,
      StudyInstanceUID: studyInstanceUID,
      AccessionNumber: accessionNumber,
      StudyDate: studyDateRaw,
      ReferringPhysicianName: referringDoctor,
      SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1", // Encapsulated PDF Storage
      Modality: "OT",
      SeriesDescription: "Radiology Report PDF",
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

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_SUCCESS",
      actor: "system",
      details: JSON.stringify({ instanceId, path: result.Path }),
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

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_FAILURE",
      actor: "system",
      details: JSON.stringify({ error: errorMsg }),
    }).catch(() => undefined);

    return { success: false, error: errorMsg };
  }
}
