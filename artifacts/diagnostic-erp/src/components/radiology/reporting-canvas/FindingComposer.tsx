/**
 * Compact Structured Finding Composer — progressive controls from the
 * Quick Findings catalog + region-aware dimensions. Commits only via
 * applyComposerFinding → applyPathologyOverlay (same-slot engine).
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { QuickFinding } from "@/components/radiology/QuickFindingsPanel";
import {
  buildComposerCatalog,
  emptyComposerDraft,
  findCatalogEntry,
  lateralityOptionsForEntry,
  levelOptionsForEntry,
  pendingFromComposerDraft,
  renderComposerPhrase,
  severityOptionsForEntry,
  visibleComposerControls,
  type FindingComposerDraft,
} from "@/lib/findingComposerModel";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type FindingComposerProps = {
  region: string;
  quickFindings: QuickFinding[];
  draft: FindingComposerDraft;
  onDraftChange: (d: FindingComposerDraft) => void;
  disabled?: boolean;
  /** Optional banner (e.g. "From dictation — review before adding"). */
  banner?: string | null;
  onApplied?: (status: "applied" | "pending" | "blocked") => void;
};

export default function FindingComposer({
  region,
  quickFindings,
  draft,
  onDraftChange,
  disabled = false,
  banner = null,
  onApplied,
}: FindingComposerProps) {
  const catalog = useMemo(
    () => buildComposerCatalog(quickFindings, region || draft.region),
    [quickFindings, region, draft.region],
  );
  const entry = findCatalogEntry(catalog, draft.catalogKey);
  const controls = visibleComposerControls(entry, region || draft.region);
  const levels = levelOptionsForEntry(entry, region || draft.region);
  const severities = severityOptionsForEntry(entry);
  const lateralities = lateralityOptionsForEntry(entry);

  const phrase = useMemo(
    () => (entry ? renderComposerPhrase(draft, entry) : null),
    [draft, entry],
  );

  // Keep region in sync with study context.
  useEffect(() => {
    if (region && draft.region !== region) {
      onDraftChange({ ...draft, region });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync region
  }, [region]);

  const set = (patch: Partial<FindingComposerDraft>) => onDraftChange({ ...draft, ...patch });

  const onFindingChange = (key: string) => {
    const next = findCatalogEntry(catalog, key);
    const vis = visibleComposerControls(next, region || draft.region);
    set({
      catalogKey: key,
      level: vis.level ? (draft.level || levels[0] || "") : "",
      severity: (vis.severity || vis.grade)
        ? (draft.severity || severityOptionsForEntry(next)[0] || "")
        : "",
      laterality: vis.laterality ? (draft.laterality || "") : "",
      includeInImpression: Boolean(next?.impressionText?.trim()) || draft.includeInImpression,
    });
  };

  const submit = () => {
    if (disabled || !entry || !phrase?.findings.trim()) return;
    const pending = pendingFromComposerDraft(draft, entry, phrase);
    const status = useWorkspace.getState().applyComposerFinding({
      ...pending,
      editingId: draft.editingId,
    });
    onApplied?.(status);
    if (status === "applied") {
      onDraftChange({
        ...emptyComposerDraft(region || draft.region),
        includeInImpression: false,
      });
    }
  };

  const editing = Boolean(draft.editingId);
  const canSubmit = Boolean(entry && phrase?.findings.trim()) && !disabled;

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50/80 p-2 space-y-1.5"
      data-testid="finding-composer"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
          {editing ? "Edit Finding" : "Finding Composer"}
        </div>
        {editing ? (
          <button
            type="button"
            className="text-[9px] text-slate-500 underline"
            data-testid="finding-composer-clear-edit"
            onClick={() => onDraftChange(emptyComposerDraft(region || draft.region))}
          >
            New
          </button>
        ) : null}
      </div>
      {banner ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] text-amber-900" data-testid="finding-composer-banner">
          {banner}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5 text-[9px] font-semibold text-slate-600">
          Finding
          <select
            className="h-7 rounded border border-slate-200 bg-white px-1 text-[11px]"
            data-testid="composer-finding"
            disabled={disabled}
            value={draft.catalogKey}
            onChange={(e) => onFindingChange(e.target.value)}
          >
            <option value="">Select…</option>
            {catalog.map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        </label>

        {controls.level ? (
          <label className="flex flex-col gap-0.5 text-[9px] font-semibold text-slate-600">
            Level
            <select
              className="h-7 rounded border border-slate-200 bg-white px-1 text-[11px]"
              data-testid="composer-level"
              disabled={disabled}
              value={draft.level}
              onChange={(e) => set({ level: e.target.value })}
            >
              <option value="">Select…</option>
              {levels.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        ) : null}

        {controls.severity || controls.grade ? (
          <label className="flex flex-col gap-0.5 text-[9px] font-semibold text-slate-600">
            {controls.grade ? "Grade" : "Severity"}
            <select
              className="h-7 rounded border border-slate-200 bg-white px-1 text-[11px]"
              data-testid="composer-severity"
              disabled={disabled}
              value={draft.severity}
              onChange={(e) => set({ severity: e.target.value })}
            >
              <option value="">Select…</option>
              {severities.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : null}

        {controls.laterality ? (
          <label className="flex flex-col gap-0.5 text-[9px] font-semibold text-slate-600">
            Laterality
            <select
              className="h-7 rounded border border-slate-200 bg-white px-1 text-[11px]"
              data-testid="composer-laterality"
              disabled={disabled}
              value={draft.laterality}
              onChange={(e) => set({ laterality: e.target.value })}
            >
              <option value="">—</option>
              {lateralities.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <label className="flex items-center gap-1.5 text-[10px] text-slate-700">
        <input
          type="checkbox"
          data-testid="composer-include-impression"
          disabled={disabled}
          checked={draft.includeInImpression}
          onChange={(e) => set({ includeInImpression: e.target.checked })}
        />
        Include in Impression
      </label>

      {phrase?.findings ? (
        <p className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-800" data-testid="composer-preview">
          {phrase.findings}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-7 text-[10px]"
          data-testid="composer-submit"
          disabled={!canSubmit}
          onClick={submit}
        >
          {editing ? "Update Finding" : "Add Finding"}
        </Button>
      </div>
    </div>
  );
}

/** Hook-friendly local draft state for the workspace page. */
export function useFindingComposerDraft(region: string) {
  const [draft, setDraft] = useState(() => emptyComposerDraft(region));
  useEffect(() => {
    setDraft((d) => (d.region === region ? d : { ...d, region }));
  }, [region]);
  return [draft, setDraft] as const;
}
