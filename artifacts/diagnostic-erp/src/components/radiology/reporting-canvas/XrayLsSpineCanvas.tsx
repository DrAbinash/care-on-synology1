"use client";
/**
 * XrayLsSpineCanvas — the X-ray Lumbosacral Spine clinical sub-master surface.
 *
 * Mounted from ReportingToolsRail behind isXrayLsSpineReportingContext, exactly
 * like XrayChestCanvas and XrayCervicalCanvas. It owns no state model of its own:
 * every click compiles atoms and goes through the existing store actions
 * (applyMacroBundle / removeMacroBundle / setField / seedSystemNormalImpression),
 * so ledger identity, provenance, baseline supersession, manual protection, undo
 * and impression refresh behave identically to the rest of CARE. There is no
 * parallel X-ray engine (spec §1).
 *
 * Two things distinguish lumbar radiography from the other X-ray surfaces, and
 * both are placed at the TOP of this panel because everything below depends on
 * them:
 *  - NUMBERING (spec §4): the level labels only exist once the radiologist has
 *    said how the spine was counted. The numbering record is persisted as a
 *    Findings sentence — no schema change — and read back with
 *    parseLsNumberingFromText, so a reopened study keeps the tiles it had open.
 *    Until then every level-bearing tile is disabled and says why.
 *  - VIEWS / COVERAGE (spec §2): pars, dynamic, L5-S1, T12-L1 and sacroiliac
 *    statements each need a projection that can support them. A gated control is
 *    disabled and its title names the missing view, so an unsupported conclusion
 *    cannot be produced by clicking.
 *
 * Measure / Dynamic / Hardware keep their source values, the view they came from
 * and the derivation they went through (spec §8, §9, §15, §16), and a measurement
 * the study cannot support is shown as a rejection with its reasons rather than
 * being dropped.
 */
import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  missingLsViewLabels,
  parseXrayLsViews,
  setLsAdequacyInTechnique,
  setLsCoverageInTechnique,
  toggleLsViewInTechnique,
  XRAY_LS_ADEQUACY_LABELS,
  XRAY_LS_VIEW_LABELS,
  type XrayAdequacyGrade,
  type XrayLsAdequacyKey,
  type XrayLsTechniqueContext,
  type XrayLsViewKey,
} from "@/lib/xrayLsViews";
import { LS_LEVEL_OPTIONS, LS_VERTEBRA_OPTIONS, normalizeLsLevel } from "@/lib/xrayLsLevels";
import {
  CASTELLVI_TYPES,
  LS_NUMBERING_BASIS_OPTIONS,
  UNSET_LS_NUMBERING,
  composeLsNumberingCaution,
  lsLevelSpecificNormalAllowed,
  lsNumberingAllowedLevels,
  lsNumberingConfidence,
  parseLsNumberingFromText,
  type CastellviType,
  type LsNumbering,
  type LsNumberingBasis,
} from "@/lib/xrayLsNumbering";
import {
  LS_SUBMASTER_IDS,
  XRAY_LS_PRESETS,
  XRAY_LS_SUB_MASTERS,
  buildLsTilePatch,
  lsPresetAvailability,
  lsPresetById,
  lsPresetIsCritical,
  lsTileAvailability,
  type LsSubMasterId,
  type LsTile,
} from "@/lib/xrayLsSubMasters";
import { lsBundleId, type LsTemplateContext } from "@/lib/xrayLsAtoms";
import { buildLsNumberingAtoms } from "@/lib/xrayLsNormalAtoms";
import {
  LS_MEASUREMENT_LABELS,
  buildLsMeasureAtoms,
  type LsMeasurement,
  type LsMeasurementKind,
  type LsMeasurementSource,
} from "@/lib/xrayLsMeasures";
import {
  LS_DYNAMIC_INTERPRETATION_OPTIONS,
  buildLsDynamicAtoms,
  type LsDynamicEntry,
} from "@/lib/xrayLsDynamic";
import {
  LS_HARDWARE_CONTINUITY_OPTIONS,
  LS_HARDWARE_LUCENCY_OPTIONS,
  LS_HARDWARE_POSITION_OPTIONS,
  LS_HARDWARE_PROCEDURE_LABELS,
  buildLsHardwareAtoms,
  type LsHardwareContinuity,
  type LsHardwareInput,
  type LsHardwareLucency,
  type LsHardwarePosition,
  type LsHardwareProcedure,
} from "@/lib/xrayLsHardware";
import { cn } from "@/lib/utils";

const VIEW_TOGGLES: XrayLsViewKey[] = [
  "ap",
  "lateral",
  "obliqueRight",
  "obliqueLeft",
  "flexion",
  "extension",
  "spotL5S1",
  "other",
];

