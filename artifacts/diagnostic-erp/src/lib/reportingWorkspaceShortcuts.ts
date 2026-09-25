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
