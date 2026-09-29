/**
 * MriLumbarSubMasterPanel — the twelve MRI Lumbar clinical sub-masters
 * (spec §34-§38) as progressive-disclosure palettes over the ONE lumbar
 * observation model.
 *
 * Like the brain sibling (`MriBrainCanvas`), it owns no clinical state: tiles,
 * presets, level detail and the shared lesion form compile through
 * `mriLumbarSubMasters` into ledger atoms and reach the report via the existing
 * `applyMacroBundle` / `removeMacroBundle` / clinical-undo path.
 *
 * Safety rails kept from the lib layer:
 * - every level list comes from the LumbarNumberingResolver (no hard-coded
 *   L1-L5 array anywhere in this file);
 * - sequence-dependent tiles are shown struck-through with the reason instead
 *   of being silently dropped (spec §35/§42);
 * - root suggestions are warnings, never automatic corrections (spec §8).
 */

import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  LUMBAR_PRESETS,
  MRI_LUMBAR_SUB_MASTERS,
  buildLumbarLevelBundle,
  buildLumbarLesionBundle,
  buildLumbarPresetBundle,
  buildLumbarTileBundle,
  lumbarPresetBundleId,
  lumbarTileAvailability,
  lumbarTileBundleId,
  type LumbarLesionCompartment,
  type LumbarLesionInput,
  type LumbarSubMasterId,
  type LumbarTile,
  type LumbarTileContext,
} from "@/lib/mriLumbarSubMasters";
import {
  CASTELLVI_OPTIONS,
  LUMBAR_NUMBERING_MODES,
  lumbarLevelKeys,
  lumbarRootSuggestion,
  numberingBanner,
  type CastellviGrade,
  type LumbarNumberingMode,
  type LstvSide,
} from "@/lib/mriSpineNumbering";
import {
  CANAL_MORPHOLOGY_OPTIONS,
  EPIDURAL_OPTIONS,
  MIGRATION_OPTIONS,
  PERINEURAL_FAT_OPTIONS,
  RECESS_OPTIONS,
  ROOT_EFFECT_OPTIONS,
  deriveLumbarLevelDetail,
  lumbarLevelDetailHasContent,
  rootConsistencyWarning,
  type FacetDetail,
  type ForaminalSideDetail,
  type EpiduralDetail,
  type LigamentumFlavumDetail,
  type ListhesisDetail,
  type LumbarLevelDetail,
  type ParsDetail,
  type RecessSideDetail,
  type Severity,
} from "@/lib/mriLumbarLevelDetail";
import { SPINE_SEQUENCE_LABELS } from "@/lib/mriSpineSequences";
import type { LsSide } from "@/lib/mriLumbarLibrary";

