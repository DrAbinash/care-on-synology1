/**
 * MriDorsoLumbarCanvas.tsx — clinic-facing MRI Dorso-Lumbar Spine canvas.
 *
 * Architectural reference: MriDorsalCanvas.tsx / MriLumbarCanvas.tsx
 *
 * What this canvas is allowed to show is decided by the coverage resolver, not
 * by the examination's name: one row per acquired level, in acquired order, each
 * labelled with the anatomical domain it belongs to and the neural structure it
 * actually contains (spec §4, §5, §12). The thoracolumbar junction appears once,
 * marked as the canonical bridge, because a Dorso-Lumbar study owns T12-L1 a
 * single time — entering it from the thoracic side or the lumbar side edits the
 * same observation.
 *
 * Level list source: `dorsoLumbarLevelEntryOptions(dorsoLumbarNumbering)`, the
 * same resolver the sub-master panel, the AP table and the Findings composer
 * read. No component keeps its own level array.
 *
 * All writes go through `applyMacroBundle` on the one canonical ledger.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspace } from "@/lib/zai-workspace/store";
import type { AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import {
  canonicalDorsoLumbarLevel,
  dorsolumbarCoverageSummary,
  dorsolumbarNumberingBanner,
  dorsolumbarNumberingCaution,
  dorsolumbarStrandedLevels,
  type DorsoLumbarDomain,
  type DorsoLumbarNeuralStructure,
} from "@/lib/mriDorsoLumbarCoverage";
import { dorsoLumbarLevelEntryOptions } from "@/lib/mriDorsoLumbarLevelEntry";
import { dorsoLumbarFindingsOrder } from "@/lib/mriDorsoLumbarValidation";
import { isDorsoLumbarDedicated } from "@/lib/mriDorsoLumbarCatalog";

const DOMAIN_LABEL: Record<DorsoLumbarDomain, string> = {
  thoracic: "Thoracic",
  junction: "TL junction",
  lumbar: "Lumbar",
};

const DOMAIN_CLASS: Record<DorsoLumbarDomain, string> = {
  thoracic: "bg-sky-50 text-sky-800 ring-sky-200",
  junction: "bg-amber-50 text-amber-900 ring-amber-300",
  lumbar: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

const NEURAL_LABEL: Record<DorsoLumbarNeuralStructure, string> = {
  cord: "cord",
  conus: "conus",
  cauda: "cauda equina",
  unknown: "not assessed",
};

function isTextEditingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[contenteditable='true'], .ProseMirror, .cm-editor, [role='textbox']"));
}

/** The canonical level a ledger row belongs to, or "" when it is study-wide. */
function rowLevel(row: AppliedPathologyPatch): string {
  const raw = row.observation?.level ?? row.ownership?.anatomicalSection ?? "";
  return canonicalDorsoLumbarLevel(raw)?.key ?? "";
}

