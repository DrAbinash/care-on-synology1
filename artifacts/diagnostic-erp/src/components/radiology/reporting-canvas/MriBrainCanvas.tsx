/**
 * MriBrainCanvas — clinical sub-master palettes for MRI Brain reporting.
 *
 * Progressive-disclosure palettes over the ONE brain observation model:
 * every tile / preset / lesion / grading / MRS input compiles to ledger
 * atoms and flows through the existing applyMacroBundle / removeMacroBundle
 * / clinical-undo machinery. It is NOT a second editor and does NOT touch
 * the ledger, narrative merge, provenance or impression machinery directly.
 *
 * - Multiple sub-masters may be active at once; toggling a palette only
 *   filters this palette UI — applied observations are never erased.
 * - Sequence-dependent tiles are gated by the technique field
 *   (mriBrainSequences) — DWI/SWI/contrast/MRS/MRA/MRV statements cannot
 *   be generated for sequences that were not performed.
 * - Normal → abnormal reconciliation, manual-text protection, Findings →
 *   Impression staleness and contradiction warnings are inherited.
 */

import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { parseBrainSequences, BRAIN_SEQUENCE_LABELS, type BrainSequenceKey } from "@/lib/mriBrainSequences";
import {
  MRI_BRAIN_SUB_MASTERS,
  MRI_BRAIN_PRESETS,
  tileAvailable,
  buildTilePatch,
  TUMOR_DIFFERENTIALS,
  INFECTION_DIFFERENTIALS,
  CPA_DIFFERENTIALS,
  type BrainTile,
  type BrainSubMasterId,
} from "@/lib/mriBrainSubMasters";
import {
  buildBrainLesionAtoms,
  buildBrainMrsAtoms,
  LESION_MORPHOLOGIES,
  LESION_FEATURES,
  type BrainLesionInput,
  type EnhancementPattern,
  type LesionCompartment,
  type BrainMrsInput,
} from "@/lib/mriBrainLesion";
import { brainBundleId, brainAtomsToPatches, type BrainAtomSpec } from "@/lib/mriBrainAtoms";
import {
  FAZEKAS_GRADES,
  FAZEKAS_LABELS,
  HERNIATION_TYPES,
  KNOSP_GRADES,
  buildFazekasAtoms,
  buildHerniationAtoms,
  buildPituitaryAtoms,
  type FazekasGrade,
  type HerniationType,
  type KnospGrade,
  type PituitaryMeasureInput,
} from "@/lib/mriBrainMeasures";

