/**
 * DorsoLumbarApCanalMeasurements.tsx — canal AP diameters for one dedicated
 * Dorso-Lumbar examination (dorso-lumbar spec §13).
 *
 * One table, one cell per acquired level, drawn from `dorsolumbarApLevels` — the
 * same resolver the canvas rows and the sub-master panel use. T12-L1 appears
 * exactly once, so a junction measurement cannot be entered twice (once thinking
 * thoracic, once thinking lumbar).
 *
 * The provenance mechanism is the canonical one: every cell is written through
 * the store's single manual writer, tagged with the segment that measurement
 * belongs to (thoracic and bridge rows are dorsal lettering, lumbar rows
 * lumbar). The report block is then formatted by the shared
 * `formatApMeasurements`, which is why there are two labelled groups
 * rather than a fourth invented segment: `canalSegmentFromSpine` deliberately
 * answers null for a Dorso-Lumbar study, because no single cervical / dorsal /
 * lumbar table describes a study that crosses the junction.
 *
 * No stenosis threshold is applied. The number is the radiologist's measurement
 * and the interpretation stays theirs (spec §13).
 */

import { useCallback, useMemo, useRef } from "react";

import { useWorkspace } from "@/lib/zai-workspace/store";
import { canalApValueAt, canalRows } from "@/lib/spineCanalAp";
import {
  formatApMeasurements,
  type SpineApMeasurementSet,
} from "@/lib/mriSpineCanvasRegions";
import {
  dorsolumbarApLevels,
  dorsolumbarCanalSegment,
} from "@/lib/mriDorsoLumbarCoverage";
import { CanalApRow } from "./CanalApRow";

export function DorsoLumbarApCanalMeasurements({ disabled }: { disabled?: boolean }) {
  const canalApProvenance = useWorkspace((s) => s.canalApProvenance);
  const state = useWorkspace((s) => s.dorsoLumbarNumbering);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // `canalRows` puts the rows in the same lettering the record is stored under.
  // The dorso-lumbar resolver speaks the report's letters (T-form, and T12-L1 at
  // the bridge) while every writer canonicalises to D-form, so a row that was not
  // canonicalised would save under D8-D9 and read back from T8-T9 — a cell that
  // clears itself as you type, and a report block that prints nothing.
  const levels = useMemo(() => canalRows(dorsolumbarApLevels(state)), [state]);

  const handleKeyDown = useCallback((idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      const next = inputsRef.current[idx + 1];
      if (next) next.focus();
    }
  }, []);

  // Two report groups, built from the same rows the grid renders, so a measured
  // level can never be dropped from the block or counted twice.
  const reportBlocks = useMemo(() => {
    const groups: Array<{ segment: "dorsal" | "lumbar"; set: SpineApMeasurementSet }> = [
      { segment: "dorsal", set: { segment: "dorsal", levels: [] } },
      { segment: "lumbar", set: { segment: "lumbar", levels: [] } },
    ];
    for (const level of levels) {
      const target = groups.find((g) => g.segment === dorsolumbarCanalSegment(level))!;
      target.set.levels.push({ level, value: canalApValueAt(canalApProvenance, level) });
    }
    return groups
      .map((g) => formatApMeasurements(g.set))
      .filter((text) => text.length > 0);
  }, [canalApProvenance, levels]);

  return (
    <div
      className="rounded-md border border-slate-200 bg-slate-50/50 px-2 py-1.5"
      data-testid="spine-ap-canal-dorsolumbar"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-700">
          Dorso-Lumbar Canal AP Diameter
        </span>
        <span className="text-[8px] text-muted-foreground">mm · Tab/Enter → next · one row per acquired level</span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1" data-testid="spine-ap-grid-dorsolumbar">
        {levels.map((level, idx) => {
          const rowSegment = dorsolumbarCanalSegment(level);
          return (
            <CanalApRow
              key={level}
              level={level}
              segment={rowSegment}
              segmentTag={rowSegment}
              testIdPrefix="spine-ap-input-dorsolumbar"
              disabled={disabled}
              setInputRef={(el) => { inputsRef.current[idx] = el; }}
              onKeyDown={(e) => handleKeyDown(idx, e)}
            />
          );
        })}
      </div>
      {levels.length === 0 ? (
        <p className="mt-1 text-[8px] text-slate-500" data-testid="spine-ap-empty-dorsolumbar">
          No acquired levels are recorded, so no canal measurement is offered.
        </p>
      ) : null}
      {reportBlocks.map((text) => (
        <div key={text} className="mt-1.5 rounded border border-dashed border-slate-200 bg-white px-1.5 py-1">
          <pre className="whitespace-pre-wrap text-[9px] text-slate-700" data-testid="spine-ap-report-dorsolumbar">
            {text}
          </pre>
        </div>
      ))}
      <p className="mt-1 text-[7px] leading-snug text-slate-400">
        Values are the radiologist's measurements; no threshold converts a number into a severity.
      </p>
    </div>
  );
}
