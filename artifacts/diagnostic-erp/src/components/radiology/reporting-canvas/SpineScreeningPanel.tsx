/**
 * SpineScreeningPanel — the three limited spine screening modules (cervical /
 * dorsal / LS) rendered by ONE schema-driven engine.
 *
 * It holds no clinical state of its own: selections live in
 * `useWorkspace().screening`, and every change is compiled by
 * `buildScreeningRegionBundle` into ledger atoms that are applied through the
 * existing `applyMacroBundle` / `removeMacroBundle` pair. The limitation
 * statement is an emitter-level rule applied once per report.
 *
 * Screening stays coarse by design (spec §24-§27): no dedicated-workflow
 * controls are reachable from here, and choices the acquisition cannot support
 * degrade to limitation wording instead of a conclusion (spec §32/§35).
 */

import { useMemo } from "react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import {
  SPINE_SCREENING_REGIONS,
  isScreeningRole,
  type RegionRole,
  type ScreeningOption,
  type ScreeningSelectionValue,
  type SpineScreeningRegion,
} from "@/lib/mriSpineScreeningSchema";
import {
  SCREENING_BUNDLE_PREFIX,
  SCREENING_LIMITATION_BUNDLE_ID,
  availableScreeningLevels,
  buildScreeningRegionBundle,
  composeScreeningFindings,
  performedScreeningRegions,
  roleConflict,
  screeningLedgerBundles,
  screeningOptionAvailability,
  screeningOptionSignificant,
  screeningPresetSelections,
  screeningRegionBundleId,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import {
  SPINE_SEQUENCE_LABELS,
  type SpineSequenceKey,
} from "@/lib/mriSpineSequences";
import { numberingBanner } from "@/lib/mriSpineNumbering";
import {
  resolveScreeningRoles,
  screeningRolesSummary,
  type BilledStudyInput,
} from "@/lib/mriSpineScreeningRoles";

const ROLE_OPTIONS: Array<{ id: RegionRole; label: string }> = [
  { id: "primary-dedicated", label: "Dedicated primary study" },
  { id: "primary-screening", label: "Screening only (this region)" },
  { id: "accompanying-screening", label: "Accompanying screening" },
  { id: "absent", label: "Not performed" },
];

/** Acquisition coverage the screening engine can gate on. */
const COVERAGE_KEYS: SpineSequenceKey[] = [
  "t1",
  "t2",
  "axial",
  "stir",
  "dwi",
  "contrast",
  "wholeSpineLocalizer",
  "dynamic",
];

function wants(option: ScreeningOption, token: "{level}" | "{side}" | "{mm}"): boolean {
  if (token === "{level}") {
    return Boolean(option.levelChoices) || (option.prose ?? "").includes("{level}");
  }
  return (option.prose ?? "").includes(token);
}

function without(list: ScreeningSelectionValue[], optionId: string): ScreeningSelectionValue[] {
  return list.filter((v) => v.optionId !== optionId);
}

export function SpineScreeningPanel({
  disabled,
  ledgerRegion = "LS Spine",
  billed,
}: {
  disabled?: boolean;
  /** Study Tab that owns the ledger rows. */
  ledgerRegion?: string;
  /** Billed exam code/name, used only to propose default roles. */
  billed?: BilledStudyInput;
}) {
  const screening = useWorkspace((s) => s.screening);
  const sequences = useWorkspace((s) => s.sequencesAvailable);
  const numbering = useWorkspace((s) => s.lumbarNumbering);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);

  const billingMatch = useMemo(() => resolveScreeningRoles(billed ?? {}), [billed]);
  const performed = performedScreeningRegions(screening);
  const built = useMemo(
    () =>
      Object.fromEntries(
        performed.map((region) => [
          region,
          buildScreeningRegionBundle({
            region,
            schema: SCREENING_SCHEMAS[region],
            state: screening[region],
            sequences,
            numbering,
          }),
        ]),
      ) as Partial<Record<SpineScreeningRegion, ReturnType<typeof buildScreeningRegionBundle>>>,
    [performed, screening, sequences, numbering],
  );
  const composed = useMemo(() => composeScreeningFindings(screening, SCREENING_SCHEMAS, built), [screening, built]);
  const conflicts = roleConflict(screening);
  const banner = numberingBanner(numbering);

  const activeBundles = useMemo(() => {
    const out = new Set<string>();
    patches.forEach((p) => {
      const b = p.observation?.bundleId;
      if (b && !p.stale) out.add(b);
    });
    return out;
  }, [patches]);

  /**
   * Ledger sync. `screeningLedgerBundles` is the whole truth for screening
   * prose: anything it no longer plans is removed, and the changed region plus
   * the once-only limitation row are re-applied. No parallel screening state.
   */
  const syncLedger = (next: ScreeningState, changed: SpineScreeningRegion) => {
    const ws = useWorkspace.getState();
    const plan = screeningLedgerBundles({
      state: next,
      schemas: SCREENING_SCHEMAS,
      sequences,
      numbering,
      ledgerRegion,
    });
    const planned = new Map(plan.map((b) => [b.bundleId, b] as const));
    const changedBundleId = screeningRegionBundleId(changed);
    const live = () => {
      const ids = new Set<string>();
      ws.appliedPathologyPatches.forEach((p) => {
        const b = p.observation?.bundleId;
        if (b && !p.stale) ids.add(b);
      });
      return ids;
    };
    [...live()]
      .filter((id) => (id.startsWith(SCREENING_BUNDLE_PREFIX) && !planned.has(id)) || id === changedBundleId)
      .forEach((id) => ws.removeMacroBundle(id));
    const afterRemoval = live();
    [changedBundleId, SCREENING_LIMITATION_BUNDLE_ID].forEach((id) => {
      const bundle = planned.get(id);
      if (!bundle || afterRemoval.has(id)) return;
      ws.applyMacroBundle({ bundleId: bundle.bundleId, observations: bundle.observations });
    });
  };

  const patchRegion = (region: SpineScreeningRegion, patch: Partial<ScreeningState[SpineScreeningRegion]>) => {
    const ws = useWorkspace.getState();
    const prev = ws.screening[region];
    const nextRegion = { ...prev, ...patch };
    if (patch.role && patch.performed === undefined) {
      nextRegion.performed = patch.role !== "absent";
    }
    const next: ScreeningState = { ...ws.screening, [region]: nextRegion };
    ws.setScreeningRegion(region, patch);
    syncLedger(next, region);
  };

  const setSelection = (
    region: SpineScreeningRegion,
    sectionKey: string,
    value: ScreeningSelectionValue | null,
    optionId: string,
    multi: boolean,
  ) => {
    const current = screening[region].selections[sectionKey] ?? [];
    const nextList = value === null
      ? without(current, optionId)
      : multi
        ? [...without(current, optionId), value]
        : [value];
    patchRegion(region, {
      selections: { ...screening[region].selections, [sectionKey]: nextList.filter(Boolean) },
    });
  };

  return (
    <div
      className="rounded-md border border-cyan-200/80 bg-cyan-50/30 px-2 py-2 space-y-2"
      data-testid="spine-screening-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-900">
          Spine screening
          {composed.groupingLabel ? ` — ${composed.groupingLabel}` : ""}
        </span>
        <span className="text-[8px] text-muted-foreground">
          Limited screening modules · coarse by design · never a dedicated substitute
        </span>
      </div>

      {/* Coverage state — derived, always overridable (spec §35). */}
      <div className="flex flex-wrap items-center gap-1" data-testid="screening-coverage-bar">
        {COVERAGE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => useWorkspace.getState().setSequencesAvailable({ [key]: !sequences[key] })}
            data-testid={`screening-coverage-${key}`}
            title="Click to override what this examination actually included"
            className={[
              "rounded border px-1 py-0.5 text-[8px] font-semibold",
              sequences[key]
                ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                : "border-slate-300 bg-white text-slate-400 line-through",
            ].join(" ")}
          >
            {SPINE_SEQUENCE_LABELS[key]}
          </button>
        ))}
      </div>

      {billingMatch.matchedKey ? (
        <p className="text-[8px] text-cyan-800" data-testid="screening-billing-match">
          Billing &ldquo;{billingMatch.matchedLabel}&rdquo; → {screeningRolesSummary(billingMatch.roles)}.
          Override any role below — a billing label never asserts a performed sequence.
          <button
            type="button"
            disabled={disabled}
            onClick={() => useWorkspace.getState().replaceScreeningRoles(billingMatch.roles)}
            data-testid="screening-reapply-billing-roles"
            className="ml-1 underline font-semibold"
          >
            re-derive from billing
          </button>
        </p>
      ) : null}

      {banner ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[8px] font-semibold text-amber-900" data-testid="screening-numbering-banner">
          {banner}
        </p>
      ) : null}

      {conflicts.map((warning) => (
        <p key={warning} className="text-[8px] text-red-700" data-testid="screening-role-conflict">
          {warning}
        </p>
      ))}

      {SPINE_SCREENING_REGIONS.map((region) => {
        const schema = SCREENING_SCHEMAS[region];
        const state = screening[region];
        if (state.role === "absent" && !state.performed) {
          return (
            <details key={region} className="rounded border border-slate-200 bg-white/60 px-1.5 py-1" data-testid={`screening-region-collapsed-${region}`}>
              <summary className="text-[9px] font-semibold uppercase text-slate-500">{schema.label} — not performed</summary>
              <select
                className="mt-1 h-6 rounded border border-slate-200 px-1 text-[9px]"
                value={state.role}
                disabled={disabled}
                data-testid={`screening-role-${region}`}
                onChange={(e) => patchRegion(region, { role: e.target.value as RegionRole })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </details>
          );
        }
        const result = built[region];
        const selections = state.selections;
        return (
          <div
            key={region}
            className="rounded border border-cyan-100 bg-white/70 p-1.5 space-y-1.5"
            data-testid={`screening-region-${region}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-[9px] font-bold uppercase text-cyan-900">{schema.label}</span>
              <div className="flex items-center gap-1">
                <select
                  className="h-5 rounded border border-slate-200 px-1 text-[8px]"
                  value={state.role}
                  disabled={disabled}
                  data-testid={`screening-role-${region}`}
                  onChange={(e) => patchRegion(region, { role: e.target.value as RegionRole })}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={disabled || !isScreeningRole(state.role)}
                  title={isScreeningRole(state.role) ? "One-click normal screening baseline" : "This region is the dedicated primary study — use its own canvas"}
                  onClick={() => patchRegion(region, { selections: screeningPresetSelections(schema), significance: {} })}
                  data-testid={`screening-normal-preset-${region}`}
                  className="h-5 rounded border border-amber-400 bg-amber-50 px-1 text-[8px] font-semibold text-amber-900 disabled:opacity-40"
                >
                  ★ {schema.normalPreset.label}
                </button>
              </div>
            </div>

            {schema.sections.map((section) => {
              const chosen = selections[section.key] ?? [];
              return (
                <div key={section.key} className="space-y-0.5" data-testid={`screening-section-${region}-${section.key}`}>
                  <div className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{section.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {section.options.map((option) => {
                      const picked = chosen.find((v) => v.optionId === option.id) ?? null;
                      const gate = screeningOptionAvailability(option, sequences);
                      const missing = gate.missing.join(" + ");
                      return (
                        <span key={option.id} className="contents">
                          <button
                            type="button"
                            disabled={disabled || (!picked && !gate.available)}
                            onClick={() => setSelection(region, section.key, picked ? null : { optionId: option.id }, option.id, Boolean(section.multi))}
                            title={gate.available ? option.prose ?? `${section.label}: ${option.label}` : `Gated — this study has no ${missing}`}
                            data-testid={`screening-option-${region}-${section.key}-${option.id}`}
                            className={[
                              "rounded border px-1.5 py-0.5 text-[9px] text-left",
                              picked
                                ? "border-cyan-600 bg-cyan-600 text-white"
                                : gate.available
                                  ? "border-slate-300 bg-white text-slate-800 hover:border-cyan-400"
                                  : "border-slate-200 bg-slate-50 text-slate-400 line-through",
                            ].join(" ")}
                          >
                            {option.label}
                            {picked ? " ✓" : ""}
                          </button>
                          {picked && wants(option, "{level}") ? (
                            <select
                              className="h-5 rounded border border-cyan-300 px-1 text-[8px]"
                              value={picked.level ?? ""}
                              disabled={disabled}
                              data-testid={`screening-level-${region}-${section.key}-${option.id}`}
                              onChange={(e) => setSelection(region, section.key, { ...picked, level: e.target.value }, option.id, Boolean(section.multi))}
                            >
                              <option value="">{option.levelRequired ? "level…" : "no level"}</option>
                              {availableScreeningLevels(option, schema, numbering).map((lvl) => (
                                <option key={lvl} value={lvl}>{lvl}</option>
                              ))}
                            </select>
                          ) : null}
                          {picked && wants(option, "{side}") ? (
                            <select
                              className="h-5 rounded border border-cyan-300 px-1 text-[8px]"
                              value={picked.side ?? ""}
                              disabled={disabled}
                              data-testid={`screening-side-${region}-${section.key}-${option.id}`}
                              onChange={(e) => setSelection(region, section.key, { ...picked, side: (e.target.value || undefined) as ScreeningSelectionValue["side"] }, option.id, Boolean(section.multi))}
                            >
                              <option value="">side…</option>
                              <option value="left">left</option>
                              <option value="right">right</option>
                              <option value="bilateral">bilateral</option>
                            </select>
                          ) : null}
                          {picked && wants(option, "{mm}") ? (
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              className="h-5 w-12 rounded border border-cyan-300 px-1 text-[8px]"
                              value={picked.mm ?? ""}
                              disabled={disabled}
                              data-testid={`screening-mm-${region}-${section.key}-${option.id}`}
                              onChange={(e) => setSelection(region, section.key, { ...picked, mm: e.target.value === "" ? undefined : Number(e.target.value) }, option.id, Boolean(section.multi))}
                            />
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                  {chosen.map((value) => {
                    const option = section.options.find((o) => o.id === value.optionId);
                    if (!option) return null;
                    return (
                      <label key={value.optionId} className="flex items-center gap-1 text-[8px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={screeningOptionSignificant(option, state)}
                          disabled={disabled}
                          data-testid={`screening-significant-${region}-${section.key}-${option.id}`}
                          onChange={(e) => patchRegion(region, {
                            significance: { ...state.significance, [option.id]: e.target.checked },
                          })}
                        />
                        promote &ldquo;{option.label}&rdquo; to the Impression
                      </label>
                    );
                  })}
                </div>
              );
            })}

            <label className="flex items-center gap-1 text-[8px] text-slate-600">
              <input
                type="checkbox"
                checked={state.recommendationSelected}
                disabled={disabled}
                data-testid={`screening-recommendation-${region}`}
                onChange={(e) => patchRegion(region, { recommendationSelected: e.target.checked })}
              />
              {schema.recommendation}
            </label>

            {result && result.notices.length > 0 ? (
              <p className="text-[8px] text-amber-800" data-testid={`screening-notices-${region}`}>
                Downgraded to limitation wording: {result.notices.map((n) => n.sectionKey).join(", ")} — this study
                cannot show that detail.
              </p>
            ) : null}
          </div>
        );
      })}

      {composed.limitation ? (
        <p className="text-[8px] font-semibold uppercase leading-tight text-slate-500" data-testid="screening-limitation-preview">
          {composed.limitation}
          <span className="ml-1 font-normal normal-case text-slate-400">
            (emitted once for the report{activeBundles.has(SCREENING_LIMITATION_BUNDLE_ID) ? " · in ledger" : ""})
          </span>
        </p>
      ) : null}
    </div>
  );
}
