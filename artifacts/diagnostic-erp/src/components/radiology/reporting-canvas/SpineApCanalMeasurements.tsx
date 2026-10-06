/**
 * SpineApCanalMeasurements.tsx — shared AP canal diameter entry UI.
 *
 * This is a VIEW of the canonical record, not a second owner of it. It reads
 * `canalApProvenance[level]` and writes through the store's single manual
 * writer, so:
 *   - typing a number keeps the caliper's own number beside it
 *   - the cell stays linked to its annotation and can still refresh
 *   - the draft is marked dirty, so the value survives autosave
 *   - a level spelled "T8-T9" and one spelled "D8-D9" cannot both exist
 *
 * NO second measurement store. NO new persistence architecture.
 *
 * Measurements do NOT become part of slotKey / concept / laterality identity.
 *
 * Supports cervical (C2-C3 → C7-T1), lumbar (L1-L2 → L5-S1 / transitional) and
 * dorsal (D1-D2 → acquired top level) segments. Each segment's rows come from
 * the shared level vocabulary, so the table never offers a level the study did
 * not acquire; measurements stay optional and radiologist-overridable.
 *
 * UX:
 *   - numeric mm fields
 *   - Tab / Enter progression to next field
 *   - "mm" displayed automatically
 *   - generates a report measurement block (via formatApMeasurements)
 *   - persists through save/reopen
 *   - remains editable (radiologist override)
 */

import { useCallback, useMemo, useRef } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  canalApValue,
  canonicalizeCanalLevel,
  levelsForCanalSegment,
  type CanalSegment,
} from "@/lib/spineCanalAp";
import {
  formatApMeasurements,
  type SpineApMeasurementSet,
} from "@/lib/mriSpineCanvasRegions";
import { lumbarApCanalLevels } from "@/lib/mriSpineNumbering";
import { dorsalApCanalLevels } from "@/lib/mriDorsalNumbering";

export function SpineApCanalMeasurements({
  segment,
  disabled,
}: {
  segment: "cervical" | "lumbar" | "dorsal";
  disabled?: boolean;
}) {
  const canalApProvenance = useWorkspace((s) => s.canalApProvenance);
  const recordCanalApManualValue = useWorkspace((s) => s.recordCanalApManualValue);
  const lumbarNumbering = useWorkspace((s) => s.lumbarNumbering);
  const dorsalNumbering = useWorkspace((s) => s.dorsalNumbering);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Lumbar rows come from the numbering resolver, so a transitional vertebra
  // cannot leave the AP table one segment out of step with the level rows
  // (spec §5). Dorsal rows come from the coverage resolver, so an AP value can
  // never be offered for a level the study did not acquire (dorsal spec §10).
  // Cervical keeps its routine list.
  // Rows are keyed and labelled by the canonical level, so the table, the stored
  // record and the report cannot disagree about which disc a number belongs to.
  // The dorsal resolver still speaks T-form; the junction appears only when the
  // numbering says the conus was acquired.
  const levels = (segment === "cervical"
    ? [...levelsForCanalSegment("cervical")]
    : segment === "dorsal"
      ? dorsalApCanalLevels(dorsalNumbering)
      : lumbarApCanalLevels(lumbarNumbering)
  ).map((level) => canonicalizeCanalLevel(level) ?? level);

  const handleChange = useCallback(
    (level: string, rawValue: string) => {
      recordCanalApManualValue(level, rawValue, segment as CanalSegment);
    },
    [recordCanalApManualValue, segment],
  );

  const handleKeyDown = useCallback(
    (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        const next = inputsRef.current[idx + 1];
        if (next) next.focus();
      }
    },
    [],
  );

  const reportBlock = useMemo(() => {
    // Built from the same `levels` array the input grid renders, so a row's
    // measurement can never be dropped from the report block.
    const set: SpineApMeasurementSet = {
      segment,
      levels: levels.map((level) => ({ level, value: null })),
    };
    levels.forEach((level, idx) => {
      const n = canalApValue(canalApProvenance[level]);
      if (n == null) return;
      const row = set.levels[idx];
      if (row) row.value = n;
    });
    return formatApMeasurements(set);
  }, [canalApProvenance, levels, segment]);

  const label = segment === "cervical" ? "Cervical" : segment === "dorsal" ? "Dorsal" : "Lumbar";

  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50/50 px-2 py-1.5"
      data-testid={`spine-ap-canal-${segment}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-700">
          {label} Canal AP Diameter
        </span>
        <span className="text-[8px] text-muted-foreground">mm · Tab/Enter → next</span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {levels.map((level, idx) => {
          const shown = canalApValue(canalApProvenance[level]);
          const value = shown == null ? "" : String(shown);
          return (
            <label key={level} className="flex flex-col gap-0.5">
              <span className="text-[8px] font-bold text-slate-600">{level}</span>
              <input
                ref={(el) => { inputsRef.current[idx] = el; }}
                type="number"
                step="0.1"
                disabled={disabled}
                value={value}
                onChange={(e) => handleChange(level, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                placeholder="—"
                className="h-6 w-full rounded border border-slate-200 px-1 text-[10px] tabular-nums"
                data-testid={`spine-ap-input-${segment}-${level}`}
              />
              <span className="text-[7px] text-slate-400">mm</span>
            </label>
          );
        })}
      </div>
      {reportBlock ? (
        <div className="mt-1.5 rounded border border-dashed border-slate-200 bg-white px-1.5 py-1">
          <pre className="whitespace-pre-wrap text-[9px] text-slate-700" data-testid={`spine-ap-report-${segment}`}>
            {reportBlock}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
