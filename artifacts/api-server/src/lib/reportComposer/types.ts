/**
 * Shared types for Background AI Report Composer.
 * Tracked changes are DATA (not HTML). Review colors are render-time only.
 */
import { z } from "zod";

export const ComposeObservationSchema = z.object({
  id: z.string().optional(),
  concept: z.string().min(1),
  source: z.enum(["quick-select", "quick-findings", "macro", "manual", "voice", "structured"]).optional(),
  level: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  laterality: z.string().nullable().optional(),
  findingsText: z.string().min(1),
  impressionText: z.string().optional(),
  anatomicalSection: z.string().optional(),
  conflictGroup: z.string().optional(),
  baselineReplaces: z.string().optional(),
});

export type ComposeObservation = z.infer<typeof ComposeObservationSchema>;

export const ComposerInputSnapshotSchema = z.object({
  studyId: z.number().nullable().optional(),
  worklistId: z.number().nullable().optional(),
  reportId: z.number().nullable().optional(),
  modality: z.string().optional(),
  region: z.string().optional(),
  studyType: z.string().optional(),
  protocol: z.string().optional(),
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
});

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
