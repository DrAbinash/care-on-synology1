/**
 * MriDorsoLumbarSubMasterPanel.tsx — the fourteen Dorso-Lumbar palettes, the
 * coverage / numbering control and the single level-entry point.
 *
 * Architectural reference: MriDorsalSubMasterPanel.tsx / MriLumbarSubMasterPanel.tsx
 *
 * Three rules this panel exists to enforce:
 *
 *  1. The level list comes from `dorsoLumbarLevelEntryOptions(dorsoLumbarNumbering)`
 *     — the same resolver the canvas, the AP table and the Findings composer use.
 *     No level array is written here.
 *  2. Tiles and presets compile through `mriDorsoLumbarSubMasters` and are applied
 *     with `applyMacroBundle` on the one ledger. A gate that refuses a tile also
 *     refuses the programmatic path, so a struck-through label cannot be applied
 *     by any other caller.
 *  3. Lumbar transitional (LSTV) numbering is edited on the SHARED lumbar slice,
 *     not on a Dorso-Lumbar copy, so the LS module and this one can never drift
 *     apart; the Dorso-Lumbar state composes it rather than owning it.
 */

import { useMemo, useState } from "react";

import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  DORSOLUMBAR_PRESETS,
  DORSOLUMBAR_SUBMASTER_IDS,
  MRI_DORSOLUMBAR_SUB_MASTERS,
  buildDorsoLumbarPresetBundle,
  buildDorsoLumbarTileBundle,
  dorsoLumbarPresetBundleId,
  dorsoLumbarTileAvailability,
  dorsoLumbarTileBundleId,
  type DorsoLumbarSide,
  type DorsoLumbarSubMasterId,
  type DorsoLumbarTile,
  type DorsoLumbarTileContext,
} from "@/lib/mriDorsoLumbarSubMasters";
import { dorsoLumbarLevelEntryOptions, buildDorsoLumbarLevelEntry } from "@/lib/mriDorsoLumbarLevelEntry";
import {
  CASTELLVI_OPTIONS,
  LUMBAR_NUMBERING_MODES,
  defaultLumbarNumbering,
} from "@/lib/mriSpineNumbering";
import {
  DORSOLUMBAR_NUMBERING_MODES,
  dorsolumbarFullLevelSequence,
  dorsolumbarLevelKeyStrings,
  type DorsoLumbarNumberingMode,
  type DorsoLumbarState,
} from "@/lib/mriDorsoLumbarCoverage";
import { dorsolumbarJunctionWarnings } from "@/lib/mriDorsoLumbarJunction";
import { isDorsoLumbarDedicated } from "@/lib/mriDorsoLumbarCatalog";
import type { DorsalLevelDetail } from "@/lib/mriDorsalLevelDetail";
import type { LumbarLevelDetail } from "@/lib/mriLumbarLevelDetail";
import type { SpineSequenceKey } from "@/lib/mriSpineSequences";

