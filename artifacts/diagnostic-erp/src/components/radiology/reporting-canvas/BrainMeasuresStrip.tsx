/**
 * BrainMeasuresStrip — compact ABC/2 / midline / ASPECTS / aneurysm inputs
 * for Findings when study context is brain (MRI or CT). Mirrors
 * SpineApCanalMeasurements placement — not a new canvas or panel.
 */

import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  ASPECTS_REGIONS,
  MIDLINE_SIDES,
  abc2Volume,
  aspectsScore,
  buildBrainMeasureAtoms,
  type AspectsRegionId,
  type MidlineSide,
} from "@/lib/mriBrainMeasures";

export function BrainMeasuresStrip({
  disabled,
  region = "Brain",
}: {
  disabled?: boolean;
  region?: string;
}) {
  const [ichLoc, setIchLoc] = useState("left basal ganglia");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [mlsMm, setMlsMm] = useState("");
  const [mlsSide, setMlsSide] = useState<MidlineSide>("right");
  const [aspects, setAspects] = useState<AspectsRegionId[]>([]);
  const [anLoc, setAnLoc] = useState("ACom");
  const [dome, setDome] = useState("");
  const [neck, setNeck] = useState("");

  const volumePreview = useMemo(() => {
    const av = Number(a);
    const bv = Number(b);
    const cv = Number(c);
    if (![av, bv, cv].every((n) => Number.isFinite(n) && n > 0)) return null;
    return abc2Volume(av, bv, cv);
  }, [a, b, c]);

  const aspectsPreview = useMemo(
    () => (aspects.length > 0 ? aspectsScore(aspects) : null),
    [aspects],
  );

  const toggleAspects = (id: AspectsRegionId) => {
    setAspects((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const apply = (kind: "ich" | "midline" | "aspects" | "aneurysm") => {
    const payload = buildBrainMeasureAtoms({
      region,
      ich:
        kind === "ich" && volumePreview != null
          ? { location: ichLoc, a: Number(a), b: Number(b), c: Number(c) }
          : null,
      midline:
        kind === "midline" && Number(mlsMm) > 0
          ? { mm: Number(mlsMm), side: mlsSide }
          : null,
      aspects: kind === "aspects" && aspects.length > 0 ? { affectedRegions: aspects } : null,
      aneurysm:
        kind === "aneurysm" && Number(dome) > 0 && Number(neck) > 0
          ? { location: anLoc, domeMm: Number(dome), neckMm: Number(neck) }
          : null,
    });
    if (payload.observations.length === 0) return;
    useWorkspace.getState().applyMacroBundle({
      bundleId: payload.bundleId,
      observations: payload.observations,
    });
  };

  return (
    <div
      className="rounded-md border border-rose-200/80 bg-rose-50/40 px-2 py-1.5 space-y-1.5"
      data-testid="brain-measures-strip"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-rose-900">
          Brain measures
        </span>
        <span className="text-[8px] text-muted-foreground">
          ABC/2 · Midline · ASPECTS · Aneurysm · Apply → ledger
        </span>
      </div>

      {/* ABC/2 ICH */}
      <div className="rounded border border-rose-100 bg-white/80 px-1.5 py-1 space-y-1" data-testid="brain-measure-ich">
        <div className="text-[8px] font-bold uppercase text-rose-800">ICH ABC/2 (cm → cc)</div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            className="h-6 w-36 rounded border border-slate-200 px-1 text-[10px]"
            placeholder="Location"
            value={ichLoc}
            disabled={disabled}
            onChange={(e) => setIchLoc(e.target.value)}
            data-testid="brain-ich-location"
          />
          {(["A", "B", "C"] as const).map((axis, i) => {
            const val = i === 0 ? a : i === 1 ? b : c;
            const set = i === 0 ? setA : i === 1 ? setB : setC;
            return (
              <label key={axis} className="flex items-center gap-0.5 text-[9px] text-slate-700">
                <span className="font-bold">{axis}</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="h-6 w-14 rounded border border-slate-200 px-1 text-[10px]"
                  value={val}
                  disabled={disabled}
                  onChange={(e) => set(e.target.value)}
                  data-testid={`brain-ich-${axis.toLowerCase()}`}
                />
              </label>
            );
          })}
          <span className="text-[10px] font-semibold tabular-nums text-rose-900" data-testid="brain-ich-volume">
            {volumePreview != null ? `${volumePreview} cc` : "— cc"}
          </span>
          <button
            type="button"
            disabled={disabled || volumePreview == null}
            className="h-6 rounded bg-rose-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
            onClick={() => apply("ich")}
            data-testid="brain-ich-apply"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Midline */}
      <div className="rounded border border-rose-100 bg-white/80 px-1.5 py-1 space-y-1" data-testid="brain-measure-midline">
        <div className="text-[8px] font-bold uppercase text-rose-800">Midline shift</div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            type="number"
            step="0.1"
            min="0"
            className="h-6 w-16 rounded border border-slate-200 px-1 text-[10px]"
            placeholder="mm"
            value={mlsMm}
            disabled={disabled}
            onChange={(e) => setMlsMm(e.target.value)}
            data-testid="brain-mls-mm"
          />
          <span className="text-[9px] text-slate-600">mm →</span>
          {MIDLINE_SIDES.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => setMlsSide(s.id)}
              className={[
                "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                mlsSide === s.id
                  ? "border-rose-600 bg-rose-600 text-white"
                  : "border-slate-200 bg-white text-slate-800",
              ].join(" ")}
              data-testid={`brain-mls-side-${s.id}`}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled || !(Number(mlsMm) > 0)}
            className="h-6 rounded bg-rose-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
            onClick={() => apply("midline")}
            data-testid="brain-mls-apply"
          >
            Apply
          </button>
        </div>
      </div>

      {/* ASPECTS */}
      <div className="rounded border border-rose-100 bg-white/80 px-1.5 py-1 space-y-1" data-testid="brain-measure-aspects">
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-bold uppercase text-rose-800">ASPECTS (toggle affected)</span>
          <span className="text-[10px] font-semibold tabular-nums text-rose-900" data-testid="brain-aspects-score">
            {aspectsPreview != null ? `${aspectsPreview}/10` : "10/10"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {ASPECTS_REGIONS.map((r) => {
            const on = aspects.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleAspects(r.id)}
                title={r.label}
                className={[
                  "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                  on
                    ? "border-rose-600 bg-rose-600 text-white"
                    : "border-slate-200 bg-white text-slate-800",
                ].join(" ")}
                data-testid={`brain-aspects-${r.id}`}
              >
                {r.id}
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled || aspects.length === 0}
            className="h-6 rounded bg-rose-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
            onClick={() => apply("aspects")}
            data-testid="brain-aspects-apply"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Aneurysm */}
      <div className="rounded border border-rose-100 bg-white/80 px-1.5 py-1 space-y-1" data-testid="brain-measure-aneurysm">
        <div className="text-[8px] font-bold uppercase text-rose-800">Aneurysm (dome × neck mm)</div>
        <div className="flex flex-wrap items-center gap-1">
          <input
            className="h-6 w-24 rounded border border-slate-200 px-1 text-[10px]"
            placeholder="Location"
            value={anLoc}
            disabled={disabled}
            onChange={(e) => setAnLoc(e.target.value)}
            data-testid="brain-an-location"
          />
          <label className="flex items-center gap-0.5 text-[9px]">
            <span className="font-bold">Dome</span>
            <input
              type="number"
              step="0.1"
              min="0"
              className="h-6 w-14 rounded border border-slate-200 px-1 text-[10px]"
              value={dome}
              disabled={disabled}
              onChange={(e) => setDome(e.target.value)}
              data-testid="brain-an-dome"
            />
          </label>
          <label className="flex items-center gap-0.5 text-[9px]">
            <span className="font-bold">Neck</span>
            <input
              type="number"
              step="0.1"
              min="0"
              className="h-6 w-14 rounded border border-slate-200 px-1 text-[10px]"
              value={neck}
              disabled={disabled}
              onChange={(e) => setNeck(e.target.value)}
              data-testid="brain-an-neck"
            />
          </label>
          <button
            type="button"
            disabled={disabled || !(Number(dome) > 0 && Number(neck) > 0)}
            className="h-6 rounded bg-rose-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
            onClick={() => apply("aneurysm")}
            data-testid="brain-an-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
