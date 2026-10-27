/**
 * Compact add/edit Quick Select finding from the Reporting Workspace.
 * Persists to the global catalog (admin/owner only) via the same API as Settings.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { QuickFinding, QuickStudyTab } from "./QuickFindingsPanel";
import type { QuickSelectField } from "@/lib/zai-workspace/types";
import {
  conflictGroupWordsMissingFromText,
  resolvedOwnershipMode,
} from "@/lib/ownershipFieldValidation";

type Draft = {
  id?: number;
  studyType: string;
  label: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  anatomicalSection: string;
  conflictGroup: string;
  baselineReplaces: string;
  tags: string;
};

function toDraft(f: QuickFinding | null, defaultStudy: string): Draft {
  if (!f) {
    return {
      studyType: defaultStudy,
      label: "",
      findingText: "",
      impressionText: "",
      techniqueText: "",
      recommendationText: "",
      anatomicalSection: "",
      conflictGroup: "",
      baselineReplaces: "",
      tags: "",
    };
  }
  return {
    id: f.id,
    studyType: f.studyType,
    label: f.label,
    findingText: f.findingText,
    impressionText: f.impressionText,
    techniqueText: f.techniqueText,
    recommendationText: f.recommendationText,
    anatomicalSection: f.anatomicalSection,
    conflictGroup: f.conflictGroup ?? "",
    baselineReplaces: f.baselineReplaces ?? "",
    tags: f.tags,
  };
}

interface Props {
  finding: QuickFinding | null;
  tabs: QuickStudyTab[];
  defaultStudyType: string;
  selectedStudyTabId?: number | null;
  /**
   * The section to file a NEW box under, when the caller is that section's own
   * strip. Without it a box authored from the Impression strip is created with
   * the column default `field = "findings"` and so never appears in the strip
   * that just created it — the authoring dead end this editor exists to close.
   *
   * Only ever sent on create. An existing box keeps the `field` it was saved
   * with, so editing one from a different surface can never move it.
   */
  defaultField?: QuickSelectField;
  onClose: () => void;
}

