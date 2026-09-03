/**
 * Snapshot hashing / revision helpers.
 * Canonical input model (Guard 8): Model B — frozen snapshot is authoritative AI input.
 * Server computes hashes from the snapshot and verifies client metadata.
 */
import { createHash } from "node:crypto";
import type { ComposerInputSnapshot, ComposeObservation } from "./types";

export function hashText(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex").slice(0, 32);
}

export function normalizeForHash(text: string): string {
  return (text ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

/**
 * Canonical observation identity — MUST be mirrored verbatim by the client
 * (diagnostic-erp/src/lib/reportComposer/types.ts `canonicalObservationKey`).
 *
 * Identity: region | concept | level | laterality
 *   - matches CARE's `CanonicalObservation.slotKey`
 *     (region|concept|level|laterality) for structured observations.
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
  return `text::${norm(o.findingsText)}`;
}

/**
 * Canonical observation payload used in snapshot hashing. MUST be mirrored
 * verbatim by the client (diagnostic-erp/src/lib/reportComposer/types.ts
 * `canonicalObservationHashPayload`).
 *
 * Includes every field that materially changes the clinical meaning of an
 * observation: region, concept, level, laterality, severity,
 * anatomicalSection, findingsText, impressionText, recommendationText.
 *
 * Excludes id / source / conflictGroup / baselineReplaces — those are
 * provenance/bookkeeping, not clinical content. Changing them MUST NOT alter
 * the snapshot hash.
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
    norm(o.recommendationText),
  ].join("\u001f");
}

/**
 * Canonical study-context payload used in `inputHash` (NOT `reportRevision`).
 * MUST be mirrored verbatim by the client (diagnostic-erp/src/lib/
 * reportComposer/types.ts `canonicalStudyContextHashPayload`).
 *
 * Includes every study-context field that materially changes what study the AI
 * is composing for: modality, region, regions, bodyPart, family, spineSegment,
 * protocol, reportTitle. Changes to ANY of these fields MUST invalidate the
 * frozen AI input hash.
 *
 * Intentionally NOT part of `reportRevision` — see client docstring for the
 * rationale. In short: `reportRevision` guards the clinically EDITABLE report
 * state; study context is STUDY IDENTITY captured at enqueue time per Model B
 * (frozen snapshot = authoritative AI input, Guard 8).
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

/**
 * Canonical selected-key-image payload for inputHash.
 * MUST be mirrored by the client. Order-sensitive (add/remove/reorder invalidates).
 * Captions participate so caption edits invalidate READY image-assisted drafts.
 * Never includes bytes/base64.
 */
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

/** Deduplicate observations by canonical identity (region|concept|level|laterality). */
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
 * Pure stale-decision for the READY → STALE_READY freshness path.
 *
 * Two invalidation axes (PR #656 final safety hardening):
 *   1. `reportRevision` — clinically EDITABLE report state (findings text +
 *      impression text + recommendation text + canonical observations).
 *      Captures radiologist edits to the report content while the AI was
 *      composing. Already validated by PR #654.
 *   2. `inputHash` — full frozen AI input including canonical STUDY CONTEXT
 *      (modality, region, regions, bodyPart, family, spineSegment, protocol,
 *      reportTitle). Captures study-identity changes such as Plain → Contrast,
 *      or LS Spine + Whole Spine Screening → LS Spine only, even when the
 *      narrative text and observations did NOT change.
 *
 * Backward compatibility:
 *   - If `current.inputHash` is absent (legacy client), only axis 1 is
 *     enforced. New clients always provide `inputHash`.
 *
 * This pure helper is exported so the freshness decision can be unit-tested
 * WITHOUT a live database. The DB-backed `evaluateJobFreshness` in
 * `jobService.ts` wraps this helper and performs the actual STALE_READY
 * status mutation.
 */
export function isComposeJobStale(opts: {
  jobStatus: string;
  storedReportRevision: string;
  storedFindingsHash: string;
  storedImpressionHash: string;
  storedInputHash: string;
  current: {
    findingsHash: string;
    impressionHash: string;
    reportRevision: string;
    inputHash?: string;
  };
}): { stale: boolean } {
  // Only READY / STALE_READY jobs are eligible for stale evaluation. Other
  // terminal states (FAILED, APPLIED, DISCARDED, CANCELLED, OBSOLETE) are
  // not subject to freshness checks.
  if (opts.jobStatus !== "READY" && opts.jobStatus !== "STALE_READY") {
    return { stale: false };
  }
  const stale =
    opts.current.reportRevision !== opts.storedReportRevision ||
    opts.current.findingsHash !== opts.storedFindingsHash ||
    opts.current.impressionHash !== opts.storedImpressionHash ||
    // PR #656: study-context change invalidates a READY draft even when the
    // editable narrative text + observations are byte-identical. Optional —
    // legacy clients without `inputHash` retain the reportRevision-only
    // behavior.
    (opts.current.inputHash !== undefined && opts.current.inputHash !== opts.storedInputHash);
  return { stale };
}

export function computeSnapshotHashes(snapshot: ComposerInputSnapshot): {
  findingsHash: string;
  impressionHash: string;
  recommendationHash: string;
  inputHash: string;
  reportRevision: string;
} {
  const findingsHash = hashText(snapshot.findings ?? "");
  const impressionHash = hashText(snapshot.impression ?? "");
  const recommendationHash = hashText(snapshot.recommendation ?? "");
  // Observations contribute their full canonical payload (region, concept,
  // level, laterality, severity, anatomicalSection, findingsText,
  // impressionText, recommendationText). Changes to ANY of those fields MUST
  // invalidate prior READY drafts. This MUST be mirrored verbatim by the
  // client (diagnostic-erp/src/lib/reportComposer/types.ts
  // `computeSnapshotHashes`).
  const obsCanon = dedupeObservations(snapshot.observations ?? [])
    .map((o) => canonicalObservationHashPayload(o))
    .join("\n");
  // Study context (modality/region/regions/bodyPart/family/spineSegment/
  // protocol/reportTitle) is part of `inputHash` so the frozen snapshot is
  // self-describing — but intentionally NOT part of `reportRevision` (see
  // `canonicalStudyContextHashPayload` docstring for the rationale).
  const studyCtxCanon = canonicalStudyContextHashPayload(snapshot);
  const selectedImagesCanon = canonicalSelectedKeyImagesHashPayload(snapshot);
  const inputHash = hashText(
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
      // Selected-image mode + ordered key-image refs participate in inputHash
      // so add/remove/reorder/caption change invalidates READY drafts.
      snapshot.aiMode ?? "TEXT_ONLY",
      selectedImagesCanon,
    ].join("\u001e"),
  );
  // Revision is content-derived so multi-tab / unsaved editor state is self-describing.
  const reportRevision = hashText(`${findingsHash}:${impressionHash}:${recommendationHash}:${obsCanon}`);
  return { findingsHash, impressionHash, recommendationHash, inputHash, reportRevision };
}

export function summarizeSources(observations: ComposeObservation[]): Record<string, number> {
  const counts: Record<string, number> = {
    "quick-select": 0,
    "quick-findings": 0,
    macro: 0,
    manual: 0,
    voice: 0,
    structured: 0,
  };
  for (const o of observations) {
    const s = o.source ?? "structured";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
