/**
 * Editing-only normal-baseline badge. Never serialised into report text / PDF.
 */
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";

export type NormalBaselineBadge = {
  /** Visible badge copy (editor chrome only). */
  text: string;
  /** Applied format name for tooltip. */
  formatName: string;
  mode: "baseline" | "deviations";
};

function isAbnormalObservation(patch: AppliedPathologyPatch): boolean {
  if (isSystemNormalPatch(patch)) return false;
  if (patch.stale) return false;
  if (patch.source === "system") return false;
  return true;
}

/**
 * Show when a complete normal format identity is present (PR #677 bootstrap
 * or explicit format apply). Once non-system abnormalities exist, switch to
 * the "+ deviations" wording. Never implies images were reviewed.
 */
export function deriveNormalBaselineBadge(input: {
  appliedFormatName: string | null | undefined;
  appliedFormatReportTitle?: string | null;
  appliedPathologyPatches: readonly AppliedPathologyPatch[];
}): NormalBaselineBadge | null {
  const formatName = (input.appliedFormatName || input.appliedFormatReportTitle || "").trim();
  if (!formatName) return null;

  const hasDeviation = input.appliedPathologyPatches.some(isAbnormalObservation);
  if (hasDeviation) {
    return {
      text: "Normal baseline + deviations",
      formatName,
      mode: "deviations",
    };
  }
  return {
    text: "Normal baseline active — review required",
    formatName,
    mode: "baseline",
  };
}

/** Guard: badge copy must never appear in printed clinical fields. */
export function badgeTextLeaksIntoReport(
  badgeText: string,
  reportParts: { findings?: string; impression?: string; recommendation?: string; technique?: string },
): boolean {
  const needle = badgeText.trim().toLowerCase();
  if (!needle) return false;
  const hay = [
    reportParts.findings,
    reportParts.impression,
    reportParts.recommendation,
    reportParts.technique,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}
