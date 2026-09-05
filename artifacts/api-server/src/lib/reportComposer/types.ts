/**
 * Shared types for Background AI Report Composer.
 * Tracked changes are DATA (not HTML). Review colors are render-time only.
 */
import { z } from "zod";

export const ComposeObservationSchema = z.object({
  id: z.string().optional(),
  concept: z.string().min(1),
  source: z.enum(["quick-select", "quick-findings", "macro", "manual", "voice", "structured"]).optional(),
  /** Canonical reporting region (e.g. "LS Spine", "Brain"). Optional for
   * backward compatibility with snapshots produced before this field was
   * introduced. When present, it participates in canonical observation
   * identity (region|concept|level|laterality) for dedupe + hashing. */
  region: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  laterality: z.string().nullable().optional(),
  findingsText: z.string().min(1),
  impressionText: z.string().optional(),
  /** Optional radiologist-supplied recommendation contribution for this observation. */
  recommendationText: z.string().optional(),
  anatomicalSection: z.string().optional(),
  conflictGroup: z.string().optional(),
  baselineReplaces: z.string().optional(),
});

export type ComposeObservation = z.infer<typeof ComposeObservationSchema>;

/** Conservative max selected key images for SELECTED_IMAGES compose mode. */
export const COMPOSER_MAX_SELECTED_KEY_IMAGES = 4;

export const ComposerAiModeSchema = z.enum(["TEXT_ONLY", "SELECTED_IMAGES"]);
export type ComposerAiMode = z.infer<typeof ComposerAiModeSchema>;

/**
 * Stable metadata for radiologist-selected frozen key images.
 * NEVER store base64 / blob URLs here — only IDs + safe audit metadata.
 */
export const SelectedKeyImageRefSchema = z.object({
  keyImageId: z.number().int().positive(),
  observationId: z.string().nullable().optional(),
  seriesInstanceUid: z.string().nullable().optional(),
  sopInstanceUid: z.string().nullable().optional(),
  frameNumber: z.number().nullable().optional(),
  seriesDescription: z.string().nullable().optional(),
  caption: z.string().optional(),
});
export type SelectedKeyImageRef = z.infer<typeof SelectedKeyImageRefSchema>;

/** Display-only provenance attached outside clinical Findings/Impression text. */
export const ComposerEvidenceProvenanceSchema = z.object({
  aiMode: ComposerAiModeSchema.optional(),
  model: z.string().optional(),
  /** Provider that produced the draft: ollama | deepseek | openai | deterministic */
  provider: z.string().optional(),
  fallbackUsed: z.boolean().optional(),
  personaVersion: z.string().optional(),
  selectedKeyImageIds: z.array(z.number()).optional(),
  imagesLoaded: z.number().optional(),
  linkedObservationIds: z.array(z.string()).optional(),
  degradedReason: z.string().nullable().optional(),
});
export type ComposerEvidenceProvenance = z.infer<typeof ComposerEvidenceProvenanceSchema>;

