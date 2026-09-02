/**
 * conceptCanon/normalImpression.ts — system-owned Normal Study impression.
 *
 * PR #662 §2: Safe Normal Impression auto-yield.
 *
 * DESIGN
 * ──────
 * The "Normal study." baseline impression is a SYSTEM-OWNED observation
 * in the canonical ledger, not free-text in the impression field. This
 * module encapsulates its identity, its narrative contribution, and the
 * predicates that decide when it auto-yields or returns.
 *
 * SAFETY INVARIANTS
 * ─────────────────
 * 1. The system normal patch is the ONLY impression contribution that
 *    auto-yields to an impression-worthy abnormal observation. Manual
 *    / protected impression text is NEVER deleted by this mechanism.
 *
 * 2. Auto-yield decisions are made by inspecting patch CONCEPT and
 *    SOURCE — NOT by NLP / regex on the impression text. A manually
 *    typed "Normal study." sentence has source = "manual" or
 *    "radiologist-voice" and is therefore NOT the system patch.
 *
 * 3. Auto-return happens ONLY when:
 *      (a) the last impression-worthy abnormal patch was removed, AND
 *      (b) no manual impression contribution remains, AND
 *      (c) the workspace is not finalized.
 *
 * 4. The system normal patch uses a stable patch id so it is idempotent
 *    across seed / re-seed / hydration cycles.
 */

import type { AppliedPathologyPatch } from "../zai-workspace/store";
import { isImpressionworthyAbnormal, isSystemOwnedBaseline } from "./contentPacks";

/** Stable patch id for the system-owned Normal Study impression. */
export const SYSTEM_NORMAL_PATCH_ID = "system-normal-study";

/** Canonical concept id (matches the `normal_study` content pack). */
export const SYSTEM_NORMAL_CONCEPT = "normal_study";

/**
 * The single canonical narrative contribution of the system normal patch.
 * Kept as a constant so callers can detect / strip it without regex.
 */
export const SYSTEM_NORMAL_IMPRESSION_TEXT = "Normal study.";

/**
 * Construct the system-owned Normal Study patch.
 *
 * The patch is a regular AppliedPathologyPatch with `source: "system"` and
 * a stable id. Callers merge it into `appliedPathologyPatches` like any
 * other observation.
 */
export function buildSystemNormalPatch(region: string): AppliedPathologyPatch {
  const now = new Date().toISOString();
  return {
    id: SYSTEM_NORMAL_PATCH_ID,
    ownership: {
      concept: SYSTEM_NORMAL_CONCEPT,
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      anatomicalSection: "",
      baselineReplaces: "",
    },
    templates: { impression: SYSTEM_NORMAL_IMPRESSION_TEXT },
    lastRendered: { impression: SYSTEM_NORMAL_IMPRESSION_TEXT },
    source: "system",
    observation: {
      id: SYSTEM_NORMAL_PATCH_ID,
      region: region || "*",
      anatomicalSection: "",
      concept: SYSTEM_NORMAL_CONCEPT,
      conceptSource: "explicit",
      conflictGroup: SYSTEM_NORMAL_CONCEPT,
      level: "",
      laterality: "",
      state: "",
      severity: "",
      measurement: "",
      slotKey: `${region || "*"}|${SYSTEM_NORMAL_CONCEPT}|*|*`,
      source: "system",
      baselineReplaces: "",
      supportsLaterality: false,
      bundleId: "",
      sectionsOwned: ["impression"],
      role: "impression",
      specificity: "region",
      createdAt: now,
      updatedAt: now,
    },
    replacedBaseline: { findings: [], impression: [] },
    protected: false,
  };
}

/**
 * Returns true if `patch` is the system-owned normal-study patch.
 *
 * Identifies by (id, source, concept) — never by inspecting impression
 * text. A manually-typed "Normal study." sentence has source = "manual"
 * or "radiologist-voice" and therefore returns false here.
 */
export function isSystemNormalPatch(patch: AppliedPathologyPatch | undefined | null): boolean {
  if (!patch) return false;
  if (patch.id !== SYSTEM_NORMAL_PATCH_ID) return false;
  if (patch.source !== "system") return false;
  return Boolean(patch.observation?.concept && isSystemOwnedBaseline(patch.observation.concept));
}

/**
 * Find the system normal patch in a list of patches. Returns null if absent.
 */
export function findSystemNormalPatch(
  patches: ReadonlyArray<AppliedPathologyPatch>,
): AppliedPathologyPatch | null {
  return patches.find(isSystemNormalPatch) ?? null;
}

/**
 * Returns true if any patch in the list is an impression-worthy abnormal
 * observation (suppresses the system normal impression).
 *
 * The system normal patch itself is NEVER impression-worthy abnormal.
 * Patches without a resolved concept default to false (conservative —
 * we do NOT suppress the system normal based on unstructured text).
 */
export function hasImpressionworthyAbnormal(
  patches: ReadonlyArray<AppliedPathologyPatch>,
): boolean {
  return patches.some((p) => {
    if (isSystemNormalPatch(p)) return false;
    const concept = p.observation?.concept ?? null;
    return isImpressionworthyAbnormal(concept);
  });
}

/**
 * Returns true if the impression field contains any manual or
 * radiologist-voice contribution. When true, the system normal patch
 * must NOT auto-return — the radiologist has taken ownership of the
 * impression.
 *
 * Manual / voice sources are determined by `fieldProvenance.impression`
 * — NOT by string-matching the impression text.
 */
export function impressionHasManualContribution(
  impressionProvenance: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!impressionProvenance) return false;
  for (const sources of Object.values(impressionProvenance)) {
    const arr = Array.isArray(sources) ? sources : [];
    if (arr.includes("manual") || arr.includes("radiologist-voice")) {
      return true;
    }
  }
  return false;
}
