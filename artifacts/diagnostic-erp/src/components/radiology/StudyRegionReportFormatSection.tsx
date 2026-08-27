/**
 * Section 1 — Study / Region + Whole Report Format.
 *
 * Single source of truth: onSelectRegion (studySetup.selectPrimaryRegion).
 * Quick buttons are a pencil-editable subset of the Study / Region dropdown —
 * never a hard-coded region list.
 * "+ Add" opens AddStudyRegionDialog (server Study Tab + children/ownership).
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Plus } from "lucide-react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { lookupFormatsForPicker } from "@/lib/zai-workspace/report-formats-library";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  QUICK_REGIONS_STORAGE_KEY,
  mergeRegionCatalog,
  readStoredRegionList,
  resolveQuickRegions,
  toggleQuickRegionPick,
  writeStoredRegionList,
} from "@/lib/workspaceRegionPrefs";
import { AddStudyRegionDialog } from "./AddStudyRegionDialog";

export type StudyRegionReportFormatSectionProps = {
  availableRegions: string[];
  selectedRegion: string | null;
  autoDetectedRegion: string | null;
  regionOverridden: boolean;
  onSelectRegion: (region: string | null) => void;
  onResetAutoRegion: () => void;
  reportingContext: ReportingStudyContext;
  modality?: string | null;
  bodyPartFallback?: string | null;
  studyDescription?: string | null;
  disabled?: boolean;
  testName?: string | null;
  /** Protocol still applies internally when region changes — metadata only. */
  activeProtocolName?: string | null;
  onReapplyDefaults?: () => void;
  canReapplyDefaults?: boolean;
};

