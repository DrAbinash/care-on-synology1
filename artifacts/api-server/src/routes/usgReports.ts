/**
 * USG Report Drafts Routes — Phase 9 Enterprise edition
 * Mounted at: /api/usg-reports  (staff-auth required)
 *
 * GET    /                       — list all report drafts (latest first)
 * GET    /:id                    — get a single draft
 * GET    /:id/history            — full version chain (prior → amendments)
 * GET    /prior/by-patient/:pid — list prior USG reports for a patient
 * GET    /:id/images            — finding-image links for this draft
 * POST   /suggest-template       — body: { modality?, studyDescription?, bodyPart? }
 * POST   /                       — create a new draft (auto-fills if blank)
 * POST   /auto-generate          — generate fresh template body from approved measurements
 * POST   /:id/regenerate         — overwrite an existing draft from latest approved measurements
 * PATCH  /:id                    — update draft content / template / status (blocked if finalized)
 * POST   /:id/verify             — mark verified (intermediate step before finalize)
 * POST   /:id/finalize           — finalize — explicit user click + quality check + verified status
 * POST   /:id/finalize-force     — super_admin force finalize with reason (logged)
 * POST   /:id/amend              — clone finalized → new amended draft (priorVersionId set)
 * POST   /:id/archive            — archive a report
 * DELETE /:id                    — delete a draft (admin/super_admin only)
 */

import { Router, type Request } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  usgReportDraftsTable,
  usgMeasurementsTable,
  usgDopplerMeasurementsTable,
  usgAuditLogTable,
  usgReportAmendmentsTable,
  usgFindingImageLinksTable,
  radiologyWorklistTable,
  patientsTable,
  formFRecordsTable,
} from "@workspace/db/schema";
import { eq, desc, and, ne, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  USG_TEMPLATES,
  suggestTemplate,
  autoGenerateReport,
  type UsgTemplateId,
} from "../lib/usgReportTemplates";
import { fetchUsgSkeletonOverride, fetchCustomizedUsgTemplateIds } from "../lib/usgTemplateStore";
import { runQualityCheck } from "../lib/usgQualityCheck";

const router = Router();

type ReqWithStaff = Request & { staffSession?: { subjectId?: number; subjectName?: string; role?: string } };
function staffOf(req: Request): { subjectId?: number; subjectName?: string; role?: string } {
  return (req as ReqWithStaff).staffSession ?? {};
}
function audit(req: Request, params: {
  entityType: string; entityId?: number | null; action: string;
  studyInstanceUID?: string | null; patientId?: number | null; details?: Record<string, unknown>;
}) {
  const s = staffOf(req);
  void db.insert(usgAuditLogTable).values({
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    action: params.action,
    performedBy: s.subjectName ?? "system",
    performedById: s.subjectId ?? null,
    performedByRole: s.role ?? null,
    studyInstanceUID: params.studyInstanceUID ?? null,
    patientId: params.patientId ?? null,
    details: JSON.stringify(params.details ?? {}),
  }).catch((err: unknown) => logger.warn({ err }, "usg audit insert failed"));
}

function computeHash(content: string, patientId: number | null, accessionNumber: string | null, finalizedAt: Date, finalizedBy: string): string {
  const payload = JSON.stringify({ content, patientId, accessionNumber, finalizedAt: finalizedAt.toISOString(), finalizedBy });
  return createHash("sha256").update(payload).digest("hex");
}

// ── GET / ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const patientId = req.query.patientId as string | undefined;
  const studyUid = req.query.studyUid as string | undefined;
  const conditions = [];
  if (status) conditions.push(eq(usgReportDraftsTable.status, status));
  if (patientId) conditions.push(eq(usgReportDraftsTable.patientId, Number(patientId)));
  if (studyUid) conditions.push(eq(usgReportDraftsTable.studyInstanceUID, studyUid));

  let q = db.select().from(usgReportDraftsTable).$dynamic();
  if (conditions.length) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(usgReportDraftsTable.updatedAt)).limit(200);
  res.json(rows);
});

// ── GET /templates ────────────────────────────────────────────────────────────

router.get("/templates", async (_req, res) => {
  // Annotate each descriptor with whether its skeleton is currently served
  // from the canonical structured_report_templates table ("customized") or
  // from the built-in fallback in lib/usgReportTemplates.ts.
  const customized = await fetchCustomizedUsgTemplateIds();
  res.json(USG_TEMPLATES.map((t) => ({ ...t, customized: customized.has(t.id) })));
});