const num = (raw: string): number | undefined => {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

const SEQUENCE_CHIPS: Array<{ key: SpineSequenceKey; label: string }> = [
  { key: "t1", label: "T1" },
  { key: "t2", label: "T2" },
  { key: "stir", label: "STIR / FS" },
  { key: "axial", label: "Axial" },
  { key: "dwi", label: "DWI" },
  { key: "contrast", label: "Contrast" },
  { key: "wholeSpineLocalizer", label: "Whole-spine localizer" },
  { key: "dynamic", label: "Dynamic" },
];

const FIELD = "h-6 rounded border border-slate-300 bg-white px-1 text-[9px]";
const MINI = "h-5 rounded border border-slate-300 bg-white px-1 text-[8px]";

export function MriDorsoLumbarSubMasterPanel({
  disabled,
  ledgerRegion,
}: {
  disabled?: boolean;
  /** Usually left unset: the composition assigns each level its own region. */
  ledgerRegion?: string;
}) {
  const dlState = useWorkspace((s) => s.dorsoLumbarNumbering);
  const lumbarNumbering = useWorkspace((s) => s.lumbarNumbering);
  const sequences = useWorkspace((s) => s.sequencesAvailable);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const composition = useWorkspace((s) => s.studyComposition);
  const orderFrozen = useWorkspace((s) => s.impressionOrderFrozen);

  // The lumbar half is the shared slice, composed rather than copied (spec §2).
  const state = useMemo(() => ({ ...dlState, lumbar: lumbarNumbering }), [dlState, lumbarNumbering]);

  const levels = useMemo(() => panelLevels(state), [state]);
  const [level, setLevel] = useState(() => levels.find((l) => l.junction)?.level ?? levels[0]?.level ?? "");
  const [activePalettes, setActivePalettes] = useState<DorsoLumbarSubMasterId[]>(["routine", "degenerative"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [side, setSide] = useState<DorsoLumbarSide | "">("");
  const [root, setRoot] = useState("");
  const [mm, setMm] = useState("");
  const [mm2, setMm2] = useState("");
  const [pct, setPct] = useState("");
  const [cm, setCm] = useState("");
  const [cm2, setCm2] = useState("");
  const [degree, setDegree] = useState("");
  const [level2, setLevel2] = useState("");
  const [conusLevel, setConusLevel] = useState("");
  const [vertebra, setVertebra] = useState("");
  const [vertebra2, setVertebra2] = useState("");
  const [direction, setDirection] = useState<"superiorly" | "inferiorly" | "">("");
  const [choice, setChoice] = useState<"with" | "without" | "">("");

  const activeLevel = levels.some((l) => l.level === level) ? level : (levels[0]?.level ?? level);
  const activeEntry = levels.find((l) => l.level === activeLevel);

  const ctx: DorsoLumbarTileContext = {
    level: activeLevel,
    state,
    sequences,
    domain: activeEntry?.domain ?? "",
    region: ledgerRegion,
    side: side || undefined,
    root: root.trim() || undefined,
    mm: num(mm),
    mm2: num(mm2),
    pct: num(pct),
    cm: num(cm),
    cm2: num(cm2),
    degree: degree.trim() || undefined,
    level2: level2.trim() || undefined,
    conusLevel: conusLevel.trim() || undefined,
    vertebra: vertebra.trim() || undefined,
    vertebra2: vertebra2.trim() || undefined,
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

  const junctionWarnings = useMemo(
    () => dorsolumbarJunctionWarnings(patches, composition),
    [patches, composition],
  );

  const onTile = (tile: DorsoLumbarTile) => {
    if (disabled) return;
    const bundleId = dorsoLumbarTileBundleId(tile.id, ctx.level);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    const gate = dorsoLumbarTileAvailability(tile, ctx);
    if (!gate.available) {
      setNotice(gate.notice ?? "This statement is not supported by the recorded coverage or protocol.");
      return;
    }
    const built = buildDorsoLumbarTileBundle(tile.id, ctx);
    if (built.observations.length === 0) {
      setNotice(built.notice ?? "Nothing was written.");
      return;
    }
    useWorkspace.getState().applyMacroBundle({ bundleId: built.bundleId, observations: built.observations });
    setNotice(null);
  };

  /** A preset is one pattern: replace any earlier instance, don't stack. */
  const removePresetInstances = (presetId: string) => {
    const ws = useWorkspace.getState();
    const prefix = dorsoLumbarPresetBundleId(presetId, "").replace(/-$/, "");
    [...activeBundles]
      .filter((id) => id === prefix || id.startsWith(`${prefix}-`))
      .forEach((id) => ws.removeMacroBundle(id));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = DORSOLUMBAR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const bundleId = dorsoLumbarPresetBundleId(presetId, ctx.level);
    if (activeBundles.has(bundleId)) {
      removePresetInstances(presetId);
      setNotice(null);
      return;
    }
    removePresetInstances(presetId);
    const built = buildDorsoLumbarPresetBundle(presetId, ctx);
    if (built.observations.length === 0) {
      setNotice(built.notice ?? "This starting pattern is not supported on this examination.");
      return;
    }
    useWorkspace.getState().applyMacroBundle({ bundleId: built.bundleId, observations: built.observations });
    setNotice(built.notice ?? null);
    if (presetId === "preset-normal-dorsolumbar") useWorkspace.getState().seedSystemNormalImpression();
  };

  return (
    <div
      className="rounded-md border border-teal-200/80 bg-teal-50/30 px-2 py-2 space-y-2"
      data-testid="mri-dorsolumbar-submaster-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-teal-900">
          MRI Dorso-Lumbar Spine — clinical sub-masters
        </span>
        <span className="text-[8px] text-muted-foreground">
          One examination, one ledger · palettes filter this panel only · applied observations are never erased
        </span>
        <button
          type="button"
          disabled={disabled || orderFrozen}
          onClick={() => useWorkspace.getState().orderImpressionByPriority()}
          title={orderFrozen
            ? "The Impression was hand-edited or reordered — automatic priority sorting stays off"
            : "Re-sort the derived Impression by clinical priority (sentences are never rewritten)"}
          data-testid="dorsolumbar-sort-impression-by-priority"
          className="h-5 rounded border border-rose-400 bg-white px-1.5 text-[8px] font-semibold text-rose-800 disabled:opacity-40"
        >
          Sort Impression by priority{orderFrozen ? " (frozen)" : ""}
        </button>
      </div>

      {!isDorsoLumbarDedicated(composition) ? (
        <p className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[8px] leading-snug text-slate-600" data-testid="dorsolumbar-composition-note">
          The billed examination has not been resolved as a dedicated Dorso-Lumbar composition
          (current: {composition.replace(/-/g, " ")}). These palettes still write to the same
          ledger; confirm what was actually performed before relying on the coverage line.
        </p>
      ) : null}

      {junctionWarnings.map((w) => (
        <p
          key={w}
          className="rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[8px] leading-snug text-rose-900"
          data-testid="dorsolumbar-junction-warning"
        >
          {w}
        </p>
      ))}

      <DorsoLumbarCoverageControl disabled={disabled} state={state} />

      {/* Capture scope: the resolver's level list, never a hard-coded array. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="dorsolumbar-scope-row">
        <span className="text-[8px] font-bold uppercase text-teal-800">Level in scope</span>
        <select
          className={FIELD}
          value={activeLevel}
          disabled={disabled}
          data-testid="dorsolumbar-level-scope"
          onChange={(e) => setLevel(e.target.value)}
        >
          {levels.map((l) => (
            <option key={l.level} value={l.level}>
              {l.label} · {l.domain}{l.junction ? " · bridge" : ""}{l.transitional ? " · transitional" : ""}
            </option>
          ))}
        </select>
        {activeEntry ? (
          <span className="text-[8px] text-slate-600" data-testid="dorsolumbar-scope-neural">
            neural element: {activeEntry.neural} · ledger region:{" "}
            {activeEntry.domain === "lumbar" ? "LS Spine" : "Dorsal Spine"}
          </span>
        ) : null}
        <button
          type="button"
          className="h-5 rounded border border-slate-300 bg-white px-1.5 text-[8px] font-semibold text-slate-700 disabled:opacity-40"
          disabled={disabled || levels.length === 0}
          onClick={() => setDetailOpen((v) => !v)}
          data-testid="dorsolumbar-detail-toggle"
        >
          {detailOpen ? "Close level entry" : "Level entry"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1" data-testid="dorsolumbar-var-row">
        <input className={MINI} style={{ width: "3.2rem" }} placeholder="side" value={side} disabled={disabled}
          onChange={(e) => setSide(e.target.value as DorsoLumbarSide)} data-testid="dorsolumbar-var-side" />
        <input className={MINI} style={{ width: "3.2rem" }} placeholder="root" value={root} disabled={disabled}
          onChange={(e) => setRoot(e.target.value)} data-testid="dorsolumbar-var-root" />
        <input className={MINI} style={{ width: "3rem" }} placeholder="mm" value={mm} disabled={disabled} inputMode="decimal"
          onChange={(e) => setMm(e.target.value)} data-testid="dorsolumbar-var-mm" />
        <input className={MINI} style={{ width: "3rem" }} placeholder="mm²" value={mm2} disabled={disabled} inputMode="decimal"
          onChange={(e) => setMm2(e.target.value)} data-testid="dorsolumbar-var-mm2" />
        <input className={MINI} style={{ width: "3rem" }} placeholder="%" value={pct} disabled={disabled} inputMode="decimal"
          onChange={(e) => setPct(e.target.value)} data-testid="dorsolumbar-var-pct" />
        <input className={MINI} style={{ width: "3rem" }} placeholder="cm" value={cm} disabled={disabled} inputMode="decimal"
          onChange={(e) => setCm(e.target.value)} data-testid="dorsolumbar-var-cm" />
        <input className={MINI} style={{ width: "3rem" }} placeholder="cm²" value={cm2} disabled={disabled} inputMode="decimal"
          onChange={(e) => setCm2(e.target.value)} data-testid="dorsolumbar-var-cm2" />
        <input className={MINI} style={{ width: "4rem" }} placeholder="degree" value={degree} disabled={disabled}
          onChange={(e) => setDegree(e.target.value)} data-testid="dorsolumbar-var-degree" />
        <select className={MINI} value={level2} disabled={disabled} onChange={(e) => setLevel2(e.target.value)} data-testid="dorsolumbar-var-level2">
          <option value="">extent →</option>
          {levels.map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}
        </select>
        <input className={MINI} style={{ width: "3.6rem" }} placeholder="conus" value={conusLevel} disabled={disabled}
          onChange={(e) => setConusLevel(e.target.value)} data-testid="dorsolumbar-var-conus" />
        <input className={MINI} style={{ width: "3.2rem" }} placeholder="vertebra" value={vertebra} disabled={disabled}
          onChange={(e) => setVertebra(e.target.value)} data-testid="dorsolumbar-var-vertebra" />
        <input className={MINI} style={{ width: "3.2rem" }} placeholder="v2" value={vertebra2} disabled={disabled}
          onChange={(e) => setVertebra2(e.target.value)} data-testid="dorsolumbar-var-vertebra2" />
        <select className={MINI} value={direction} disabled={disabled}
          onChange={(e) => setDirection(e.target.value === "" ? "" : (e.target.value as "superiorly" | "inferiorly"))}
          data-testid="dorsolumbar-var-direction">
          <option value="">direction</option>
          <option value="superiorly">superiorly</option>
          <option value="inferiorly">inferiorly</option>
        </select>
        <select className={MINI} value={choice} disabled={disabled}
          onChange={(e) => setChoice(e.target.value === "" ? "" : (e.target.value as "with" | "without"))}
          data-testid="dorsolumbar-var-choice">
          <option value="">with/without</option>
          <option value="with">with</option>
          <option value="without">without</option>
        </select>
      </div>

      {notice ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[8px] leading-snug text-amber-900" data-testid="dorsolumbar-gate-notice">
          {notice} Nothing was invented to fill the gap.
        </p>
      ) : null}

      {detailOpen ? <DorsoLumbarLevelEntryForm ctx={ctx} disabled={disabled} onNotice={setNotice} /> : null}

      <div className="flex flex-wrap gap-1" data-testid="dorsolumbar-palette-bar">
        {DORSOLUMBAR_SUBMASTER_IDS.map((id) => {
          const sub = MRI_DORSOLUMBAR_SUB_MASTERS.find((s) => s.id === id)!;
          const on = activePalettes.includes(id);
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => setActivePalettes((prev) => (on ? prev.filter((p) => p !== id) : [...prev, id]))}
              className={`h-6 rounded px-1.5 text-[8px] font-semibold ring-1 ${
                on ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-teal-800 ring-teal-200"
              }`}
              data-testid={`dorsolumbar-palette-${id}`}
            >
              {sub.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="h-6 rounded bg-white px-1.5 text-[8px] font-semibold text-slate-600 ring-1 ring-slate-300"
          data-testid="dorsolumbar-show-advanced"
        >
          {showAdvanced ? "Hide advanced tiles" : "Show advanced tiles"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1" data-testid="dorsolumbar-preset-row">
        {DORSOLUMBAR_PRESETS.map((preset) => {
          const bundleId = dorsoLumbarPresetBundleId(preset.id, ctx.level);
          const applied = activeBundles.has(bundleId);
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              title={preset.hint}
              onClick={() => onPreset(preset.id)}
              className={`h-6 rounded px-1.5 text-[8px] font-semibold ring-1 ${
                applied ? "bg-rose-600 text-white ring-rose-600" : "bg-white text-rose-800 ring-rose-200"
              }`}
              data-testid={`dorsolumbar-preset-${preset.id}`}
            >
              {applied ? "Remove " : ""}{preset.label}
            </button>
          );
        })}
      </div>

      {activePalettes.map((id) => {
        const sub = MRI_DORSOLUMBAR_SUB_MASTERS.find((s) => s.id === id);
        if (!sub) return null;
        const tiles = sub.tiles.filter((t) => showAdvanced || !t.advanced);
        const groups = tiles.reduce<Record<string, DorsoLumbarTile[]>>((acc, t) => {
          (acc[t.group] ??= []).push(t);
          return acc;
        }, {});
        return (
          <section key={id} className="rounded border border-teal-100 bg-white/60 px-1.5 py-1.5" data-testid={`dorsolumbar-palette-panel-${id}`}>
            <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-teal-800">
              {sub.label} — {sub.hint}
            </p>
            {Object.entries(groups).map(([group, list]) => (
              <div key={group} className="mb-1">
                <p className="text-[8px] font-bold text-slate-500">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {list.map((tile) => {
                    const bundleId = dorsoLumbarTileBundleId(tile.id, ctx.level);
                    const applied = activeBundles.has(bundleId);
                    const gate = dorsoLumbarTileAvailability(tile, ctx);
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        disabled={disabled}
                        data-available={gate.available ? "true" : "false"}
                        data-testid={`dorsolumbar-tile-${tile.id}`}
                        title={gate.available ? tile.label : `${tile.label} — ${gate.notice ?? "not supported"}`}
                        onClick={() => onTile(tile)}
                        className={
                          applied
                            ? "h-6 rounded bg-sky-700 px-1.5 text-[8px] font-semibold text-white ring-1 ring-sky-700"
                            : gate.available
                              ? "h-6 rounded bg-white px-1.5 text-[8px] font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                              : "h-6 rounded border-dashed bg-slate-50 px-1.5 text-[8px] text-slate-400 line-through ring-1 ring-slate-200"
                        }
                      >
                        {tile.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The resolver's level list for the panel. Imported, never assembled here: the
 * canvas, the AP table and this panel must not drift into three level arrays.
 */
function panelLevels(state: DorsoLumbarState) {
  return dorsoLumbarLevelEntryOptions(state);
}

function DorsoLumbarCoverageControl({
  disabled,
  state,
}: {
  disabled?: boolean;
  state: DorsoLumbarState;
}) {
  const full = useMemo(() => dorsolumbarFullLevelSequence(state.lumbar), [state.lumbar]);
  const setDl = useWorkspace((s) => s.setDorsoLumbarNumbering);
  const setLumbar = useWorkspace((s) => s.setLumbarNumbering);
  const lumbarKeys = dorsolumbarLevelKeyStrings(state);

  return (
    <div className="rounded border border-slate-200 bg-white/70 px-1.5 py-1.5 space-y-1" data-testid="dorsolumbar-coverage-control">
      <p className="text-[8px] font-bold uppercase tracking-wide text-teal-800">Acquired coverage and numbering</p>
      <div className="flex flex-wrap items-center gap-1">
        <label className="text-[8px] text-slate-600" htmlFor="dorsolumbar-superior">superior</label>
        <select
          id="dorsolumbar-superior"
          className={MINI}
          disabled={disabled}
          value={state.superior}
          onChange={(e) => setDl({ superior: e.target.value })}
          data-testid="dorsolumbar-superior"
        >
          {full.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <label className="text-[8px] text-slate-600" htmlFor="dorsolumbar-inferior">inferior</label>
        <select
          id="dorsolumbar-inferior"
          className={MINI}
          disabled={disabled}
          value={state.inferior}
          onChange={(e) => setDl({ inferior: e.target.value })}
          data-testid="dorsolumbar-inferior"
        >
          {full.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <select
          className={MINI}
          disabled={disabled}
          value={state.numbering}
          onChange={(e) => setDl({ numbering: e.target.value as DorsoLumbarNumberingMode })}
          data-testid="dorsolumbar-numbering-mode"
        >
          {DORSOLUMBAR_NUMBERING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <input
          className={MINI}
          style={{ width: "8rem" }}
          placeholder="designation note (optional)"
          disabled={disabled}
          value={state.designationNote ?? ""}
          onChange={(e) => setDl({ designationNote: e.target.value })}
          data-testid="dorsolumbar-designation-note"
        />
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            disabled={disabled}
            checked={state.wholeSpineLocalizer}
            onChange={(e) => setDl({ wholeSpineLocalizer: e.target.checked })}
            data-testid="dorsolumbar-localizer"
          />
          whole-spine / localizer available
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1" data-testid="dorsolumbar-lstv-row">
        <span className="text-[8px] font-bold uppercase text-slate-500">lumbar numbering (shared)</span>
        <select
          className={MINI}
          disabled={disabled}
          value={state.lumbar.mode}
          onChange={(e) => setLumbar({ ...defaultLumbarNumbering(), mode: e.target.value as never, castellvi: state.lumbar.castellvi, side: state.lumbar.side })}
          data-testid="dorsolumbar-lstv-mode"
        >
          {LUMBAR_NUMBERING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select
          className={MINI}
          disabled={disabled}
          value={state.lumbar.castellvi ?? ""}
          onChange={(e) => setLumbar({ castellvi: (e.target.value || null) as never })}
          data-testid="dorsolumbar-castellvi"
        >
          <option value="">Castellvi —</option>
          {CASTELLVI_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <span className="text-[8px] text-slate-500" data-testid="dorsolumbar-active-levels">
          {lumbarKeys.length} level{lumbarKeys.length === 1 ? "" : "s"} in the acquired field
        </span>
      </div>
    </div>
  );
}

/**
 * The single level entry. It collects the structured choices for the level in
 * scope and hands them to `buildDorsoLumbarLevelEntry`, which decides which
 * region builder compiles them — so a junction can never be entered twice and a
 * thoracic level can never be filled with lumbar fields.
 */
function DorsoLumbarLevelEntryForm({
  ctx,
  disabled,
  onNotice,
}: {
  ctx: DorsoLumbarTileContext;
  disabled?: boolean;
  onNotice: (text: string | null) => void;
}) {
  const [canalSeverity, setCanalSeverity] = useState("");
  const [discSeverity, setDiscSeverity] = useState("");
  const [neuralEffect, setNeuralEffect] = useState("");
  const [apMm, setApMm] = useState("");

  const apply = () => {
    const mm = num(apMm);
    const dorsal: DorsalLevelDetail = {
      ...(canalSeverity ? { canalSeverity: canalSeverity as never } : {}),
      ...(discSeverity ? { discSeverity: discSeverity as never } : {}),
      ...(neuralEffect ? { cordEffect: neuralEffect as never } : {}),
      ...(mm != null ? { apMm: mm } : {}),
    };
    const lumbar: LumbarLevelDetail = {
      ...(canalSeverity ? { canalMorphology: "partial_csf_effacement" as never } : {}),
      ...(discSeverity ? { migration: "none" } : {}),
    };
    const entry = buildDorsoLumbarLevelEntry({
      level: ctx.level,
      state: ctx.state,
      sequences: ctx.sequences,
      dorsal,
      lumbar,
    });
    if (entry.refused || entry.observations.length === 0) {
      onNotice(entry.notice ?? "Nothing selected for this level.");
      return;
    }
    useWorkspace.getState().applyMacroBundle({ bundleId: entry.bundleId, observations: entry.observations });
    onNotice(entry.notice ?? null);
  };

  return (
    <div className="rounded border border-slate-200 bg-white/70 px-1.5 py-1.5 space-y-1" data-testid="dorsolumbar-detail-form">
      <p className="text-[8px] font-bold uppercase tracking-wide text-teal-800">
        Level entry — {ctx.level || "no level in scope"}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <select className={MINI} value={canalSeverity} disabled={disabled} onChange={(e) => setCanalSeverity(e.target.value)} data-testid="dorsolumbar-detail-canal">
          <option value="">canal —</option>
          <option value="mild">mild narrowing</option>
          <option value="moderate">moderate narrowing</option>
          <option value="severe">severe narrowing</option>
        </select>
        <select className={MINI} value={discSeverity} disabled={disabled} onChange={(e) => setDiscSeverity(e.target.value)} data-testid="dorsolumbar-detail-disc">
          <option value="">disc —</option>
          <option value="mild">mild</option>
          <option value="moderate">moderate</option>
          <option value="severe">severe</option>
        </select>
        <select className={MINI} value={neuralEffect} disabled={disabled} onChange={(e) => setNeuralEffect(e.target.value)} data-testid="dorsolumbar-detail-neural">
          <option value="">neural effect —</option>
          <option value="displaced">displaced</option>
          <option value="flattened">flattened</option>
          <option value="compressed">compressed</option>
        </select>
        <input className={MINI} style={{ width: "3.4rem" }} inputMode="decimal" placeholder="AP mm" value={apMm} disabled={disabled}
          onChange={(e) => setApMm(e.target.value)} data-testid="dorsolumbar-detail-ap" />
        <button type="button" className="h-5 rounded bg-sky-700 px-1.5 text-[8px] font-semibold text-white disabled:opacity-40"
          disabled={disabled || !ctx.level} onClick={apply} data-testid="dorsolumbar-detail-apply">
          Apply level entry
        </button>
      </div>
    </div>
  );
}
