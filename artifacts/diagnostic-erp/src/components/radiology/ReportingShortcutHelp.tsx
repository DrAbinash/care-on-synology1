import { X, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";

const SHORTCUT_GROUPS: Array<{ title: string; rows: Array<{ keys: string; action: string }> }> = [
  {
    title: "Report",
    rows: [
      { keys: "Ctrl + S", action: "Save draft" },
      { keys: "Ctrl + Enter", action: "Finalize report" },
      { keys: "Ctrl + K", action: "Command palette" },
      { keys: "/", action: "Focus Quick Findings search" },
      { keys: "?", action: "Show this shortcut list" },
    ],
  },
  {
    title: "Quick Findings",
    rows: [
      { keys: "Alt + 1–9", action: "Toggle Nth finding (★ favorites first)" },
      { keys: "Ctrl + 1–9", action: "Toggle study tab in Quick panel" },
    ],
  },
  {
    title: "Queue",
    rows: [
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
      { keys: "Esc", action: "Close panel / cancel" },
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
      { keys: "Space (hold)", action: "Push-to-talk (outside editors)" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ReportingShortcutHelp({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full rounded-lg border bg-background shadow-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
        data-testid="shortcut-help-overlay"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Keyboard size={16} /> Keyboard shortcuts
          </div>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X size={14} />
          </Button>
        </div>
        <div className="grid gap-3 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">{group.title}</p>
              <div className="space-y-1">
                {group.rows.map((row) => (
                  <div key={row.keys} className="flex items-center justify-between gap-3 text-[11px]">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] shrink-0">{row.keys}</kbd>
                    <span className="text-muted-foreground text-right">{row.action}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground pt-1 border-t">
          Press <kbd className="rounded border px-1 font-mono">?</kbd> outside a text field to toggle this panel.
        </p>
      </div>
    </div>
  );
}
