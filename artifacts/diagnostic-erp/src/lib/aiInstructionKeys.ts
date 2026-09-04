/** Ctrl/Cmd+Enter submits AI instructions; plain Enter inserts a newline. */
export function shouldSubmitAiInstructionKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return e.key === "Enter" && Boolean(e.ctrlKey || e.metaKey);
}
