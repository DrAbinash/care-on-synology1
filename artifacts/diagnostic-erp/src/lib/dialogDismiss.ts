/**
 * Radix Dialog can leave `document.body { pointer-events: none }` after close
 * when a native print dialog races dismissable-layer cleanup. That freezes
 * Cancel / X / Confirm on Day Close. Always clear the stuck style on dismiss.
 */
export function restoreBodyPointerEvents(): void {
  if (typeof document === "undefined") return;
  document.body.style.removeProperty("pointer-events");
}

/**
 * Close a controlled dialog, clear stuck body pointer-events, then run `after`
 * on the next tick so print windows open after Radix unmount cleanup.
 */
export function dismissDialogThen(
  setOpen: (open: boolean) => void,
  after?: () => void,
  delayMs = 350,
): void {
  setOpen(false);
  restoreBodyPointerEvents();
  if (!after) return;
  // globalThis so vitest/node (no window) and browsers both work
  globalThis.setTimeout(() => {
    restoreBodyPointerEvents();
    after();
  }, delayMs);
}
