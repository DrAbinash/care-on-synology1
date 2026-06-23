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
} from "@workspace/db/schema";
import { and, eq, or, sql, inArray, gte, lte, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { todayIST } from "../lib/istDate";
import { createOrLinkPatientFromDicom, type DicomDemographics } from "../lib/dicomPatientCreator";
import { computeStudyPriority, applyPriorityToStudy } from "../lib/studyPriorityEngine";
import { assignRadiologistToStudy } from "../lib/radiologistAssignment";
import { runUsgExtraction } from "../lib/usgExtractor";

const router = Router();

// ── Auth ─────────────────────────────────────────────────────────────────────

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

router.use(requireInternalApiKey);

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

    const studyId = typeof b.studyId === "number" ? b.studyId : undefined;
    const patientId = b.patientId !== undefined ? String(b.patientId) : "";
    const patientName = typeof b.patientName === "string" ? b.patientName.trim() : "";
    const age = typeof b.age === "string" ? b.age.trim() || null : null;
    const sex = typeof b.sex === "string" ? b.sex.trim() || null : null;
    const modality = typeof b.modality === "string" ? b.modality.trim() || "OT" : "OT";
    const studyDescription = typeof b.studyDescription === "string" ? b.studyDescription.trim() || null : null;
    const studyDate = typeof b.studyDate === "string" ? b.studyDate.trim() || null : null;
    const accessionNumber = typeof b.accessionNumber === "string" ? b.accessionNumber.trim() : "";
    const studyInstanceUID = typeof b.studyInstanceUID === "string" ? b.studyInstanceUID.trim() || null : null;
    const aeTitle = typeof b.aeTitle === "string" ? b.aeTitle.trim() || null : null;
    const ipAddress = typeof b.ipAddress === "string" ? b.ipAddress.trim() || null : null;
    const port = typeof b.port === "number" ? b.port : null;
    const referringDoctor = typeof b.referringDoctor === "string" ? b.referringDoctor.trim() || null : null;
    const weasisUrl = typeof b.weasisUrl === "string" ? b.weasisUrl.trim() || null : null;
    const sourcePacs = typeof b.sourcePacs === "string" ? b.sourcePacs.trim() || null : null;
    const sourceAeTitle = typeof b.sourceAeTitle === "string" ? b.sourceAeTitle.trim() || null : null;
    const dicomMetadata = typeof b.dicomMetadata === "string" ? b.dicomMetadata.trim() || null : null;

    if (!accessionNumber) {
      logger.warn("Missing accessionNumber");
      res.status(400).json({ success: false, error: "accessionNumber is required" });
      return;
    }
    if (!patientName) {
      logger.warn("Missing patientName");
      res.status(400).json({ success: false, error: "patientName is required" });
      return;
    }

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

    let existing: typeof radiologyWorklistTable.$inferSelect | undefined;
    if (studyInstanceUID) {
      const rows = await db
        .select()
        .from(radiologyWorklistTable)
        .where(or(
          eq(radiologyWorklistTable.studyInstanceUID, studyInstanceUID),
          eq(radiologyWorklistTable.accessionNumber, accessionNumber),
        ));
      existing = rows[0];
    } else {
      const rows = await db
        .select()
        .from(radiologyWorklistTable)
        .where(eq(radiologyWorklistTable.accessionNumber, accessionNumber));
      existing = rows[0];
    }

    const values = {
      studyId: studyId ?? null,
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
      sourcePacs,
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

    // Auto-trigger USG measurement extraction for US modality studies.
    // Fire-and-forget: never blocks the intake response.
    if (modality === "US" && studyInstanceUID) {
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
    studyId?: number;
    accessionNumber?: string;
    studyInstanceUID?: string;
    status?: string;
    deliveryStatus?: string;
    reportId?: number;
    actor?: string;
  };

  // Find worklist row
  let existing: typeof radiologyWorklistTable.$inferSelect | undefined;
  if (b.studyInstanceUID) {
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

  const VALID_STATUSES = ["STUDY_RECEIVED", "AI_DRAFT_READY", "REPORT_IN_PROGRESS", "REPORT_FINAL", "DELIVERED"];
  const VALID_DELIVERY = ["READY_TO_SEND", "SENT"];

  const updates: Partial<typeof radiologyWorklistTable.$inferInsert> = { updatedAt: new Date() };
  if (b.status && VALID_STATUSES.includes(b.status)) updates.status = b.status;
  if (b.deliveryStatus && VALID_DELIVERY.includes(b.deliveryStatus)) updates.deliveryStatus = b.deliveryStatus;
  if (b.reportId) updates.reportId = b.reportId;

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
    details: { changes },
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

// GET /api/internal/radiology/worklist/:id
router.get("/radiology/worklist/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(radiologyWorklistTable).where(eq(radiologyWorklistTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let pacsArchiveStatus = "none";
  let pacsArchiveResponse = null;
  let pacsInstanceId = null;

  if (row.studyId) {
    const [study] = await db
      .select({
        pacsArchiveStatus: radiologyStudiesTable.pacsArchiveStatus,
        pacsArchiveResponse: radiologyStudiesTable.pacsArchiveResponse,
        pacsInstanceId: radiologyStudiesTable.pacsInstanceId,
      })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, row.studyId));

    if (study) {
      pacsArchiveStatus = study.pacsArchiveStatus || "none";
      pacsArchiveResponse = study.pacsArchiveResponse;
      pacsInstanceId = study.pacsInstanceId;
    }
  }

  res.json({
    ...row,
    pacsArchiveStatus,
    pacsArchiveResponse,
    pacsInstanceId,
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

// Map internal gender strings → DICOM sex codes M / F / O
function dicomSex(gender: string | null | undefined): "M" | "F" | "O" {
  const g = (gender ?? "").toLowerCase().trim();
  if (g === "male" || g === "m") return "M";
  if (g === "female" || g === "f") return "F";
  return "O";
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
    patientSex:                  r.patientSex ?? "",
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
