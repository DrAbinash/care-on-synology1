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
  /** Numeric measurement recorded with the observation (e.g. AP canal diameter).
   * Clinical CONTENT, so it participates in `inputHash`, but it is deliberately
   * NOT part of observation identity — the same slot keeps one active row whether
   * or not a value is present. Mirrored by the client adapter. */
  measurement: z.string().nullable().optional(),
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
 * A SECOND report supplied for `COMBINE` — "combine the cervical and lumbar
 * findings", "add the supplied whole-spine screening report".
 *
 * It is context, not an override: the study's own Findings/Impression stay
 * authoritative and this text is merged into them by the model, under the same
 * conservation rule that forbids losing anything from either side. The calling
 * application is what established that these reports belong to the same patient
 * and study; CARE does not guess from names or dates, and nothing here accepts a
 * patient identifier — the composer is addressed by worklist/report identity.
 */
export const ComposerReportSourceSchema = z.object({
  label: z.string().max(200).optional(),
  modality: z.string().max(16).optional(),
  region: z.string().max(120).optional(),
  findings: z.string().default(""),
  impression: z.string().default(""),
});
export type ComposerReportSource = z.infer<typeof ComposerReportSourceSchema>;

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
  personaVersion: z.string().nullish(),
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
  /**
   * Second report(s) supplied for a `COMBINE` job. Optional, so every snapshot
   * written before it still parses AND every snapshot without it hashes exactly
   * as it did before — see `computeSnapshotHashes`, which only extends the
   * canonical string when this list is non-empty.
   */
  additionalReports: z.array(ComposerReportSourceSchema).optional(),
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
  /**
   * Session-only provider override for this draft (workspace A/B selector).
   * Does NOT mutate clinic AI Settings / Model Routing.
   * Excluded from clinical freshness hashes.
   */
  sessionProvider: z.string().optional(),
  /** Session-only model override paired with sessionProvider. */
  sessionModel: z.string().optional(),
});

export function parseComposerSnapshot(
  input: z.input<typeof ComposerInputSnapshotSchema>,
): ComposerInputSnapshot {
  return ComposerInputSnapshotSchema.parse(input);
}

export type ComposerInputSnapshot = z.infer<typeof ComposerInputSnapshotSchema>;

/**
 * The task kinds whose contract is PRESERVE: the radiologist's own text is the
 * clinical truth and the answer must contain all of it — better written, shorter,
 * or merged with a supplied second report, but never missing a finding.
 *
 * `FULL_REPORT` and `IMPRESSION` are deliberately NOT here: they DRAFT from
 * observations and may legitimately restructure what they were given.
 *
 * Lives in this pure module because both the prompt builder and the validator
 * need the same answer. Two lists of these kinds is exactly how CARE ended up
 * telling two different stories about one model.
 */
export const PRESERVING_COMPOSE_KINDS = [
  "PROFESSIONALIZE",
  "COMBINE",
  "REPHRASE",
  "SHORTEN",
  "EXPAND",
  "SECTION_EDIT",
  "SELECTION_EDIT",
  "TRANSLATE",
] as const;

export type PreservingComposeKind = (typeof PRESERVING_COMPOSE_KINDS)[number];

export function isPreservingComposeKind(kind: string | null | undefined): boolean {
  return (PRESERVING_COMPOSE_KINDS as readonly string[]).includes(kind ?? "");
}

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

/**
 * One structured observation proposed from dictated text (Operation 1).
 *
 * Field-for-field this is `ComposeObservation` minus the bookkeeping keys,
 * because the proposal has to be insertable into the deterministic Composer's
 * canonical observation ledger without a translation layer. `source` is fixed to
 * "structured" by the caller that inserts it — CARE does not decide on the
 * radiologist's behalf which slot the finding ends up in.
 */
export const ProposedObservationSchema = z.object({
  concept: z.string().min(1),
  region: z.string().nullish(),
  level: z.string().nullish(),
  severity: z.string().nullish(),
  laterality: z.string().nullish(),
  measurement: z.string().nullish(),
  findingsText: z.string().min(1),
  impressionText: z.string().nullish(),
  recommendationText: z.string().nullish(),
  /** Verbatim fragment of the dictation this row came from. */
  sourceText: z.string().nullish(),
});
export type ProposedObservation = z.infer<typeof ProposedObservationSchema>;

