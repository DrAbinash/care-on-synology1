/**
 * MriDorsalCanvas.tsx — clinic-facing MRI Dorsal/Thoracic Spine Canvas.
 *
 * Architectural reference: MriLumbarCanvas.tsx / MriCervicalCanvas.tsx
 *
 * Levels: T1-T2 through T12-L1 (12 disc levels)
 * Global regions: Alignment, Vertebral bodies/marrow, Cord, Posterior
 * elements, Paraspinal soft tissues
 *
 * Uses applyMacroBundle (via parent onApplyLevel) — same canonical ledger.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MRI_DORSAL_ALL_REGIONS } from "@/lib/mriSpineCanvasRegions";
import { MriDorsalLevelBlock } from "./MriDorsalLevelBlock";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { DorsalLevelSelection } from "@/lib/mriDorsalLevelState";

function isTextEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true'], .ProseMirror, .cm-editor, [role='textbox']"));
}

export function MriDorsalCanvas({
  patches,
  findingsText,
  disabled,
  focusedRegionKey,
  highlightedLevel,
  onFocusRegion,
  onApplyLevel,
  onInsertRegionPhrase,
}: {
  patches: AppliedPathologyPatch[];
  findingsText?: string;
  disabled?: boolean;
  focusedRegionKey?: string | null;
  highlightedLevel?: string | null;
  onFocusRegion: (key: string) => void;
  onApplyLevel: (
    level: string,
    regionKey: string,
    sel: DorsalLevelSelection,
  ) => void;
  onInsertRegionPhrase?: (regionKey: string, phrase: string, concept: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [navIndex, setNavIndex] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const focusIndex = useCallback(
    (idx: number) => {
      const n = MRI_DORSAL_ALL_REGIONS.length;
      if (n === 0) return;
      const next = ((idx % n) + n) % n;
      setNavIndex(next);
      const region = MRI_DORSAL_ALL_REGIONS[next];
      onFocusRegion(region.key);
      document.getElementById(`r2-dors-region-${region.key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [onFocusRegion],
  );

  useEffect(() => {
    if (focusedRegionKey) {
      const i = MRI_DORSAL_ALL_REGIONS.findIndex((r) => r.key === focusedRegionKey);
      if (i >= 0) setNavIndex(i);
    }
  }, [focusedRegionKey]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      const inCanvas = active === document.body || active === root || (active instanceof Node && root.contains(active));
      if (!inCanvas) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusIndex(navIndex + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        focusIndex(navIndex - 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const region = MRI_DORSAL_ALL_REGIONS[navIndex];
        if (!region) return;
        setOpenKey((prev) => (prev === region.key ? "" : region.key));
        onFocusRegion(region.key);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, focusIndex, navIndex, onFocusRegion]);

  return (
    <div
      ref={rootRef}
      className="space-y-1.5"
      data-testid="mri-dorsal-canvas"
      tabIndex={0}
      role="group"
      aria-label="MRI dorsal spine region canvas"
    >
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-teal-900">
          MRI Dorsal Spine Canvas
        </h3>
        <span className="text-[8px] text-muted-foreground">
          T1-T2 → T12-L1 · ↑↓ navigate · Enter open
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-1">
        {MRI_DORSAL_ALL_REGIONS.map((region, idx) => (
          <div
            key={region.key}
            id={`r2-dors-region-${region.key}`}
            className={
              focusedRegionKey === region.key || navIndex === idx
                ? "ring-1 ring-sky-400 rounded-md"
                : ""
            }
          >
            <MriDorsalLevelBlock
              region={region}
              patches={patches}
              findingsText={findingsText}
              disabled={disabled}
              forceOpen={openKey === null ? null : openKey === region.key}
              highlighted={Boolean(
                highlightedLevel
                && region.kind === "disc-level"
                && region.label.toUpperCase() === highlightedLevel.toUpperCase(),
              )}
              onFocus={() => {
                setNavIndex(idx);
                onFocusRegion(region.key);
              }}
              onApply={(sel) => onApplyLevel(region.label, region.key, sel)}
              onInsertRegionPhrase={onInsertRegionPhrase}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
