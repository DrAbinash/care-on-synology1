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
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
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
