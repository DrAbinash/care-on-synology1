/**
 * Client-side snapshot hashing — must match server computeSnapshotHashes.
 * Model B: frozen snapshot is the composition input.
 */
export type ComposeObservation = {
  id?: string;
  concept: string;
  source?: "quick-select" | "quick-findings" | "macro" | "manual" | "voice" | "structured";
  /** Canonical reporting region (e.g. "LS Spine", "Brain"). Carried into the
   * composer API so client + server share a single canonical identity
   * (region|concept|level|laterality) for dedupe + snapshot hashing. Optional
   * for backward compatibility — old snapshots without it still parse. */
  region?: string | null;
  level?: string | null;
  severity?: string | null;
  laterality?: string | null;
  /** Numeric measurement recorded with the observation (e.g. AP canal diameter).
   * Clinical content — mirrored by the server in both the composer prompt and
   * `inputHash` — but NOT part of observation identity. */
  measurement?: string | null;
  findingsText: string;
  impressionText?: string;
  /** Optional radiologist-supplied recommendation contribution for this observation. */
  recommendationText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
};

/**
 * A second report for a `COMBINE` job. Mirrors the server's
 * `ComposerReportSourceSchema`.
 *
 * At least one of `worklistId` / `reportId` is REQUIRED by the server for a real
 * job (`verifyComposeSourceIdentities`): each source must name a CARE study, and
 * CARE resolves it and proves it belongs to the same patient as the study being
 * reported. Type them optional here because a source that names nothing is a
 * legitimate thing for the UI to be holding while the clinician is still picking
 * it — the refusal is the server's, and it arrives as one sentence to show.
 * `label` is a caption for the clinician and proves nothing about identity.
 */
export type ComposerReportSource = {
  label?: string;
  modality?: string;
  region?: string;
  /** radiology_worklist.id of the study the merged report came from. */
  worklistId?: number | null;
  /** patient_reports.id, for a source that is a report of record. */
  reportId?: number | null;
  /** Optional cross-check; CARE records the row's UID, not this one. */
  studyInstanceUid?: string | null;
  findings?: string;
  impression?: string;
};

export type ComposerInputSnapshot = {
  studyId?: number | null;
  worklistId?: number | null;
  reportId?: number | null;
  modality?: string;
  /** Primary reporting region (e.g. "LS Spine", "Brain"). Mirrors
   * `ReportingStudyContext.region`. */
  region?: string;
  /** All selected reporting regions (multi-select, primary first). Mirrors
   * `ReportingStudyContext.regions`. Carries screening context (e.g.
   * ["LS Spine", "Whole Spine Screening"]). Optional for backward
   * compatibility — old snapshots without it still parse. */
  regions?: string[];
  /** Structured-template bodyPart code (BRAIN, SPINE_CERVICAL, …). Mirrors
   * `ReportingStudyContext.bodyPart`. */
  bodyPart?: string;
  /** Reporting family ("brain" | "spine" | "chest" | "abdomen" | "unknown").
   * Mirrors `ReportingStudyContext.family`. */
  family?: string;
  /** Spine segment ("cervical" | "dorsal" | "lumbar" | "whole" | "generic" | null).
   * Mirrors `ReportingStudyContext.spineSegment`. */
  spineSegment?: string;
  /** DICOM / worklist StudyDescription — descriptive provenance only. Never
   * overrides resolved `region`/`family`/`bodyPart`/`protocol`. */
  studyType?: string;
  /** Resolved protocol / sub-technique name (e.g. "Plain", "Epilepsy Protocol").
   * Source precedence: `ReportingStudyContext.protocolName` (which is
   * `activeProtocol?.name`). Never inferred from StudyDescription. */
  protocol?: string;
  /** Resolved printed report heading (NOT the library/display format name).
   * Source: `resolvePrintedReportTitle(appliedFormatReportTitle, fallback)`. */
  reportTitle?: string;
  clinicalHistory?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  recommendation?: string;
  observations?: ComposeObservation[];
  templateSections?: string[];
  fieldProvenanceSummary?: {
    findings?: Record<string, string[]>;
    impression?: Record<string, string[]>;
    recommendation?: Record<string, string[]>;
  };
  clientRevisionHint?: string;
  selectionText?: string;
  selectionField?: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION";
  instruction?: string;
  /**
   * Second report(s) supplied for a COMBINE job. Mirrors the server's
   * `ComposerInputSnapshotSchema.additionalReports`. Optional, and the hash
   * canon is only extended when this is non-empty, so a snapshot without it
   * keeps exactly the hashes it had before the field existed.
   */
  additionalReports?: ComposerReportSource[];
  targetLanguage?: string;
  jobKindHint?: string;
  /** AI drafting mode. Absent/undefined = TEXT_ONLY (backward compatible). */
  aiMode?: "TEXT_ONLY" | "SELECTED_IMAGES";
  /**
   * Radiologist-selected frozen key-image refs (IDs + safe metadata only).
   * Never base64 / blob URLs. Optional — old snapshots without this still parse.
   */
  selectedKeyImages?: Array<{
    keyImageId: number;
    observationId?: string | null;
    seriesInstanceUid?: string | null;
    sopInstanceUid?: string | null;
    frameNumber?: number | null;
    seriesDescription?: string | null;
    caption?: string;
  }>;
  /**
   * Session-only provider override for this draft (workspace A/B).
   * Not part of clinical freshness hashes. Does not mutate global Settings.
   */
  sessionProvider?: string;
  sessionModel?: string;
};

