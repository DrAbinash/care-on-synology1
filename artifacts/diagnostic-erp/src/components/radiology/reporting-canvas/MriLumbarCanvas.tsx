import { MRI_LUMBAR_ALL_REGIONS } from "@/lib/mriLumbarRegions";
import { MriLumbarLevelBlock } from "./MriLumbarLevelBlock";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { LumbarLevelSelection } from "@/lib/mriLumbarRegions";
import { composeLumbarLevelNarrative } from "@/lib/mriLumbarRegions";

export function MriLumbarCanvas({
  patches,
  disabled,
  focusedRegionKey,
  onFocusRegion,
  onApplyLevel,
}: {
  patches: AppliedPathologyPatch[];
  disabled?: boolean;
  focusedRegionKey?: string | null;
  onFocusRegion: (key: string) => void;
  onApplyLevel: (
    level: string,
    regionKey: string,
    sel: LumbarLevelSelection,
    composed: ReturnType<typeof composeLumbarLevelNarrative>,
  ) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid="mri-lumbar-canvas">
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
          MRI Lumbar Region Canvas
        </h3>
        <span className="text-[8px] text-muted-foreground">
          Level = clinical choice · Anchor = image provenance
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
              disabled={disabled}
              onFocus={() => onFocusRegion(region.key)}
              onApply={(sel, composed) => onApplyLevel(region.label, region.key, sel, composed)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
