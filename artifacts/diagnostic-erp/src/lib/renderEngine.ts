/**
 * renderEngine.ts — Radiology Roadmap Ticket F1a.
 *
 * Versioned facade over the existing pure render/impression helpers:
 * abnormalityEngine, sideSwap, quickFindingsMerge. Mechanical consolidation
 * only — re-exports the original modules' public surface unchanged and
 * byte-for-byte, under one namespace with a version constant. No logic is
 * moved or duplicated here; every export below is the exact same function
 * reference as its source module (see renderEngine.test.ts).
 *
 * Deliberately NOT done here (Ticket F1b's scope, not this one's):
 *   - No orchestration logic extracted (applyRendered / handleQuickToggle /
 *     handleInstanceUpdate stay in RadiologyReportingWorkspace.tsx).
 *   - No existing call site repointed to import from here — this module
 *     exists as F1b's foundation but has no consumers yet, so it changes
 *     nothing about current UI behavior.
 *   - The removeImpression naming collision with RadiologyReportingWorkspace.tsx's
 *     local UI-only removeImpression(index) is untouched — still open, per
 *     the F1 readiness review.
 *
 * RENDER_ENGINE_VERSION intentionally mirrors the naming of
 * patient_reports.render_engine_version (added nullable, unused, in Ticket
 * A2) — this is the version value a future ticket could stamp there; no
 * such wiring exists yet.
 */

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
} from "./quickFindingsMerge";
