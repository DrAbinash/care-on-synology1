/**
 * Shared types for Background AI Report Composer.
 * Tracked changes are DATA (not HTML). Review colors are render-time only.
 */
import { z } from "zod";

export const ComposeObservationSchema = z.object({
  id: z.string().optional(),
  concept: z.string().min(1),
  source: z.enum([
    "quick-select", "quick-findings", "macro", "manual", "voice", "structured",
    "normal-template", "ai-draft",
  ]).optional(),
  /** What this row claims to be. Mirrors CARE's `ObservationRole` in the
   * workspace ledger and is the signal the client has carried since the format
   * baseline was written (`fullReportBaseline.ts`): `"baseline"` and
   * `"screening"` are scaffold statements a Complete-Normal format auto-inserted,
   * NOT findings anyone has confirmed about this patient. Excluded from
   * `canonicalObservationHashPayload` — provenance is not clinical content, so
   * classifying a row correctly must never invalidate a frozen AI input. */
  role: z.enum(["finding", "impression", "recommendation", "baseline", "screening"]).optional(),
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

/**
 * Does this row assert a patient finding, or is it unreviewed scaffolding?
 *
 * A normal template is a starting document, not evidence that the anatomy was
 * reviewed. The ledger has always known the difference (`role: "baseline"` /
 * `"screening"`, `source: "template" | "system" | "quick-normal"`); the composer
 * contract used to lose it, which put twelve auto-inserted normals in front of
 * the model under "canonical clinical truth".
 *
 * One rule, two mirrors — the client exports the same predicate from
 * `reportComposer/composeObservations.ts`, and
 * `normalTemplateProvenance.test.ts` pins them against each other row by row.
 */
export function isProvisionalNormalTemplate(o: ComposeObservation): boolean {
  return o.role === "baseline" || o.role === "screening" || o.source === "normal-template";
}

/** Conservative max selected key images for SELECTED_IMAGES compose mode. */
export const COMPOSER_MAX_SELECTED_KEY_IMAGES = 4;

export const ComposerAiModeSchema = z.enum(["TEXT_ONLY", "SELECTED_IMAGES"]);
export type ComposerAiMode = z.infer<typeof ComposerAiModeSchema>;

/**
 * A SECOND report supplied for `COMBINE` — "combine the cervical and lumbar
 * findings", "add the whole-spine screening report that is already signed".
 *
 * It is context, not an override: the study's own Findings/Impression stay
 * authoritative and this text is merged into them by the model, under the same
 * conservation rule that forbids losing anything from either side.
 *
 * WHOSE REPORT IT IS IS A SERVER QUESTION. `worklistId` / `reportId` name a CARE
 * study and are resolved against `radiology_worklist` / `patient_reports` before
 * any AI is contacted (`verifyComposeSourceIdentities`, composeIdentity.ts); a
 * source that names nothing, names a row that is gone, names rows that disagree,
 * or belongs to a different patient than the study being reported is refused.
 * `label` is a caption for the clinician's own benefit and proves nothing — no
 * part of CARE's identity check reads a name, a date or this string.
 *
 * `studyInstanceUid` is an optional cross-check: when both the caller and the
 * row state a UID they must agree. The value that gets recorded and returned is
 * the row's, never the caller's.
 */
export const ComposerReportSourceSchema = z.object({
  label: z.string().max(200).optional(),
  modality: z.string().max(16).optional(),
  region: z.string().max(120).optional(),
  /** radiology_worklist.id — the anchor every other CARE radiology path uses. */
  worklistId: z.number().int().positive().nullish(),
  /** patient_reports.id, for a source that is a report of record. */
  reportId: z.number().int().positive().nullish(),
  studyInstanceUid: z.string().max(128).nullish(),
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

/**
 * The three words a compose request may use to ask for reference knowledge (the clinic's own
 * radiology documents, retrieved into the prompt) for THIS job only: `on`, `off`, `default`.
 * `default` — and an absent field, which reads the same way — is what every job has always done:
 * the single clinic-wide `ff_radiology_ai_rag` row decides.
 *
 * Declared above the provenance contract because the contract names it, and in this module rather
 * than in the retriever because the route, the queue and the worker all have to spell the same
 * three words the same way. See `resolveRagOverride` for the whole story.
 */
export const RAG_OVERRIDE_VALUES = ["on", "off", "default"] as const;
export type RagOverride = (typeof RAG_OVERRIDE_VALUES)[number];

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
  /**
   * One entry per image actually loaded, from `source_type`. Stored so an audit
   * reader can see WHAT was put in front of the model (a viewport capture and an
   * uploaded phantom are not the same risk) without the row holding a single pixel.
   */
  imageSourceTypes: z.array(z.string()).optional(),
  /**
   * Where the request actually went, as the adapter reported it: `local` | `cloud`
   * | null when no socket was opened. Named for the SEND, not for the setting the
   * operator believed in, because the audit row is evidence about what happened.
   */
  executedLocality: z.enum(["local", "cloud"]).nullable().optional(),
  /** The endpoint address the run addressed, when one was resolved. */
  resolvedEndpoint: z.string().nullable().optional(),
  degradedReason: z.string().nullable().optional(),
  /**
   * One entry per reference-knowledge section that was actually put in front of the model, with the
   * SHA256 of the document it was cut from. Recorded so "why is this draft worded like that" is
   * answerable from the job row rather than from a log line that has rotated away, and so a later
   * edit of the clinic's document is distinguishable from the run that quoted the older text.
   * Empty when `ff_radiology_ai_rag` is off or nothing was retrieved; `referenceKnowledgeNote` says
   * which, and is recorded on every text run.
   */
  referenceKnowledge: z
    .array(
      z.object({
        /** `mri-brain-v1.md#58` — the address used in the prompt itself. */
        address: z.string(),
        file: z.string(),
        id: z.number(),
        /** The section heading, e.g. `DIAGNOSTIC SYNTHESIS`. Displayed to the reviewing radiologist. */
        title: z.string().optional(),
        /** SHA256 of the whole document, as the clinic's `SHA256SUMS` stamps it. */
        version: z.string(),
        chars: z.number(),
      }),
    )
    .optional(),
  /** One line saying what reference knowledge did — how many sections, or why none. */
  referenceKnowledgeNote: z.string().optional(),
  /**
   * PER-JOB REFERENCE-KNOWLEDGE OVERRIDE — recorded only on the jobs that asked for one, so every
   * other job's row keeps exactly the shape it had before this field existed (see
   * `RAG_OVERRIDE_VALUES`). The four keys are read together:
   *
   *  - `referenceKnowledgeEffective`: what this run actually did. `on` / `off` only when the
   *    override took effect; `default` when the clinic-wide `ff_radiology_ai_rag` row decided.
   *  - `ragOverrideRequested`: the operator's words, verbatim and trimmed, or null.
   *  - `ragOverrideApplied`: whether that request is what happened.
   *  - `ragOverrideIgnoredReason`: and if it was not, why not — so an ignored request is a fact in
   *    the row, not a rumour in a log line.
   */
  referenceKnowledgeEffective: z.enum(RAG_OVERRIDE_VALUES).optional(),
  ragOverrideRequested: z.string().nullable().optional(),
  ragOverrideApplied: z.boolean().optional(),
  ragOverrideIgnoredReason: z.string().nullable().optional(),
});
export type ComposerEvidenceProvenance = z.infer<typeof ComposerEvidenceProvenanceSchema>;

/**
 * ─── PER-JOB REFERENCE-KNOWLEDGE (RAG) OVERRIDE ──────────────────────────────
 *
 * WHAT IT IS FOR
 * Reference knowledge — sections from the clinic's own radiology documents, put in front of the
 * model inside the Composer's existing context budget — has one switch for the whole clinic,
 * `ff_radiology_ai_rag` (`knowledgeRetrieval.ts:34`, seeded enabled by owner decision 2026-11-03).
 * A radiologist who wants to see what ONE report looks like without it currently has to change
 * what every other workstation does. These are the three words that request is allowed to use:
 * `on`, `off`, and `default` (= absent = the clinic-wide flag decides, exactly as today).
 *
 * WHY IT LIVES IN THIS PURE MODULE
 * The decision needs the staff session, and the run needs the decision — but the run happens in a
 * background worker, and a second door (`POST /jobs/:id/process-now`) can reach the same job with
 * no session on it at all. So the answer is computed ONCE at the HTTP boundary by
 * `resolveRagOverride`, carried through the job row as the envelope below, and never recomputed
 * downstream. Two places re-deriving "was this caller allowed" is how one job comes to mean two
 * things.
 *
 * NOTHING HERE WRITES THE FLAG. It is a read-only exception for one job.
 */
export type RagOverrideContract = {
  /** What the request said, trimmed and lower-cased, or null when it said nothing at all. */
  requested: string | null;
  /** What the run will do. `on`/`off` only when `honoured`; otherwise `default`. */
  effective: RagOverride;
  /** A valid non-`default` request AND an authorized caller. */
  honoured: boolean;
  /** Why an honoured run did not happen. null when nothing was ignored. */
  ignoredReason: "unrecognized" | "not authorized" | null;
  /**
   * Whether this job has anything worth recording. False for "absent" and for an explicit
   * "default", which is what keeps a normal job byte-identical to the one #1261 shipped.
   */
  needsRecording: boolean;
};

/** A requested value never gets longer than this in a row someone has to read. */
const RAG_OVERRIDE_REQUESTED_MAX_CHARS = 32;

/**
 * The one place `on` / `off` / `default` is interpreted, so the route, the queue and the worker
 * cannot drift. An unrecognized or absent value is `default` — never an error: this field is an
 * experimental control, and a clinical request must not fail because of it.
 */
export function resolveRagOverride(raw: unknown, authorized: boolean): RagOverrideContract {
  if (typeof raw !== "string") {
    return { requested: null, effective: "default", honoured: false, ignoredReason: null, needsRecording: false };
  }
  const value = raw.trim().toLowerCase();
  if (value === "") {
    return { requested: null, effective: "default", honoured: false, ignoredReason: null, needsRecording: false };
  }
  const requested = value.slice(0, RAG_OVERRIDE_REQUESTED_MAX_CHARS);
  if (value === "default") {
    return { requested, effective: "default", honoured: false, ignoredReason: null, needsRecording: false };
  }
  if (value !== "on" && value !== "off") {
    // Recorded, because "someone asked for this and CARE said no" is the audit question.
    return { requested, effective: "default", honoured: false, ignoredReason: "unrecognized", needsRecording: true };
  }
  if (!authorized) {
    return { requested, effective: "default", honoured: false, ignoredReason: "not authorized", needsRecording: true };
  }
  return { requested, effective: value, honoured: true, ignoredReason: null, needsRecording: true };
}

/**
 * The envelope key inside the job's existing `validation_json` column, which becomes
 * `job.validation` in the API view. Deliberately not a column: the composer already keeps
 * run metadata in this JSON (`provenance`, `provider`, `usage`, `sourceIdentities` — see
 * `jobService.ts`'s READY write) precisely because the table has no columns for the run's own
 * account of itself. Adding one for a per-job experimental switch would be a migration for a
 * measurement seam.
 */
export const RAG_OVERRIDE_ENVELOPE_KEY = "ragOverride";

/**
 * The contract as text for the row, or null when there is nothing to record.
 * `needsRecording` is the ONLY gate here, so a job that never asked gains no key at all.
 */
export function encodeRagOverrideEnvelope(c: RagOverrideContract | null | undefined): string | null {
  if (!c || !c.needsRecording) return null;
  return JSON.stringify({ [RAG_OVERRIDE_ENVELOPE_KEY]: c });
}

/**
 * Read the envelope back, from anything the column currently holds.
 *
 * Total by design: a null column, a row written before this field existed, a truncated string, or a
 * settled row whose column now carries the validation result all answer null. The compose path has
 * to survive all four, because the alternative is a clinical request that fails over an
 * experimental field.
 */
export function decodeRagOverrideEnvelope(
  validationJson: string | null | undefined,
): RagOverrideContract | null {
  if (!validationJson) return null;
  try {
    const parsed: unknown = JSON.parse(validationJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = (parsed as Record<string, unknown>)[RAG_OVERRIDE_ENVELOPE_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const effective = r.effective;
    if (effective !== "on" && effective !== "off" && effective !== "default") return null;
    const reason = r.ignoredReason;
    return {
      requested: typeof r.requested === "string" ? r.requested : null,
      effective,
      honoured: r.honoured === true,
      ignoredReason: reason === "unrecognized" || reason === "not authorized" ? reason : null,
      // Recomputed rather than trusted from the row: the envelope decides what is READ, and a
      // hand-edited or stale `needsRecording` must not change a run.
      needsRecording: true,
    };
  } catch {
    return null;
  }
}

/**
 * Rewrite the run's own account of itself into `validation_json` WITHOUT discarding the
 * per-job reference-knowledge decision the request wrote there.
 *
 * The envelope is the only record that an override was asked for, honoured, or ignored, and
 * both settling writes replaced the column wholesale: a job that finished, failed, or was
 * retried kept its answer and lost the reason it was composed that way. So the A/B trial
 * could not be read back from the row it ran on — the exact audit question the field exists
 * to answer (`not authorized` on a job that ran with reference knowledge, for instance).
 *
 * A row with no envelope produces byte-identical output to the old inline
 * `JSON.stringify(…)`, including the `null` for a falsy or absent validation result, so
 * every job that never asked for an override is untouched.
 */
export function withRagEnvelope(
  currentValidationJson: string | null | undefined,
  nextValidation: unknown,
): string | null {
  const envelope = decodeRagOverrideEnvelope(currentValidationJson);
  if (!envelope) return nextValidation ? JSON.stringify(nextValidation) : null;
  const base = typeof nextValidation === "object" && nextValidation !== null && !Array.isArray(nextValidation)
    ? nextValidation as Record<string, unknown>
    : {};
  return JSON.stringify({ ...base, [RAG_OVERRIDE_ENVELOPE_KEY]: envelope });
}

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
