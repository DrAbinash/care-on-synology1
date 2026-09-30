"use client";
/**
 * XrayCervicalCanvas — the X-ray Cervical Spine clinical sub-master surface.
 *
 * Mounted from ReportingToolsRail behind isXrayCervicalReportingContext, exactly
 * like XrayChestCanvas and MriBrainCanvas. It owns no state model of its own:
 * every click compiles atoms and goes through the existing store actions
 * (applyMacroBundle / removeMacroBundle / setField / seedSystemNormalImpression),
 * so ledger identity, provenance, baseline supersession, manual protection, undo
 * and impression refresh behave identically to the rest of CARE. There is no
 * parallel X-ray engine (spec §1).
 *
 * The View / Adequacy strip writes canonical sentences into the Technique field
 * — the field the report already prints and persists — and reads them back. The
 * three mandatory gates are visible here: odontoid statements need a recorded,
 * adequately visualized odontoid view; foraminal statements need the oblique for
 * the side being reported; dynamic statements need flexion AND extension. A gated
 * control is disabled and its tooltip names the missing view, so an unsupported
 * conclusion cannot be produced by clicking.
 */
import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  missingCervicalViewLabels,
  parseXrayCervicalViews,
  setCervicalAdequacyInTechnique,
  setCervicalInferiorLevelInTechnique,
  toggleCervicalViewInTechnique,
  XRAY_CERVICAL_ADEQUACY_LABELS,
  XRAY_CERVICAL_VIEW_LABELS,
  odontoidNotAssessedSentence,
  type VisualizedInferiorLevel,
  type XrayAdequacyGrade,
  type XrayCervicalAdequacyKey,
  type XrayCervicalTechniqueContext,
  type XrayCervicalViewKey,
} from "@/lib/xrayCervicalViews";
import {
  CERVICAL_LEVEL_OPTIONS,
  CERVICAL_VERTEBRA_OPTIONS,
} from "@/lib/xrayCervicalLevels";
import {
  CERVICAL_SUBMASTER_IDS,
  XRAY_CERVICAL_PRESETS,
  XRAY_CERVICAL_SUB_MASTERS,
  buildCervicalTilePatch,
  cervicalPresetAvailability,
  cervicalPresetById,
  cervicalPresetIsCritical,
  cervicalSubMasterById,
  cervicalTileAvailability,
  type CervicalSubMasterId,
  type CervicalTile,
} from "@/lib/xrayCervicalSubMasters";
import { cervicalBundleId, type CervicalTemplateContext } from "@/lib/xrayCervicalAtoms";
import {
  buildCervicalMeasureAtoms,
  CERVICAL_MEASUREMENT_LABELS,
  type CervicalMeasurement,
  type CervicalMeasurementKind,
  type CervicalMeasurementSource,
} from "@/lib/xrayCervicalMeasures";
import {
  buildCervicalDynamicAtoms,
  type CervicalDynamicEntry,
  type CervicalDynamicInterpretation,
} from "@/lib/xrayCervicalDynamic";
import {
  buildCervicalHardwareAtoms,
  CERVICAL_HARDWARE_COMPONENT_LABELS,
  CERVICAL_HARDWARE_PROCEDURE_LABELS,
  type CervicalHardwareComponent,
  type CervicalHardwareContinuity,
  type CervicalHardwareInput,
  type CervicalHardwareLucency,
  type CervicalHardwarePosition,
  type CervicalHardwareProcedure,
} from "@/lib/xrayCervicalHardware";
import { cn } from "@/lib/utils";

const VIEW_TOGGLES: XrayCervicalViewKey[] = [
  "ap",
  "lateral",
  "odontoid",
  "obliqueRight",
  "obliqueLeft",
  "flexion",
  "extension",
  "swimmers",
  "other",
];

const ADEQUACY_TOGGLES: XrayCervicalAdequacyKey[] = [
  "c7t1Visualization",
  "odontoidVisualization",
  "lateralMassVisualization",
  "rotation",
  "motion",
];

