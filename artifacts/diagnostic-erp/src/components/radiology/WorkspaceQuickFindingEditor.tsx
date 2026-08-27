/**
 * Compact add/edit Quick Select finding from the Reporting Workspace.
 * Persists to the global catalog (admin/owner only) via the same API as Settings.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { QuickFinding, QuickStudyTab } from "./QuickFindingsPanel";
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
  onClose: () => void;
}

export default function WorkspaceQuickFindingEditor({ finding, tabs, defaultStudyType, onClose }: Props) {
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
      const body = {
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
