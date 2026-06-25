/**
 * Report Delivery — send radiology/lab reports via WhatsApp or Email.
 * Logs every delivery attempt to report_delivery_logs for audit trail.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  reportDeliveryLogsTable,
  patientReportsTable,
  patientsTable,
  radiologyStudiesTable,
  emailSettingsTable,
  whatsappSettingsTable,
  clinicSettingsTable,
  radiologyWorklistTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const reportDeliveryRouter = Router();

// ─── GET /api/report-delivery/logs ───────────────────────────────────────────
reportDeliveryRouter.get("/logs", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { reportId, patientId, limit = "50", offset = "0" } = req.query as Record<string, string>;
  let query = db.select().from(reportDeliveryLogsTable).$dynamic();
  if (reportId) query = query.where(eq(reportDeliveryLogsTable.reportId, Number(reportId)));
  if (patientId) query = query.where(eq(reportDeliveryLogsTable.patientId, Number(patientId)));
  const rows = await query
    .orderBy(desc(reportDeliveryLogsTable.createdAt))
    .limit(Math.min(Number(limit), 200))
    .offset(Number(offset));
  res.json(rows);
});

// ─── POST /api/report-delivery/send ──────────────────────────────────────────
reportDeliveryRouter.post("/send", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const {
    reportId,
    patientId,
    studyId,
    accessionNumber,
    deliveryMode,
    recipientPhone,
    recipientEmail,
    customMessage,
    attachPdf = true,
    includeVerificationLink = true,
  } = req.body as {
    reportId?: number;
    patientId?: number;
    studyId?: number;
    accessionNumber?: string;
    deliveryMode: string; // WHATSAPP | EMAIL | BOTH
    recipientPhone?: string;
    recipientEmail?: string;
    customMessage?: string;
    attachPdf?: boolean;
    includeVerificationLink?: boolean;
  };

  if (!deliveryMode || !["WHATSAPP", "EMAIL", "BOTH"].includes(deliveryMode)) {
    res.status(400).json({ error: "deliveryMode must be WHATSAPP, EMAIL, or BOTH" }); return;
  }

  // Fetch report + patient + clinic for message generation
  const [report] = reportId
    ? await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId)).limit(1)
    : [undefined];

  // Verify match status for delivery
  if (report && (report.type === "radiology" || report.studyId)) {
    const rStudyId = report.studyId;
    if (rStudyId) {
      const [worklistRow] = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.studyId, rStudyId))
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
        res.status(400).json({
          error: "mismatch_protection_triggered",
          message: `Report delivery is blocked. Match score is ${worklistRow.matchScore} (${reason}). Authorized manual approval/override is required in Match Center.`
        });
        return;
      }
    } else {
      res.status(400).json({
        error: "mismatch_protection_triggered",
        message: "No study linked to this report. Please link a study in Match Center first."
      });
      return;
    }
  }

  const [patient] = patientId
    ? await db.select().from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1)
    : [undefined];
  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);

  const patientFirstName = patient?.firstName ?? "Patient";
  const clinicName = clinic?.name ?? "Care Diagnostics";
  const phone = recipientPhone ?? patient?.phone ?? null;
  const email = recipientEmail ?? patient?.email ?? null;

  const verificationLink = (report?.billId && includeVerificationLink)
    ? `${process.env["SITE_URL"] ?? ""}/api/verify/${report.billId}`
    : null;
  const pdfLink = report?.publicToken
    ? `${process.env["SITE_URL"] ?? ""}/api/p/r/${report.publicToken}/pdf`
    : null;

  const messageBody = customMessage?.trim() ||
    `Dear ${patientFirstName},\n\nYour report from ${clinicName} is ready.${pdfLink ? `\n\nDownload: ${pdfLink}` : ""}${verificationLink ? `\n\nVerify: ${verificationLink}` : ""}\n\nThank you,\n${clinicName}`;

  const results: Array<{ mode: string; status: string; error?: string }> = [];

  const modes = deliveryMode === "BOTH" ? ["WHATSAPP", "EMAIL"] : [deliveryMode];

  for (const mode of modes) {
    let status = "pending";
    let rawResponse: string | null = null;
    let errorMessage: string | null = null;

    try {
      if (mode === "WHATSAPP") {
        if (!phone) throw new Error("No phone number for WhatsApp delivery");
        const [wSettings] = await db.select().from(whatsappSettingsTable).limit(1);
        if (!wSettings) throw new Error("WhatsApp not configured");

        // Placeholder — actual WhatsApp Business API integration
        // Different providers: Twilio, WATI, AiSensy, GupShup
        const provider = (wSettings as Record<string, unknown>)?.provider as string | undefined ?? "MANUAL";
        if (provider === "MANUAL") {
          rawResponse = JSON.stringify({ provider: "MANUAL", note: "WhatsApp Web fallback — manual copy required" });
          status = "pending";
        } else {
          // Future: call provider API
          throw new Error(`WhatsApp provider '${provider}' not yet integrated. Use manual fallback.`);
        }
      } else if (mode === "EMAIL") {
        if (!email) throw new Error("No email address for email delivery");
        const [emailSettings] = await db.select().from(emailSettingsTable).limit(1);
        if (!emailSettings?.smtpHost) throw new Error("SMTP not configured. Configure email settings first.");

        // Use Nodemailer
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.default.createTransport({
          host: emailSettings.smtpHost,
          port: Number(emailSettings.smtpPort ?? 587),
          secure: emailSettings.smtpSecure ?? false,
          auth: emailSettings.smtpUser
            ? { user: emailSettings.smtpUser, pass: emailSettings.smtpPassword ?? "" }
            : undefined,
        });

        const mailOptions = {
          from: `"${emailSettings.fromName ?? clinicName}" <${emailSettings.fromAddress ?? emailSettings.smtpUser}>`,
          to: email,
          subject: `${clinicName} — Your Report is Ready`,
          text: messageBody,
          html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${messageBody}</pre>`,
        };

        const info = await transporter.sendMail(mailOptions);
        rawResponse = JSON.stringify({ messageId: (info as { messageId?: string }).messageId });
        status = "sent";
      }
    } catch (err: unknown) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : "Delivery error";
    }

    // Log the attempt
    await db.insert(reportDeliveryLogsTable).values({
      reportId: reportId ?? null,
      patientId: patientId ?? null,
      studyId: studyId ?? null,
      accessionNumber: accessionNumber ?? report?.reportNumber ?? null,
      deliveryMode: mode,
      recipientPhone: mode === "WHATSAPP" ? phone : null,
      recipientEmail: mode === "EMAIL" ? email : null,
      status,
      messageText: messageBody,
      sentBy: sReq.staffSession.subjectName,
      sentAt: status === "sent" ? new Date() : null,
      pdfAttached: (attachPdf && pdfLink) ? "yes" : "no",
      verificationLink: verificationLink ?? null,
      rawResponse,
      errorMessage,
    });

    results.push({ mode, status, error: errorMessage ?? undefined });
  }

  const allSent = results.every((r) => r.status === "sent" || r.status === "pending");
  if (allSent) {
    res.json({ success: true, results, whatsappFallback: messageBody });
  } else {
    res.status(207).json({ success: false, results, whatsappFallback: messageBody });
  }
});

// ─── POST /api/report-delivery/retry/:id ─────────────────────────────────────
reportDeliveryRouter.post("/retry/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  const [log] = await db.select().from(reportDeliveryLogsTable).where(eq(reportDeliveryLogsTable.id, id));
  if (!log) { res.status(404).json({ error: "Log entry not found" }); return; }

  // Re-trigger via the send endpoint with same params
  await db.update(reportDeliveryLogsTable).set({
    status: "retried",
    retryCount: (log.retryCount ?? 0) + 1,
  }).where(eq(reportDeliveryLogsTable.id, id));

  res.json({ ok: true, message: "Retry logged. Re-trigger delivery from the report page." });
});

// ─── GET /api/report-delivery/preview ────────────────────────────────────────
reportDeliveryRouter.get("/preview", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { patientId, reportId } = req.query as { patientId?: string; reportId?: string };
  const [patient] = patientId
    ? await db.select().from(patientsTable).where(eq(patientsTable.id, Number(patientId))).limit(1)
    : [undefined];
  const [report] = reportId
    ? await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, Number(reportId))).limit(1)
    : [undefined];
  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);

  const patientFirstName = patient?.firstName ?? "Patient";
  const clinicName = clinic?.name ?? "Care Diagnostics";
  const pdfLink = report?.publicToken
    ? `${process.env["SITE_URL"] ?? ""}/api/p/r/${report.publicToken}/pdf`
    : null;

  const message = `Dear ${patientFirstName},\n\nYour report from ${clinicName} is ready.${pdfLink ? `\n\nDownload: ${pdfLink}` : ""}\n\nThank you,\n${clinicName}`;
  res.json({ message, pdfLink, patientPhone: patient?.phone ?? null, patientEmail: patient?.email ?? null });
});
