import type { CoverageMark, CoverageStatus } from "@/lib/coverageMarks";
import { MRI_LUMBAR_ALL_REGIONS } from "@/lib/mriLumbarRegions";

const STATUS_STYLE: Record<CoverageStatus, string> = {
  unopened: "bg-slate-100 text-slate-600 border-slate-200",
  viewed: "bg-amber-50 text-amber-800 border-amber-200",
  partial: "bg-orange-50 text-orange-800 border-orange-200",
  reviewed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  waived: "bg-violet-50 text-violet-800 border-violet-200",
};

export function CoverageCockpit({
  marks,
  onJump,
  onMarkReviewed,
  onWaive,
  disabled,
}: {
  marks: CoverageMark[];
  onJump: (regionKey: string) => void;
  onMarkReviewed: (regionKey: string) => void;
  onWaive: (regionKey: string, reason: string) => void;
  disabled?: boolean;
}) {
  const byKey = new Map(marks.map((m) => [m.regionKey, m]));
  const advisories = marks.filter((m) => m.status === "unopened" || m.status === "viewed");

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white/90 p-2"
      data-testid="coverage-cockpit"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
          Coverage
        </div>
        <div className="text-[9px] text-muted-foreground">
          Advisory only — VIEWED ≠ REVIEWED · never blocks sign-off
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {MRI_LUMBAR_ALL_REGIONS.map((r) => {
          const m = byKey.get(r.key);
          const status: CoverageStatus = m?.status ?? "unopened";
          return (
            <div
              key={r.key}
              className={["inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px]", STATUS_STYLE[status]].join(" ")}
              data-testid={`coverage-${r.key}`}
              data-coverage-status={status}
            >
              <button
                type="button"
                className="font-semibold hover:underline"
                disabled={disabled}
                onClick={() => onJump(r.key)}
                title="Jump to region"
              >
                {r.label}
              </button>
              <span className="uppercase opacity-80">{status}</span>
              {status !== "reviewed" && status !== "waived" ? (
                <button
                  type="button"
                  className="underline opacity-80 hover:opacity-100"
                  disabled={disabled}
                  onClick={() => onMarkReviewed(r.key)}
                >
                  Mark
                </button>
              ) : null}
              {status !== "waived" ? (
                <button
                  type="button"
                  className="opacity-60 hover:opacity-100"
                  disabled={disabled}
                  onClick={() => {
                    const reason = window.prompt("Waive reason (optional)", "Not applicable") ?? "Not applicable";
                    onWaive(r.key, reason);
                  }}
                  title="Not applicable / waive"
                >
                  N/A
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {advisories.length > 0 ? (
        <div className="mt-1.5 space-y-0.5" data-testid="coverage-advisories">
          {advisories.slice(0, 4).map((a) => (
            <div key={a.regionKey} className="flex items-center gap-2 text-[9px] text-amber-800">
              <span>
                {a.status === "unopened"
                  ? `${a.regionKey} has no review mark.`
                  : `${a.regionKey} was viewed but not marked reviewed.`}
              </span>
              <button type="button" className="underline" disabled={disabled} onClick={() => onJump(a.regionKey)}>
                Jump
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
