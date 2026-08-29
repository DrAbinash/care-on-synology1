/**
 * Add Study / Region from Reporting Workspace Section 1.
 *
 * Creates one real radiology_study_tabs row (server catalog), then optionally
 * configures children (technique/normals, findings + Ownership, protocol,
 * history chip). Never writes a parallel localStorage catalog.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Plus, X } from "lucide-react";
import type {
  QuickClinicalHistoryChip,
  QuickFinding,
  QuickProtocol,
  QuickStudyTab,
} from "./QuickFindingsPanel";
import WorkspaceQuickFindingEditor from "./WorkspaceQuickFindingEditor";
import { normalizeRegionName } from "@/lib/workspaceRegionPrefs";

type QuickSelectData = {
  tabs: QuickStudyTab[];
  findings: QuickFinding[];
  protocols: QuickProtocol[];
  clinicalHistory: QuickClinicalHistoryChip[];
};

export type AddStudyRegionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** After the Study Tab exists in the server catalog and the user finishes. */
  onCreated: (tab: { id: number; name: string }) => void;
  /** Prefer locking the new finding editor to this modality hint (display only). */
  modalityHint?: string | null;
};

type Step = "identity" | "children";

export function AddStudyRegionDialog({
  open,
  onClose,
  onCreated,
  modalityHint,
}: AddStudyRegionDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [techniqueText, setTechniqueText] = useState("");
  const [normalText, setNormalText] = useState("");
  const [created, setCreated] = useState<QuickStudyTab | null>(null);
  const [findingEditorOpen, setFindingEditorOpen] = useState(false);
  const [protocolName, setProtocolName] = useState("");
  const [protocolTechnique, setProtocolTechnique] = useState("");
  const [chipLabel, setChipLabel] = useState("");
  const [chipText, setChipText] = useState("");

  const { data } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    enabled: open,
  });

  const regionName = created?.name ?? normalizeRegionName(name);
  const children = useMemo(() => {
    if (!regionName || !data) {
      return { findings: [] as QuickFinding[], protocols: [] as QuickProtocol[], chips: [] as QuickClinicalHistoryChip[] };
    }
    return {
      findings: (data.findings ?? []).filter((f) => f.studyType === regionName),
      protocols: (data.protocols ?? []).filter((p) => p.studyType === regionName),
      chips: (data.clinicalHistory ?? []).filter((c) => c.studyType === regionName),
    };
  }, [data, regionName]);

  const reset = () => {
    setStep("identity");
    setName("");
    setTechniqueText("");
    setNormalText("");
    setCreated(null);
    setFindingEditorOpen(false);
    setProtocolName("");
    setProtocolTechnique("");
    setChipLabel("");
    setChipText("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const createTab = useMutation({
    mutationFn: async () => {
      const n = normalizeRegionName(name);
      if (!n) throw new Error("Region name is required");
      return api.post("/api/radiology/quick-select/tabs", {
        name: n,
        techniqueText,
        normalText,
      }) as Promise<QuickStudyTab>;
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setCreated(row);
      setStep("children");
      toast({ title: "Study / Region created", description: `"${row.name}" is in the clinic catalog.` });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create region",
        description: err.message || "Admin access required to add study tabs.",
        variant: "destructive",
      });
    },
  });

  const saveProtocol = useMutation({
    mutationFn: async () => {
      if (!created) throw new Error("Create the region first");
      const n = protocolName.trim();
      if (!n) throw new Error("Protocol name is required");
      return api.post("/api/radiology/quick-select/protocols", {
        name: n,
        studyType: created.name,
        modality: modalityHint ?? "",
        techniqueText: protocolTechnique,
        checklistJson: "[]",
        isDefault: children.protocols.length === 0,
        isActive: true,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setProtocolName("");
      setProtocolTechnique("");
      toast({ title: "Protocol added" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not add protocol", description: err.message, variant: "destructive" }),
  });

  const saveChip = useMutation({
    mutationFn: async () => {
      if (!created) throw new Error("Create the region first");
      const label = chipLabel.trim();
      if (!label) throw new Error("Chip label is required");
      return api.post("/api/radiology/quick-select/clinical-history", {
        studyType: created.name,
        displayLabel: label,
        insertedText: chipText.trim() || label,
        isActive: true,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
      setChipLabel("");
      setChipText("");
      toast({ title: "History chip added" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not add history chip", description: err.message, variant: "destructive" }),
  });

  const finish = () => {
    if (!created) return;
    onCreated({ id: created.id, name: created.name });
    handleClose();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        data-testid="add-study-region-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-4 shadow-lg space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">
                {step === "identity" ? "Add Study / Region" : `Configure “${created?.name}”`}
              </h3>
              <p className="text-[10px] text-muted-foreground">
                {step === "identity"
                  ? "Creates a clinic Study Tab (same as Settings → Quick Select). A name alone is not enough — attach children next."
                  : "Children are content keyed to this region. Findings include Ownership (anatomical section / conflict group / baseline replaces)."}
              </p>
            </div>
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {step === "identity" && (
            <div className="space-y-2" data-testid="add-study-region-identity">
              <div className="space-y-1">
                <Label className="text-[11px]">Name (Study / Region)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="e.g. Knee MRI / Cervical Spine"
                  autoFocus
                  data-testid="add-study-region-name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Auto technique (fills Technique when this region is selected)</Label>
                <Textarea
                  value={techniqueText}
                  onChange={(e) => setTechniqueText(e.target.value)}
                  className="text-sm min-h-[48px]"
                  placeholder="Optional — multiplanar T1/T2…"
                  data-testid="add-study-region-technique"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Baseline normals (abnormality engine / “+ baseline normals”)</Label>
                <Textarea
                  value={normalText}
                  onChange={(e) => setNormalText(e.target.value)}
                  className="text-sm min-h-[56px]"
                  placeholder="Optional — normal template sentences for this region"
                  data-testid="add-study-region-normals"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Requires admin. Same catalog as{" "}
                <Link href="/settings/radiology?tab=quick-select" className="underline">
                  Settings → Radiology → Quick Select
                </Link>
                .
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!normalizeRegionName(name) || createTab.isPending}
                  onClick={() => createTab.mutate()}
                  data-testid="add-study-region-create"
                >
                  {createTab.isPending ? "Creating…" : "Create & configure children"}
                </Button>
              </div>
            </div>
          )}

          {step === "children" && created && (
            <div className="space-y-3" data-testid="add-study-region-children">
              <div
                className="rounded-md border bg-muted/20 px-2.5 py-2 text-[11px]"
                data-testid="add-study-region-associated"
              >
                <p className="font-semibold">Content associated with {created.name}</p>
                <p className="text-muted-foreground">
                  Findings {children.findings.length} · Protocols {children.protocols.length} · History chips{" "}
                  {children.chips.length}
                </p>
                {created.techniqueText ? (
                  <p className="mt-1 text-muted-foreground truncate" title={created.techniqueText}>
                    Technique: {created.techniqueText}
                  </p>
                ) : null}
              </div>

              <div className="rounded-md border border-dashed p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold">Quick Findings (Ownership)</p>
                    <p className="text-[10px] text-muted-foreground">
                      Each finding owns an anatomical section / conflict group so it can replace baseline text.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => setFindingEditorOpen(true)}
                    data-testid="add-study-region-add-finding"
                  >
                    <Plus size={11} /> Add finding
                  </Button>
                </div>
                {children.findings.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No findings yet for this region.</p>
                ) : (
                  <ul className="space-y-1 max-h-28 overflow-y-auto">
                    {children.findings.map((f) => (
                      <li
                        key={f.id}
                        className="rounded border bg-card px-2 py-1 text-[10px]"
                        data-testid={`add-study-region-finding-${f.id}`}
                      >
                        <span className="font-medium">{f.label}</span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {[f.anatomicalSection, f.conflictGroup, f.baselineReplaces]
                            .filter(Boolean)
                            .join(" · ") || "no ownership set"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border p-2 space-y-1.5">
                <p className="text-[11px] font-semibold">Protocol (optional child)</p>
                <div className="flex flex-wrap gap-1.5">
                  <Input
                    className="h-7 text-[11px] flex-1 min-w-[8rem]"
                    placeholder="Protocol name"
                    value={protocolName}
                    onChange={(e) => setProtocolName(e.target.value)}
                    data-testid="add-study-region-protocol-name"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    disabled={!protocolName.trim() || saveProtocol.isPending}
                    onClick={() => saveProtocol.mutate()}
                    data-testid="add-study-region-protocol-save"
                  >
                    Add protocol
                  </Button>
                </div>
                <Textarea
                  className="text-[11px] min-h-[36px]"
                  placeholder="Protocol technique (optional)"
                  value={protocolTechnique}
                  onChange={(e) => setProtocolTechnique(e.target.value)}
                />
                {children.protocols.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    {children.protocols.map((p) => p.name).join(", ")}
                  </p>
                )}
              </div>

              <div className="rounded-md border p-2 space-y-1.5">
                <p className="text-[11px] font-semibold">Clinical history chip (optional child)</p>
                <div className="flex flex-wrap gap-1.5">
                  <Input
                    className="h-7 text-[11px] flex-1 min-w-[7rem]"
                    placeholder="Chip label"
                    value={chipLabel}
                    onChange={(e) => setChipLabel(e.target.value)}
                    data-testid="add-study-region-chip-label"
                  />
                  <Input
                    className="h-7 text-[11px] flex-1 min-w-[7rem]"
                    placeholder="Inserted text"
                    value={chipText}
                    onChange={(e) => setChipText(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    disabled={!chipLabel.trim() || saveChip.isPending}
                    onClick={() => saveChip.mutate()}
                    data-testid="add-study-region-chip-save"
                  >
                    Add chip
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Link
                  href="/settings/radiology?tab=quick-select"
                  className="text-[10px] underline text-muted-foreground hover:text-foreground"
                >
                  Open full Quick Select settings
                </Link>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={finish}
                    data-testid="add-study-region-use"
                  >
                    Use this region
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {findingEditorOpen && created && (
        <WorkspaceQuickFindingEditor
          finding={null}
          tabs={[created, ...(data?.tabs ?? []).filter((t) => t.id !== created.id)]}
          defaultStudyType={created.name}
          onClose={() => {
            setFindingEditorOpen(false);
            void qc.invalidateQueries({ queryKey: ["radiology-quick-select"] });
          }}
        />
      )}
    </>
  );
}
