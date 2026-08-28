/**
 * Section 3 — Technique choices backed by radiology_protocols (Study Tab ID).
 * One dropdown + Edit/+ Add; fills the single Technique report field.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, X } from "lucide-react";
import { api, isHttpError } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { QuickProtocol, QuickStudyTab } from "@/components/radiology/QuickFindingsPanel";
import { protocolsForStudyTabDetailed } from "@/lib/pickQuickProtocol";
import type { TechniqueRegionMismatch } from "@/hooks/useReportingStudySetup";

type DuplicateProtocolError = {
  code?: string;
  error?: string;
  existingId?: number;
  name?: string;
  studyType?: string;
};

type TechniqueDraft = {
  id?: number;
  name: string;
  studyTabId: number;
  studyType: string;
  techniqueText: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

export default function TechniqueChoiceStrip({
  protocols,
  studyTabs,
  selectedStudyTabId,
  selectedStudyTabName,
  activeProtocolId,
  onSelectProtocol,
  techniqueMismatch,
  onLoadCurrentDefault,
  isOwner,
  disabled,
}: {
  protocols: QuickProtocol[];
  studyTabs: Pick<QuickStudyTab, "id" | "name">[];
  selectedStudyTabId: number | null;
  selectedStudyTabName: string | null;
  activeProtocolId: number | null;
  onSelectProtocol: (protocol: QuickProtocol | null) => void;
  techniqueMismatch?: TechniqueRegionMismatch | null;
  onLoadCurrentDefault?: () => void;
  isOwner: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TechniqueDraft | null>(null);
  const [duplicateError, setDuplicateError] = useState<DuplicateProtocolError | null>(null);

  const { matched: choices, unresolvedLegacy } = useMemo(
    () =>
      protocolsForStudyTabDetailed(protocols, selectedStudyTabId, selectedStudyTabName),
    [protocols, selectedStudyTabId, selectedStudyTabName],
  );

  const sortedChoices = useMemo(
    () => choices.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [choices],
  );

  const saveMut = useMutation({
    mutationFn: (draft: TechniqueDraft) => {
      const body = {
        name: draft.name.trim(),
        studyTabId: draft.studyTabId,
        studyType: draft.studyType,
        techniqueText: draft.techniqueText,
        isDefault: draft.isDefault,
        isActive: draft.isActive,
        sortOrder: draft.sortOrder,
        checklistJson: "[]",
      };
      return draft.id
        ? api.patch(`/api/radiology/quick-select/protocols/${draft.id}`, body)
        : api.post("/api/radiology/quick-select/protocols", body);
    },
    onSuccess: (row: QuickProtocol) => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setEditing(null);
      setDuplicateError(null);
      toast({ title: "Technique saved" });
      if (row?.id) onSelectProtocol(row);
    },
    onError: (err: unknown) => {
      if (isHttpError(err) && err.status === 409) {
        const body = err.details as DuplicateProtocolError | undefined;
        if (body?.code === "DUPLICATE_PROTOCOL_NAME") {
          setDuplicateError(body);
          return;
        }
      }
      toast({
        title: "Could not save Technique",
        description: err instanceof Error ? err.message : "Admin permission may be required.",
        variant: "destructive",
      });
    },
  });

  const openNew = () => {
    if (selectedStudyTabId == null || !selectedStudyTabName) {
      toast({ title: "Select a Study / Region first", variant: "destructive" });
      return;
    }
    setEditing({
      name: "",
      studyTabId: selectedStudyTabId,
      studyType: selectedStudyTabName,
      techniqueText: "",
      isDefault: sortedChoices.length === 0,
      isActive: true,
      sortOrder: 0,
    });
    setDuplicateError(null);
  };

  const openEdit = (protocol?: QuickProtocol) => {
    const current = protocol
      ?? sortedChoices.find((p) => p.id === activeProtocolId)
      ?? sortedChoices.find((p) => p.isDefault)
      ?? sortedChoices[0];
    if (!current) {
      openNew();
      return;
    }
    setEditing({
      id: current.id,
      name: current.name,
      studyTabId: current.studyTabId ?? selectedStudyTabId ?? 0,
      studyType: current.studyType,
      techniqueText: current.techniqueText,
      isDefault: current.isDefault,
      isActive: current.isActive,
      sortOrder: current.sortOrder,
    });
    setDuplicateError(null);
  };

  const openDuplicateExisting = () => {
    if (!duplicateError?.existingId) return;
    const existing = sortedChoices.find((p) => p.id === duplicateError.existingId)
      ?? protocols.find((p) => p.id === duplicateError.existingId);
    if (existing) openEdit(existing);
  };

  const saveAsVariant = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      id: undefined,
      name: `${editing.name.trim()} (variant)`,
    });
    setDuplicateError(null);
  };

  return (
    <div className="space-y-1.5" data-testid="technique-choice-strip">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <label className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">Technique</span>
          <select
            className="h-7 min-w-[12rem] max-w-[22rem] rounded border bg-background px-1.5 text-[11px] font-medium text-foreground"
            value={activeProtocolId ?? ""}
            disabled={disabled || sortedChoices.length === 0}
            onChange={(e) => {
              const id = Number(e.target.value);
              const p = sortedChoices.find((x) => x.id === id) ?? null;
              onSelectProtocol(p);
            }}
            data-testid="technique-choice-select"
            title={!selectedStudyTabId ? "Select a Study / Region first" : "Technique for this Study Tab"}
          >
            <option value="">
              {!selectedStudyTabId
                ? "Select Study / Region first…"
                : sortedChoices.length === 0
                  ? "No techniques — Add one"
                  : "Select technique…"}
            </option>
            {sortedChoices.map((p) => (
              <option key={p.id} value={p.id} data-study-tab-id={p.studyTabId ?? undefined} data-legacy={!p.studyTabId ? "true" : "false"}>
                {p.name}{p.isDefault ? " ★" : ""}{!p.studyTabId ? " · legacy" : ""}
              </option>
            ))}
          </select>
        </label>
        {unresolvedLegacy.length > 0 ? (
          <span className="text-[9px] text-amber-700" data-testid="technique-legacy-count">
            {unresolvedLegacy.length} legacy
          </span>
        ) : null}
        {isOwner && !disabled ? (
          <>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-teal-400 hover:text-teal-800"
              data-testid="technique-edit"
              onClick={() => openEdit()}
              title="Edit selected Technique"
            >
              <Pencil size={10} /> Edit
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-0.5 rounded border border-dashed border-teal-300/80 px-1.5 text-[10px] font-semibold text-teal-800 hover:bg-teal-50"
              data-testid="technique-add"
              onClick={openNew}
              title="Add Technique for this Study Tab"
            >
              <Plus size={10} /> Add
            </button>
          </>
        ) : null}
      </div>

      {techniqueMismatch && !disabled ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded border border-amber-300/80 bg-amber-50/80 px-2 py-1 text-[10px] text-amber-950"
          data-testid="technique-region-mismatch"
        >
          <span>
            Technique belongs to <strong>{techniqueMismatch.originStudyTabName}</strong>
          </span>
          {onLoadCurrentDefault ? (
            <button
              type="button"
              className="rounded border border-amber-400 bg-white px-1.5 py-0.5 font-semibold hover:bg-amber-100"
              data-testid="technique-load-current-default"
              onClick={onLoadCurrentDefault}
            >
              Load {techniqueMismatch.currentStudyTabName} default
            </button>
          ) : null}
        </div>
      ) : null}

      {duplicateError && editing ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[10px] text-destructive" data-testid="technique-duplicate-error">
          <p>{duplicateError.error ?? "A Technique with that name already exists for this Study Tab."}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {duplicateError.existingId ? (
              <button type="button" className="underline font-semibold" data-testid="technique-duplicate-edit" onClick={openDuplicateExisting}>
                Edit existing
              </button>
            ) : null}
            <button type="button" className="underline font-semibold" data-testid="technique-duplicate-variant" onClick={saveAsVariant}>
              Save as variant
            </button>
          </div>
        </div>
      ) : null}

      {editing && (
        <div className="rounded-md border bg-card p-2 space-y-2 shadow-sm" data-testid="technique-editor">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Technique for Study Tab <strong className="text-foreground">{editing.studyType}</strong> (id {editing.studyTabId})
            </p>
            <button type="button" className="p-1 text-muted-foreground" onClick={() => setEditing(null)} aria-label="Close">
              <X size={12} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Name</Label>
              <Input
                className="h-7 text-xs mt-0.5"
                value={editing.name}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value });
                  setDuplicateError(null);
                }}
                placeholder="Standard MRI Cervical Spine"
                data-testid="technique-editor-name"
                autoFocus
              />
            </div>
            <div className="flex items-end gap-3 pb-0.5">
              <label className="inline-flex items-center gap-1.5 text-[10px]">
                <input
                  type="checkbox"
                  checked={editing.isDefault}
                  onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
                />
                Default for this Study Tab
              </label>
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Technique text</Label>
            <Textarea
              className="min-h-[64px] text-xs mt-0.5"
              value={editing.techniqueText}
              onChange={(e) => setEditing({ ...editing, techniqueText: e.target.value })}
              placeholder="MRI examination of the cervical spine was performed…"
              data-testid="technique-editor-text"
            />
          </div>
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[10px]"
              disabled={!editing.name.trim() || saveMut.isPending}
              data-testid="technique-editor-save"
              onClick={() => saveMut.mutate(editing)}
            >
              <Save size={12} className="mr-1" /> Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