export const COMPOSER_MAX_SELECTED_KEY_IMAGES = 4;

/**
 * The `inputHash` fields that describe the REQUEST, not the report — the
 * radiologist's own instruction, the text they had selected, the template
 * sections and any reports they supplied for a combination. Server mirror:
 * `api-server/src/lib/reportComposer/snapshot.ts` `REQUEST_SCOPE_FIELDS`.
 *
 * The tab cannot recompute these after it has moved on: the words typed into
 * the Refine box and the selection made in the editor are gone, while
 * `inputHash` still covers them. Hashing the live report without them produces
 * a different value than the one frozen at enqueue, for a report nobody changed
 * — which is why every Refine draft used to arrive already flagged STALE. The
 * job view carries them back (`ComposeJobView.requestScope`), and
 * `liveComposeSnapshot` folds them into the recomputation so the tab hashes the
 * snapshot the model was actually shown.
 */
export type ComposerRequestScope = {
  selectionText?: string;
  instruction?: string;
  templateSections?: string[];
  additionalReports?: ComposerReportSource[];
};

/**
 * The live AI input as this tab can recompute it, plus the request-scoped half
 * only the job itself remembers. Both freshness call sites — the READY poll and
 * the pre-Apply re-check — hash THIS and nothing else, so they cannot drift
 * apart from `buildSnapshot()` field by field again.
 */
export function liveComposeSnapshot(
  live: ComposerInputSnapshot,
  requestScope?: ComposerRequestScope | null,
): ComposerInputSnapshot {
  return { ...live, ...(requestScope ?? {}) };
}

export type TrackedChange = {
  id: string;
  source: "AI_COMPOSER";
  changeType: "ADD" | "REPLACE" | "DELETE" | "REPHRASE" | "TRANSLATE" | "ENHANCE";
  field: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION";
  originalText: string;
  proposedText: string;
  reviewState: "PENDING" | "ACCEPTED" | "REJECTED" | "EDITED";
  clinicalSignificance: boolean;
  clinicalSignificanceReasons: string[];
  reason?: string;
  createdAt: string;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  jobId?: number;
  model?: string;
};

/**
 * One structured observation the assistant is PROPOSING (Operation 1). Server
 * mirror: `api-server/src/lib/reportComposer/types.ts` `ProposedObservationSchema`.
 * It is a proposal for the canonical finding ledger, never report text — an
 * OBSERVATIONS job has no Apply path, and inserting a row is the workspace's own
 * audited mutation.
 */
