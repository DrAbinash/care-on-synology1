/**
 * MriDorsalSubMasterPanel.tsx — the MRI Dorsal / Thoracic clinical sub-master
 * canvas (dorsal spec §2, §38).
 *
 * Architectural reference: the shipped MriLumbarSubMasterPanel. One observation
 * model, fourteen palettes over it. Nothing here holds clinical state: palettes
 * only decide which tiles are offered, and every tile, preset, level detail and
 * lesion goes through `applyMacroBundle` / `removeMacroBundle` on the existing
 * ledger with clinical undo. Switching a palette never erases an observation.
 *
 * The header carries the coverage / numbering control because in thoracic
 * reporting coverage is the safety property: it decides which levels exist,
 * whether the conus may be mentioned at all, and whether a numbering caution
 * sentence belongs in the report.
 */

import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { useCanalApCell } from "./useCanalApCell";
import {
  DORSAL_PRESETS,
  MRI_DORSAL_SUB_MASTERS,
  buildDorsalLesionBundle,
  buildDorsalLevelBundle,
  buildDorsalPresetBundle,
  buildDorsalTileBundle,
  dorsalPresetAvailability,
  dorsalTileAvailability,
  dorsalPresetBundleId,
  dorsalTileBundleId,
  type DorsalLesionCompartment,
  type DorsalLesionInput,
  type DorsalSubMasterId,
  type DorsalSide,
  type DorsalTile,
  type DorsalTileContext,
} from "@/lib/mriDorsalSubMasters";
import {
  DORSAL_CANAL_MORPHOLOGY_OPTIONS,
  DORSAL_CORD_EFFECT_OPTIONS,
  DORSAL_DISC_LOCATION_OPTIONS,
  DORSAL_EPIDURAL_OPTIONS,
  DORSAL_FORAMINAL_CAUSE_OPTIONS,
  DORSAL_MIGRATION_OPTIONS,
  DORSAL_OLF_MORPHOLOGY_OPTIONS,
  DORSAL_SEVERITY_OPTIONS,
  deriveDorsalLevelDetail,
  dorsalConusLevelAllowed,
  dorsalLevelDetailHasContent,
  type DorsalEpiduralDetail,
  type DorsalFlavumDetail,
  type DorsalForaminalSideDetail,
  type DorsalLevelDetail,
  type DorsalListhesisDetail,
} from "@/lib/mriDorsalLevelDetail";
import {
  DORSAL_COVERAGE_OPTIONS,
  DORSAL_NUMBERING_MODES,
  conusCovered,
  dorsalLevelKeys,
  dorsalNumberingBanner,
  type DorsalCoverageExtent,
  type DorsalNumberingMode,
} from "@/lib/mriDorsalNumbering";
import {
  SPINE_SEQUENCE_KEYS,
  SPINE_SEQUENCE_LABELS,
} from "@/lib/mriSpineSequences";