export function StudyRegionReportFormatSection({
  availableRegions,
  selectedRegion,
  autoDetectedRegion,
  regionOverridden,
  onSelectRegion,
  onResetAutoRegion,
  reportingContext,
  modality,
  bodyPartFallback,
  studyDescription,
  disabled,
  testName,
  activeProtocolName,
  onReapplyDefaults,
  canReapplyDefaults,
}: StudyRegionReportFormatSectionProps) {
  const reportFormats = useWorkspaceSelector((s) => s.reportFormats);
  const appliedFormatReportTitle = useWorkspaceSelector((s) => s.appliedFormatReportTitle);
  const applyFormatById = useWorkspace((s) => s.applyFormatById);

  const [quickPicks, setQuickPicks] = useState<string[]>(() =>
    readStoredRegionList(QUICK_REGIONS_STORAGE_KEY),
  );
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    writeStoredRegionList(QUICK_REGIONS_STORAGE_KEY, quickPicks);
  }, [quickPicks]);

  const catalog = useMemo(
    () => mergeRegionCatalog(availableRegions, [], selectedRegion),
    [availableRegions, selectedRegion],
  );

  const quickRegions = useMemo(
    () => resolveQuickRegions(catalog, quickPicks),
    [catalog, quickPicks],
  );

  const formatLookup = useMemo(
    () =>
      lookupFormatsForPicker(reportFormats, (modality as "MR" | "CT" | "US" | "XR" | "MG" | undefined) ?? undefined, reportingContext, {
        protocolName: reportingContext.protocolName,
        studyDescription: reportingContext.studyDescription ?? studyDescription ?? undefined,
        bodyPartFallback: bodyPartFallback ?? selectedRegion,
      }),
    [reportFormats, modality, reportingContext, studyDescription, bodyPartFallback, selectedRegion],
  );

  const formats = formatLookup.formats;

  const handleRegionCreated = (regionName: string) => {
    setQuickPicks((prev) =>
      prev.some((r) => r.toLowerCase() === regionName.toLowerCase()) ? prev : [...prev, regionName],
    );
    onSelectRegion(regionName);
  };

  return (
    <div className="space-y-2" data-testid="study-region-report-format-section">
      <div
        className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-emerald-200/60 bg-gradient-to-r from-emerald-50/40 via-card to-emerald-50/20 px-2.5 py-2 text-[10px] shadow-sm"
        data-testid="study-setup-strip"
      >
        <label className="inline-flex flex-col gap-0.5 min-w-[10rem]">
          <span className="font-semibold uppercase tracking-wider text-emerald-700/80">Study / Region</span>
          <div className="flex items-center gap-1">
            <select
              className="h-7 min-w-[11rem] max-w-[16rem] rounded border bg-background px-1.5 text-[11px] font-medium"
              value={selectedRegion ?? ""}
              disabled={disabled}
              onChange={(e) => onSelectRegion(e.target.value || null)}
              data-testid="study-region-select"
              aria-label="Study / Region"
              title="Canonical study / region (single source of truth)"
            >
              <option value="">
                {catalog.length === 0 ? "Add a region…" : "Select study / region…"}
              </option>
              {catalog.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={disabled}
              className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed border-emerald-400/70 px-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
              title="Add a Study / Region to the clinic catalog (with children & ownership)"
              data-testid="study-region-add-toggle"
              onClick={() => setAddOpen(true)}
            >
              <Plus size={11} /> Add
            </button>
          </div>
        </label>

        <label className="inline-flex flex-col gap-0.5 min-w-[12rem] flex-1">
          <span className="font-semibold uppercase tracking-wider text-emerald-700/80">Report Format</span>
          <select
            className="h-7 w-full min-w-[14rem] max-w-[28rem] rounded border bg-background px-1.5 text-[11px] font-medium"
            value=""
            disabled={disabled || !selectedRegion || formats.length === 0}
            onChange={(e) => {
              const id = e.target.value;
              if (id) applyFormatById(id);
              e.currentTarget.value = "";
            }}
            data-testid="whole-report-format-select"
            aria-label="Whole report format"
            title={!selectedRegion
              ? "Select a Study / Region first"
              : formats.length === 0
                ? "No whole-report formats for this region"
                : "Apply technique + findings + impression (+ history / recommendation) from a saved format"}
          >
            <option value="">
              {!selectedRegion
                ? "Select region first…"
                : formats.length === 0
                  ? "No formats for this region"
                  : appliedFormatReportTitle
                    ? `Applied: ${appliedFormatReportTitle} — pick another…`
                    : `Report format (${formats.length})…`}
            </option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.reportTitle ? ` · ${f.reportTitle}` : ""}
              </option>
            ))}
          </select>
        </label>

        {testName ? (
          <span className="text-muted-foreground pb-1" title="Detected / applied study title">
            Test: <strong className="text-foreground">{testName}</strong>
          </span>
        ) : null}

        {activeProtocolName ? (
          <span
            className="text-muted-foreground pb-1"
            data-testid="protocol-metadata"
            title="Protocol still auto-applies with region; not a separate study selector"
          >
            Protocol: <strong className="text-foreground font-medium">{activeProtocolName}</strong>
          </span>
        ) : null}

        {regionOverridden && (
          <button
            type="button"
            className="text-amber-700 underline text-[10px] pb-1"
            title={`Auto-detected: ${autoDetectedRegion ?? "none"}`}
            onClick={onResetAutoRegion}
            data-testid="region-reset-auto"
          >
            reset to auto
          </button>
        )}

        {onReapplyDefaults && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[10px] ml-auto"
            disabled={disabled || !canReapplyDefaults}
            onClick={onReapplyDefaults}
            data-testid="reapply-defaults"
          >
            Re-apply defaults
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-0.5" data-testid="study-region-quick">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-0.5">Quick</span>
        {quickRegions.length === 0 ? (
          <span className="text-[10px] text-muted-foreground" data-testid="study-region-quick-empty">
            No quick regions yet — use the pencil to pick from the Study / Region list
          </span>
        ) : (
          quickRegions.map((r) => {
            const selected = selectedRegion === r;
            return (
              <button
                key={r}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                data-testid={`study-region-quick-${r}`}
                data-selected={selected ? "true" : "false"}
                title={`Select ${r} (same as Study / Region dropdown)`}
                className={[
                  "h-7 px-2 text-[10px] rounded-md border font-medium transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground border-primary ring-2 ring-offset-1 ring-emerald-400"
                    : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                ].join(" ")}
                onClick={() => onSelectRegion(r)}
              >
                {r}
              </button>
            );
          })
        )}
        <button
          type="button"
          disabled={disabled || catalog.length === 0}
          className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-emerald-400 hover:text-emerald-800"
          title="Edit which Study / Region values appear as quick buttons"
          data-testid="study-region-quick-edit"
          onClick={() => setQuickEditOpen((v) => !v)}
        >
          <Pencil size={10} /> Edit quick
        </button>
      </div>

      {quickEditOpen && (
        <div
          className="rounded-md border border-border bg-card p-2 space-y-1.5 shadow-sm"
          data-testid="study-region-quick-editor"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              Tick regions from the Study / Region dropdown to show as quick buttons. Same selection state.
            </p>
            <button type="button" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setQuickEditOpen(false)} aria-label="Close quick editor">
              ×
            </button>
          </div>
          {catalog.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Add a region to the dropdown first.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
              {catalog.map((r) => {
                const on = quickPicks.some((p) => p.toLowerCase() === r.toLowerCase());
                return (
                  <label
                    key={r}
                    className="inline-flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] cursor-pointer hover:bg-muted/60"
                    data-testid={`study-region-quick-pick-${r}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => setQuickPicks((prev) => toggleQuickRegionPick(prev, r))}
                    />
                    <span className="truncate">{r}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {formatLookup.scope === "modality" && selectedRegion && (
        <p className="text-[10px] text-amber-800 px-0.5" data-testid="format-scope-hint">
          Showing all {modality || "modality"} formats — region filter soft-matched.
        </p>
      )}

      <AddStudyRegionDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleRegionCreated}
        modalityHint={modality}
      />
    </div>
  );
}

/** Pure helper used by tests: quick + dropdown must resolve to the same region setter call. */
export function regionSelectionAction(
  nextRegion: string | null,
  selectPrimaryRegion: (region: string | null) => void,
): void {
  selectPrimaryRegion(nextRegion);
}
