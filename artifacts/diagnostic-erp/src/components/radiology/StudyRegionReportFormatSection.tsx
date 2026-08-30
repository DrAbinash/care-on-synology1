/**
 * Section 1 — Study / Region (family → sub-region / Study Tab).
 *
 * Cascading picker: Region (family) → Sub-region / Study.
 * Whole-report Format is first-class in WholeReportFormatControl (main canvas)
 * and the right-rail picker — both reuse the same Zustand apply engine.
 * Catalog: server radiology_study_tabs only (via availableStudyTabs).
 * Quick: personal localStorage shortcuts by Study Tab ID (never a catalog).
 * + Add: creates one real Study Tab, configures children, selects + pins Quick.
 * Selection: dropdown and Quick both call onSelectRegion → selectPrimaryRegion.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Plus } from "lucide-react";
import { groupStudyTabsByFamily, studyTabFamily } from "@/lib/studyRegion";
import {
  type StudyTabRef,
  clearLegacyQuickRegionNames,
  migrateLegacyQuickNamesToIds,
  pinQuickTabId,
  readLastStudyFamily,
  readLegacyQuickRegionNames,
  readStoredQuickTabIds,
  resolveQuickStudyTabs,
  toggleQuickTabId,
  writeLastStudyFamily,
  writeStoredQuickTabIds,
} from "@/lib/workspaceRegionPrefs";
import { AddStudyRegionDialog } from "./AddStudyRegionDialog";

export type StudyRegionReportFormatSectionProps = {
  /** Server-backed Study Tabs (canonical catalog for this modality). */
  availableStudyTabs: StudyTabRef[];
  selectedRegion: string | null;
  autoDetectedRegion: string | null;
  regionOverridden: boolean;
  onSelectRegion: (region: string | null) => void;
  onResetAutoRegion: () => void;
  modality?: string | null;
  disabled?: boolean;
  testName?: string | null;
  /** Protocol still applies internally when region changes — metadata only. */
  activeProtocolName?: string | null;
  onReapplyDefaults?: () => void;
  canReapplyDefaults?: boolean;
};

