/**
 * Narrow gate for "Undo Last Abnormal" — reuses workspace `undoLastPatch`
 * without rewriting the undo stack. Only enables when the latest reversible
 * snapshot corresponds to an abnormal pathology / Quick Select style overlay
 * (not voice, AI-draft, system-normal, or manual-only edits).
 */
import type { InsertSource } from "@/lib/reportFieldMerge";
import { isSystemNormalPatch } from "@/lib/conceptCanon/normalImpression";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";

export type AbnormalUndoSnapshot = {
  appliedPathologyPatches: AppliedPathologyPatch[];
};

export type AbnormalUndoState = {
  lastPatchSnapshot: AbnormalUndoSnapshot | null;
  appliedPathologyPatches: AppliedPathologyPatch[];
  isFinalized: boolean;
};

const ABNORMAL_SOURCES = new Set<InsertSource>([
  "quick-select",
  "quick-findings",
  "macro",
  "structured-template",
  "structured-template-candidate",
  "companion",
  "template",
  "template-a",
  "template-b",
]);

function isAbnormalPathologyPatch(patch: AppliedPathologyPatch): boolean {
  if (isSystemNormalPatch(patch)) return false;
  if (patch.id.startsWith("voice-")) return false;
  if (patch.source === "manual" || patch.source === "radiologist-voice") return false;
  if (patch.source === "ai-draft" || patch.source === "system") return false;
  if (!ABNORMAL_SOURCES.has(patch.source)) return false;
  return true;
}

function patchContentKey(p: AppliedPathologyPatch): string {
  return [
    p.lastRendered.findings ?? "",
    p.lastRendered.impression ?? "",
    p.lastRendered.recommendation ?? "",
    p.observation?.concept ?? "",
    p.observation?.level ?? "",
    p.observation?.laterality ?? "",
  ].join("\u0001");
}

/**
 * Identify the abnormal pathology patch introduced or updated by the latest
 * reversible snapshot, if any.
 */
export function findLastReversibleAbnormalPatch(
  state: AbnormalUndoState,
): AppliedPathologyPatch | null {
  const snap = state.lastPatchSnapshot;
  if (!snap) return null;
  const beforeById = new Map(snap.appliedPathologyPatches.map((p) => [p.id, p]));

  for (let i = state.appliedPathologyPatches.length - 1; i >= 0; i -= 1) {
    const p = state.appliedPathologyPatches[i]!;
    if (!isAbnormalPathologyPatch(p)) continue;
    const prev = beforeById.get(p.id);
    if (!prev) return p;
    if (patchContentKey(prev) !== patchContentKey(p)) return p;
  }
  return null;
}

export function canUndoLastAbnormal(
  state: AbnormalUndoState,
  opts?: { locked?: boolean },
): boolean {
  if (opts?.locked) return false;
  if (state.isFinalized) return false;
  if (!state.lastPatchSnapshot) return false;
  return findLastReversibleAbnormalPatch(state) != null;
}

export function describeLastAbnormalForUndo(state: AbnormalUndoState): string {
  const p = findLastReversibleAbnormalPatch(state);
  if (!p) return "last abnormal selection";
  const concept = (p.observation?.concept || p.ownership.conflictGroup || "").replace(/_/g, " ").trim();
  const level = (p.observation?.level || "").trim();
  if (concept && level) return `${level} ${concept}`;
  if (concept) return concept;
  const text = (p.lastRendered.findings || p.lastRendered.impression || "").trim();
  if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  return "last abnormal selection";
}

/** What was restored — prefer baseline sentence the abnormal replaced. */
export function describeRestoredBaseline(state: AbnormalUndoState): string {
  const p = findLastReversibleAbnormalPatch(state);
  const baseline =
    p?.replacedBaseline?.findings?.[0]
    || p?.ownership.baselineReplaces
    || p?.replacedBaseline?.impression?.[0]
    || "";
  const trimmed = baseline.trim();
  if (trimmed) {
    return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
  }
  return describeLastAbnormalForUndo(state);
}
