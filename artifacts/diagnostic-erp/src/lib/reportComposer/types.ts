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
  findingsText: string;
  impressionText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
};

export type ComposerInputSnapshot = {
  studyId?: number | null;
  worklistId?: number | null;
  reportId?: number | null;
  modality?: string;
  region?: string;
  studyType?: string;
  protocol?: string;
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
  targetLanguage?: string;
  jobKindHint?: string;
};

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
  proposedFindings: string | null;
  proposedImpression: string | null;
  proposedRecommendation: string | null;
  trackedChanges: TrackedChange[];
  draft: { findings?: string; impression?: string; recommendation?: string } | null;
  validation: unknown;
  sources: Record<string, number>;
  model: string | null;
  fallbackUsed: boolean;
  latencyMs: number | null;
  safeError: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  createdAt: string;
  completedAt: string | null;
  appliedAt: string | null;
};

function normalizeForHash(text: string): string {
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
 *   region, concept, level, laterality, severity, anatomicalSection,
 *   findingsText, impressionText
 *
 * `id`, `source`, `conflictGroup`, `baselineReplaces` are intentionally
 * excluded — they are bookkeeping/provenance, not clinical content. Changing
 * them MUST NOT alter the snapshot hash (otherwise swapping a quick-select
 * observation for a macro observation at the same clinical slot would mark
 * the prior READY draft STALE without any actual clinical change).
 *
 * MUST be mirrored verbatim by the server (api-server snapshot.ts).
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
    norm(o.anatomicalSection),
    norm(o.findingsText),
    norm(o.impressionText),
  ].join("\u001f");
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
  // impressionText). Changes to ANY of those fields MUST invalidate prior
  // READY drafts — e.g. right → left laterality change with identical findings
  // text, or mild → moderate severity change with identical findings text,
  // both produce a different reportRevision so blind-apply is blocked.
  const obsCanon = dedupeObservations(snapshot.observations ?? [])
    .map((o) => canonicalObservationHashPayload(o))
    .join("\n");
  const inputHash = await hashText(
    [
      snapshot.jobKindHint ?? "",
      snapshot.clinicalHistory ?? "",
      snapshot.technique ?? "",
      snapshot.findings ?? "",
      snapshot.impression ?? "",
      snapshot.recommendation ?? "",
      obsCanon,
      snapshot.selectionText ?? "",
      snapshot.instruction ?? "",
      (snapshot.templateSections ?? []).join(","),
    ].join("\u001e"),
  );
  const reportRevision = await hashText(`${findingsHash}:${impressionHash}:${recommendationHash}:${obsCanon}`);
  return { findingsHash, impressionHash, recommendationHash, inputHash, reportRevision };
}

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
