/**
 * The `?` shortcut-help overlay's rows — kept in lib (not inside the
 * component) so a contract test can pin every advertised combo against the
 * real shortcut matrix (lib/workspaceReportState.matchWorkspaceShortcut) and
 * the direct handlers in useWorkspaceCommands.
 *
 * U12 — the old rows drifted from reality: they advertised an "Alt + 1–9 →
 * Toggle Nth finding" that no code implemented (Alt+digits jump report
 * sections) and a bare "Ctrl + 1–9 → study tabs" that double-fired with the
 * ultrasound-template binding, while real shortcuts (Ctrl+I, Ctrl+Shift+V,
 * Alt+U, bare N/P/Q) went unlisted. A help overlay that lies is worse than
 * none for a keyboard-first radiologist.
 */
export type ShortcutHelpRow = { keys: string; action: string };
export type ShortcutHelpGroup = { title: string; rows: ShortcutHelpRow[] };

export const SHORTCUT_GROUPS: ShortcutHelpGroup[] = [
  {
    title: "Report",
    rows: [
      { keys: "Ctrl + S", action: "Save draft" },
      { keys: "Ctrl + P", action: "Print like final" },
      { keys: "Ctrl + Enter", action: "Finalize report" },
      { keys: "Ctrl + Shift + Enter", action: "Save & Next" },
      { keys: "Ctrl + I", action: "AI auto-impression from findings" },
      { keys: "Ctrl + K", action: "Command palette" },
      { keys: "/", action: "Focus Quick Findings search" },
      { keys: "?", action: "Show this shortcut list" },
    ],
  },
  {
    title: "Quick Findings",
    rows: [
      { keys: "Alt + 1–9", action: "Jump to report section N" },
      { keys: "Ctrl + 1–9", action: "Toggle study tab (Quick Add open) · US template 1–6 (otherwise, outside editors)" },
    ],
  },
  {
    title: "Queue",
    rows: [
      { keys: "N", action: "Next study (outside text fields)" },
      { keys: "P", action: "Previous study (outside text fields)" },
      { keys: "Q", action: "Toggle reading queue panel" },
      { keys: "Ctrl + Shift + N", action: "Next study" },
      { keys: "Ctrl + Shift + P", action: "Previous study" },
      { keys: "Ctrl + Shift + K", action: "Park study" },
      { keys: "Ctrl + Shift + F", action: "Focus mode (max editor space)" },
    ],
  },
  {
    title: "Layout",
    rows: [
      { keys: "Alt + [", action: "Toggle left panel" },
      { keys: "Alt + ]", action: "Toggle right panel" },
      { keys: "Alt + \\", action: "Toggle embedded viewer" },
      { keys: "Alt + O", action: "Open external viewer" },
      { keys: "Alt + U", action: "Undo last abnormal apply" },
      { keys: "Esc", action: "Close panel / cancel" },
    ],
  },
  {
    title: "Undo",
    rows: [
      { keys: "Ctrl + Z", action: "Undo last clinical change (outside text editors)" },
      { keys: "Ctrl + Shift + Z / Ctrl + Y", action: "Redo last undone change (outside text editors)" },
    ],
  },
  {
    title: "MRI Lumbar Canvas",
    rows: [
      { keys: "↑ / ↓", action: "Move focus between level blocks" },
      { keys: "Enter", action: "Open / close focused level editor" },
      { keys: "1–5", action: "Cycle chips in Disc / Side / Canal / Foram / Modic rows" },
    ],
  },
  {
    title: "Voice",
    rows: [
      { keys: "Ctrl + Space", action: "Toggle voice dictation" },
      { keys: "Ctrl + Shift + V", action: "Focus voice bar / toggle listen" },
      { keys: "Space (hold)", action: "Push-to-talk (outside editors)" },
    ],
  },
];
