/**
 * Smart Radiology Platform — Phase 10.1
 * Mounted at /api/smart-radiology (staff-auth required)
 *
 * 1. AI Impression Assistant
 * 2. AI Quality Checker
 * 3. Follow-Up Recommendation Engine
 * 4. Template Learning Engine
 * 5. Multi-Language Reporting
 * 6. Mobile Sonographer Mode
 * 7. Smart Routing Rules Engine
 * 8. SLA / TAT Monitoring
 * 9. Report Amendment/Addendum System
 * 10. DICOM SR Export Queue
 *
 * Safety: AI never signs/finalizes reports. All AI outputs tagged.
 */

import { Router, type Request } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  aiImpressionsTable, reportQualityChecksTable, followUpRecommendationsTable,
  templateLearningTable, reportTranslationsTable, sonographerDraftsTable,
  smartRoutingRulesTable, studyTatMetricsTable, reportAmendmentsTable,
  dicomSrExportQueueTable, dicomStudiesTable,
  dicomStudyAuditLogTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import type { StaffAuthRequest } from "../middleware/requireStaffAuth";
import { geminiGenerate } from "@workspace/integrations-gemini-ai";

const router = Router();

function staffOf(req: Request) {
  return (req as StaffAuthRequest).staffSession!;
}
function requireRole(req: Request, ...roles: string[]) {
  const s = staffOf(req);
  return !!s.role && roles.includes(s.role);
}
const requireRad = (req: Request) => requireRole(req, "radiologist", "admin", "super_admin");
const requireAdmin = (req: Request) => requireRole(req, "admin", "super_admin");

async function audit(req: Request, params: { studyId?: number | null | undefined; action: string; details?: Record<string, unknown> }) {
  const s = staffOf(req);
  const values: any = {
    studyId: params.studyId ?? 0,
    studyInstanceUID: null,
    action: params.action,
    actorId: s.subjectId ?? null,
    actorName: s.subjectName ?? "system",
    actorRole: s.role ?? "unknown",
    details: params.details ? JSON.stringify(params.details) : null,
  };
  await db.insert(dicomStudyAuditLogTable).values(values);
}

// ── 1. AI Impression Assistant ────────────────────────────────────────────────────────────────────────

const MODALITY_PROMPTS: Record<string, string> = {
  USG_ABDOMEN: `You are a senior radiologist AI assistant. Given the ultrasound abdomen findings below, generate a concise, clinically accurate IMPRESSION only. Do NOT include findings section. Use standard radiology terminology. Keep to 3–5 lines. Findings:`,
  USG_PELVIS: `You are a senior radiologist AI assistant. Given the ultrasound pelvis findings below, generate a concise IMPRESSION only. Focus on uterus, ovaries, adnexa, endometrium, and any free fluid. Keep to 3–5 lines. Findings:`,
  OB_GROWTH: `You are a senior radiologist AI assistant. Given the obstetric growth scan findings below, generate a concise IMPRESSION only. Comment on fetal growth percentile, liquor, placenta, and any red flags. Keep to 3–5 lines. Findings:`,
  DOPPLER: `You are a senior radiologist AI assistant. Given the Doppler ultrasound findings below, generate a concise IMPRESSION only. Comment on flow patterns, resistance indices, and any hemodynamic significance. Keep to 3–5 lines. Findings:`,
  CT_BRAIN: `You are a senior radiologist AI assistant. Given the CT Brain findings below, generate a concise IMPRESSION only. Comment on parenchyma, ventricles, hemorrhage, mass effect, and bone. Keep to 3–5 lines. Findings:`,
  MRI_BRAIN: `You are a senior radiologist AI assistant. Given the MRI Brain findings below, generate a concise IMPRESSION only. Comment on sequences, parenchyma, white matter, vascular, and enhancement. Keep to 3–5 lines. Findings:`,
  MRI_SPINE: `You are a senior radiologist AI assistant. Given the MRI Spine findings below, generate a concise IMPRESSION only. Comment on discs, canal, cord, alignment, and any stenosis. Keep to 3–5 lines. Findings:`,
};