export function StudyRegionReportFormatSection({
  availableStudyTabs,
  selectedRegion,
  autoDetectedRegion,
  regionOverridden,
  onSelectRegion,
  onResetAutoRegion,
  modality,
  disabled,
  testName,
  activeProtocolName,
  onReapplyDefaults,
  canReapplyDefaults,
}: StudyRegionReportFormatSectionProps) {
  const [quickIds, setQuickIds] = useState<number[]>(() => readStoredQuickTabIds());
  const [legacyMigrated, setLegacyMigrated] = useState(false);
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<string>("");

  const familyGroups = useMemo(
    () => groupStudyTabsByFamily(availableStudyTabs),
    [availableStudyTabs],
  );

  const familyOptions = useMemo(
    () => familyGroups.map((g) => g.family),
    [familyGroups],
  );

  const tabsInFamily = useMemo(() => {
    if (!selectedFamily) return [];
    return familyGroups.find((g) => g.family === selectedFamily)?.tabs ?? [];
  }, [familyGroups, selectedFamily]);

  // Sync family from external region (auto-detect / Quick / + Add). Persist last family.
  useEffect(() => {
    if (selectedRegion) {
      const fam = studyTabFamily(selectedRegion);
      if (familyOptions.includes(fam)) {
        setSelectedFamily(fam);
        writeLastStudyFamily(modality, fam);
        return;
      }
    }
    // No region yet — preselect persisted family only if it still exists for this modality.
    if (!selectedFamily) {
      const stored = readLastStudyFamily(modality);
      if (stored && familyOptions.includes(stored)) {
        setSelectedFamily(stored);
      }
    }
  }, [selectedRegion, availableStudyTabs, modality, familyOptions]); // eslint-disable-line react-hooks/exhaustive-deps -- selectedFamily intentional omit: do not fight manual family while region unchanged

  // Single-tab family → auto-select that Study Tab.
  useEffect(() => {
    if (!selectedFamily) return;
    if (tabsInFamily.length !== 1) return;
    const only = tabsInFamily[0];
    if (selectedRegion === only.name) return;
    // Only auto-select when current region is empty or outside this family.
    if (selectedRegion && studyTabFamily(selectedRegion) === selectedFamily) return;
    if (!selectedRegion || studyTabFamily(selectedRegion) !== selectedFamily) {
      onSelectRegion(only.name);
    }
  }, [selectedFamily, tabsInFamily, selectedRegion, onSelectRegion]);

  // One-time: convert legacy name-based Quick prefs → Study Tab IDs.
  useEffect(() => {
    if (legacyMigrated) return;
    if (availableStudyTabs.length === 0) return;
    const existing = readStoredQuickTabIds();
    if (existing.length > 0) {
      setLegacyMigrated(true);
      clearLegacyQuickRegionNames();
      return;
    }
    const legacyNames = readLegacyQuickRegionNames();
    if (legacyNames.length === 0) {
      setLegacyMigrated(true);
      clearLegacyQuickRegionNames();
      return;
    }
    const migrated = migrateLegacyQuickNamesToIds(availableStudyTabs, legacyNames);
    if (migrated.length > 0) setQuickIds(migrated);
    clearLegacyQuickRegionNames();
    setLegacyMigrated(true);
  }, [availableStudyTabs, legacyMigrated]);

  useEffect(() => {
    writeStoredQuickTabIds(quickIds);
  }, [quickIds]);

  const quickTabs = useMemo(
    () => resolveQuickStudyTabs(availableStudyTabs, quickIds),
    [availableStudyTabs, quickIds],
  );

  const handleFamilyChange = (family: string) => {
    setSelectedFamily(family);
    if (family) writeLastStudyFamily(modality, family);
    // Choosing a family only filters dropdown 2 — do not call onSelectRegion yet
    // unless the family has exactly one tab (handled by effect above).
    if (selectedRegion && family && studyTabFamily(selectedRegion) !== family) {
      // Clear stale sub-region so the user must pick within the new family.
      onSelectRegion(null);
    }
  };

  const handleRegionCreated = (tab: StudyTabRef) => {
    setQuickIds((prev) => pinQuickTabId(prev, tab.id));
    setSelectedFamily(studyTabFamily(tab.name));
    onSelectRegion(tab.name);
  };

  return (
    <div className="space-y-2" data-testid="study-region-report-format-section">
      <div
        className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-emerald-200/60 bg-gradient-to-r from-emerald-50/40 via-card to-emerald-50/20 px-2.5 py-2 text-[10px] shadow-sm"
        data-testid="study-setup-strip"
      >
        <label className="inline-flex flex-col gap-0.5 min-w-[8.5rem]">
          <span className="font-semibold uppercase tracking-wider text-emerald-700/80">Region</span>
          <select
            className="h-7 min-w-[9rem] max-w-[14rem] rounded border bg-background px-1.5 text-[11px] font-medium"
            value={selectedFamily}
            disabled={disabled || familyOptions.length === 0}
            onChange={(e) => handleFamilyChange(e.target.value)}
            data-testid="study-region-family-select"
            aria-label="Region family"
            title="Body-part family (Brain, Spine, …) — filters Sub-region / Study"
          >
            <option value="">
              {familyOptions.length === 0 ? "Add a Study Tab…" : "Select region…"}
            </option>
            {familyOptions.map((fam) => (
              <option key={fam} value={fam}>{fam}</option>
            ))}
          </select>
        </label>

        <label className="inline-flex flex-col gap-0.5 min-w-[10rem]">
          <span className="font-semibold uppercase tracking-wider text-emerald-700/80">Sub-region / Study</span>
          <select
            className="h-7 min-w-[11rem] max-w-[16rem] rounded border bg-background px-1.5 text-[11px] font-medium"
            value={selectedRegion ?? ""}
            disabled={disabled || !selectedFamily}
            onChange={(e) => onSelectRegion(e.target.value || null)}
            data-testid="study-region-select"
            aria-label="Sub-region / Study"
            title="Canonical Study Tab from clinic catalog (radiology_study_tabs)"
          >
            <option value="">
              {!selectedFamily
                ? "Select a region first…"
                : tabsInFamily.length === 0
                  ? "No studies in this region"
                  : "Select study / region…"}
            </option>
            {tabsInFamily.map((t) => (
              <option key={t.id} value={t.name} data-study-tab-id={t.id}>{t.name}</option>
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
        {quickTabs.length === 0 ? (
          <span className="text-[10px] text-muted-foreground" data-testid="study-region-quick-empty">
            No quick shortcuts yet — use the pencil to pin Study Tabs (unpin never deletes the tab)
          </span>
        ) : (
          quickTabs.map((t) => {
            const selected = selectedRegion === t.name;
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                data-testid={`study-region-quick-${t.id}`}
                data-study-tab-id={t.id}
                data-selected={selected ? "true" : "false"}
                title={`Select ${t.name} (same as Sub-region / Study dropdown)`}
                className={[
                  "h-7 px-2 text-[10px] rounded-md border font-medium transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground border-primary ring-2 ring-offset-1 ring-emerald-400"
                    : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                ].join(" ")}
                onClick={() => onSelectRegion(t.name)}
              >
                {t.name}
              </button>
            );
          })
        )}
        <button
          type="button"
          disabled={disabled || availableStudyTabs.length === 0}
          className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-emerald-400 hover:text-emerald-800"
          title="Choose which Study Tabs appear as Quick shortcuts (does not delete tabs)"
          data-testid="study-region-quick-edit"
          onClick={() => setQuickEditOpen((v) => !v)}
        >
          <Pencil size={10} /> Edit Quick
        </button>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed border-emerald-400/70 px-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
          title="Create a Study Tab in radiology_study_tabs (children optional)"
          data-testid="study-region-add-toggle"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {quickEditOpen && (
        <div
          className="rounded-md border border-border bg-card p-2 space-y-1.5 shadow-sm"
          data-testid="study-region-quick-editor"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              Pin Study Tabs as Quick shortcuts. Unticking only removes the shortcut — the Study Tab stays in the catalog.
            </p>
            <button type="button" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setQuickEditOpen(false)} aria-label="Close quick editor">
              ×
            </button>
          </div>
          {availableStudyTabs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Create a Study Tab with + Add first.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
              {availableStudyTabs.map((t) => {
                const on = quickIds.includes(t.id);
                return (
                  <label
                    key={t.id}
                    className="inline-flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] cursor-pointer hover:bg-muted/60"
                    data-testid={`study-region-quick-pick-${t.id}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => setQuickIds((prev) => toggleQuickTabId(prev, t.id))}
                    />
                    <span className="truncate">{t.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
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
