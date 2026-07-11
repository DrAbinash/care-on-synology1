/**
 * presentation-templates.ts — Ticket R1.2: the template-engine API.
 *
 * Mounted at /api/radiology/presentation-templates behind requireStaffAuth +
 * requireStaffPermission("/radiology"). Reads (list, detail, preview) are
 * staff-visible so radiologists can preview available templates; every
 * mutation (publish, duplicate, retire, activate, reset, import) is
 * ADMIN-ONLY and audited into the hash-chained log.
 *
 * Published versions are immutable: there is no update endpoint at all —
 * only version-creating inserts and soft retirement. Import is validated
 * whole-or-nothing with a dry-run mode; export is a versioned JSON envelope.
 */

import { Router, type Response } from "express";
import { db } from "@workspace/db";
import { clinicSettingsTable } from "@workspace/db/schema";
import { requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { auditFromRequest } from "../lib/audit";
import {
  COPY_TYPES, SAFE_FONT_FAMILIES, TEMPLATE_SLOTS, compileTemplate,
  validateTemplateKey, type CopyType,
} from "../lib/presentationTemplateModel";
import {
  duplicateTemplate, exportTemplateVersion, getTemplateVersion, importTemplate,
  latestPublishedVersion, listTemplateVersions, publishTemplateVersion,
  readActiveSelections, resetToCareDefault, retireTemplateVersion, writeActiveSelection,
} from "../lib/presentationTemplateStore";
import { renderReportDocument, type ReportDocumentModel } from "../lib/reportPresentation";

export const presentationTemplatesRouter = Router();

function actor(req: StaffAuthRequest): string {
  return req.staffSession?.subjectName ?? "unknown";
}

async function audit(req: StaffAuthRequest, action: string, entityId: string, detail: Record<string, unknown>): Promise<void> {
  await auditFromRequest(req, {
    userId: req.staffSession?.subjectId ?? null,
    userName: req.staffSession?.subjectName ?? "unknown",
    role: req.staffSession?.role ?? "unknown",
    action,
    module: "radiology",
    entityType: "presentation_template",
    entityId,
    newValue: JSON.stringify(detail),
  }).catch((err) => {
    // The mutation already succeeded; a template presentation change must not
    // fail the request over a transient audit-write error — but it must NOT
    // vanish silently either (the router's contract is "every mutation is
    // audited"). Surface it in the logs for reconciliation.
    req.log?.error({ err, action, entityId }, "presentation_template audit write failed");
  });
}

// ── Reads (staff) ────────────────────────────────────────────────────────────

presentationTemplatesRouter.get("/", async (_req: StaffAuthRequest, res: Response) => {
  const [templates, active] = await Promise.all([listTemplateVersions(), readActiveSelections()]);
  res.json({
    templates,
    active,
    copyTypes: COPY_TYPES,
    safeFonts: SAFE_FONT_FAMILIES,
    slots: TEMPLATE_SLOTS,
  });
});

presentationTemplatesRouter.get("/:key/:version", async (req: StaffAuthRequest, res: Response) => {
  const versionNum = Number(req.params.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) { res.status(400).json({ error: "invalid version" }); return; }
  const record = await getTemplateVersion(String(req.params.key), versionNum);
  if (!record) { res.status(404).json({ error: "template version not found" }); return; }
  res.json(record);
});

// Preview with SAFE SAMPLE DATA only — no patient identifiers ever leave
// this endpoint; the clinic header comes from clinic settings so the admin
// sees real branding on fake content.
const SAMPLE_IMAGE =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAoACgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiigAooooAKKKKACiiigD//2Q==";

function sampleModel(clinic: { name?: string | null; tagline?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; logoDataUrl?: string | null } | undefined, withImages: boolean): ReportDocumentModel {
  return {
    reportNumber: "SAMPLE-0000",
    studyTitle: "MRI BRAIN (PLAIN) — SAMPLE",
    typeLabel: "RADIOLOGY",
    statusLabel: "SAMPLE",
    clinic: {
      name: clinic?.name ?? "Care Diagnostics",
      tagline: clinic?.tagline ?? "",
      address: clinic?.address ?? "",
      phone: clinic?.phone ?? "",
      email: clinic?.email ?? "",
      website: clinic?.website ?? "",
      logoDataUrl: clinic?.logoDataUrl ?? null,
    },
    patientRows: [
      { label: "Patient", value: "SAMPLE PATIENT" },
      { label: "Patient ID", value: "P-SAMPLE-01" },
      { label: "Age / Sex", value: "42y / F" },
      { label: "Date", value: "11/07/2026" },
      { label: "Test", value: "MRI BRAIN PLAIN" },
      { label: "Referring Doctor", value: "Dr. Sample Referrer" },
    ],
    impression: "Sample impression line — this document contains no real patient data.",
    bodyHtml: [
      `<div class="section-heading">Clinical History</div><p>Sample clinical history for template preview.</p>`,
      `<div class="section-heading">Technique</div><p>Multiplanar multisequence sample technique text.</p>`,
      `<div class="section-heading">Findings</div>`,
      ...Array.from({ length: 6 }, (_, i) => `<p>Sample finding paragraph ${i + 1}. The quick brown fox jumps over the lazy dog to demonstrate body typography, line height and page-break behavior across a longer report.</p>`),
      `<div class="section-heading">Impression</div><ol><li>Sample impression one.</li><li>Sample impression two.</li></ol>`,
    ].join("\n"),
    keyImages: withImages
      ? [
          { src: SAMPLE_IMAGE, caption: "SAMPLE T2 AXIAL", displayOrder: 0 },
          { src: SAMPLE_IMAGE, caption: "SAMPLE FLAIR", displayOrder: 1 },
        ]
      : [],
    stamp: { kind: "verified", label: "SAMPLE — NOT A REPORT" },
    signatures: [{ name: "Dr. Sample Radiologist", qualification: "MD (Radiodiagnosis)", registrationNo: "SAMPLE-001", label: "Signed:", whenLabel: " 11/07/2026" }],
    showQrPlaceholder: true,
    footerNote: "Template preview — sample data only",
    generatedAtLabel: "sample preview",
    draftWatermark: false,
  };
}

presentationTemplatesRouter.get("/:key/:version/preview", async (req: StaffAuthRequest, res: Response) => {
  const versionNum = Number(req.params.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) { res.status(400).send("invalid version"); return; }
  const record = await getTemplateVersion(String(req.params.key), versionNum);
  if (!record) { res.status(404).send("Template version not found"); return; }
  const [clinic] = await db.select().from(clinicSettingsTable).limit(1);
  const withImages = req.query.images !== "false";
  const html = renderReportDocument(sampleModel(clinic, withImages), compileTemplate(record));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

// ── Export (admin) ───────────────────────────────────────────────────────────

presentationTemplatesRouter.get("/:key/:version/export", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const versionNum = Number(req.params.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) { res.status(400).json({ error: "invalid version" }); return; }
  const envelope = await exportTemplateVersion(String(req.params.key), versionNum);
  if (!envelope) { res.status(404).json({ error: "template version not found" }); return; }
  await audit(req, "presentation_template_export", `${envelope.templateKey}@${envelope.version}`, { copyType: envelope.copyType });
  res.setHeader("Content-Disposition", `attachment; filename="report-template_${envelope.templateKey}_v${envelope.version}.json"`);
  res.json(envelope);
});

// ── Mutations (admin, audited; inserts + status flips only) ─────────────────

presentationTemplatesRouter.post("/publish", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  // Do NOT launder an invalid copyType to "standard" (that would silently
  // publish a patient/referrer variant as the default clinic presentation) —
  // reject it, exactly as the import path does.
  if (b.copyType != null && !COPY_TYPES.includes(b.copyType as never)) {
    res.status(400).json({ error: "validation failed", issues: [{ path: "copyType", message: `copy type must be one of ${COPY_TYPES.join("|")}` }] });
    return;
  }
  const result = await publishTemplateVersion({
    templateKey: String(b.templateKey ?? ""),
    displayName: String(b.displayName ?? ""),
    description: typeof b.description === "string" ? b.description : null,
    copyType: (b.copyType ?? "standard") as CopyType,
    definition: b.definition,
    createdBy: actor(req),
  });
  if (!result.ok) { res.status(400).json({ error: "validation failed", issues: result.issues }); return; }
  await audit(req, "presentation_template_publish", `${result.record!.templateKey}@${result.record!.version}`, { displayName: result.record!.displayName });
  res.status(201).json(result.record);
});

presentationTemplatesRouter.post("/duplicate", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const result = await duplicateTemplate({
    sourceKey: String(b.sourceKey ?? ""),
    sourceVersion: Number(b.sourceVersion ?? 0),
    newKey: String(b.newKey ?? ""),
    displayName: String(b.displayName ?? ""),
    createdBy: actor(req),
  });
  if (!result.ok) { res.status(400).json({ error: "validation failed", issues: result.issues }); return; }
  await audit(req, "presentation_template_duplicate", `${result.record!.templateKey}@1`, { source: `${String(b.sourceKey)}@${Number(b.sourceVersion)}` });
  res.status(201).json(result.record);
});

