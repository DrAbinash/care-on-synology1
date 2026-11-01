/**
 * normalReplacement.ts — what happens when the examination changes under a report that
 * already carries a complete normal.
 *
 * The confirmed scope can widen an MRI Brain into an MRI Brain + Cervical Spine, and the
 * format that answers the wider examination is a DIFFERENT complete normal, not an extra
 * paragraph. `generateProfessionalReport` merges by design ("the scaffold is merged in,
 * never dropped on top"), which is right for a repeat press of the same normal and wrong
 * here: measured on the rig, the widened report kept the brain normal's twelve sentences
 * AND gained the combined row's four, stated the brain was normal twice in two words in
 * the Impression, and printed five Technique lines for one scan.
 *
 * So a different normal REPLACES the sentences the first one wrote — and only those. Every
 * line the radiologist typed, dictated or accepted, and every Quick Select observation,
 * stays on the page whatever he answers, because the retirement is computed from what the
 * previous format's own prose said, never from a guess about the text.
 *
 * The decision is his: an automatic pass never replaces anything, and a press arms a
 * question on the screen instead.
 */

import { normalizeForDedupe } from "@/lib/reportFieldMerge";

/** One narrative line of a format's prose. */
function lines(text: string): string[] {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * The field with the previous normal's sentences taken out of it.
 *
 * A line is removed only when the format being replaced wrote it AND the incoming format
 * does not say it too — a sentence both normals share stays exactly once, which is what
 * keeps a re-derived report from losing the half of the brain it still describes.
 * Nothing else on the page moves: a line the previous format never owned cannot be
 * removed here, so dictated text, typed text and measurement sentences survive by
 * construction rather than by a filter that has to recognise them.
 */
export function retireSupersededScaffold(input: {
  /** What the field holds now. */
  text: string;
  /** The prose the superseded format wrote into this field. */
  previous: string;
  /** The prose the incoming format is about to write. */
  next: string;
}): string {
  const writtenByPrevious = new Set(lines(input.previous).map(normalizeForDedupe));
  const saidAgainByNext = new Set(lines(input.next).map(normalizeForDedupe));
  const kept = lines(input.text).filter((line) => {
    const key = normalizeForDedupe(line);
    return !(writtenByPrevious.has(key) && !saidAgainByNext.has(key));
  });
  return kept.join("\n");
}

export type NormalReplacementKind = "untouched" | "edited";

/** The regions a normal speaks for: the regions its own ledger rows were authored under,
 *  falling back to the body part the Formats row is filed against. */
export function normalDocumentedRegions(format: {
  bodyPart?: string | null;
  baselineManifest?: { observations?: Array<{ region?: string | null; anatomicalSection?: string | null }> } | null;
}): string[] {
  const fromRows = (format.baselineManifest?.observations ?? [])
    .map((o) => (o.region ?? o.anatomicalSection ?? "").trim())
    .filter(Boolean);
  const all = fromRows.length ? fromRows : [(format.bodyPart ?? "").trim()].filter(Boolean);
  return [...new Set(all)];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Is this a SECOND examination, or the same examination regenerated?
 *
 * The replacement question exists for one situation: the confirmed scope now covers an
 * examination the normal on the page never spoke for, so that normal is no longer this
 * report's normal. A different ROW for the same examination (the clinic edited its brain
 * normal, a linked study's section is being built) is not that, and the merge engine that
 * has always handled a repeat press must keep handling it — measured, not assumed: the
 * linked-study and withheld-normal journeys both press Generate over a differently-named
 * normal and neither is a widening.
 */
export function isWidenedScope(previousRegions: string[], scopeRegions: string[]): boolean {
  const scope = scopeRegions.filter(Boolean);
  if (!previousRegions.length || !scope.length) return false;
  const inScope = (r: string) => scope.some((s) => norm(s) === norm(r));
  // Everything the old normal documented is still being reported…
  if (!previousRegions.every(inScope)) return false;
  // …and the examination has at least one region the old normal never spoke for.
  return scope.some((s) => !previousRegions.some((r) => norm(r) === norm(s)));
}

export type NormalReplacementPlan = {
  /** The normal on the page, and the one the confirmed examination now resolves to. */
  fromName: string;
  toName: string;
  /**
   * `untouched` — every sentence in the three clinical fields is machine-written, so
   * replacing costs the report nothing a person wrote.
   * `edited` — the radiologist has put words on this report, and they stay wherever he
   * takes the normal.
   */
  kind: NormalReplacementKind;
  /** Sentences the replacement removes. */
  replacedSentences: number;
  /** Sentences that are the radiologist's own and survive either answer. */
  keptOwnWords: number;
};

/**
 * What a replacement would cost, and what it cannot touch. Computed before any write so
 * the question on the screen can be answered with numbers rather than with "this may
 * overwrite your work".
 */
export function decideNormalReplacement(input: {
  fromName: string;
  toName: string;
  findingsText: string;
  impressionText: string;
  techniqueText: string;
  previous: { findings: string; impression: string; technique: string };
  next: { findings: string; impression: string; technique: string };
  /** Lines in Findings that no patch or baseline owns — typed, dictated, pasted. */
  unexplainedFindingLines: string[];
  /** The Conclusion carries the radiologist's own provenance. */
  manualImpression: boolean;
  /** Technique holds anything a person wrote. */
  manualTechnique: boolean;
}): NormalReplacementPlan {
  const removed = (field: string, previous: string, next: string) =>
    lines(field).length - retireSupersededScaffold({ text: field, previous, next }).split("\n").filter(Boolean).length;
  const replacedSentences =
    removed(input.findingsText, input.previous.findings, input.next.findings)
    + removed(input.impressionText, input.previous.impression, input.next.impression)
    + removed(input.techniqueText, input.previous.technique, input.next.technique);
  const keptOwnWords = input.unexplainedFindingLines.length
    + (input.manualImpression ? lines(input.impressionText).length : 0)
    + (input.manualTechnique ? lines(input.techniqueText).length : 0);
  const kind: NormalReplacementKind = keptOwnWords > 0 ? "edited" : "untouched";
  return {
    fromName: input.fromName,
    toName: input.toName,
    kind,
    replacedSentences,
    keptOwnWords,
  };
}

/** The words the question on the screen uses. */
export function normalReplacementMessage(plan: NormalReplacementPlan): { title: string; description: string } {
  if (plan.kind === "untouched") {
    return {
      title: `Use ${plan.toName} instead of ${plan.fromName}?`,
      description: `This report still holds the normal for ${plan.fromName}. Nothing has been typed into it, so the ${plan.replacedSentences} sentence(s) that normal wrote are replaced by the one that covers both examinations.`,
    };
  }
  return {
    title: `${plan.toName} covers both examinations — replace ${plan.fromName}?`,
    description: `Your ${plan.keptOwnWords} own sentence(s) stay wherever you leave them. Replacing removes ${plan.replacedSentences} sentence(s) that ${plan.fromName} wrote. Keeping it leaves the second examination without a section.`,
  };
}
