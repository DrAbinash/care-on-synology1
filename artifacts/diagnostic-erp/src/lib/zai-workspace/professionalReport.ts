/**
 * professionalReport.ts — the parts of "Generate Professional Report" that can be
 * proven without a screen.
 *
 * Every string the one-click report is made of already exists somewhere the
 * radiologist put it: a Full Normal Format the clinic approved, an observation in
 * the ledger, a number in the canal AP table. Nothing in this module composes a
 * sentence, infers a level or supplies a normal. That is what makes the caller's
 * "nothing was fabricated" claim checkable rather than a promise.
 */

import type { AppliedPathologyPatch, PendingPathologyPatch } from "./store";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { extractLevel } from "@/lib/observationSlot";
import type { Side } from "@/lib/sideSwap";
import {
  canalApValueAt,
  levelsForCanalSegment,
  type CanalApProvenanceMap,
  type CanalSegment,
} from "@/lib/spineCanalAp";

/** Why nothing was written. `code` is what tests and telemetry read; `reason` is
 *  the sentence the radiologist sees, and it always names an action. */
export type ProfessionalReportRefusalCode =
  | "signed"
  | "confirmation-open"
  | "library-loading"
  | "identity-unresolved"
  | "no-normal-format"
  | "ambiguous";

export type ProfessionalReportOutcome =
  | {
    status: "generated";
    formatName: string;
    /** Baseline concepts the scaffold owns (0 for a legacy prose format). */
    baselineConcepts: number;
    /** The radiologist's own observations reproduced on the new scaffold. */
    observationsRetained: number;
    /** Retained observations the overlay engine wrote but put up for confirmation. */
    observationsNeedingReview: number;
    measurementTableIncluded: boolean;
  }
  | {
    status: "refused";
    code: ProfessionalReportRefusalCode;
    reason: string;
  };

/**
 * A stored observation re-submitted as the input the overlay engine takes.
 *
 * `templates` (not `lastRendered`) is what carries the sentence, because the tile's
 * `{side}` / `{severity}` placeholders are resolved again on the way in — a patch
 * that lost its laterality in a draft round trip must refuse rather than write
 * "the {side} MCA territory", which is the same contract #877 enforces on a click.
 */
export function reapplyInputFromPatch(
  patch: AppliedPathologyPatch,
): PendingPathologyPatch | null {
  const obs = patch.observation;
  if (!obs) return null;
  const hasText = Boolean((patch.templates.findings ?? "").trim()
    || (patch.templates.impression ?? "").trim()
    || (patch.templates.recommendation ?? "").trim());
  if (!hasText) return null;
  const storedSide = (obs.laterality ?? "").toLowerCase();
  return {
    id: patch.id,
    incoming: patch.templates,
    templates: patch.templates,
    ownership: patch.ownership,
    source: patch.source,
    catalogId: obs.catalogId ?? undefined,
    concept: obs.concept ?? null,
    region: obs.region || undefined,
    level: obs.level || undefined,
    laterality: obs.laterality || undefined,
    // Only one of the three sides CARE knows how to put into a sentence. Anything
    // else is passed as unset so the parameter contract refuses the tile instead of
    // substituting a word the tile never asked for.
    side: storedSide === "left" || storedSide === "right" || storedSide === "bilateral"
      ? (storedSide as Side)
      : "",
    supportsLaterality: obs.supportsLaterality,
    severity: obs.severity || undefined,
    state: obs.state || undefined,
    measurement: obs.measurement || undefined,
    sectionsOwned: obs.sectionsOwned,
    role: obs.role,
    specificity: obs.specificity,
    anchor: obs.anchor ?? null,
    // A preset row must keep saying which preset it came from. Without it the
    // rebuilt row is invisible to every bundle operation — `removeMacroBundle`
    // walks the ledger by `bundleId` — so a module the radiologist switches off
    // after one press of Generate can never be taken out of the report again.
    // Measured on MRI LS Spine: the five lumbar screening rows and the report-level
    // limitation row all came back from the rebuild with no bundle at all.
    bundleId: obs.bundleId || undefined,
  };
}

/**
 * The observations the radiologist is responsible for — the ones a report
 * regeneration must reproduce, in order.
 *
 * Excluded, and deliberately so: a `baseline` row is the scaffold's own sentence
 * (the scaffold is being rebuilt around it), the system-normal impression row is
 * seeded by `seedSystemNormalImpression`, a `stale` row is text the ledger already
 * disowns, and a row with no text contribution has nothing to say.
 */
export function radiologistObservations(
  patches: readonly AppliedPathologyPatch[],
): PendingPathologyPatch[] {
  const out: PendingPathologyPatch[] = [];
  for (const p of patches) {
    if (p.stale) continue;
    if (p.observation?.role === "baseline") continue;
    if (isSystemNormalPatch(p)) continue;
    const input = reapplyInputFromPatch(p);
    if (input) out.push(input);
  }
  return out;
}

/**
 * True when every statement the scaffold would add is already in the field.
 *
 * CARE's merge is a sentence re-join, so merging text the report already carries
 * is not a no-op: it reformats it. A Technique of "MRI brain on 3T. Multiplanar
 * T2W…" comes back as two lines on the second press. The report the radiologist
 * reviewed is then not the report on the screen, which is the one thing a
 * regenerate may not do. So the merge is skipped when it would change nothing
 * clinical — the same exact-normalized identity the merge itself dedupes on.
 */
