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
 * anatomicalSection, findingsText, impressionText.
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
  ].join("\u001f");
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
  // impressionText). Changes to ANY of those fields MUST invalidate prior
  // READY drafts. This MUST be mirrored verbatim by the client
  // (diagnostic-erp/src/lib/reportComposer/types.ts `computeSnapshotHashes`).
  const obsCanon = dedupeObservations(snapshot.observations ?? [])
    .map((o) => canonicalObservationHashPayload(o))
    .join("\n");
  const inputHash = hashText(
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
