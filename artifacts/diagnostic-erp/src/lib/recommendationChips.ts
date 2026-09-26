/**
 * Recommendation chip defaults + alias-aware active/remove helpers.
 * Extracted from RadiologyReportingWorkspace (Phase 1 — no behavior change).
 */

import { removeBlock } from "@/lib/quickFindingsMerge";

/** Default Recommendation chips when `report_recommendation_chips` is unset. */
export const DEFAULT_RECOMMENDATION_CHIPS: string[] = [
  "Clinical correlation is recommended.",
  "Correlation with previous imaging is advised.",
  "Follow-up imaging is advised as clinically indicated.",
  "Contrast-enhanced study is suggested for further characterisation.",
  "MRI is advised for further evaluation.",
  "Specialist / surgical consultation is recommended.",
  "No further imaging is required at present.",
];

export const RECOMMENDATION_CHIP_ALIASES: Record<string, string[]> = {
  "Clinical correlation is recommended.": [
    "Please correlate with clinical and laboratory findings.",
    "Please correlate with clinical findings.",
    "Clinical correlation advised.",
    "Clinical correlation is advised.",
  ],
  "Follow-up imaging is advised as clinically indicated.": [
    "Follow-up imaging is recommended as clinically indicated.",
    "Follow up imaging is advised as clinically indicated.",
  ],
};

export function removeRecommendationChip(existing: string, chip: string): string {
  const trimmed = chip.trim();
  if (!trimmed) return existing;
  const aliases = RECOMMENDATION_CHIP_ALIASES[trimmed] ?? [];
  let next = removeBlock(existing, trimmed);
  for (const a of aliases) next = removeBlock(next, a);
  return next;
}

export function recommendationChipActive(existing: string, chip: string): boolean {
  const trimmed = chip.trim();
  if (!trimmed) return false;
  if (existing.includes(trimmed)) return true;
  return (RECOMMENDATION_CHIP_ALIASES[trimmed] ?? []).some((a) => existing.includes(a));
}
