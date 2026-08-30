/**
 * Thin bridge so the Zustand format apply engine can set CARE reporting region
 * without owning React study-setup state. Workspace registers callbacks once.
 * Never carries DICOM / ERP identity — region name only.
 */

export type FormatApplyBridge = {
  /** Study Tab names from radiology_study_tabs (or current catalog). */
  availableRegions: () => string[];
  /** Current primary reporting region (matchedStudyRegion). */
  currentRegion: () => string | null;
  /** Sets reporting region via selectPrimaryRegion — never touches DICOM UIDs. */
  applyReportingRegion: (regionName: string) => void;
  /**
   * Invalidate in-flight autosave after format content lands so a pending
   * timer cannot commit pre-format text. Workspace bumps saveGenerationRef.
   */
  invalidatePendingAutosave?: () => void;
};

let bridge: FormatApplyBridge | null = null;

export function setFormatApplyBridge(next: FormatApplyBridge | null): void {
  bridge = next;
}

export function getFormatApplyBridge(): FormatApplyBridge | null {
  return bridge;
}