export default function WorkspaceQuickFindingEditor({ finding, tabs, defaultStudyType, selectedStudyTabId, defaultField, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(finding, defaultStudyType));
  const labelRef = useRef<HTMLInputElement>(null);
  const isEdit = draft.id != null;

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const byName = tabs.find((t) => t.name === draft.studyType.trim());
      const studyTabId = selectedStudyTabId ?? finding?.studyTabId ?? byName?.id ?? undefined;
      // Sent only when it is known. A create from a section's own strip files the
      // box under that section; a create from anywhere else omits it and the
      // column default applies, which is what every caller had before. An edit
      // re-sends the box's own `field` unchanged, and a caller that somehow holds
      // a box without one omits it — so the server preserves rather than moves it.
      const fieldForSave = finding?.field ?? (isEdit ? undefined : defaultField);
      const body = {
        studyTabId,
        studyType: draft.studyType.trim(),
        label: draft.label.trim(),
        findingText: draft.findingText,
        impressionText: draft.impressionText,
        techniqueText: draft.techniqueText,
        recommendationText: draft.recommendationText,
        anatomicalSection: draft.anatomicalSection,
        conflictGroup: draft.conflictGroup,
        baselineReplaces: draft.baselineReplaces,
        tags: draft.tags,
        isActive: true,
        ...(fieldForSave ? { field: fieldForSave } : {}),
      };
      if (!body.studyType || !body.label) throw new Error("Study type and label are required");
      if (isEdit) return api.patch(`/api/radiology/quick-select/findings/${draft.id}`, body);
      return api.post("/api/radiology/quick-select/findings", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      toast({ title: isEdit ? "Quick Select button updated" : "Quick Select button added" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  // The radiologist's one-press adoption path for a box they (or the clinic
  // before them) reworded: put the CURRENT shipped wording back. The server
  // keeps position and active state untouched, and the seed's RESYNC rule has
  // already converged the stored snapshot to the newest revision, so this can
  // never resurrect stale factory text. Offered only where it is a real action —
  // a box the clinic wrote itself has no defaults to go back to.
  const restoreDefaults = useMutation({
    mutationFn: async () => api.post<QuickFinding>(`/api/radiology/quick-select/findings/${draft.id}/restore-defaults`, {}),
    onSuccess: (restored: QuickFinding) => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setDraft({
        id: restored.id,
        studyType: restored.studyType,
        label: restored.label,
        findingText: restored.findingText,
        impressionText: restored.impressionText,
        techniqueText: restored.techniqueText,
        recommendationText: restored.recommendationText,
        anatomicalSection: restored.anatomicalSection,
        conflictGroup: restored.conflictGroup ?? "",
        baselineReplaces: restored.baselineReplaces ?? "",
        tags: restored.tags,
      });
      toast({
        title: "Shipped wording restored",
        description: `"${restored.label}" now carries the current shipped text. Close this dialog or keep editing — the restore is already saved.`,
      });
    },
    onError: (err: Error) => toast({ title: "Could not restore", description: err.message, variant: "destructive" }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="workspace-quick-finding-editor"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{isEdit ? "Edit Quick Select button" : "Add Quick Select button"}</h3>
          <p className="text-[10px] text-muted-foreground">Saved to the clinic catalog for all reports of this study type.</p>
        </div>
        {isEdit && finding?.provenance && (
          <div className="flex items-center gap-2">
            <span
              data-testid="workspace-finding-provenance"
              className={`text-[9px] rounded-full border px-1.5 py-0.5 ${
                finding.provenance === "built-in"
                  ? "border-muted-foreground/30 text-muted-foreground"
                  : finding.provenance === "your-version"
                    ? "border-amber-500/50 text-amber-700 bg-amber-500/10"
                    : "border-primary/40 text-primary"
              }`}
              title={
                finding.provenance === "built-in"
                  ? "Shipped wording, untouched. Edits here make it yours."
                  : finding.provenance === "your-version"
                    ? "This clinic edited this button. Restore puts the current shipped wording back."
                    : "Your clinic wrote this button — there is no shipped version to restore."
              }
            >
              {finding.provenance === "built-in" ? "Built-in" : finding.provenance === "your-version" ? "Your version" : "Your box"}
            </span>
            {finding.provenance === "your-version" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                data-testid="workspace-finding-restore"
                disabled={restoreDefaults.isPending}
                title="Replace this button's text with the CURRENT shipped wording. The button stays in place and stays yours to edit."
                onClick={() => restoreDefaults.mutate()}
              >
                <RotateCcw size={11} /> {restoreDefaults.isPending ? "Restoring…" : "Restore shipped wording"}
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Study type</Label>
            <select
              className="h-8 w-full text-xs border rounded-md px-2 bg-background"
              value={draft.studyType}
              onChange={(e) => setDraft((d) => ({ ...d, studyType: e.target.value }))}
            >
              {tabs.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Button label</Label>
            <Input
              ref={labelRef}
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              className="h-8 text-sm"
              placeholder="e.g. Disc bulge L4-L5"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Findings text</Label>
          <Textarea
            value={draft.findingText}
            onChange={(e) => setDraft((d) => ({ ...d, findingText: e.target.value }))}
            className="text-sm min-h-[64px]"
            placeholder="Inserted into Findings…"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Impression text</Label>
          <Textarea
            value={draft.impressionText}
            onChange={(e) => setDraft((d) => ({ ...d, impressionText: e.target.value }))}
            className="text-sm min-h-[48px]"
            placeholder="Inserted into Impression…"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Technique (optional)</Label>
            <Textarea value={draft.techniqueText} onChange={(e) => setDraft((d) => ({ ...d, techniqueText: e.target.value }))} className="text-sm min-h-[40px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Recommendation (optional)</Label>
            <Textarea value={draft.recommendationText} onChange={(e) => setDraft((d) => ({ ...d, recommendationText: e.target.value }))} className="text-sm min-h-[40px]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Anatomical section</Label>
            <Input
              value={draft.anatomicalSection}
              onChange={(e) => setDraft((d) => ({ ...d, anatomicalSection: e.target.value }))}
              className="h-8 text-sm"
              placeholder="L4-L5 / Spinal Cord"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Tags (search)</Label>
            <Input value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} className="h-8 text-sm" placeholder="disc, stenosis" />
          </div>
        </div>
        {(() => {
          const missing = conflictGroupWordsMissingFromText(draft.conflictGroup, draft.findingText);
          const resolved = resolvedOwnershipMode({
            conflictGroup: draft.conflictGroup,
            anatomicalSection: draft.anatomicalSection,
            baselineReplaces: draft.baselineReplaces,
            label: draft.label,
            findingsText: draft.findingText,
            region: draft.studyType,
          });
          return (
            <div className="rounded-md border border-dashed p-2 space-y-2 bg-muted/10" data-testid="ownership-fields">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Conflict group</Label>
                  <Input
                    value={draft.conflictGroup}
                    onChange={(e) => setDraft((d) => ({ ...d, conflictGroup: e.target.value }))}
                    className="h-8 text-sm"
                    placeholder="fazekas"
                    data-testid="ownership-conflict-group"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Baseline replaces</Label>
                  <Input
                    value={draft.baselineReplaces}
                    onChange={(e) => setDraft((d) => ({ ...d, baselineReplaces: e.target.value }))}
                    className="h-8 text-sm"
                    placeholder="No disc bulge."
                  />
                </div>
              </div>
              <p className="text-[10px]" data-testid="ownership-resolved-mode">Resolved: {resolved.label}</p>
              {missing.length > 0 && (
                <p className="text-[10px] text-amber-800" data-testid="ownership-r1-warning">
                  conflictGroup words missing from finding text: {missing.join(", ")}
                </p>
              )}
            </div>
          );
        })()}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" className="h-7 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add button"}
          </Button>
        </div>
      </div>
    </div>
  );
}
