/**
 * MriDorsalCanvas.tsx — clinic-facing MRI Dorsal/Thoracic Spine Canvas.
 *
 * Architectural reference: MriLumbarCanvas.tsx / MriCervicalCanvas.tsx
 *
 * Levels: the disc levels inside the acquired coverage, taken from
 * DorsalLevelResolver (mriDorsalNumbering) — the same list the sub-master panel
 * and the AP canal table use, so no component keeps its own level array.
 * Global regions: Alignment, Vertebral bodies/marrow, Cord, Posterior
 * elements, Paraspinal soft tissues
 *
 * Uses applyMacroBundle (via parent onApplyLevel) — same canonical ledger.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MRI_DORSAL_ALL_REGIONS } from "@/lib/mriSpineCanvasRegions";
import { MriDorsalLevelBlock } from "./MriDorsalLevelBlock";
import { useWorkspace } from "@/lib/zai-workspace/store";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import { dorsalLevelKeyStrings } from "@/lib/mriDorsalNumbering";
import type { DorsalLevelSelection } from "@/lib/mriDorsalLevelState";
import { deriveDorsalLevelBlockDisplay } from "@/lib/mriDorsalLevelState";
import { planSpineNormalSeed } from "@/lib/spineCanvasSeed";

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
  const dorsalNumbering = useWorkspace((s) => s.dorsalNumbering);
  // Acquired coverage is authoritative: the level rows come from the same
  // DorsalLevelResolver the sub-master panel and the AP table use, so a study
  // that never reached T12-L1 cannot offer a T12-L1 row (spec §4).
  const regions = useMemo(() => {
    const allowed = new Set(dorsalLevelKeyStrings(dorsalNumbering).map((k) => k.toUpperCase()));
    return MRI_DORSAL_ALL_REGIONS.filter((r) => allowed.has(r.key.toUpperCase()));
  }, [dorsalNumbering]);

  // Normal-seed plan: which disc levels are still EMPTY (same display
  // derivation the level blocks render from), over the coverage-limited
  // level list — a study that never reached T12-L1 never offers to seed it.
  // One click applies a normal disc observation to each of them through
  // this canvas' own onApplyLevel path — per-level bundle, canonical ledger,
  // individually correctable. Levels that already carry structure or prose
  // are never in the plan.
  const seedPlan = useMemo(
    () =>
      planSpineNormalSeed(
        regions
          .filter((r) => r.kind === "disc-level")
          .map((r) => ({
            key: r.key,
            label: r.label,
            displayKind: deriveDorsalLevelBlockDisplay(patches, r.label, findingsText ?? "", []).kind,
          })),
      ),
    [regions, patches, findingsText],
  );

  const focusIndex = useCallback(
    (idx: number) => {
      const n = regions.length;
      if (n === 0) return;
      const next = ((idx % n) + n) % n;
      setNavIndex(next);
      const region = regions[next];
      onFocusRegion(region.key);
      document.getElementById(`r2-dors-region-${region.key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [onFocusRegion, regions],
  );

  useEffect(() => {
    if (focusedRegionKey) {
      const i = regions.findIndex((r) => r.key === focusedRegionKey);
      if (i >= 0) setNavIndex(i);
    }
  }, [focusedRegionKey, regions]);

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
        const region = regions[navIndex];
        if (!region) return;
        setOpenKey((prev) => (prev === region.key ? "" : region.key));
        onFocusRegion(region.key);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, focusIndex, navIndex, onFocusRegion, regions]);

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
        <span className="text-[8px] text-muted-foreground" data-testid="mri-dorsal-canvas-range">
          {regions.length > 0 ? `${regions[0]?.key} → ${regions[regions.length - 1]?.key}` : "no levels in the acquired field"}
          {" · ↑↓ navigate · Enter open"}
        </span>
      </div>
      {!disabled && seedPlan.seeds.length > 0 && (
        <div className="flex items-center gap-1.5 px-0.5">
          <button
            type="button"
            className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-900 hover:border-emerald-500"
            title="Applies a normal disc observation to every level that is still empty. Levels with findings or narrative are never touched."
            onClick={() => {
              for (const seed of seedPlan.seeds) {
                onApplyLevel(seed.label, seed.key, { morphology: "normal" });
              }
            }}
            data-testid="mri-dorsal-seed-normals"
          >
            Seed {seedPlan.seeds.length} empty level{seedPlan.seeds.length === 1 ? "" : "s"} normal
          </button>
          <span className="text-[8px] text-muted-foreground">empty levels only · corrections stay yours</span>
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-1">
        {regions.map((region, idx) => (
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