const INFERIOR_LEVELS: VisualizedInferiorLevel[] = ["unknown", "C5", "C6", "C7", "T1", "T2"];

const ADEQUACY_CYCLE: XrayAdequacyGrade[] = ["unknown", "adequate", "limited"];

const nextGrade = (grade: XrayAdequacyGrade): XrayAdequacyGrade =>
  ADEQUACY_CYCLE[(ADEQUACY_CYCLE.indexOf(grade) + 1) % ADEQUACY_CYCLE.length];

const MEASUREMENT_KINDS = Object.keys(CERVICAL_MEASUREMENT_LABELS) as CervicalMeasurementKind[];

const MEASUREMENT_SOURCES: CervicalMeasurementSource[] = ["viewer-caliper", "manual-entry", "derived"];

const COMPONENTS = Object.keys(CERVICAL_HARDWARE_COMPONENT_LABELS) as CervicalHardwareComponent[];

const PROCEDURES = Object.keys(CERVICAL_HARDWARE_PROCEDURE_LABELS) as CervicalHardwareProcedure[];

/** Paediatric reference guard — used to withhold an adult reference, never to
 *  label a study paediatric. */
const PAEDIATRIC_MAX_AGE_YEARS = 16;

function ageInYears(age: string | number | null | undefined): number | null {
  if (age === null || age === undefined) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(String(age).trim());
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

const numOrNull = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const fieldClass =
  "rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent";

export function XrayCervicalCanvas({
  disabled,
  region = "Cervical Spine",
  patientAge,
}: {
  disabled?: boolean;
  region?: string;
  patientAge?: string | number | null;
}) {
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);

  const ctx = useMemo(() => parseXrayCervicalViews(techniqueText), [techniqueText]);
  const ageYears = useMemo(() => ageInYears(patientAge), [patientAge]);

  const [activePalettes, setActivePalettes] = useState<CervicalSubMasterId[]>(["routine"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [level, setLevel] = useState<string>("C5-C6");
  const [side, setSide] = useState<"right" | "left" | "bilateral" | "">("");
  const [panel, setPanel] = useState<"none" | "measures" | "dynamic" | "hardware">("none");

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const bundle = p.observation?.bundleId;
      if (bundle && !p.stale) out.add(bundle);
    });
    return out;
  }, [patches]);

  const template = useMemo<CervicalTemplateContext>(
    () => ({ level: level || null, laterality: side || null }),
    [level, side],
  );

  const setTechnique = (next: string) => {
    useWorkspace.getState().setField("technique", next, "structured-template");
  };

  const toggleView = (key: XrayCervicalViewKey) => {
    if (disabled) return;
    setTechnique(toggleCervicalViewInTechnique(techniqueText, key, !ctx.performed[key]));
  };

  const cycleAdequacy = (key: XrayCervicalAdequacyKey) => {
    if (disabled) return;
    setTechnique(setCervicalAdequacyInTechnique(techniqueText, key, nextGrade(ctx.adequacy[key])));
  };

  const onTile = (tile: CervicalTile) => {
    if (disabled) return;
    const bundleId = cervicalBundleId("tile", tile.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!cervicalTileAvailability(tile, ctx, template).ok) return;
    useWorkspace.getState().applyMacroBundle(buildCervicalTilePatch(tile, region, template));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = cervicalPresetById(presetId);
    if (!preset) return;
    const bundleId = cervicalBundleId("preset", preset.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!cervicalPresetAvailability(preset, ctx, template).ok) return;
    useWorkspace
      .getState()
      .applyMacroBundle(preset.build({ region, ctx, laterality: side || null, level: level || null }));
    if (preset.id === "normal-cervical" || preset.id === "normal-cervical-full-series") {
      useWorkspace.getState().seedSystemNormalImpression();
    }
  };

  const togglePalette = (id: CervicalSubMasterId) => {
    setActivePalettes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const odontoid = useMemo(() => ctx.performed.odontoid, [ctx]);
  const missingDynamic = missingCervicalViewLabels(ctx, ["flexion", "extension"]);

  return (
    <div
      data-testid="xray-cervical-canvas"
      className="rounded-lg border border-indigo-200/70 bg-indigo-50/40 p-2 text-[9px] dark:border-indigo-900/60 dark:bg-indigo-950/20"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200">
          X-ray Cervical spine sub-master
        </span>
        <span className="text-[8px] text-muted-foreground">
          Palettes filter this panel only — switching never erases recorded observations.
        </span>
      </div>

      {/* ── Performed views ─────────────────────────────────────────────── */}
      <div className="mb-1.5 rounded border border-indigo-200/70 bg-white/70 p-1.5 dark:border-indigo-900/50 dark:bg-indigo-950/30">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-indigo-800 dark:text-indigo-300">
          Performed views
        </div>
        <div className="flex flex-wrap gap-1">
          {VIEW_TOGGLES.map((key) => {
            const on = ctx.performed[key];
            return (
              <button
                key={key}
                type="button"
                disabled={disabled || key === "other"}
                onClick={() => toggleView(key)}
                data-testid={`cervical-view-${key}`}
                title={
                  key === "other"
                    ? "Record any other projection in the Technique field — it never asserts a named view."
                    : on
                      ? "Recorded as performed. Click to remove."
                      : "Not recorded — click to record as performed."
                }
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                  on
                    ? "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                    : "border-slate-300 bg-white text-slate-500 hover:border-indigo-500 dark:bg-transparent dark:text-slate-400",
                  key === "other" && "opacity-60",
                )}
              >
                {on ? "✓ " : ""}
                {XRAY_CERVICAL_VIEW_LABELS[key]}
              </button>
            );
          })}
        </div>

        <div className="mb-1 mt-2 text-[8px] font-bold uppercase tracking-wide text-indigo-800 dark:text-indigo-300">
          Adequacy (click to cycle: unrecorded → adequate → limited)
        </div>
        <div className="flex flex-wrap gap-1">
          {ADEQUACY_TOGGLES.map((key) => {
            const grade = ctx.adequacy[key];
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => cycleAdequacy(key)}
                data-testid={`cervical-adequacy-${key}`}
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                  grade === "adequate" &&
                    "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
                  grade === "limited" &&
                    "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
                  grade === "unknown" &&
                    "border-slate-300 bg-white text-slate-500 dark:bg-transparent dark:text-slate-400",
                )}
              >
                {XRAY_CERVICAL_ADEQUACY_LABELS[key]}
                {grade === "limited" ? " · limited" : grade === "adequate" ? " · adequate" : ""}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <label
            className="text-[8px] font-semibold text-indigo-800 dark:text-indigo-300"
            htmlFor="cervical-inferior-level"
          >
            Inferior visualization limit
          </label>
          <select
            id="cervical-inferior-level"
            data-testid="cervical-inferior-level"
            disabled={disabled}
            value={ctx.visualizedInferiorLevel}
            onChange={(e) =>
              setTechnique(
                setCervicalInferiorLevelInTechnique(techniqueText, e.target.value as VisualizedInferiorLevel),
              )
            }
            className={fieldClass}
          >
            {INFERIOR_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === "unknown" ? "not recorded" : l}
              </option>
            ))}
          </select>
          <span className="text-[7px] text-indigo-800 dark:text-indigo-300">
            C7-T1 statements and the normal baseline are only allowed when the film demonstrably reaches C7-T1.
          </span>
        </div>

        <div
          data-testid="cervical-odontoid-gate"
          className={cn(
            "mt-1.5 rounded px-1.5 py-1 text-[8px] font-medium",
            odontoid
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          {odontoidNotAssessedSentence(ctx)}
        </div>

        {missingDynamic.length ? (
          <div
            data-testid="cervical-dynamic-gate"
            className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[8px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            Dynamic assessment needs both positions — missing: {missingDynamic.join(", ")}. Neutral films cannot
            demonstrate instability.
          </div>
        ) : null}
      </div>

      {/* ── Level / side carried into the tiles that need them ─────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <label className="text-[8px] font-semibold text-indigo-800 dark:text-indigo-300" htmlFor="cervical-level">
          Level
        </label>
        <select
          id="cervical-level"
          data-testid="cervical-level"
          disabled={disabled}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className={fieldClass}
        >
          {CERVICAL_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {CERVICAL_VERTEBRA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="text-[8px] font-semibold text-indigo-800 dark:text-indigo-300" htmlFor="cervical-side">
          Side
        </label>
        <select
          id="cervical-side"
          data-testid="cervical-side"
          disabled={disabled}
          value={side}
          onChange={(e) => setSide(e.target.value as "right" | "left" | "bilateral" | "")}
          className={fieldClass}
        >
          <option value="">not chosen</option>
          <option value="right">right</option>
          <option value="left">left</option>
          <option value="bilateral">bilateral</option>
        </select>
        <span className="text-[7px] text-amber-700 dark:text-amber-300">
          An unchosen side stays a [side] token in the text — never an invented laterality.
        </span>
      </div>

      {/* ── Palette bar ─────────────────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap gap-1">
        {CERVICAL_SUBMASTER_IDS.map((id) => {
          const sm = cervicalSubMasterById(id);
          if (!sm) return null;
          const on = activePalettes.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => togglePalette(id)}
              data-testid={`cervical-palette-${id}`}
              title={sm.hint}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                on
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-indigo-500 dark:bg-transparent dark:text-slate-300",
              )}
            >
              {sm.label}
            </button>
          );
        })}
      </div>

      {/* ── Active palettes ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {activePalettes.map((id) => {
          const sm = cervicalSubMasterById(id);
          if (!sm) return null;
          const presets = XRAY_CERVICAL_PRESETS.filter((p) => p.subMasterId === id);
          const visibleTiles = sm.tiles.filter((t) => !t.advanced || showAdvanced);
          const groups = Array.from(
            visibleTiles.reduce((acc, t) => {
              const list = acc.get(t.group) ?? [];
              list.push(t);
              acc.set(t.group, list);
              return acc;
            }, new Map<string, CervicalTile[]>()),
          );

          return (
            <div
              key={id}
              data-testid={`cervical-palette-panel-${id}`}
              className="rounded border border-indigo-200/70 bg-white/70 p-1.5 dark:border-indigo-900/50 dark:bg-indigo-950/30"
            >
              <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200">
                {sm.label}
              </div>

              {presets.length ? (
                <div className="mb-1 flex flex-wrap gap-1">
                  {presets.map((p) => {
                    const bundleId = cervicalBundleId("preset", p.id);
                    const on = activeBundles.has(bundleId);
                    const gate = cervicalPresetAvailability(p, ctx, template);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={disabled || (!on && !gate.ok)}
                        onClick={() => onPreset(p.id)}
                        data-testid={`cervical-preset-${p.id}`}
                        title={
                          !gate.ok
                            ? `Needs: ${gate.missing.join(", ")}`
                            : gate.reason ?? p.label
                        }
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                          on
                            ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                            : "border-slate-300 bg-white text-slate-700 hover:border-amber-500 dark:bg-transparent dark:text-slate-200",
                          !gate.ok && !on && "cursor-not-allowed opacity-50",
                          cervicalPresetIsCritical(p) && gate.ok && "border-rose-400",
                        )}
                      >
                        ★ {p.label}
                        {cervicalPresetIsCritical(p) ? " (critical)" : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {groups.map(([group, tiles]) => (
                <div key={group} className="mb-1">
                  <div className="text-[7px] font-bold uppercase tracking-wide text-slate-500">{group}</div>
                  <div className="flex flex-wrap gap-1">
                    {tiles.map((tile) => {
                      const bundleId = cervicalBundleId("tile", tile.id);
                      const on = activeBundles.has(bundleId);
                      const gate = cervicalTileAvailability(tile, ctx, template);
                      return (
                        <button
                          key={tile.id}
                          type="button"
                          disabled={disabled || (!on && !gate.ok)}
                          onClick={() => onTile(tile)}
                          data-testid={`cervical-tile-${tile.id}`}
                          title={
                            !gate.ok
                              ? `Needs: ${gate.missing.join(", ")}`
                              : tile.criticalPattern
                                ? "Critical-pattern finding — record communication through the existing CARE critical-result workflow."
                                : (tile.atoms[0]?.findings ?? tile.label).slice(0, 140)
                          }
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[8px] font-medium transition-colors",
                            on
                              ? "border-indigo-600 bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100"
                              : "border-slate-300 bg-white text-slate-700 hover:border-indigo-500 dark:bg-transparent dark:text-slate-200",
                            !gate.ok && !on && "cursor-not-allowed opacity-50",
                            tile.criticalPattern && "border-rose-400",
                          )}
                        >
                          {on ? "✓ " : ""}
                          {tile.label}
                          {tile.criticalPattern ? " ⚠" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[8px] font-semibold text-slate-600 hover:border-indigo-500 dark:bg-transparent dark:text-slate-300"
        >
          {showAdvanced ? "Hide" : "Show"} advanced / rare tiles
        </button>
        {(
          [
            ["measures", "Measurements"],
            ["dynamic", "Flexion / extension"],
            ["hardware", "Hardware"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => setPanel(panel === key ? "none" : key)}
            data-testid={`cervical-panel-${key}`}
            className={cn(
              "rounded border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
              panel === key
                ? "border-violet-600 bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100"
                : "border-slate-300 bg-white text-slate-600 hover:border-violet-500 dark:bg-transparent dark:text-slate-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "measures" ? (
        <CervicalMeasurePanel disabled={disabled} region={region} ctx={ctx} ageYears={ageYears} defaultLevel={level} />
      ) : null}
      {panel === "dynamic" ? (
        <CervicalDynamicPanel disabled={disabled} region={region} ctx={ctx} defaultLevel={level} />
      ) : null}
      {panel === "hardware" ? (
        <CervicalHardwarePanel disabled={disabled} region={region} ctx={ctx} />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── measurements ─────────────────────────────── */

function CervicalMeasurePanel({
  disabled,
  region,
  ctx,
  ageYears,
  defaultLevel,
}: {
  disabled?: boolean;
  region: string;
  ctx: XrayCervicalTechniqueContext;
  ageYears: number | null;
  defaultLevel: string;
}) {
  const [kind, setKind] = useState<CervicalMeasurementKind>("prevertebral_soft_tissue");
  const [levelValue, setLevelValue] = useState<string>(defaultLevel);
  const [upper, setUpper] = useState("C2");
  const [lower, setLower] = useState("C7");
  const [view, setView] = useState<XrayCervicalViewKey>("lateral");
  const [mm, setMm] = useState("");
  const [deg, setDeg] = useState("");
  const [pct, setPct] = useState("");
  const [source, setSource] = useState<CervicalMeasurementSource>("viewer-caliper");
  const [messages, setMessages] = useState<string[]>([]);

  const apply = () => {
    if (disabled) return;
    const measurement: CervicalMeasurement = {
      kind,
      mm: numOrNull(mm),
      degrees: numOrNull(deg),
      slipPercent: numOrNull(pct),
      level: levelValue || null,
      upperLevel: upper,
      lowerLevel: lower,
      view,
      source,
    };
    const result = buildCervicalMeasureAtoms({ region, measurements: [measurement], ageYears }, ctx);
    if (result.observations.length) {
      useWorkspace.getState().applyMacroBundle({
        bundleId: result.bundleId,
        observations: result.observations,
      });
    }
    setMessages(result.rejected.flatMap((r) => r.reasons));
  };

  return (
    <div
      data-testid="cervical-measure-panel"
      className="mt-1.5 rounded border border-rose-300/70 bg-rose-50/60 p-1.5 dark:border-rose-900/60 dark:bg-rose-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-rose-900 dark:text-rose-200">
        Measurements — every value carries level, view and provenance
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          data-testid="cervical-measure-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as CervicalMeasurementKind)}
          className={fieldClass}
        >
          {MEASUREMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CERVICAL_MEASUREMENT_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          data-testid="cervical-measure-level"
          value={levelValue}
          onChange={(e) => setLevelValue(e.target.value)}
          className={fieldClass}
        >
          {CERVICAL_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {CERVICAL_VERTEBRA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          data-testid="cervical-measure-view"
          value={view}
          onChange={(e) => setView(e.target.value as XrayCervicalViewKey)}
          className={fieldClass}
        >
          {VIEW_TOGGLES.filter((v) => v !== "other").map((v) => (
            <option key={v} value={v}>
              {XRAY_CERVICAL_VIEW_LABELS[v]}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as CervicalMeasurementSource)}
          className={fieldClass}
        >
          {MEASUREMENT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {kind === "cobb_angle" ? (
          <>
            <select value={upper} onChange={(e) => setUpper(e.target.value)} className={fieldClass}>
              {CERVICAL_VERTEBRA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  upper {o.label}
                </option>
              ))}
            </select>
            <select value={lower} onChange={(e) => setLower(e.target.value)} className={fieldClass}>
              {CERVICAL_VERTEBRA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  lower {o.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <input
          data-testid="cervical-measure-mm"
          value={mm}
          onChange={(e) => setMm(e.target.value)}
          placeholder="mm — only if measured"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          data-testid="cervical-measure-deg"
          value={deg}
          onChange={(e) => setDeg(e.target.value)}
          placeholder="degrees — only if measured"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          data-testid="cervical-measure-pct"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          placeholder="slip % of body width"
          inputMode="decimal"
          className={fieldClass}
        />
      </div>
      {messages.length ? (
        <ul data-testid="cervical-measure-rejected" className="mt-1 list-disc pl-4 text-[7px] text-rose-800 dark:text-rose-300">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-[7px] text-rose-800 dark:text-rose-300">
          A measurement that the recorded views cannot support is refused here rather than written.
        </div>
      )}
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          data-testid="cervical-measure-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-rose-600 bg-rose-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record measurement
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── dynamic ──────────────────────────────────── */

function CervicalDynamicPanel({
  disabled,
  region,
  ctx,
  defaultLevel,
}: {
  disabled?: boolean;
  region: string;
  ctx: XrayCervicalTechniqueContext;
  defaultLevel: string;
}) {
  const [levelValue, setLevelValue] = useState<string>(defaultLevel.includes("-") ? defaultLevel : "C5-C6");
  const [flexMm, setFlexMm] = useState("");
  const [extMm, setExtMm] = useState("");
  const [flexDeg, setFlexDeg] = useState("");
  const [extDeg, setExtDeg] = useState("");
  const [rom, setRom] = useState("");
  const [interpretation, setInterpretation] = useState<CervicalDynamicInterpretation>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const apply = () => {
    if (disabled) return;
    const entry: CervicalDynamicEntry = {
      level: levelValue,
      flexionTranslationMm: numOrNull(flexMm),
      extensionTranslationMm: numOrNull(extMm),
      flexionAngulationDeg: numOrNull(flexDeg),
      extensionAngulationDeg: numOrNull(extDeg),
      rangeLimitation: rom.trim() || null,
      interpretation,
    };
    const result = buildCervicalDynamicAtoms({ region, ctx, entries: [entry] });
    if (result.observations.length) {
      useWorkspace.getState().applyMacroBundle({ bundleId: result.bundleId, observations: result.observations });
    }
    setMessages([
      ...(result.blockedReason ? [result.blockedReason] : []),
      ...result.rejected.flatMap((r) => r.reasons),
    ]);
  };

  return (
    <div
      data-testid="cervical-dynamic-panel"
      className="mt-1.5 rounded border border-sky-300/70 bg-sky-50/60 p-1.5 dark:border-sky-900/60 dark:bg-sky-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-sky-900 dark:text-sky-200">
        Flexion / extension — instability is your interpretation, never a threshold
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          data-testid="cervical-dynamic-level"
          value={levelValue}
          onChange={(e) => setLevelValue(e.target.value)}
          className={fieldClass}
        >
          {CERVICAL_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          data-testid="cervical-dynamic-interpretation"
          value={interpretation ?? ""}
          onChange={(e) =>
            setInterpretation((e.target.value || null) as CervicalDynamicInterpretation)
          }
          className={fieldClass}
        >
          <option value="">no interpretation given</option>
          <option value="instability">instability (selected by me)</option>
          <option value="stable">no instability</option>
        </select>
        <input
          data-testid="cervical-dynamic-flex"
          value={flexMm}
          onChange={(e) => setFlexMm(e.target.value)}
          placeholder="flexion translation mm"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          data-testid="cervical-dynamic-ext"
          value={extMm}
          onChange={(e) => setExtMm(e.target.value)}
          placeholder="extension translation mm"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          value={flexDeg}
          onChange={(e) => setFlexDeg(e.target.value)}
          placeholder="flexion angulation deg"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          value={extDeg}
          onChange={(e) => setExtDeg(e.target.value)}
          placeholder="extension angulation deg"
          inputMode="decimal"
          className={fieldClass}
        />
        <input
          value={rom}
          onChange={(e) => setRom(e.target.value)}
          placeholder="range-of-motion limitation (words)"
          className="col-span-2 rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
      </div>
      {messages.length ? (
        <ul data-testid="cervical-dynamic-messages" className="mt-1 list-disc pl-4 text-[7px] text-sky-800 dark:text-sky-300">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[7px] text-sky-800 dark:text-sky-300">
          The inter-position change is derived from the two values you enter; nothing is inferred from a neutral film.
        </span>
        <button
          type="button"
          data-testid="cervical-dynamic-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-sky-600 bg-sky-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record dynamic finding
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── hardware ─────────────────────────────────── */

function CervicalHardwarePanel({
  disabled,
  region,
  ctx,
}: {
  disabled?: boolean;
  region: string;
  ctx: XrayCervicalTechniqueContext;
}) {
  const [procedure, setProcedure] = useState<CervicalHardwareProcedure>("acdf");
  const [levels, setLevels] = useState("C5-C6");
  const [components, setComponents] = useState<CervicalHardwareComponent[]>(["plate", "screws"]);
  const [continuity, setContinuity] = useState<CervicalHardwareContinuity>("intact");
  const [position, setPosition] = useState<CervicalHardwarePosition>("unchanged");
  const [lucency, setLucency] = useState<CervicalHardwareLucency>("absent");
  const [fusion, setFusion] = useState<CervicalHardwareInput["fusion"]>("not_assessed");
  const [alignmentNote, setAlignmentNote] = useState("");
  const [asd, setAsd] = useState(false);
  const [asdLevels, setAsdLevels] = useState("C4-C5");
  const [warnings, setWarnings] = useState<string[]>([]);

  const toggleComponent = (c: CervicalHardwareComponent) =>
    setComponents((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const apply = () => {
    if (disabled) return;
    const result = buildCervicalHardwareAtoms(
      {
        procedure,
        levels: levels.split(/[,;]/g).map((s) => s.trim()).filter(Boolean),
        components,
        continuity,
        position,
        lucency,
        fusion,
        alignmentNote: alignmentNote.trim() || null,
        adjacentSegmentDegeneration: asd,
        adjacentSegmentLevels: asd ? asdLevels.split(/[,;]/g).map((s) => s.trim()).filter(Boolean) : [],
      },
      ctx,
      { region },
    );
    useWorkspace.getState().applyMacroBundle({ bundleId: result.bundleId, observations: result.observations });
    setWarnings(result.warnings);
  };

  return (
    <div
      data-testid="cervical-hardware-panel"
      className="mt-1.5 rounded border border-teal-300/70 bg-teal-50/60 p-1.5 dark:border-teal-900/60 dark:bg-teal-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-teal-900 dark:text-teal-200">
        Post-operative — equivocal lucency is never written as loosening
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          data-testid="cervical-hardware-procedure"
          value={procedure}
          onChange={(e) => setProcedure(e.target.value as CervicalHardwareProcedure)}
          className={fieldClass}
        >
          {PROCEDURES.map((p) => (
            <option key={p} value={p}>
              {CERVICAL_HARDWARE_PROCEDURE_LABELS[p]}
            </option>
          ))}
        </select>
        <input
          data-testid="cervical-hardware-levels"
          value={levels}
          onChange={(e) => setLevels(e.target.value)}
          placeholder="operated levels, comma separated"
          className={fieldClass}
        />
        <select
          value={continuity}
          onChange={(e) => setContinuity(e.target.value as CervicalHardwareContinuity)}
          className={fieldClass}
        >
          <option value="not_assessed">continuity not assessed</option>
          <option value="intact">continuous / intact</option>
          <option value="suspected">breakage suspected</option>
          <option value="fractured">breakage demonstrated</option>
        </select>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value as CervicalHardwarePosition)}
          className={fieldClass}
        >
          <option value="not_assessed">position not assessed</option>
          <option value="unchanged">position unchanged</option>
          <option value="suspected">migration suspected</option>
          <option value="migrated">migration demonstrated</option>
        </select>
        <select
          data-testid="cervical-hardware-lucency"
          value={lucency}
          onChange={(e) => setLucency(e.target.value as CervicalHardwareLucency)}
          className={fieldClass}
        >
          <option value="not_assessed">lucency not assessed</option>
          <option value="absent">no perihardware lucency</option>
          <option value="equivocal">equivocal lucency</option>
          <option value="convincing">convincing lucency</option>
        </select>
        <select
          value={fusion ?? "not_assessed"}
          onChange={(e) => setFusion(e.target.value as CervicalHardwareInput["fusion"])}
          className={fieldClass}
        >
          <option value="not_assessed">fusion not assessed</option>
          <option value="healed">fusion established</option>
          <option value="equivocal">fusion equivocal</option>
          <option value="not_fused">no bridging fusion</option>
        </select>
        <input
          value={alignmentNote}
          onChange={(e) => setAlignmentNote(e.target.value)}
          placeholder="alignment across the construct (words)"
          className="col-span-2 rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <div className="col-span-2 flex flex-wrap items-center gap-2 text-[8px]">
          {COMPONENTS.map((c) => (
            <label key={c} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={components.includes(c)}
                onChange={() => toggleComponent(c)}
              />
              {CERVICAL_HARDWARE_COMPONENT_LABELS[c]}
            </label>
          ))}
        </div>
        <label className="col-span-2 flex items-center gap-2 text-[8px]">
          <input data-testid="cervical-hardware-asd" type="checkbox" checked={asd} onChange={(e) => setAsd(e.target.checked)} />
          adjacent-segment degeneration
          {asd ? (
            <input
              value={asdLevels}
              onChange={(e) => setAsdLevels(e.target.value)}
              className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
            />
          ) : null}
        </label>
      </div>
      {warnings.length ? (
        <ul data-testid="cervical-hardware-warnings" className="mt-1 list-disc pl-4 text-[7px] text-teal-800 dark:text-teal-300">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          data-testid="cervical-hardware-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-teal-600 bg-teal-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record post-operative findings
        </button>
      </div>
    </div>
  );
}
