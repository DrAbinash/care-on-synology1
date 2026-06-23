/**
 * Phase 8 + 10A: Radiology Copilot — Prior Study Auto-Fetch, Measurement Tracker,
 * Smart Impression Builder, Consistency Checker, Follow-up Intelligence,
 * DICOM Metadata Assistant, Productivity Dashboard.
 * Phase 10A additions: Structured Prior Comparison, Smart Change Detector.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyStudiesTable,
  patientReportsTable,
  testsTable,
  radiologyDicomMeasurementsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, lte, ilike, or, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologyCopilotRouter = Router();

// —— Helper: fetch completed studies for a patient with optional filters ——
async function fetchPriorStudies(opts: {
  patientId: number;
  currentStudyId?: number;
  modality?: string;
  bodyPart?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  const { patientId, currentStudyId, modality, bodyPart, dateFrom, dateTo, limit = 20 } = opts;

  const conditions: ReturnType<typeof eq>[] = [
    eq(radiologyStudiesTable.patientId, patientId),
  ];
  const statusOr = or(
    eq(radiologyStudiesTable.status, "reported_final"),
    eq(radiologyStudiesTable.status, "reported_preliminary"),
    eq(radiologyStudiesTable.status, "delivered"),
  );
  if (statusOr) conditions.push(statusOr as ReturnType<typeof eq>);

  if (currentStudyId) conditions.push(sql`${radiologyStudiesTable.id} != ${currentStudyId}`);
  if (modality) conditions.push(ilike(radiologyStudiesTable.modality, `%${modality}%`));
  if (bodyPart) conditions.push(ilike(radiologyStudiesTable.bodyPart, `%${bodyPart}%`));
  if (dateFrom) conditions.push(gte(radiologyStudiesTable.studyDate, dateFrom));
  if (dateTo) conditions.push(lte(radiologyStudiesTable.studyDate, dateTo));

  const rows = await db
    .select()
    .from(radiologyStudiesTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyStudiesTable.studyDate))
    .limit(limit);

  const studies = await Promise.all(
    rows.map(async (study) => {
      const [report] = study.orderId
        ? await db
            .select()
            .from(patientReportsTable)
            .where(eq(patientReportsTable.orderId, study.orderId))
            .orderBy(desc(patientReportsTable.createdAt))
            .limit(1)
        : [null];

      const [test] = study.testId
        ? await db.select().from(testsTable).where(eq(testsTable.id, study.testId)).limit(1)
        : [null];

      return {
        ...study,
        testName: test?.name ?? study.studyDescription ?? "Unknown Study",
        testCode: test?.code ?? null,
        finalReport: report?.body ?? null,
        impression: report?.impression ?? null,
        findings: report?.body ?? null,
        reportedBy: report?.signedByName ?? report?.createdBy ?? null,
        reportedAt: report?.signedAt ?? report?.createdAt ?? null,
      };
    }),
  );

  return studies;
}

// —— GET /prior-studies — search prior studies for a patient ——
radiologyCopilotRouter.get("/prior-studies", async (req, res): Promise<void> => {
  const patientId = Number(req.query.patientId);
  const currentStudyId = req.query.currentStudyId ? Number(req.query.currentStudyId) : undefined;
  const modality = req.query.modality as string | undefined;
  const bodyPart = req.query.bodyPart as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  if (!patientId || isNaN(patientId)) {
    res.status(400).json({ error: "patientId is required" });
    return;
  }

  try {
    const studies = await fetchPriorStudies({
      patientId,
      currentStudyId,
      modality,
      bodyPart,
      dateFrom,
      dateTo,
      limit,
    });

    res.json({
      studies,
      total: studies.length,
      patientId,
    });
  } catch (e) {
    console.error("Prior studies fetch error:", e);
    res.status(500).json({ error: "Failed to fetch prior studies" });
  }
});

// —— GET /prior-studies/:id/compare — fetch single study with comparison data ——
radiologyCopilotRouter.get("/prior-studies/:id/compare", async (req, res): Promise<void> => {
  const studyId = Number(req.params.id);
  if (isNaN(studyId)) {
    res.status(400).json({ error: "Invalid study id" });
    return;
  }

  const [study] = await db.select().from(radiologyStudiesTable).where(eq(radiologyStudiesTable.id, studyId)).limit(1);
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  const related = await fetchPriorStudies({
    patientId: study.patientId,
    currentStudyId: studyId,
    modality: study.modality ?? undefined,
    bodyPart: study.bodyPart ?? undefined,
    limit: 10,
  });

  res.json({
    current: study,
    priorStudies: related,
    total: related.length,
  });
});

// —— GET /measurements/:studyId — measurement history for a study ——
radiologyCopilotRouter.get("/measurements/:studyId", async (req, res): Promise<void> => {
  const studyId = Number(req.params.studyId);
  if (isNaN(studyId)) {
    res.status(400).json({ error: "Invalid study id" });
    return;
  }

  const type = req.query.type as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  const conditions = [eq(radiologyDicomMeasurementsTable.studyId, studyId)];
  if (type) conditions.push(eq(radiologyDicomMeasurementsTable.measurementType, type));

  const rows = await db
    .select()
    .from(radiologyDicomMeasurementsTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyDicomMeasurementsTable.createdAt))
    .limit(limit);

  res.json({ measurements: rows, total: rows.length });
});

// —— POST /measurements — record a measurement ——
radiologyCopilotRouter.post("/measurements", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const {
    studyId,
    measurementType,
    value,
    unit,
    referenceRange,
    dicomTag,
    notes,
  } = req.body as Record<string, unknown>;

  if (!studyId || !measurementType || value === undefined) {
    res.status(400).json({ error: "studyId, measurementType, and value are required" });
    return;
  }

  const [row] = await db
    .insert(radiologyDicomMeasurementsTable)
    .values({
      studyId: Number(studyId),
      measurementType: String(measurementType),
      value: String(value),
      unit: unit ? String(unit) : null,
      referenceRange: referenceRange ? String(referenceRange) : null,
      dicomTag: dicomTag ? String(dicomTag) : null,
      notes: notes ? String(notes) : null,
    })
    .returning();

  res.status(201).json({ measurement: row });
});

// —— POST /impression-suggest — suggest impression from findings text ——
radiologyCopilotRouter.post("/impression-suggest", async (req, res): Promise<void> => {
  const { findings } = req.body as Record<string, string>;

  if (!findings) {
    res.status(400).json({ error: "findings text is required" });
    return;
  }

  const lines = findings.toLowerCase().split(/[.\n]+/).map((l) => l.trim()).filter(Boolean);
  const impressions: string[] = [];

  const keywords: Record<string, string[]> = {
    normal: ["normal", "no abnormality", "unremarkable", "within normal limits", "no significant"],
    benign: ["benign", "hemangioma", "cyst", "simple cyst", "fatty liver", "calcification"],
    malignant: ["malignant", "mass", "tumor", "lesion", "suspicious", "irregular", "invasive"],
    inflammatory: ["inflammatory", "infection", "abscess", "collection", "fluid"],
    vascular: ["vascular", "thrombosis", "stenosis", "occlusion", "aneurysm"],
  };

  for (const [category, words] of Object.entries(keywords)) {
    if (words.some((w) => lines.some((l) => l.includes(w)))) {
      switch (category) {
        case "normal":
          impressions.push("No significant abnormality detected.");
          break;
        case "benign":
          impressions.push("Findings are suggestive of benign etiology.");
          break;
        case "malignant":
          impressions.push("Suspicious findings requiring further evaluation and correlation.");
          break;
        case "inflammatory":
          impressions.push("Findings are consistent with an inflammatory/infective process.");
          break;
        case "vascular":
          impressions.push("Vascular abnormality identified.");
          break;
      }
    }
  }

  if (impressions.length === 0) {
    impressions.push("Impression: Correlation with clinical findings and further investigations if warranted.");
  }

  res.json({
    impression: impressions.join(" "),
    confidence: "low",
    requiresReview: true,
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// —— POST /consistency-check — validate findings vs impression ——
radiologyCopilotRouter.post("/consistency-check", async (req, res): Promise<void> => {
  const { findings, impression } = req.body as Record<string, string>;

  if (!findings || !impression) {
    res.status(400).json({ error: "findings and impression are required" });
    return;
  }

  const issues: Array<{ type: string; message: string; severity: "warning" | "error" | "info" }> = [];
  const fLower = findings.toLowerCase();
  const iLower = impression.toLowerCase();

  const normalKeywords = ["normal", "no abnormality", "unremarkable", "within normal limits"];
  const abnormalKeywords = ["mass", "tumor", "malignant", "suspicious", "abnormal", "pathology"];

  const isNormalFindings = normalKeywords.some((k) => fLower.includes(k));
  const isAbnormalImpression = abnormalKeywords.some((k) => iLower.includes(k));

  if (isNormalFindings && isAbnormalImpression) {
    issues.push({
      type: "mismatch",
      message: "Findings suggest normal study but impression indicates abnormality. Please review.",
      severity: "error",
    });
  }

  const isAbnormalFindings = abnormalKeywords.some((k) => fLower.includes(k));
  const isNormalImpression = normalKeywords.some((k) => iLower.includes(k));

  if (isAbnormalFindings && isNormalImpression) {
    issues.push({
      type: "mismatch",
      message: "Abnormal findings detected but impression states normal. Please review.",
      severity: "error",
    });
  }

  const leftFindings = /\bleft\b|\blt\b/.test(fLower);
  const rightFindings = /\bright\b|\brt\b/.test(fLower);
  const leftImpression = /\bleft\b|\blt\b/.test(iLower);
  const rightImpression = /\bright\b|\brt\b/.test(iLower);

  if (leftFindings && rightImpression && !leftImpression) {
    issues.push({
      type: "side_mismatch",
      message: "Findings mention LEFT side but impression mentions RIGHT side.",
      severity: "error",
    });
  }
  if (rightFindings && leftImpression && !rightImpression) {
    issues.push({
      type: "side_mismatch",
      message: "Findings mention RIGHT side but impression mentions LEFT side.",
      severity: "error",
    });
  }

  const regionKeywords = ["liver", "kidney", "spleen", "pancreas", "gallbladder", "brain", "lung", "heart"];
  for (const region of regionKeywords) {
    if (fLower.includes(region) && !iLower.includes(region)) {
      issues.push({
        type: "region_mismatch",
        message: `Findings mention ${region} but impression does not reference it.`,
        severity: "warning",
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      type: "ok",
      message: "Findings and impression are consistent.",
      severity: "info",
    });
  }

  res.json({
    issues,
    isConsistent: issues.every((i) => i.severity !== "error"),
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// —— POST /follow-up-suggest — guideline-based follow-up suggestions ——
radiologyCopilotRouter.post("/follow-up-suggest", async (req, res): Promise<void> => {
  const { impression, classification, classificationValue } = req.body as Record<string, string>;

  const suggestions: Array<{
    category: string;
    recommendation: string;
    urgency: "routine" | "urgent" | "immediate";
    timeframe: string;
    source: string;
  }> = [];

  if (classification === "BI-RADS" && classificationValue) {
    const val = classificationValue.trim();
    if (val === "0") suggestions.push({ category: "BI-RADS", recommendation: "Need additional imaging evaluation", urgency: "routine", timeframe: "Within 1-2 weeks", source: "ACR BI-RADS 5th Edition" });
    if (val === "1") suggestions.push({ category: "BI-RADS", recommendation: "Routine screening", urgency: "routine", timeframe: "Annual screening", source: "ACR BI-RADS 5th Edition" });
    if (val === "2") suggestions.push({ category: "BI-RADS", recommendation: "Routine screening", urgency: "routine", timeframe: "Annual screening", source: "ACR BI-RADS 5th Edition" });
    if (val === "3") suggestions.push({ category: "BI-RADS", recommendation: "Short interval follow-up", urgency: "routine", timeframe: "6 months", source: "ACR BI-RADS 5th Edition" });
    if (val === "4") suggestions.push({ category: "BI-RADS", recommendation: "Tissue diagnosis recommended", urgency: "urgent", timeframe: "Within 2-4 weeks", source: "ACR BI-RADS 5th Edition" });
    if (val === "5") suggestions.push({ category: "BI-RADS", recommendation: "Tissue diagnosis required", urgency: "immediate", timeframe: "Within 1-2 weeks", source: "ACR BI-RADS 5th Edition" });
    if (val === "6") suggestions.push({ category: "BI-RADS", recommendation: "Known biopsy-proven malignancy — continue management", urgency: "urgent", timeframe: "As per oncology plan", source: "ACR BI-RADS 5th Edition" });
  }

  if (classification === "TI-RADS" && classificationValue) {
    const val = classificationValue.trim();
    if (val === "1" || val === "2") suggestions.push({ category: "TI-RADS", recommendation: "No FNA needed", urgency: "routine", timeframe: "No follow-up required", source: "ACR TI-RADS" });
    if (val === "3") suggestions.push({ category: "TI-RADS", recommendation: "No FNA needed, follow-up at 1y 3y 5y", urgency: "routine", timeframe: "1 year follow-up", source: "ACR TI-RADS" });
    if (val === "4") suggestions.push({ category: "TI-RADS", recommendation: "FNA if ≥1.5cm, follow-up if ≥1.0cm", urgency: "urgent", timeframe: "Within 4-6 weeks", source: "ACR TI-RADS" });
    if (val === "5") suggestions.push({ category: "TI-RADS", recommendation: "FNA if ≥1.0cm, follow-up if ≥0.5cm", urgency: "urgent", timeframe: "Within 2-4 weeks", source: "ACR TI-RADS" });
  }

  const iLower = (impression ?? "").toLowerCase();
  if (iLower.includes("suspicious") || iLower.includes("malignant") || iLower.includes("mass")) {
    if (!suggestions.some((s) => s.category === "General")) {
      suggestions.push({
        category: "General",
        recommendation: "Correlation with clinical findings and further imaging or biopsy as indicated.",
        urgency: "urgent",
        timeframe: "Within 2-4 weeks",
        source: "Radiology best practice",
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      category: "General",
      recommendation: "Routine follow-up as clinically indicated.",
      urgency: "routine",
      timeframe: "As per referring physician",
      source: "Standard care",
    });
  }

  res.json({
    suggestions,
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// —— GET /dicom-metadata/:studyId — DICOM metadata assistant ——
radiologyCopilotRouter.get("/dicom-metadata/:studyId", async (req, res): Promise<void> => {
  const studyId = Number(req.params.studyId);
  if (isNaN(studyId)) {
    res.status(400).json({ error: "Invalid study id" });
    return;
  }

  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);

  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  res.json({
    modality: study.modality,
    bodyPart: study.bodyPart,
    studyDescription: study.studyDescription,
    accessionNumber: study.accessionNumber,
    studyInstanceUid: study.studyInstanceUid,
    scheduledStationAETitle: study.scheduledStationAETitle,
    referringDoctor: study.referringDoctor,
    numImages: study.numImages,
    technique: buildTechniqueFromMetadata(study),
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

function buildTechniqueFromMetadata(study: typeof radiologyStudiesTable.$inferSelect): string {
  const parts: string[] = [];
  if (study.modality) parts.push(`Modality: ${study.modality}`);
  if (study.bodyPart) parts.push(`Body part: ${study.bodyPart}`);
  if (study.studyDescription) parts.push(`Study: ${study.studyDescription}`);
  if (study.numImages && study.numImages > 0) parts.push(`Images: ${study.numImages}`);
  if (study.scheduledStationAETitle) parts.push(`Station: ${study.scheduledStationAETitle}`);

  if (parts.length === 0) return "Technique: Standard protocol as per institutional guidelines.";
  return `Technique: ${parts.join(". ")}.`;
}

// —— GET /productivity — per-doctor radiology productivity dashboard ——
radiologyCopilotRouter.get("/productivity", async (req, res): Promise<void> => {
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [
    eq(radiologyStudiesTable.status, "reported_final"),
  ];
  if (dateFrom) conditions.push(gte(radiologyStudiesTable.studyDate, dateFrom));
  if (dateTo) conditions.push(lte(radiologyStudiesTable.studyDate, dateTo));

  const rows = await db
    .select()
    .from(radiologyStudiesTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyStudiesTable.studyDate));

  const byRadiologist = new Map<string, { count: number; avgImages: number; modalities: Set<string>; bodyParts: Set<string> }>();
  const byModality = new Map<string, number>();
  const byBodyPart = new Map<string, number>();
  const dailyCounts = new Map<string, number>();

  for (const row of rows) {
    const reporter = row.finalReportedBy ?? "Unknown";
    if (!byRadiologist.has(reporter)) {
      byRadiologist.set(reporter, { count: 0, avgImages: 0, modalities: new Set(), bodyParts: new Set() });
    }
    const stats = byRadiologist.get(reporter)!;
    stats.count += 1;
    stats.avgImages += row.numImages;
    if (row.modality) stats.modalities.add(row.modality);
    if (row.bodyPart) stats.bodyParts.add(row.bodyPart);

    if (row.modality) byModality.set(row.modality, (byModality.get(row.modality) ?? 0) + 1);
    if (row.bodyPart) byBodyPart.set(row.bodyPart, (byBodyPart.get(row.bodyPart) ?? 0) + 1);

    const day = row.studyDate ? new Date(row.studyDate).toISOString().slice(0, 10) : "unknown";
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }

  for (const [, stats] of byRadiologist) {
    stats.avgImages = stats.count > 0 ? Math.round(stats.avgImages / stats.count) : 0;
  }

  res.json({
    totalReports: rows.length,
    byRadiologist: Array.from(byRadiologist.entries()).map(([name, stats]) => ({
      name,
      count: stats.count,
      avgImages: stats.avgImages,
      modalities: Array.from(stats.modalities),
      bodyParts: Array.from(stats.bodyParts),
    })),
    byModality: Array.from(byModality.entries()).map(([name, count]) => ({ name, count })),
    byBodyPart: Array.from(byBodyPart.entries()).map(([name, count]) => ({ name, count })),
    dailyCounts: Array.from(dailyCounts.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 10A: Structured Prior Study Comparison
// POST /radiology-copilot/structured-comparison
// Accepts currentFindings + priorFindings and returns structured diff
// with per-parameter status: improved / stable / progressed / new / resolved
// ══════════════════════════════════════════════════════════════════════════════

// Helper: resolve report text from patientReports by studyId
async function resolveReportText(studyId: number): Promise<{ text: string; meta: { accessionNumber: string; studyDate: string | null; modality: string } | null }> {
  const [study] = await db
    .select({ accessionNumber: radiologyStudiesTable.accessionNumber, studyDate: radiologyStudiesTable.studyDate, modality: radiologyStudiesTable.modality })
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);
  if (!study) return { text: "", meta: null };

  const [report] = await db
    .select({ body: patientReportsTable.body, impression: patientReportsTable.impression })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.studyId, studyId))
    .orderBy(desc(patientReportsTable.createdAt))
    .limit(1);

  let text = "";
  if (report) {
    try {
      const parsed = JSON.parse(report.body ?? "");
      if (Array.isArray(parsed)) {
        text = parsed.map((f: { remarks?: string }) => f.remarks ?? "").filter(Boolean).join("\n");
      } else if (typeof parsed === "object" && parsed !== null) {
        text = Object.values(parsed as Record<string, unknown>).join("\n");
      }
    } catch {
      text = report.body ?? "";
    }
    if (!text && report.impression) text = report.impression;
  }
  return { text, meta: study };
}

radiologyCopilotRouter.post("/structured-comparison", async (req, res) => {
  const {
    currentFindings: currentFindingsRaw,
    priorFindings: priorFindingsRaw,
    currentStudyId,
    priorStudyId,
    modality,
    bodyPart,
  } = req.body as {
    currentFindings?: string;
    priorFindings?: string;
    currentStudyId?: number;
    priorStudyId?: number;
    modality?: string;
    bodyPart?: string;
  };

  // Resolve current findings — from text or DB
  let currentFindings = currentFindingsRaw ?? "";
  let resolvedCurrentStudy: { accessionNumber: string; studyDate: string | null; modality: string } | null = null;
  if (!currentFindings.trim() && currentStudyId) {
    const { text, meta } = await resolveReportText(currentStudyId);
    currentFindings = text;
    resolvedCurrentStudy = meta;
  }

  // Resolve prior findings — from text or DB
  let priorFindings = priorFindingsRaw ?? "";
  let resolvedPriorStudy: { accessionNumber: string; studyDate: string | null; modality: string } | null = null;
  if (!priorFindings.trim() && priorStudyId) {
    const { text, meta } = await resolveReportText(priorStudyId);
    priorFindings = text;
    resolvedPriorStudy = meta;
  }

  if (!currentFindings.trim()) {
    return res.status(400).json({ error: "currentFindings is required (or supply currentStudyId with an existing report)" });
  }
  if (!priorFindings.trim()) {
    return res.status(400).json({ error: "priorFindings is required (or supply priorStudyId with an existing report)" });
  }

  // Deterministic structural comparison — no AI required
  // Extract key clinical parameters via pattern matching
  const PARAMETER_PATTERNS: Array<{
    name: string;
    patterns: RegExp[];
    extractValue: (text: string, patterns: RegExp[]) => string | null;
  }> = [
    {
      name: "Lesion Size",
      patterns: [/(\d+\.?\d*)\s*(?:x\s*\d+\.?\d*)?\s*(?:mm|cm)/gi],
      extractValue: (text, patterns) => {
        const m = patterns[0].exec(text);
        return m ? m[0] : null;
      },
    },
    {
      name: "Midline Shift",
      patterns: [/midline\s+shift[^\.\n]*/gi, /midline[^\.\n]*shift/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
    {
      name: "Mass Effect",
      patterns: [/mass\s+effect[^\.\n]*/gi],
      extractValue: (text, patterns) => { const m = patterns[0].exec(text); return m ? m[0] : null; },
    },
    {
      name: "Edema",
      patterns: [/(?:peri-?lesional|perilesional|surrounding|vasogenic)?\s*edema[^\.\n]*/gi, /oedema[^\.\n]*/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
    {
      name: "Enhancement",
      patterns: [/(?:contrast\s+)?(?:rim|ring|nodular|heterogeneous|homogeneous|post-contrast|post\s+contrast)?\s*enhancement[^\.\n]*/gi],
      extractValue: (text, patterns) => { const m = patterns[0].exec(text); return m ? m[0] : null; },
    },
    {
      name: "Hydrocephalus",
      patterns: [/hydrocephalus[^\.\n]*/gi, /ventricular\s+(?:dilation|dilatation|enlargement)[^\.\n]*/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
    {
      name: "Disc Protrusion",
      patterns: [/disc\s+(?:protrusion|herniation|bulge|prolapse)[^\.\n]*/gi, /IVDP[^\.\n]*/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
    {
      name: "Canal Stenosis",
      patterns: [/(?:spinal\s+canal|canal)\s*(?:stenosis|narrowing|compromise)[^\.\n]*/gi],
      extractValue: (text, patterns) => { const m = patterns[0].exec(text); return m ? m[0] : null; },
    },
    {
      name: "Haemorrhage",
      patterns: [/h[ae]morrhage[^\.\n]*/gi, /bleed(?:ing)?[^\.\n]*/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
    {
      name: "Infarct / Ischemia",
      patterns: [/infarct[^\.\n]*/gi, /isch[ae]m[^\.\n]*/gi],
      extractValue: (text, patterns) => {
        for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
        return null;
      },
    },
  ];

  function categorizeChange(prior: string | null, current: string | null, paramName: string): {
    status: "improved" | "stable" | "progressed" | "new" | "resolved" | "unchanged";
    confidence: "high" | "medium" | "low";
    detail: string;
  } {
    if (!prior && !current) return { status: "unchanged", confidence: "high", detail: "Not mentioned in either study" };
    if (!prior && current) return { status: "new", confidence: "high", detail: `Newly identified: ${current.trim().substring(0, 100)}` };
    if (prior && !current) return { status: "resolved", confidence: "medium", detail: `Previously: ${prior.trim().substring(0, 100)} — not mentioned in current study` };

    // Both present — try to determine progression
    const priorText = prior!.toLowerCase();
    const currentText = current!.toLowerCase();

    // Extract numbers from both
    const extractMm = (text: string): number | null => {
      const m = /(\d+\.?\d*)\s*mm/.exec(text);
      return m ? parseFloat(m[1]) : null;
    };
    const priorMm = extractMm(priorText);
    const currentMm = extractMm(currentText);

    if (priorMm !== null && currentMm !== null) {
      const pct = ((currentMm - priorMm) / priorMm) * 100;
      if (pct < -10) return { status: "improved", confidence: "high", detail: `Decreased: ${priorMm}mm → ${currentMm}mm (${Math.abs(pct).toFixed(0)}% reduction)` };
      if (pct > 10) return { status: "progressed", confidence: "high", detail: `Increased: ${priorMm}mm → ${currentMm}mm (+${pct.toFixed(0)}%)` };
      return { status: "stable", confidence: "high", detail: `Stable: ${priorMm}mm → ${currentMm}mm` };
    }

    // Keyword-based assessment
    const worsening = ["increased", "enlarged", "worsened", "new", "additional", "progressed", "larger"];
    const improving = ["decreased", "reduced", "smaller", "improved", "resolved", "lesser"];
    const stable = ["unchanged", "stable", "similar", "no change", "no significant"];

    const hasWorsening = worsening.some((w) => currentText.includes(w));
    const hasImproving = improving.some((w) => currentText.includes(w));
    const hasStable = stable.some((w) => currentText.includes(w));

    if (hasImproving) return { status: "improved", confidence: "medium", detail: `${current!.trim().substring(0, 120)}` };
    if (hasWorsening) return { status: "progressed", confidence: "medium", detail: `${current!.trim().substring(0, 120)}` };
    if (hasStable) return { status: "stable", confidence: "high", detail: `${current!.trim().substring(0, 120)}` };

    return { status: "stable", confidence: "low", detail: `Prior: ${prior!.trim().substring(0, 60)} / Current: ${current!.trim().substring(0, 60)}` };
  }

  const comparison = PARAMETER_PATTERNS.map(({ name, patterns, extractValue }) => {
    // Reset regex lastIndex for each text
    const getVal = (text: string) => {
      patterns.forEach((p) => { p.lastIndex = 0; });
      return extractValue(text, patterns.map((p) => new RegExp(p.source, p.flags)));
    };
    const priorVal = getVal(priorFindings);
    const currentVal = getVal(currentFindings);
    const change = categorizeChange(priorVal, currentVal, name);
    return { parameter: name, priorValue: priorVal, currentValue: currentVal, ...change };
  }).filter((c) => c.status !== "unchanged");

  // Overall summary
  const counts = { improved: 0, stable: 0, progressed: 0, new: 0, resolved: 0 };
  for (const c of comparison) {
    if (c.status in counts) counts[c.status as keyof typeof counts]++;
  }
  const overallTrend = counts.progressed > counts.improved
    ? "progressed"
    : counts.improved > counts.progressed
    ? "improved"
    : "stable";

  return res.json({
    comparison,
    overallTrend,
    counts,
    totalParameters: comparison.length,
    resolvedCurrentStudy: resolvedCurrentStudy ?? null,
    resolvedPriorStudy: resolvedPriorStudy ?? null,
    note: "AI Draft – Requires Radiologist Review. Structural comparison only — not a clinical diagnosis.",
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 10A: Smart Change Detector
// POST /radiology-copilot/change-detector
// Accepts currentFindings + priorFindings and returns categorized changes
// ══════════════════════════════════════════════════════════════════════════════

radiologyCopilotRouter.post("/change-detector", async (req, res) => {
  const { currentFindings, priorFindings, modality } = req.body as {
    currentFindings?: string;
    priorFindings?: string;
    modality?: string;
  };

  if (!currentFindings?.trim() || !priorFindings?.trim()) {
    return res.status(400).json({ error: "currentFindings and priorFindings are required" });
  }

  const current = currentFindings.toLowerCase();
  const prior = priorFindings.toLowerCase();

  type ChangeCategory = "new_lesion" | "growth" | "regression" | "post_op" | "hemorrhage_evolution" | "infarct_evolution" | "edema_change" | "hydrocephalus_change" | "signal_change" | "other";

  interface DetectedChange {
    category: ChangeCategory;
    categoryLabel: string;
    description: string;
    severity: "info" | "warning" | "critical";
    priorSnippet?: string;
    currentSnippet?: string;
  }

  const changes: DetectedChange[] = [];

  // Helper: extract sentences containing keyword
  function extractSentences(text: string, keywords: string[]): string[] {
    const sentences = text.split(/[.;]/);
    return sentences.filter((s) => keywords.some((k) => s.includes(k))).map((s) => s.trim()).filter(Boolean);
  }

  // 1. New lesions
  const newLesionKeywords = ["new lesion", "newly", "new focus", "additional lesion", "not seen previously", "not identified on prior", "new area", "new discrete"];
  const newInCurrent = extractSentences(current, newLesionKeywords);
  if (newInCurrent.length > 0) {
    changes.push({
      category: "new_lesion",
      categoryLabel: "New Lesion",
      description: newInCurrent[0],
      severity: "critical",
      currentSnippet: newInCurrent[0],
    });
  }

  // 2. Growth / progression
  const growthInCurrent = extractSentences(current, ["increased", "enlarged", "larger", "grown", "progressed", "worsened", "extension"]);
  const growthNotInPrior = growthInCurrent.filter((s) => !extractSentences(prior, ["increased", "enlarged"]).some((ps) => ps.includes(s.substring(0, 20))));
  if (growthNotInPrior.length > 0) {
    changes.push({
      category: "growth",
      categoryLabel: "Growth / Progression",
      description: growthNotInPrior[0],
      severity: "warning",
      currentSnippet: growthNotInPrior[0],
    });
  }

  // 3. Regression / improvement
  const regressionInCurrent = extractSentences(current, ["decreased", "reduced", "smaller", "improved", "resolved", "regressed", "less prominent"]);
  if (regressionInCurrent.length > 0) {
    changes.push({
      category: "regression",
      categoryLabel: "Regression / Improvement",
      description: regressionInCurrent[0],
      severity: "info",
      currentSnippet: regressionInCurrent[0],
    });
  }

  // 4. Post-operative changes
  const postOpInCurrent = extractSentences(current, ["post-op", "post op", "post operative", "postoperative", "surgical", "craniotomy", "laminectomy", "operative site"]);
  const postOpNotInPrior = postOpInCurrent.filter((s) => !extractSentences(prior, ["post-op", "post op", "postoperative", "surgical"]).length);
  if (postOpNotInPrior.length > 0) {
    changes.push({
      category: "post_op",
      categoryLabel: "Post-Operative Change",
      description: postOpNotInPrior[0],
      severity: "info",
      currentSnippet: postOpNotInPrior[0],
    });
  }

  // 5. Haemorrhage evolution
  const haemInPrior = extractSentences(prior, ["haemorrhage", "hemorrhage", "haematoma", "hematoma", "bleed"]);
  const haemInCurrent = extractSentences(current, ["haemorrhage", "hemorrhage", "haematoma", "hematoma", "bleed"]);
  if (haemInPrior.length > 0 && haemInCurrent.length > 0) {
    changes.push({
      category: "hemorrhage_evolution",
      categoryLabel: "Haemorrhage Evolution",
      description: "Haemorrhage noted in both studies — assess for evolution (acute → subacute → chronic).",
      severity: "warning",
      priorSnippet: haemInPrior[0],
      currentSnippet: haemInCurrent[0],
    });
  } else if (haemInCurrent.length > 0 && haemInPrior.length === 0) {
    changes.push({
      category: "hemorrhage_evolution",
      categoryLabel: "New Haemorrhage",
      description: haemInCurrent[0],
      severity: "critical",
      currentSnippet: haemInCurrent[0],
    });
  }

  // 6. Infarct evolution
  const infarctInPrior = extractSentences(prior, ["infarct", "ischaem", "ischemі", "lacunar"]);
  const infarctInCurrent = extractSentences(current, ["infarct", "ischaem", "ischem", "lacunar", "encepharomalacia", "gliosis"]);
  if (infarctInPrior.length > 0 && infarctInCurrent.length > 0) {
    changes.push({
      category: "infarct_evolution",
      categoryLabel: "Infarct Evolution",
      description: "Infarct/ischaemia noted in both studies — assess for maturation and new involvement.",
      severity: "warning",
      priorSnippet: infarctInPrior[0],
      currentSnippet: infarctInCurrent[0],
    });
  }

  // 7. Edema change
  const edemaInPrior = extractSentences(prior, ["edema", "oedema", "vasogenic", "cytotoxic"]);
  const edemaInCurrent = extractSentences(current, ["edema", "oedema", "vasogenic", "cytotoxic"]);
  if (edemaInPrior.length > 0 || edemaInCurrent.length > 0) {
    const edemaChange = edemaInPrior.length > 0 && edemaInCurrent.length === 0 ? "resolved"
      : edemaInCurrent.length > 0 && edemaInPrior.length === 0 ? "new"
      : "present in both";
    changes.push({
      category: "edema_change",
      categoryLabel: "Edema Change",
      description: `Edema ${edemaChange}.${edemaInCurrent.length > 0 ? " Current: " + edemaInCurrent[0] : ""}`,
      severity: edemaChange === "new" ? "warning" : "info",
      priorSnippet: edemaInPrior[0],
      currentSnippet: edemaInCurrent[0],
    });
  }

  // 8. Hydrocephalus change
  const hydroInPrior = extractSentences(prior, ["hydrocephalus", "ventricular dilation", "ventricular dilatation", "ventricular enlargement"]);
  const hydroInCurrent = extractSentences(current, ["hydrocephalus", "ventricular dilation", "ventricular dilatation", "ventricular enlargement"]);
  if (hydroInPrior.length > 0 || hydroInCurrent.length > 0) {
    const hydroChange = hydroInPrior.length > 0 && hydroInCurrent.length === 0 ? "resolved"
      : hydroInCurrent.length > 0 && hydroInPrior.length === 0 ? "new"
      : "present in both";
    changes.push({
      category: "hydrocephalus_change",
      categoryLabel: "Hydrocephalus",
      description: `Hydrocephalus/ventricular change: ${hydroChange}.`,
      severity: hydroChange === "new" ? "critical" : "info",
      priorSnippet: hydroInPrior[0],
      currentSnippet: hydroInCurrent[0],
    });
  }

  // 9. Signal change (MRI-specific)
  if (modality?.toUpperCase().includes("MRI") || modality?.toUpperCase().includes("MR")) {
    const signalInCurrent = extractSentences(current, ["signal change", "new t2", "new flair", "diffusion restriction", "new dwi", "new restriction"]);
    if (signalInCurrent.length > 0) {
      changes.push({
        category: "signal_change",
        categoryLabel: "Signal Change",
        description: signalInCurrent[0],
        severity: "warning",
        currentSnippet: signalInCurrent[0],
      });
    }
  }

  return res.json({
    changes,
    totalChanges: changes.length,
    criticalCount: changes.filter((c) => c.severity === "critical").length,
    warningCount: changes.filter((c) => c.severity === "warning").length,
    infoCount: changes.filter((c) => c.severity === "info").length,
    note: "AI Draft – Requires Radiologist Review. Pattern-based detection only — not a clinical diagnosis.",
  });
});