const FIELD = "h-6 rounded border border-slate-200 px-1 text-[10px]";
const num = (v: string): number | undefined => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MriDorsalSubMasterPanel({
  disabled,
  ledgerRegion = "Dorsal Spine",
}: {
  disabled?: boolean;
  ledgerRegion?: string;
}) {
  const numbering = useWorkspace((s) => s.dorsalNumbering);
  const sequences = useWorkspace((s) => s.sequencesAvailable);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const orderFrozen = useWorkspace((s) => s.impressionOrderFrozen);

  const levels = dorsalLevelKeys(numbering);
  const [level, setLevel] = useState(levels[0]?.key ?? "D8-D9");
  const [activePalettes, setActivePalettes] = useState<DorsalSubMasterId[]>(["routine", "degenerative"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lesionOpen, setLesionOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [side, setSide] = useState<DorsalSide | "">("");
  const [root, setRoot] = useState("");
  const [mm, setMm] = useState("");
  const [mm2, setMm2] = useState("");
  const [pct, setPct] = useState("");
  const [cm, setCm] = useState("");
  const [cm2, setCm2] = useState("");
  const [level2, setLevel2] = useState("");
  const [conusLevel, setConusLevel] = useState("");
  const [vertebra, setVertebra] = useState("");
  const [direction, setDirection] = useState<"superiorly" | "inferiorly" | "">("");
  const [choice, setChoice] = useState<"with" | "without" | "">("");

  const activeLevel = levels.some((k) => k.key === level) ? level : (levels[0]?.key ?? level);

  const ctx: DorsalTileContext = {
    level: activeLevel,
    numbering,
    sequences,
    region: ledgerRegion,
    side: side || undefined,
    root: root.trim() || undefined,
    mm: num(mm),
    mm2: num(mm2),
    pct: num(pct),
    cm: num(cm),
    cm2: num(cm2),
    level2: level2.trim() || undefined,
    conusLevel: conusLevel.trim() || undefined,
    vertebra: vertebra.trim() || undefined,
    direction: direction || undefined,
    choice: choice || undefined,
  };

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) out.add(b);
    });
    return out;
  }, [patches]);

  const onTile = (tile: DorsalTile) => {
    if (disabled) return;
    const bundleId = dorsalTileBundleId(tile.id, ctx.level);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    const gate = dorsalTileAvailability(tile, ctx);
    if (!gate.available) {
      setNotice(gate.notice ?? "This statement is not supported by the recorded protocol.");
      return;
    }
    const built = buildDorsalTileBundle(tile.id, ctx);
    if (built.observations.length > 0) {
      useWorkspace.getState().applyMacroBundle(built);
      setNotice(null);
    }
  };

  /** A macro preset is one pattern: replace any earlier instance, don't stack. */
  const removePresetInstances = (presetId: string) => {
    const ws = useWorkspace.getState();
    const prefix = dorsalPresetBundleId(presetId, "").replace(/-$/, "");
    [...activeBundles].filter((id) => id === prefix || id.startsWith(`${prefix}-`)).forEach((id) => ws.removeMacroBundle(id));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = DORSAL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const bundleId = dorsalPresetBundleId(presetId, ctx.level);
    if (activeBundles.has(bundleId)) {
      removePresetInstances(presetId);
      setNotice(null);
      return;
    }
    removePresetInstances(presetId);
    const built = buildDorsalPresetBundle(presetId, ctx);
    if (built.observations.length === 0) return;
    useWorkspace.getState().applyMacroBundle(built);
    setNotice(built.notice ?? null);
    if (presetId === "preset-normal-dorsal") useWorkspace.getState().seedSystemNormalImpression();
  };

  return (
    <div
      className="rounded-md border border-teal-200/80 bg-teal-50/30 px-2 py-2 space-y-2"
      data-testid="mri-dorsal-submaster-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-teal-900">
          MRI Dorsal Spine — clinical sub-masters
        </span>
        <span className="text-[8px] text-muted-foreground">
          Palettes filter this panel only · applied observations are never erased · Undo: last patch
        </span>
        <button
          type="button"
          disabled={disabled || orderFrozen}
          onClick={() => useWorkspace.getState().orderImpressionByPriority()}
          title={orderFrozen
            ? "The Impression was hand-edited or reordered — automatic priority sorting stays off"
            : "Re-sort the derived Impression by clinical priority (sentences are never rewritten)"}
          data-testid="dorsal-sort-impression-by-priority"
          className="h-5 rounded border border-rose-400 bg-white px-1.5 text-[8px] font-semibold text-rose-800 disabled:opacity-40"
        >
          Sort Impression by priority{orderFrozen ? " (frozen)" : ""}
        </button>
      </div>

      <DorsalNumberingControl disabled={disabled} />

      {/* Capture scope: the resolver's level list, never a hard-coded array. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="dorsal-scope-row">
        <span className="text-[8px] font-bold uppercase text-teal-800">Level in scope</span>
        <select
          className={FIELD}
          value={activeLevel}
          disabled={disabled}
          data-testid="dorsal-level-scope"
          onChange={(e) => setLevel(e.target.value)}
        >
          {levels.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
        <span className="text-[8px] text-slate-500" data-testid="dorsal-coverage-hint">
          {conusCovered(numbering)
            ? "thoracolumbar junction covered — conus may be assessed"
            : "junction not covered — conus sentences are blocked"}
        </span>
      </div>

      {/* Prose variables the canonical library templates need. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="dorsal-vars-row">
        <select className={FIELD} value={side} disabled={disabled} data-testid="dorsal-var-side" onChange={(e) => setSide(e.target.value as DorsalSide | "")}>
          <option value="">side…</option>
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="bilateral">bilateral</option>
        </select>
        <input className={`${FIELD} w-16`} placeholder="root" value={root} disabled={disabled} data-testid="dorsal-var-root" onChange={(e) => setRoot(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="mm" value={mm} disabled={disabled} data-testid="dorsal-var-mm" onChange={(e) => setMm(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="mm2" value={mm2} disabled={disabled} data-testid="dorsal-var-mm2" onChange={(e) => setMm2(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="1" min="0" placeholder="%" value={pct} disabled={disabled} data-testid="dorsal-var-pct" onChange={(e) => setPct(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="cm" value={cm} disabled={disabled} data-testid="dorsal-var-cm" onChange={(e) => setCm(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="cm2" value={cm2} disabled={disabled} data-testid="dorsal-var-cm2" onChange={(e) => setCm2(e.target.value)} />
        <input className={`${FIELD} w-20`} placeholder="extent to…" value={level2} disabled={disabled} data-testid="dorsal-var-level2" onChange={(e) => setLevel2(e.target.value)} />
        <input className={`${FIELD} w-20`} placeholder="conus level" value={conusLevel} disabled={disabled} data-testid="dorsal-var-conus" onChange={(e) => setConusLevel(e.target.value)} />
        <input className={`${FIELD} w-20`} placeholder="vertebra" value={vertebra} disabled={disabled} data-testid="dorsal-var-vertebra" onChange={(e) => setVertebra(e.target.value)} />
        <select className={FIELD} value={direction} disabled={disabled} data-testid="dorsal-var-direction" onChange={(e) => setDirection(e.target.value === "" ? "" : (e.target.value as "superiorly" | "inferiorly"))}>
          <option value="">direction…</option>
          <option value="superiorly">superiorly</option>
          <option value="inferiorly">inferiorly</option>
        </select>
        <select className={FIELD} value={choice} disabled={disabled} data-testid="dorsal-var-choice" onChange={(e) => setChoice(e.target.value as "with" | "without" | "")}>
          <option value="">with / without…</option>
          <option value="with">with</option>
          <option value="without">without</option>
        </select>
        <span className="text-[8px] text-slate-500">
          empty variables stay bracketed in the sentence as visible fill-ins
        </span>
      </div>

      {notice ? (
        <p
          className="rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[8px] text-orange-900"
          data-testid="dorsal-gate-notice"
        >
          {notice} Nothing was invented to fill the gap.
        </p>
      ) : null}

      {/* Palette selector — multi-active, progressive (spec §2, §38). */}
      <div className="flex flex-wrap gap-1" data-testid="dorsal-palette-bar">
        {MRI_DORSAL_SUB_MASTERS.map((sm) => {
          const on = activePalettes.includes(sm.id);
          return (
            <button
              key={sm.id}
              type="button"
              disabled={disabled}
              onClick={() => setActivePalettes((prev) => toggleIn(prev, sm.id))}
              title={sm.hint}
              data-testid={`dorsal-palette-${sm.id}`}
              className={[
                "rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-700",
              ].join(" ")}
            >
              {sm.label}
            </button>
          );
        })}
      </div>

      {activePalettes.map((paletteId) => {
        const master = MRI_DORSAL_SUB_MASTERS.find((m) => m.id === paletteId);
        if (!master) return null;
        const presets = DORSAL_PRESETS.filter((p) => p.subMasters.includes(paletteId));
        const groups = new Map<string, DorsalTile[]>();
        master.tiles.forEach((t) => {
          if (t.advanced && !showAdvanced) return;
          const list = groups.get(t.group) ?? [];
          list.push(t);
          groups.set(t.group, list);
        });
        const hasHidden = master.tiles.some((t) => t.advanced);
        return (
          <div
            key={paletteId}
            className="rounded border border-teal-100 bg-white/70 p-1.5 space-y-1.5"
            data-testid={`dorsal-palette-panel-${paletteId}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase text-teal-800">{master.label}</span>
              <span className="text-[8px] text-slate-500">{master.hint}</span>
            </div>

            {presets.length > 0 ? (
              <div className="flex flex-wrap gap-1" data-testid={`dorsal-presets-${paletteId}`}>
                {presets.map((p) => {
                  const on = activeBundles.has(dorsalPresetBundleId(p.id, ctx.level));
                  const gate = dorsalPresetAvailability(p, ctx);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onPreset(p.id)}
                      title={`${p.hint}${gate.notice ? ` · ${gate.notice}` : ""}`}
                      data-testid={`dorsal-preset-${p.id}`}
                      className={[
                        "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                        on
                          ? "border-rose-500 bg-rose-100 text-rose-900"
                          : p.critical
                            ? "border-rose-400 bg-white text-rose-800"
                            : !gate.supported
                              ? "border-dashed border-slate-300 bg-white text-slate-500"
                              : "border-slate-300 bg-white text-slate-800 hover:border-teal-400",
                      ].join(" ")}
                    >
                      {p.critical ? "★ " : ""}{p.label}
                      {!gate.supported ? " (partial)" : ""}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {[...groups.entries()].map(([group, tiles]) => (
              <div key={group} className="space-y-0.5">
                <span className="text-[8px] font-bold uppercase text-slate-500">{group}</span>
                <div className="flex flex-wrap gap-1">
                  {tiles.map((tile) => {
                    const bundleId = dorsalTileBundleId(tile.id, ctx.level);
                    const on = activeBundles.has(bundleId);
                    const gate = dorsalTileAvailability(tile, ctx);
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onTile(tile)}
                        title={gate.available ? tile.label : `${tile.label} — ${gate.notice ?? ""}`}
                        data-testid={`dorsal-tile-${tile.id}`}
                        data-available={gate.available ? "true" : "false"}
                        className={[
                          "rounded border px-1.5 py-0.5 text-[9px]",
                          on
                            ? "border-teal-600 bg-teal-600 text-white font-semibold"
                            : gate.available
                              ? "border-slate-300 bg-white text-slate-800 hover:border-teal-400"
                              : "border-dashed border-slate-300 bg-slate-50 text-slate-400 line-through",
                        ].join(" ")}
                      >
                        {tile.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {hasHidden ? (
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[8px] underline text-slate-500"
                data-testid={`dorsal-show-advanced-${paletteId}`}
              >
                {showAdvanced ? "Hide advanced / interpretation tiles" : "Show advanced / interpretation tiles"}
              </button>
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDetailOpen((v) => !v)}
          className="h-6 rounded border border-sky-300 bg-white px-2 text-[9px] font-semibold text-sky-900"
          data-testid="dorsal-open-level-detail"
        >
          Level detail — {activeLevel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLesionOpen((v) => !v)}
          className="h-6 rounded border border-violet-300 bg-white px-2 text-[9px] font-semibold text-violet-900"
          data-testid="dorsal-open-lesion-form"
        >
          Lesion / collection characterisation
        </button>
      </div>

      {detailOpen ? (
        <DorsalLevelDetailForm ctx={ctx} ledgerRegion={ledgerRegion} onClose={() => setDetailOpen(false)} disabled={disabled} />
      ) : null}
      {lesionOpen ? (
        <DorsalLesionForm ctx={ctx} ledgerRegion={ledgerRegion} onClose={() => setLesionOpen(false)} disabled={disabled} />
      ) : null}

      {/* Protocol coverage is editable here because every gated sentence depends
          on it; derivation proposes it, the radiologist owns it. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="dorsal-coverage-row">
        <span className="text-[8px] font-bold uppercase text-teal-800">Actually acquired</span>
        {SPINE_SEQUENCE_KEYS.map((key) => {
          const on = sequences[key];
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => useWorkspace.getState().setSequencesAvailable({ [key]: !on })}
              title={SPINE_SEQUENCE_LABELS[key]}
              data-testid={`dorsal-coverage-${key}`}
              className={[
                "rounded-full border px-1.5 py-0.5 text-[8px]",
                on ? "border-teal-600 bg-teal-100 text-teal-900" : "border-slate-300 bg-white text-slate-500",
              ].join(" ")}
            >
              {SPINE_SEQUENCE_LABELS[key]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DorsalNumberingControl({ disabled }: { disabled?: boolean }) {
  const numbering = useWorkspace((s) => s.dorsalNumbering);
  const setNumbering = useWorkspace((s) => s.setDorsalNumbering);
  const banner = dorsalNumberingBanner(numbering);

  return (
    <div className="rounded border border-teal-100 bg-white/60 p-1.5 space-y-1" data-testid="dorsal-numbering-control">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-teal-800">Numbering basis</span>
        <select
          className={FIELD}
          value={numbering.mode}
          disabled={disabled}
          data-testid="dorsal-numbering-mode"
          onChange={(e) => setNumbering({ mode: e.target.value as DorsalNumberingMode })}
        >
          {DORSAL_NUMBERING_MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <span className="text-[8px] font-bold uppercase text-teal-800">Coverage</span>
        <select
          className={FIELD}
          value={numbering.coverage}
          disabled={disabled}
          data-testid="dorsal-coverage-extent"
          onChange={(e) => setNumbering({ coverage: e.target.value as DorsalCoverageExtent })}
        >
          {DORSAL_COVERAGE_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(numbering.wholeSpineLocalizer)}
            disabled={disabled}
            data-testid="dorsal-numbering-localizer"
            onChange={(e) => setNumbering({ wholeSpineLocalizer: e.target.checked })}
          />
          whole-spine / localizer available
        </label>
        <input
          className={`${FIELD} w-40`}
          placeholder="stated designation (optional)"
          value={numbering.designationNote ?? ""}
          disabled={disabled}
          data-testid="dorsal-numbering-note"
          onChange={(e) => setNumbering({ designationNote: e.target.value })}
        />
      </div>
      {banner ? (
        <p className="rounded bg-amber-50 px-1 py-0.5 text-[8px] text-amber-900" data-testid="dorsal-numbering-banner">
          {banner}
        </p>
      ) : null}
      <p className="text-[8px] text-slate-500">
        Changing coverage or numbering never re-labels an existing observation silently: out-of-scope level rows disappear
        from the picker and the validator reports them for review.
      </p>
    </div>
  );
}

function DorsalLevelDetailForm({
  ctx,
  ledgerRegion,
  onClose,
  disabled,
}: {
  ctx: DorsalTileContext;
  ledgerRegion: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  // Conus fields belong to the junction level only, and only when the acquired
  // coverage actually reached it (spec §12).
  const conusAllowed = conusCovered(ctx.numbering) && dorsalConusLevelAllowed(ctx.level, ctx.numbering);
  // Prefill FROM the ledger so the form is a view of the observation model.
  const fromLedger = useMemo(
    () => deriveDorsalLevelDetail(patches, ctx.level),
    [patches, ctx.level],
  );
  const [detail, setDetail] = useState<DorsalLevelDetail>(fromLedger);
  const patch = (next: Partial<DorsalLevelDetail>) => setDetail((prev) => ({ ...prev, ...next }));

  /**
   * The AP canal diameter is the one field in this form that is not the form's
   * own. It is the canonical measurement record for this level — the same record
   * the dorsal canal table writes — so a number typed here appears in that table,
   * in the draft, and in the printed measurement block, and a number in the
   * table appears here. `detail.apMm` survives only as the prefill for a level
   * whose number exists solely in an old report's prose.
   *
   * Everything downstream reads through `detailWithAp`, which is the record
   * projected into the level detail at the moment of composition. Nothing writes
   * back: the ledger observation is an output of this form, never a second store.
   */
  const apCell = useCanalApCell({
    level: ctx.level,
    segment: "dorsal",
    legacy: detail.apMm ?? null,
  });
  const detailWithAp: DorsalLevelDetail = { ...detail, apMm: apCell.committed };

  const apply = () => {
    const built = buildDorsalLevelBundle({
      level: ctx.level,
      detail: detailWithAp,
      numbering: ctx.numbering,
      sequences: ctx.sequences,
      region: ledgerRegion,
    });
    if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  const foramSides = (["right", "left"] as const).map((s) => ({
    label: s === "right" ? "Right" : "Left",
    get: (): DorsalForaminalSideDetail | null | undefined => (s === "right" ? detail.foramRight : detail.foramLeft),
    set: (next: DorsalForaminalSideDetail | null) => patch(s === "right" ? { foramRight: next } : { foramLeft: next }),
  }));

  return (
    <div className="rounded border border-sky-200 bg-sky-50/50 p-1.5 space-y-1.5" data-testid="dorsal-detail-form">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-sky-900">Level detail — {ctx.level}</span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="dorsal-detail-close">close</button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Canal morphology</span>
        <select
          className={FIELD}
          value={detail.canalMorphology ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-canal-morphology"
          onChange={(e) => patch({ canalMorphology: (e.target.value || null) as DorsalLevelDetail["canalMorphology"] })}
        >
          <option value="">—</option>
          {DORSAL_CANAL_MORPHOLOGY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.1"
          min="0"
          placeholder="AP mm"
          value={apCell.value}
          disabled={disabled}
          data-testid="dorsal-detail-ap-mm"
          onChange={(e) => apCell.onChange(e.target.value)}
          onBlur={apCell.onBlur}
        />
        <span className="text-[8px] font-bold uppercase text-sky-800">Canal severity</span>
        <select
          className={FIELD}
          value={detail.canalSeverity ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-canal-severity"
          onChange={(e) => patch({ canalSeverity: (e.target.value || null) as DorsalLevelDetail["canalSeverity"] })}
        >
          <option value="">—</option>
          {DORSAL_SEVERITY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Disc location</span>
        <select
          className={FIELD}
          value={detail.discLocation ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-disc-location"
          onChange={(e) => patch({ discLocation: (e.target.value || null) as DorsalLevelDetail["discLocation"] })}
        >
          <option value="">—</option>
          {DORSAL_DISC_LOCATION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <span className="text-[8px] font-bold uppercase text-sky-800">Migration</span>
        <select
          className={FIELD}
          value={detail.migration ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-migration"
          onChange={(e) => patch({ migration: (e.target.value || null) as DorsalLevelDetail["migration"] })}
        >
          <option value="">—</option>
          {DORSAL_MIGRATION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.1"
          min="0"
          placeholder="mm"
          value={detail.migrationMm ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-migration-mm"
          onChange={(e) => patch({ migrationMm: num(e.target.value) ?? null })}
        />
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.calcified)}
            disabled={disabled}
            data-testid="dorsal-detail-calcified"
            onChange={(e) => patch({ calcified: e.target.checked })}
          />
          calcified / low-signal disc component
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Cord at this level</span>
        <select
          className={FIELD}
          value={detail.cordEffect ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-cord-effect"
          onChange={(e) => patch({ cordEffect: (e.target.value || null) as DorsalLevelDetail["cordEffect"] })}
        >
          <option value="">—</option>
          {DORSAL_CORD_EFFECT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.cordSignal)}
            disabled={disabled || !ctx.sequences.t2}
            data-testid="dorsal-detail-cord-signal"
            onChange={(e) => patch({ cordSignal: e.target.checked })}
          />
          intrinsic T2/STIR signal abnormality
        </label>
        {!ctx.sequences.t2 ? <span className="text-[8px] text-rose-700">no T2 acquired — cord signal cannot be stated</span> : null}
      </div>

      {foramSides.map((row) => (
        <div key={row.label} className="flex flex-wrap items-center gap-1" data-testid={`dorsal-detail-foram-${row.label.toLowerCase()}`}>
          <span className="text-[8px] font-bold uppercase text-slate-600 w-28">{row.label} foramen</span>
          <select
            className={FIELD}
            value={row.get()?.severity ?? ""}
            disabled={disabled || !ctx.sequences.axial}
            data-testid={`dorsal-detail-foram-${row.label.toLowerCase()}-severity`}
            onChange={(e) => row.set({
              ...row.get(),
              severity: (e.target.value || null) as DorsalForaminalSideDetail["severity"],
            })}
          >
            <option value="">—</option>
            {DORSAL_SEVERITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select
            className={FIELD}
            value={row.get()?.cause ?? ""}
            disabled={disabled || !ctx.sequences.axial}
            data-testid={`dorsal-detail-foram-${row.label.toLowerCase()}-cause`}
            onChange={(e) => row.set({
              ...row.get(),
              cause: (e.target.value || null) as DorsalForaminalSideDetail["cause"],
            })}
          >
            <option value="">cause…</option>
            {DORSAL_FORAMINAL_CAUSE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <input
            className={`${FIELD} w-44`}
            placeholder="root wording (descriptive only)"
            value={row.get()?.rootDescriptive ?? ""}
            disabled={disabled}
            data-testid={`dorsal-detail-foram-${row.label.toLowerCase()}-root`}
            onChange={(e) => row.set({ ...row.get(), rootDescriptive: e.target.value })}
          />
        </div>
      ))}
      {!ctx.sequences.axial ? (
        <p className="text-[8px] text-slate-500" data-testid="dorsal-detail-axial-note">
          No axial sequences acquired: foraminal grading is disabled; descriptive wording remains available.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Ligamentum flavum</span>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.flavum?.hypertrophy)}
            disabled={disabled}
            data-testid="dorsal-detail-lf-hypertrophy"
            onChange={(e) => patch({ flavum: { ...detail.flavum, hypertrophy: e.target.checked } })}
          />
          hypertrophy
        </label>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.1"
          min="0"
          placeholder="mm"
          value={detail.flavum?.thicknessMm ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-lf-mm"
          onChange={(e) => patch({ flavum: { ...detail.flavum, thicknessMm: num(e.target.value) ?? null } })}
        />
        <select
          className={FIELD}
          value={detail.flavum?.ossification ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-olf"
          onChange={(e) => patch({
            flavum: { ...detail.flavum, ossification: (e.target.value || null) as DorsalFlavumDetail["ossification"] },
          })}
        >
          <option value="">ossification (select)…</option>
          {DORSAL_OLF_MORPHOLOGY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select
          className={FIELD}
          value={detail.flavum?.laterality ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-olf-side"
          onChange={(e) => patch({
            flavum: { ...detail.flavum, laterality: (e.target.value || null) as DorsalFlavumDetail["laterality"] },
          })}
        >
          <option value="">side…</option>
          <option value="right">right</option>
          <option value="left">left</option>
          <option value="bilateral">bilateral</option>
        </select>
      </div>
      <p className="text-[8px] text-slate-500">
        OLF is only stated when selected here — low-signal ligamentous thickening alone is not converted into ossification.
      </p>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Costovertebral</span>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.costovertebral?.arthropathy)}
            disabled={disabled}
            data-testid="dorsal-detail-cv-arthropathy"
            onChange={(e) => patch({ costovertebral: { ...detail.costovertebral, arthropathy: e.target.checked } })}
          />
          arthropathy
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.costovertebral?.osteophytes)}
            disabled={disabled}
            data-testid="dorsal-detail-cv-osteophytes"
            onChange={(e) => patch({ costovertebral: { ...detail.costovertebral, osteophytes: e.target.checked } })}
          />
          osteophytes
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Listhesis</span>
        <select
          className={FIELD}
          value={detail.listhesis?.direction ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-listhesis-direction"
          onChange={(e) => patch({
            listhesis: { ...detail.listhesis, direction: (e.target.value || null) as DorsalListhesisDetail["direction"] },
          })}
        >
          <option value="">direction…</option>
          <option value="antero">anterolisthesis</option>
          <option value="retro">retrolisthesis</option>
        </select>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.1"
          min="0"
          placeholder="mm"
          value={detail.listhesis?.translationMm ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-listhesis-mm"
          onChange={(e) => patch({ listhesis: { ...detail.listhesis, translationMm: num(e.target.value) ?? null } })}
        />
        <span className="text-[8px] font-bold uppercase text-sky-800">Epidural</span>
        <select
          className={FIELD}
          value={detail.epidural?.finding ?? ""}
          disabled={disabled}
          data-testid="dorsal-detail-epidural"
          onChange={(e) => patch({
            epidural: { ...detail.epidural, finding: (e.target.value || null) as DorsalEpiduralDetail["finding"] },
          })}
        >
          <option value="">finding…</option>
          {DORSAL_EPIDURAL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.epidural?.canalEffect)}
            disabled={disabled}
            data-testid="dorsal-detail-epidural-canal"
            onChange={(e) => patch({ epidural: { ...detail.epidural, canalEffect: e.target.checked } })}
          />
          canal effect
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.epidural?.cordEffect)}
            disabled={disabled}
            data-testid="dorsal-detail-epidural-cord"
            onChange={(e) => patch({ epidural: { ...detail.epidural, cordEffect: e.target.checked } })}
          />
          cord effect
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1" data-testid="dorsal-detail-conus-row">
        <span className="text-[8px] font-bold uppercase text-sky-800">Conus (junction level, when covered)</span>
        <input
          className={`${FIELD} w-24`}
          placeholder="termination level"
          value={detail.conus?.terminationLevel ?? ""}
          disabled={disabled || !conusAllowed}
          data-testid="dorsal-detail-conus-level"
          onChange={(e) => patch({ conus: { ...detail.conus, terminationLevel: e.target.value } })}
        />
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.conus?.compressed)}
            disabled={disabled || !conusAllowed}
            data-testid="dorsal-detail-conus-compressed"
            onChange={(e) => patch({ conus: { ...detail.conus, compressed: e.target.checked } })}
          />
          compressed
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.conus?.signalAbnormality)}
            disabled={disabled || !conusAllowed}
            data-testid="dorsal-detail-conus-signal"
            onChange={(e) => patch({ conus: { ...detail.conus, signalAbnormality: e.target.checked } })}
          />
          signal abnormality
        </label>
        {!conusAllowed ? (
          <span className="text-[8px] text-rose-700" data-testid="dorsal-detail-conus-blocked">
            {conusCovered(ctx.numbering)
              ? "conus fields apply to the thoracolumbar junction level, not this level"
              : "coverage does not reach the thoracolumbar junction — conus fields disabled"}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        disabled={disabled || !dorsalLevelDetailHasContent(detailWithAp)}
        onClick={apply}
        className="h-7 rounded-md bg-sky-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
        data-testid="dorsal-detail-apply"
      >
        Apply level detail to report
      </button>
    </div>
  );
}

function DorsalLesionForm({
  ctx,
  ledgerRegion,
  onClose,
  disabled,
}: {
  ctx: DorsalTileContext;
  ledgerRegion: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState<DorsalLesionInput>({
    compartment: "epidural",
    level: ctx.level,
  });
  const patch = (next: Partial<DorsalLesionInput>) => setInput((prev) => ({ ...prev, ...next }));

  const apply = () => {
    const built = buildDorsalLesionBundle(
      { ...input, level: input.level || ctx.level, level2: input.level2 || ctx.level2 },
      ctx,
    );
    if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  const compartments: Array<{ id: DorsalLesionCompartment; label: string }> = [
    { id: "epidural", label: "Epidural" },
    { id: "intradural", label: "Intradural extramedullary" },
    { id: "intramedullary", label: "Intramedullary" },
    { id: "vertebral", label: "Vertebral body" },
    { id: "paravertebral", label: "Paravertebral" },
    { id: "postop_collection", label: "Post-operative collection" },
  ];

  return (
    <div className="rounded border border-violet-200 bg-violet-50/50 p-1.5 space-y-1.5" data-testid="dorsal-lesion-form">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-violet-900">Lesion / collection — {ctx.level}</span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="dorsal-lesion-close">close</button>
      </div>

      <div className="flex flex-wrap items-center gap-1" data-testid="dorsal-lesion-compartments">
        {compartments.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={disabled}
            onClick={() => patch({ compartment: c.id })}
            data-testid={`dorsal-lesion-compartment-${c.id}`}
            className={[
              "rounded border px-1.5 py-0.5 text-[9px]",
              input.compartment === c.id
                ? "border-violet-600 bg-violet-600 text-white font-semibold"
                : "border-slate-300 bg-white text-slate-800",
            ].join(" ")}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input className={`${FIELD} w-20`} placeholder="level" value={input.level} disabled={disabled} data-testid="dorsal-lesion-level" onChange={(e) => patch({ level: e.target.value })} />
        <input className={`${FIELD} w-20`} placeholder="extent to…" value={input.level2 ?? ""} disabled={disabled} data-testid="dorsal-lesion-level2" onChange={(e) => patch({ level2: e.target.value })} />
        <select className={FIELD} value={input.laterality ?? ""} disabled={disabled} data-testid="dorsal-lesion-side" onChange={(e) => patch({ laterality: (e.target.value || undefined) as DorsalSide | undefined })}>
          <option value="">side…</option>
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="bilateral">bilateral</option>
        </select>
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="AP mm" value={input.apMm ?? ""} disabled={disabled} data-testid="dorsal-lesion-ap" onChange={(e) => patch({ apMm: num(e.target.value) })} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="TR mm" value={input.transverseMm ?? ""} disabled={disabled} data-testid="dorsal-lesion-tr" onChange={(e) => patch({ transverseMm: num(e.target.value) })} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="CC mm" value={input.craniocaudalMm ?? ""} disabled={disabled} data-testid="dorsal-lesion-cc" onChange={(e) => patch({ craniocaudalMm: num(e.target.value) })} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input className={`${FIELD} w-16`} placeholder="T1" value={input.t1 ?? ""} disabled={disabled} data-testid="dorsal-lesion-t1" onChange={(e) => patch({ t1: e.target.value })} />
        <input className={`${FIELD} w-16`} placeholder="T2" value={input.t2 ?? ""} disabled={disabled} data-testid="dorsal-lesion-t2" onChange={(e) => patch({ t2: e.target.value })} />
        <input className={`${FIELD} w-16`} placeholder="STIR" value={input.stir ?? ""} disabled={disabled || !ctx.sequences.stir} data-testid="dorsal-lesion-stir" onChange={(e) => patch({ stir: e.target.value })} />
        <input className={`${FIELD} w-20`} placeholder="DWI/ADC" value={input.dwi ?? ""} disabled={disabled || !ctx.sequences.dwi} data-testid="dorsal-lesion-dwi" onChange={(e) => patch({ dwi: e.target.value })} />
        <input className={`${FIELD} w-24`} placeholder="susceptibility" value={input.susceptibility ?? ""} disabled={disabled || !ctx.sequences.dwi} data-testid="dorsal-lesion-susceptibility" onChange={(e) => patch({ susceptibility: e.target.value })} />
        <select className={FIELD} value={input.enhancement ?? ""} disabled={disabled || !ctx.sequences.contrast} data-testid="dorsal-lesion-enhancement" onChange={(e) => patch({ enhancement: (e.target.value || undefined) as DorsalLesionInput["enhancement"] })}>
          <option value="">enhancement…</option>
          <option value="none">none</option>
          <option value="rim">rim</option>
          <option value="diffuse">diffuse</option>
          <option value="heterogeneous">heterogeneous</option>
          <option value="intense">intense</option>
        </select>
      </div>
      <p className="text-[8px] text-slate-500" data-testid="dorsal-lesion-gate-note">
        STIR / DWI / enhancement fields are disabled when the corresponding acquisition was not performed; the report will
        state the limitation instead of a conclusion.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input type="checkbox" checked={Boolean(input.canalEffect)} disabled={disabled} data-testid="dorsal-lesion-canal-effect" onChange={(e) => patch({ canalEffect: e.target.checked })} />
          canal effect
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input type="checkbox" checked={Boolean(input.cordEffect)} disabled={disabled} data-testid="dorsal-lesion-cord-effect" onChange={(e) => patch({ cordEffect: e.target.checked })} />
          cord effect
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input type="checkbox" checked={Boolean(input.foraminalEffect)} disabled={disabled} data-testid="dorsal-lesion-foraminal-effect" onChange={(e) => patch({ foraminalEffect: e.target.checked })} />
          foraminal effect
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input type="checkbox" checked={Boolean(input.paravertebralExtension)} disabled={disabled} data-testid="dorsal-lesion-paravertebral" onChange={(e) => patch({ paravertebralExtension: e.target.checked })} />
          paravertebral extension
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <input className={`${FIELD} w-56`} placeholder="own description (optional)" value={input.label ?? ""} disabled={disabled} data-testid="dorsal-lesion-label" onChange={(e) => patch({ label: e.target.value })} />
        <button
          type="button"
          disabled={disabled}
          onClick={apply}
          className="h-7 rounded-md bg-violet-600 px-2 text-[10px] font-semibold text-white disabled:opacity-40"
          data-testid="dorsal-lesion-apply"
        >
          Add lesion observation
        </button>
      </div>
    </div>
  );
}