export type ProposedObservation = {
  concept: string;
  region?: string | null;
  level?: string | null;
  severity?: string | null;
  laterality?: string | null;
  measurement?: string | null;
  findingsText: string;
  impressionText?: string | null;
  recommendationText?: string | null;
  /** Verbatim fragment of the dictation this row came from. */
  sourceText?: string | null;
};

export type ComposeJobView = {
  id: number;
  studyId: number | null;
  worklistId: number | null;
  reportId: number | null;
  jobKind: string;
  status: string;
  sourceReportRevision: string;
  sourceFindingsHash: string;
  sourceImpressionHash: string;
  sourceRecommendationHash: string;
  inputHash: string;
  /** The frozen request-scoped fields this tab no longer holds. Needed to
   * re-hash the job's own `inputHash` — see `liveComposeSnapshot`. */
  requestScope?: ComposerRequestScope | null;
  proposedFindings: string | null;
  proposedImpression: string | null;
  proposedRecommendation: string | null;
  trackedChanges: TrackedChange[];
  draft: {
    findings?: string;
    impression?: string;
    recommendation?: string;
    unresolvedQuestions?: string[];
    /** Operation 1's answer. Present on an OBSERVATIONS job, absent otherwise. */
    observations?: ProposedObservation[];
  } | null;
  validation: unknown;
  sources: Record<string, number>;
  model: string | null;
  /** Derived server-side from the job's provenance — not a column. */
  provider?: string | null;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    approximateCostUsd: number | null;
  } | null;
  fallbackUsed: boolean;
  latencyMs: number | null;
  safeError: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  createdAt: string;
  completedAt: string | null;
  appliedAt: string | null;
};

/**
 * Exported for reuse (C2): the workspace's AI-proposal fingerprint hashes the same
 * narrative text, and this is the normalisation the Composer already applies on
 * both sides of its own wire — so a trailing space or a CRLF is not a change,
 * and there is exactly one rule in the repo that says so. Semantics unchanged;
 * only the visibility moved.
 */