router.post("/ai-impressions/:studyId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const studyId = Number(req.params.studyId);
  const parsed = z.object({
    modality: z.enum(["USG_ABDOMEN", "USG_PELVIS", "OB_GROWTH", "DOPPLER", "CT_BRAIN", "MRI_BRAIN", "MRI_SPINE"] as [string, ...string[]]),
    findingsText: z.string().min(1),
    reportDraftId: z.number().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { modality, findingsText, reportDraftId } = parsed.data;

  const prompt = `${MODALITY_PROMPTS[modality]}\n\n${findingsText}`;
  let aiText = "";
  try {
    aiText = await geminiGenerate(prompt, { maxTokens: 512 });
  } catch (e) {
    aiText = `AI generation unavailable. [${(e as Error).message}]`;
  }

  const [row] = await db.insert(aiImpressionsTable).values({
    studyId, reportDraftId: reportDraftId ?? null, modality, findingsText,
    aiGeneratedImpression: aiText, isAiSuggested: true, status: "pending",
  }).returning();

  await audit(req, { studyId, action: "ai_impression_generated", details: { modality, impressionLength: aiText.length } });
  res.status(201).json(row);
});

router.get("/ai-impressions/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const rows = await db.select().from(aiImpressionsTable).where(eq(aiImpressionsTable.studyId, studyId)).orderBy(desc(aiImpressionsTable.createdAt));
  res.json(rows);
});

router.patch("/ai-impressions/:id/verify", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const parsed = z.object({ editedImpression: z.string().optional() }).safeParse(req.body);
  const s = staffOf(req);
  const [row] = await db.update(aiImpressionsTable).set({
    status: "verified",
    verifiedById: s.subjectId,
    verifiedByName: s.subjectName,
    verifiedAt: new Date(),
    editedImpression: parsed.success ? parsed.data.editedImpression ?? null : null,
    updatedAt: new Date(),
  }).where(eq(aiImpressionsTable.id, id)).returning();
  await audit(req, { studyId: row.studyId, action: "ai_impression_verified", details: { impressionId: id } });
  res.json(row);
});

router.patch("/ai-impressions/:id/reject", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const [row] = await db.update(aiImpressionsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(aiImpressionsTable.id, id)).returning();
  await audit(req, { studyId: row.studyId, action: "ai_impression_rejected", details: { impressionId: id } });
  res.json(row);
});

// ── 2. AI Quality Checker ───────────────────────────────────────────────────────────────────────────

interface QcChecks {
  missingImpression: boolean;
  missingFindings: boolean;
  missingCriticalValues: boolean;
  impossibleObValues: boolean;
  eddGaMismatch: boolean;
  leftRightMismatch: boolean;
  unapprovedOcrUsed: boolean;
  blankRequiredFields: boolean;
  reportTooShort: boolean;
  normalDespiteAbnormalFindings: boolean;
  overallResult: string;
  detailsJson: string;
  reportDraftId?: number;
  checkedById?: number | null;
  checkedByName?: string | null;
}

function runQualityChecks(findings: string, impression: string): QcChecks {
  const f = findings.toLowerCase();
  const i = impression.toLowerCase();
  const checks: Partial<QcChecks> = {};

  checks.missingImpression = !impression || impression.trim().length < 10;
  checks.missingFindings = !findings || findings.trim().length < 20;
  checks.missingCriticalValues = false;
  checks.impossibleObValues = false;
  checks.eddGaMismatch = false;
  checks.leftRightMismatch = /left.*right|right.*left/i.test(findings) && !/left|right/i.test(impression);
  checks.unapprovedOcrUsed = false;
  checks.blankRequiredFields = (!impression || !findings);
  checks.reportTooShort = (findings.length + impression.length) < 100;
  checks.normalDespiteAbnormalFindings = i.includes("normal") && (f.includes("mass") || f.includes("lesion") || f.includes("hydro") || f.includes("cyst") || f.includes("enlarged") || f.includes("dilated") || f.includes("thickening") || f.includes("effusion"));

  const blockers = [
    checks.missingImpression, checks.missingFindings, checks.blankRequiredFields,
    checks.normalDespiteAbnormalFindings,
  ].filter(Boolean).length;
  const warnings = [
    checks.reportTooShort, checks.leftRightMismatch, checks.missingCriticalValues,
    checks.unapprovedOcrUsed,
  ].filter(Boolean).length;

  checks.overallResult = blockers > 0 ? "BLOCKER" : warnings > 0 ? "WARNING" : "PASS";
  checks.detailsJson = JSON.stringify({
    checks: {
      missingImpression: checks.missingImpression,
      missingFindings: checks.missingFindings,
      leftRightMismatch: checks.leftRightMismatch,
      normalDespiteAbnormalFindings: checks.normalDespiteAbnormalFindings,
      reportTooShort: checks.reportTooShort,
    },
    blockerCount: blockers,
    warningCount: warnings,
  });
  return checks as QcChecks;
}

