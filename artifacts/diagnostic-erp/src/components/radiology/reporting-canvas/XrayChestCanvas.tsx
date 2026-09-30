"use client";
/**
 * XrayChestCanvas — the X-ray Chest clinical sub-master surface.
 *
 * Mounted from ReportingToolsRail behind isXrayChestReportingContext, exactly
 * like MriBrainCanvas. It owns no state model of its own: every click compiles
 * atoms and goes through the existing store actions (applyMacroBundle /
 * removeMacroBundle / applyPathologyOverlay), so ledger identity, provenance,
 * baseline supersession, manual protection, undo and impression refresh behave
 * identically to the rest of the platform. There is no parallel engine.
 *
 * The View / Adequacy strip at the top writes canonical sentences into the
 * Technique field — the same field the report already prints and persists —
 * and reads them back. Nothing here claims a projection that is not recorded.
 */
import { useMemo, useState } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  XRAY_ADEQUACY_LABELS,
  XRAY_VIEW_LABELS,
  assessCardiacSize,
  parseXrayChestViews,
  setAdequacyInTechnique,
  toggleViewInTechnique,
  type XrayAdequacyGrade,
  type XrayAdequacyKey,
  type XrayViewKey,
} from "@/lib/xrayChestViews";
import {
  XRAY_CHEST_PRESETS,
  XRAY_CHEST_SUB_MASTERS,
  buildTilePatch,
  chestPresetIsCritical,
  chestSubMasterById,
  tileAvailable,
  type ChestPresetContext,
  type ChestSubMasterId,
  type ChestTile,
} from "@/lib/xrayChestSubMasters";
import { chestBundleId } from "@/lib/xrayChestAtoms";
import {
  XRAY_DEVICE_LABELS,
  XRAY_DEVICE_POSITION_OPTIONS,
  buildChestDeviceAtoms,
  type XrayDeviceKind,
  type XrayDevicePosition,
} from "@/lib/xrayChestDevices";
import {
  buildChestLesionAtoms,
  type ChestLesionAppearance,
  type ChestLesionMargins,
  type ChestZone,
} from "@/lib/xrayChestLesions";
import {
  CHEST_INTERVAL_LABELS,
  buildChestComparisonAtom,
} from "@/lib/xrayChestComparison";
import type { IntervalChange } from "@/lib/radiologyComparison";
import {
  buildChestMeasureAtoms,
  type EffusionSize,
  type SizeBand,
} from "@/lib/xrayChestMeasures";
import { cn } from "@/lib/utils";

const VIEW_TOGGLES: XrayViewKey[] = [
  "pa",
  "ap",
  "apErect",
  "apSupine",
  "portableAp",
  "lateral",
  "lordotic",
  "other",
];

const ADEQUACY_TOGGLES: XrayAdequacyKey[] = [
  "inspiration",
  "rotation",
  "penetration",
  "motion",
  "fieldInclusion",
];

const ZONES: ChestZone[] = [
  "apex",
  "upper zone",
  "mid zone",
  "lower zone",
  "base",
  "periphery",
  "hilum",
  "right upper lobe",
  "right middle lobe",
  "right lower lobe",
  "left upper lobe",
  "lingula",
  "left lower lobe",
];

const APPEARANCES: ChestLesionAppearance[] = [
  "rounded",
  "irregular",
  "nodular",
  "mass-like",
  "cavitary",
];

const MARGINS: ChestLesionMargins[] = ["well-defined", "ill-defined", "lobulated"];

const DEVICE_KINDS = Object.keys(XRAY_DEVICE_LABELS) as XrayDeviceKind[];

const ADEQUACY_CYCLE: XrayAdequacyGrade[] = ["unknown", "adequate", "limited"];

/** Paediatric threshold used only to filter palette availability, never to
 *  assert a paediatric diagnosis. */
const PEDIATRIC_MAX_AGE_YEARS = 16;

