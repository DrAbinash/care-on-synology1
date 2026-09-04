/**
 * Translate workspace shortcut IDs (from matchWorkspaceShortcut) into either
 * a canonical WorkspaceCommand for the dispatcher, or a local layout action
 * handled by the workspace chrome (panel/viewer refs).
 *
 * Legacy workspace had this remapping inline; the modular workspace lost it
 * and was dispatching raw shortcut IDs (`next-study`) that are not in
 * WORKSPACE_COMMANDS — so Next/Previous/Park/Quick Search never ran.
 */
import type { WorkspaceCommand } from "@/lib/workspaceCommands";
import { isWorkspaceCommand } from "@/lib/workspaceCommands";
import type { WorkspaceShortcut } from "@/lib/workspaceReportState";

export type WorkspaceLayoutAction =
  | "toggle-left-panel"
  | "toggle-right-panel"
  | "toggle-viewer"
  | "escape";

export type ResolvedWorkspaceShortcut =
  | { kind: "command"; command: WorkspaceCommand }
  | { kind: "layout"; action: WorkspaceLayoutAction };

const SHORTCUT_TO_COMMAND: Partial<Record<WorkspaceShortcut, WorkspaceCommand>> = {
  save: "save",
  finalize: "finalize",
  "focus-mode": "focus-mode",
  "select-template-1": "select-template-1",
  "select-template-2": "select-template-2",
  "select-template-3": "select-template-3",
  "select-template-4": "select-template-4",
  "select-template-5": "select-template-5",
  "select-template-6": "select-template-6",
  // Remaps — shortcut IDs ≠ command IDs
  "next-study": "next",
  "previous-study": "previous",
  "park-study": "park",
  quickselect: "focus-quick-search",
  "open-study": "open-viewer",
};

const LAYOUT_ACTIONS = new Set<WorkspaceLayoutAction>([
  "toggle-left-panel",
  "toggle-right-panel",
  "toggle-viewer",
  "escape",
]);

/**
 * Map a matched shortcut to a dispatcher command or a local layout action.
 * Returns null only when given null (no match).
 */
export function resolveWorkspaceShortcut(
  shortcut: WorkspaceShortcut | null,
): ResolvedWorkspaceShortcut | null {
  if (!shortcut) return null;
  if (LAYOUT_ACTIONS.has(shortcut as WorkspaceLayoutAction)) {
    return { kind: "layout", action: shortcut as WorkspaceLayoutAction };
  }
  const mapped = SHORTCUT_TO_COMMAND[shortcut];
  if (mapped && isWorkspaceCommand(mapped)) {
    return { kind: "command", command: mapped };
  }
  // Unknown shortcut id — refuse rather than dispatching a non-command string.
  return null;
}

/** True when focus is inside ordinary text entry (or the AI instruction field). */
export function isWorkspaceTextEntryTarget(
  target: EventTarget | null | undefined,
): boolean {
  const el = target as HTMLElement | null | undefined;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  if (el.id === "ai-micro-command") return true;
  if (el.closest?.("#ai-micro-command")) return true;
  return Boolean(el.closest?.("[contenteditable='true']"));
}
