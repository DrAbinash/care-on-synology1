/**
 * Compact MEASURE intent bar — radiologist chooses meaning before the next caliper.
 */
import { useWorkspaceSelector } from "@/lib/zai-workspace/store";
import type { MeasurementIntent } from "@/lib/structuredViewerMeasurements";
import { levelsForCanalSegment, resolveActiveCanalSegment } from "@/lib/spineCanalAp";
import { cn } from "@/lib/utils";

const INTENTS: Array<{ id: MeasurementIntent; label: string }> = [
  { id: "CANAL_AP", label: "Canal AP" },
  { id: "LESION", label: "Lesion" },
  { id: "MIDLINE_SHIFT", label: "Midline" },
  { id: "OTHER", label: "Other" },
];

export function MeasureIntentBar({
  regionHint,
  disabled,
}: {
  regionHint?: string | null;
  disabled?: boolean;
}) {
  const intent = useWorkspaceSelector((s) => s.measurementIntent);
  const setIntent = useWorkspaceSelector((s) => s.setMeasurementIntent);
  const level = useWorkspaceSelector((s) => s.canalIntentLevel);
  const setLevel = useWorkspaceSelector((s) => s.setCanalIntentLevel);
  const reportingContext = useWorkspaceSelector((s) => s.reportingContext);
  const dorsalForced = useWorkspaceSelector((s) => s.dorsalCanalForced);
  const setDorsalForced = useWorkspaceSelector((s) => s.setDorsalCanalForced);

  const naturalSegment = resolveActiveCanalSegment({
    spineSegment: reportingContext.spineSegment,
    regionHint,
    reportingRegion: reportingContext.region,
    studyDescription: reportingContext.studyDescription,
    forceDorsal: false,
  });
  const segment = resolveActiveCanalSegment({
    spineSegment: reportingContext.spineSegment,
    regionHint,
    reportingRegion: reportingContext.region,
    studyDescription: reportingContext.studyDescription,
    forceDorsal: dorsalForced,
  });

  const levels = segment ? levelsForCanalSegment(segment) : [];

  return (
    <div className="space-y-1.5" data-testid="measure-intent-bar">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Measure
      </div>
      <div className="flex flex-wrap gap-1">
        {INTENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            disabled={disabled}
            data-testid={`measure-intent-${i.id}`}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium border transition",
              intent === i.id
                ? "bg-emerald-600 text-white border-emerald-700"
                : "bg-white border-border text-muted-foreground hover:border-emerald-400",
            )}
            onClick={() => setIntent(intent === i.id ? null : i.id)}
          >
            {i.label}
          </button>
        ))}
        {naturalSegment === "dorsal" ? null : (
          <button
            type="button"
            disabled={disabled}
            className="rounded px-2 py-0.5 text-[10px] border border-dashed text-muted-foreground"
            data-testid="measure-force-dorsal"
            title="Show dorsal canal table (uncommon studies)"
            onClick={() => setDorsalForced(!dorsalForced)}
          >
            {dorsalForced ? "Hide dorsal" : "Dorsal canal…"}
          </button>
        )}
      </div>
      {intent === "CANAL_AP" && levels.length > 0 ? (
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Level
          <select
            className="h-6 rounded border border-border bg-white px-1 text-[10px] font-mono"
            data-testid="canal-intent-level"
            disabled={disabled}
            value={level ?? ""}
            onChange={(e) => setLevel(e.target.value || null)}
          >
            <option value="">Select…</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
