/**
 * Server-backed clinical history chips in the Reporting Workspace History section.
 * Toggle inserts/removes phrases; + Add Title opens an inline pencil editor that
 * saves to /api/radiology/quick-select/clinical-history (admin/owner only).
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
import type { QuickClinicalHistoryChip } from "@/components/radiology/QuickFindingsPanel";
import { appendClinicalPhrase, hasPhrase, removeClinicalPhrase } from "@/lib/clinicalHistoryText";

type ChipDraft = {
  id?: number;
  studyType: string;
  displayLabel: string;
  insertedText: string;
  sortOrder: number;
  isActive: boolean;
};

export default function ClinicalHistoryChipStrip({
  chips,
  studyRegions,
  defaultStudyType,
  clinicalHistoryText,
  onClinicalHistoryChange,
  isOwner,
  disabled,
}: {
  chips: QuickClinicalHistoryChip[];
  studyRegions: string[];
  /** Used when no study region is picked yet (empty worklist / new chip). */
  defaultStudyType?: string;
  clinicalHistoryText: string;
  onClinicalHistoryChange: (next: string) => void;
  isOwner: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ChipDraft | null>(null);

  const visible = useMemo(
    () => chips.filter((c) => c.isActive && studyRegions.includes(c.studyType)),
    [chips, studyRegions],
  );

  const saveMut = useMutation({
    mutationFn: (draft: ChipDraft) =>
      draft.id
        ? api.patch(`/api/radiology/quick-select/clinical-history/${draft.id}`, draft)
        : api.post("/api/radiology/quick-select/clinical-history", draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setEditing(null);
      toast({ title: "Clinical history chip saved" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save chip",
        description: err instanceof Error ? err.message : "Admin permission may be required.",
        variant: "destructive",
      });
    },
  });

  const openNew = () => {
    const studyType = studyRegions[0] ?? defaultStudyType ?? "MRI Brain";
    setEditing({
      studyType,
      displayLabel: "",
      insertedText: "",
      sortOrder: 0,
      isActive: true,
    });
  };

  const openEdit = (chip: QuickClinicalHistoryChip) => {
    setEditing({
      id: chip.id,
      studyType: chip.studyType,
      displayLabel: chip.displayLabel,
      insertedText: chip.insertedText,
      sortOrder: chip.sortOrder,
      isActive: chip.isActive,
    });
  };

  return (
    <div className="space-y-1.5" data-testid="clinical-history-chip-strip">
      <div className="flex flex-wrap gap-1 items-center">
        {visible.map((chip) => {
          const active = hasPhrase(clinicalHistoryText, chip.insertedText);
          return (
            <span key={chip.id} className="inline-flex items-center max-w-[12rem]">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onClinicalHistoryChange(
                    active
                      ? removeClinicalPhrase(clinicalHistoryText, chip.insertedText)
                      : appendClinicalPhrase(clinicalHistoryText, chip.insertedText),
                  );
                }}
                title={chip.insertedText}
                aria-pressed={active}
                className={[
                  "truncate rounded-l border px-2 py-1 text-[10px] font-bold shadow-sm transition-all",
                  active
                    ? "border-teal-600 bg-gradient-to-br from-teal-500 to-cyan-600 text-white"
                    : "border-teal-200 bg-gradient-to-b from-teal-50 to-cyan-50/80 text-teal-900 hover:border-teal-400",
                  disabled ? "opacity-60" : "",
                ].join(" ")}
              >
                {chip.displayLabel}
              </button>
              {isOwner && !disabled ? (
                <button
                  type="button"
                  title="Edit chip"
                  data-testid={`history-chip-edit-${chip.id}`}
                  className={[
                    "rounded-r border border-l-0 px-1 py-1 text-teal-800",
                    active ? "border-teal-600 bg-teal-600 text-white" : "border-teal-200 bg-teal-50 hover:bg-teal-100",
                  ].join(" ")}
                  onClick={() => openEdit(chip)}
                >
                  <Pencil size={9} />
                </button>
              ) : null}
            </span>
          );
        })}
        {isOwner && !disabled ? (
          <button
            type="button"
            data-testid="history-add-title"
            className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-300/80 px-2 py-1 text-[10px] font-semibold text-teal-800 hover:border-teal-500 hover:bg-teal-50"
            onClick={openNew}
            title="Add a shared history chip for this study region"
          >
            <Plus size={10} /> Add Title
          </button>
        ) : null}
      </div>

      {editing && (
        <div className="rounded-lg border bg-background p-2 shadow-sm space-y-2" data-testid="history-chip-editor">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wide">Study / region</Label>
              <Input
                value={editing.studyType}
                onChange={(e) => setEditing({ ...editing, studyType: e.target.value })}
                className="h-7 text-xs mt-0.5"
                list="history-chip-regions"
              />
              <datalist id="history-chip-regions">
                {studyRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide">Display label (chip)</Label>
              <Input
                value={editing.displayLabel}
                onChange={(e) => setEditing({ ...editing, displayLabel: e.target.value })}
                className="h-7 text-xs mt-0.5"
                placeholder="Headache"
                autoFocus
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide">Inserted text (full phrase)</Label>
            <Textarea
              value={editing.insertedText}
              onChange={(e) => setEditing({ ...editing, insertedText: e.target.value })}
              className="min-h-[48px] text-xs mt-0.5"
              placeholder="Sudden onset weakness with suspected cerebrovascular event."
            />
          </div>
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setEditing(null)}>
              <X size={12} className="mr-1" /> Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[10px]"
              disabled={!editing.studyType.trim() || !editing.displayLabel.trim() || saveMut.isPending}
              onClick={() => {
                const label = editing.displayLabel.trim();
                const inserted = editing.insertedText.trim() || label;
                saveMut.mutate({
                  ...editing,
                  displayLabel: label,
                  insertedText: inserted,
                });
              }}
            >
              <Save size={12} className="mr-1" /> Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