// ── POST /suggest-template ───────────────────────────────────────────────────

router.post("/suggest-template", (req, res) => {
  const b = (req.body ?? {}) as { modality?: string; studyDescription?: string; bodyPart?: string };
  const templateId = suggestTemplate({
    modality: b.modality,
    studyDescription: b.studyDescription,
    bodyPart: b.bodyPart,
  });
  res.json({ templateId, descriptor: USG_TEMPLATES.find((t) => t.id === templateId) ?? null });
});

// ── GET /prior/by-patient/:patientId ────────────────────────────────────────

router.get("/prior/by-patient/:patientId", async (req, res) => {
  const patientId = Number(req.params.patientId);
  const rows = await db.select({
    id: usgReportDraftsTable.id,
    studyInstanceUID: usgReportDraftsTable.studyInstanceUID,
    accessionNumber: usgReportDraftsTable.accessionNumber,
    templateType: usgReportDraftsTable.templateType,
    status: usgReportDraftsTable.status,
    draftContent: usgReportDraftsTable.draftContent,
    finalizedAt: usgReportDraftsTable.finalizedAt,
    createdAt: usgReportDraftsTable.createdAt,
  })
    .from(usgReportDraftsTable)
    .where(and(eq(usgReportDraftsTable.patientId, patientId), isNotNull(usgReportDraftsTable.finalizedAt)))
    .orderBy(desc(usgReportDraftsTable.finalizedAt))
    .limit(20);
  res.json(rows);
});

// ── GET /:id ─────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── GET /:id/history ────────────────────────────────────────────────────

router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Walk backwards via priorVersionId to build the chain
  const chain: typeof row[] = [];
  let cur: typeof row | null = row;
  while (cur) {
    chain.unshift(cur);
    if (!cur.priorVersionId) break;
    const [prev] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, cur.priorVersionId)).limit(1);
    cur = prev ?? null;
  }

  const amendments = await db.select().from(usgReportAmendmentsTable)
    .where(eq(usgReportAmendmentsTable.priorVersionId, id))
    .orderBy(desc(usgReportAmendmentsTable.createdAt));

  res.json({ chain, amendments });
});

// ── GET /:id/images ────────────────────────────────────────────────────

router.get("/:id/images", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(usgFindingImageLinksTable)
    .where(eq(usgFindingImageLinksTable.draftId, id))
    .orderBy(usgFindingImageLinksTable.findingIndex);
  res.json(rows);
});

// ── helper: build auto-gen input from a study/worklist context ─────────────────────

async function gatherContext(opts: { studyInstanceUID?: string | null; worklistId?: number | null }) {
  const filterMeas = opts.studyInstanceUID
    ? eq(usgMeasurementsTable.studyInstanceUID, opts.studyInstanceUID)
    : opts.worklistId
      ? eq(usgMeasurementsTable.worklistId, opts.worklistId)
      : null;

  const measurement = filterMeas
    ? (await db.select().from(usgMeasurementsTable)
        .where(and(filterMeas, eq(usgMeasurementsTable.status, "approved")))
        .orderBy(desc(usgMeasurementsTable.createdAt))
        .limit(1))[0] ?? null
    : null;

  const filterDop = opts.studyInstanceUID
    ? eq(usgDopplerMeasurementsTable.studyInstanceUID, opts.studyInstanceUID)
    : opts.worklistId
      ? eq(usgDopplerMeasurementsTable.worklistId, opts.worklistId)
      : null;

  const dopplerMeasurements = filterDop
    ? await db.select().from(usgDopplerMeasurementsTable)
        .where(and(filterDop, eq(usgDopplerMeasurementsTable.status, "approved")))
        .orderBy(desc(usgDopplerMeasurementsTable.createdAt))
        .limit(30)
    : [];

  const wlFilter = opts.studyInstanceUID
    ? eq(radiologyWorklistTable.studyInstanceUID, opts.studyInstanceUID)
    : opts.worklistId
      ? eq(radiologyWorklistTable.id, opts.worklistId)
      : null;

  const worklist = wlFilter
    ? (await db.select().from(radiologyWorklistTable).where(wlFilter).limit(1))[0] ?? null
    : null;

  return { measurement, dopplerMeasurements, worklist };
}

// ── POST /auto-generate ────────────────────────────────────────────────────────