presentationTemplatesRouter.post("/retire", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const templateKey = String(b.templateKey ?? "");
  const version = Number(b.version ?? 0);
  const force = b.force === true;
  const result = await retireTemplateVersion(templateKey, version, actor(req), force);
  if (!result.ok) { res.status(409).json({ error: "cannot retire", issues: result.issues, orphans: result.orphans }); return; }
  await audit(req, "presentation_template_retire", `${templateKey}@${version}`, { force });
  res.json(result.record);
});

presentationTemplatesRouter.post("/activate", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const templateKey = String(b.templateKey ?? "");
  // Reject an unknown copyType rather than laundering it to "standard" (which
  // would overwrite the standard active selection — every staff print surface).
  if (b.copyType != null && !COPY_TYPES.includes(b.copyType as never)) {
    res.status(400).json({ error: `copy type must be one of ${COPY_TYPES.join("|")}` });
    return;
  }
  const copyType = (b.copyType ?? "standard") as CopyType;
  if (validateTemplateKey(templateKey).length > 0) { res.status(400).json({ error: "invalid template key" }); return; }
  const latest = await latestPublishedVersion(templateKey);
  if (!latest) { res.status(400).json({ error: `"${templateKey}" has no published version to activate` }); return; }
  await writeActiveSelection(copyType, templateKey, { id: req.staffSession?.subjectId ?? null, name: req.staffSession?.subjectName ?? null });
  await audit(req, "presentation_template_activate", templateKey, { copyType, latestVersion: latest.version });
  res.json({ ok: true, active: await readActiveSelections() });
});

presentationTemplatesRouter.post("/reset-default", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  await resetToCareDefault({ id: req.staffSession?.subjectId ?? null, name: req.staffSession?.subjectName ?? null });
  await audit(req, "presentation_template_reset_default", "care-classic", {});
  res.json({ ok: true, active: await readActiveSelections() });
});

presentationTemplatesRouter.post("/import", requireAdminRole, async (req: StaffAuthRequest, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const dryRun = b.dryRun === true;
  const result = await importTemplate(b.envelope, { dryRun, createdBy: actor(req) });
  // A dry run is a VALIDATION REPORT: it always returns 200 with the issues
  // (and wouldCreate when valid) so the UI can surface path-level problems
  // — a 400 would collapse to a bare "import rejected" string client-side.
  if (dryRun) { res.status(200).json(result); return; }
  if (!result.ok) { res.status(400).json({ error: "import rejected", issues: result.issues, dryRun }); return; }
  await audit(req, "presentation_template_import", `${result.record!.templateKey}@${result.record!.version}`, { notices: result.issues.length });
  res.status(201).json(result);
});