export function MriDorsoLumbarCanvas({
  patches,
  disabled,
  focusedLevel,
  onSelectLevel,
}: {
  patches: AppliedPathologyPatch[];
  disabled?: boolean;
  focusedLevel?: string | null;
  onSelectLevel?: (level: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [navIndex, setNavIndex] = useState(0);
  const state = useWorkspace((s) => s.dorsoLumbarNumbering);
  const composition = useWorkspace((s) => s.studyComposition);
  const rows = useMemo(() => patches.filter((p) => p.id !== "system-normal-study"), [patches]);

  // Coverage is authoritative: unacquired levels have no row at all.
  const levels = useMemo(() => dorsoLumbarLevelEntryOptions(state), [state]);

  const byLevel = useMemo(() => {
    const map = new Map<string, AppliedPathologyPatch[]>();
    for (const row of rows) {
      const key = rowLevel(row);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [rows]);

  // Coverage stranding is shown where the level cards are, because that is the
  // surface the radiologist is reading. The duplicate-junction rule is not
  // repeated here: the sub-master panel raises it next to the tile that caused
  // it and the report-level warning strip owns the full list.
  const warnings = useMemo(
    () => dorsolumbarStrandedLevels(rows, state),
    [rows, state],
  );

  // §25: the applied rows grouped in the recommended report order. Prose stays
  // the composer's; this only shows the shape the ledger currently produces.
  const shape = useMemo(() => dorsoLumbarFindingsOrder(rows, state), [rows, state]);

  const focusIndex = useCallback((idx: number) => {
    const n = levels.length;
    if (n === 0) return;
    const next = ((idx % n) + n) % n;
    setNavIndex(next);
    const entry = levels[next];
    onSelectLevel?.(entry.level);
    document.getElementById(`r2-dl-region-${entry.level}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [levels, onSelectLevel]);

  useEffect(() => {
    if (focusedLevel) {
      const i = levels.findIndex((l) => l.level === focusedLevel);
      if (i >= 0) setNavIndex(i);
    }
  }, [focusedLevel, levels]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      const inCanvas = active === document.body || active === root || (active instanceof Node && root.contains(active));
      if (!inCanvas) return;
      if (e.key === "ArrowDown") { e.preventDefault(); focusIndex(navIndex + 1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); focusIndex(navIndex - 1); return; }
      if (e.key === "Enter") { e.preventDefault(); onSelectLevel?.(levels[navIndex]?.level ?? ""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, focusIndex, navIndex, levels, onSelectLevel]);

  return (
    <div
      ref={rootRef}
      className="space-y-1.5"
      data-testid="mri-dorsolumbar-canvas"
      tabIndex={0}
      role="group"
      aria-label="MRI dorso-lumbar spine region canvas"
    >
      <div className="flex flex-wrap items-center justify-between gap-1 px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-teal-900">
          MRI Dorso-Lumbar Spine Canvas
        </h3>
        <span className="text-[8px] text-muted-foreground" data-testid="mri-dorsolumbar-canvas-range">
          {levels.length > 0
            ? `${levels[0]?.level} → ${levels[levels.length - 1]?.level}`
            : "no levels in the acquired field"}
          {" · ↑↓ navigate"}
        </span>
      </div>

      <p className="text-[9px] leading-snug text-slate-600" data-testid="mri-dorsolumbar-numbering-banner">
        {dorsolumbarNumberingBanner(state)}
      </p>
      <p className="text-[9px] leading-snug text-slate-500" data-testid="mri-dorsolumbar-coverage-summary">
        {dorsolumbarCoverageSummary(state)}
        {isDorsoLumbarDedicated(composition) ? " One examination, one report." : ""}
      </p>
      {dorsolumbarNumberingCaution(state) ? (
        <p
          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[9px] leading-snug text-amber-900"
          data-testid="mri-dorsolumbar-numbering-caution"
        >
          {dorsolumbarNumberingCaution(state)}
        </p>
      ) : null}

      {shape.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" data-testid="mri-dorsolumbar-report-shape">
          <span className="text-[8px] font-bold uppercase text-teal-800">Report shape</span>
          {shape.map((group) => (
            <span
              key={group.section}
              title={`${group.rows.length} applied row(s) · ${group.label}`}
              className="rounded border border-teal-200 bg-white px-1 py-px text-[8px] text-teal-900"
              data-testid={`mri-dorsolumbar-report-section-${group.section}`}
            >
              {group.label} · {group.rows.length}
            </span>
          ))}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-1" data-testid="mri-dorsolumbar-canvas-warnings">
          {warnings.map((w) => (
            <p key={w} className="rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[9px] leading-snug text-rose-900">
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-1.5 sm:grid-cols-1">
        {levels.map((entry, idx) => {
          const active = byLevel.get(entry.level) ?? [];
          const selected = navIndex === idx || focusedLevel === entry.level;
          return (
            <button
              key={entry.level}
              type="button"
              id={`r2-dl-region-${entry.level}`}
              disabled={disabled}
              onClick={() => { setNavIndex(idx); onSelectLevel?.(entry.level); }}
              className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                selected ? "ring-1 ring-sky-400 border-sky-300 bg-white" : "border-slate-200 bg-white/70 hover:bg-white"
              }`}
              data-testid={`mri-dorsolumbar-level-${entry.level}`}
              data-domain={entry.domain}
              data-junction={entry.junction ? "true" : "false"}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold tabular-nums text-slate-800">{entry.label}</span>
                <span className={`rounded px-1 py-px text-[8px] font-semibold uppercase ring-1 ${DOMAIN_CLASS[entry.domain]}`}>
                  {DOMAIN_LABEL[entry.domain]}
                </span>
                <span className="text-[8px] text-slate-500" data-testid={`mri-dorsolumbar-neural-${entry.level}`}>
                  {NEURAL_LABEL[entry.neural]}
                </span>
                {entry.transitional ? (
                  <span className="rounded bg-violet-50 px-1 py-px text-[8px] font-semibold text-violet-800 ring-1 ring-violet-200">
                    transitional
                  </span>
                ) : null}
                {entry.junction ? (
                  <span className="rounded bg-amber-100 px-1 py-px text-[8px] font-semibold text-amber-900 ring-1 ring-amber-300" data-testid={`mri-dorsolumbar-junction-badge-${entry.level}`}>
                    the bridge — recorded once
                  </span>
                ) : null}
                <span className="ml-auto text-[8px] text-slate-500">
                  {active.length === 0 ? "no observations" : `${active.length} observation${active.length === 1 ? "" : "s"}`}
                </span>
              </span>
              {active.length > 0 ? (
                <span className="mt-1 block space-y-0.5">
                  {active.slice(0, 3).map((row) => (
                    <span
                      key={row.id}
                      className="block truncate text-[9px] leading-snug text-slate-600"
                      data-testid={`mri-dorsolumbar-row-${entry.level}`}
                    >
                      {row.observation?.concept ?? row.ownership?.concept ?? "observation"}
                      {" — "}
                      {(row.lastRendered.findings || row.templates.findings || "").replace(/\s+/g, " ").slice(0, 120)}
                    </span>
                  ))}
                  {active.length > 3 ? (
                    <span className="block text-[8px] text-slate-500">+{active.length - 3} more</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
