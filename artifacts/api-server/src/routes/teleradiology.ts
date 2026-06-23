import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  radiologyShareLinksTable, radiologyStudiesTable,
  patientsTable, testsTable, clinicSettingsTable,
  patientReportsTable,
} from "@workspace/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { sanitizePatient } from "./patients";

function firstHeader(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export const teleradiologyRouter: IRouter = Router();

// PUBLIC — tokenized study viewer. Used by:
//   - Patient WhatsApp links (audience=patient): shows the verified report PDF
//     link + a friendly summary; never exposes radiologist drafts or PII beyond
//     the patient's own first name + report number.
//   - Remote/night radiologists (audience=radiologist): shows the full study
//     metadata + draft report to read away from the lab.
//
// Tokens expire and are revocable. Each open is logged.
teleradiologyRouter.get("/share/:token", async (req, res) => {
  const token = req.params.token;
  const [link] = await db.select().from(radiologyShareLinksTable).where(eq(radiologyShareLinksTable.token, token));
  if (!link) { res.status(404).type("html").send(notFoundPage("Link not found")); return; }
  if (link.revokedAt) { res.status(410).type("html").send(notFoundPage("This link was revoked.")); return; }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    res.status(410).type("html").send(notFoundPage("This link has expired.")); return;
  }

  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, link.studyId));
  if (!study) { res.status(404).type("html").send(notFoundPage("Study not found")); return; }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, study.patientId));
  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, study.testId));
  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);

  // Bump access counters (best-effort).
  void db.update(radiologyShareLinksTable)
    .set({ accessCount: link.accessCount + 1, lastAccessedAt: new Date() })
    .where(eq(radiologyShareLinksTable.id, link.id))
    .catch(() => undefined);

  // Find the linked patient_report so the patient can download the proper
  // PDF — radiology drafts on the study itself are never exposed to patients.
  // Prefer the latest *verified or delivered* report; fall back to the latest
  // row only for status display purposes (so we still render "in progress"
  // when no finalised report exists yet).
  const finalisedReports = await db
    .select()
    .from(patientReportsTable)
    .where(and(
      eq(patientReportsTable.studyId, study.id),
      or(
        eq(patientReportsTable.status, "verified"),
        eq(patientReportsTable.status, "delivered"),
      ),
    ))
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(1);
  const report = finalisedReports[0];

  const isPatient = link.audience === "patient";
  const html = isPatient
    ? renderPatientView({ study, patient, test, clinic, report, token })
    : renderRadiologistView({ study, patient, test, clinic, token });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// JSON variant for the radiologist-side reader UI.
teleradiologyRouter.get("/share/:token.json", async (req, res) => {
  const token = req.params.token;
  const [link] = await db.select().from(radiologyShareLinksTable)
    .where(and(
      eq(radiologyShareLinksTable.token, token),
      isNull(radiologyShareLinksTable.revokedAt),
    ));
  if (!link) { res.status(404).json({ error: "Not found or revoked" }); return; }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: "Link expired" }); return;
  }
  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, link.studyId));
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, study.patientId));
  const [test] = await db.select().from(testsTable).where(eq(testsTable.id, study.testId));
  const safe = link.audience === "patient"
    ? {
        accessionNumber: study.accessionNumber,
        modality: study.modality,
        studyDate: study.studyDate,
        testName: test?.name ?? null,
        patientFirstName: patient?.firstName ?? null,
      }
    : { study, patient: patient ? sanitizePatient(patient) : null, test };
  res.json({ audience: link.audience, ...safe });
});

void firstHeader;

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function notFoundPage(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Link unavailable</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#1e293b;padding:32px;border-radius:16px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.4)}
h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#94a3b8}</style></head>
<body><div class="card"><h1>Link unavailable</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}

function renderPatientView(p: {
  study: typeof radiologyStudiesTable.$inferSelect;
  patient: typeof patientsTable.$inferSelect | undefined;
  test: typeof testsTable.$inferSelect | undefined;
  clinic: typeof clinicSettingsTable.$inferSelect | undefined;
  report: typeof patientReportsTable.$inferSelect | undefined;
  token: string;
}): string {
  const { study, patient, test, clinic, report } = p;
  const clinicName = escapeHtml(clinic?.name ?? "Care Diagnostics");
  const heroColor = "#0ea5e9";
  const ready = report && (report.status === "verified" || report.status === "delivered");
  // The viewer is public — never link to the staff-authenticated PDF route.
  // Use the patient-report public token instead (created lazily on first
  // share). If for some reason the token is missing we hide the download link
  // and ask the patient to wait for the WhatsApp delivery message.
  const reportUrl = report?.publicToken ? `/api/p/r/${report.publicToken}/pdf` : null;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${clinicName} — Your Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:0}