export const ComposerInputSnapshotSchema = z.object({
  studyId: z.number().nullable().optional(),
  worklistId: z.number().nullable().optional(),
  reportId: z.number().nullable().optional(),
  modality: z.string().optional(),
  /** Primary reporting region. Mirrors ReportingStudyContext.region. */
  region: z.string().optional(),
  /** All selected reporting regions (multi-select, primary first). Mirrors
   * ReportingStudyContext.regions. Optional for backward compatibility —
   * old snapshots without it still parse. */
  regions: z.array(z.string()).optional(),
  /** Structured-template bodyPart code (BRAIN, SPINE_CERVICAL, …). */
  bodyPart: z.string().optional(),
  /** Reporting family ("brain"|"spine"|"chest"|"abdomen"|"unknown"). */
  family: z.string().optional(),
  /** Spine segment ("cervical"|"dorsal"|"lumbar"|"whole"|"generic"). */
  spineSegment: z.string().optional(),
  /** DICOM / worklist StudyDescription — descriptive provenance only. */
  studyType: z.string().optional(),
  /** Resolved protocol / sub-technique name. Source: ReportingStudyContext.protocolName. */
  protocol: z.string().optional(),
  /** Resolved printed report heading (NOT library/display format name).
   * Source: resolvePrintedReportTitle(appliedFormatReportTitle, fallback). */
  reportTitle: z.string().optional(),
  clinicalHistory: z.string().default(""),
  technique: z.string().default(""),
  findings: z.string().default(""),
  impression: z.string().default(""),
  recommendation: z.string().default(""),
  observations: z.array(ComposeObservationSchema).default([]),
  templateSections: z.array(z.string()).optional().default([]),
  fieldProvenanceSummary: z
    .object({
      findings: z.record(z.string(), z.array(z.string())).optional(),
      impression: z.record(z.string(), z.array(z.string())).optional(),
      recommendation: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
  /** Client-declared revision metadata — verified server-side against snapshot hashes. */
  clientRevisionHint: z.string().optional(),
  persistedReportStatus: z.string().optional(),
  selectionText: z.string().optional(),
  selectionField: z.enum(["FINDINGS", "IMPRESSION", "RECOMMENDATION"]).optional(),
  instruction: z.string().optional(),
  targetLanguage: z.string().optional(),
  jobKindHint: z.string().optional(),
  /**
   * AI drafting mode. Optional for backward compatibility — absent/undefined
   * means TEXT_ONLY (existing behaviour). SELECTED_IMAGES requires
   * selectedKeyImages and a vision-capable local model.
   */
  aiMode: ComposerAiModeSchema.optional(),
  /**
   * Radiologist-selected frozen key-image refs (IDs + safe metadata only).
   * Never base64. Optional — old snapshots without this field still parse.
   */
  selectedKeyImages: z.array(SelectedKeyImageRefSchema).optional(),
});

export function parseComposerSnapshot(
  input: z.input<typeof ComposerInputSnapshotSchema>,
): ComposerInputSnapshot {
  return ComposerInputSnapshotSchema.parse(input);
}

export type ComposerInputSnapshot = z.infer<typeof ComposerInputSnapshotSchema>;

export const TrackedChangeReviewStates = ["PENDING", "ACCEPTED", "REJECTED", "EDITED"] as const;
export type TrackedChangeReviewState = (typeof TrackedChangeReviewStates)[number];

export const TrackedChangeTypes = [
  "ADD",
  "REPLACE",
  "DELETE",
  "REPHRASE",
  "TRANSLATE",
  "ENHANCE",
] as const;
export type TrackedChangeType = (typeof TrackedChangeTypes)[number];

export const TrackedChangeSchema = z.object({
  id: z.string(),
  source: z.literal("AI_COMPOSER"),
  changeType: z.enum(TrackedChangeTypes),
  field: z.enum(["FINDINGS", "IMPRESSION", "RECOMMENDATION"]),
  originalText: z.string(),
  proposedText: z.string(),
  reviewState: z.enum(TrackedChangeReviewStates).default("PENDING"),
  clinicalSignificance: z.boolean().default(false),
  clinicalSignificanceReasons: z.array(z.string()).default([]),
  reason: z.string().optional(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  rejectedAt: z.string().nullable().optional(),
  jobId: z.number().optional(),
  model: z.string().optional(),
});

export type TrackedChange = z.infer<typeof TrackedChangeSchema>;

/** Structured composer model output — validated before READY. */
export const ComposerDraftOutputSchema = z.object({
  findings: z.string().default(""),
  impression: z.string().default(""),
  recommendation: z.string().default(""),
  unresolvedQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ComposerDraftOutput = z.infer<typeof ComposerDraftOutputSchema>;

export function parseComposerDraftJson(raw: string): ComposerDraftOutput | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = ComposerDraftOutputSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