const ADEQUACY_TOGGLES: XrayLsAdequacyKey[] = [
  "l5s1Visualization",
  "posteriorElementVisualization",
  "t12l1Included",
  "siJointVisualization",
  "rotation",
  "motion",
];

const COVERAGE_VALUES: Array<XrayLsTechniqueContext["inferiorCoverage"]> = ["unknown", "L5-S1", "S1"];

const ADEQUACY_CYCLE: XrayAdequacyGrade[] = ["unknown", "adequate", "limited"];

const nextGrade = (grade: XrayAdequacyGrade): XrayAdequacyGrade =>
  ADEQUACY_CYCLE[(ADEQUACY_CYCLE.indexOf(grade) + 1) % ADEQUACY_CYCLE.length];

const MEASUREMENT_KINDS = Object.keys(LS_MEASUREMENT_LABELS) as LsMeasurementKind[];
const MEASUREMENT_SOURCES: LsMeasurementSource[] = ["viewer-caliper", "manual-entry", "derived"];
const PROCEDURES = Object.keys(LS_HARDWARE_PROCEDURE_LABELS) as LsHardwareProcedure[];
const VIEW_OPTIONS: XrayLsViewKey[] = ["ap", "lateral", "obliqueRight", "obliqueLeft", "flexion", "extension", "spotL5S1"];

const numOrNull = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const fieldClass =
  "rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent";

const chip = (on: boolean, disabled?: boolean) =>
  cn(
    "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
    on
      ? "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
      : "border-slate-300 bg-white text-slate-500 hover:border-indigo-500 dark:bg-transparent dark:text-slate-400",
    disabled && "cursor-not-allowed opacity-50",
  );

const emptyMeasurement = (level: string): LsMeasurement => ({
  kind: "listhesis_translation",
  level,
  view: "lateral",
  source: "viewer-caliper",
  direction: "anterolisthesis",
});

const emptyEntry = (level: string): LsDynamicEntry => ({ level, interpretation: "none" });

const emptyHardware = (level: string): LsHardwareInput => ({
  procedures: [],
  components: [],
  levels: [level],
  continuity: "intact",
  position: "maintained",
  lucency: "absent",
});

