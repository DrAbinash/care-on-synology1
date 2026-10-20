/**
 * aiAttributionRestore.ts — who wrote this sentence, when the report comes back
 * from the local unsaved-draft backup.
 *
 * `fieldProvenance` records, per sentence, which sources contributed it
 * (`ai-draft`, `manual`, `template`, …). The server round trip preserves it, so
 * save → close → reopen tells the truth. The amber "Unsaved draft found" banner
 * does not: its Restore writes through `setEditorContent`, which stamped every
 * sentence `manual` — CARE's label for "a radiologist typed this". Four safety
 * mechanisms read that label as proof of human ownership: `contributionProtected`
 * (which decides whether a Quick Select retirement may remove the sentence),
 * `impressionHasManualContribution` (which decides whether the system normal may
 * be seeded), `impressionProvenanceIsRadiologistManual` (which decides whether
 * Mode A composes), and the per-sentence provenance shown on screen. An AI
 * sentence that survives the Restore as `manual` therefore becomes unretirable,
 * blocks its own Impression refresh, and is displayed as the radiologist's work.
 *
 * The rule set here is deliberately narrower than "keep everything". Attribution
 * is carried only when it can be *established*: one verified report context, one
 * exact sentence, appearing exactly once on each side. Anything else keeps the
 * conservative default, which is what those sentences look like today.
 */
import { normalizeForDedupe, sortSources, splitToSentences, type FieldProvenanceMap, type InsertSource } from "./reportFieldMerge";
import type { NarrativeProvenance } from "./pathologyPatch";

export type RestoreReportContext = {
  /** The study the workspace route says is open. */
  studyId: string | number | null;
  /** The study the server draft finished hydrating for, or null if it has not. */
  hydratedStudyId: string | number | null;
  /** The worklist row's patient, or null when the row's identity is ambiguous. */
  patientId: string | number | null;
  /** The saved draft row the hydrated provenance belongs to, or null. */
  draftId: string | number | null;
};

export type PreservedRestoreProvenance = {
  context: RestoreReportContext;
  provenance: NarrativeProvenance;
};

/**
 * What an unestablished sentence is labelled with. `manual` is the workspace's
 * existing conservative default — it protects text from automated removal, which
 * is the safe direction for words nobody can account for. Naming it here is the
 * point: it is the answer to "unknown", not evidence of authorship, and a sentence
 * whose attribution was established never comes through it.
 */
export const RESTORE_FALLBACK_SOURCE: InsertSource = "manual";

/** The five narrative fields `setEditorContent` writes. */
const RESTORED_FIELDS = ["findings", "impression", "recommendation", "technique", "clinicalHistory"] as const;
export type RestoredField = (typeof RESTORED_FIELDS)[number];

/**
 * Row ids reach this code as both numbers and strings — a route param, a worklist
 * row, a draft response — and the repo compares them as text elsewhere too. Two
 * missing ids are never "the same id": a comparison that returns true for
 * null/null would let an unresolved context pass as a verified one.
 */
export function sameReportId(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  const left = String(a).trim();
  const right = String(b).trim();
  if (!left || !right) return false;
  return left === right;
}

/**
 * Is this the one report the provenance being carried was hydrated for? A study
 * whose draft has not finished loading, a row with no resolved patient, or a
 * report with no draft row is not a verified context, and carrying marks across
 * one would attribute patient A's AI sentence to patient B's identical sentence.
 */
export function reportContextIsVerified(ctx: RestoreReportContext | null | undefined): boolean {
  if (!ctx) return false;
  return sameReportId(ctx.studyId, ctx.hydratedStudyId)
    && ctx.patientId != null && String(ctx.patientId).trim() !== ""
    && ctx.draftId != null && String(ctx.draftId).trim() !== "";
}

/** Snapshot the live map so a later store write cannot edit what was captured. */
export function restoreProvenanceForContext(
  context: RestoreReportContext,
  provenance: NarrativeProvenance | undefined,
): PreservedRestoreProvenance {
  const copy: NarrativeProvenance = {};
  for (const field of RESTORED_FIELDS) {
    const map = provenance?.[field];
    if (!map) continue;
    const entries: FieldProvenanceMap = {};
    for (const [key, sources] of Object.entries(map)) {
      if (key !== normalizeForDedupe(key)) continue; // keys are normalized; anything else proves nothing
      entries[key] = Array.isArray(sources) ? [...sources] : [];
    }
    copy[field] = entries;
  }
  return { context: { ...context }, provenance: copy };
}

/** How many times each normalized sentence occurs in a block. */
export function sentenceKeyCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sentence of splitToSentences(text)) {
    const key = normalizeForDedupe(sentence);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The provenance map for the restored text.
 *
 * A sentence keeps its recorded sources only when:
 *  - the report context was verified (`carryAttribution`), and
 *  - that exact sentence was in the narrative the provenance was captured from,
 *    and
 *  - it appears exactly once on both sides.
 *
 * Everything else takes the fallback. Deliberately NOT used: fuzzy similarity
 * (`findFuzzyProvenanceMatch`) — carrying an AI mark onto words the radiologist
 * rewrote would attribute their edit to the model, which is the same false claim
 * in the other direction.
 */
export function provenanceForRestoredField(opts: {
  previousText: string;
  previousProvenance: FieldProvenanceMap | undefined;
  restoredText: string;
  carryAttribution: boolean;
}): FieldProvenanceMap {
  const out: FieldProvenanceMap = {};
  const nextCounts = sentenceKeyCounts(opts.restoredText);
  const prevCounts = opts.carryAttribution ? sentenceKeyCounts(opts.previousText) : null;
  for (const key of nextCounts.keys()) {
    const recorded = opts.previousProvenance?.[key];
    const established = opts.carryAttribution
      && Array.isArray(recorded)
      && recorded.length > 0
      && nextCounts.get(key) === 1
      && prevCounts?.get(key) === 1;
    out[key] = established ? sortSources(recorded) : [RESTORE_FALLBACK_SOURCE];
  }
  return out;
}