const ENHANCEMENT_OPTIONS: EnhancementPattern[] = [
  "none",
  "homogeneous",
  "heterogeneous",
  "ring",
  "nodular",
  "peripheral",
  "dural-based with dural tail",
];

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MriBrainCanvas({
  disabled,
  region = "Brain",
}: {
  disabled?: boolean;
  region?: string;
}) {
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);

  const seq = useMemo(
    () => parseBrainSequences(techniqueText),
    [techniqueText],
  );

  const [activePalettes, setActivePalettes] = useState<BrainSubMasterId[]>(["routine"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lesionOpen, setLesionOpen] = useState<LesionCompartment | null>(null);
  const [mrsOpen, setMrsOpen] = useState(false);

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) out.add(b);
    });
    return out;
  }, [patches]);

  const onTile = (tile: BrainTile) => {
    if (disabled) return;
    const bundleId = brainBundleId("tile", tile.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    const gate = tileAvailable(tile, seq);
    if (!gate.ok) return;
    const built = buildTilePatch(tile, region);
    useWorkspace.getState().applyMacroBundle(built);
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = MRI_BRAIN_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const bundleId = brainBundleId("preset", preset.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    const built = preset.build({ region, seq });
    useWorkspace.getState().applyMacroBundle(built);
    if (preset.id === "normal-mri-brain") {
      useWorkspace.getState().seedSystemNormalImpression();
    }
  };

  const missingChip = (keys: BrainSequenceKey[]) =>
    keys
      .filter((k) => !seq.performed[k])
      .map((k) => BRAIN_SEQUENCE_LABELS[k])
      .join(" + ");

  return (
    <div
      className="rounded-md border border-indigo-200/80 bg-indigo-50/30 px-2 py-2 space-y-2"
      data-testid="mri-brain-canvas"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-900">
          MRI Brain — clinical sub-masters
        </span>
        <span className="text-[8px] text-muted-foreground">
          Palettes filter this panel only — switching never erases observations. Undo: last patch.
        </span>
      </div>

      {/* Sequence status */}
      <div className="flex flex-wrap items-center gap-1" data-testid="brain-seq-status">
        {(["dwi", "adc", "swiGre", "contrast", "mrs", "mra", "mrv"] as BrainSequenceKey[]).map((k) => (
          <span
            key={k}
            data-testid={`brain-seq-${k}`}
            className={[
              "rounded border px-1 py-0.5 text-[8px] font-semibold",
              seq.performed[k]
                ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                : "border-slate-300 bg-white text-slate-400 line-through",
            ].join(" ")}
          >
            {BRAIN_SEQUENCE_LABELS[k]}
          </span>
        ))}
      </div>

      {/* Sub-master selector — multi-active, progressive */}
      <div className="flex flex-wrap gap-1" data-testid="brain-palette-bar">
        {MRI_BRAIN_SUB_MASTERS.map((sm) => {
          const on = activePalettes.includes(sm.id);
          return (
            <button
              key={sm.id}
              type="button"
              disabled={disabled}
              onClick={() => setActivePalettes((prev) => toggleIn(prev, sm.id))}
              title={sm.hint}
              data-testid={`brain-palette-${sm.id}`}
              className={[
                "rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                on
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-700",
              ].join(" ")}
            >
              {sm.label}
            </button>
          );
        })}
      </div>

      {seq.performed.pediatric ? (
        <p className="text-[8px] text-amber-700" data-testid="brain-pediatric-note">
          Pediatric markers in technique — adult involution tiles are hidden; use Pediatric / Congenital.
        </p>
      ) : null}

      {/* Active palettes */}
      {activePalettes.map((paletteId) => {
        const sm = MRI_BRAIN_SUB_MASTERS.find((s) => s.id === paletteId);
        if (!sm) return null;
        const presets = MRI_BRAIN_PRESETS.filter((p) => p.subMasterId === sm.id);
        const groups = new Map<string, BrainTile[]>();
        sm.tiles.forEach((t) => {
          if (t.advanced && !showAdvanced) return;
          if (t.adultOnly && seq.performed.pediatric) return;
          const list = groups.get(t.group) ?? [];
          list.push(t);
          groups.set(t.group, list);
        });
        const hasHidden = sm.tiles.some((t) => t.advanced);
        return (
          <div
            key={sm.id}
            className="rounded border border-indigo-100 bg-white/70 p-1.5 space-y-1.5"
            data-testid={`brain-palette-panel-${sm.id}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase text-indigo-800">{sm.label}</span>
              <span className="text-[8px] text-slate-500">{sm.hint}</span>
            </div>

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid={`brain-presets-${sm.id}`}>
                {presets.map((p) => {
                  const bundleId = brainBundleId("preset", p.id);
                  const on = activeBundles.has(bundleId);
                  const gated =
                    p.id === "pyogenic-abscess"
                      ? missingChip(["dwi", "adc", "contrast"])
                      : p.id === "in-ring-lesion" || p.id === "ring-enhancing-infective"
                        ? missingChip(["contrast"])
                        : "";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled || Boolean(gated)}
                      onClick={() => onPreset(p.id)}
                      data-testid={`brain-preset-${p.id}`}
                      title={gated ? `Requires ${gated} — not in technique` : "Structured, editable, undoable starting preset"}
                      className={[
                        "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                        on
                          ? "border-amber-500 bg-amber-100 text-amber-900"
                          : gated
                            ? "border-slate-200 bg-slate-50 text-slate-400"
                            : "border-amber-400 bg-white text-amber-900",
                      ].join(" ")}
                    >
                      ★ {p.label}
                    </button>
                  );
                })}
              </div>
            )}

            {[...groups.entries()].map(([groupName, tiles]) => (
              <div key={groupName} className="space-y-0.5">
                <div className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{groupName}</div>
                <div className="flex flex-wrap gap-1">
                  {tiles.map((tile) => {
                    const bundleId = brainBundleId("tile", tile.id);
                    const on = activeBundles.has(bundleId);
                    const gate = tileAvailable(tile, seq);
                    const missing = gate.missing.join(" + ");
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        disabled={disabled || (!on && !gate.ok)}
                        onClick={() => onTile(tile)}
                        data-testid={`brain-tile-${tile.id}`}
                        title={missing ? `Requires ${missing} — not documented in technique` : tile.atoms[0]?.findings.slice(0, 120)}
                        className={[
                          "rounded border px-1.5 py-0.5 text-[9px]",
                          on
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : missing
                              ? "border-slate-200 bg-slate-50 text-slate-400"
                              : "border-slate-300 bg-white text-slate-800 hover:border-indigo-400",
                        ].join(" ")}
                      >
                        {tile.label}
                        {on ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {paletteId === "tumor" || paletteId === "infection" || paletteId === "cpa" ? (
              <div className="flex flex-wrap gap-1">
                {(["intra-axial", "extra-axial", "intraventricular"] as LesionCompartment[]).map((comp) => (
                  <button
                    key={comp}
                    type="button"
                    disabled={disabled}
                    onClick={() => setLesionOpen(comp)}
                    data-testid={`brain-lesion-open-${comp}`}
                    className="rounded border border-violet-400 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-900"
                  >
                    Lesion panel: {comp}
                  </button>
                ))}
                {seq.performed.mrs ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setMrsOpen((v) => !v)}
                    data-testid="brain-mrs-open"
                    className="rounded border border-teal-400 bg-teal-50 px-1.5 py-0.5 text-[9px] font-semibold text-teal-900"
                  >
                    MRS panel {seq.performed.mrs ? "" : "(needs MRS)"}
                  </button>
                ) : null}
              </div>
            ) : null}

            {paletteId === "vascular" ? <BrainFazekasControl disabled={disabled} region={region} /> : null}
            {paletteId === "trauma" ? <BrainHerniationControl disabled={disabled} region={region} /> : null}
            {paletteId === "sella" ? <BrainPituitaryControl disabled={disabled} region={region} /> : null}
            {paletteId === "epilepsy" ? <BrainHippocampusControl disabled={disabled} region={region} seq={seq} /> : null}

            {hasHidden ? (
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="brain-show-advanced"
                className="text-[8px] font-semibold uppercase text-indigo-700 underline"
              >
                {showAdvanced ? "Hide advanced tiles" : "Show advanced / rare tiles"}
              </button>
            ) : null}
          </div>
        );
      })}

      {lesionOpen ? (
        <BrainLesionPanel
          region={region}
          seq={seq}
          compartment={lesionOpen}
          onClose={() => setLesionOpen(null)}
          disabled={disabled}
        />
      ) : null}

      {mrsOpen && seq.performed.mrs ? (
        <BrainMrsPanel region={region} seq={seq} onClose={() => setMrsOpen(false)} disabled={disabled} />
      ) : null}
    </div>
  );
}

// ─── Shared lesion characterization panel (used by ALL sub-masters) ──────

function BrainLesionPanel({
  region,
  seq,
  compartment,
  onClose,
  disabled,
}: {
  region: string;
  seq: ReturnType<typeof parseBrainSequences>;
  compartment: LesionCompartment;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [number, setNumber] = useState<BrainLesionInput["number"]>("solitary");
  const [location, setLocation] = useState("right frontal lobe");
  const [laterality, setLaterality] = useState<BrainLesionInput["laterality"]>("right");
  const [ap, setAp] = useState("");
  const [tr, setTr] = useState("");
  const [cc, setCc] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [flair, setFlair] = useState("");
  const [dwi, setDwi] = useState("");
  const [adc, setAdc] = useState("");
  const [swi, setSwi] = useState("");
  const [morph, setMorph] = useState<string[]>([]);
  const [enh, setEnh] = useState<EnhancementPattern | "">("");
  const [features, setFeatures] = useState<string[]>([]);
  const [shiftMm, setShiftMm] = useState("");
  const [diffs, setDiffs] = useState<string[]>([]);

  const numbers = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const submit = () => {
    const lesion: BrainLesionInput = {
      number,
      compartment,
      location,
      laterality,
      size: { ap: numbers(ap), transverse: numbers(tr), cc: numbers(cc) },
      signal: {
        t1: t1.trim() || undefined,
        t2: t2.trim() || undefined,
        flair: flair.trim() || undefined,
        dwi: seq.performed.dwi && dwi.trim() ? dwi.trim() : undefined,
        adc: seq.performed.adc && adc.trim() ? adc.trim() : undefined,
        swiGre: seq.performed.swiGre && swi.trim() ? swi.trim() : undefined,
      },
      morphology: morph,
      enhancement: seq.performed.contrast ? enh : "",
      features,
      midlineShiftMm: numbers(shiftMm),
      differentials: diffs,
    };
    const built = buildBrainLesionAtoms(lesion, {
      region,
      seq,
      bundleId: brainBundleId("lesion", `${compartment}-${Date.now().toString(36)}`),
    });
    if (built.observations.length === 0) return;
    useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  const field = "h-6 rounded border border-slate-200 px-1 text-[10px]";
  return (
    <div className="rounded border border-violet-200 bg-violet-50/50 p-1.5 space-y-1.5" data-testid="brain-lesion-panel">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-violet-900">
          Shared lesion characterization — {compartment}
        </span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="brain-lesion-close">
          close
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select value={number} disabled={disabled} onChange={(e) => setNumber(e.target.value as BrainLesionInput["number"])} className={field} data-testid="lesion-number">
          <option value="solitary">solitary</option>
          <option value="multiple">multiple</option>
        </select>
        <select value={laterality} disabled={disabled} onChange={(e) => setLaterality(e.target.value as BrainLesionInput["laterality"])} className={field} data-testid="lesion-laterality">
          <option value="">—</option>
          <option value="right">right</option>
          <option value="left">left</option>
          <option value="bilateral">bilateral</option>
          <option value="midline">midline</option>
        </select>
        <input className={`${field} w-40`} placeholder="Location" value={location} disabled={disabled} onChange={(e) => setLocation(e.target.value)} data-testid="lesion-location" />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-violet-800">AP×TR×CC</span>
        <input type="number" step="0.1" min="0" className={`${field} w-14`} value={ap} disabled={disabled} onChange={(e) => setAp(e.target.value)} data-testid="lesion-ap" />
        <input type="number" step="0.1" min="0" className={`${field} w-14`} value={tr} disabled={disabled} onChange={(e) => setTr(e.target.value)} data-testid="lesion-tr" />
        <input type="number" step="0.1" min="0" className={`${field} w-14`} value={cc} disabled={disabled} onChange={(e) => setCc(e.target.value)} data-testid="lesion-cc" />
        <span className="text-[8px] text-slate-500">cm</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ["t1", "T1", setT1, t1, true],
            ["t2", "T2", setT2, t2, true],
            ["flair", "FLAIR", setFlair, flair, true],
            ["dwi", "DWI", setDwi, dwi, seq.performed.dwi],
            ["adc", "ADC", setAdc, adc, seq.performed.adc],
            ["swi", "GRE/SWI", setSwi, swi, seq.performed.swiGre],
          ] as Array<[string, string, (v: string) => void, string, boolean]>
        ).map(([key, label, setter, value, allowed]) =>
          allowed ? (
            <label key={key} className="flex items-center gap-0.5 text-[8px] text-slate-600">
              {label}
              <input className={`${field} w-20`} value={value} disabled={disabled} onChange={(e) => setter(e.target.value)} data-testid={`lesion-signal-${key}`} />
            </label>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {LESION_MORPHOLOGIES.map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => setMorph((prev) => toggleIn(prev, m))}
            data-testid={`lesion-morph-${m}`}
            className={["rounded border px-1 py-0.5 text-[8px]", morph.includes(m) ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
          >
            {m}
          </button>
        ))}
      </div>
      {seq.performed.contrast ? (
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-bold uppercase text-violet-800">Enhancement</span>
          <select value={enh} disabled={disabled} onChange={(e) => setEnh(e.target.value as EnhancementPattern | "")} className={field} data-testid="lesion-enhancement">
            <option value="">—</option>
            {ENHANCEMENT_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-[8px] text-slate-500" data-testid="lesion-enhancement-gated">
          Enhancement options hidden — contrast is not documented in the technique.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {LESION_FEATURES.map((f) => (
          <button
            key={f}
            type="button"
            disabled={disabled}
            onClick={() => setFeatures((prev) => toggleIn(prev, f))}
            data-testid={`lesion-feature-${f.replace(/\W+/g, "-")}`}
            title={f === "susceptibility blooming" && !seq.performed.swiGre ? "GRE/SWI not performed — will be dropped" : undefined}
            className={["rounded border px-1 py-0.5 text-[8px]", features.includes(f) ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>
      {features.some((f) => f.toLowerCase() === "midline shift") ? (
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          Midline shift (mm)
          <input type="number" step="0.5" min="0" className={`${field} w-16`} value={shiftMm} disabled={disabled} onChange={(e) => setShiftMm(e.target.value)} data-testid="lesion-shift-mm" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {[...TUMOR_DIFFERENTIALS, ...INFECTION_DIFFERENTIALS, ...CPA_DIFFERENTIALS]
          .filter((d, i, arr) => arr.indexOf(d) === i)
          .map((d) => (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => setDiffs((prev) => toggleIn(prev, d))}
              data-testid={`lesion-differential-${d.replace(/\W+/g, "-")}`}
              className={["rounded border px-1 py-0.5 text-[8px] italic", diffs.includes(d) ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-600"].join(" ")}
            >
              consider: {d}
            </button>
          ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        data-testid="brain-lesion-apply"
        className="h-6 rounded bg-violet-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Add lesion → ledger
      </button>
    </div>
  );
}

// ─── Shared MRS panel ─────────────────────────────────────────────────────

function BrainMrsPanel({
  region,
  seq,
  onClose,
  disabled,
}: {
  region: string;
  seq: ReturnType<typeof parseBrainSequences>;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [voxel, setVoxel] = useState("lesional");
  const [cho, setCho] = useState("");
  const [cr, setCr] = useState("");
  const [naa, setNaa] = useState("");
  const [lipid, setLipid] = useState(false);
  const [lactate, setLactate] = useState(false);
  const [choCr, setChoCr] = useState("");
  const [choNaa, setChoNaa] = useState("");
  const [interp, setInterp] = useState<string[]>([]);

  const INTERPS = [
    "elevated choline",
    "reduced NAA",
    "lipid/lactate peak",
    "no significant metabolite abnormality",
  ];

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== "" ? n : "";
  };

  const submit = () => {
    const input: BrainMrsInput = {
      voxelLocation: voxel,
      cho: num(cho),
      cr: num(cr),
      naa: num(naa),
      lipid,
      lactate,
      choCr: num(choCr),
      choNaa: num(choNaa),
      interpretation: interp,
    };
    const built = buildBrainMrsAtoms(input, { region, seq });
    if (!built) return;
    useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  const field = "h-6 w-16 rounded border border-slate-200 px-1 text-[10px]";
  return (
    <div className="rounded border border-teal-200 bg-teal-50/50 p-1.5 space-y-1.5" data-testid="brain-mrs-panel">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-teal-900">Shared MR Spectroscopy (MRS performed)</span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="brain-mrs-close">close</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <input className="h-6 w-32 rounded border border-slate-200 px-1 text-[10px]" placeholder="Voxel location" value={voxel} disabled={disabled} onChange={(e) => setVoxel(e.target.value)} data-testid="mrs-voxel" />
        {([["Cho", cho, setCho], ["Cr", cr, setCr], ["NAA", naa, setNaa], ["Cho/Cr", choCr, setChoCr], ["Cho/NAA", choNaa, setChoNaa]] as Array<[string, string, (v: string) => void]>).map(([label, value, setter]) => (
          <label key={label} className="flex items-center gap-0.5 text-[8px] text-slate-600">
            {label}
            <input type="number" step="0.01" className={field} value={value} disabled={disabled} onChange={(e) => setter(e.target.value)} data-testid={`mrs-${label.replace(/\W+/g, "")}`} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-[9px]">
          <input type="checkbox" checked={lipid} disabled={disabled} onChange={(e) => setLipid(e.target.checked)} data-testid="mrs-lipid" /> lipid peak
        </label>
        <label className="flex items-center gap-1 text-[9px]">
          <input type="checkbox" checked={lactate} disabled={disabled} onChange={(e) => setLactate(e.target.checked)} data-testid="mrs-lactate" /> lactate peak
        </label>
        {INTERPS.map((i) => (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => setInterp((prev) => toggleIn(prev, i))}
            data-testid={`mrs-interp-${i.replace(/\W+/g, "-")}`}
            className={["rounded border px-1 py-0.5 text-[8px]", interp.includes(i) ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
          >
            {i}
          </button>
        ))}
      </div>
      <p className="text-[8px] text-slate-500">
        MRS contributes to the radiologist&rsquo;s integrated interpretation — no disease is auto-diagnosed from metabolites.
      </p>
      <button type="button" disabled={disabled} onClick={submit} data-testid="brain-mrs-apply" className="h-6 rounded bg-teal-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40">
        Add MRS → ledger
      </button>
    </div>
  );
}

// ─── Grading controls ─────────────────────────────────────────────────────

function BrainFazekasControl({ disabled, region }: { disabled?: boolean; region: string }) {
  const [pv, setPv] = useState<FazekasGrade>(1);
  const [deep, setDeep] = useState<FazekasGrade>(1);
  return (
    <div className="rounded border border-rose-100 bg-white/80 p-1.5 space-y-1" data-testid="brain-fazekas-control">
      <span className="text-[8px] font-bold uppercase text-rose-800">Fazekas grading</span>
      {([["Periventricular", pv, setPv, "fazekas-pv"], ["Deep white matter", deep, setDeep, "fazekas-deep"]] as Array<[string, FazekasGrade, (g: FazekasGrade) => void, string]>).map(([label, value, setter, testid]) => (
        <div key={testid} className="flex flex-wrap items-center gap-1">
          <span className="text-[8px] text-slate-600 w-28">{label}</span>
          {FAZEKAS_GRADES.map((g) => (
            <button
              key={g}
              type="button"
              disabled={disabled}
              onClick={() => setter(g)}
              title={FAZEKAS_LABELS[g]}
              data-testid={`${testid}-${g}`}
              className={["rounded border px-1.5 py-0.5 text-[9px] font-semibold", value === g ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
            >
              {g}
            </button>
          ))}
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        data-testid="brain-fazekas-apply"
        onClick={() => {
          const built = buildFazekasAtoms({ region, periventricular: pv, deep });
          useWorkspace.getState().applyMacroBundle(built);
        }}
        className="h-6 rounded bg-rose-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Apply Fazekas → ledger
      </button>
    </div>
  );
}

function BrainHerniationControl({ disabled, region }: { disabled?: boolean; region: string }) {
  const [types, setTypes] = useState<HerniationType[]>([]);
  const [mm, setMm] = useState("");
  return (
    <div className="rounded border border-red-200 bg-white/80 p-1.5 space-y-1" data-testid="brain-herniation-control">
      <span className="text-[8px] font-bold uppercase text-red-800">Herniation</span>
      <div className="flex flex-wrap gap-1">
        {HERNIATION_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => setTypes((prev) => toggleIn(prev, t))}
            data-testid={`herniation-${t.replace(/\W+/g, "-")}`}
            className={["rounded border px-1 py-0.5 text-[9px]", types.includes(t) ? "border-red-600 bg-red-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[8px] text-slate-600">
        Displacement (mm, optional)
        <input type="number" step="0.5" min="0" className="h-6 w-14 rounded border border-slate-200 px-1 text-[10px]" value={mm} disabled={disabled} onChange={(e) => setMm(e.target.value)} data-testid="herniation-mm" />
      </label>
      <button
        type="button"
        disabled={disabled || types.length === 0}
        data-testid="brain-herniation-apply"
        onClick={() => {
          const built = buildHerniationAtoms({ region, types, displacementMm: Number(mm) || null });
          useWorkspace.getState().applyMacroBundle(built);
        }}
        className="h-6 rounded bg-red-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Apply herniation → ledger (critical)
      </button>
    </div>
  );
}

function BrainPituitaryControl({ disabled, region }: { disabled?: boolean; region: string }) {
  const [p, setP] = useState<PituitaryMeasureInput>({ ap: "", tr: "", cc: "", suprasellarExtension: "", cavernousSinus: "", knosp: "" });
  const field = "h-6 w-14 rounded border border-slate-200 px-1 text-[10px]";
  return (
    <div className="rounded border border-sky-200 bg-white/80 p-1.5 space-y-1" data-testid="brain-pituitary-control">
      <span className="text-[8px] font-bold uppercase text-sky-800">Pituitary / sella measurements</span>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] text-slate-600">AP×TR×CC (cm)</span>
        {([["ap", p.ap], ["tr", p.tr], ["cc", p.cc]] as Array<["ap" | "tr" | "cc", number | ""]>).map(([axis, value]) => (
          <input key={axis} type="number" step="0.1" min="0" className={field} value={String(value)} disabled={disabled} onChange={(e) => setP((prev) => ({ ...prev, [axis]: e.target.value === "" ? "" : Number(e.target.value) }))} data-testid={`pituitary-${axis}`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select className="h-6 rounded border border-slate-200 px-1 text-[9px]" value={p.suprasellarExtension ?? ""} disabled={disabled} onChange={(e) => setP((prev) => ({ ...prev, suprasellarExtension: e.target.value as PituitaryMeasureInput["suprasellarExtension"] }))} data-testid="pituitary-suprasellar">
          <option value="">Suprasellar —</option>
          <option value="none">none</option>
          <option value="cistern">cistern</option>
          <option value="chiasm contact">chiasm contact</option>
          <option value="chiasm compression">chiasm compression</option>
        </select>
        <select className="h-6 rounded border border-slate-200 px-1 text-[9px]" value={p.cavernousSinus ?? ""} disabled={disabled} onChange={(e) => setP((prev) => ({ ...prev, cavernousSinus: e.target.value as PituitaryMeasureInput["cavernousSinus"] }))} data-testid="pituitary-cavernous">
          <option value="">Cavernous sinus —</option>
          <option value="none">none</option>
          <option value="contact">contact</option>
          <option value="encasement">encasement</option>
        </select>
        <select className="h-6 rounded border border-slate-200 px-1 text-[9px]" value={String(p.knosp ?? "")} disabled={disabled} onChange={(e) => setP((prev) => ({ ...prev, knosp: e.target.value === "" ? "" : (Number(e.target.value) as KnospGrade) }))} data-testid="pituitary-knosp">
          <option value="">Knosp —</option>
          {KNOSP_GRADES.map((g) => (
            <option key={g} value={g}>Knosp {g}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[9px]">
          <input type="checkbox" checked={Boolean(p.haemorrhage)} disabled={disabled} onChange={(e) => setP((prev) => ({ ...prev, haemorrhage: e.target.checked }))} data-testid="pituitary-haemorrhage" /> apoplexy
        </label>
      </div>
      <button
        type="button"
        disabled={disabled}
        data-testid="brain-pituitary-apply"
        onClick={() => {
          const built = buildPituitaryAtoms({ region, pituitary: p });
          if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
        }}
        className="h-6 rounded bg-sky-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Apply sella → ledger
      </button>
    </div>
  );
}

function BrainHippocampusControl({
  disabled,
  region,
  seq,
}: {
  disabled?: boolean;
  region: string;
  seq: ReturnType<typeof parseBrainSequences>;
}) {
  const [side, setSide] = useState<"right" | "left">("left");
  const [volume, setVolume] = useState(true);
  const [signal, setSignal] = useState(true);
  const [architecture, setArchitecture] = useState(false);
  return (
    <div className="rounded border border-amber-200 bg-white/80 p-1.5 space-y-1" data-testid="brain-hippocampus-control">
      <span className="text-[8px] font-bold uppercase text-amber-800">Hippocampus structured review (epilepsy protocol)</span>
      <div className="flex flex-wrap items-center gap-1">
        {(["right", "left"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => setSide(s)}
            data-testid={`hip-side-${s}`}
            className={["rounded border px-1.5 py-0.5 text-[9px] font-semibold", side === s ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300 bg-white text-slate-700"].join(" ")}
          >
            {s}
          </button>
        ))}
        {([["volume loss", volume, setVolume, "hip-volume"], ["T2/FLAIR hyperintensity", signal, setSignal, "hip-signal"], ["loss of architecture", architecture, setArchitecture, "hip-arch"]] as Array<[string, boolean, (v: boolean) => void, string]>).map(([label, value, setter, testid]) => (
          <label key={testid} className="flex items-center gap-1 text-[9px]">
            <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => setter(e.target.checked)} data-testid={testid} /> {label}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || (!volume && !signal && !architecture)}
        data-testid="brain-hippocampus-apply"
        onClick={() => {
          const atoms: BrainAtomSpec[] = [
            volume ? { concept: "hippocampus_volume", conflictGroup: "hippocampus_volume", anatomicalSection: "hippocampi", findings: `Volume loss of the ${side} hippocampus.`, impression: `${side === "right" ? "Right" : "Left"} hippocampal volume loss.`, laterality: side, supportsLaterality: true } : null,
            signal ? { concept: "hippocampus_signal", conflictGroup: "hippocampus_signal", anatomicalSection: "hippocampi", findings: `T2/FLAIR hyperintensity of the ${side} hippocampus.`, impression: `${side === "right" ? "Right" : "Left"} hippocampal FLAIR hyperintensity.`, laterality: side, supportsLaterality: true } : null,
            architecture ? { concept: "hippocampus_architecture", conflictGroup: "hippocampus_architecture", anatomicalSection: "hippocampi", findings: `Loss of internal architecture of the ${side} hippocampus.`, laterality: side, supportsLaterality: true } : null,
          ].filter(Boolean) as BrainAtomSpec[];
          if (!seq.performed.t2 || !seq.performed.flair || atoms.length === 0) return;
          const bundleId = brainBundleId("hip", side);
          useWorkspace.getState().applyMacroBundle({
            bundleId,
            observations: brainAtomsToPatches(region, bundleId, atoms),
          });
        }}
        className="h-6 rounded bg-amber-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Apply hippocampal findings → ledger
      </button>
      <p className="text-[8px] text-slate-500">
        The “no definite epileptogenic focus” statement is only offered in the Epilepsy palette once T2 and FLAIR are documented.
      </p>
    </div>
  );
}
