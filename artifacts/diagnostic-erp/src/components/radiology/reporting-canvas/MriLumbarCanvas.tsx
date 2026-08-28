import { MRI_LUMBAR_ALL_REGIONS } from "@/lib/mriLumbarRegions";
import { MriLumbarLevelBlock } from "./MriLumbarLevelBlock";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { LumbarLevelSelection } from "@/lib/mriLumbarRegions";
import { composeLumbarLevelNarrative } from "@/lib/mriLumbarRegions";

export function MriLumbarCanvas({
  patches,
  findingsText,
  disabled,
  focusedRegionKey,
  highlightedLevel,
  canalApByLevel,
  onFocusRegion,
  onApplyLevel,
  onInsertRegionPhrase,
}: {
  patches: AppliedPathologyPatch[];
  findingsText?: string;
  disabled?: boolean;
  focusedRegionKey?: string | null;
  /** Level label to highlight from ledger click (e.g. L4-L5). */
  highlightedLevel?: string | null;
  canalApByLevel?: Record<string, number | null | undefined>;
  onFocusRegion: (key: string) => void;
  onApplyLevel: (
    level: string,
    regionKey: string,
    sel: LumbarLevelSelection,
    composed: ReturnType<typeof composeLumbarLevelNarrative>,
  ) => void;
  onInsertRegionPhrase?: (regionKey: string, phrase: string, concept: string) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid="mri-lumbar-canvas">
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
          MRI Lumbar Region Canvas
        </h3>
        <span className="text-[8px] text-muted-foreground">
          Anatomical subregions · Study Tab remains LS Spine
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-1">
        {MRI_LUMBAR_ALL_REGIONS.map((region) => (
          <div
            key={region.key}
            id={`r2-region-${region.key}`}
            className={focusedRegionKey === region.key ? "ring-1 ring-sky-400 rounded-md" : ""}
          >
            <MriLumbarLevelBlock
              region={region}
              patches={patches}
              findingsText={findingsText}
              disabled={disabled}
              highlighted={Boolean(
                highlightedLevel
                && region.kind === "disc-level"
                && region.label.toUpperCase() === highlightedLevel.toUpperCase(),
              )}
              canalApMm={canalApByLevel?.[region.label] ?? null}
              onFocus={() => onFocusRegion(region.key)}
              onApply={(sel, composed) => onApplyLevel(region.label, region.key, sel, composed)}
              onInsertRegionPhrase={onInsertRegionPhrase}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
