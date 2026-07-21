/**
 * usgManualEdit — manual-edit preservation & reconciliation (Phase P2.8).
 *
 * A finding object keeps BOTH its generated text (findingText) and the
 * radiologist's edit (editedText). When parameters change and the text is
 * regenerated, a divergent manual edit is NEVER silently overwritten — the
 * radiologist reconciles (keep manual / replace with generated / merge). Pure
 * and fully unit-testable.
 */

import { type UsgFindingObject } from "./usgFindingBuilder";

export type ManualEditStatus = "generated_only" | "accepted_generated" | "manual_divergent";

/** Relationship between the stored generated text and the radiologist's edit. */
export function manualEditStatus(o: UsgFindingObject): ManualEditStatus {
  const edited = (o.editedText ?? "").trim();
  if (!edited) return "generated_only";
  if (edited === (o.findingText ?? "").trim()) return "accepted_generated";
  return "manual_divergent";
}

export interface RegenResult {
  object: UsgFindingObject;
  manualPreserved: boolean;    // a divergent manual edit was kept
  needsReconciliation: boolean;
}

/**
 * Regenerate a finding's text after a parameter change. Updates findingText /
 * impressionText, but preserves a divergent manual edit and flags that it needs
 * reconciliation. When there was no edit (or the edit had merely accepted the
 * previous generated text), the finding follows the new generated text.
 */
export function regenerate(
  o: UsgFindingObject,
  newGenerated: string,
  newImpression: string,
  timestamp?: string | null,
): RegenResult {
  const status = manualEditStatus(o);
  const base: UsgFindingObject = {
    ...o, findingText: newGenerated, impressionText: newImpression,
    updatedAt: timestamp ?? o.updatedAt ?? null,
  };
  if (status === "manual_divergent") {
    return { object: base, manualPreserved: true, needsReconciliation: true };
  }
  if (status === "accepted_generated") {
    // the edit was just the old generated text → keep it "accepted" by tracking the new one
    return { object: { ...base, editedText: newGenerated }, manualPreserved: false, needsReconciliation: false };
  }
  return { object: base, manualPreserved: false, needsReconciliation: false };
}

export type ManualEditAction = "keep_manual" | "replace_with_generated" | "merge";

/** Apply the radiologist's reconciliation choice. Never destroys wording
 *  without an explicit action. */
export function resolveManualEdit(
  o: UsgFindingObject,
  action: ManualEditAction,
  mergedText?: string,
  timestamp?: string | null,
): UsgFindingObject {
  const stamp = timestamp ?? o.updatedAt ?? null;
  if (action === "replace_with_generated") {
    return { ...o, editedText: null, updatedAt: stamp };
  }
  if (action === "merge") {
    return { ...o, editedText: (mergedText ?? "").trim() || null, updatedAt: stamp };
  }
  return o; // keep_manual — unchanged
}
