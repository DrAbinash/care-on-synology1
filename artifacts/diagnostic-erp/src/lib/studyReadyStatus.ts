/**
 * Single study-ready status line — derived from ACTUAL startup actions only.
 * Undo is offered only when an automatic startup mutation is safely reversible.
 */

export type StudyReadyKind =
  | "restored_draft"
  | "applied_normal_format"
  | "protocol_blank"
  | "empty_start"
  | "restored_draft_with_protocol"
  | "quiet";

export type StudyReadyStatus = {
  kind: StudyReadyKind;
  /** Compact one-line copy for the status strip. */
  label: string;
  /** True only when an automatic startup mutation is safely reversible. */
  canUndo: boolean;
};

export type StudyReadyInputs = {
  /** Server draft was hydrated into the editor. */
  restoredDraft: boolean;
  /** Normal/Screening whole-report format was auto-applied this open. */
  appliedNormalFormat: boolean;
  /** Display name of the auto-applied format (when appliedNormalFormat). */
  normalFormatName?: string | null;
  /** Protocol was resolved/loaded (may be without report body). */
  protocolLoaded: boolean;
  /** Protocol display name when known. */
  protocolName?: string | null;
  /** Report body is still empty and Start Report is available. */
  emptyNeedsStart: boolean;
};

/**
 * Derive ONE status from startup facts. Never claims "Applied Normal…" unless
 * appliedNormalFormat is true.
 */
export function deriveStudyReadyStatus(input: StudyReadyInputs): StudyReadyStatus {
  if (input.appliedNormalFormat) {
    const name = (input.normalFormatName ?? "").trim() || "Normal format";
    return {
      kind: "applied_normal_format",
      label: `Applied ${name}`,
      canUndo: true,
    };
  }

  if (input.restoredDraft && input.protocolLoaded) {
    const proto = (input.protocolName ?? "").trim();
    return {
      kind: "restored_draft_with_protocol",
      label: proto ? `Restored draft · protocol ${proto}` : "Restored your draft",
      canUndo: false,
    };
  }

  if (input.restoredDraft) {
    return {
      kind: "restored_draft",
      label: "Restored your draft",
      canUndo: false,
    };
  }

  if (input.protocolLoaded && input.emptyNeedsStart) {
    const proto = (input.protocolName ?? "").trim();
    return {
      kind: "protocol_blank",
      label: proto ? `Protocol loaded · blank report (${proto})` : "Protocol loaded · blank report",
      canUndo: false,
    };
  }

  if (input.emptyNeedsStart) {
    return {
      kind: "empty_start",
      label: "Empty report · Start Report",
      canUndo: false,
    };
  }

  if (input.protocolLoaded) {
    const proto = (input.protocolName ?? "").trim();
    return {
      kind: "protocol_blank",
      label: proto ? `Protocol loaded · ${proto}` : "Protocol loaded",
      canUndo: false,
    };
  }

  return { kind: "quiet", label: "", canUndo: false };
}
