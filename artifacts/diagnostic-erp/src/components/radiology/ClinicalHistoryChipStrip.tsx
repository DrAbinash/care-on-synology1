/**
 * Server-backed Clinical History chips for Reporting Workspace Section 2.
 *
 * Chips belong to a Study Tab via study_tab_id (authoritative). studyType is
 * denormalized for display/legacy. Clicking merges into the single
 * clinicalHistory field; toggle-off removes only an exact prior contribution.
 * Laterality uses `{side}` + existing fillTemplate.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Save, X } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { QuickClinicalHistoryChip, QuickStudyTab } from "@/components/radiology/QuickFindingsPanel";
import {
  hasHistoryChipContribution,
  historyTemplateNeedsSide,
  toggleHistoryChipContribution,
  type Side,
} from "@/lib/clinicalHistoryText";
import { clinicalHistoryChipsForStudyTab } from "@/lib/pickQuickProtocol";

type ChipDraft = {
  id?: number;
  studyType: string;
  displayLabel: string;
  insertedText: string;
  sortOrder: number;
  isActive: boolean;
  supportsLaterality: boolean;
};

function toDraft(chip: QuickClinicalHistoryChip | null, studyType: string): ChipDraft {
  if (!chip) {
    return {
      studyType,
      displayLabel: "",
      insertedText: "",
      sortOrder: 0,
      isActive: true,
      supportsLaterality: false,
    };
  }
  return {
    id: chip.id,
    studyType: chip.studyType,
    displayLabel: chip.displayLabel,
    insertedText: chip.insertedText,
    sortOrder: chip.sortOrder,
    isActive: chip.isActive,
    supportsLaterality: historyTemplateNeedsSide(chip.insertedText),
  };
}

function withLateralityFlag(draft: ChipDraft): ChipDraft {
  let inserted = draft.insertedText.trim() || draft.displayLabel.trim();
  const needs = historyTemplateNeedsSide(inserted);
  if (draft.supportsLaterality && !needs) {
    // Prefer a natural "{side} …" lead-in when enabling laterality.
    inserted = inserted.replace(/^(the\s+)?/i, "{side} ");
  }
  if (!draft.supportsLaterality && needs) {
    inserted = inserted.replace(/\{side\}\s*/gi, "").replace(/\s{2,}/g, " ").trim();
  }
  return { ...draft, insertedText: inserted };
}