.wrap{max-width:520px;margin:0 auto;padding:24px}
.hero{background:${heroColor};color:#fff;padding:24px;border-radius:16px;margin-bottom:16px;box-shadow:0 4px 12px rgba(2,132,199,.25)}
.hero h1{margin:0 0 4px;font-size:20px}.hero p{margin:0;opacity:.9;font-size:13px}
.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px}.row:last-child{border-bottom:0}
.row span{color:#64748b}.row strong{color:#0f172a}
.btn{display:block;background:${heroColor};color:#fff;text-align:center;padding:14px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:12px}
.btn.outline{background:transparent;color:${heroColor};border:2px solid ${heroColor}}
.muted{color:#64748b;font-size:12px;text-align:center;margin-top:24px}
.pending{background:#fef3c7;color:#92400e;padding:14px;border-radius:10px;font-size:14px;text-align:center}
</style></head>
<body><div class="wrap">
  <div class="hero">
    <h1>Hello ${escapeHtml(patient?.firstName ?? "")}</h1>
    <p>${clinicName} secure report portal</p>
  </div>
  <div class="card">
    <div class="row"><span>Study</span><strong>${escapeHtml(test?.name ?? study.modality)}</strong></div>
    <div class="row"><span>Accession</span><strong>${escapeHtml(study.accessionNumber)}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeHtml(String(study.studyDate))}</strong></div>
    <div class="row"><span>Status</span><strong>${ready ? "Ready" : "In progress"}</strong></div>
  </div>
  ${ready && reportUrl
    ? `<a class="btn" href="${reportUrl}" target="_blank" rel="noopener">📄 Download report (PDF)</a>
       <a class="btn outline" href="${reportUrl}" target="_blank" rel="noopener">View in browser</a>`
    : `<div class="pending">Your report is being prepared. Please check back later — we'll send another message when it's ready.</div>`}
  <p class="muted">${clinicName}${clinic?.phone ? " · " + escapeHtml(clinic.phone) : ""}</p>
</div></body></html>`;
}

function renderRadiologistView(p: {
  study: typeof radiologyStudiesTable.$inferSelect;
  patient: typeof patientsTable.$inferSelect | undefined;
  test: typeof testsTable.$inferSelect | undefined;
  clinic: typeof clinicSettingsTable.$inferSelect | undefined;
  token: string;
}): string {
  const { study, patient, test, clinic } = p;
  const clinicName = escapeHtml(clinic?.name ?? "Care Diagnostics");
  const draft = study.finalReport || study.prelimReport || "";
  const fullName = [patient?.firstName, patient?.lastName].filter(Boolean).join(" ");
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Tele-radiology · ${escapeHtml(study.accessionNumber)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;line-height:1.5}
.wrap{max-width:880px;margin:0 auto}
h1{font-size:18px;margin:0 0 4px;color:#f1f5f9}
.sub{color:#94a3b8;font-size:12px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;background:#1e293b;border-radius:12px;padding:16px;margin-bottom:16px}
.grid b{color:#cbd5e1}.grid span{color:#e2e8f0}
.label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.report{background:#1e293b;border-radius:12px;padding:20px;white-space:pre-wrap;font-size:14px;color:#e2e8f0;border-left:4px solid #06b6d4}
.empty{color:#64748b;font-style:italic}
.banner{background:#0c4a6e;color:#bae6fd;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px}
.history{background:#1e293b;border-radius:12px;padding:16px;margin-bottom:16px;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#cbd5e1}
</style></head>
<body><div class="wrap">
  <div class="banner">🔒 Read-only tele-radiology view · ${clinicName}</div>
  <h1>${escapeHtml(test?.name ?? study.modality)} — ${escapeHtml(study.accessionNumber)}</h1>
  <p class="sub">${escapeHtml(study.modality)} · ${escapeHtml(String(study.studyDate))} · ${escapeHtml(study.status)}</p>
  <div class="grid">
    <b>Patient</b><span>${escapeHtml(fullName || "—")}</span>
    <b>Patient ID</b><span>${escapeHtml(patient?.patientId ?? "—")}</span>
    <b>Gender</b><span>${escapeHtml(patient?.gender ?? "—")}</span>
    <b>DOB</b><span>${escapeHtml(String(patient?.dateOfBirth ?? "—"))}</span>
    <b>Modality</b><span>${escapeHtml(study.modality)}</span>
    <b>Test</b><span>${escapeHtml(test?.name ?? "—")}</span>
    <b>Technician</b><span>${escapeHtml(study.technicianName ?? "—")}</span>
    <b>Images</b><span>${study.numImages}</span>
  </div>
  ${study.clinicalHistory ? `<div class="history"><div class="label">Clinical History</div>${escapeHtml(study.clinicalHistory)}</div>` : ""}
  <div class="label">Draft Report</div>
  <div class="report">${draft ? escapeHtml(draft) : '<span class="empty">No draft yet — open the ERP to dictate.</span>'}</div>
</div></body></html>`;
}

export default teleradiologyRouter;