export function XrayLsSpineCanvas({
  disabled,
  region = "LS Spine",
}: {
  disabled?: boolean;
  region?: string;
}) {
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const findingsText = useWorkspace((s) => s.findingsText);
  const impressionText = useWorkspace((s) => s.impressionText);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);

  const ctx = useMemo(() => parseXrayLsViews(techniqueText), [techniqueText]);
  // Numbering is report state, not component state: it is read back out of the
  // Findings/Impression prose so a reopened study behaves exactly as it did.
  const numbering = useMemo(
    () => parseLsNumberingFromText(`${findingsText}\n${impressionText}`),
    [findingsText, impressionText],
  );

  const [activePalettes, setActivePalettes] = useState<LsSubMasterId[]>(["routine"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [level, setLevel] = useState<string>("L4-L5");
  const [side, setSide] = useState<"right" | "left" | "bilateral" | "">("");
  const [panel, setPanel] = useState<"none" | "numbering" | "measures" | "dynamic" | "hardware">("none");

  const [measureRows, setMeasureRows] = useState<LsMeasurement[]>([]);
  const [measureDraft, setMeasureDraft] = useState<LsMeasurement>(() => emptyMeasurement("L5-S1"));
  const [measureRejections, setMeasureRejections] = useState<string[]>([]);

  const [dynamicRows, setDynamicRows] = useState<LsDynamicEntry[]>([]);
  const [dynamicDraft, setDynamicDraft] = useState<LsDynamicEntry>(() => emptyEntry("L4-L5"));
  const [dynamicRejections, setDynamicRejections] = useState<string[]>([]);

  const [hardware, setHardware] = useState<LsHardwareInput>(() => emptyHardware("L4-L5"));
  const [hardwareWarnings, setHardwareWarnings] = useState<string[]>([]);

  const [numberingDraft, setNumberingDraft] = useState<LsNumbering>(() => numbering);

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const bundle = p.observation?.bundleId;
      if (bundle && !p.stale) out.add(bundle);
    });
    return out;
  }, [patches]);

  const template = useMemo<LsTemplateContext>(
    () => ({ level: level || null, laterality: side || null }),
    [level, side],
  );

  const allowedLevels = useMemo(() => {
    const listed = lsNumberingAllowedLevels(numbering);
    return listed.length ? listed : [...LS_LEVEL_OPTIONS.map((o) => o.value)];
  }, [numbering]);

  const setTechnique = (next: string) => {
    useWorkspace.getState().setField("technique", next, "structured-template");
  };

  const toggleView = (key: XrayLsViewKey) => {
    if (disabled) return;
    setTechnique(toggleLsViewInTechnique(techniqueText, key, !ctx.performed[key]));
  };

  const cycleAdequacy = (key: XrayLsAdequacyKey) => {
    if (disabled) return;
    setTechnique(setLsAdequacyInTechnique(techniqueText, key, nextGrade(ctx.adequacy[key])));
  };

  const onTile = (tile: LsTile) => {
    if (disabled) return;
    const bundleId = lsBundleId("tile", tile.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!lsTileAvailability(tile, ctx, template, numbering).ok) return;
    useWorkspace.getState().applyMacroBundle(buildLsTilePatch(tile, region, template));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = lsPresetById(presetId);
    if (!preset) return;
    const bundleId = lsBundleId("preset", preset.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!lsPresetAvailability(preset, ctx, template, numbering).ok) return;
    useWorkspace
      .getState()
      .applyMacroBundle(
        preset.build({
          region,
          ctx,
          numbering,
          laterality: side || null,
          level: level || null,
        }),
      );
    if (preset.id === "ls-normal" || preset.id === "ls-normal-concise") {
      useWorkspace.getState().seedSystemNormalImpression();
    }
  };

  const applyNumbering = () => {
    if (disabled) return;
    // Replace any numbering statement already recorded, then write the new one.
    for (const basis of ["unset", ...LS_NUMBERING_BASIS_OPTIONS.map((o) => o.value)]) {
      const id = lsBundleId("numbering", basis);
      if (activeBundles.has(id)) useWorkspace.getState().removeMacroBundle(id);
    }
    const built = buildLsNumberingAtoms({ region, numbering: numberingDraft });
    const result = useWorkspace.getState().applyMacroBundle(built);
    if (result === "applied") useWorkspace.getState().refreshImpressionFromLedger();
  };

  const applyMeasurements = () => {
    if (disabled) return;
    const measurements = [...measureRows, measureDraft];
    const built = buildLsMeasureAtoms({ region, measurements }, ctx, numbering);
    setMeasureRejections(
      built.rejected.map((r) => `${LS_MEASUREMENT_LABELS[r.measurement.kind]}: ${r.reasons.join(" ")}`),
    );
    if (!built.observations.length) return;
    useWorkspace.getState().applyMacroBundle(built);
    setMeasureRows([]);
    setMeasureDraft(emptyMeasurement(level));
  };

  const applyDynamic = () => {
    if (disabled) return;
    const built = buildLsDynamicAtoms({
      region,
      ctx,
      numbering,
      entries: [...dynamicRows, dynamicDraft],
    });
    setDynamicRejections(
      built.rejected.map((r) => `${r.entry.level ?? "segment"}: ${r.reasons.join(" ")}`),
    );
    if (!built.observations.length) return;
    useWorkspace.getState().applyMacroBundle(built);
    setDynamicRows([]);
    setDynamicDraft(emptyEntry(level));
  };

  const applyHardware = () => {
    if (disabled) return;
    const built = buildLsHardwareAtoms(hardware, ctx, { region, numbering });
    setHardwareWarnings(built.warnings.map((w) => w.detail));
    if (!built.observations.length) return;
    useWorkspace.getState().applyMacroBundle(built);
  };

  const togglePalette = (id: LsSubMasterId) => {
    setActivePalettes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const missingDynamic = missingLsViewLabels(ctx, ["flexion", "extension"]);
  const parsGate = lsTileAvailability(
    { id: "gate", label: "", group: "", atoms: [], parsGate: "any", requiresNumbering: true },
    ctx,
    template,
    numbering,
  );
  const junctionGate = lsTileAvailability(
    { id: "gate", label: "", group: "", atoms: [], requiresJunction: true },
    ctx,
    template,
    numbering,
  );
  const numberingCaution = composeLsNumberingCaution(numbering);
  const normalAllowed = lsLevelSpecificNormalAllowed(numbering);

  return (
    <div
      data-testid="xray-ls-spine-canvas"
      className="rounded-lg border border-amber-200/70 bg-amber-50/40 p-2 text-[9px] dark:border-amber-900/60 dark:bg-amber-950/20"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
          X-ray LS spine sub-master
        </span>
        <span className="text-[8px] text-muted-foreground">
          Palettes filter this panel only — switching never erases recorded observations.
        </span>
      </div>

      {/* ── Numbering: the gate every level statement depends on (spec §4) ── */}
      <div className="mb-1.5 rounded border border-amber-300/70 bg-white/80 p-1.5 dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[8px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-300">
            Vertebral numbering
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[8px] font-bold",
              normalAllowed
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                : "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100",
            )}
          >
            {lsNumberingConfidence(numbering) === "confident" ? "confident" : "reduced confidence"}
          </span>
        </div>
        <div className="mb-1 text-[8px] leading-snug text-muted-foreground">
          {numbering.basis === "unset"
            ? "No basis established: level-bearing tiles stay unavailable, and the report never assumes the lowest mobile segment is L5-S1."
            : `Established from ${LS_NUMBERING_BASIS_OPTIONS.find((o) => o.value === numbering.basis)?.label ?? numbering.basis}.`}
          {numberingCaution ? ` ${numberingCaution}` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <select
            data-testid="ls-numbering-basis"
            className={fieldClass}
            disabled={disabled}
            value={numberingDraft.basis}
            onChange={(e) =>
              setNumberingDraft((d) => ({ ...d, basis: e.target.value as LsNumberingBasis | "unset" }))
            }
          >
            <option value="unset">Not established</option>
            {LS_NUMBERING_BASIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <span className="text-[8px]">Lumbar-type bodies</span>
            <input
              data-testid="ls-numbering-count"
              className={cn(fieldClass, "w-9")}
              inputMode="numeric"
              disabled={disabled}
              value={numberingDraft.lumbarTypeCount ?? ""}
              onChange={(e) =>
                setNumberingDraft((d) => ({ ...d, lumbarTypeCount: numOrNull(e.target.value) }))
              }
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[8px]">Designated L5 (1st body = 1)</span>
            <input
              data-testid="ls-numbering-anchor"
              className={cn(fieldClass, "w-9")}
              inputMode="numeric"
              disabled={disabled}
              value={numberingDraft.designatedL5Position ?? ""}
              onChange={(e) =>
                setNumberingDraft((d) => ({ ...d, designatedL5Position: numOrNull(e.target.value) }))
              }
            />
          </label>
          <select
            data-testid="ls-numbering-castellvi"
            className={fieldClass}
            disabled={disabled}
            value={numberingDraft.castellvi ?? ""}
            onChange={(e) =>
              setNumberingDraft((d) => ({
                ...d,
                castellvi: (e.target.value || null) as CastellviType | null,
              }))
            }
          >
            <option value="">Castellvi — not selected</option>
            {CASTELLVI_TYPES.map((t) => (
              <option key={t} value={t}>
                Castellvi {t}
              </option>
            ))}
          </select>
          <input
            data-testid="ls-numbering-evidence"
            className={cn(fieldClass, "min-w-24 flex-1")}
            placeholder="Evidence (e.g. twelve rib-bearing thoracic vertebrae on the standing film)"
            disabled={disabled}
            value={numberingDraft.evidence ?? ""}
            onChange={(e) => setNumberingDraft((d) => ({ ...d, evidence: e.target.value || null }))}
          />
          <button
            type="button"
            data-testid="ls-numbering-apply"
            disabled={disabled}
            onClick={applyNumbering}
            className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100"
          >
            Record numbering
          </button>
        </div>
      </div>

      {/* ── Performed views ─────────────────────────────────────────────── */}
      <div className="mb-1.5 rounded border border-amber-200/70 bg-white/70 p-1.5 dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          Performed views
        </div>
        <div className="flex flex-wrap gap-1">
          {VIEW_TOGGLES.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled || key === "other"}
              onClick={() => toggleView(key)}
              data-testid={`ls-view-${key}`}
              title={
                key === "other"
                  ? "Record any other projection in the Technique field — the model never asserts a view it did not record."
                  : ctx.performed[key]
                    ? "Recorded as performed. Click to remove."
                    : "Not recorded — click to record as performed."
              }
              className={chip(ctx.performed[key], key === "other")}
            >
              {XRAY_LS_VIEW_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[8px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Coverage
          </span>
          {COVERAGE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => setTechnique(setLsCoverageInTechnique(techniqueText, value))}
              data-testid={`ls-coverage-${value}`}
              className={chip(ctx.inferiorCoverage === value)}
            >
              {value === "unknown" ? "not recorded" : value}
            </button>
          ))}
        </div>
      </div>

      {/* ── Adequacy cycling ────────────────────────────────────────────── */}
      <div className="mb-1.5 rounded border border-amber-200/70 bg-white/70 p-1.5 dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          Adequacy — click to cycle unknown → adequate → limited
        </div>
        <div className="flex flex-wrap gap-1">
          {ADEQUACY_TOGGLES.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => cycleAdequacy(key)}
              data-testid={`ls-adequacy-${key}`}
              title={`${XRAY_LS_ADEQUACY_LABELS[key]}: ${ctx.adequacy[key]}`}
              className={cn(
                chip(ctx.adequacy[key] === "adequate"),
                ctx.adequacy[key] === "limited" &&
                  "border-rose-400 bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
              )}
            >
              {XRAY_LS_ADEQUACY_LABELS[key]}
              <span className="ml-1 font-normal opacity-70">{ctx.adequacy[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Gate strip: what the study cannot support yet ───────────────── */}
      {(!parsGate.ok || !junctionGate.ok || missingDynamic.length > 0) && (
        <div className="mb-1.5 rounded border border-rose-300/70 bg-rose-50/70 p-1.5 text-[8px] leading-snug text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100">
          {!parsGate.ok && <div>{parsGate.reason ?? `Missing: ${parsGate.missing.join(", ")}`}</div>}
          {!junctionGate.ok && (
            <div>{junctionGate.reason ?? `Missing: ${junctionGate.missing.join(", ")}`}</div>
          )}
          {missingDynamic.length > 0 && (
            <div>
              Dynamic tiles need both positions; missing {missingDynamic.join(" and ")}.
            </div>
          )}
        </div>
      )}

      {/* ── Level / side selectors ──────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <label className="flex items-center gap-1">
          <span className="text-[8px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Level
          </span>
          <select
            data-testid="ls-level"
            className={fieldClass}
            disabled={disabled}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            {LS_LEVEL_OPTIONS.filter((o) => !allowedLevels.length || allowedLevels.includes(o.value)).map(
              (o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[8px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Side
          </span>
          <select
            data-testid="ls-side"
            className={fieldClass}
            disabled={disabled}
            value={side}
            onChange={(e) => setSide(e.target.value as typeof side)}
          >
            <option value="">not side-specific</option>
            <option value="right">right</option>
            <option value="left">left</option>
            <option value="bilateral">bilateral</option>
          </select>
        </label>
        {(["numbering", "measures", "dynamic", "hardware"] as const).map((p) => (
          <button
            key={p}
            type="button"
            data-testid={`ls-panel-${p}`}
            disabled={disabled}
            onClick={() => setPanel(panel === p ? "none" : p)}
            className={chip(panel === p)}
          >
            {p === "numbering"
              ? "Numbering detail"
              : p === "measures"
                ? "Measure"
                : p === "dynamic"
                  ? "Flexion / extension"
                  : "Post-operative"}
          </button>
        ))}
        <button
          type="button"
          data-testid="ls-toggle-advanced"
          onClick={() => setShowAdvanced((v) => !v)}
          className={chip(showAdvanced)}
        >
          {showAdvanced ? "Hide advanced tiles" : "Show advanced / rare tiles"}
        </button>
      </div>

      {/* ── Presets ─────────────────────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap gap-1">
        {XRAY_LS_PRESETS.map((preset) => {
          const availability = lsPresetAvailability(preset, ctx, template, numbering);
          const on = activeBundles.has(lsBundleId("preset", preset.id));
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled || !availability.ok}
              onClick={() => onPreset(preset.id)}
              data-testid={`ls-preset-${preset.id}`}
              title={
                availability.ok
                  ? on
                    ? "Recorded. Click to remove this bundle."
                    : "Apply this one-click pattern."
                  : availability.reason ?? `Not available: ${availability.missing.join(", ")}`
              }
              className={cn(
                chip(on || availability.ok, !availability.ok),
                on && "border-amber-600",
                lsPresetIsCritical(preset) && availability.ok && "border-rose-400",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {panel === "numbering" && (
        <Panel title="Numbering model">
          <div className="space-y-1 text-[8px] leading-snug">
            <div>
              Basis: <strong>{numbering.basis}</strong> · counted{" "}
              <strong>{numbering.lumbarTypeCount ?? "not counted"}</strong> · designated L5 position{" "}
              <strong>{numbering.designatedL5Position ?? "not anchored"}</strong> · Castellvi{" "}
              <strong>{numbering.castellvi ?? "not selected"}</strong>
            </div>
            <div>
              Levels the recorded scheme can name:{" "}
              {lsNumberingAllowedLevels(numbering).length
                ? lsNumberingAllowedLevels(numbering).join(", ")
                : "none — no level-specific claim is supportable yet"}
            </div>
            <div className="text-muted-foreground">
              A transitional lumbosacral vertebra changes which body is L5; the labels are derived from
              the designated L5 rather than from the segment count, and Castellvi type is only ever
              recorded as a radiologist selection.
            </div>
          </div>
        </Panel>
      )}

      {panel === "measures" && (
        <Panel title="Measurements with provenance">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <select
              data-testid="ls-measure-kind"
              className={fieldClass}
              value={measureDraft.kind}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, kind: e.target.value as LsMeasurementKind }))
              }
            >
              {MEASUREMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LS_MEASUREMENT_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-measure-view"
              className={fieldClass}
              value={measureDraft.view ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, view: (e.target.value || null) as XrayLsViewKey | null }))
              }
            >
              <option value="">view…</option>
              {VIEW_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {XRAY_LS_VIEW_LABELS[v]}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-measure-source"
              className={fieldClass}
              value={measureDraft.source}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, source: e.target.value as LsMeasurementSource }))
              }
            >
              {MEASUREMENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              data-testid="ls-measure-level"
              className={cn(fieldClass, "w-16")}
              placeholder="level"
              value={measureDraft.level ?? ""}
              onChange={(e) => setMeasureDraft((d) => ({ ...d, level: e.target.value }))}
            />
            <input
              data-testid="ls-measure-upper"
              className={cn(fieldClass, "w-12")}
              placeholder="upper"
              value={measureDraft.upperLevel ?? ""}
              onChange={(e) => setMeasureDraft((d) => ({ ...d, upperLevel: e.target.value }))}
            />
            <input
              data-testid="ls-measure-lower"
              className={cn(fieldClass, "w-12")}
              placeholder="lower"
              value={measureDraft.lowerLevel ?? ""}
              onChange={(e) => setMeasureDraft((d) => ({ ...d, lowerLevel: e.target.value }))}
            />
            <input
              data-testid="ls-measure-mm"
              className={cn(fieldClass, "w-12")}
              placeholder="mm"
              inputMode="decimal"
              value={measureDraft.mm ?? ""}
              onChange={(e) => setMeasureDraft((d) => ({ ...d, mm: numOrNull(e.target.value) }))}
            />
            <input
              data-testid="ls-measure-deg"
              className={cn(fieldClass, "w-12")}
              placeholder="deg"
              inputMode="decimal"
              value={measureDraft.degrees ?? ""}
              onChange={(e) => setMeasureDraft((d) => ({ ...d, degrees: numOrNull(e.target.value) }))}
            />
            <input
              data-testid="ls-measure-pct"
              className={cn(fieldClass, "w-12")}
              placeholder="slip %"
              inputMode="decimal"
              value={measureDraft.slipPercent ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, slipPercent: numOrNull(e.target.value) }))
              }
            />
            <input
              data-testid="ls-measure-height-loss-pct"
              className={cn(fieldClass, "w-14")}
              placeholder="height loss %"
              inputMode="decimal"
              value={measureDraft.heightLossPercent ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, heightLossPercent: numOrNull(e.target.value) }))
              }
            />
            <input
              data-testid="ls-measure-translation"
              className={cn(fieldClass, "w-14")}
              placeholder="translation mm"
              inputMode="decimal"
              value={measureDraft.translationMm ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, translationMm: numOrNull(e.target.value) }))
              }
            />
            <input
              data-testid="ls-measure-bodyap"
              className={cn(fieldClass, "w-14")}
              placeholder="body AP mm"
              inputMode="decimal"
              value={measureDraft.bodyApWidthMm ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, bodyApWidthMm: numOrNull(e.target.value) }))
              }
            />
            <input
              data-testid="ls-measure-height"
              className={cn(fieldClass, "w-16")}
              placeholder="measured mm"
              inputMode="decimal"
              value={measureDraft.measuredHeightMm ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, measuredHeightMm: numOrNull(e.target.value) }))
              }
            />
            <input
              data-testid="ls-measure-reference"
              className={cn(fieldClass, "w-16")}
              placeholder="reference mm"
              inputMode="decimal"
              value={measureDraft.referenceHeightMm ?? ""}
              onChange={(e) =>
                setMeasureDraft((d) => ({ ...d, referenceHeightMm: numOrNull(e.target.value) }))
              }
            />
            <label className="flex items-center gap-1">
              <input
                data-testid="ls-measure-override"
                type="checkbox"
                checked={Boolean(measureDraft.manualOverride)}
                onChange={(e) => setMeasureDraft((d) => ({ ...d, manualOverride: e.target.checked }))}
              />
              <span className="text-[8px]">manual override</span>
            </label>
            <button
              type="button"
              data-testid="ls-measure-add"
              disabled={disabled}
              onClick={() => {
                setMeasureRows((rows) => [...rows, measureDraft]);
                setMeasureDraft(emptyMeasurement(level));
              }}
              className={chip(false)}
            >
              Add row
            </button>
            <button
              type="button"
              data-testid="ls-measure-apply"
              disabled={disabled}
              onClick={applyMeasurements}
              className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
            >
              Record {measureRows.length + 1} measurement{measureRows.length ? "s" : ""}
            </button>
          </div>
          <div className="text-[8px] text-muted-foreground">
            A slip percentage is derived from the translation and the vertebral body AP diameter; a
            height-loss percentage from the measured and reference heights; a Meyerding grade only from a
            valid percentage. Nothing is estimated, and a measurement the views or numbering cannot
            support is refused below rather than written.
          </div>
          {measureRejections.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[8px] text-rose-700 dark:text-rose-300">
              {measureRejections.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {measureRows.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[8px]">
              {measureRows.map((r, i) => (
                <li key={`${r.kind}-${i}`}>
                  {LS_MEASUREMENT_LABELS[r.kind]} · {normalizeLsLevel(r.level ?? null) ?? r.level ?? "no level"} ·{" "}
                  {r.view ? XRAY_LS_VIEW_LABELS[r.view] : "no view"}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {panel === "dynamic" && (
        <Panel title="Flexion / extension">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <input
              data-testid="ls-dynamic-level"
              className={cn(fieldClass, "w-16")}
              placeholder="level"
              value={dynamicDraft.level ?? ""}
              onChange={(e) => setDynamicDraft((d) => ({ ...d, level: e.target.value }))}
            />
            {(
              [
                ["neutralTranslationMm", "neutral mm"],
                ["flexionTranslationMm", "flexion mm"],
                ["extensionTranslationMm", "extension mm"],
                ["neutralAngulationDeg", "neutral deg"],
                ["flexionAngulationDeg", "flexion deg"],
                ["extensionAngulationDeg", "extension deg"],
              ] as const
            ).map(([key, label]) => (
              <input
                key={key}
                data-testid={`ls-dynamic-${key}`}
                className={cn(fieldClass, "w-16")}
                placeholder={label}
                inputMode="decimal"
                value={dynamicDraft[key] ?? ""}
                onChange={(e) =>
                  setDynamicDraft((d) => ({ ...d, [key]: numOrNull(e.target.value) }))
                }
              />
            ))}
            <select
              data-testid="ls-dynamic-interpretation"
              className={fieldClass}
              value={dynamicDraft.interpretation ?? "none"}
              onChange={(e) =>
                setDynamicDraft((d) => ({
                  ...d,
                  interpretation: e.target.value as LsDynamicEntry["interpretation"],
                }))
              }
            >
              {LS_DYNAMIC_INTERPRETATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              data-testid="ls-dynamic-note"
              className={cn(fieldClass, "min-w-24 flex-1")}
              placeholder="optional note"
              value={dynamicDraft.note ?? ""}
              onChange={(e) => setDynamicDraft((d) => ({ ...d, note: e.target.value }))}
            />
            <button
              type="button"
              data-testid="ls-dynamic-add"
              disabled={disabled}
              onClick={() => {
                setDynamicRows((rows) => [...rows, dynamicDraft]);
                setDynamicDraft(emptyEntry(level));
              }}
              className={chip(false)}
            >
              Add segment
            </button>
            <button
              type="button"
              data-testid="ls-dynamic-apply"
              disabled={disabled}
              onClick={applyDynamic}
              className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
            >
              Record dynamic assessment
            </button>
          </div>
          <div className="text-[8px] leading-snug text-muted-foreground">
            CARE holds no instability threshold. The change is computed from the neutral value and the
            two positions, and the word “unstable” appears only when the reporting radiologist selects
            that interpretation.
          </div>
          {dynamicRejections.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[8px] text-rose-700 dark:text-rose-300">
              {dynamicRejections.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {panel === "hardware" && (
        <Panel title="Post-operative">
          <div className="mb-1 flex flex-wrap gap-1">
            {PROCEDURES.map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`ls-procedure-${p}`}
                disabled={disabled}
                onClick={() =>
                  setHardware((h) => ({
                    ...h,
                    procedures: h.procedures.includes(p)
                      ? h.procedures.filter((x) => x !== p)
                      : [...h.procedures, p],
                  }))
                }
                className={chip(hardware.procedures.includes(p))}
              >
                {LS_HARDWARE_PROCEDURE_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <input
              data-testid="ls-hardware-components"
              className={cn(fieldClass, "min-w-28 flex-1")}
              placeholder="implants (e.g. pedicle screws, rods, cage, cement)"
              value={hardware.components.join(", ")}
              onChange={(e) =>
                setHardware((h) => ({
                  ...h,
                  components: e.target.value
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean),
                }))
              }
            />
            <select
              data-testid="ls-hardware-continuity"
              className={fieldClass}
              value={hardware.continuity}
              onChange={(e) =>
                setHardware((h) => ({ ...h, continuity: e.target.value as LsHardwareContinuity }))
              }
            >
              {LS_HARDWARE_CONTINUITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-hardware-position"
              className={fieldClass}
              value={hardware.position}
              onChange={(e) =>
                setHardware((h) => ({ ...h, position: e.target.value as LsHardwarePosition }))
              }
            >
              {LS_HARDWARE_POSITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-hardware-lucency"
              className={fieldClass}
              value={hardware.lucency}
              onChange={(e) => setHardware((h) => ({ ...h, lucency: e.target.value as LsHardwareLucency }))}
            >
              {LS_HARDWARE_LUCENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-hardware-level"
              className={fieldClass}
              value={hardware.levels[0] ?? ""}
              onChange={(e) => setHardware((h) => ({ ...h, levels: e.target.value ? [e.target.value] : [] }))}
            >
              <option value="">level…</option>
              {LS_VERTEBRA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              data-testid="ls-hardware-adjacent"
              className={fieldClass}
              value={hardware.adjacentLevel ?? ""}
              onChange={(e) =>
                setHardware((h) => ({ ...h, adjacentLevel: e.target.value || null }))
              }
            >
              <option value="">adjacent segment — none</option>
              {LS_LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input
                data-testid="ls-hardware-fusion"
                type="checkbox"
                checked={Boolean(hardware.fusionMassPresent)}
                onChange={(e) => setHardware((h) => ({ ...h, fusionMassPresent: e.target.checked }))}
              />
              <span className="text-[8px]">fusion mass</span>
            </label>
            <button
              type="button"
              data-testid="ls-hardware-apply"
              disabled={disabled}
              onClick={applyHardware}
              className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
            >
              Record post-operative findings
            </button>
          </div>
          <div className="text-[8px] leading-snug text-muted-foreground">
            Equivocal perihardware lucency stays descriptive: only a convincing lucency is written as
            concerning for loosening, and continuity or position that cannot be judged is recorded as not
            assessed rather than intact.
          </div>
          {hardwareWarnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[8px] text-rose-700 dark:text-rose-300">
              {hardwareWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* ── Palette selector ────────────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap gap-1">
        {LS_SUBMASTER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`ls-palette-${id}`}
            onClick={() => togglePalette(id)}
            className={chip(activePalettes.includes(id))}
          >
            {XRAY_LS_SUB_MASTERS.find((sm) => sm.id === id)?.label ?? id}
          </button>
        ))}
      </div>

      {/* ── Tile panels ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {XRAY_LS_SUB_MASTERS.filter((sm) => activePalettes.includes(sm.id)).map((subMaster) => {
          const tiles = subMaster.tiles.filter((t) => showAdvanced || !t.advanced);
          const groups = [...new Set(tiles.map((t) => t.group))];
          return (
            <div
              key={subMaster.id}
              data-testid={`ls-submaster-${subMaster.id}`}
              className="rounded border border-amber-200/70 bg-white/70 p-1.5 dark:border-amber-900/50 dark:bg-amber-950/30"
            >
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                  {subMaster.label}
                </span>
                <span className="text-[8px] text-muted-foreground">{subMaster.hint}</span>
              </div>
              {groups.map((group) => (
                <div key={group} className="mb-1">
                  <div className="mb-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-800/80 dark:text-amber-300/80">
                    {group}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tiles
                      .filter((t) => t.group === group)
                      .map((tile) => {
                        const availability = lsTileAvailability(tile, ctx, template, numbering);
                        const on = activeBundles.has(lsBundleId("tile", tile.id));
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            disabled={disabled || !availability.ok}
                            onClick={() => onTile(tile)}
                            data-testid={`ls-tile-${tile.id}`}
                            title={
                              availability.ok
                                ? on
                                  ? "Recorded. Click to remove this bundle."
                                  : tile.atoms[0]?.findings ?? tile.label
                                : availability.reason ?? `Not available: ${availability.missing.join(", ")}`
                            }
                            className={cn(
                              chip(on || availability.ok, !availability.ok),
                              on && "border-amber-600",
                              tile.criticalPattern && availability.ok && "border-rose-400",
                            )}
                          >
                            {tile.label}
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
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 rounded border border-amber-300/70 bg-white/90 p-1.5 dark:border-amber-900/50 dark:bg-amber-950/40">
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-300">
        {title}
      </div>
      {children}
    </div>
  );
}