function ageInYears(age: string | number | null | undefined): number | null {
  if (age === null || age === undefined) return null;
  const m = /(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years)?/i.exec(String(age).trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return /y|yr|yrs|year|years/i.test(m[2] ?? "y") ? value : value;
}

const nextGrade = (grade: XrayAdequacyGrade): XrayAdequacyGrade =>
  ADEQUACY_CYCLE[(ADEQUACY_CYCLE.indexOf(grade) + 1) % ADEQUACY_CYCLE.length];

export function XrayChestCanvas({
  disabled,
  region = "Chest",
  patientAge,
}: {
  disabled?: boolean;
  region?: string;
  patientAge?: string | number | null;
}) {
  const techniqueText = useWorkspace((s) => s.techniqueText);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);

  const ctx = useMemo(() => parseXrayChestViews(techniqueText), [techniqueText]);
  const cardiac = useMemo(() => assessCardiacSize(ctx), [ctx]);

  const [activePalettes, setActivePalettes] = useState<ChestSubMasterId[]>(["routine"]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [side, setSide] = useState<"right" | "left" | "">("");
  const [zone, setZone] = useState<string>("");
  const [panel, setPanel] = useState<"none" | "device" | "lesion" | "measures" | "comparison">("none");

  const isPediatric = useMemo(() => {
    const years = ageInYears(patientAge);
    return years !== null && years <= PEDIATRIC_MAX_AGE_YEARS;
  }, [patientAge]);

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const bundle = p.observation?.bundleId;
      if (bundle && !p.stale) out.add(bundle);
    });
    return out;
  }, [patches]);

  const template = useMemo(
    () => ({
      laterality: side || null,
      zone: zone || null,
    }),
    [side, zone],
  );

  const presetCtx = useMemo<ChestPresetContext>(
    () => ({ region, ctx, laterality: side || null, zone: zone || null }),
    [region, ctx, side, zone],
  );

  const setTechnique = (next: string) => {
    useWorkspace.getState().setField("technique", next, "structured-template");
  };

  const toggleView = (key: XrayViewKey) => {
    if (disabled) return;
    setTechnique(toggleViewInTechnique(techniqueText, key, !ctx.performed[key]));
  };

  const cycleAdequacy = (key: XrayAdequacyKey) => {
    if (disabled) return;
    setTechnique(setAdequacyInTechnique(techniqueText, key, nextGrade(ctx.adequacy[key])));
  };

  const onTile = (tile: ChestTile) => {
    if (disabled) return;
    const bundleId = chestBundleId("tile", tile.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    if (!tileAvailable(tile, ctx).ok) return;
    useWorkspace.getState().applyMacroBundle(buildTilePatch(tile, region, template));
  };

  const onPreset = (presetId: string) => {
    if (disabled) return;
    const preset = XRAY_CHEST_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const bundleId = chestBundleId("preset", preset.id);
    if (activeBundles.has(bundleId)) {
      useWorkspace.getState().removeMacroBundle(bundleId);
      return;
    }
    const missing: string[] = [];
    for (const key of preset.requires ?? []) if (!ctx.performed[key]) missing.push(XRAY_VIEW_LABELS[key]);
    for (const key of preset.requiresAdequate ?? []) {
      if (ctx.adequacy[key] === "limited") missing.push(`${XRAY_ADEQUACY_LABELS[key]} (limited)`);
    }
    if (missing.length) return;
    useWorkspace.getState().applyMacroBundle(preset.build(presetCtx));
    if (preset.id === "normal-chest-pa" || preset.id === "normal-chest-ap") {
      useWorkspace.getState().seedSystemNormalImpression();
    }
  };

  const togglePalette = (id: ChestSubMasterId) => {
    setActivePalettes((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };

  return (
    <div
      data-testid="xray-chest-canvas"
      className="rounded-lg border border-cyan-200/70 bg-cyan-50/40 p-2 text-[9px] dark:border-cyan-900/60 dark:bg-cyan-950/20"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-900 dark:text-cyan-200">
          X-ray Chest sub-master
        </span>
        <span className="text-[8px] text-muted-foreground">
          Palettes filter this panel only — switching never erases recorded observations.
        </span>
      </div>

      {/* ── View / adequacy: first-class state that gates interpretation ── */}
      <div className="mb-1.5 rounded border border-cyan-200/70 bg-white/70 p-1.5 dark:border-cyan-900/50 dark:bg-cyan-950/30">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-300">
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
                data-testid={`chest-view-${key}`}
                title={
                  key === "other"
                    ? "Record any other projection in the Technique field."
                    : on
                      ? "Recorded as performed. Click to remove."
                      : "Not recorded — click to record as performed."
                }
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                  on
                    ? "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                    : "border-slate-300 bg-white text-slate-500 hover:border-cyan-500 dark:bg-transparent dark:text-slate-400",
                  key === "other" && "opacity-60",
                )}
              >
                {on ? "✓ " : ""}
                {XRAY_VIEW_LABELS[key]}
              </button>
            );
          })}
        </div>

        <div className="mb-1 mt-2 text-[8px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-300">
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
                data-testid={`chest-adequacy-${key}`}
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
                {XRAY_ADEQUACY_LABELS[key]}
                {grade === "limited" ? " · limited" : grade === "adequate" ? " · adequate" : ""}
              </button>
            );
          })}
        </div>

        <div
          data-testid="chest-cardiac-gate"
          className={cn(
            "mt-1.5 rounded px-1.5 py-1 text-[8px] font-medium",
            cardiac.allowed
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          {cardiac.allowed
            ? "PA frontal projection recorded — cardiac size may be assessed."
            : (cardiac.caveat ?? cardiac.blocked)}
        </div>
      </div>

      {/* ── Side / zone carried into the tiles that need a location ── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <label className="text-[8px] font-semibold text-cyan-800 dark:text-cyan-300" htmlFor="chest-side">
          Side
        </label>
        <select
          id="chest-side"
          data-testid="chest-side"
          disabled={disabled}
          value={side}
          onChange={(e) => setSide(e.target.value as "right" | "left" | "")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">not chosen</option>
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
        <label className="text-[8px] font-semibold text-cyan-800 dark:text-cyan-300" htmlFor="chest-zone">
          Zone / lobe
        </label>
        <select
          id="chest-zone"
          data-testid="chest-zone"
          disabled={disabled}
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">not chosen</option>
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {(!side || !zone) && (
          <span className="text-[8px] text-amber-700 dark:text-amber-300">
            Unchosen location stays a [side]/[zone] token in the text — never an invented finding.
          </span>
        )}
      </div>

      {/* ── Palette bar ── */}
      <div className="mb-1.5 flex flex-wrap gap-1">
        {XRAY_CHEST_SUB_MASTERS.map((sm) => {
          const on = activePalettes.includes(sm.id);
          return (
            <button
              key={sm.id}
              type="button"
              onClick={() => togglePalette(sm.id)}
              data-testid={`chest-palette-${sm.id}`}
              title={sm.hint}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                on
                  ? "border-cyan-600 bg-cyan-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-cyan-500 dark:bg-transparent dark:text-slate-300",
              )}
            >
              {sm.label}
            </button>
          );
        })}
      </div>

      {isPediatric ? (
        <div data-testid="chest-pediatric-note" className="mb-1.5 text-[8px] font-medium text-sky-800 dark:text-sky-300">
          Paediatric study — adult-involution and emphysema tiles are hidden; the thymic contour is not read as a mass.
        </div>
      ) : null}

      {/* ── Active palettes ── */}
      <div className="space-y-1.5">
        {activePalettes.map((id) => {
          const sm = chestSubMasterById(id);
          if (!sm) return null;
          const presets = XRAY_CHEST_PRESETS.filter((p) => p.subMasterId === id);
          const visibleTiles = sm.tiles.filter((t) => {
            if (t.advanced && !showAdvanced) return false;
            if (t.adultOnly && isPediatric) return false;
            if (t.pediatricOnly && !isPediatric && patientAge !== null && patientAge !== undefined) return false;
            return true;
          });
          const groups = Array.from(
            visibleTiles.reduce((acc, t) => {
              const list = acc.get(t.group) ?? [];
              list.push(t);
              acc.set(t.group, list);
              return acc;
            }, new Map<string, ChestTile[]>()),
          );

          return (
            <div
              key={id}
              data-testid={`chest-palette-panel-${id}`}
              className="rounded border border-cyan-200/70 bg-white/70 p-1.5 dark:border-cyan-900/50 dark:bg-cyan-950/30"
            >
              <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-cyan-900 dark:text-cyan-200">
                {sm.label}
              </div>

              {presets.length ? (
                <div className="mb-1 flex flex-wrap gap-1">
                  {presets.map((p) => {
                    const bundleId = chestBundleId("preset", p.id);
                    const on = activeBundles.has(bundleId);
                    const missing: string[] = [];
                    for (const key of p.requires ?? []) {
                      if (!ctx.performed[key]) missing.push(XRAY_VIEW_LABELS[key]);
                    }
                    for (const key of p.requiresAdequate ?? []) {
                      if (ctx.adequacy[key] === "limited") missing.push(XRAY_ADEQUACY_LABELS[key]);
                    }
                    const gated = missing.length > 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={disabled || (!on && gated)}
                        onClick={() => onPreset(p.id)}
                        data-testid={`chest-preset-${p.id}`}
                        title={
                          gated
                            ? `Needs: ${missing.join(", ")}`
                            : chestPresetIsCritical(p)
                              ? "Critical-pattern preset — use the existing critical-result workflow to document communication."
                              : p.label
                        }
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                          on
                            ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                            : "border-slate-300 bg-white text-slate-700 hover:border-amber-500 dark:bg-transparent dark:text-slate-200",
                          gated && !on && "cursor-not-allowed opacity-50",
                          chestPresetIsCritical(p) && !gated && "border-rose-400",
                        )}
                      >
                        ★ {p.label}
                        {chestPresetIsCritical(p) ? " (critical)" : ""}
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
                      const bundleId = chestBundleId("tile", tile.id);
                      const on = activeBundles.has(bundleId);
                      const gate = tileAvailable(tile, ctx);
                      return (
                        <button
                          key={tile.id}
                          type="button"
                          disabled={disabled || (!on && !gate.ok)}
                          onClick={() => onTile(tile)}
                          data-testid={`chest-tile-${tile.id}`}
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
                              ? "border-cyan-600 bg-cyan-100 text-cyan-900 dark:bg-cyan-900/50 dark:text-cyan-100"
                              : "border-slate-300 bg-white text-slate-700 hover:border-cyan-500 dark:bg-transparent dark:text-slate-200",
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
          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[8px] font-semibold text-slate-600 hover:border-cyan-500 dark:bg-transparent dark:text-slate-300"
        >
          {showAdvanced ? "Hide" : "Show"} advanced / rare tiles
        </button>
        {(
          [
            ["device", "Lines / tubes / devices"],
            ["lesion", "Nodule / mass"],
            ["measures", "Measurements"],
            ["comparison", "Comparison"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => setPanel(panel === key ? "none" : key)}
            data-testid={`chest-panel-${key}`}
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

      {panel === "device" ? <ChestDevicePanel disabled={disabled} region={region} /> : null}
      {panel === "lesion" ? (
        <ChestLesionPanel disabled={disabled} region={region} defaultSide={side || null} defaultZone={zone || null} />
      ) : null}
      {panel === "measures" ? (
        <ChestMeasurePanel disabled={disabled} region={region} paAvailable={ctx.performed.pa} defaultSide={side || null} />
      ) : null}
      {panel === "comparison" ? <ChestComparisonPanel disabled={disabled} region={region} /> : null}
    </div>
  );
}

/* ─────────────────────────── device panel ─────────────────────────────── */

function ChestDevicePanel({ disabled, region }: { disabled?: boolean; region: string }) {
  const [kind, setKind] = useState<XrayDeviceKind>("etTube");
  const [side, setSide] = useState<"right" | "left" | "">("");
  const [position, setPosition] = useState<XrayDevicePosition>("notAssessed");
  const [course, setCourse] = useState("");
  const [tip, setTip] = useState("");
  const [tipCm, setTipCm] = useState("");
  const [complication, setComplication] = useState("");

  const apply = () => {
    if (disabled) return;
    const parsedCm = tipCm.trim() === "" ? null : Number(tipCm);
    const { bundleId, observations } = buildChestDeviceAtoms({
      region,
      kind,
      laterality: side || null,
      course: course.trim() || null,
      tip: tip.trim() || null,
      tipCm: parsedCm !== null && Number.isFinite(parsedCm) ? parsedCm : null,
      position,
      complication: complication.trim() || null,
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
  };

  return (
    <div
      data-testid="chest-device-panel"
      className="mt-1.5 rounded border border-violet-300/70 bg-violet-50/60 p-1.5 dark:border-violet-900/60 dark:bg-violet-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-violet-900 dark:text-violet-200">
        Lines, tubes and devices
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          data-testid="chest-device-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as XrayDeviceKind)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {DEVICE_KINDS.map((k) => (
            <option key={k} value={k}>
              {XRAY_DEVICE_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "right" | "left" | "")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">no side</option>
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
        <select
          data-testid="chest-device-position"
          value={position}
          onChange={(e) => setPosition(e.target.value as XrayDevicePosition)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {XRAY_DEVICE_POSITION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={complication}
          onChange={(e) => setComplication(e.target.value)}
          placeholder="complication, if any"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <input
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          placeholder="observed course (only what you can see)"
          className="col-span-2 rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <input
          value={tip}
          onChange={(e) => setTip(e.target.value)}
          placeholder="observed tip position (words)"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <input
          data-testid="chest-device-tip-cm"
          value={tipCm}
          onChange={(e) => setTipCm(e.target.value)}
          placeholder="tip distance cm — only if measured"
          inputMode="decimal"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[7px] text-violet-800 dark:text-violet-300">
          Tip distance is recorded only when measured — the system never estimates it.
        </span>
        <button
          type="button"
          data-testid="chest-device-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-violet-600 bg-violet-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record device
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── lesion panel ─────────────────────────────── */

function ChestLesionPanel({
  disabled,
  region,
  defaultSide,
  defaultZone,
}: {
  disabled?: boolean;
  region: string;
  defaultSide: string | null;
  defaultZone: string | null;
}) {
  const [side, setSide] = useState<"right" | "left">(defaultSide === "left" ? "left" : "right");
  const [zoneValue, setZoneValue] = useState<string>(defaultZone || "upper zone");
  const [sizeMm, setSizeMm] = useState("");
  const [appearance, setAppearance] = useState<string>("rounded");
  const [margins, setMargins] = useState("");
  const [calcified, setCalcified] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [recommendCt, setRecommendCt] = useState(false);

  const apply = () => {
    if (disabled) return;
    const parsed = sizeMm.trim() === "" ? null : Number(sizeMm);
    const { bundleId, observations } = buildChestLesionAtoms({
      region,
      laterality: side,
      zone: (zoneValue || null) as ChestZone | null,
      sizeMm: parsed !== null && Number.isFinite(parsed) ? parsed : null,
      appearance: (appearance || null) as ChestLesionAppearance | null,
      margins: (margins || null) as ChestLesionMargins | null,
      calcified,
      multiple,
      recommendCt,
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
  };

  return (
    <div
      data-testid="chest-lesion-panel"
      className="mt-1.5 rounded border border-teal-300/70 bg-teal-50/60 p-1.5 dark:border-teal-900/60 dark:bg-teal-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-teal-900 dark:text-teal-200">
        Nodule / mass — descriptive only
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "right" | "left")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
        <select
          value={zoneValue}
          onChange={(e) => setZoneValue(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <input
          value={sizeMm}
          onChange={(e) => setSizeMm(e.target.value)}
          placeholder="size in mm (only if measured)"
          inputMode="decimal"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <select
          value={appearance}
          onChange={(e) => setAppearance(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {APPEARANCES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={margins}
          onChange={(e) => setMargins(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">margins not assessed</option>
          {MARGINS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 text-[8px]">
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={calcified} onChange={(e) => setCalcified(e.target.checked)} />
            calcified
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
            multiple
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              data-testid="chest-lesion-ct"
              type="checkbox"
              checked={recommendCt}
              onChange={(e) => setRecommendCt(e.target.checked)}
            />
            CT correlation (selected)
          </label>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[7px] text-teal-800 dark:text-teal-300">
          Radiography cannot establish benignity — no malignant/benign label is generated.
        </span>
        <button
          type="button"
          data-testid="chest-lesion-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-teal-600 bg-teal-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record lesion
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────── measures panel ────────────────────────────── */

function ChestMeasurePanel({
  disabled,
  region,
  paAvailable,
  defaultSide,
}: {
  disabled?: boolean;
  region: string;
  paAvailable: boolean;
  defaultSide: string | null;
}) {
  const [side, setSide] = useState<"right" | "left">(defaultSide === "left" ? "left" : "right");
  const [rimCm, setRimCm] = useState("");
  const [ptxSize, setPtxSize] = useState<SizeBand | "">("");
  const [effusionSize, setEffusionSize] = useState<EffusionSize | "">("");
  const [loculated, setLoculated] = useState(false);
  const [ctr, setCtr] = useState("");

  const apply = () => {
    if (disabled) return;
    const parsedRim = rimCm.trim() === "" ? null : Number(rimCm);
    const parsedCtr = ctr.trim() === "" ? null : Number(ctr);
    const { bundleId, observations } = buildChestMeasureAtoms({
      region,
      bundleId: chestBundleId("measures", `manual-${Date.now().toString(36)}`),
      pneumothorax:
        parsedRim !== null || ptxSize
          ? {
              laterality: side,
              rimCm: parsedRim !== null && Number.isFinite(parsedRim) ? parsedRim : null,
              band: ptxSize || null,
            }
          : null,
      effusion: effusionSize ? { laterality: side, size: effusionSize, loculated } : null,
      ctr: parsedCtr !== null && Number.isFinite(parsedCtr) ? parsedCtr : null,
      paAvailable,
    });
    if (observations.length) useWorkspace.getState().applyMacroBundle({ bundleId, observations });
  };

  return (
    <div
      data-testid="chest-measure-panel"
      className="mt-1.5 rounded border border-rose-300/70 bg-rose-50/60 p-1.5 dark:border-rose-900/60 dark:bg-rose-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-rose-900 dark:text-rose-200">
        Measurements — thresholds are centralised, tension is never derived from size
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "right" | "left")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
        <input
          data-testid="chest-ptx-rim"
          value={rimCm}
          onChange={(e) => setRimCm(e.target.value)}
          placeholder="pneumothorax rim cm"
          inputMode="decimal"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <select
          value={ptxSize}
          onChange={(e) => setPtxSize(e.target.value as SizeBand | "")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">pneumothorax size: measured/auto</option>
          <option value="small">small</option>
          <option value="moderate">moderate</option>
          <option value="large">large</option>
        </select>
        <select
          data-testid="chest-effusion-size"
          value={effusionSize}
          onChange={(e) => setEffusionSize(e.target.value as EffusionSize | "")}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          <option value="">no effusion recorded</option>
          <option value="small">small effusion</option>
          <option value="moderate">moderate effusion</option>
          <option value="large">large effusion</option>
        </select>
        <input
          data-testid="chest-ctr"
          value={ctr}
          onChange={(e) => setCtr(e.target.value)}
          placeholder={paAvailable ? "cardiothoracic ratio, e.g. 0.52" : "CTR needs a PA projection"}
          inputMode="decimal"
          disabled={!paAvailable}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] disabled:opacity-50 dark:bg-transparent"
        />
        <label className="flex items-center gap-1 text-[8px]">
          <input type="checkbox" checked={loculated} onChange={(e) => setLoculated(e.target.checked)} />
          loculated
        </label>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[7px] text-rose-800 dark:text-rose-300">
          {paAvailable
            ? "PA recorded — cardiac ratio is assessable."
            : "No PA projection recorded — CTR is blocked; the AP caveat is written instead."}
        </span>
        <button
          type="button"
          data-testid="chest-measure-apply"
          disabled={disabled}
          onClick={apply}
          className="rounded border border-rose-600 bg-rose-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record measurements
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── comparison panel ───────────────────────────── */

const COMPARISON_SUBJECTS: Array<{ value: string; label: string }> = [
  { value: "opacity", label: "Air-space opacity" },
  { value: "effusion", label: "Pleural effusion" },
  { value: "pneumothorax", label: "Pneumothorax" },
  { value: "cardiomegaly", label: "Cardiac size" },
  { value: "nodule", label: "Nodule / mass" },
  { value: "device", label: "Line / tube / device" },
  { value: "collapse", label: "Collapse / volume loss" },
];

function ChestComparisonPanel({ disabled, region }: { disabled?: boolean; region: string }) {
  const [subject, setSubject] = useState("opacity");
  const [change, setChange] = useState<IntervalChange>("stable");
  const [priorDate, setPriorDate] = useState("");
  const [priorName, setPriorName] = useState("");

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(priorDate);

  const apply = () => {
    if (disabled || !validDate) return;
    const { bundleId, observations } = buildChestComparisonAtom({
      region,
      subject,
      change,
      priorDateIso: priorDate,
      priorStudyName: priorName || null,
    });
    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
  };

  return (
    <div
      data-testid="chest-comparison-panel"
      className="mt-1.5 rounded border border-sky-300/70 bg-sky-50/60 p-1.5 dark:border-sky-900/60 dark:bg-sky-950/30"
    >
      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-sky-900 dark:text-sky-200">
        Previous-study comparison
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {COMPARISON_SUBJECTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          data-testid="chest-comparison-change"
          value={change}
          onChange={(e) => setChange(e.target.value as IntervalChange)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        >
          {CHEST_INTERVAL_LABELS.map((c) => (
            <option key={`${c.change}-${c.label}`} value={c.change}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          data-testid="chest-comparison-date"
          type="date"
          value={priorDate}
          onChange={(e) => setPriorDate(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
        <input
          value={priorName}
          onChange={(e) => setPriorName(e.target.value)}
          placeholder="prior study name (optional)"
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[8px] dark:bg-transparent"
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[7px] text-sky-800 dark:text-sky-300">
          A comparison cannot be recorded without the prior study date — unanchored comparison wording is a validation warning.
        </span>
        <button
          type="button"
          data-testid="chest-comparison-apply"
          disabled={disabled || !validDate}
          onClick={apply}
          className="rounded border border-sky-600 bg-sky-600 px-2 py-0.5 text-[8px] font-bold text-white disabled:opacity-50"
        >
          Record comparison
        </button>
      </div>
    </div>
  );
}
