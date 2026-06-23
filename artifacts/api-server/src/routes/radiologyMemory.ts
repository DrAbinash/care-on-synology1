/**
 * Phase 9: Radiology Memory + Context Engine
 * Learns reporting preferences, phrases, styles, measurements, classifications
 * over time. All features OFF by default. Radiologist is always final authority.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  radiologyMemoryTable,
  radiologyMemoryPatternsTable,
  radiologyMemoryMeasurementsTable,
  radiologyMemoryClassificationsTable,
  radiologyMemoryPhrasesTable,
  radiologyMemoryImpressionsTable,
  radiologyMemoryDecisionsTable,
  radiologyMemoryFeedbackTable,
  radiologyMemoryUsageTable,
  patientReportsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { type StaffAuthRequest } from "../middleware/requireStaffAuth";

export const radiologyMemoryRouter = Router();

// ── Normalization helpers ──
function normalizeFinding(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function signatureFromFindings(findings: string): string {
  const words = normalizeFinding(findings)
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 20);
  return words.join("|");
}

// ── POST /memorize — store approved report into memory ──
radiologyMemoryRouter.post("/memorize", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const staffName = sReq.staffSession?.subjectName ?? "Unknown";
  const {
    modality,
    bodyPart,
    findingText,
    impressionText,
    impressionStyle,
    classification,
    classificationValue,
    followUpText,
    templateId,
    templateName,
    orderId,
    reportId,
    isAiDraft,
  } = req.body as Record<string, unknown>;

  if (!modality || !bodyPart || !findingText) {
    res.status(400).json({ error: "modality, bodyPart, and findingText are required" });
    return;
  }

  const findingKey = signatureFromFindings(String(findingText));

  const [row] = await db
    .insert(radiologyMemoryTable)
    .values({
      staffId,
      staffName,
      modality: String(modality),
      bodyPart: String(bodyPart),
      findingKey,
      findingText: String(findingText),
      impressionText: impressionText ? String(impressionText) : null,
      impressionStyle: impressionStyle ? String(impressionStyle) : null,
      classification: classification ? String(classification) : null,
      classificationValue: classificationValue ? String(classificationValue) : null,
      followUpText: followUpText ? String(followUpText) : null,
      templateId: templateId ? Number(templateId) : null,
      templateName: templateName ? String(templateName) : null,
      source: isAiDraft ? "ai_accepted" : "manual",
      orderId: orderId ? Number(orderId) : null,
      reportId: reportId ? Number(reportId) : null,
      isAiDraft: Boolean(isAiDraft),
      aiLabel: "AI Draft — Requires Radiologist Review",
    })
    .returning();

  // Also memorize the impression
  if (impressionText) {
    const sig = signatureFromFindings(String(findingText));
    await db.insert(radiologyMemoryImpressionsTable).values({
      staffId,
      findingSignature: sig,
      impressionText: String(impressionText),
      modality: String(modality),
      bodyPart: String(bodyPart),
      acceptanceCount: 1,
    });
  }

  // Also memorize classification
  if (classification) {
    const existing = await db
      .select()
      .from(radiologyMemoryClassificationsTable)
      .where(
        and(
          eq(radiologyMemoryClassificationsTable.staffId, staffId),
          eq(radiologyMemoryClassificationsTable.classification, String(classification)),
          eq(radiologyMemoryClassificationsTable.value, String(classificationValue ?? "")),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(radiologyMemoryClassificationsTable)
        .set({
          usageCount: sql`${radiologyMemoryClassificationsTable.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(radiologyMemoryClassificationsTable.id, existing[0].id));
    } else {
      await db.insert(radiologyMemoryClassificationsTable).values({
        staffId,
        classification: String(classification),
        value: String(classificationValue ?? ""),
        modality: String(modality),
        bodyPart: String(bodyPart),
      });
    }
  }

  res.status(201).json({ memory: row, _aiLabel: "AI Draft — Requires Radiologist Review" });
});

// ── POST /suggest — smart autocomplete suggestions ──
radiologyMemoryRouter.post("/suggest", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const {
    trigger,
    modality,
    bodyPart,
    suggestionType,
    limit,
  } = req.body as Record<string, unknown>;

  const take = limit ? Number(limit) : 10;
  const trig = trigger ? String(trigger).toLowerCase() : "";

  const conditions: ReturnType<typeof eq>[] = [
    eq(radiologyMemoryPhrasesTable.staffId, staffId),
  ];
  if (modality) conditions.push(eq(radiologyMemoryPhrasesTable.modality, String(modality)));
  if (bodyPart) conditions.push(eq(radiologyMemoryPhrasesTable.bodyPart, String(bodyPart)));
  if (suggestionType) conditions.push(eq(radiologyMemoryPhrasesTable.phraseType, String(suggestionType)));

  const rows = await db
    .select()
    .from(radiologyMemoryPhrasesTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyMemoryPhrasesTable.usageCount))
    .limit(take);

  // Filter by trigger if provided
  const suggestions = trig
    ? rows.filter((r) => r.trigger.toLowerCase().includes(trig) || r.phrase.toLowerCase().includes(trig))
    : rows;

  res.json({
    suggestions: suggestions.map((s) => ({
      trigger: s.trigger,
      phrase: s.phrase,
      phraseType: s.phraseType,
      usageCount: s.usageCount,
      acceptanceCount: s.acceptanceCount,
    })),
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// ── GET /impressions — recall approved impressions for similar findings ──
radiologyMemoryRouter.get("/impressions", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const findingSignature = req.query.signature as string | undefined;
  const modality = req.query.modality as string | undefined;
  const bodyPart = req.query.bodyPart as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 10;

  const conditions: ReturnType<typeof eq>[] = [
    eq(radiologyMemoryImpressionsTable.staffId, staffId),
  ];
  if (findingSignature) {
    conditions.push(
      sql`${radiologyMemoryImpressionsTable.findingSignature} ILIKE ${`%${findingSignature}%`}`,
    );
  }
  if (modality) conditions.push(eq(radiologyMemoryImpressionsTable.modality, modality));
  if (bodyPart) conditions.push(eq(radiologyMemoryImpressionsTable.bodyPart, bodyPart));

  const rows = await db
    .select()
    .from(radiologyMemoryImpressionsTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyMemoryImpressionsTable.usageCount))
    .limit(limit);

  res.json({
    impressions: rows.map((r) => ({
      ...r,
      acceptanceRate: r.usageCount > 0 ? Math.round((r.acceptanceCount / r.usageCount) * 100) : 0,
    })),
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// ── POST /decision — log accepted/rejected/edited suggestion ──
radiologyMemoryRouter.post("/decision", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const {
    suggestionType,
    suggestionText,
    action,
    finalText,
    modality,
    bodyPart,
    orderId,
    reportId,
    timeToDecideMs,
  } = req.body as Record<string, unknown>;

  if (!suggestionType || !suggestionText || !action) {
    res.status(400).json({ error: "suggestionType, suggestionText, and action are required" });
    return;
  }

  const [row] = await db
    .insert(radiologyMemoryDecisionsTable)
    .values({
      staffId,
      suggestionType: String(suggestionType),
      suggestionText: String(suggestionText),
      action: String(action),
      finalText: finalText ? String(finalText) : null,
      modality: modality ? String(modality) : null,
      bodyPart: bodyPart ? String(bodyPart) : null,
      orderId: orderId ? Number(orderId) : null,
      reportId: reportId ? Number(reportId) : null,
      timeToDecideMs: timeToDecideMs ? Number(timeToDecideMs) : null,
    })
    .returning();

  // Update impression counts
  if (action === "accepted" && suggestionType === "impression") {
    const sig = signatureFromFindings(String(suggestionText));
    const existing = await db
      .select()
      .from(radiologyMemoryImpressionsTable)
      .where(
        and(
          eq(radiologyMemoryImpressionsTable.staffId, staffId),
          eq(radiologyMemoryImpressionsTable.findingSignature, sig),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(radiologyMemoryImpressionsTable)
        .set({
          acceptanceCount: sql`${radiologyMemoryImpressionsTable.acceptanceCount} + 1`,
          usageCount: sql`${radiologyMemoryImpressionsTable.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(radiologyMemoryImpressionsTable.id, existing[0].id));
    }
  }

  res.status(201).json({ decision: row });
});

// ── POST /feedback — explicit feedback (Useful / Not Useful / Partially Useful) ──
radiologyMemoryRouter.post("/feedback", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const {
    suggestionType,
    suggestionText,
    rating,
    comment,
    modality,
    bodyPart,
    orderId,
    reportId,
  } = req.body as Record<string, unknown>;

  if (!suggestionType || !suggestionText || !rating) {
    res.status(400).json({ error: "suggestionType, suggestionText, and rating are required" });
    return;
  }

  const [row] = await db
    .insert(radiologyMemoryFeedbackTable)
    .values({
      staffId,
      suggestionType: String(suggestionType),
      suggestionText: String(suggestionText),
      rating: String(rating),
      comment: comment ? String(comment) : null,
      modality: modality ? String(modality) : null,
      bodyPart: bodyPart ? String(bodyPart) : null,
      orderId: orderId ? Number(orderId) : null,
      reportId: reportId ? Number(reportId) : null,
    })
    .returning();

  res.status(201).json({ feedback: row });
});

// ── GET /analytics — per-radiologist memory analytics ──
radiologyMemoryRouter.get("/analytics", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  // Top impressions
  const topImpressions = await db
    .select()
    .from(radiologyMemoryImpressionsTable)
    .where(eq(radiologyMemoryImpressionsTable.staffId, staffId))
    .orderBy(desc(radiologyMemoryImpressionsTable.usageCount))
    .limit(10);

  // Top classifications
  const topClassifications = await db
    .select()
    .from(radiologyMemoryClassificationsTable)
    .where(eq(radiologyMemoryClassificationsTable.staffId, staffId))
    .orderBy(desc(radiologyMemoryClassificationsTable.usageCount))
    .limit(10);

  // Top phrases
  const topPhrases = await db
    .select()
    .from(radiologyMemoryPhrasesTable)
    .where(eq(radiologyMemoryPhrasesTable.staffId, staffId))
    .orderBy(desc(radiologyMemoryPhrasesTable.usageCount))
    .limit(10);

  // Decision stats
  const decisionStats = await db
    .select()
    .from(radiologyMemoryDecisionsTable)
    .where(eq(radiologyMemoryDecisionsTable.staffId, staffId));

  const accepted = decisionStats.filter((d) => d.action === "accepted").length;
  const rejected = decisionStats.filter((d) => d.action === "rejected").length;
  const edited = decisionStats.filter((d) => d.action === "edited").length;

  // Feedback stats
  const feedbackStats = await db
    .select()
    .from(radiologyMemoryFeedbackTable)
    .where(eq(radiologyMemoryFeedbackTable.staffId, staffId));

  const useful = feedbackStats.filter((f) => f.rating === "useful").length;
  const notUseful = feedbackStats.filter((f) => f.rating === "not_useful").length;
  const partial = feedbackStats.filter((f) => f.rating === "partially_useful").length;

  // Usage stats
  const usageStats = await db
    .select()
    .from(radiologyMemoryUsageTable)
    .where(eq(radiologyMemoryUsageTable.staffId, staffId))
    .orderBy(desc(radiologyMemoryUsageTable.sessionDate))
    .limit(30);

  // Compute summary metrics
  const totalReports = topImpressions.length;
  const suggestionsUsed = accepted + edited;
  const timeSavedMinutes = Math.round((accepted + edited) * 0.5); // estimate 30s per suggestion

  res.json({
    totalReports,
    suggestionsUsed,
    timeSavedMinutes,
    topImpressions,
    topClassifications,
    topPhrases: topPhrases.map((p) => ({ phrase: p.phrase, count: p.usageCount })),
    topTemplates: [], // not yet tracked
    decisions: {
      total: decisionStats.length,
      accepted,
      rejected,
      edited,
      acceptanceRate: decisionStats.length > 0 ? Math.round((accepted / decisionStats.length) * 100) : 0,
    },
    feedback: {
      total: feedbackStats.length,
      useful,
      notUseful,
      partial,
    },
    usage: usageStats,
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// ── GET /search — search memory across all tables ──
radiologyMemoryRouter.get("/search", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const q = (req.query.q as string) ?? "";
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }

  const pattern = `%${q}%`;

  // Search impressions
  const impressions = await db
    .select()
    .from(radiologyMemoryImpressionsTable)
    .where(
      and(
        eq(radiologyMemoryImpressionsTable.staffId, staffId),
        sql`${radiologyMemoryImpressionsTable.impressionText} ILIKE ${pattern}`,
      ),
    )
    .limit(limit);

  // Search phrases
  const phrases = await db
    .select()
    .from(radiologyMemoryPhrasesTable)
    .where(
      and(
        eq(radiologyMemoryPhrasesTable.staffId, staffId),
        sql`${radiologyMemoryPhrasesTable.phrase} ILIKE ${pattern}`,
      ),
    )
    .limit(limit);

  // Search memory
  const memories = await db
    .select()
    .from(radiologyMemoryTable)
    .where(
      and(
        eq(radiologyMemoryTable.staffId, staffId),
        sql`${radiologyMemoryTable.findingText} ILIKE ${pattern}`,
      ),
    )
    .limit(limit);

  res.json({
    impressions,
    phrases,
    memories,
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// ── GET /patterns — style patterns for a doctor ──
radiologyMemoryRouter.get("/patterns", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const patternType = req.query.type as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [eq(radiologyMemoryPatternsTable.staffId, staffId)];
  if (patternType) conditions.push(eq(radiologyMemoryPatternsTable.patternType, patternType));

  const rows = await db
    .select()
    .from(radiologyMemoryPatternsTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyMemoryPatternsTable.chosenCount));

  res.json({
    patterns: rows.map((r) => ({
      ...r,
      preferenceRate: (r.chosenCount + r.alternativeCount) > 0
        ? Math.round((r.chosenCount / (r.chosenCount + r.alternativeCount)) * 100)
        : 0,
    })),
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});

// ── GET /measurements — measurement history ──
radiologyMemoryRouter.get("/measurements", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const patientId = req.query.patientId ? Number(req.query.patientId) : undefined;
  const measurementType = req.query.type as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  const conditions: ReturnType<typeof eq>[] = [eq(radiologyMemoryMeasurementsTable.staffId, staffId)];
  if (patientId) conditions.push(eq(radiologyMemoryMeasurementsTable.patientId, patientId));
  if (measurementType) conditions.push(eq(radiologyMemoryMeasurementsTable.measurementType, measurementType));

  const rows = await db
    .select()
    .from(radiologyMemoryMeasurementsTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyMemoryMeasurementsTable.createdAt))
    .limit(limit);

  res.json({ measurements: rows, _aiLabel: "AI Draft — Requires Radiologist Review" });
});

// ── GET /classifications — most-used classifications ──
radiologyMemoryRouter.get("/classifications", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  const staffId = sReq.staffSession?.subjectId ?? 0;
  const classification = req.query.classification as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 10;

  const conditions: ReturnType<typeof eq>[] = [eq(radiologyMemoryClassificationsTable.staffId, staffId)];
  if (classification) conditions.push(eq(radiologyMemoryClassificationsTable.classification, classification));

  const rows = await db
    .select()
    .from(radiologyMemoryClassificationsTable)
    .where(and(...conditions))
    .orderBy(desc(radiologyMemoryClassificationsTable.usageCount))
    .limit(limit);

  res.json({
    classifications: rows,
    _aiLabel: "AI Draft — Requires Radiologist Review",
  });
});
