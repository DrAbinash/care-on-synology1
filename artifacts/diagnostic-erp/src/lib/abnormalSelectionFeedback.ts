/**
 * Display-only feedback after Quick Select / Finding Composer applies an
 * abnormality. Never mutates clinical text; highlight is transient UI state.
 */
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";

export const ABNORMAL_HIGHLIGHT_MS = 1400;

export type AbnormalHighlightState = {
  /** Exact findings sentence/slot text to flash (display overlay only). */
  needle: string;
  /** Bumps so rapid re-applies re-trigger the CSS animation. */
  token: number;
  studyId: string | null;
};

export function prefersReducedMotion(
  matchMedia: ((query: string) => { matches: boolean }) | null | undefined,
): boolean {
  try {
    return Boolean(matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
}

export function describeAbnormalReplacementToast(patch: AppliedPathologyPatch): string | null {
  if (isSystemNormalPatch(patch)) return null;
  const finding =
    (patch.observation?.concept || patch.ownership.conflictGroup || "").replace(/_/g, " ").trim()
    || (patch.lastRendered.findings || "").split(/[.!\n]/)[0]?.trim()
    || "Finding";
  const anatomy =
    (patch.observation?.level || "").trim()
    || (patch.observation?.anatomicalSection || patch.ownership.anatomicalSection || "").trim()
    || "baseline";
  // Owner brief (Composer 99.9 Phase 3, item C): the toast NAMES the sentence
  // the click retired, instead of gesturing at "the normal L4-L5 statement".
  // `replacedBaseline.findings` is exactly what the apply path recorded as
  // vacated, so the quoted sentence is the sentence the page lost — never a
  // re-derivation from prose. Multiple sentences (a compound baseline) are all
  // quoted; the anatomy qualifier stays for the level-scoped context.
  const baselines = (patch.replacedBaseline?.findings ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (baselines.length === 0) return null;
  const findingLabel = finding.length > 40 ? `${finding.slice(0, 40)}…` : finding;
  const quoted = baselines.map((s) => `"${s}"`).join(" ");
  return `${findingLabel} replaced the normal ${anatomy} statement ${quoted}.`;
}

export function buildAbnormalHighlightFromPatch(
  patch: AppliedPathologyPatch | null | undefined,
  studyId: string | null,
  prevToken = 0,
): AbnormalHighlightState | null {
  if (!patch || isSystemNormalPatch(patch)) return null;
  const needle = (patch.lastRendered.findings || "").trim();
  if (!needle) return null;
  return { needle, token: prevToken + 1, studyId };
}

/** Rapid study switch must drop transient highlight for the prior patient. */
export function clearHighlightIfStudyChanged(
  highlight: AbnormalHighlightState | null,
  studyId: string | null,
): AbnormalHighlightState | null {
  if (!highlight) return null;
  if (highlight.studyId !== studyId) return null;
  return highlight;
}

/** Ensure highlight markup is never written into clinical text. */
export function highlightIsDisplayOnly(clinicalText: string, needle: string): boolean {
  // Clinical text may contain the needle as plain language, but must not contain
  // highlight markup wrappers.
  if (/data-abnormal-highlight|abnormal-flash|<\/?mark\b/i.test(clinicalText)) return false;
  if (!needle) return true;
  return true;
}
