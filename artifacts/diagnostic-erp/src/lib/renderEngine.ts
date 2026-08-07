/**
 * renderEngine.ts — Radiology Roadmap Tickets F1a + F1b.
 *
 * Versioned engine consolidating the pure render/impression helpers
 * (abnormalityEngine, sideSwap, quickFindingsMerge — re-exported unchanged,
 * byte-for-byte, since F1a) with the orchestration logic extracted from
 * RadiologyReportingWorkspace.tsx in F1b: applyRendered, and the
 * decision/state-transition logic behind handleQuickToggle and
 * handleInstanceUpdate.
 *
 * Everything below is pure and UI-independent — no React, no `@/`-aliased
 * imports, no QuickFinding (a UI/DB-row type defined in
 * components/radiology/QuickFindingsPanel.tsx). React state ownership
 * (useState/useRef) stays in RadiologyReportingWorkspace.tsx; these
 * functions take a state snapshot in and return the next state out, or
 * describe what the next value should be, and the component applies it.
 *
 * RENDER_ENGINE_VERSION intentionally mirrors the naming of
 * patient_reports.render_engine_version (added nullable, unused, in Ticket
 * A2) — this is the version value a future ticket could stamp there; no
 * such wiring exists yet.
 */

import {
  EMPTY_INSTANCE as _EMPTY_INSTANCE,
  type AbnormalityInstance,
  type RenderedAbnormality,
} from "./abnormalityEngine";
import type { Side } from "./sideSwap";
import {
  mergeBlock as _mergeBlock,
  removeBlock as _removeBlock,
  mergeImpression as _mergeImpression,
  removeImpression as _removeImpression,
  stripNormalImpressionLines as _stripNormalImpressionLines,
} from "./quickFindingsMerge";

export const RENDER_ENGINE_VERSION = "1.0.0";

export {
  fillTemplate,
  renderAbnormality,
  parseProperties,
  EMPTY_INSTANCE,
  type AbnormalityInstance,
  type AbnormalityTemplates,
  type RenderedAbnormality,
  type PropertyKey,
} from "./abnormalityEngine";

export {
  applySide,
  swapSides,
  hasSideWords,
  type Side,
} from "./sideSwap";

export {
  mergeBlock,
  removeBlock,
  mergeImpression,
  removeImpression,
  stripNormalImpressionLines,
  isNormalImpressionLine,
} from "./quickFindingsMerge";

// ── Orchestration (Ticket F1b) ──────────────────────────────────────────────

/** The four free-text/array report fields applyRendered's remove/merge cycle touches. */
export interface ReportTextState {
  rawFindings: string;
  impression: string[];
  technique: string;
  recommendation: string;
}

/**
 * Pure equivalent of RadiologyReportingWorkspace's applyRendered: exact-
 * removes what was previously inserted for this abnormality instance (if
 * any), then dedupe-merges the newly rendered sections (if any). A single
 * synchronous computation over the given `state` snapshot — replaces the
 * original's two sequential functional setState calls per field (remove,
 * then merge) with one direct computation per field, which is equivalent
 * for every reachable call pattern here (applyRendered is invoked once per
 * discrete Quick Select interaction, never re-entrantly within the same
 * tick) and is what makes this testable as a plain reducer.
 *
 * Does not touch insertedTextRef — the caller looks up `prev` from the ref
 * before calling and updates the ref (.set/.delete) after, exactly as
 * before. The ref's imperative mutation is a UI-lifecycle concern kept in
 * the component, not part of this pure text-merge computation.
 */
export function applyRenderedTransition(
  state: ReportTextState,
  prev: RenderedAbnormality | undefined,
  next: RenderedAbnormality | null,
): ReportTextState {
  let { rawFindings, impression, technique, recommendation } = state;
  if (prev) {
    if (prev.finding) rawFindings = _removeBlock(rawFindings, prev.finding);
    if (prev.impression) impression = _removeImpression(impression, prev.impression);
    if (prev.technique) technique = _removeBlock(technique, prev.technique);
    if (prev.recommendation) recommendation = _removeBlock(recommendation, prev.recommendation);
  }
  if (next) {
    if (next.finding) rawFindings = _mergeBlock(rawFindings, next.finding);
    if (next.impression) impression = _mergeImpression(impression, next.impression);
    // Any abnormal contribution (finding or impression) clears leftover normal-study lines.
    if (next.finding || next.impression) {
      impression = _stripNormalImpressionLines(impression, { onlyIfAbnormal: true });
    }
    if (next.technique) technique = _mergeBlock(technique, next.technique);
    if (next.recommendation) recommendation = _mergeBlock(recommendation, next.recommendation);
  }
  return { rawFindings, impression, technique, recommendation };
}

/** Pure equivalent of handleQuickToggle's selectedQuickIds Set update. */
export function toggleQuickSelection(current: Set<number>, id: number, selected: boolean): Set<number> {
  const next = new Set(current);
  if (selected) next.add(id);
  else next.delete(id);
  return next;
}

/** Pure equivalent of the quickInstances Map update on select or property-chip patch. */
export function setQuickInstance(
  current: Map<number, AbnormalityInstance>,
  id: number,
  instance: AbnormalityInstance,
): Map<number, AbnormalityInstance> {
  return new Map(current).set(id, instance);
}

/** Pure equivalent of handleQuickToggle's quickInstances Map update on deselect. */
export function deleteQuickInstance(
  current: Map<number, AbnormalityInstance>,
  id: number,
): Map<number, AbnormalityInstance> {
  const next = new Map(current);
  next.delete(id);
  return next;
}

/** Pure equivalent of handleQuickToggle's select branch: seeds a fresh instance from the global side selector. */
export function seedQuickInstance(side: Side): AbnormalityInstance {
  return { ..._EMPTY_INSTANCE, side };
}

/** Pure equivalent of handleInstanceUpdate: merges a property-chip patch onto the current (or freshly seeded) instance. */
export function patchQuickInstance(
  current: AbnormalityInstance | undefined,
  side: Side,
  patch: Partial<AbnormalityInstance>,
): AbnormalityInstance {
  const base = current ?? seedQuickInstance(side);
  return { ...base, ...patch };
}