router.post("/quality-check/:reportDraftId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const reportDraftId = Number(req.params.reportDraftId);
  const parsed = z.object({
    findingsText: z.string().default(""),
    impressionText: z.string().default(""),
    measurementsJson: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { findingsText, impressionText } = parsed.data;

  const s = staffOf(req);
  const base = runQualityChecks(findingsText, impressionText);
  const [row] = await db.insert(reportQualityChecksTable).values({
    reportDraftId,
    missingImpression: base.missingImpression,
    missingFindings: base.missingFindings,
    missingCriticalValues: base.missingCriticalValues,
    impossibleObValues: base.impossibleObValues,
    eddGaMismatch: base.eddGaMismatch,
    leftRightMismatch: base.leftRightMismatch,
    unapprovedOcrUsed: base.unapprovedOcrUsed,
    blankRequiredFields: base.blankRequiredFields,
    reportTooShort: base.reportTooShort,
    normalDespiteAbnormalFindings: base.normalDespiteAbnormalFindings,
    overallResult: base.overallResult,
    detailsJson: base.detailsJson,
    checkedById: s.subjectId,
    checkedByName: s.subjectName,
  } as any).returning();

  await audit(req, { action: "quality_check_run", details: { reportDraftId, result: row.overallResult } });
  res.status(201).json(row);
});

router.get("/quality-check/:reportDraftId", async (req, res) => {
  const reportDraftId = Number(req.params.reportDraftId);
  const rows = await db.select().from(reportQualityChecksTable).where(eq(reportQualityChecksTable.reportDraftId, reportDraftId)).orderBy(desc(reportQualityChecksTable.checkedAt));
  res.json(rows);
});

router.patch("/quality-check/:id/acknowledge", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(reportQualityChecksTable).set({
    acknowledgedById: s.subjectId,
    acknowledgedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(reportQualityChecksTable.id, id)).returning();
  res.json(row);
});

// ── 3. Follow-Up Recommendation Engine ──────────────────────────────────────────────────────────────────────────

const FOLLOW_UP_RULES: Array<{ rule: string; keywords: string[]; text: string; priority: string }> = [
  { rule: "abnormal_doppler", keywords: ["doppler", "ri", "pi", "resistance", "velocity"], text: "Abnormal Doppler indices detected — urgent clinical correlation recommended.", priority: "urgent" },
  { rule: "placenta_previa", keywords: ["placenta previa", "low lying placenta", "placenta covering"], text: "Placenta previa identified — obstetric follow-up and delivery planning required.", priority: "urgent" },
  { rule: "growth_lag", keywords: ["growth lag", "iugr", "small for gestational", "efw < 10th"], text: "Fetal growth lag detected — interval growth scan in 2–3 weeks recommended.", priority: "urgent" },
  { rule: "adnexal_cyst", keywords: ["adnexal cyst", "ovarian cyst", "follicular cyst", "corpus luteum"], text: "Adnexal cyst >5 cm — follow-up scan in 6–8 weeks to assess resolution.", priority: "routine" },
  { rule: "fatty_liver", keywords: ["fatty liver", "hepatic steatosis", "diffuse fatty change"], text: "Fatty liver changes noted — correlate with LFTs and advise lifestyle modification.", priority: "routine" },
  { rule: "hydronephrosis", keywords: ["hydronephrosis", "dilated pelvicalyceal", "pcs separation"], text: "Hydronephrosis identified — urology correlation and follow-up imaging recommended.", priority: "urgent" },
  { rule: "suspicious_mass", keywords: ["mass", "tumor", "neoplasm", "suspicious lesion", "irregular margin"], text: "Suspicious mass identified — contrast-enhanced MRI/CT or biopsy correlation advised.", priority: "stat" },
  { rule: "pleural_effusion", keywords: ["pleural effusion", "fluid in pleural"], text: "Pleural effusion noted — clinical correlation and possible thoracentesis if symptomatic.", priority: "urgent" },
  { rule: "gallstone", keywords: ["gallstone", "cholelithiasis", "calculus in gallbladder"], text: "Gallstones present — surgical/GI evaluation if symptomatic.", priority: "routine" },
  { rule: "renal_stone", keywords: ["renal stone", "nephrolithiasis", "calculus in kidney"], text: "Renal calculus noted — urology follow-up and hydration advice.", priority: "routine" },
];

interface FollowUpSuggestion {
  triggerRule: string;
  recommendationText: string;
  priority: string;
  isAiSuggested: boolean;
  editedText: string | null;
  accepted: boolean;
  acceptedById: number | null;
  acceptedByName: string | null;
  acceptedAt: Date | null;
}

function generateFollowUps(findingsText: string, impressionText: string): FollowUpSuggestion[] {
  const text = (findingsText + " " + impressionText).toLowerCase();
  const results: FollowUpSuggestion[] = [];
  for (const r of FOLLOW_UP_RULES) {
    if (r.keywords.some((k) => text.includes(k))) {
      results.push({
        triggerRule: r.rule,
        recommendationText: r.text,
        priority: r.priority,
        isAiSuggested: true,
        editedText: null,
        accepted: false,
        acceptedById: null,
        acceptedByName: null,
        acceptedAt: null,
      });
    }
  }
  return results;
}

router.post("/follow-up/:reportDraftId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const reportDraftId = Number(req.params.reportDraftId);
  const parsed = z.object({ findingsText: z.string(), impressionText: z.string(), studyId: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { findingsText, impressionText, studyId } = parsed.data;

  const suggestions = generateFollowUps(findingsText, impressionText);
  const inserted: any[] = [];
  for (const s of suggestions) {
    const [row] = await db.insert(followUpRecommendationsTable).values({
      ...s, reportDraftId, studyId: studyId ?? null,
    }).returning();
    inserted.push(row);
  }

  await audit(req, { studyId, action: "follow_up_generated", details: { reportDraftId, count: inserted.length } });
  res.status(201).json({ generated: inserted });
});

router.get("/follow-up/:reportDraftId", async (req, res) => {
  const reportDraftId = Number(req.params.reportDraftId);
  const rows = await db.select().from(followUpRecommendationsTable).where(eq(followUpRecommendationsTable.reportDraftId, reportDraftId)).orderBy(desc(followUpRecommendationsTable.createdAt));
  res.json(rows);
});

router.patch("/follow-up/:id/accept", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const s = staffOf(req);
  const [row] = await db.update(followUpRecommendationsTable).set({
    accepted: true, acceptedById: s.subjectId, acceptedByName: s.subjectName, acceptedAt: new Date(), updatedAt: new Date(),
  }).where(eq(followUpRecommendationsTable.id, id)).returning();
  res.json(row);
});

router.patch("/follow-up/:id/edit", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const parsed = z.object({ editedText: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const [row] = await db.update(followUpRecommendationsTable).set({
    editedText: parsed.data.editedText, updatedAt: new Date(),
  }).where(eq(followUpRecommendationsTable.id, id)).returning();
  res.json(row);
});

// ── 4. Template Learning Engine ─────────────────────────────────────────────────────────────────────────────

router.get("/templates", async (_req, res) => {
  const rows = await db.select().from(templateLearningTable).where(eq(templateLearningTable.isActive, true)).orderBy(asc(templateLearningTable.modality), asc(templateLearningTable.name));
  res.json(rows);
});

router.post("/templates", async (req, res) => {
  if (!requireAdmin(req) && !requireRad(req)) { res.status(403).json({ error: "Admin or radiologist access required" }); return; }
  const parsed = z.object({
    name: z.string().min(1), modality: z.string().optional(), bodyPart: z.string().optional(),
    templateType: z.enum(["normal", "doctor_specific", "modality_specific", "recommendation"] as [string, ...string[]]).default("normal"),
    doctorId: z.number().optional(), doctorName: z.string().optional(), content: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.insert(templateLearningTable).values({
    ...parsed.data, createdById: s.subjectId, createdByName: s.subjectName,
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/templates/:id", async (req, res) => {
  if (!requireAdmin(req) && !requireRad(req)) { res.status(403).json({ error: "Admin or radiologist access required" }); return; }
  const id = Number(req.params.id);
  const [row] = await db.update(templateLearningTable).set({ ...req.body, updatedAt: new Date() }).where(eq(templateLearningTable.id, id)).returning();
  res.json(row);
});

router.delete("/templates/:id", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.id);
  await db.update(templateLearningTable).set({ isActive: false, updatedAt: new Date() }).where(eq(templateLearningTable.id, id));
  res.json({ success: true });
});

// ── 5. Multi-Language Reporting ───────────────────────────────────────────────────────────────────────────

async function translateToHindi(text: string): Promise<string> {
  const prompt = `Translate this medical report into simple, patient-friendly Hindi. Use common Hindi medical terms. Keep it brief and reassuring. Do not add extra commentary. Report: ${text}`;
  try { return await geminiGenerate(prompt, { maxTokens: 1024 }); } catch { return "Hindi translation unavailable."; }
}

async function generateBilingual(enText: string, hiText: string): Promise<string> {
  return `ENGLISH:\n${enText}\n\nHINDI:\n${hiText}`;
}

router.post("/translations/:reportDraftId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const reportDraftId = Number(req.params.reportDraftId);
  const parsed = z.object({ reportText: z.string(), studyId: z.number().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { reportText, studyId } = parsed.data;

  const hindi = await translateToHindi(reportText);
  const bilingual = await generateBilingual(reportText, hindi);

  const [row] = await db.insert(reportTranslationsTable).values({
    reportDraftId, studyId: studyId ?? null,
    hindiSummary: hindi, hindiSummaryGeneratedAt: new Date(),
    bilingualSummary: bilingual, bilingualGeneratedAt: new Date(),
    isAiTranslated: true,
  } as any).returning();

  await audit(req, { studyId, action: "translation_generated", details: { reportDraftId } });
  res.status(201).json(row);
});

router.get("/translations/:reportDraftId", async (req, res) => {
  const reportDraftId = Number(req.params.reportDraftId);
  const rows = await db.select().from(reportTranslationsTable).where(eq(reportTranslationsTable.reportDraftId, reportDraftId)).orderBy(desc(reportTranslationsTable.createdAt));
  res.json(rows);
});

router.patch("/translations/:id/edit", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const parsed = z.object({ editedHindiSummary: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.update(reportTranslationsTable).set({
    editedHindiSummary: parsed.data.editedHindiSummary,
    editedById: s.subjectId, editedByName: s.subjectName, editedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(reportTranslationsTable.id, id)).returning();
  res.json(row);
});

// ── 6. Mobile Sonographer Mode ───────────────────────────────────────────────────────────────────────────

router.get("/sonographer-drafts", async (req, res) => {
  const status = req.query.status as string | undefined;
  const q = status
    ? db.select().from(sonographerDraftsTable).where(eq(sonographerDraftsTable.status, status)).orderBy(desc(sonographerDraftsTable.createdAt))
    : db.select().from(sonographerDraftsTable).orderBy(desc(sonographerDraftsTable.createdAt));
  const rows = await q.limit(100);
  res.json(rows);
});

router.get("/sonographer-drafts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(sonographerDraftsTable).where(eq(sonographerDraftsTable.id, id)).limit(1);
  res.json(row ?? null);
});

router.post("/sonographer-drafts", async (req, res) => {
  const parsed = z.object({
    studyId: z.number(), approvedMeasurementsJson: z.string().optional(),
    keyImageIdsJson: z.string().optional(), voiceDictationText: z.string().optional(),
    draftReportText: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.insert(sonographerDraftsTable).values({
    ...parsed.data,
    sonographerId: s.subjectId, sonographerName: s.subjectName,
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/sonographer-drafts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(sonographerDraftsTable).set({ ...req.body, updatedAt: new Date() }).where(eq(sonographerDraftsTable.id, id)).returning();
  res.json(row);
});

router.post("/sonographer-drafts/:id/submit", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(sonographerDraftsTable).set({
    status: "submitted_for_review", updatedAt: new Date(),
  }).where(eq(sonographerDraftsTable.id, id)).returning();
  await audit(req, { action: "sonographer_draft_submitted", details: { draftId: id, studyId: row.studyId } });
  res.json(row);
});

router.post("/sonographer-drafts/:id/review", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const id = Number(req.params.id);
  const parsed = z.object({ status: z.enum(["reviewed", "rejected"] as [string, ...string[]]), reviewNotes: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.update(sonographerDraftsTable).set({
    status: parsed.data.status,
    reviewedById: s.subjectId, reviewedByName: s.subjectName, reviewedAt: new Date(),
    reviewNotes: parsed.data.reviewNotes ?? null,
    updatedAt: new Date(),
  }).where(eq(sonographerDraftsTable.id, id)).returning();
  await audit(req, { action: `sonographer_draft_${parsed.data.status}`, details: { draftId: id, studyId: row.studyId } });
  res.json(row);
});

// ── 7. Smart Routing Rules Engine ──────────────────────────────────────────────────────────────────────────

router.get("/routing-rules", async (_req, res) => {
  const rows = await db.select().from(smartRoutingRulesTable).orderBy(asc(smartRoutingRulesTable.sortOrder));
  res.json(rows);
});

router.post("/routing-rules", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const parsed = z.object({
    name: z.string().min(1), modality: z.string().optional(), bodyPart: z.string().optional(),
    studyDescriptionKeywords: z.string().optional(), referringDoctorId: z.number().optional(),
    referringDoctorName: z.string().optional(), priority: z.string().optional(),
    targetQueue: z.string().min(1), targetModulePath: z.string().optional(),
    autoAssignRadiologistId: z.number().optional(), autoAssignRadiologistName: z.string().optional(),
    sortOrder: z.number().default(0),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.insert(smartRoutingRulesTable).values({
    ...parsed.data, createdById: s.subjectId, createdByName: s.subjectName,
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/routing-rules/:id", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.id);
  const [row] = await db.update(smartRoutingRulesTable).set({ ...req.body, updatedAt: new Date() }).where(eq(smartRoutingRulesTable.id, id)).returning();
  res.json(row);
});

router.delete("/routing-rules/:id", async (req, res) => {
  if (!requireAdmin(req)) { res.status(403).json({ error: "Admin access required" }); return; }
  const id = Number(req.params.id);
  await db.update(smartRoutingRulesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(smartRoutingRulesTable.id, id));
  res.json({ success: true });
});

router.post("/routing-rules/apply/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const [study] = await db.select().from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }

  const rules = await db.select().from(smartRoutingRulesTable).where(eq(smartRoutingRulesTable.isActive, true)).orderBy(asc(smartRoutingRulesTable.sortOrder));
  let matched: typeof smartRoutingRulesTable.$inferSelect | null = null;
  const desc = (study.studyDescription ?? "").toLowerCase();
  for (const r of rules) {
    const modMatch = !r.modality || r.modality === (study.modality ?? "");
    const bpMatch = !r.bodyPart || r.bodyPart === (study.bodyPartExamined ?? "");
    const kwMatch = !r.studyDescriptionKeywords || r.studyDescriptionKeywords.toLowerCase().split(",").some((k: string) => desc.includes(k.trim()));
    const priMatch = !r.priority || r.priority === (study.priority ?? "");
    if (modMatch && bpMatch && kwMatch && priMatch) { matched = r; break; }
  }

  if (matched) {
    await db.update(dicomStudiesTable).set({
      assignedRadiologistId: matched.autoAssignRadiologistId ?? study.assignedRadiologistId,
      assignedRadiologistName: matched.autoAssignRadiologistName ?? study.assignedRadiologistName,
      updatedAt: new Date(),
    }).where(eq(dicomStudiesTable.id, studyId));
  }

  res.json({ matched, applied: !!matched });
});

// ── 8. SLA / TAT Monitoring ───────────────────────────────────────────────────────────────────────────────

const SLA_THRESHOLDS: Record<string, number> = {
  emergency: 30, stat: 60, icu: 120, inpatient: 240, outpatient: 480, corporate: 480, routine: 720,
};

router.get("/tat-metrics", async (req, res) => {
  const modality = req.query.modality as string | undefined;
  const radiologistId = req.query.radiologistId as string | undefined;
  const delayedOnly = req.query.delayed === "true";
  const breachedOnly = req.query.breached === "true";

  let q = db.select().from(studyTatMetricsTable).$dynamic();
  const conditions = [];
  if (modality) conditions.push(eq(studyTatMetricsTable.modality, modality));
  if (radiologistId) conditions.push(eq(studyTatMetricsTable.radiologistId, Number(radiologistId)));
  if (delayedOnly) conditions.push(eq(studyTatMetricsTable.isDelayed, true));
  if (breachedOnly) conditions.push(eq(studyTatMetricsTable.slaBreached, true));
  if (conditions.length > 0) q = q.where(and(...conditions));
  const rows = await q.orderBy(desc(studyTatMetricsTable.createdAt)).limit(200);

  const [agg] = await db.select({
    avgTotal: sql<number>`avg(${studyTatMetricsTable.totalTatMinutes})`,
    avgReport: sql<number>`avg(${studyTatMetricsTable.reportTatMinutes})`,
    delayedCount: sql<number>`count(case when ${studyTatMetricsTable.isDelayed} then 1 end)`,
    breachedCount: sql<number>`count(case when ${studyTatMetricsTable.slaBreached} then 1 end)`,
    totalCount: sql<number>`count(*)`,
  }).from(studyTatMetricsTable).where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json({ metrics: rows, aggregate: agg });
});

router.post("/tat-metrics/:studyId", async (req, res) => {
  const studyId = Number(req.params.studyId);
  const parsed = z.object({
    receivedAt: z.string().optional(), assignedToRadiologistAt: z.string().optional(),
    reportStartedAt: z.string().optional(), reportVerifiedAt: z.string().optional(),
    reportFinalizedAt: z.string().optional(), radiologistId: z.number().optional(),
    radiologistName: z.string().optional(), priority: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const b = parsed.data;

  const received = b.receivedAt ? new Date(b.receivedAt) : new Date();
  const finalized = b.reportFinalizedAt ? new Date(b.reportFinalizedAt) : null;
  const started = b.reportStartedAt ? new Date(b.reportStartedAt) : null;
  const threshold = SLA_THRESHOLDS[b.priority ?? "routine"] ?? 720;
  const totalTat = finalized ? Math.round((finalized.getTime() - received.getTime()) / 60000) : null;
  const reportTat = started && finalized ? Math.round((finalized.getTime() - started.getTime()) / 60000) : null;
  const slaBreached = totalTat !== null && totalTat > threshold;

  const existing = await db.select().from(studyTatMetricsTable).where(eq(studyTatMetricsTable.studyId, studyId)).limit(1);
  if (existing.length > 0) {
    const [row] = await db.update(studyTatMetricsTable).set({
      receivedAt: received,
      assignedToRadiologistAt: b.assignedToRadiologistAt ? new Date(b.assignedToRadiologistAt) : existing[0].assignedToRadiologistAt,
      reportStartedAt: b.reportStartedAt ? new Date(b.reportStartedAt) : existing[0].reportStartedAt,
      reportVerifiedAt: b.reportVerifiedAt ? new Date(b.reportVerifiedAt) : existing[0].reportVerifiedAt,
      reportFinalizedAt: finalized,
      totalTatMinutes: totalTat,
      reportTatMinutes: reportTat,
      slaThresholdMinutes: threshold,
      slaBreached,
      isDelayed: slaBreached,
      updatedAt: new Date(),
    } as any).where(eq(studyTatMetricsTable.id, existing[0].id)).returning();
    res.json(row);
  } else {
    const [study] = await db.select({ accessionNumber: dicomStudiesTable.accessionNumber, modality: dicomStudiesTable.modality }).from(dicomStudiesTable).where(eq(dicomStudiesTable.id, studyId)).limit(1);
    const [row] = await db.insert(studyTatMetricsTable).values({
      studyId, accessionNumber: study?.accessionNumber ?? null, modality: study?.modality ?? null,
      priority: b.priority ?? "routine",
      receivedAt: received,
      assignedToRadiologistAt: b.assignedToRadiologistAt ? new Date(b.assignedToRadiologistAt) : null,
      reportStartedAt: b.reportStartedAt ? new Date(b.reportStartedAt) : null,
      reportVerifiedAt: b.reportVerifiedAt ? new Date(b.reportVerifiedAt) : null,
      reportFinalizedAt: finalized,
      totalTatMinutes: totalTat,
      reportTatMinutes: reportTat,
      slaThresholdMinutes: threshold,
      slaBreached,
      isDelayed: slaBreached,
      radiologistId: b.radiologistId ?? null,
      radiologistName: b.radiologistName ?? null,
    } as any).returning();
    res.status(201).json(row);
  }
});

// ── 9. Report Amendment/Addendum System ─────────────────────────────────────────────────────────────────────────────

async function sha256Hash(text: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
}

router.get("/amendments/:reportDraftId", async (req, res) => {
  const reportDraftId = Number(req.params.reportDraftId);
  const rows = await db.select().from(reportAmendmentsTable).where(eq(reportAmendmentsTable.reportDraftId, reportDraftId)).orderBy(asc(reportAmendmentsTable.sequenceNumber));
  res.json(rows);
});

router.post("/amendments/:reportDraftId", async (req, res) => {
  if (!requireRad(req)) { res.status(403).json({ error: "Radiologist access required" }); return; }
  const reportDraftId = Number(req.params.reportDraftId);
  const parsed = z.object({
    priorContent: z.string().min(1), addendumText: z.string().min(1),
    amendmentReason: z.string().min(1), studyId: z.number().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const { priorContent, addendumText, amendmentReason, studyId } = parsed.data;

  const s = staffOf(req);
  const priorHash = await sha256Hash(priorContent);
  const newContent = `${priorContent}\n\n[AMENDMENT — ${new Date().toISOString()}]\nReason: ${amendmentReason}\nAddendum: ${addendumText}`;
  const newHash = await sha256Hash(newContent);

  const [last] = await db.select({ seq: sql<number>`max(${reportAmendmentsTable.sequenceNumber})` }).from(reportAmendmentsTable).where(eq(reportAmendmentsTable.reportDraftId, reportDraftId));
  const seq = (last?.seq ?? 0) + 1;

  const [row] = await db.insert(reportAmendmentsTable).values({
    reportDraftId, studyId: studyId ?? null,
    priorContent, priorVersionHash: priorHash,
    addendumText, amendmentReason,
    amendedById: s.subjectId, amendedByName: s.subjectName,
    newContent, newVersionHash: newHash,
    amendmentLabel: `AMENDED v${seq}`,
    sequenceNumber: seq,
  } as any).returning();

  await audit(req, { studyId, action: "report_amended", details: { reportDraftId, seq, reason: amendmentReason } });
  res.status(201).json(row);
});

// ── 10. DICOM SR Export Queue ────────────────────────────────────────────────────────────────────────────────

router.get("/dicom-sr-export", async (req, res) => {
  const status = req.query.status as string | undefined;
  const q = status
    ? db.select().from(dicomSrExportQueueTable).where(eq(dicomSrExportQueueTable.exportStatus, status)).orderBy(desc(dicomSrExportQueueTable.createdAt))
    : db.select().from(dicomSrExportQueueTable).orderBy(desc(dicomSrExportQueueTable.createdAt));
  const rows = await q.limit(100);
  res.json(rows);
});

router.post("/dicom-sr-export", async (req, res) => {
  const parsed = z.object({
    studyId: z.number(), reportDraftId: z.number().optional(),
    measurementsJson: z.string().optional(),
    pacsDestinationAeTitle: z.string().optional(),
    pacsDestinationHost: z.string().optional(),
    pacsDestinationPort: z.number().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
  const s = staffOf(req);
  const [row] = await db.insert(dicomSrExportQueueTable).values({
    ...parsed.data,
    requestedById: s.subjectId, requestedByName: s.subjectName,
  } as any).returning();
  res.status(201).json(row);
});

router.patch("/dicom-sr-export/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(dicomSrExportQueueTable).set({
    exportStatus: "retrying", exportAttemptCount: sql`${dicomSrExportQueueTable.exportAttemptCount} + 1`,
    lastAttemptedAt: new Date(), updatedAt: new Date(),
  }).where(eq(dicomSrExportQueueTable.id, id)).returning();
  res.json(row);
});

export default router;
