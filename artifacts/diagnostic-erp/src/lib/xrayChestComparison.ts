/**
 * xrayChestComparison.ts — previous-study comparison as a first-class,
 * evidence-gated axis (spec §15).
 *
 * Reuses the platform's existing comparison engine (radiologyComparison.ts) for
 * the interval vocabulary and the banner wording, and adds the one rule the
 * library demands: comparison language may only exist when a prior study is
 * actually referenced. A chest report must never say "unchanged" about a film
 * nobody has compared it with.
 *
 * Detection is deliberately marker-based rather than word-based: "increased
 * retrosternal clear space" is an ordinary description, while "no significant
 * interval change" is a comparison claim.
 *
 * Pure functions only — no store, no React.
 */
import {
  INTERVAL_CHANGES,
  buildComparisonSentence,
  comparisonBanner,
  type IntervalChange,
} from "./radiologyComparison";
import { chestAtomsToPatches, chestBundleId, type ChestAtomSpec } from "./xrayChestAtoms";

/**
 * Explicit comparison markers. Anything matching these asserts that a
 * comparison was performed.
 */
const COMPARISON_MARKER =
  /\b(compared with|compared to|in comparison with|comparison (was )?made with|prior (study|radiograph|film|x[- ]?ray|examination)|previous (study|radiograph|film|x[- ]?ray)|earlier (study|radiograph|film)|interval (change|development|resolution|improvement|worsening)|no significant interval change|stable (compared|relative) to)\b/i;

/** A dated reference the platform itself writes, or any explicit date. */
const DATED_PRIOR_REFERENCE =
  /(\b(19|20)\d{2}-\d{2}-\d{2}\b)|(\bd\d{1,2}\s+\w+\s+(19|20)\d{2}\b)|(\b(months?|weeks?|days?|years?) (earlier|prior|before|ago)\b)/i;

export function comparisonLanguagePresent(text: string | null | undefined): boolean {
  return COMPARISON_MARKER.test((text ?? "").trim());
}

export function hasDatedPriorReference(text: string | null | undefined): boolean {
  return DATED_PRIOR_REFERENCE.test((text ?? "").trim());
}

/**
 * True when the narrative asserts a comparison that is not anchored to any
 * dated prior study. This is a spec §17 validation condition, surfaced as a
 * warning rather than silently rewritten.
 */
export function unanchoredComparisonWarning(
  text: string | null | undefined,
): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (comparisonLanguagePresent(t) && !hasDatedPriorReference(t)) {
    return "comparison wording without a dated prior study reference";
  }
  return null;
}

/**
 * The canonical library's interval vocabulary (§18) mapped onto the platform's
 * existing IntervalChange values, so chest does not fork a second taxonomy.
 * "Mildly increased" / "interval development" / device removal are labels on
 * top of the same engine.
 */
export const CHEST_INTERVAL_LABELS: Array<{
  change: IntervalChange;
  /** Library wording shown to the radiologist. */
  label: string;
}> = [
  { change: "new", label: "New" },
  { change: "new", label: "Interval development" },
  { change: "progressed", label: "Increased" },
  { change: "progressed", label: "Mildly increased" },
  { change: "improved", label: "Decreased" },
  { change: "improved", label: "Improving" },
  { change: "resolved", label: "Resolved" },
  { change: "stable", label: "Unchanged / stable" },
  { change: "not-comparable", label: "Interval removal of device" },
  { change: "not-comparable", label: "Interval repositioning of device" },
];

export function chestIntervalChangeOptions(): Array<{ value: IntervalChange; label: string }> {
  return INTERVAL_CHANGES.map(({ value, label }) => ({ value, label }));
}

export type ChestComparisonInput = {
  region?: string;
  bundleId?: string;
  /** What is being compared — a lesion, device or finding concept. */
  subject: string;
  change: IntervalChange;
  priorDateIso: string;
  priorStudyName?: string | null;
  /** Extra descriptive text, e.g. "the right mid-zone opacity". */
  description?: string | null;
};

/**
 * Comparison never applies without a prior: `priorDateIso` is required by the
 * type, so an unanchored comparison cannot be constructed through this API.
 */
export function buildChestComparisonAtom(input: ChestComparisonInput): {
  bundleId: string;
  observations: ReturnType<typeof chestAtomsToPatches>;
} {
  const region = input.region ?? "Chest";
  const bundleId = input.bundleId ?? chestBundleId("comparison", `${input.subject}-${input.change}`);
  const banner = comparisonBanner(input.priorDateIso, input.priorStudyName ?? undefined);
  const sentence = buildComparisonSentence(input.change, {
    finding: input.description?.trim() || input.subject,
  });

  const atoms: ChestAtomSpec[] = [
    {
      concept: `comparison_${input.subject}`,
      conflictGroup: `comparison_${input.subject}`,
      anatomicalSection: "comparison",
      findings: `${banner} ${sentence}`.trim(),
    },
  ];

  return { bundleId, observations: chestAtomsToPatches(region, bundleId, atoms) };
}
