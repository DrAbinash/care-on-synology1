/**
 * Naming-rule helpers for Quick Finding ownership fields (R1–R7).
 * Used by admin editors and pack/sync tooling — not a second ownership model.
 */
import {
  buildCanonicalObservation,
  hasStructuredOwnership,
  isBroadAnatomy,
} from "./observationSlot";

export function conflictGroupTokens(conflictGroup: string): string[] {
  return (conflictGroup ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** R1 live check: every conflictGroup word must appear in the finding text. */
export function validateConflictGroupAgainstText(conflictGroup: string, findingText: string): {
  ok: boolean;
  missing: string[];
} {
  const missing = conflictGroupWordsMissingFromText(conflictGroup, findingText);
  return { ok: missing.length === 0, missing };
}

export function conflictGroupWordsMissingFromText(conflictGroup: string, findingText: string): string[] {
  const hay = (findingText ?? "").toLowerCase();
  if (!(conflictGroup ?? "").trim()) return [];
  const phrase = conflictGroup.trim().toLowerCase().replace(/_/g, " ");
  if (hay.includes(phrase)) return [];
  return conflictGroupTokens(conflictGroup).filter((t) => !hay.includes(t));
}

export function resolvedOwnershipMode(input: {
  conflictGroup?: string | null;
  anatomicalSection?: string | null;
  baselineReplaces?: string | null;
  label?: string | null;
  findingsText?: string | null;
  region?: string | null;
  properties?: string | null;
}): { mode: "mutex" | "append"; slotKey: string; label: string } {
  const obs = buildCanonicalObservation({
    region: input.region,
    conflictGroup: input.conflictGroup,
    anatomicalSection: input.anatomicalSection,
    baselineReplaces: input.baselineReplaces,
    label: input.label,
    findingsText: input.findingsText,
    properties: input.properties,
  });
  if (hasStructuredOwnership(obs)) {
    return { mode: "mutex", slotKey: obs.slotKey, label: `mutex: ${obs.slotKey}` };
  }
  return { mode: "append", slotKey: obs.slotKey, label: "append (no structured ownership)" };
}

export type OwnershipSnapshot = {
  key: string;
  label: string;
  conflictGroup: string;
  mode: "mutex" | "append";
  slotKey: string;
};

export function ownershipSnapshotFromTile(tile: {
  id?: string;
  studyType?: string;
  scopeBodyPart?: string;
  label: string;
  sentence?: string;
  findingText?: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  baselineReplaces?: string;
  properties?: string;
}): OwnershipSnapshot {
  const findingsText = tile.findingText ?? tile.sentence ?? "";
  const resolved = resolvedOwnershipMode({
    conflictGroup: tile.conflictGroup,
    anatomicalSection: tile.anatomicalSection,
    baselineReplaces: tile.baselineReplaces,
    label: tile.label,
    findingsText,
    region: tile.studyType ?? tile.scopeBodyPart,
    properties: tile.properties,
  });
  return {
    key: `${tile.studyType ?? tile.scopeBodyPart ?? ""}::${tile.label}`,
    label: tile.label,
    conflictGroup: tile.conflictGroup ?? "",
    mode: resolved.mode,
    slotKey: resolved.slotKey,
  };
}

export function enrichmentDiff(prev: OwnershipSnapshot[], next: OwnershipSnapshot[]): Array<{
  key: string;
  label: string;
  from: string;
  to: string;
}> {
  const before = new Map(prev.map((s) => [s.key, s]));
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (const n of next) {
    const p = before.get(n.key);
    const from = p ? (p.mode === "mutex" ? `mutex: ${p.slotKey}` : "append (no structured ownership)") : "append (no structured ownership)";
    const to = n.mode === "mutex" ? `mutex: ${n.slotKey}` : "append (no structured ownership)";
    if (from !== to) out.push({ key: n.key, label: n.label, from, to });
  }
  return out;
}

export function broadAnatomyConflictGroupWarning(conflictGroup: string): string | null {
  if (isBroadAnatomy(conflictGroup)) {
    return `conflictGroup "${conflictGroup}" is broad anatomy and will not become an exclusive concept.`;
  }
  return null;
}