/** Structured composer model output — validated before READY. */
export const ComposerDraftOutputSchema = z.object({
  findings: z.string().default(""),
  impression: z.string().default(""),
  recommendation: z.string().default(""),
  unresolvedQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  /**
   * Present for the `OBSERVATIONS` task (dictated text → structured rows).
   * Absent for every report-text task, so no existing consumer changes.
   *
   * It travels here rather than in a new table or a new endpoint because this
   * object is already persisted (`output_plan_json`), already returned to the
   * workspace (`draft` on the job view), and already the thing the acceptance
   * boundary refuses to apply unseen. A proposal the radiologist has not looked
   * at cannot reach a report.
   */
  observations: z.array(ProposedObservationSchema).optional(),
});

export type ComposerDraftOutput = z.infer<typeof ComposerDraftOutputSchema>;

/**
 * Models put the printer's own markers into their prose. Seen in real output from
 * this composer path (2026-10-11, gemma3:12b): `**Findings:**` for emphasis, a
 * label-only line copied out of the context block, and a whole line beginning
 * `TECHNIQUE:` repeated from the protected technique field.
 *
 * All three reach the patient's report as structure, not as text: the print
 * surface would honour the asterisks, a `Findings:` line prints a nested FINDINGS
 * heading, and an echoed technique duplicates a section the radiologist already
 * owns. So the contract strips them here — one owner, every provider, before
 * validation — and the two cases are handled differently on purpose:
 *
 *   TECHNIQUE / CLINICAL HISTORY / COMPARISON → the line goes. That content has
 *     its own protected field and its own printed section; a copy inside Findings
 *     is a duplicate, and dropping it loses nothing.
 *   FINDINGS / IMPRESSION / RECOMMENDATION    → only the label goes, the sentence
 *     stays. Deleting the sentence could delete a finding, which is never safe.
 *
 * No clinical wording is rewritten; only markup and echoed section labels move.
 */
const EMPHASIS_RE = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
const OWN_SECTION_LINE_RE = /^\s*(?:TECHNIQUE|CLINICAL\s+HISTORY|COMPARISON)\s*(?::|$)/i;
const FIELD_LABEL_ONLY_RE = /^\s*(?:FINDINGS|IMPRESSION|RECOMMENDATION)\s*:?\s*$/i;
const FIELD_LABEL_PREFIX_RE = /^\s*(?:FINDINGS|IMPRESSION|RECOMMENDATION)\s*:\s+/i;

export function normalizeComposerDraftText(text: string): string {
  const unemphasised = (text ?? "").replace(EMPHASIS_RE, (_m, a, b) => String(a ?? b ?? ""));
  const kept = unemphasised
    .split("\n")
    .filter((line) => !OWN_SECTION_LINE_RE.test(line) && !FIELD_LABEL_ONLY_RE.test(line))
    .map((line) => line.replace(FIELD_LABEL_PREFIX_RE, ""));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A proposed observation row is prose destined for the canonical ledger, so it
 * crosses the same printer-safe boundary as the three narrative fields. Without
 * this a `**Diffuse** disc bulge at L4-5.` survives into a stored observation and
 * the radiologist reviews markers the report cannot carry.
 */
function normalizeProposedObservation(o: ProposedObservation): ProposedObservation {
  return {
    ...o,
    findingsText: normalizeComposerDraftText(o.findingsText),
    ...(o.impressionText !== undefined && o.impressionText !== null
      ? { impressionText: normalizeComposerDraftText(o.impressionText) }
      : {}),
  };
}

export function parseComposerDraftJson(raw: string): ComposerDraftOutput | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = ComposerDraftOutputSchema.safeParse(parsed);
    if (!result.success) return null;
    const draft = result.data;
    return {
      ...draft,
      findings: normalizeComposerDraftText(draft.findings),
      impression: normalizeComposerDraftText(draft.impression),
      recommendation: normalizeComposerDraftText(draft.recommendation),
      ...(draft.observations ? { observations: draft.observations.map(normalizeProposedObservation) } : {}),
    };
  } catch {
    return null;
  }
}
