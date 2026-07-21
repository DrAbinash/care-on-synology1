/**
 * OrganRail — organ navigation for the USG Companion Workspace (P0).
 *
 * Data-driven (organs come from usgOrganLibrary), never hard-coded text. Each
 * organ shows a status dot (untouched / normal / abnormal / incomplete) and an
 * optional single-key hotkey hint. Selecting an organ focuses its report
 * section and finding library. "Normal for all remaining" is offered here.
 */

import type { OrganStatus } from "@/lib/usgReportComposer";

export interface OrganRailItem {
  key: string;
  label: string;
  hotkey?: string;
}

export interface OrganRailProps {
  organs: OrganRailItem[];
  statusByOrgan: Record<string, OrganStatus>;
  activeOrgan: string;
  onSelect: (key: string) => void;
  onNormalAllRemaining: () => void;
  disabled?: boolean;
}

const DOT: Record<OrganStatus, string> = {
  untouched: "bg-slate-300 dark:bg-slate-600",
  normal: "bg-emerald-500",
  abnormal: "bg-amber-500",
  incomplete: "bg-sky-500",
};
const DOT_LABEL: Record<OrganStatus, string> = {
  untouched: "Not reported",
  normal: "Normal",
  abnormal: "Abnormal",
  incomplete: "Incomplete",
};

export default function OrganRail({
  organs, statusByOrgan, activeOrgan, onSelect, onNormalAllRemaining, disabled,
}: OrganRailProps) {
  return (
    <div className="flex flex-col gap-1" data-testid="usg-organ-rail">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
        Organs
      </div>
      {organs.map((o) => {
        const status = statusByOrgan[o.key] ?? "untouched";
        const active = o.key === activeOrgan;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(o.key)}
            aria-pressed={active}
            title={`${o.label} — ${DOT_LABEL[status]}`}
            className={[
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
              active
                ? "bg-teal-50 dark:bg-teal-950/40 ring-1 ring-teal-400/60 text-teal-900 dark:text-teal-100"
                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200",
            ].join(" ")}
          >
            <span className={`h-2 w-2 rounded-full flex-none ${DOT[status]}`} aria-hidden />
            <span className="flex-1 truncate">{o.label}</span>
            {o.hotkey && (
              <kbd className="text-[10px] font-mono text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded px-1">
                {o.hotkey}
              </kbd>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNormalAllRemaining}
        disabled={disabled}
        className="mt-2 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50"
        title="Fill every organ that is still blank with its normal statement (Shift+N)"
      >
        Normal for all remaining
        <kbd className="text-[10px] font-mono border border-emerald-300/60 dark:border-emerald-700 rounded px-1">⇧N</kbd>
      </button>
    </div>
  );
}
