/**
 * ReadinessBar — compact P2.1 readiness surface for the USG Companion top bar.
 * Deterministic, advisory. Renders a coverage % and an expandable list of
 * outstanding items (each naming the organ/field). Never blocks saving.
 */
import { useState } from "react";
import type { ReadinessResult } from "@/lib/usgReadiness";

const SEV_DOT: Record<string, string> = {
  info: "bg-slate-400",
  advisory: "bg-sky-500",
  warning: "bg-amber-500",
};

export default function ReadinessBar({ readiness }: { readiness: ReadinessResult }) {
  const [open, setOpen] = useState(false);
  const warnings = readiness.items.filter((i) => i.severity === "warning").length;
  const advisories = readiness.items.filter((i) => i.severity === "advisory").length;
  const tone = readiness.percent >= 100 && warnings === 0 ? "text-emerald-600" : warnings > 0 ? "text-amber-600" : "text-slate-600 dark:text-slate-300";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 ${tone}`}
        title="Report readiness (advisory)"
        data-testid="usg-readiness-bar"
      >
        <span className="font-mono font-semibold">Readiness {readiness.percent}%</span>
        {warnings > 0 && <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-1.5">{warnings}!</span>}
        {advisories > 0 && <span className="rounded-full bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 px-1.5">{advisories}</span>}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-30 p-2">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            {readiness.reviewedOrgans}/{readiness.expectedOrgans} organs reviewed
          </div>
          {readiness.items.length === 0 ? (
            <div className="text-xs text-emerald-600 py-1">All clear — nothing outstanding.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {readiness.items.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                  <span className={`mt-1 h-2 w-2 rounded-full flex-none ${SEV_DOT[i.severity] ?? "bg-slate-400"}`} aria-hidden />
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
          {readiness.pcpndtBlocking && (
            <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300 border-t border-slate-200 dark:border-slate-700 pt-1">
              Finalization will be blocked server-side until PCPNDT / Form F is complete.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
