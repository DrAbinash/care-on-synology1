import { useCallback, useEffect, useRef, useState } from "react";
import { MRI_LUMBAR_ALL_REGIONS } from "@/lib/mriLumbarRegions";
import { MriLumbarLevelBlock } from "./MriLumbarLevelBlock";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import type { LumbarLevelSelection } from "@/lib/mriLumbarRegions";
import { composeLumbarLevelNarrative } from "@/lib/mriLumbarRegions";

function isTextEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true'], .ProseMirror, .cm-editor, [role='textbox']"));
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [navIndex, setNavIndex] = useState(0);
  /** null = uncontrolled; "" = keyboard closed all; key = that region forced open */
  const [openKey, setOpenKey] = useState<string | null>(null);

  const focusIndex = useCallback(
    (idx: number) => {
      const n = MRI_LUMBAR_ALL_REGIONS.length;
      if (n === 0) return;
      const next = ((idx % n) + n) % n;
      setNavIndex(next);
      const region = MRI_LUMBAR_ALL_REGIONS[next];
      onFocusRegion(region.key);
      document.getElementById(`r2-region-${region.key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [onFocusRegion],
  );

  useEffect(() => {
    if (focusedRegionKey) {
      const i = MRI_LUMBAR_ALL_REGIONS.findIndex((r) => r.key === focusedRegionKey);
      if (i >= 0) setNavIndex(i);
    }
  }, [focusedRegionKey]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const root = rootRef.current;
      if (!root) return;
      // Only handle when focus is inside the canvas or nowhere specific on the page body.
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
        const region = MRI_LUMBAR_ALL_REGIONS[navIndex];
        if (!region) return;
        setOpenKey((prev) => (prev === region.key ? "" : region.key));
        onFocusRegion(region.key);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const region = MRI_LUMBAR_ALL_REGIONS[navIndex];
        if (!region) return;
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("r2-cycle-chip", {
            detail: { regionKey: region.key, digit: Number(e.key) },
          }),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, focusIndex, navIndex, onFocusRegion]);

  return (
    <div
      ref={rootRef}
      className="space-y-1.5"
      data-testid="mri-lumbar-canvas"
      tabIndex={0}
      role="group"
      aria-label="MRI lumbar region canvas"
    >
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
          MRI Lumbar Region Canvas
        </h3>
        <span className="text-[8px] text-muted-foreground">
          Anatomical subregions · Study Tab remains LS Spine · ↑↓ navigate · Enter open
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-1">
        {MRI_LUMBAR_ALL_REGIONS.map((region, idx) => (
          <div
            key={region.key}
            id={`r2-region-${region.key}`}
            className={
              focusedRegionKey === region.key || navIndex === idx
                ? "ring-1 ring-sky-400 rounded-md"
                : ""
            }
          >
            <MriLumbarLevelBlock
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
              canalApMm={canalApByLevel?.[region.label] ?? null}
              onFocus={() => {
                setNavIndex(idx);
                onFocusRegion(region.key);
              }}
              onApply={(sel, composed) => onApplyLevel(region.label, region.key, sel, composed)}
              onInsertRegionPhrase={onInsertRegionPhrase}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