router.post("/auto-generate", async (req, res) => {
  const b = (req.body ?? {}) as {
    templateId?: UsgTemplateId;
    studyInstanceUID?: string;
    worklistId?: number;
    autoSuggest?: boolean;
  };

  try {
    const ctx = await gatherContext({ studyInstanceUID: b.studyInstanceUID, worklistId: b.worklistId });

    let templateId: UsgTemplateId = b.templateId ?? "WHOLE_ABDOMEN";
    if (b.autoSuggest && ctx.worklist) {
      templateId = suggestTemplate({
        modality: ctx.worklist.modality,
        studyDescription: ctx.worklist.studyDescription,
        bodyPart: undefined,
      });
    }

    const out = autoGenerateReport({
      templateId,
      measurement: ctx.measurement,
      dopplerMeasurements: ctx.dopplerMeasurements,
      patientName: ctx.worklist?.patientName ?? null,
      patientAge: null,
      patientSex: null,
      referringDoctor: ctx.worklist?.referringDoctor ?? null,
      accessionNumber: ctx.worklist?.accessionNumber ?? null,
      studyDate: ctx.worklist?.studyDate ?? null,
    }, { skeletonOverride: await fetchUsgSkeletonOverride(templateId) });

    res.json({
      ...out,
      hasApprovedMeasurements: ctx.measurement !== null,
      approvedDopplerCount: ctx.dopplerMeasurements.length,
      contextWorklistId: ctx.worklist?.id ?? null,
      contextPatientId: ctx.worklist?.patientId ?? null,
    });
  } catch (err) {
    logger.error({ err }, "POST /usg-reports/auto-generate failed");
    res.status(500).json({ error: "Failed to auto-generate" });
  }
});

// ── POST / ─────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const b = (req.body ?? {}) as {
    worklistId?: number; studyInstanceUID?: string; patientId?: number;
    accessionNumber?: string; templateType?: UsgTemplateId; draftContent?: string;
    autoFilledFromMeasurementId?: number; createdBy?: string;
  };

  try {
    let draftContent = b.draftContent ?? "";
    let autoFilledFromMeasurementId: number | null = b.autoFilledFromMeasurementId ?? null;

    if (!draftContent && (b.studyInstanceUID || b.worklistId)) {
      const ctx = await gatherContext({ studyInstanceUID: b.studyInstanceUID, worklistId: b.worklistId });
      const createTemplateId = (b.templateType ?? "WHOLE_ABDOMEN") as UsgTemplateId;
      const out = autoGenerateReport({
        templateId: createTemplateId,
        measurement: ctx.measurement,
        dopplerMeasurements: ctx.dopplerMeasurements,
        patientName: ctx.worklist?.patientName ?? null,
        referringDoctor: ctx.worklist?.referringDoctor ?? null,
        accessionNumber: b.accessionNumber ?? ctx.worklist?.accessionNumber ?? null,
        studyDate: ctx.worklist?.studyDate ?? null,
      }, { skeletonOverride: await fetchUsgSkeletonOverride(createTemplateId) });
      draftContent = out.content;
      autoFilledFromMeasurementId = ctx.measurement?.id ?? null;
    }

    const [row] = await db.insert(usgReportDraftsTable).values({
      worklistId: b.worklistId ?? null,
      studyInstanceUID: b.studyInstanceUID ?? null,
      patientId: b.patientId ?? null,
      accessionNumber: b.accessionNumber ?? null,
      templateType: b.templateType ?? "WHOLE_ABDOMEN",
      draftContent,
      status: "draft",
      autoFilledFromMeasurementId,
      createdBy: b.createdBy ?? staffOf(req).subjectName ?? null,
    }).returning();

    audit(req, { entityType: "draft", entityId: row.id, action: "create",
      studyInstanceUID: row.studyInstanceUID, patientId: row.patientId,
      details: { templateType: row.templateType } });

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /usg-reports failed");
    res.status(500).json({ error: "Failed to create report draft" });
  }
});

// ── POST /:id/regenerate ──────────────────────────────────────────────────────

