/**
 * Safe shortcut gates for Reporting Workspace comfort polish.
 * Never intercept ordinary typing / dictation / accessibility shortcuts.
 */

export function isEditableTarget(
  target: EventTarget | null | undefined,
): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.("[contenteditable='true']"));
}

export function isAiInstructionTextarea(
  target: EventTarget | null | undefined,
): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el) return false;
  if (el.id === "ai-micro-command") return true;
  return Boolean(el.closest?.("#ai-micro-command"));
}

/**
 * Alt+U undo-last-abnormal — only outside ordinary text entry.
 * (Modifier prevents conflict with typing "u".)
 */
export function shouldHandleAltUndoAbnormal(e: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.key !== "u" && e.key !== "U") return false;
  if (isEditableTarget(e.target)) return false;
  return true;
}

/**
 * Ctrl+Shift+Enter is Save & Next. Shift keeps it off plain Ctrl+Enter
 * finalize and off the AI-instruction Run key.
 */
export function shouldHandleSaveAndNextShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return Boolean(e.ctrlKey && e.shiftKey && e.key === "Enter");
}

/** Findings and impression must both have text before Save & Next finalizes. */
export function saveAndNextFieldsReady(fields: {
  findings?: string | null;
  impression?: string | null;
}): boolean {
  return Boolean(fields.findings?.trim() && fields.impression?.trim());
}

/**
 * Ctrl/Cmd+Enter finalizes — unless the AI instruction textarea is focused
 * (that field owns Ctrl/Cmd+Enter to Run).
 */
export function shouldHandleFinalizeShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return false;
  if (e.key !== "Enter") return false;
  if (isAiInstructionTextarea(e.target)) return false;
  return true;
}

/**
 * Ctrl/Cmd+S save — allowed even in editors (modifier prevents conflict).
 */
export function shouldHandleSaveShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return false;
  return e.key === "s" || e.key === "S";
}

/** Shortcuts must not fire while typing in unrelated editors (no modifier). */
export function shortcutBlockedWhileTyping(e: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  return isEditableTarget(e.target);
}

/**
 * Clinical history has TWO directions and one shared rule: the keystroke is the workspace's only
 * outside the report editors. Findings, Impression, Recommendation and every free-text field are
 * contenteditable or native inputs, and the browser owns Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z inside them
 * — undoing a stray comma must never roll back a Quick Select observation. The handler is bound in
 * the capture phase, so an editor-focus guard here is the only thing between a radiologist's typing
 * history and the clinical ledger.
 *
 * `Ctrl+Shift+Z` used to mean UNDO. Both spellings of redo (`Ctrl/Cmd+Shift+Z` and the Windows
 * `Ctrl+Y`) now mean REDO, and `Ctrl/Cmd+Z` — which did nothing at all outside an editor — means
 * UNDO. That is a changed keystroke, so it is stated in the shortcut help and the command palette
 * rather than left to be discovered mid-report.
 */
export function shouldHandleClinicalUndoShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  if (e.key !== "z" && e.key !== "Z") return false;
  return !isEditableTarget(e.target);
}

/** Redo: `Ctrl/Cmd+Shift+Z` everywhere, plus `Ctrl+Y` where Windows radiologists expect it. */
export function shouldHandleClinicalRedoShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (e.altKey || isEditableTarget(e.target)) return false;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) return e.key === "z" || e.key === "Z";
  // `Ctrl+Y` only, never `Cmd+Y`: on macOS that combination belongs to the system.
  if (e.ctrlKey && !e.metaKey && !e.shiftKey) return e.key === "y" || e.key === "Y";
  return false;
}

/**
 * The one thing that makes a refused Undo or Redo explainable.
 *
 * Both directions refuse for the same two reasons and both were already telling the radiologist
 * about them — but only for undo, and only as two inline toasts inside the key handler. Redo
 * inherits the same refusals from the same store guards, so it inherits the same wording with the
 * verb swapped, rather than going silent and leaving the keyboard pressed against a report that
 * has already changed underneath it.
 *
 * `null` means nothing to report: the step went through, or there was no frame at all, which is
 * "there is nothing to undo/redo" and not an error.
 */
export function clinicalHistoryRefusal(
  direction: "undo" | "redo",
  stepped: boolean,
  frame: { activeStudyId: string | null } | null,
  ws: { activeStudyId: string | null; isFinalized: boolean },
): { title: string; description: string } | null {
  const verb = direction === "undo" ? "Undo" : "Redo";
  if (stepped || !frame) return null;
  if (frame.activeStudyId !== ws.activeStudyId) {
    return {
      title: `${verb} refused — that edit belongs to a different study`,
      description:
        direction === "undo"
          ? "The workspace switched study since that edit was made, so restoring it would have written "
            + "the previous patient's report text into this one. Nothing was changed."
          : "The workspace switched study since you stepped back, so replaying that edit would have "
            + "written the previous patient's report text into this one. Nothing was changed.",
    };
  }
  if (ws.isFinalized) {
    // The recovery named here really exists, and was measured: Report Hub's Withdraw button calls
    // POST /api/patient-reports/:id/withdraw-signature, which nulls the signature, returns the report
    // to "draft", sets the bound worklist row to REPORT_IN_PROGRESS and clears its reportId and
    // deliveryStatus (patient-reports.ts:2838-2970), so all three of `assertDraftWritable`'s
    // conditions go with the signature. It deliberately does NOT offer amend or unlock: amend needs a
    // structured document this clinic never produces, and there is no unlock affordance anywhere.
    return {
      title: `${verb} refused — the report is signed`,
      // One contiguous literal, deliberately: two ratchet suites
      // (refusedSaveIsNotAFailedSave, signedReportCorrectionTruth) pin this file as a
      // member of the shared-sentence family by looking for the sentence in the
      // source, and a `+` split in the middle of it makes the sentence invisible to
      // exactly the check whose whole job is to keep it identical across refusals.
      description:
        "Nothing was changed. To correct it, withdraw the signature from Report Hub — only the signer or an administrator can. The report returns to draft and the study can be edited and signed again.",
    };
  }
  return null;
}
