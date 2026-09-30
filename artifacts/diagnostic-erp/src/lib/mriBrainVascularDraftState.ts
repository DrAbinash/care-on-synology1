/**
 * mriBrainVascularDraftState.ts — persistence seam for the vascular technique state.
 *
 * A radiologist's statement about what was acquired ("this was a non-contrast TOF,
 * there was no vessel-wall sequence") is a clinical decision, not a UI setting: it is
 * what every strong vascular sentence in the report is gated on. If it were only
 * re-derived from the Technique free text on reopen, a correction made yesterday
 * would silently revert today and the already-written findings would lose the gate
 * that allowed them.
 *
 * So the state is stored in the draft envelope under `careVascularTechnique`, read
 * back defensively (the column is untrusted JSON from the database), and folded over
 * the fresh text derivation by `withDerivedVascularTechnique` — manual answers win,
 * derived answers fill the gaps.
 *
 * Follows the existing `canalApProvenance` path exactly: client payload key →
 * api-server envelope key → `extractCare…` on reopen.
 *
 * Pure functions only — no store, no React.
 */

import {
  VASCULAR_TECHNIQUE_KEYS,
  defaultVascularTechnique,
  type VascularTechniqueKey,
  type VascularTechniqueState,
} from "./mriBrainVascularTechnique";

const DESIGNATION_NOTE_LIMIT = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flags(raw: unknown): Partial<Record<VascularTechniqueKey, boolean>> {
  const out: Partial<Record<VascularTechniqueKey, boolean>> = {};
  if (!isRecord(raw)) return out;
  for (const key of VASCULAR_TECHNIQUE_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/**
 * Parse untrusted envelope JSON into a complete state. Unknown keys, non-boolean
 * values and a malformed object are discarded rather than trusted — a corrupted
 * technique bag must never open a gate.
 */
export function normalizeVascularTechniqueState(raw: unknown): VascularTechniqueState | null {
  if (!isRecord(raw)) return null;
  const hasAcquired = isRecord(raw.acquired);
  const hasManual = isRecord(raw.manual);
  if (!hasAcquired && !hasManual && raw.designationNote == null) return null;
  const base = defaultVascularTechnique();
  const acquired = { ...base.acquired, ...flags(raw.acquired) };
  const manual = flags(raw.manual);
  const note = typeof raw.designationNote === "string" ? raw.designationNote.trim() : "";
  return {
    acquired,
    manual,
    designationNote: note ? note.slice(0, DESIGNATION_NOTE_LIMIT) : null,
  };
}

/** Read `careVascularTechnique` from a draft structured_json column (envelope or bare). */
export function extractCareVascularTechnique(column: unknown): VascularTechniqueState | null {
  if (!isRecord(column)) return null;
  return normalizeVascularTechniqueState(column.careVascularTechnique ?? column.vascularTechnique);
}

/**
 * True when the radiologist has said nothing: every flag is whatever the text
 * derivation produced and there is no designation. Pristine state is not written to
 * the draft at all, so old reports gain no new envelope key from this feature.
 */
export function isPristineVascularTechnique(state: VascularTechniqueState): boolean {
  return (
    Object.keys(state.manual).length === 0 &&
    !state.designationNote?.trim()
  );
}

/** Payload for the autosave request; `undefined` means "write nothing". */
export function vascularTechniquePayload(
  state: VascularTechniqueState | null | undefined,
): VascularTechniqueState | undefined {
  if (!state || isPristineVascularTechnique(state)) return undefined;
  return {
    acquired: { ...state.acquired },
    manual: { ...state.manual },
    designationNote: state.designationNote?.trim() || null,
  };
}
