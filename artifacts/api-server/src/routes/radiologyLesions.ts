/**
 * Phase 10A: Lesion Tracker API
 * Longitudinal lesion monitoring — create, list, update, add timeline entries.
 * All features OFF by default. Radiologist is always final authority.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyLesionsTable,
  radiologyLesionTimelineTable,
  radiologyMeasurementsTable,
  viewerMeasurementsTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { z } from "zod";
import { resolveMeasurement, getMeasurement } from "@workspace/measurements";

export const radiologyLesionsRouter = Router();

// ── Schema validators ────────────────────────────────────────────────────────

const createLesionSchema = z.object({
  patientId: z.number().int().positive(),
  lesionLabel: z.string().min(1).max(200),
  location: z.string().min(1).max(500),
  organ: z.string().max(200).optional(),
  subLocation: z.string().max(200).optional(),
  modality: z.string().min(1).max(50),
  bodyPart: z.string().max(200).optional(),
  firstStudyId: z.number().int().optional(),
  firstOrderId: z.number().int().optional(),
  lesionType: z.string().max(200).optional(),
  classification: z.string().max(100).optional(),
  classificationValue: z.string().max(100).optional(),
  morphology: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

const addTimelineSchema = z.object({
  studyId: z.number().int().optional(),
  orderId: z.number().int().optional(),
  measurementMm: z.number().optional(),
  measurementMm2: z.number().optional(),
  measurementMm3: z.number().optional(),
  volumeCc: z.number().optional(),
  seriesNumber: z.string().max(50).optional(),
  imageNumber: z.string().max(50).optional(),
  sliceLocation: z.string().max(100).optional(),
  changeStatus: z.enum(["improved", "stable", "progressed", "new", "resolved"]).optional(),
  changePercent: z.number().optional(),
  signalCharacteristics: z.string().max(500).optional(),
  enhancement: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const saveMeasurementSchema = z.object({
  patientId: z.number().int().positive(),
  studyId: z.number().int().optional(),
  orderId: z.number().int().optional(),
  modality: z.string().min(1).max(50),
  bodyPart: z.string().min(1).max(200),
  measurements: z.array(z.object({
    measurementType: z.string().min(1),
    label: z.string().min(1),
    measurementId: z.string().max(80).optional(),
    value: z.string().min(1),
    unit: z.string().optional(),
    normalRangeLow: z.number().optional(),
    normalRangeHigh: z.number().optional(),
    isAbnormal: z.boolean().optional(),
    notes: z.string().optional(),
  })),
});

// ── GET /radiology-lesions — list lesions for a patient ──────────────────────

radiologyLesionsRouter.get("/", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const patientId = Number(req.query.patientId);
  if (!patientId || isNaN(patientId)) {
    return res.status(400).json({ error: "patientId is required" });
  }
  try {
    const lesions = await db
      .select()
      .from(radiologyLesionsTable)
      .where(eq(radiologyLesionsTable.patientId, patientId))
      .orderBy(desc(radiologyLesionsTable.createdAt));
    return res.json({ lesions });
  } catch (err) {
    req.log.error({ err }, "lesions: list failed");
    return res.status(500).json({ error: "Failed to fetch lesions" });
  }
});

// ── POST /radiology-lesions — create a new lesion ────────────────────────────

radiologyLesionsRouter.post("/", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const parsed = createLesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const [lesion] = await db
      .insert(radiologyLesionsTable)
      .values({
        patientId: data.patientId,
        lesionLabel: data.lesionLabel,
        location: data.location,
        organ: data.organ,
        subLocation: data.subLocation,
        modality: data.modality,
        bodyPart: data.bodyPart,
        firstStudyId: data.firstStudyId,
        firstOrderId: data.firstOrderId,
        firstDetectedAt: new Date(),
        firstDetectedBy: sReq.staffSession?.subjectName ?? "Unknown",
        lesionType: data.lesionType,
        classification: data.classification,
        classificationValue: data.classificationValue,
        morphology: data.morphology,
        notes: data.notes,
      })
      .returning();
    return res.status(201).json({ lesion });
  } catch (err) {
    req.log.error({ err }, "lesions: create failed");
    return res.status(500).json({ error: "Failed to create lesion" });
  }
});

// ── PATCH /radiology-lesions/:id — update lesion ─────────────────────────────

radiologyLesionsRouter.patch("/:id", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const id = Number(req.params.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const allowed = ["lesionLabel", "location", "organ", "subLocation", "modality", "bodyPart",
    "lesionType", "classification", "classificationValue", "morphology", "notes",
    "status", "isResolved"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }
  if (req.body.isResolved === true) {
    updates.resolvedAt = new Date();
    updates.resolvedBy = sReq.staffSession?.subjectName ?? "Unknown";
    updates.status = "resolved";
  }
  updates.updatedAt = new Date();
  try {
    const [lesion] = await db
      .update(radiologyLesionsTable)
      .set(updates)
      .where(eq(radiologyLesionsTable.id, id))
      .returning();
    if (!lesion) return res.status(404).json({ error: "Lesion not found" });
    return res.json({ lesion });
  } catch (err) {
    req.log.error({ err }, "lesions: update failed");
    return res.status(500).json({ error: "Failed to update lesion" });
  }
});

// ── GET /radiology-lesions/:id/timeline — get timeline for a lesion ──────────

radiologyLesionsRouter.get("/:id/timeline", async (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const entries = await db
      .select()
      .from(radiologyLesionTimelineTable)
      .where(eq(radiologyLesionTimelineTable.lesionId, id))
      .orderBy(asc(radiologyLesionTimelineTable.reportedAt));
    return res.json({ entries });
  } catch (err) {
    req.log.error({ err }, "lesions: timeline fetch failed");
    return res.status(500).json({ error: "Failed to fetch timeline" });
  }
});

// ── POST /radiology-lesions/:id/timeline — add a timeline entry ───────────────

radiologyLesionsRouter.post("/:id/timeline", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const lesionId = Number(req.params.id);
  if (!lesionId || isNaN(lesionId)) return res.status(400).json({ error: "Invalid id" });

  const parsed = addTimelineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data = parsed.data;

  // Verify lesion exists and get patientId
  const [lesion] = await db
    .select()
    .from(radiologyLesionsTable)
    .where(eq(radiologyLesionsTable.id, lesionId));
  if (!lesion) return res.status(404).json({ error: "Lesion not found" });

  try {
    const [entry] = await db
      .insert(radiologyLesionTimelineTable)
      .values({
        lesionId,
        patientId: lesion.patientId,
        studyId: data.studyId,
        orderId: data.orderId,
        measurementMm: data.measurementMm,
        measurementMm2: data.measurementMm2,
        measurementMm3: data.measurementMm3,
        volumeCc: data.volumeCc,
        seriesNumber: data.seriesNumber,
        imageNumber: data.imageNumber,
        sliceLocation: data.sliceLocation,
        changeStatus: data.changeStatus,
        changePercent: data.changePercent,
        signalCharacteristics: data.signalCharacteristics,
        enhancement: data.enhancement,
        reportedBy: sReq.staffSession?.subjectName ?? "Unknown",
        reportedAt: new Date(),
        notes: data.notes,
      })
      .returning();
    // Also update the lesion updatedAt
    await db
      .update(radiologyLesionsTable)
      .set({ updatedAt: new Date() })
      .where(eq(radiologyLesionsTable.id, lesionId));
    return res.status(201).json({ entry });
  } catch (err) {
    req.log.error({ err }, "lesions: add timeline failed");
    return res.status(500).json({ error: "Failed to add timeline entry" });
  }
});

// ── GET /radiology-lesions/measurements — get measurements for patient/study ──

radiologyLesionsRouter.get("/measurements", async (req, res) => {
  const patientId = Number(req.query.patientId);
  const studyId = req.query.studyId ? Number(req.query.studyId) : undefined;
  const modality = req.query.modality as string | undefined;
  const bodyPart = req.query.bodyPart as string | undefined;

  if (!patientId || isNaN(patientId)) {
    return res.status(400).json({ error: "patientId is required" });
  }
  try {
    const conditions = [eq(radiologyMeasurementsTable.patientId, patientId)];
    if (studyId) conditions.push(eq(radiologyMeasurementsTable.studyId, studyId));
    if (modality) conditions.push(eq(radiologyMeasurementsTable.modality, modality));
    if (bodyPart) conditions.push(eq(radiologyMeasurementsTable.bodyPart, bodyPart));

    const measurements = await db
      .select()
      .from(radiologyMeasurementsTable)
      .where(and(...conditions))
      .orderBy(desc(radiologyMeasurementsTable.createdAt));
    return res.json({ measurements });
  } catch (err) {
    req.log.error({ err }, "lesions: measurements fetch failed");
    return res.status(500).json({ error: "Failed to fetch measurements" });
  }
});

// ── POST /radiology-lesions/measurements — save structured measurements ───────

radiologyLesionsRouter.post("/measurements", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const parsed = saveMeasurementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const rows = data.measurements.map((m) => ({
      patientId: data.patientId,
      studyId: data.studyId,
      orderId: data.orderId,
      modality: data.modality,
      bodyPart: data.bodyPart,
      measurementType: m.measurementType,
      label: m.label,
      // Canonical registry identity: trust an id the client resolved, else
      // resolve the label server-side; unknown labels stay NULL (legacy path).
      measurementId: (m.measurementId && getMeasurement(m.measurementId) ? m.measurementId : resolveMeasurement(m.label)?.definition.id) ?? null,
      value: m.value,
      unit: m.unit,
      normalRangeLow: m.normalRangeLow,
      normalRangeHigh: m.normalRangeHigh,
      isAbnormal: m.isAbnormal ?? false,
      notes: m.notes,
      reportedBy: sReq.staffSession?.subjectName ?? "Unknown",
      reportedAt: new Date(),
    }));
    const inserted = await db
      .insert(radiologyMeasurementsTable)
      .values(rows)
      .returning();
    return res.status(201).json({ measurements: inserted, count: inserted.length });
  } catch (err) {
    req.log.error({ err }, "lesions: save measurements failed");
    return res.status(500).json({ error: "Failed to save measurements" });
  }
});

// ── GET /radiology-lesions/measurement-templates — structured templates ───────
// Returns guided measurement fields for a given modality + body part.

const MEASUREMENT_TEMPLATES: Record<string, Array<{
  label: string; measurementType: string; unit: string;
  normalRangeLow?: number; normalRangeHigh?: number; notes?: string;
}>> = {
  "MRI_BRAIN": [
    { label: "Cerebral Ventricle Width (3rd)", measurementType: "linear", unit: "mm", normalRangeLow: 0, normalRangeHigh: 7 },
    { label: "Corpus Callosum Length", measurementType: "linear", unit: "mm", normalRangeLow: 50, normalRangeHigh: 80 },
    { label: "Midbrain AP Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 15, normalRangeHigh: 20 },
    { label: "Pons AP Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 20, normalRangeHigh: 30 },
    { label: "Lesion Size (max diameter)", measurementType: "linear", unit: "mm" },
    { label: "Midline Shift", measurementType: "linear", unit: "mm", normalRangeLow: 0, normalRangeHigh: 2 },
    { label: "Cerebellar Tonsil Descent", measurementType: "linear", unit: "mm", normalRangeLow: 0, normalRangeHigh: 5 },
  ],
  "MRI_SPINE": [
    { label: "Canal AP Diameter (narrowest)", measurementType: "linear", unit: "mm", normalRangeLow: 12 },
    { label: "Disc Protrusion Depth", measurementType: "linear", unit: "mm" },
    { label: "Foraminal Height (left)", measurementType: "linear", unit: "mm" },
    { label: "Foraminal Height (right)", measurementType: "linear", unit: "mm" },
    { label: "Cord Signal Extent", measurementType: "linear", unit: "mm" },
    { label: "Vertebral Body Height (anterior)", measurementType: "linear", unit: "mm" },
    { label: "Vertebral Body Height (posterior)", measurementType: "linear", unit: "mm" },
  ],
  "USG_BREAST": [
    { label: "Lesion AP diameter", measurementType: "linear", unit: "mm" },
    { label: "Lesion Trans diameter", measurementType: "linear", unit: "mm" },
    { label: "Lesion CC diameter", measurementType: "linear", unit: "mm" },
    { label: "Volume", measurementType: "volume", unit: "cc" },
    { label: "Distance from nipple", measurementType: "linear", unit: "mm" },
    { label: "Clock position", measurementType: "position", unit: "o'clock" },
    { label: "BI-RADS Category", measurementType: "classification", unit: "" },
  ],
  "USG_THYROID": [
    { label: "Right Lobe — Length", measurementType: "linear", unit: "mm", normalRangeLow: 40, normalRangeHigh: 60 },
    { label: "Right Lobe — AP", measurementType: "linear", unit: "mm", normalRangeLow: 12, normalRangeHigh: 20 },
    { label: "Right Lobe — Width", measurementType: "linear", unit: "mm", normalRangeLow: 15, normalRangeHigh: 25 },
    { label: "Left Lobe — Length", measurementType: "linear", unit: "mm", normalRangeLow: 40, normalRangeHigh: 60 },
    { label: "Left Lobe — AP", measurementType: "linear", unit: "mm", normalRangeLow: 12, normalRangeHigh: 20 },
    { label: "Left Lobe — Width", measurementType: "linear", unit: "mm", normalRangeLow: 15, normalRangeHigh: 25 },
    { label: "Isthmus Thickness", measurementType: "linear", unit: "mm", normalRangeLow: 2, normalRangeHigh: 6 },
    { label: "Nodule Size (max)", measurementType: "linear", unit: "mm" },
    { label: "TI-RADS Category", measurementType: "classification", unit: "" },
  ],
  "USG_LIVER": [
    { label: "Liver Span (MCL)", measurementType: "linear", unit: "cm", normalRangeLow: 10, normalRangeHigh: 17 },
    { label: "Portal Vein Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 5, normalRangeHigh: 13 },
    { label: "Common Bile Duct Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 1, normalRangeHigh: 7 },
    { label: "Lesion Size (max)", measurementType: "linear", unit: "mm" },
    { label: "Spleen Span", measurementType: "linear", unit: "cm", normalRangeLow: 6, normalRangeHigh: 13 },
  ],
  "USG_KIDNEY": [
    { label: "Right Kidney — Length", measurementType: "linear", unit: "cm", normalRangeLow: 9, normalRangeHigh: 12 },
    { label: "Right Kidney — Width", measurementType: "linear", unit: "cm", normalRangeLow: 4, normalRangeHigh: 6 },
    { label: "Right Cortical Thickness", measurementType: "linear", unit: "mm", normalRangeLow: 10, normalRangeHigh: 20 },
    { label: "Left Kidney — Length", measurementType: "linear", unit: "cm", normalRangeLow: 9, normalRangeHigh: 12 },
    { label: "Left Kidney — Width", measurementType: "linear", unit: "cm", normalRangeLow: 4, normalRangeHigh: 6 },
    { label: "Left Cortical Thickness", measurementType: "linear", unit: "mm", normalRangeLow: 10, normalRangeHigh: 20 },
    { label: "Stone Size (if present)", measurementType: "linear", unit: "mm" },
    { label: "Hydronephrosis Grade", measurementType: "classification", unit: "" },
  ],
  "CT_LUNG": [
    { label: "Nodule Size (max)", measurementType: "linear", unit: "mm" },
    { label: "Nodule Density (HU)", measurementType: "density", unit: "HU" },
    { label: "Pleural Effusion Depth", measurementType: "linear", unit: "mm" },
    { label: "Tracheal Diameter", measurementType: "linear", unit: "mm", normalRangeLow: 13, normalRangeHigh: 25 },
    { label: "Lung-RADS Category", measurementType: "classification", unit: "" },
  ],
  "USG_PELVIS": [
    { label: "Uterine Length", measurementType: "linear", unit: "cm", normalRangeLow: 6, normalRangeHigh: 9 },
    { label: "Uterine AP", measurementType: "linear", unit: "cm", normalRangeLow: 3, normalRangeHigh: 5 },
    { label: "Uterine Width", measurementType: "linear", unit: "cm", normalRangeLow: 4, normalRangeHigh: 6 },
    { label: "Endometrial Thickness", measurementType: "linear", unit: "mm", normalRangeLow: 4, normalRangeHigh: 14 },
    { label: "Right Ovary Volume", measurementType: "volume", unit: "cc", normalRangeLow: 2, normalRangeHigh: 10 },
    { label: "Left Ovary Volume", measurementType: "volume", unit: "cc", normalRangeLow: 2, normalRangeHigh: 10 },
    { label: "Fibroid Size (max)", measurementType: "linear", unit: "mm" },
    { label: "Ovarian Cyst Size (max)", measurementType: "linear", unit: "mm" },
  ],
};

radiologyLesionsRouter.get("/measurement-templates", async (req, res) => {
  const modality = (req.query.modality as string || "").toUpperCase();
  const bodyPart = (req.query.bodyPart as string || "").toUpperCase();

  // Build a key like "MRI_BRAIN", "USG_THYROID"
  const key = `${modality}_${bodyPart}`;
  const template = MEASUREMENT_TEMPLATES[key];

  if (template) {
    return res.json({ key, template });
  }

  // Partial match fallback
  const fallbackKey = Object.keys(MEASUREMENT_TEMPLATES).find((k) =>
    k.includes(modality) || k.includes(bodyPart)
  );
  if (fallbackKey) {
    return res.json({ key: fallbackKey, template: MEASUREMENT_TEMPLATES[fallbackKey] });
  }

  // Return empty
  return res.json({ key, template: [] });
});

// ── GET /radiology-lesions/viewer-measurements — fetch viewer measurements ──
radiologyLesionsRouter.get("/viewer-measurements", async (req, res) => {
  const studyInstanceUID = req.query.studyInstanceUID as string;
  const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;

  try {
    const conditions = [];
    if (studyInstanceUID) {
      conditions.push(eq(viewerMeasurementsTable.studyInstanceUID, studyInstanceUID));
    }
    if (patientId && !isNaN(patientId)) {
      conditions.push(eq(viewerMeasurementsTable.patientId, patientId));
    }

    if (conditions.length === 0) {
      return res.status(400).json({ error: "studyInstanceUID or patientId is required" });
    }

    const measurements = await db
      .select()
      .from(viewerMeasurementsTable)
      .where(and(...conditions))
      .orderBy(desc(viewerMeasurementsTable.createdAt));

    return res.json({ measurements });
  } catch (err) {
    req.log.error({ err }, "viewer-measurements: fetch failed");
    return res.status(500).json({ error: "Failed to fetch viewer measurements" });
  }
});

const createViewerMeasurementSchema = z.object({
  patientId: z.number().int(),
  studyId: z.number().int().optional(),
  orderId: z.number().int().optional(),
  studyInstanceUID: z.string(),
  seriesInstanceUID: z.string().optional(),
  sopInstanceUID: z.string().optional(),
  frameNumber: z.number().int().optional(),
  viewerName: z.string(),
  measurementType: z.string(),
  measurementId: z.string().max(80).optional(),
  value: z.string(),
  unit: z.string(),
  sliceNumber: z.number().int().optional(),
  imageCoordinates: z.string().optional(),
  confidence: z.number().optional(),
  status: z.string().optional(),
});

// ── POST /radiology-lesions/viewer-measurements — record/create viewer measurements ──
radiologyLesionsRouter.post("/viewer-measurements", async (req, res) => {
  const body = req.body;
  const isArray = Array.isArray(body);
  const items = isArray ? body : [body];

  function annotationIdFromCoords(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as { annotationId?: unknown };
      const id = typeof o.annotationId === "string" ? o.annotationId.trim() : "";
      return id || null;
    } catch {
      return null;
    }
  }

  try {
    const out = [];
    for (const item of items) {
      const parsed = createViewerMeasurementSchema.safeParse(item);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input data", details: parsed.error.flatten() });
      }
      const data = parsed.data;
      const rowValues = {
        patientId: data.patientId,
        studyId: data.studyId || null,
        orderId: data.orderId || null,
        studyInstanceUID: data.studyInstanceUID,
        seriesInstanceUID: data.seriesInstanceUID || null,
        sopInstanceUID: data.sopInstanceUID || null,
        frameNumber: data.frameNumber ?? 1,
        viewerName: data.viewerName,
        measurementType: data.measurementType,
        measurementId: data.measurementId && getMeasurement(data.measurementId) ? data.measurementId : null,
        value: data.value,
        unit: data.unit,
        sliceNumber: data.sliceNumber || null,
        imageCoordinates: data.imageCoordinates || null,
        confidence: data.confidence != null ? data.confidence : 1.0,
        status: data.status || "pending",
        updatedAt: new Date(),
      };

      // Idempotent upsert when OHIF/CARE annotationId is present in imageCoordinates.
      const ann = annotationIdFromCoords(data.imageCoordinates);
      if (ann) {
        const candidates = await db
          .select()
          .from(viewerMeasurementsTable)
          .where(eq(viewerMeasurementsTable.studyInstanceUID, data.studyInstanceUID))
          .orderBy(desc(viewerMeasurementsTable.id))
          .limit(80);
        const hit = candidates.find((c) => annotationIdFromCoords(c.imageCoordinates) === ann);
        if (hit) {
          // Harden: deleted annotations are PATCHed to status=ignored. A stale
          // OHIF re-post must not rehydrate them on refetch.
          if (hit.status === "ignored") {
            out.push(hit);
            continue;
          }
          const [updated] = await db
            .update(viewerMeasurementsTable)
            .set(rowValues)
            .where(eq(viewerMeasurementsTable.id, hit.id))
            .returning();
          out.push(updated);
          continue;
        }
      }

      const [inserted] = await db
        .insert(viewerMeasurementsTable)
        .values(rowValues)
        .returning();
      out.push(inserted);
    }

    return res.status(201).json({ measurements: out, count: out.length });
  } catch (err) {
    req.log.error({ err }, "viewer-measurements: save failed");
    return res.status(500).json({ error: "Failed to save viewer measurements" });
  }
});

// ── PATCH /radiology-lesions/viewer-measurements/:id — update state ──
radiologyLesionsRouter.patch("/viewer-measurements/:id", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const id = Number(req.params.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const allowed = ["status", "value", "unit", "confidence"];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (req.body.status === "imported") {
    updates.importedBy = sReq.staffSession?.subjectName ?? "Unknown";
    updates.importTime = new Date();
  }

  updates.updatedAt = new Date();

  try {
    const [updated] = await db
      .update(viewerMeasurementsTable)
      .set(updates)
      .where(eq(viewerMeasurementsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Measurement not found" });
    return res.json({ measurement: updated });
  } catch (err) {
    req.log.error({ err }, "viewer-measurements: update failed");
    return res.status(500).json({ error: "Failed to update viewer measurement" });
  }
});

// ── POST /radiology-lesions/viewer-measurements/import-all — bulk import ──
radiologyLesionsRouter.post("/viewer-measurements/import-all", async (req, res) => {
  const sReq = req as StaffAuthRequest;
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }

  try {
    // Drizzle update for multiple IDs
    const updated = await db
      .update(viewerMeasurementsTable)
      .set({
        status: "imported",
        importedBy: sReq.staffSession?.subjectName ?? "Unknown",
        importTime: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(viewerMeasurementsTable.id, ids))
      .returning();

    return res.json({ measurements: updated, count: updated.length });
  } catch (err) {
    req.log.error({ err }, "viewer-measurements: bulk import failed");
    return res.status(500).json({ error: "Failed to bulk import viewer measurements" });
  }
});