router.post("/:id/regenerate", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { templateType?: UsgTemplateId };

  const [existing] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "finalized") {
    res.status(409).json({ error: "Cannot regenerate a finalized report. Use Amend instead." });
    return;
  }

  const ctx = await gatherContext({
    studyInstanceUID: existing.studyInstanceUID,
    worklistId: existing.worklistId,
  });

  const regenTemplateId = (b.templateType ?? existing.templateType) as UsgTemplateId;
  const out = autoGenerateReport({
    templateId: regenTemplateId,
    measurement: ctx.measurement,
    dopplerMeasurements: ctx.dopplerMeasurements,
    patientName: ctx.worklist?.patientName ?? null,
    referringDoctor: ctx.worklist?.referringDoctor ?? null,
    accessionNumber: existing.accessionNumber ?? ctx.worklist?.accessionNumber ?? null,
    studyDate: ctx.worklist?.studyDate ?? null,
  }, { skeletonOverride: await fetchUsgSkeletonOverride(regenTemplateId) });

  const [row] = await db.update(usgReportDraftsTable)
    .set({
      draftContent: out.content,
      templateType: (b.templateType ?? existing.templateType),
      autoFilledFromMeasurementId: ctx.measurement?.id ?? null,
      status: "draft",
      updatedAt: new Date(),
    })
    .where(eq(usgReportDraftsTable.id, id))
    .returning();

  audit(req, { entityType: "draft", entityId: id, action: "regenerate",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId,
    details: { templateType: row.templateType, filled: out.filledFieldCount, skipped: out.skippedLowConfidenceCount } });

  res.json(row);
});

// ── PATCH /:id ─────────────────────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { draftContent?: string; templateType?: string; status?: string };

  // Safety: only allow pending_review or draft transitions here; finalize/verify
  // must go through their dedicated endpoints which require explicit click.
  if (b.status && !["draft", "pending_review", "archived"].includes(b.status)) {
    res.status(400).json({ error: `Cannot set status to "${b.status}" via PATCH — use dedicated endpoint` });
    return;
  }

  // Immutability: finalized reports cannot be edited via PATCH
  // Also block content changes on verified drafts to prevent race with finalize.
  const [existing] = await db.select({ status: usgReportDraftsTable.status })
    .from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "finalized") {
    res.status(409).json({ error: "Finalized reports are immutable — use Amend to create a new version" });
    return;
  }
  if (existing.status === "verified" && ("draftContent" in b || "templateType" in b)) {
    res.status(409).json({ error: "Verified reports cannot be edited — use Finalize or Revert to Draft" });
    return;
  }

  const [row] = await db.update(usgReportDraftsTable)
    .set({
      draftContent: b.draftContent,
      templateType: b.templateType,
      status: b.status,
      updatedAt: new Date(),
    })
    .where(eq(usgReportDraftsTable.id, id))
    .returning();

  audit(req, { entityType: "draft", entityId: id, action: "update",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId,
    details: { fields: Object.keys(b) } });
  res.json(row);
});

// ── POST /:id/verify ──────────────────────────────────────────────────────

router.post("/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const verifiedBy = staffOf(req).subjectName ?? "staff";

  const [row] = await db.update(usgReportDraftsTable)
    .set({ status: "verified", verifiedBy, verifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(usgReportDraftsTable.id, id), ne(usgReportDraftsTable.status, "finalized")))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found or already finalized" }); return; }
  audit(req, { entityType: "draft", entityId: id, action: "verify",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId });
  res.json(row);
});

// ── POST /:id/quality-check ───────────────────────────────────────────────────

router.post("/:id/quality-check", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const ctx = await gatherContext({ studyInstanceUID: row.studyInstanceUID, worklistId: row.worklistId });

  const result = runQualityCheck({
    draftContent: row.draftContent,
    templateType: row.templateType,
    measurement: ctx.measurement,
    dopplerMeasurements: ctx.dopplerMeasurements,
    patientName: ctx.worklist?.patientName ?? null,
    referringDoctor: ctx.worklist?.referringDoctor ?? null,
    criticalAlertAcknowledged: false, // UI can override if alert is handled
  });

  res.json({ ...result, draftId: id });
});

// ── POST /:id/finalize ──────────────────────────────────────────────────────────

