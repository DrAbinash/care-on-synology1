/**
 * ShortcutOverlay — discoverable P2.9 keyboard-shortcut help. Dismissable,
 * replayable. Lists the shortcut registry; all actions are also reachable by
 * mouse (this is help only, not the handler).
 */
import { USG_SHORTCUTS } from "@/lib/usgKeyboard";

export default function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Close">×</button>
        </div>
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {USG_SHORTCUTS.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{s.label}</span>
              <kbd className="font-mono text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">{s.combo}</kbd>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">
          Plain-key shortcuts are disabled while typing in a field; editing shortcuts are disabled when the study is locked. Every action is also available by mouse.
        </p>
      </div>
    </div>
  );
}
