import { formatAnchorChip, type ObservationAnchor } from "@/lib/observationAnchor";

export function ActiveAnchorChip({
  anchor,
  compact,
}: {
  anchor: ObservationAnchor | null;
  compact?: boolean;
}) {
  const label = formatAnchorChip(anchor);
  const unavailable = !anchor?.studyInstanceUID;
  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-md border font-mono",
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]",
        unavailable
          ? "border-slate-200 bg-slate-50 text-slate-500"
          : "border-sky-200 bg-sky-50 text-sky-900",
      ].join(" ")}
      data-testid="active-anchor-chip"
      title={anchor?.seriesInstanceUID ?? "No live viewer context"}
    >
      <span className="font-sans font-bold uppercase tracking-wide text-[8px] opacity-70">
        Anchor
      </span>
      <span>{label}</span>
      {anchor?.viewer ? (
        <span className="rounded bg-white/80 px-1 text-[8px] uppercase text-slate-600">
          {anchor.viewer}
        </span>
      ) : null}
    </div>
  );
}