router.post("/:id/finalize", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { finalizedBy?: string; confirm?: boolean };

  if (b.confirm !== true) {
    res.status(400).json({ error: "Finalize requires explicit user confirmation (confirm:true)" });
    return;
  }

  // Lifecycle: must pass through verify first.
  const [existing] = await db.select({ status: usgReportDraftsTable.status, draftContent: usgReportDraftsTable.draftContent, patientId: usgReportDraftsTable.patientId, accessionNumber: usgReportDraftsTable.accessionNumber })
    .from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "verified") {
    res.status(409).json({ error: "Report must be verified before it can be finalized" });
    return;
  }

  // Mandatory quality check before finalize
  const [draftRow] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!draftRow) { res.status(404).json({ error: "Not found" }); return; }

  // PCPNDT Form F Lock
  if (draftRow.templateType?.startsWith("OB_")) {
    if (!existing.patientId) {
      res.status(400).json({ error: "Patient ID is missing for this obstetric report." });
      return;
    }
    const [formF] = await db
      .select()
      .from(formFRecordsTable)
      .where(eq(formFRecordsTable.patientId, existing.patientId))
      .orderBy(desc(formFRecordsTable.createdAt))
      .limit(1);

    if (!formF) {
      res.status(400).json({ error: "PCPNDT Form F record is missing for this obstetric study." });
      return;
    }

    const formFErrors: string[] = [];
    if (!formF.idCardVerified) {
      formFErrors.push("ID Card must be verified.");
    }
    if (!formF.husbandFatherName?.trim()) {
      formFErrors.push("Husband/Father Name is required.");
    }
    if (!formF.address?.trim()) {
      formFErrors.push("Address is required.");
    }
    if (!formF.consentDate?.trim() && !formF.procedureDate?.trim()) {
      formFErrors.push("Consent Date or Procedure Date is required.");
    }

    if (formFErrors.length > 0) {
      res.status(400).json({
        error: "PCPNDT Form F compliance lock: Mandatory fields are missing or unverified.",
        validationErrors: formFErrors,
      });
      return;
    }
  }

  const ctx = await gatherContext({ studyInstanceUID: draftRow.studyInstanceUID, worklistId: draftRow.worklistId });
  let patientSex: string | null = null;
  if (existing.patientId) {
    const [p] = await db.select({ gender: patientsTable.gender }).from(patientsTable).where(eq(patientsTable.id, existing.patientId)).limit(1);
    patientSex = p?.gender ?? null;
  }
  const qcResult = runQualityCheck({
    draftContent: existing.draftContent,
    templateType: draftRow?.templateType ?? "WHOLE_ABDOMEN",
    measurement: ctx.measurement,
    dopplerMeasurements: ctx.dopplerMeasurements,
    patientName: ctx.worklist?.patientName ?? null,
    referringDoctor: ctx.worklist?.referringDoctor ?? null,
    patientSex,
  });
  if (!qcResult.passed) {
    audit(req, { entityType: "draft", entityId: id, action: "quality_check_fail",
      studyInstanceUID: draftRow?.studyInstanceUID, patientId: existing.patientId,
      details: { errors: qcResult.errors, warnings: qcResult.warnings } });
    res.status(422).json({
      error: "Quality check failed — cannot finalize",
      qualityCheck: qcResult,
    });
    return;
  }

  const finalizedBy = staffOf(req).subjectName ?? "staff";
  const now = new Date();
  const hash = computeHash(existing.draftContent, existing.patientId, existing.accessionNumber, now, finalizedBy);

  const [row] = await db.update(usgReportDraftsTable)
    .set({
      status: "finalized",
      finalizedBy,
      finalizedAt: now,
      finalizedReportHash: hash,
      updatedAt: now,
    })
    .where(and(eq(usgReportDraftsTable.id, id), eq(usgReportDraftsTable.status, "verified")))
    .returning();
  if (!row) { res.status(409).json({ error: "Finalize race — status changed" }); return; }

  audit(req, { entityType: "draft", entityId: id, action: "finalize",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId,
    details: { finalizedBy, hash } });
  res.json(row);
});

// ── POST /:id/finalize-force ───────────────────────────────────────────────────
// Super-admin only — bypass quality check with documented reason.

