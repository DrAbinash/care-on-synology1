/**
 * Pick the best default right-panel tab when a study opens.
 * Priority: Copilot alerts → pending viewer measurements → priors → saved per-modality tab → Quick.
 */

export type RightTabId =
  | "copilot" | "quickselect" | "prior" | "measurements" | "ai" | "templates";

const VALID_TABS = new Set<string>([
  "copilot", "quickselect", "prior", "measurements", "ai", "templates",
]);

export function modalityTabStorageKey(modality: string | null | undefined): string {
  const mod = (modality ?? "").trim().toUpperCase();
  const bucket = mod.startsWith("MR") ? "MRI"
    : mod.startsWith("CT") ? "CT"
      : mod.startsWith("US") || mod === "USG" ? "USG"
        : mod || "OTHER";
  return `radiology_right_tab_${bucket}`;
}

export function loadSavedRightTab(modality: string | null | undefined): RightTabId | null {
  try {
    const raw = localStorage.getItem(modalityTabStorageKey(modality));
    if (raw && VALID_TABS.has(raw)) return raw as RightTabId;
  } catch { /* ignore */ }
  return null;
}

export function saveRightTab(modality: string | null | undefined, tab: string) {
  if (!VALID_TABS.has(tab)) return;
  try {
    localStorage.setItem(modalityTabStorageKey(modality), tab);
  } catch { /* ignore */ }
}

export function pickDefaultRightTab(opts: {
  copilotEnabled: boolean;
  copilotAlertCount: number;
  priorReportsTotal: number;
  pendingViewerMeasurements: number;
  modality: string | null | undefined;
}): RightTabId {
  if (opts.copilotEnabled && opts.copilotAlertCount > 0) return "copilot";
  if (opts.pendingViewerMeasurements > 0) return "measurements";
  if (opts.priorReportsTotal > 0) return "prior";
  const saved = loadSavedRightTab(opts.modality);
  if (saved) return saved;
  return "quickselect";
}