export default function ClinicalHistoryChipStrip({
  chips,
  studyTabs,
  selectedStudyTabId,
  selectedStudyTabName,
  clinicalHistoryText,
  onClinicalHistoryChange,
  isOwner,
  disabled,
}: {
  /** Full clinic catalog (all Study Tabs); filtering is by selected tab. */
  chips: QuickClinicalHistoryChip[];
  studyTabs: Pick<QuickStudyTab, "id" | "name">[];
  /** Canonical Study Tab id from Section 1 (null when unresolved). */
  selectedStudyTabId: number | null;
  selectedStudyTabName: string | null;
  clinicalHistoryText: string;
  onClinicalHistoryChange: (next: string) => void;
  isOwner: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ChipDraft | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [pendingSideChipId, setPendingSideChipId] = useState<number | null>(null);

  const selectedTab = useMemo(() => {
    if (selectedStudyTabId != null) {
      const byId = studyTabs.find((t) => t.id === selectedStudyTabId);
      if (byId) return byId;
    }
    if (selectedStudyTabName) {
      return studyTabs.find((t) => t.name === selectedStudyTabName) ?? null;
    }
    return null;
  }, [studyTabs, selectedStudyTabId, selectedStudyTabName]);

  const catalogStudyType = selectedTab?.name ?? selectedStudyTabName ?? null;

  const { matched: visible, unresolvedLegacy } = useMemo(() => {
    if (selectedStudyTabId == null && !catalogStudyType) {
      return { matched: [] as QuickClinicalHistoryChip[], unresolvedLegacy: [] as QuickClinicalHistoryChip[] };
    }
    const result = clinicalHistoryChipsForStudyTab(chips, selectedStudyTabId, catalogStudyType);
    return {
      matched: result.matched
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel)),
      unresolvedLegacy: result.unresolvedLegacy,
    };
  }, [chips, selectedStudyTabId, catalogStudyType]);

  const saveMut = useMutation({
    mutationFn: (draft: ChipDraft) => {
      const byName = studyTabs.find((t) => t.name === draft.studyType.trim());
      const studyTabId = selectedStudyTabId ?? byName?.id ?? undefined;
      const body = {
        studyTabId,
        studyType: draft.studyType.trim(),
        displayLabel: draft.displayLabel.trim(),
        insertedText: draft.insertedText.trim() || draft.displayLabel.trim(),
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      };
      return draft.id
        ? api.patch(`/api/radiology/quick-select/clinical-history/${draft.id}`, body)
        : api.post("/api/radiology/quick-select/clinical-history", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setEditing(null);
      toast({ title: "Clinical history choice saved" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save history choice",
        description: err instanceof Error ? err.message : "Admin permission may be required.",
        variant: "destructive",
      });
    },
  });

  const deactivateMut = useMutation({
    mutationFn: (chip: QuickClinicalHistoryChip) =>
      api.patch(`/api/radiology/quick-select/clinical-history/${chip.id}`, { isActive: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      toast({ title: "History choice deactivated" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not deactivate",
        description: err instanceof Error ? err.message : "Admin permission may be required.",
        variant: "destructive",
      });
    },
  });

  const openNew = () => {
    if (selectedStudyTabId == null || !catalogStudyType) {
      toast({
        title: "Select a Study / Region first",
        description: "History choices belong to the current Study Tab.",
        variant: "destructive",
      });
      return;
    }
    setManageOpen(true);
    setEditing(toDraft(null, catalogStudyType));
  };

  const openEdit = (chip: QuickClinicalHistoryChip) => {
    setManageOpen(true);
    setEditing(toDraft(chip, chip.studyType));
  };

  const applyChip = (chip: QuickClinicalHistoryChip, side: Side | "" = "") => {
    const result = toggleHistoryChipContribution(clinicalHistoryText, chip.insertedText, side);
    if (result.needsSide) {
      setPendingSideChipId(chip.id);
      return;
    }
    setPendingSideChipId(null);
    if (result.next !== clinicalHistoryText) onClinicalHistoryChange(result.next);
  };

  return (
    <div className="space-y-1.5" data-testid="clinical-history-chips">
      <div className="flex flex-wrap gap-1 items-center" data-testid="clinical-history-chip-row">
        {!catalogStudyType ? (
          <span className="text-[10px] text-muted-foreground" data-testid="clinical-history-chips-empty-region">
            Select a Study / Region to show history choices
          </span>
        ) : visible.length === 0 ? (
          <span className="text-[10px] text-muted-foreground" data-testid="clinical-history-chips-empty">
            No history choices for {catalogStudyType} yet
          </span>
        ) : (
          visible.map((chip) => {
            const active = hasHistoryChipContribution(clinicalHistoryText, chip.insertedText);
            const needsSide = historyTemplateNeedsSide(chip.insertedText);
            return (
              <span key={chip.id} className="inline-flex flex-col items-stretch max-w-[14rem]">
                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`history-chip-${chip.id}`}
                  data-study-tab-id={chip.studyTabId ?? selectedTab?.id ?? undefined}
                  data-study-type={chip.studyType}
                  data-legacy={!chip.studyTabId ? "true" : "false"}
                  onClick={() => applyChip(chip)}
                  title={chip.insertedText}
                  aria-pressed={active}
                  className={[
                    "truncate rounded border px-2 py-1 text-[10px] font-bold shadow-sm transition-all",
                    active
                      ? "border-teal-600 bg-gradient-to-br from-teal-500 to-cyan-600 text-white"
                      : "border-teal-200 bg-gradient-to-b from-teal-50 to-cyan-50/80 text-teal-900 hover:border-teal-400",
                    disabled ? "opacity-60" : "",
                  ].join(" ")}
                >
                  {chip.displayLabel}{needsSide ? " · side" : ""}
                </button>
                {pendingSideChipId === chip.id && !disabled ? (
                  <div className="mt-0.5 flex gap-0.5" data-testid={`history-chip-side-${chip.id}`}>
                    {(["right", "left", "bilateral"] as Side[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="rounded border px-1.5 py-0.5 text-[9px] font-semibold capitalize hover:bg-muted"
                        onClick={() => applyChip(chip, s)}
                      >
                        {s === "bilateral" ? "Bilat" : s}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="rounded px-1 text-[9px] text-muted-foreground"
                      onClick={() => setPendingSideChipId(null)}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </span>
            );
          })
        )}

        {isOwner && !disabled ? (
          <>
            <button
              type="button"
              data-testid="history-add-chip"
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-300/80 px-2 py-1 text-[10px] font-semibold text-teal-800 hover:border-teal-500 hover:bg-teal-50"
              onClick={openNew}
              title="Add a reusable history choice for this Study Tab"
            >
              <Plus size={10} /> Add
            </button>
            <button
              type="button"
              data-testid="history-edit-chips"
              className="inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 py-1 text-[10px] text-muted-foreground hover:border-teal-400 hover:text-teal-800"
              onClick={() => {
                setManageOpen((v) => !v);
                setEditing(null);
              }}
              title="Edit history choices for this Study Tab"
            >
              <Pencil size={10} /> Edit
            </button>
          </>
        ) : null}
      </div>

      {manageOpen && isOwner && !disabled && (
        <div className="rounded-md border bg-card p-2 space-y-2 shadow-sm" data-testid="history-chip-manager">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              History choices for Study Tab{" "}
              <strong className="text-foreground">{catalogStudyType ?? "—"}</strong>
              {selectedTab ? ` (id ${selectedTab.id})` : ""} — linked by Study Tab ID.
              {unresolvedLegacy.length > 0 ? ` · ${unresolvedLegacy.length} legacy unmatched by name` : ""}
            </p>
            <button type="button" className="p-1 text-muted-foreground" onClick={() => { setManageOpen(false); setEditing(null); }} aria-label="Close">
              <X size={12} />
            </button>
          </div>

          {visible.length > 0 && !editing ? (
            <ul className="space-y-1 max-h-28 overflow-y-auto">
              {visible.map((chip) => (
                <li key={chip.id} className="flex items-center gap-1 text-[10px] rounded border px-1.5 py-1">
                  <span className="flex-1 truncate font-medium">{chip.displayLabel}</span>
                  <span className="text-muted-foreground truncate max-w-[40%]">{chip.insertedText}</span>
                  <button type="button" className="underline" onClick={() => openEdit(chip)}>Edit</button>
                  <button
                    type="button"
                    className="text-destructive underline"
                    onClick={() => deactivateMut.mutate(chip)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {editing && (
            <div className="space-y-2 rounded border bg-muted/20 p-2" data-testid="history-chip-editor">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wide">Study Tab</Label>
                  <select
                    className="mt-0.5 h-7 w-full rounded border bg-background px-1.5 text-xs"
                    value={editing.studyType}
                    onChange={(e) => setEditing({ ...editing, studyType: e.target.value })}
                    data-testid="history-chip-study-type"
                  >
                    {studyTabs.map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide">Chip label</Label>
                  <Input
                    value={editing.displayLabel}
                    onChange={(e) => setEditing({ ...editing, displayLabel: e.target.value })}
                    className="h-7 text-xs mt-0.5"
                    placeholder="Neck pain"
                    autoFocus
                    data-testid="history-chip-label"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wide">Inserted text</Label>
                <Textarea
                  value={editing.insertedText}
                  onChange={(e) => setEditing({
                    ...editing,
                    insertedText: e.target.value,
                    supportsLaterality: historyTemplateNeedsSide(e.target.value),
                  })}
                  className="min-h-[44px] text-xs mt-0.5"
                  placeholder="Neck pain."
                  data-testid="history-chip-inserted"
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-[10px]">
                <input
                  type="checkbox"
                  checked={editing.supportsLaterality}
                  onChange={(e) => setEditing(withLateralityFlag({ ...editing, supportsLaterality: e.target.checked }))}
                  data-testid="history-chip-laterality"
                />
                Supports laterality ({"{side}"} in inserted text)
              </label>
              <div className="flex justify-end gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={!editing.studyType.trim() || !editing.displayLabel.trim() || saveMut.isPending}
                  data-testid="history-chip-save"
                  onClick={() => {
                    const next = withLateralityFlag(editing);
                    const label = next.displayLabel.trim();
                    saveMut.mutate({
                      ...next,
                      displayLabel: label,
                      insertedText: next.insertedText.trim() || label,
                    });
                  }}
                >
                  <Save size={12} className="mr-1" /> Save
                </Button>
              </div>
            </div>
          )}

          {!editing && catalogStudyType ? (
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={openNew}>
              <Plus size={11} className="mr-1" /> Add history choice
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