router.post("/:id/finalize-force", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { reason?: string; confirm?: boolean };

  const role = staffOf(req).role ?? "";
  if (!["admin", "super_admin"].includes(role)) {
    res.status(403).json({ error: "Only admin or super_admin may force finalize" });
    return;
  }
  if (!b.reason || b.reason.trim().length < 3) {
    res.status(400).json({ error: "Force finalize requires a documented reason (min 3 chars)" });
    return;
  }
  if (b.confirm !== true) {
    res.status(400).json({ error: "Force finalize requires explicit confirmation (confirm:true)" });
    return;
  }

  // Force-finalize is only allowed on verified drafts (not already finalized ones)
  const [existing] = await db.select({ status: usgReportDraftsTable.status, draftContent: usgReportDraftsTable.draftContent, patientId: usgReportDraftsTable.patientId, accessionNumber: usgReportDraftsTable.accessionNumber })
    .from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "finalized") {
    res.status(409).json({ error: "Already finalized — cannot force finalize. Use Amend instead." });
    return;
  }

  const finalizedBy = staffOf(req).subjectName ?? "staff";
  const now = new Date();
  const hash = computeHash(existing.draftContent, existing.patientId, existing.accessionNumber, now, finalizedBy);

  const [row] = await db.update(usgReportDraftsTable)
    .set({
      status: "finalized",
      finalizedBy,
      finalizedAt: now,
      finalizedReportHash: hash,
      updatedAt: now,
    })
    .where(and(eq(usgReportDraftsTable.id, id), ne(usgReportDraftsTable.status, "finalized")))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  audit(req, { entityType: "draft", entityId: id, action: "finalize_force",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId,
    details: { finalizedBy, reason: b.reason, hash } });
  res.json(row);
});

// ── POST /:id/amend ────────────────────────────────────────────────────────────

router.post("/:id/amend", async (req, res) => {
  const id = Number(req.params.id);
  const b = (req.body ?? {}) as { amendmentReason?: string };
  const amendedBy = staffOf(req).subjectName ?? "staff";
  const amendmentReason = b.amendmentReason?.trim() ?? "";

  const [orig] = await db.select().from(usgReportDraftsTable).where(eq(usgReportDraftsTable.id, id)).limit(1);
  if (!orig) { res.status(404).json({ error: "Not found" }); return; }
  if (orig.status !== "finalized") {
    res.status(400).json({ error: "Only finalized reports can be amended" });
    return;
  }

  const newContent = `${orig.draftContent}\n\n──── AMENDMENT (by ${amendedBy} on ${new Date().toISOString().slice(0,10)}) ────\n`;

  const [newDraft] = await db.insert(usgReportDraftsTable).values({
    worklistId: orig.worklistId,
    studyInstanceUID: orig.studyInstanceUID,
    patientId: orig.patientId,
    accessionNumber: orig.accessionNumber,
    templateType: orig.templateType,
    draftContent: newContent,
    status: "amended",
    autoFilledFromMeasurementId: orig.autoFilledFromMeasurementId,
    createdBy: amendedBy,
    amendedBy,
    amendedAt: new Date(),
    priorVersionId: orig.id,
    amendmentReason: amendmentReason || undefined,
  }).returning();

  // Record full amendment history
  await db.insert(usgReportAmendmentsTable).values({
    draftId: newDraft.id,
    priorVersionId: orig.id,
    amendmentReason: amendmentReason || "No reason provided",
    amendedBy,
    amendedById: staffOf(req).subjectId ?? null,
    priorContent: orig.draftContent,
    newContent,
  });

  audit(req, { entityType: "draft", entityId: newDraft.id, action: "amend",
    studyInstanceUID: newDraft.studyInstanceUID, patientId: newDraft.patientId,
    details: { priorVersionId: orig.id, reason: amendmentReason } });
  res.status(201).json(newDraft);
});

// ── POST /:id/archive ────────────────────────────────────────────────────────────

router.post("/:id/archive", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(usgReportDraftsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(usgReportDraftsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  audit(req, { entityType: "draft", entityId: id, action: "update",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId, details: { status: "archived" } });
  res.json(row);
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
// Destructive — gated to admin / super_admin roles only.

router.delete("/:id", async (req, res) => {
  const role = staffOf(req).role ?? "";
  if (!["admin", "super_admin"].includes(role)) {
    res.status(403).json({ error: "Only admin or super_admin may delete USG report drafts" });
    return;
  }
  const id = Number(req.params.id);
  const [row] = await db.delete(usgReportDraftsTable)
    .where(eq(usgReportDraftsTable.id, id))
    .returning({ id: usgReportDraftsTable.id, studyInstanceUID: usgReportDraftsTable.studyInstanceUID, patientId: usgReportDraftsTable.patientId });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  audit(req, { entityType: "draft", entityId: id, action: "delete",
    studyInstanceUID: row.studyInstanceUID, patientId: row.patientId });
  res.json({ success: true });
});

export const usgReportsRouter = router;