export function alreadySaysThis(existing: string, incoming: string): boolean {
  const present = new Set(splitToSentences(existing).map(normalizeForDedupe));
  const wanted = splitToSentences(incoming).map(normalizeForDedupe).filter(Boolean);
  if (wanted.length === 0) return true;
  return wanted.every((unit) => present.has(unit));
}

/** One narrative line, normalized the way CARE's merge normalizes it. */
function narrativeLines(text: string): string[] {
  return text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * The findings lines the report owes to something other than the radiologist's
 * keyboard: an observation's own sentence, or a baseline sentence the applied
 * format owns. What is left over is free text — dictated, typed or pasted. This is
 * computed from ledger identity, never from NLP on the prose.
 */
export function unexplainedFindingLines(
  findingsText: string,
  patches: readonly AppliedPathologyPatch[],
): string[] {
  const owned = new Set<string>();
  for (const p of patches) {
    for (const source of [p.lastRendered.findings, p.templates.findings]) {
      for (const line of narrativeLines(source ?? "")) owned.add(normalizeForDedupe(line));
    }
  }
  return narrativeLines(findingsText).filter((line) => !owned.has(normalizeForDedupe(line)));
}

/**
 * The disc levels a radiologist's own sentence contradicts.
 *
 * This does not infer a level for a sentence that does not name one — it reads a
 * level *out of* what the radiologist wrote, and asks only which rows of the
 * scaffold that sentence now contradicts. Measured before it existed: typing
 * "C5-C6: Disc herniation with cord compression." and pressing Generate produced
 * "C5-C6: No significant disc bulge or protrusion is seen." eight lines below it,
 * one report asserting both. A denial is deliberately not a contradiction:
 * "C5-C6: No significant disc bulge is seen." restates the level's normal, and a
 * sentence that names no level at all (an infarct, a facet arthropathy) retires
 * nothing, because there is nothing to attribute it to.
 */
export function levelsContradictedByUnexplainedLines(
  lines: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    if (!assertsAbnormality(line)) continue;
    const level = extractLevel(line);
    if (level) out.add(level.toLowerCase());
  }
  return out;
}

/** A ledger row's level in the same normalised form the sentences come back in. */
export function rowLevelKey(level: string | null | undefined): string {
  return extractLevel(level ?? "").toLowerCase();
}

/**
 * The baseline sentences the scaffold must not write, because the radiologist has
 * described those levels themselves.
 *
 * Read off the manifest rather than matched against prose, so the decision is
 * which ROW is superseded — not a guess about what a sentence meant. Returning
 * the text as well as skipping the ledger row is what makes a second press change
 * nothing: the sentence is never written, so there is no gap left where it was
 * removed, and the Findings box is byte-identical between presses.
 */
export function supersededBaselineTexts(
  observations: readonly { field: string; level?: string; renderedText: string }[],
  levels: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (levels.size === 0) return out;
  for (const entry of observations) {
    if (entry.field !== "findings") continue;
    const key = rowLevelKey(entry.level);
    if (key !== "" && levels.has(key)) out.add(entry.renderedText.trim());
  }
  return out;
}

/**
 * True when the report says something beyond the approved normal.
 *
 * Two sources count as a deviation: an observation the radiologist recorded, and
 * a findings sentence that is not explained by any observation and actually
 * ASSERTS pathology. The second test matters in both directions. Text that is
 * only "nothing seen" must not be treated as a deviation, or a complete normal
 * gets its conclusion rebuilt and its own negatives arrive in the Impression;
 * and text that really does describe an infarct must be treated as one, or the
 * report keeps the format's "Normal MRI of the brain." on top of it and
 * contradicts itself. `assertsAbnormality` is what tells those two apart — a cue
 * inside its own negation is not a deviation.
 */
export function reportHasDeviation(
  patches: readonly AppliedPathologyPatch[],
  unexplainedLines: readonly string[],
): boolean {
  if (unexplainedLines.some(assertsAbnormality)) return true;
  return patches.some((p) => !p.stale
    && p.observation?.role !== "baseline"
    && !isSystemNormalPatch(p));
}

/**
 * The canal AP measurements as report text, or `""` when there is nothing to print.
 *
 * Only recorded numbers appear, and only for the levels they were recorded on. The
 * interactive box deliberately shows every disc with an em-dash in the empty cells —
 * that is a data-entry grid, and it is telling the radiologist which levels are still
 * open. The same grid inside a signed report would read as "these levels were
 * measured", which is a claim about the examination. CARE's findings document already
 * turns a `Label:` line into a section heading and `|` rows into a real table, so this
 * is the existing renderer, not a second one.
 */
export function canalApReportTable(
  records: CanalApProvenanceMap | null | undefined,
  segment: CanalSegment | null | undefined,
): string {
  if (!segment || !records) return "";
  const rows: string[] = [];
  for (const level of levelsForCanalSegment(segment)) {
    const value = canalApValueAt(records, level);
    if (value == null) continue;
    rows.push(`| ${level} | ${value} mm |`);
  }
  if (rows.length === 0) return "";
  return [
    "Spinal canal AP diameter (mm):",
    "| Level | AP canal |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}
