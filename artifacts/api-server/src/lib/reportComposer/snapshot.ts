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

/** Deduplicate observations by concept+level+laterality+normalized findings. */
export function dedupeObservations(obs: ComposeObservation[]): ComposeObservation[] {
  const seen = new Set<string>();
  const out: ComposeObservation[] = [];
  for (const o of obs) {
    const key = [
      (o.conflictGroup || o.concept || "").toLowerCase(),
      (o.level || "").toLowerCase(),
      (o.laterality || "").toLowerCase(),
      normalizeForHash(o.findingsText).toLowerCase(),
    ].join("|");
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
  const obsCanon = dedupeObservations(snapshot.observations ?? [])
    .map((o) => `${o.concept}|${o.level ?? ""}|${o.findingsText}`)
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
