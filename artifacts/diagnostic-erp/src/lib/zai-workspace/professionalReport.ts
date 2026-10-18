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
import { FULL_REPORT_BASELINE_KIND } from "./baselineKind";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import { assertsAbnormality } from "@/lib/generateLocalImpression";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { extractLevel } from "@/lib/observationSlot";
import type { Side } from "@/lib/sideSwap";

/** Why nothing was written. `code` is what tests and telemetry read; `reason` is
 *  the sentence the radiologist sees, and it always names an action. */
export type ProfessionalReportRefusalCode =
  | "signed"
  | "confirmation-open"
  | "region-transition"
  | "library-loading"
  | "identity-unresolved"
  | "no-normal-format"
  /** Resolved a format, but not one the clinic OWNS as this examination's approved
   *  normal. Only reachable when the caller asked for that rule (`requireOwnedApprovedNormal`)
   *  — a press does not, because the radiologist chose the format themselves. */
  | "no-owned-normal"
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
    /**
     * The Findings were rebuilt; the Conclusion was not, because rebuilding it would
     * have left the report with NO conclusion at all. Only an unpressed pass reports
     * this — a press is the radiologist commanding the rebuild, and it still does it.
     */
    impressionHeld?: boolean;
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
 * Scaffold sentences the radiologist took out of a canvas this engine wrote.
 *
 * `lastStamped` is the Findings as the engine left them at the end of its previous
 * pass, `current` is what is on the page now, and `scaffold` is what this
 * examination's approved normal is made of. A line in the scaffold and in the last
 * stamp but NOT on the page is a deletion, and nothing else removed it — a normal the
 * findings contradict is already excluded by `supersededBaselineTexts` above, and a
 * sentence the radiologist wrote is not the engine's to re-add in the first place.
 *
 * Comparing whole normalised lines, not substring or fuzzy matches, is deliberate:
 * this is a claim about what a person removed, and a near-miss here either resurrects
 * clinical prose they rejected or silently swallows a sentence they meant to keep.
 */
export function deletedScaffoldLines(opts: {
  lastStamped: string;
  current: string;
  scaffold: readonly string[];
}): Set<string> {
  const present = new Set(
    opts.current.split("\n").map((l) => normalizeForDedupe(l)).filter(Boolean),
  );
  const owned = new Set(
    opts.scaffold.map((l) => normalizeForDedupe(l)).filter(Boolean),
  );
  const out = new Set<string>();
  if (owned.size === 0) return out;
  for (const line of opts.lastStamped.split("\n")) {
    const key = normalizeForDedupe(line);
    if (!key || !owned.has(key) || present.has(key)) continue;
    const text = line.trim();
    if (text) out.add(text);
  }
  return out;
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
 * Is this format the clinic's OWNED approved normal for the examination?
 *
 * The same test `normalBootstrap.ts` uses to stop an un-owned Templates row
 * outranking the curated copy — one rule, applied in both directions. A format with
 * prose but no `care.full_report_baseline.v1` manifest is somebody's wording, not a
 * baseline the department signed off, and the name on it does not change that.
 */
export function hasOwnedApprovedNormal(
  manifest: { kind?: string } | null | undefined,
): boolean {
  return manifest?.kind === FULL_REPORT_BASELINE_KIND;
}

/**
 * A fingerprint of the ledger that answers one question only: did this pass move it?
 *
 * Identity, not content — the id, whether the row is superseded, and its slot. A
 * rebuild that re-derives the same sentences has to come back identical, or the
 * automatic pass that wrote nothing would look like an edit and take an undo frame
 * for it. `lastRendered` is deliberately excluded: it is the text the row wrote into
 * the prose, and the prose is compared separately.
 */
export function ledgerIdentity(patches: readonly AppliedPathologyPatch[]): string {
  return patches
    .map((p) => `${p.id}\u0001${p.stale ? 1 : 0}\u0001${p.observation?.role ?? ""}`)
    .join("\u0002");
}

/**
 * The canal AP measurements are NOT written into Findings here.
 *
 * Generate used to append a markdown canal grid to the Findings text, which broke
 * the one rule this branch exists to enforce: that grid is a snapshot taken at the
 * moment of the press, and it then *suppressed* the printed table, because a body
 * that already carries a valued canal table gets no second one. A radiologist who
 * measured a level after pressing Generate — the normal order of work, since the
 * calipers come out of the viewer and the prose comes out of the format — signed a
 * report whose table named the levels measured before the press and never the ones
 * measured after it. The printed table is drawn by the report renderer
 * (`lib/spinalCanalApTable.ts` on the server, `canalApToPdfRows` in this app's own
 * PDF) from the measurement authority at the moment of printing, so it always
 * carries every level, in every segment the study measured. Writing one into the
 * editable prose would be a second table generator with a stale opinion (owner
 * DECISION 2, 2026-10-17).
 */
