/**
 * SpineApCanalMeasurements.tsx — shared AP canal diameter entry UI.
 *
 * Reuses the EXISTING `canalApProvenance` persistence path:
 *   - store.canalApProvenance: CanalApProvenanceMap (keyed by level)
 *   - store.setCanalApCellProvenance(level, provenance)
 *   - markCanalApManualOverride() marks radiologist override
 *   - Persisted via draft.structuredJson.careCanalApProvenance
 *   - Restored via extractCareCanalApProvenance on reopen
 *
 * NO second measurement store. NO new persistence architecture.
 *
 * Measurements do NOT become part of slotKey / concept / laterality identity.
 *
 * Supports cervical (C2-C3 → C6-C7) and lumbar (L1-L2 → L5-S1) routinely.
 * Dorsal measurements are NOT exposed unless the caller explicitly opts in
 * (current clinic workflow does not routinely use dorsal AP measurements).
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
  markCanalApManualOverride,
  parseCanalApNumber,
  type CanalSegment,
} from "@/lib/spineCanalAp";
import {
  CERVICAL_AP_LEVELS,
  LUMBAR_AP_LEVELS,
  formatApMeasurements,
  createCervicalApSet,
  createLumbarApSet,
  type SpineApMeasurementSet,
} from "@/lib/mriSpineCanvasRegions";

export function SpineApCanalMeasurements({
  segment,
  disabled,
}: {
  segment: "cervical" | "lumbar";
  disabled?: boolean;
}) {
  const canalApProvenance = useWorkspace((s) => s.canalApProvenance);
  const setCanalApCellProvenance = useWorkspace((s) => s.setCanalApCellProvenance);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const levels = segment === "cervical" ? [...CERVICAL_AP_LEVELS] : [...LUMBAR_AP_LEVELS];

  const handleChange = useCallback(
    (level: string, rawValue: string) => {
      const num = parseCanalApNumber(rawValue);
      const prov = markCanalApManualOverride(
        canalApProvenance[level] ?? null,
        level,
        num || rawValue,
        segment as CanalSegment,
      );
      setCanalApCellProvenance(level, prov);
    },
    [canalApProvenance, setCanalApCellProvenance, segment],
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
    const set: SpineApMeasurementSet =
      segment === "cervical" ? createCervicalApSet() : createLumbarApSet();
    for (const level of levels) {
      const prov = canalApProvenance[level];
      if (prov?.value) {
        const idx = set.levels.findIndex((l) => l.level === level);
        if (idx >= 0) {
          const n = Number(prov.value);
          set.levels[idx]!.value = Number.isFinite(n) ? n : null;
        }
      }
    }
    return formatApMeasurements(set);
  }, [canalApProvenance, levels, segment]);

  const label = segment === "cervical" ? "Cervical" : "Lumbar";

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
          const prov = canalApProvenance[level];
          const value = prov?.value ?? "";
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
