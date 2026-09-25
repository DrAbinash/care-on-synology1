/** Ctrl/Cmd+Enter submits AI instructions; plain Enter inserts a newline.
 *  Shift is reserved for Save & Next (Ctrl+Shift+Enter). */
export function shouldSubmitAiInstructionKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  if (e.shiftKey) return false;
  return e.key === "Enter" && Boolean(e.ctrlKey || e.metaKey);
}
