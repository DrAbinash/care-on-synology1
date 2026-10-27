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
 * 2. Auto-yield decisions are made by inspecting patch CONCEPT and SOURCE, and —
 *    for the conclusions whose concept the registry does not rank — by the one
 *    shipped abnormality reading (`isAbnormalFindingsLine`), never by hunting the
 *    Impression for a normal-looking phrase. WHAT is withdrawn is always this
 *    patch's own recorded contribution; a manually typed "Normal study." sentence
 *    has source = "manual" or "radiologist-voice" and is therefore NOT the system
 *    patch, so nothing here can delete it (CAT-P5).
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
import type { ObservationRole } from "../observationSlot";
import { isImpressionworthyAbnormal, isSystemOwnedBaseline } from "./contentPacks";
import { assertsStudyNormal } from "@workspace/report-quality";
import { splitToSentences } from "../reportFieldMerge";
import { isAbnormalFindingsLine } from "../abnormalEmphasis";

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
 * The system normal patch itself is NEVER impression-worthy abnormal, and
 * neither is a baseline-role observation — that exclusion lives in the
 * registry rule (isImpressionworthyAbnormal), not here, so the ledger can
 * never disagree with the content packs about what suppresses the normal.
 * Patches without a resolved concept default to false (conservative —
 * we do NOT suppress the system normal based on unstructured text).
 */
export function hasImpressionworthyAbnormal(
  patches: ReadonlyArray<AppliedPathologyPatch>,
): boolean {
  return patches.some((p) => {
    if (isSystemNormalPatch(p)) return false;
    if (p.stale) return false;
    return isImpressionworthyAbnormal(p.observation?.concept ?? null, {
      role: p.observation?.role,
    });
  });
}

/**
 * Does this sentence state an abnormality, rather than deny one?
 *
 * The concept registry cannot answer it alone, and the gap is not hypothetical:
 * measured over the 22 lumbar spine Quick Select boxes, eight abnormal ones carry
 * a concept the registry does not flag impression-worthy (`facet_joint`,
 * `ligamentum_flavum`, `disc_height`, `disc_signal`, `endplate`, `schmorl`), so
 * their conclusion left the study normal printed above it — a report asserting
 * both. Reading only the concept goes the other way as well: the shipped "Normal
 * LS spine" box carries concept `spondylolisthesis`, so a concept test alone would
 * let a normal statement delete the normal.
 *
 * So the sentence is authoritative, and it is read by `isAbnormalFindingsLine` —
 * the precision-first classifier every printed surface already uses to decide
 * which lines to bold, not a new vocabulary. A whole-examination normal never
 * qualifies: "Normal MRI of the lumbosacral spine. No significant disc, canal,
 * foraminal or neural compressive abnormality." reads as a normal on both arms.
 */
export function statesAbnormalImpressionText(
  contribution: string | undefined | null,
): boolean {
  const text = (contribution ?? "").trim();
  if (!text) return false;
  if (assertsStudyNormal(text)) return false;
  return isAbnormalFindingsLine(text);
}

/**
 * Whether one ledger row's OWN conclusion is what suppresses the system normal.
 *
 * Identity first: the system normal patch and the materialised baseline rows are
 * never what withdraws a normal. Then the sentence. A row the radiologist has
 * taken over (`protected`) still counts — their words are an abnormality on the
 * page — but nothing here ever deletes those words; withdrawal is scoped to the
 * system normal patch and `stripContribution` refuses protected text.
 */
export function statesAbnormalImpression(
  patch: AppliedPathologyPatch,
): boolean {
  if (isSystemNormalPatch(patch)) return false;
  if (patch.stale) return false;
  // A baseline row states the examination's normal; it is never the abnormal that
  // withdraws it. The exclusion stays on the row's kind rather than its wording
  // because a baseline row also carries sentences that are not normal statements at
  // all ("Routine six sequences were acquired."), which a wording test would read
  // as anything.
  if (patch.observation?.role === "baseline") return false;
  return statesAbnormalImpressionText(patch.lastRendered.impression);
}

/**
 * Does this ledger row own an abnormal FINDING on the page — the mirror of
 * `statesAbnormalImpression`, reading the row's Findings prose instead of its
 * Conclusion prose?
 *
 * Needed by the pressed impression doors (20-case audit, 2026-10-26): a box
 * whose concept the registry does not flag and whose tile authors no
 * impression sentence (the audit's D3 presets; the cervical Facet arthropathy
 * box) still owns an abnormal sentence in the Findings — and when it does, the
 * residue the press reads is by construction all-normal, so the press's
 * fallback branch would invent "No significant abnormality detected." over the
 * very abnormality the box just wrote. Same identity exclusions as the
 * Conclusion twin: a system normal, a stale row and a baseline row are never
 * the abnormal that suppresses an invention.
 */
export function patchOwnsAbnormalFinding(
  patch: AppliedPathologyPatch,
): boolean {
  if (isSystemNormalPatch(patch)) return false;
  if (patch.stale) return false;
  if (patch.observation?.role === "baseline") return false;
  return statesAbnormalImpressionText(patch.lastRendered.findings);
}

/**
 * Does this report, as it stands, assert an abnormality?
 *
 * CAT-P5 answers that question for the Quick Select door. This is the same question
 * for the doors that open a whole report — a Full Normal Format, the deterministic
 * generator, a dictation bootstrap — where the abnormality is already on the page and
 * the ledger may hold rows the format is about to re-base. Both readings are needed and
 * neither is sufficient: a clicked box whose concept the registry does not flag, and a
 * conclusion the radiologist retyped himself, are the two ways an abnormality stands on
 * a report while the ledger says nothing to a concept test.
 *
 * Normal prose is not mistaken for abnormality. The sentences a normal report carries
 * ("No significant disc bulge or protrusion is seen.", "Normal lumbar lordosis is
 * maintained.") are denials and normality predicates, and `statesAbnormalImpressionText`
 * rejects both — the same classifier the print surface uses to decide what to bold.
 */
export function reportAssertsAbnormality(
  patches: ReadonlyArray<AppliedPathologyPatch>,
  fields: { findings?: string; impression?: string } = {},
): boolean {
  if (suppressesSystemNormal(patches)) return true;
  return [fields.findings, fields.impression]
    .some((text) => splitToSentences(text ?? "").some(statesAbnormalImpressionText));
}

/**
 * Is an abnormal conclusion live in the ledger right now?
 *
 * The union of the two readings, deliberately: the concept rule is the shipped
 * behaviour for baseline-atom tiles whose own sentence names no cue, and the
 * sentence rule is CAT-P5. Neither may be dropped or the other's reports change —
 * deselecting an MRI Lumbar normal tile would stop restoring the normal, and a
 * facet arthropathy would keep printing beneath "Normal MRI of the lumbosacral
 * spine."
 */
export function suppressesSystemNormal(patches: ReadonlyArray<AppliedPathologyPatch>): boolean {
  return hasImpressionworthyAbnormal(patches)
    || patches.some((p) => statesAbnormalImpression(p));
}

/** The same question for a row that is not in the ledger yet — a click in flight. */
export function incomingStatesAbnormalImpression(
  concept: string | null | undefined,
  role: ObservationRole | undefined,
  contribution: string | undefined | null,
): boolean {
  if (role === "baseline") return false;
  if (isImpressionworthyAbnormal(concept ?? null, { role })) return true;
  return statesAbnormalImpressionText(contribution);
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
