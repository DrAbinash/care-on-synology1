import { ActiveAnchorChip } from "./ActiveAnchorChip";
import type { ObservationAnchor } from "@/lib/observationAnchor";

export function AnchorRail({
  anchor,
  seriesHints,
}: {
  anchor: ObservationAnchor | null;
  /** Actual series descriptions from FRAMES when available. */
  seriesHints?: string[];
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-sky-50/40 px-2 py-1.5"
      data-testid="anchor-rail"
    >
      <ActiveAnchorChip anchor={anchor} />
      {seriesHints && seriesHints.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="anchor-rail-series">
          {seriesHints.slice(0, 8).map((s) => {
            const active = Boolean(
              anchor?.seriesDescription
              && s.toLowerCase() === anchor.seriesDescription.toLowerCase(),
            );
            return (
              <span
                key={s}
                className={[
                  "rounded px-1.5 py-0.5 text-[9px] font-medium border",
                  active
                    ? "border-sky-500 bg-sky-600 text-white"
                    : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {s}
              </span>
            );
          })}
        </div>
      ) : (
        <span className="text-[9px] text-muted-foreground">
          Series list follows FRAMES viewer when loaded
        </span>
      )}
    </div>
  );
}