export function normalizeForHash(text: string): string {
  return (text ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

/** Browser-safe SHA-256 hex (first 32 chars) — mirrors server. */
export async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeForHash(text));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function dedupeObservations(obs: ComposeObservation[]): ComposeObservation[] {
  const seen = new Set<string>();
  const out: ComposeObservation[] = [];
  for (const o of obs) {
    const key = canonicalObservationKey(o);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/**
 * Canonical observation identity — MUST be mirrored verbatim by the server
 * (api-server/src/lib/reportComposer/snapshot.ts). Used for both dedupe and
 * snapshot hashing.
 *
 * Identity: region | concept | level | laterality
 *   - matches CARE's `CanonicalObservation.slotKey` (region|concept|level|laterality)
 *     for structured observations.
 *   - severity, measurement, source, conflictGroup, anatomicalSection are
 *     intentionally NOT part of identity — same-slot replacement already
 *     guarantees ≤1 active row per slot in the live ledger.
 *
 * For legacy / unstructured rows (no concept AND no region) we fall back to
 * normalized findings text so duplicate voice commits collapse, but never
 * collapse two clinically distinct observations just because their text or
 * concept matches.
 */
export function canonicalObservationKey(o: ComposeObservation): string {
  const norm = (s: string | null | undefined): string =>
    (s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().toLowerCase();
  const region = norm(o.region);
  const concept = norm(o.concept);
  const level = norm(o.level);
  const laterality = norm(o.laterality);
  if (region || concept || level || laterality) {
    return `slot::${region}|${concept}|${level}|${laterality}`;
  }
  // Legacy / unstructured — fall back to normalized findings text only.
  return `text::${norm(o.findingsText)}`;
}

/**
 * Canonical observation payload used in snapshot hashing. Includes every field
 * that materially changes the clinical meaning of an observation:
 *   region, concept, level, laterality, severity, measurement,
 *   anatomicalSection, findingsText, impressionText, recommendationText
 *
 * `id`, `source`, `conflictGroup`, `baselineReplaces` are intentionally
 * excluded — they are bookkeeping/provenance, not clinical content. Changing
 * them MUST NOT alter the snapshot hash (otherwise swapping a quick-select
 * observation for a macro observation at the same clinical slot would mark
 * the prior READY draft STALE without any actual clinical change).
 *
 * MUST be mirrored verbatim by the server (api-server snapshot.ts), including
 * field ORDER.
 */
export function canonicalObservationHashPayload(o: ComposeObservation): string {
  const norm = (s: string | null | undefined): string =>
    (s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return [
    norm(o.region),
    norm(o.concept),
    norm(o.level),
    norm(o.laterality),
    norm(o.severity),
    norm(o.measurement),
    norm(o.anatomicalSection),
    norm(o.findingsText),
    norm(o.impressionText),
    norm(o.recommendationText),
  ].join("\u001f");
}

/**
 * Canonical study-context payload used in `inputHash` (NOT `reportRevision`).
 *
 * Includes every study-context field that materially changes what study the AI
 * is composing for: modality, region, regions, bodyPart, family, spineSegment,
 * protocol, reportTitle. Changes to ANY of these fields MUST invalidate the
 * frozen AI input hash so the worker cannot re-use a stale snapshot.
 *
 * These fields are intentionally NOT part of `reportRevision`:
 *   - `reportRevision` represents the clinically EDITABLE report state
 *     (findings/impression/recommendation text + canonical observations).
 *     Changes to the editable state mark a READY draft STALE so blind-apply
 *     is blocked.
 *   - Study context (modality / region / protocol / title) is NOT something
 *     the radiologist edits inside the Findings/Impression fields — it is the
 *     STUDY IDENTITY. A change of study identity is captured by `inputHash`
 *     (which guards the frozen snapshot end-to-end), not by `reportRevision`
 *     (which guards the editable report text).
 *
 * The freshness endpoint (`POST /api/radiology/report-composer/jobs/:id/freshness`)
 * compares `reportRevision` to detect post-enqueue narrative edits; it does
 * NOT re-check study context because that is captured in the frozen
 * `inputHash` at enqueue time. This preserves Model B (frozen snapshot =
 * authoritative AI input) per Guard 8.
 *
 * MUST be mirrored verbatim by the server (api-server snapshot.ts).
 */
export function canonicalStudyContextHashPayload(s: ComposerInputSnapshot): string {
  const norm = (s2: string | null | undefined): string =>
    (s2 ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return [
    norm(s.modality),
    norm(s.region),
    (s.regions ?? []).map(norm).join(","),
    norm(s.bodyPart),
    norm(s.family),
    norm(s.spineSegment),
    norm(s.protocol),
    norm(s.reportTitle),
  ].join("\u001f");
}

/** MUST mirror server `canonicalSelectedKeyImagesHashPayload`. */
export function canonicalSelectedKeyImagesHashPayload(s: ComposerInputSnapshot): string {
  const refs = s.selectedKeyImages ?? [];
  const norm = (v: string | number | null | undefined): string =>
    String(v ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return refs
    .map((r) =>
      [
        norm(r.keyImageId),
        norm(r.observationId),
        norm(r.seriesInstanceUid),
        norm(r.sopInstanceUid),
        norm(r.frameNumber),
        norm(r.seriesDescription),
        norm(r.caption),
      ].join("\u001f"),
    )
    .join("\n");
}

/** MUST mirror server `canonicalAdditionalReportsHashPayload`. */
export function canonicalAdditionalReportsHashPayload(s: ComposerInputSnapshot): string {
  const norm = (v: string | null | undefined): string =>
    (v ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const ref = (v: number | null | undefined): string => (v == null ? "" : String(v));
  return (s.additionalReports ?? [])
    .map((r) =>
      [
        ref(r.worklistId),
        ref(r.reportId),
        norm(r.studyInstanceUid),
        norm(r.label),
        norm(r.modality),
        norm(r.region),
        norm(r.findings),
        norm(r.impression),
      ].join("\u001f"),
    )
    .join("\n");
}

export async function computeSnapshotHashes(snapshot: ComposerInputSnapshot): Promise<{
  findingsHash: string;
  impressionHash: string;
  recommendationHash: string;
  inputHash: string;
  reportRevision: string;
}> {
  const findingsHash = await hashText(snapshot.findings ?? "");
  const impressionHash = await hashText(snapshot.impression ?? "");
  const recommendationHash = await hashText(snapshot.recommendation ?? "");
  // Observations contribute their full canonical payload (region, concept,
  // level, laterality, severity, anatomicalSection, findingsText,
  // impressionText, recommendationText). Changes to ANY of those fields MUST invalidate prior
  // READY drafts — e.g. right → left laterality change with identical findings
  // text, or mild → moderate severity change with identical findings text,
  // both produce a different reportRevision so blind-apply is blocked.
  const obsCanon = dedupeObservations(snapshot.observations ?? [])
    .map((o) => canonicalObservationHashPayload(o))
    .join("\n");
  // Study context (modality/region/regions/bodyPart/family/spineSegment/
  // protocol/reportTitle) is part of `inputHash` so the frozen snapshot is
  // self-describing — but intentionally NOT part of `reportRevision` (see
  // `canonicalStudyContextHashPayload` docstring for the rationale).
  const studyCtxCanon = canonicalStudyContextHashPayload(snapshot);
  const selectedImagesCanon = canonicalSelectedKeyImagesHashPayload(snapshot);
  const additionalReports = snapshot.additionalReports ?? [];
  const inputHash = await hashText(
    [
      snapshot.jobKindHint ?? "",
      studyCtxCanon,
      snapshot.clinicalHistory ?? "",
      snapshot.technique ?? "",
      snapshot.findings ?? "",
      snapshot.impression ?? "",
      snapshot.recommendation ?? "",
      obsCanon,
      snapshot.selectionText ?? "",
      snapshot.instruction ?? "",
      (snapshot.templateSections ?? []).join(","),
      snapshot.aiMode ?? "TEXT_ONLY",
      selectedImagesCanon,
      // Appended only when non-empty, exactly as the server does — an unchanged
      // array keeps every pre-existing snapshot's `inputHash` byte-identical.
      ...(additionalReports.length ? [canonicalAdditionalReportsHashPayload(snapshot)] : []),
    ].join("\u001e"),
  );
  const reportRevision = await hashText(`${findingsHash}:${impressionHash}:${recommendationHash}:${obsCanon}`);
  return { findingsHash, impressionHash, recommendationHash, inputHash, reportRevision };
}

/**
 * The persistence tag an Apply sends with its save (PROMPT 4).
 *
 * `previous` is the narrative this editor is replacing — the text it showed
 * before the accepted AI sentences went in. The server treats it as a candidate,
 * never as evidence: it is compared against the study's saved row, and it can
 * only authorise the write if that row already holds it. That is what lets the
 * clinician's own autosave count as current while a second workstation's edit
 * refuses the apply.
 */
export type ComposerPersistenceTag = {
  jobId: number;
  previous: { findings: string; impression: string; recommendation: string };
};

/** Materialize accepted changes into plain text (no HTML). */
export function materializeAcceptedText(opts: {
  currentFindings: string;
  currentImpression: string;
  currentRecommendation: string;
  changes: TrackedChange[];
}): { findings: string; impression: string; recommendation: string } {
  let findings = opts.currentFindings;
  let impression = opts.currentImpression;
  let recommendation = opts.currentRecommendation;
  for (const c of opts.changes) {
    if (c.reviewState !== "ACCEPTED" && c.reviewState !== "EDITED") continue;
    if (c.field === "FINDINGS") findings = c.proposedText;
    if (c.field === "IMPRESSION") impression = c.proposedText;
    if (c.field === "RECOMMENDATION") recommendation = c.proposedText;
  }
  return { findings, impression, recommendation };
}

export const AI_COMPOSE_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  NONE: { label: "—", color: "bg-gray-100 text-gray-600 border-gray-200" },
  QUEUED: { label: "AI QUEUED", color: "bg-amber-50 text-amber-800 border-amber-200" },
  COMPOSING: { label: "AI…", color: "bg-sky-50 text-sky-800 border-sky-200" },
  READY: { label: "AI READY", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  STALE_READY: { label: "AI STALE", color: "bg-orange-50 text-orange-900 border-orange-300" },
  FAILED: { label: "AI FAILED", color: "bg-red-50 text-red-700 border-red-200" },
  APPLIED: { label: "AI Applied", color: "bg-slate-50 text-slate-600 border-slate-200" },
  DISCARDED: { label: "AI Discarded", color: "bg-gray-50 text-gray-500 border-gray-200" },
  CANCELLED: { label: "AI Cancelled", color: "bg-gray-50 text-gray-500 border-gray-200" },
  OBSOLETE: { label: "AI Obsolete", color: "bg-gray-50 text-gray-500 border-gray-200" },
};

/** Distinct badge when READY came from deterministic composition (Ollama not used). */
export const FALLBACK_DRAFT_STYLE = {
  label: "FALLBACK DRAFT",
  color: "bg-amber-50 text-amber-950 border-amber-300",
} as const;

export const FALLBACK_STALE_STYLE = {
  label: "FALLBACK STALE",
  color: "bg-orange-50 text-orange-950 border-orange-300",
} as const;

export const DETERMINISTIC_FALLBACK_WARNING =
  "Local AI was not used. This draft was generated by deterministic fallback.";

/** True when the proposal is the offline deterministic draft, not an Ollama/model response. */
export function isDeterministicComposeFallback(job: {
  fallbackUsed?: boolean | null;
  model?: string | null;
  validation?: unknown;
} | null | undefined): boolean {
  if (!job) return false;
  if (job.fallbackUsed === true) return true;
  if ((job.model ?? "").trim().toLowerCase() === "deterministic") return true;
  const v = job.validation as { warnings?: string[]; provenance?: { provider?: string; fallbackUsed?: boolean } } | null | undefined;
  if (v?.provenance?.provider === "deterministic" || v?.provenance?.fallbackUsed === true) return true;
  if (Array.isArray(v?.warnings) && v.warnings.includes("deterministic_fallback")) return true;
  return false;
}

/**
 * Why this draft is a fallback, in the sentence the server wrote for it.
 *
 * Empty when the job row carries no reason. It is the only trace of the cause
 * that reaches the browser — the READY path stores `safeError: null` — so the
 * banner prints it verbatim instead of guessing, and guessing is what told an
 * operator whose model had merely timed out to go and configure a model.
 */
export function composeDegradedReason(job: { validation?: unknown } | null | undefined): string {
  const v = job?.validation as
    | { provenance?: { degradedReason?: string | null } }
    | null
    | undefined;
  return (v?.provenance?.degradedReason ?? "").trim();
}

/**
 * Display label for compose job status.
 * Job status stays READY (review/apply unchanged); badge must not say "AI READY"
 * when Ollama was skipped and deterministic fallback produced the draft.
 */
export function composeStatusDisplay(
  status: string,
  opts?: { fallbackUsed?: boolean | null; model?: string | null; validation?: unknown },
): { label: string; color: string; isFallbackDraft: boolean } {
  const fallback = isDeterministicComposeFallback({
    fallbackUsed: opts?.fallbackUsed,
    model: opts?.model,
    validation: opts?.validation,
  });
  if (fallback && status === "READY") {
    return { ...FALLBACK_DRAFT_STYLE, isFallbackDraft: true };
  }
  if (fallback && status === "STALE_READY") {
    return { ...FALLBACK_STALE_STYLE, isFallbackDraft: true };
  }
  const cfg = AI_COMPOSE_STATUS_STYLE[status] ?? AI_COMPOSE_STATUS_STYLE.NONE;
  return { label: cfg.label, color: cfg.color, isFallbackDraft: false };
}

export const AI_COMPOSE_SORT_RANK: Record<string, number> = {
  READY: 0,
  STALE_READY: 1,
  COMPOSING: 2,
  QUEUED: 3,
  FAILED: 4,
  APPLIED: 5,
  DISCARDED: 6,
  CANCELLED: 7,
  OBSOLETE: 8,
  NONE: 9,
};
