/**
 * DynamicFindingBuilder — parameter-driven finding entry for the active organ
 * (Phase P1). It is inline (not a modal), shows a live deterministic preview,
 * and delegates ALL text generation to usgFindingBuilder (which itself reuses
 * the platform's structured-finding template engine). No AI is involved.
 */

import { useMemo, useState, useEffect } from "react";
import {
  generateUsgFinding,
  initialFindingValues,
  parseMeasurement,
  type UsgFindingDef,
  type UsgFindingParam,
  type UsgFindingObject,
} from "@/lib/usgFindingBuilder";

export interface DynamicFindingBuilderProps {
  organLabel: string;
  defs: UsgFindingDef[];
  author?: string | null;
  onAddFinding: (obj: UsgFindingObject) => void;
}

// A numeric field stores "<value> <unit>" so the builder engine re-parses the
// unit; splitting here keeps the two inputs controlled.
function splitNumeric(raw: string, def: UsgFindingParam): { num: string; unit: string } {
  const p = parseMeasurement(raw, { defaultUnit: def.unit, normalizeTo: def.normalizeTo ?? def.unit });
  return { num: p.value != null ? String(p.value) : "", unit: p.unit || def.unit || "" };
}

export default function DynamicFindingBuilder({ organLabel, defs, author, onAddFinding }: DynamicFindingBuilderProps) {
  const [defId, setDefId] = useState<string>(defs[0]?.id ?? "");
  const def = useMemo(() => defs.find((d) => d.id === defId) ?? defs[0], [defs, defId]);
  const [values, setValues] = useState<Record<string, string>>(() => (def ? initialFindingValues(def) : {}));

  // Reset the form when the selected finding (or the organ's finding set) changes.
  useEffect(() => {
    if (def) setValues(initialFindingValues(def));
  }, [def]);

  const preview = useMemo(() => (def ? generateUsgFinding(def, values, { author }) : null), [def, values, author]);

  if (!def) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 italic px-1 py-2">
        No structured findings authored for {organLabel} yet — use the report text field, or mark the organ normal.
      </div>
    );
  }

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const setNumber = (p: UsgFindingParam, num: string, unit: string) =>
    set(p.key, num.trim() ? `${num.trim()} ${unit}` : "");

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3" data-testid="usg-finding-builder">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-mono uppercase tracking-wider text-teal-700 dark:text-teal-300">Finding builder</span>
        {defs.length > 1 && (
          <select
            value={defId}
            onChange={(e) => setDefId(e.target.value)}
            className="text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1"
          >
            {defs.map((d) => <option key={d.id} value={d.id}>{d.findingType}</option>)}
          </select>
        )}
        {defs.length === 1 && <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{def.findingType}</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {def.params.map((p) => (
          <label key={p.key} className="flex flex-col gap-0.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {p.label}{p.required && <span className="text-rose-500"> *</span>}
            </span>
            <ParamField param={p} value={values[p.key] ?? ""} onSet={(v) => set(p.key, v)} onSetNumber={(n, u) => setNumber(p, n, u)} />
          </label>
        ))}
      </div>

      {/* Live deterministic preview */}
      <div className="mt-3 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-1">Preview</div>
        <p className="text-sm text-slate-800 dark:text-slate-100">{preview?.object.findingText || "—"}</p>
        {preview?.object.impressionText && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1"><b>Impression:</b> {preview.object.impressionText}</p>
        )}
        {preview?.object.derived.filter((d) => d.value != null).map((d) => (
          <p key={d.key} className="text-xs text-indigo-600 dark:text-indigo-300 mt-1 font-mono">
            {d.label}: {String(d.value)} {d.unit ?? ""} <span className="text-slate-400">({d.source})</span>
          </p>
        ))}
        {preview?.object.warnings.map((w, i) => (
          <p key={i} className="text-xs text-amber-700 dark:text-amber-300 mt-1">⚠ {w}</p>
        ))}
      </div>

      <button
        type="button"
        onClick={() => preview && onAddFinding(preview.object)}
        className="mt-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm px-3 py-1.5"
      >
        Add to report
      </button>
    </div>
  );
}

function ParamField({
  param, value, onSet, onSetNumber,
}: {
  param: UsgFindingParam;
  value: string;
  onSet: (v: string) => void;
  onSetNumber: (num: string, unit: string) => void;
}) {
  const inputCls = "rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm";

  if (param.type === "select") {
    return (
      <select value={value} onChange={(e) => onSet(e.target.value)} className={inputCls}>
        {(param.options ?? []).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    );
  }
  if (param.type === "yesno") {
    const yes = /^(yes|present|positive|true|y)$/i.test(value.trim());
    return (
      <div className="flex gap-1">
        <button type="button" onClick={() => onSet("Present")}
          className={`flex-1 rounded px-2 py-1 text-xs ${yes ? "bg-amber-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>Present</button>
        <button type="button" onClick={() => onSet("Absent")}
          className={`flex-1 rounded px-2 py-1 text-xs ${!yes ? "bg-slate-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>Absent</button>
      </div>
    );
  }
  if (param.type === "multiselect") {
    const selected = new Set(value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
    const toggle = (opt: string) => {
      const next = new Set(selected);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      onSet(Array.from(next).join(","));
    };
    return (
      <div className="flex flex-wrap gap-1">
        {(param.options ?? []).map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)}
            className={`rounded px-2 py-0.5 text-xs ${selected.has(o) ? "bg-teal-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>{o}</button>
        ))}
      </div>
    );
  }
  if (param.type === "number") {
    const { num, unit } = splitNumeric(value, param);
    const units = param.units && param.units.length > 1 ? param.units : null;
    return (
      <div className="flex gap-1">
        <input
          type="number" inputMode="decimal" value={num}
          onChange={(e) => onSetNumber(e.target.value, unit || param.unit || "")}
          className={`${inputCls} w-full`} placeholder="0"
        />
        {units ? (
          <select value={unit || param.unit} onChange={(e) => onSetNumber(num, e.target.value)} className={inputCls}>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : (
          <span className="self-center text-xs text-slate-400">{param.unit}</span>
        )}
      </div>
    );
  }
  // text
  return <input type="text" value={value} onChange={(e) => onSet(e.target.value)} className={inputCls} />;
}
