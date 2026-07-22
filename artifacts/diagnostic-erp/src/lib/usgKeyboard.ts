/**
 * usgKeyboard — the USG Companion shortcut registry + suppression logic (P2.9).
 *
 * Rules:
 *  - plain-key shortcuts NEVER fire while a text/number field or the editor is
 *    focused (only modifier-based shortcuts do);
 *  - editing shortcuts are disabled in read-only / locked states;
 *  - every action also remains reachable by mouse (the UI wires both).
 * Bare letters here deliberately avoid the organ-jump hotkeys already used by
 * the shell (L G B P S R K U T W O V). Pure + unit-testable.
 */

export interface UsgShortcut {
  id: string;
  combo: string;      // display label
  label: string;
  editing: boolean;   // disabled when read-only
  modifier: boolean;  // fires even while typing
}

export const USG_SHORTCUTS: UsgShortcut[] = [
  { id: "save_draft", combo: "⌘/Ctrl+S", label: "Save draft", editing: true, modifier: true },
  { id: "finalize", combo: "⌘/Ctrl+↵", label: "Sign / finalize", editing: true, modifier: true },
  { id: "normal_all", combo: "⇧N", label: "Normal for all remaining", editing: true, modifier: false },
  { id: "mark_normal", combo: "N", label: "Mark active organ normal", editing: true, modifier: false },
  { id: "open_builder", combo: "F", label: "Open finding builder", editing: true, modifier: false },
  { id: "focus_findings", combo: "E", label: "Focus report editor", editing: true, modifier: false },
  { id: "open_measurements", combo: "M", label: "Open measurement review", editing: false, modifier: false },
  { id: "show_readiness", combo: "I", label: "Show readiness issues", editing: false, modifier: false },
  { id: "next_organ", combo: "]", label: "Next organ", editing: false, modifier: false },
  { id: "prev_organ", combo: "[", label: "Previous organ", editing: false, modifier: false },
  { id: "toggle_viewer", combo: "\\", label: "Collapse / expand viewer", editing: false, modifier: false },
  { id: "help", combo: "?", label: "Show this shortcut help", editing: false, modifier: false },
];

export interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** Is the event target a field/editor where plain-key shortcuts must not fire? */
export function isTypingTarget(tagName: string | undefined | null, isContentEditable?: boolean): boolean {
  if (isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test((tagName ?? "").toUpperCase());
}

const PLAIN_MAP: Record<string, string> = {
  n: "mark_normal", f: "open_builder", e: "focus_findings", m: "open_measurements",
  i: "show_readiness", "]": "next_organ", "[": "prev_organ", "\\": "toggle_viewer", "?": "help",
};

function gate(id: string, readOnly: boolean): string | null {
  const sc = USG_SHORTCUTS.find((s) => s.id === id);
  if (sc?.editing && readOnly) return null;
  return id;
}

/** Resolve a keydown to a shortcut id, honouring typing-suppression + read-only. */
export function resolveShortcut(e: KeyEventLike, opts: { typing: boolean; readOnly: boolean }): string | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === "s" || e.key === "S")) return gate("save_draft", opts.readOnly);
  if (mod && e.key === "Enter") return gate("finalize", opts.readOnly);
  if (opts.typing) return null;                         // plain keys never fire while typing
  if (e.shiftKey && (e.key === "N" || e.key === "n")) return gate("normal_all", opts.readOnly);
  const id = PLAIN_MAP[e.key.toLowerCase()];
  return id ? gate(id, opts.readOnly) : null;
}