const FIELD = "h-6 rounded border border-slate-200 px-1 text-[10px]";
const num = (v: string): number | undefined => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MriLumbarSubMasterPanel({
  disabled,
  ledgerRegion = "LS Spine",
}: {
  disabled?: boolean;
  ledgerRegion?: string;
}) {
  const numbering = useWorkspace((s) => s.lumbarNumbering);
  const sequences = useWorkspace((s) => s.sequencesAvailable);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const orderFrozen = useWorkspace((s) => s.impressionOrderFrozen);

  const levels = lumbarLevelKeys(numbering);
  const [level, setLevel] = useState(levels[0]?.key ?? "L4-L5");
  const [activePalettes, setActivePalettes] = useState<LumbarSubMasterId[]>(["routine", "degenerative"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lesionOpen, setLesionOpen] = useState(false);
  const [side, setSide] = useState<LsSide | "">("");
  const [root, setRoot] = useState("");
  const [mm, setMm] = useState("");
  const [mm2, setMm2] = useState("");
  const [pct, setPct] = useState("");
  const [cm, setCm] = useState("");
  const [conusLevel, setConusLevel] = useState("");
  const [vertebra, setVertebra] = useState("");
  const [direction, setDirection] = useState<"superiorly" | "inferiorly" | "">("");

  const activeLevel = levels.some((k) => k.key === level) ? level : (levels[0]?.key ?? level);
  const rootHint = lumbarRootSuggestion(activeLevel, numbering);

  const ctx: LumbarTileContext = {
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
    conusLevel: conusLevel.trim() || undefined,
    vertebra: vertebra.trim() || undefined,
    direction: direction || undefined,
  };

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) out.add(b);
    });
    return out;
  }, [patches]);

  const onTile = (tile: LumbarTile) => {
    if (disabled) return;
    const bundleId = lumbarTileBundleId(tile.id, ctx.level);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!lumbarTileAvailability(tile, ctx).available) return;
    const built = buildLumbarTileBundle(tile.id, ctx);
    if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
  };

  /** A macro preset is one pattern: replace any earlier instance, don't stack. */
  const removePresetInstances = (presetId: string) => {
    const ws = useWorkspace.getState();
    const prefix = lumbarPresetBundleId(presetId, "").replace(/-$/, "");
    [...activeBundles].filter((id) => id === prefix || id.startsWith(`${prefix}-`)).forEach((id) => ws.removeMacroBundle(id));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = LUMBAR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const bundleId = lumbarPresetBundleId(presetId, ctx.level);
    if (activeBundles.has(bundleId)) {
      removePresetInstances(presetId);
      return;
    }
    removePresetInstances(presetId);
    const built = buildLumbarPresetBundle(presetId, ctx);
    if (built.observations.length === 0) return;
    useWorkspace.getState().applyMacroBundle(built);
    if (presetId === "preset-normal-ls") useWorkspace.getState().seedSystemNormalImpression();
  };

  return (
    <div
      className="rounded-md border border-amber-200/80 bg-amber-50/30 px-2 py-2 space-y-2"
      data-testid="mri-lumbar-submaster-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-900">
          MRI Lumbar — clinical sub-masters
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
          data-testid="lumbar-sort-impression-by-priority"
          className="h-5 rounded border border-rose-400 bg-white px-1.5 text-[8px] font-semibold text-rose-800 disabled:opacity-40"
        >
          Sort Impression by priority{orderFrozen ? " (frozen)" : ""}
        </button>
      </div>

      <LumbarNumberingControl disabled={disabled} />

      {/* Capture scope: the resolver's level list, never a hard-coded array. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="lumbar-scope-row">
        <span className="text-[8px] font-bold uppercase text-amber-800">Level in scope</span>
        <select
          className={FIELD}
          value={activeLevel}
          disabled={disabled}
          data-testid="lumbar-level-scope"
          onChange={(e) => setLevel(e.target.value)}
        >
          {levels.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
        <span className="text-[8px] text-slate-500" data-testid="lumbar-root-hint">
          roots at this level: traversing {rootHint.traversing} / exiting {rootHint.exiting}
          {rootHint.uncertain ? " (uncertain without a whole-spine localizer — suggestion only)" : ""}
        </span>
      </div>

      {/* Prose variables the canonical library templates need. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="lumbar-vars-row">
        <select className={FIELD} value={side} disabled={disabled} data-testid="lumbar-var-side" onChange={(e) => setSide(e.target.value as LsSide | "")}>
          <option value="">side…</option>
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="bilateral">bilateral</option>
        </select>
        <input className={`${FIELD} w-16`} placeholder="root" value={root} disabled={disabled} data-testid="lumbar-var-root" onChange={(e) => setRoot(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="mm" value={mm} disabled={disabled} data-testid="lumbar-var-mm" onChange={(e) => setMm(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="mm2" value={mm2} disabled={disabled} data-testid="lumbar-var-mm2" onChange={(e) => setMm2(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="1" min="0" placeholder="%" value={pct} disabled={disabled} data-testid="lumbar-var-pct" onChange={(e) => setPct(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" placeholder="cm" value={cm} disabled={disabled} data-testid="lumbar-var-cm" onChange={(e) => setCm(e.target.value)} />
        <input className={`${FIELD} w-20`} placeholder="conus level" value={conusLevel} disabled={disabled} data-testid="lumbar-var-conus" onChange={(e) => setConusLevel(e.target.value)} />
        <input className={`${FIELD} w-20`} placeholder="vertebra" value={vertebra} disabled={disabled} data-testid="lumbar-var-vertebra" onChange={(e) => setVertebra(e.target.value)} />
        <select className={FIELD} value={direction} disabled={disabled} data-testid="lumbar-var-direction" onChange={(e) => setDirection(e.target.value as LumbarTileContext["direction"])}>
          <option value="">direction…</option>
          <option value="superiorly">superiorly</option>
          <option value="inferiorly">inferiorly</option>
        </select>
        <span className="text-[8px] text-slate-500">
          empty variables stay bracketed in the sentence as visible fill-ins
        </span>
      </div>

      {root.trim()
        ? rootConsistencyWarning({
            level: activeLevel,
            location: side || null,
            root,
            numbering,
          }).map((warning) => (
            <p
              key={warning}
              className="rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[8px] text-orange-900"
              data-testid="lumbar-root-warning"
            >
              {warning} Nothing was changed — this is advisory only.
            </p>
          ))
        : null}

      {/* Palette selector — multi-active, progressive (spec §34). */}
      <div className="flex flex-wrap gap-1" data-testid="lumbar-palette-bar">
        {MRI_LUMBAR_SUB_MASTERS.map((sm) => {
          const on = activePalettes.includes(sm.id);
          return (
            <button
              key={sm.id}
              type="button"
              disabled={disabled}
              onClick={() => setActivePalettes((prev) => toggleIn(prev, sm.id))}
              title={sm.hint}
              data-testid={`lumbar-palette-${sm.id}`}
              className={[
                "rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                on ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300 bg-white text-slate-700",
              ].join(" ")}
            >
              {sm.label}
            </button>
          );
        })}
      </div>

      {activePalettes.map((paletteId) => {
        const master = MRI_LUMBAR_SUB_MASTERS.find((m) => m.id === paletteId);
        if (!master) return null;
        const presets = LUMBAR_PRESETS.filter((p) => p.subMasters.includes(paletteId));
        const groups = new Map<string, LumbarTile[]>();
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
            className="rounded border border-amber-100 bg-white/70 p-1.5 space-y-1.5"
            data-testid={`lumbar-palette-panel-${paletteId}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase text-amber-800">{master.label}</span>
              <span className="text-[8px] text-slate-500">{master.hint}</span>
            </div>

            {presets.length > 0 ? (
              <div className="flex flex-wrap gap-1" data-testid={`lumbar-presets-${paletteId}`}>
                {presets.map((p) => {
                  const on = activeBundles.has(lumbarPresetBundleId(p.id, ctx.level));
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onPreset(p.id)}
                      title={p.hint}
                      data-testid={`lumbar-preset-${p.id}`}
                      className={[
                        "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                        on
                          ? "border-rose-500 bg-rose-100 text-rose-900"
                          : p.critical
                            ? "border-rose-400 bg-white text-rose-800"
                            : "border-amber-400 bg-white text-amber-900",
                      ].join(" ")}
                    >
                      ★ {p.label}
                      {p.critical ? " (critical)" : ""}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {[...groups.entries()].map(([groupName, tiles]) => (
              <div key={groupName} className="space-y-0.5">
                <div className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{groupName}</div>
                <div className="flex flex-wrap gap-1">
                  {tiles.map((tile) => {
                    const on = activeBundles.has(lumbarTileBundleId(tile.id, ctx.level));
                    const gate = lumbarTileAvailability(tile, ctx);
                    const missing = gate.missing.map((k) => SPINE_SEQUENCE_LABELS[k]).join(" + ");
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        disabled={disabled || (!on && !gate.available)}
                        onClick={() => onTile(tile)}
                        title={gate.notice ?? tile.atoms(ctx)[0]?.findings.slice(0, 140)}
                        data-testid={`lumbar-tile-${tile.id}`}
                        className={[
                          "rounded border px-1.5 py-0.5 text-[9px]",
                          on
                            ? "border-amber-600 bg-amber-600 text-white"
                            : gate.available
                              ? "border-slate-300 bg-white text-slate-800 hover:border-amber-400"
                              : "border-slate-200 bg-slate-50 text-slate-400 line-through",
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

            {paletteId === "discNeural" || paletteId === "degenerative" ? (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setDetailOpen((v) => !v)}
                  data-testid="lumbar-detail-open"
                  className="rounded border border-sky-400 bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-900"
                >
                  Level detail — {activeLevel}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setLesionOpen((v) => !v)}
                  data-testid="lumbar-lesion-open"
                  className="rounded border border-violet-400 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-900"
                >
                  Shared lesion form
                </button>
              </div>
            ) : null}

            {hasHidden ? (
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="lumbar-show-advanced"
                className="text-[8px] font-semibold uppercase text-amber-700 underline"
              >
                {showAdvanced ? "Hide advanced / rare tiles" : "Show advanced / rare tiles"}
              </button>
            ) : null}
          </div>
        );
      })}

      {detailOpen ? (
        <LumbarLevelDetailForm
          ctx={ctx}
          ledgerRegion={ledgerRegion}
          onClose={() => setDetailOpen(false)}
          disabled={disabled}
        />
      ) : null}

      {lesionOpen ? (
        <LumbarLesionForm ctx={ctx} ledgerRegion={ledgerRegion} onClose={() => setLesionOpen(false)} disabled={disabled} />
      ) : null}
    </div>
  );
}

// ─── Vertebral numbering / LSTV resolver control (spec §5-§7) ─────────────

function LumbarNumberingControl({ disabled }: { disabled?: boolean }) {
  const numbering = useWorkspace((s) => s.lumbarNumbering);
  const setNumbering = useWorkspace((s) => s.setLumbarNumbering);
  const banner = numberingBanner(numbering);
  const lstv = numbering.mode === "lstv-sacralization" || numbering.mode === "lstv-lumbarization";

  return (
    <div className="rounded border border-orange-200 bg-white/80 p-1.5 space-y-1" data-testid="lumbar-numbering-control">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-orange-800">Vertebral numbering</span>
        <select
          className={FIELD}
          value={numbering.mode}
          disabled={disabled}
          data-testid="lumbar-numbering-mode"
          onChange={(e) => setNumbering({ mode: e.target.value as LumbarNumberingMode })}
        >
          {LUMBAR_NUMBERING_MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(numbering.wholeSpineLocalizer)}
            disabled={disabled}
            data-testid="lumbar-numbering-localizer"
            onChange={(e) => setNumbering({ wholeSpineLocalizer: e.target.checked })}
          />
          whole-spine / localizer coverage
        </label>
      </div>
      {lstv ? (
        <div className="flex flex-wrap items-center gap-1">
          <select
            className={FIELD}
            value={numbering.castellvi ?? ""}
            disabled={disabled}
            data-testid="lumbar-castellvi"
            onChange={(e) => setNumbering({ castellvi: (e.target.value || null) as CastellviGrade | null })}
          >
            <option value="">Castellvi…</option>
            {CASTELLVI_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select
            className={FIELD}
            value={numbering.side ?? ""}
            disabled={disabled}
            data-testid="lumbar-lstv-side"
            onChange={(e) => setNumbering({ side: (e.target.value || null) as LstvSide | null })}
          >
            <option value="">unilateral / bilateral…</option>
            <option value="unilateral">unilateral</option>
            <option value="bilateral">bilateral</option>
          </select>
          {(["pseudoarthrosis", "reactiveMarrowChange"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-1 text-[8px] text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(numbering[flag])}
                disabled={disabled}
                data-testid={`lumbar-lstv-${flag}`}
                onChange={(e) => setNumbering({ [flag]: e.target.checked })}
              />
              {flag === "pseudoarthrosis" ? "pseudoarthrosis" : "reactive marrow change"}
            </label>
          ))}
        </div>
      ) : null}
      {numbering.mode === "manual" ? (
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          designated L5
          <input
            className={`${FIELD} w-28`}
            value={numbering.designatedL5Label ?? ""}
            disabled={disabled}
            data-testid="lumbar-designated-l5"
            onChange={(e) => setNumbering({ designatedL5Label: e.target.value })}
          />
        </label>
      ) : null}
      {banner ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[8px] font-semibold text-amber-900" data-testid="lumbar-numbering-banner">
          {banner}
        </p>
      ) : null}
      <p className="text-[8px] text-slate-500">
        Changing the mode re-labels every level row, AP canal table entry, root suggestion and LS screening level at
        once — the resolver is the only source of level names.
      </p>
    </div>
  );
}

// ─── Per-level detail (spec §9-§11) ────────────────────────────────────────

function LumbarLevelDetailForm({
  ctx,
  ledgerRegion,
  onClose,
  disabled,
}: {
  ctx: LumbarTileContext;
  ledgerRegion: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  // Prefill FROM the ledger so the form is a view of the observation model.
  const fromLedger = useMemo(
    () => deriveLumbarLevelDetail(patches, ctx.level),
    [patches, ctx.level],
  );
  const [detail, setDetail] = useState<LumbarLevelDetail>(fromLedger);
  const patch = (next: Partial<LumbarLevelDetail>) => setDetail((prev) => ({ ...prev, ...next }));

  const apply = () => {
    const built = buildLumbarLevelBundle({
      level: ctx.level,
      detail,
      numbering: ctx.numbering,
      sequences: ctx.sequences,
      region: ledgerRegion,
    });
    if (built.observations.length > 0) useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  type SideAccessor<T> = {
    label: string;
    get: () => T | null | undefined;
    set: (next: T | null) => void;
  };
  const recessSides: Array<SideAccessor<RecessSideDetail>> = (["right", "left"] as const).map((s) => ({
    label: s === "right" ? "Right" : "Left",
    get: () => (s === "right" ? detail.recessRight : detail.recessLeft),
    set: (next) => patch(s === "right" ? { recessRight: next } : { recessLeft: next }),
  }));
  const foramSides: Array<SideAccessor<ForaminalSideDetail>> = (["right", "left"] as const).map((s) => ({
    label: s === "right" ? "Right" : "Left",
    get: () => (s === "right" ? detail.foramRight : detail.foramLeft),
    set: (next) => patch(s === "right" ? { foramRight: next } : { foramLeft: next }),
  }));
  const recessSeverity = (s: RecessSideDetail | null | undefined) => s?.severity ?? "";

  return (
    <div className="rounded border border-sky-200 bg-sky-50/50 p-1.5 space-y-1.5" data-testid="lumbar-detail-form">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-sky-900">Level detail — {ctx.level}</span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="lumbar-detail-close">close</button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-sky-800">Canal morphology</span>
        <select
          className={FIELD}
          value={detail.canalMorphology ?? ""}
          disabled={disabled}
          data-testid="detail-canal-morphology"
          onChange={(e) => patch({ canalMorphology: (e.target.value || null) as LumbarLevelDetail["canalMorphology"] })}
        >
          <option value="">—</option>
          {CANAL_MORPHOLOGY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <span className="text-[8px] font-bold uppercase text-sky-800">Migration</span>
        <select
          className={FIELD}
          value={detail.migration ?? ""}
          disabled={disabled}
          data-testid="detail-migration"
          onChange={(e) => patch({ migration: (e.target.value || null) as LumbarLevelDetail["migration"] })}
        >
          <option value="">—</option>
          {MIGRATION_OPTIONS.map((o) => (
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
          data-testid="detail-migration-mm"
          onChange={(e) => patch({ migrationMm: num(e.target.value) ?? null })}
        />
      </div>

      {recessSides.map((row) => (
        <div key={row.label} className="flex flex-wrap items-center gap-1" data-testid={`detail-recess-${row.label.toLowerCase()}`}>
          <span className="text-[8px] font-bold uppercase text-slate-600 w-24">{row.label} lateral recess</span>
          <select
            className={FIELD}
            value={recessSeverity(row.get())}
            disabled={disabled}
            data-testid={`detail-recess-${row.label.toLowerCase()}-severity`}
            onChange={(e) => row.set({ ...row.get(), severity: (e.target.value || null) as Exclude<Severity, "none"> | null })}
          >
            <option value="">—</option>
            {RECESS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select
            className={FIELD}
            value={row.get()?.rootEffect ?? ""}
            disabled={disabled}
            data-testid={`detail-recess-${row.label.toLowerCase()}-effect`}
            onChange={(e) => row.set({ ...row.get(), rootEffect: (e.target.value || null) as RecessSideDetail["rootEffect"] })}
          >
            <option value="">root effect —</option>
            {ROOT_EFFECT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}

      {foramSides.map((row) => (
        <div key={row.label} className="flex flex-wrap items-center gap-1" data-testid={`detail-foram-${row.label.toLowerCase()}`}>
          <span className="text-[8px] font-bold uppercase text-slate-600 w-24">{row.label} foramen</span>
          <select
            className={FIELD}
            value={row.get()?.severity ?? ""}
            disabled={disabled}
            data-testid={`detail-foram-${row.label.toLowerCase()}-severity`}
            onChange={(e) => row.set({ ...row.get(), severity: (e.target.value || null) as Exclude<Severity, "none"> | null })}
          >
            <option value="">—</option>
            {RECESS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label.replace("narrowing", "stenosis")}</option>
            ))}
          </select>
          <select
            className={FIELD}
            value={row.get()?.fat ?? ""}
            disabled={disabled}
            data-testid={`detail-foram-${row.label.toLowerCase()}-fat`}
            onChange={(e) => row.set({ ...row.get(), fat: (e.target.value || null) as ForaminalSideDetail["fat"] })}
          >
            <option value="">perineural fat —</option>
            {PERINEURAL_FAT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <select
            className={FIELD}
            value={row.get()?.rootEffect ?? ""}
            disabled={disabled}
            data-testid={`detail-foram-${row.label.toLowerCase()}-effect`}
            onChange={(e) => row.set({ ...row.get(), rootEffect: (e.target.value || null) as ForaminalSideDetail["rootEffect"] })}
          >
            <option value="">root effect —</option>
            {ROOT_EFFECT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}

      <FacetFlavumRows detail={detail} patch={patch} disabled={disabled} sequences={ctx.sequences} />

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-slate-600 w-24">Spondylolisthesis</span>
        <select
          className={FIELD}
          value={detail.listhesis?.direction ?? ""}
          disabled={disabled}
          data-testid="detail-listhesis-direction"
          onChange={(e) => patch({ listhesis: { ...detail.listhesis, direction: (e.target.value || null) as ListhesisDetail["direction"] } })}
        >
          <option value="">—</option>
          <option value="antero">anterolisthesis</option>
          <option value="retro">retrolisthesis</option>
        </select>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.5"
          min="0"
          placeholder="mm"
          value={detail.listhesis?.displacementMm ?? ""}
          disabled={disabled}
          data-testid="detail-listhesis-mm"
          onChange={(e) => patch({ listhesis: { ...detail.listhesis, displacementMm: num(e.target.value) ?? null } })}
        />
        <select
          className={FIELD}
          value={detail.listhesis?.cause ?? ""}
          disabled={disabled}
          data-testid="detail-listhesis-cause"
          onChange={(e) => patch({ listhesis: { ...detail.listhesis, cause: (e.target.value || null) as ListhesisDetail["cause"] } })}
        >
          <option value="">cause —</option>
          <option value="degenerative">degenerative</option>
          <option value="isthmic">isthmic</option>
          <option value="other">other</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-slate-600 w-24">Pars</span>
        <select
          className={FIELD}
          value={detail.pars?.side ?? ""}
          disabled={disabled}
          data-testid="detail-pars-side"
          onChange={(e) => patch({ pars: { ...detail.pars, side: (e.target.value || null) as ParsDetail["side"] } })}
        >
          <option value="">—</option>
          <option value="right">right</option>
          <option value="left">left</option>
          <option value="bilateral">bilateral</option>
        </select>
        <label className="flex items-center gap-1 text-[8px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(detail.pars?.chronic)}
            disabled={disabled}
            data-testid="detail-pars-chronic"
            onChange={(e) => patch({ pars: { ...detail.pars, chronic: e.target.checked } })}
          />
          chronic
        </label>
        <label className="flex items-center gap-1 text-[8px] text-slate-600" title={ctx.sequences.stir ? "" : "STIR not performed — marrow oedema will be dropped"}>
          <input
            type="checkbox"
            checked={Boolean(detail.pars?.marrowEdema)}
            disabled={disabled || !ctx.sequences.stir}
            data-testid="detail-pars-edema"
            onChange={(e) => patch({ pars: { ...detail.pars, marrowEdema: e.target.checked } })}
          />
          marrow oedema (needs STIR)
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-slate-600 w-24">Epidural space</span>
        <select
          className={FIELD}
          value={detail.epidural?.finding ?? ""}
          disabled={disabled}
          data-testid="detail-epidural-finding"
          onChange={(e) => patch({ epidural: { ...detail.epidural, finding: (e.target.value || null) as EpiduralDetail["finding"] } })}
        >
          <option value="">—</option>
          {EPIDURAL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <input
          className={`${FIELD} w-24`}
          placeholder="level extent"
          value={detail.epidural?.levelExtent ?? ""}
          disabled={disabled}
          data-testid="detail-epidural-extent"
          onChange={(e) => patch({ epidural: { ...detail.epidural, levelExtent: e.target.value } })}
        />
      </div>

      <button
        type="button"
        disabled={disabled || !lumbarLevelDetailHasContent(detail)}
        onClick={apply}
        data-testid="lumbar-detail-apply"
        className="h-6 rounded bg-sky-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40"
      >
        Apply level detail → ledger
      </button>
    </div>
  );
}

function FacetFlavumRows({
  detail,
  patch,
  disabled,
  sequences,
}: {
  detail: LumbarLevelDetail;
  patch: (next: Partial<LumbarLevelDetail>) => void;
  disabled?: boolean;
  sequences: LumbarTileContext["sequences"];
}) {
  const facetFlags = (
    [
      ["arthropathy", "facet arthropathy"],
      ["hypertrophy", "facet hypertrophy"],
      ["effusion", "facet effusion"],
      ["synovialCyst", "synovial cyst"],
    ] as const
  ).map(([key, label]) => (
    <label key={key} className="flex items-center gap-1 text-[8px] text-slate-600">
      <input
        type="checkbox"
        checked={Boolean(detail.facet?.[key])}
        disabled={disabled}
        data-testid={`detail-facet-${key}`}
        onChange={(e) => patch({ facet: { ...detail.facet, [key]: e.target.checked } as FacetDetail })}
      />
      {label}
    </label>
  ));
  return (
    <div className="space-y-1" data-testid="detail-facet-flavum">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-slate-600 w-24">Facets</span>
        {facetFlags}
        <select
          className={FIELD}
          value={detail.facet?.laterality ?? ""}
          disabled={disabled}
          data-testid="detail-facet-side"
          onChange={(e) => patch({ facet: { ...detail.facet, laterality: (e.target.value || undefined) as FacetDetail["laterality"] } })}
        >
          <option value="">side…</option>
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="bilateral">bilateral</option>
        </select>
        <input
          className={`${FIELD} w-14`}
          type="number"
          step="0.1"
          min="0"
          placeholder="cyst mm"
          value={detail.facet?.cystMm ?? ""}
          disabled={disabled}
          data-testid="detail-facet-cyst-mm"
          onChange={(e) => patch({ facet: { ...detail.facet, cystMm: num(e.target.value) ?? null } })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-slate-600 w-24">Ligamentum flavum</span>
        {([["hypertrophy", "hypertrophy"], ["buckling", "buckling"]] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1 text-[8px] text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(detail.ligamentumFlavum?.[key])}
              disabled={disabled}
              data-testid={`detail-flavum-${key}`}
              onChange={(e) => patch({ ligamentumFlavum: { ...detail.ligamentumFlavum, [key]: e.target.checked } as LigamentumFlavumDetail })}
            />
            {label}
          </label>
        ))}
        <input
          className={`${FIELD} w-16`}
          type="number"
          step="0.1"
          min="0"
          placeholder="thick mm"
          value={detail.ligamentumFlavum?.thicknessMm ?? ""}
          disabled={disabled}
          data-testid="detail-flavum-mm"
          onChange={(e) => patch({ ligamentumFlavum: { ...detail.ligamentumFlavum, thicknessMm: num(e.target.value) ?? null } })}
        />
      </div>
      <p className="text-[8px] text-slate-500">
        Sentences come from the canonical library where it supplies one, and are labelled as structured choices where
        it does not. {sequences.axial ? "" : "Axial sequences are not documented, so recess/foraminal detail is limited."}
      </p>
    </div>
  );
}

// ─── Shared lesion form (spec §39) ─────────────────────────────────────────

const LESION_COMPARTMENTS: LumbarLesionCompartment[] = [
  "epidural",
  "intradural",
  "vertebral",
  "paraspinal",
  "psoas",
  "facet",
  "postop_collection",
];

function LumbarLesionForm({
  ctx,
  ledgerRegion,
  onClose,
  disabled,
}: {
  ctx: LumbarTileContext;
  ledgerRegion: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [compartment, setCompartment] = useState<LumbarLesionCompartment>("epidural");
  const [laterality, setLaterality] = useState<LsSide | "">("");
  const [label, setLabel] = useState("");
  const [apMm, setApMm] = useState("");
  const [transverseMm, setTransverseMm] = useState("");
  const [craniocaudalMm, setCraniocaudalMm] = useState("");
  const [enhancement, setEnhancement] = useState<NonNullable<LumbarLesionInput["enhancement"]> | "">("");
  const [canalEffect, setCanalEffect] = useState(false);
  const [neuralEffect, setNeuralEffect] = useState(false);

  const submit = () => {
    const built = buildLumbarLesionBundle(
      {
        compartment,
        level: ctx.level,
        laterality: laterality || undefined,
        label: label.trim() || undefined,
        apMm: num(apMm),
        transverseMm: num(transverseMm),
        craniocaudalMm: num(craniocaudalMm),
        enhancement: ctx.sequences.contrast && enhancement ? enhancement : undefined,
        canalEffect,
        neuralEffect,
      },
      ctx,
    );
    if (built.observations.length === 0) return;
    useWorkspace.getState().applyMacroBundle(built);
    onClose();
  };

  return (
    <div className="rounded border border-violet-200 bg-violet-50/50 p-1.5 space-y-1.5" data-testid="lumbar-lesion-form">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase text-violet-900">Shared lesion form — {ctx.level}</span>
        <button type="button" onClick={onClose} className="text-[9px] text-slate-500 underline" data-testid="lumbar-lesion-close">close</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select className={FIELD} value={compartment} disabled={disabled} data-testid="lesion-compartment" onChange={(e) => setCompartment(e.target.value as LumbarLesionCompartment)}>
          {LESION_COMPARTMENTS.map((c) => (
            <option key={c} value={c}>{c.replace("_", " ")}</option>
          ))}
        </select>
        <select className={FIELD} value={laterality} disabled={disabled} data-testid="lesion-laterality" onChange={(e) => setLaterality(e.target.value as LsSide | "")}>
          <option value="">side…</option>
          <option value="left">left</option>
          <option value="right">right</option>
          <option value="bilateral">bilateral</option>
        </select>
        <input className={`${FIELD} w-32`} placeholder="descriptor (optional)" value={label} disabled={disabled} data-testid="lesion-label" onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] font-bold uppercase text-violet-800">AP × TR × CC (mm)</span>
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" value={apMm} disabled={disabled} data-testid="lesion-ap-mm" onChange={(e) => setApMm(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" value={transverseMm} disabled={disabled} data-testid="lesion-tr-mm" onChange={(e) => setTransverseMm(e.target.value)} />
        <input className={`${FIELD} w-14`} type="number" step="0.1" min="0" value={craniocaudalMm} disabled={disabled} data-testid="lesion-cc-mm" onChange={(e) => setCraniocaudalMm(e.target.value)} />
      </div>
      {ctx.sequences.contrast ? (
        <select className={FIELD} value={enhancement} disabled={disabled} data-testid="lesion-enhancement" onChange={(e) => setEnhancement(e.target.value as NonNullable<LumbarLesionInput["enhancement"]> | "")}>
          <option value="">enhancement…</option>
          <option value="none">none</option>
          <option value="rim">rim</option>
          <option value="diffuse">diffuse</option>
          <option value="intense">intense</option>
        </select>
      ) : (
        <p className="text-[8px] text-slate-500" data-testid="lesion-enhancement-gated">
          Enhancement is hidden — contrast is not documented for this examination.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-[9px]">
          <input type="checkbox" checked={canalEffect} disabled={disabled} data-testid="lesion-canal-effect" onChange={(e) => setCanalEffect(e.target.checked)} /> canal effect
        </label>
        <label className="flex items-center gap-1 text-[9px]">
          <input type="checkbox" checked={neuralEffect} disabled={disabled} data-testid="lesion-neural-effect" onChange={(e) => setNeuralEffect(e.target.checked)} /> neural effect
        </label>
      </div>
      <button type="button" disabled={disabled} onClick={submit} data-testid="lumbar-lesion-apply" className="h-6 rounded bg-violet-600 px-2 text-[9px] font-semibold text-white disabled:opacity-40">
        Add lesion → ledger
      </button>
    </div>
  );
}
