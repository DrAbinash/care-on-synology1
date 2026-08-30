import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText } from "lucide-react";
import { useMemo } from "react";

const SECTION_LABEL: Record<string, string> = {
  technique: "Technique",
  findings: "Findings",
  impression: "Impression",
  recommendation: "Recommendation",
};

export function ConfirmOverwriteDialog() {
  const open = useWorkspaceSelector((s) => s.confirmOverwriteOpen);
  const confirm = useWorkspaceSelector((s) => s.confirmOverwriteAndApply);
  const cancel = useWorkspaceSelector((s) => s.cancelOverwrite);
  const pendingIds = useWorkspaceSelector((s) => s.pendingFormatIds);
  const pendingPatch = useWorkspaceSelector((s) => s.pendingPathologyPatch);
  const patches = useWorkspaceSelector((s) => s.appliedPathologyPatches);
  const analysis = useWorkspaceSelector((s) => s.pendingFormatOverwrite);
  const allF = useWorkspaceSelector((s) => s.reportFormats);
  const formats = useMemo(() => allF.filter((f) => pendingIds.includes(f.id)), [allF, pendingIds]);
  const formatName = formats.length === 1 ? formats[0]!.name : null;
  const confirming = analysis?.confirmingSections ?? [];

  const sameSlot = useMemo(() => {
    if (!pendingPatch?.id) return null;
    const existing = patches.find((p) => p.id === pendingPatch.id);
    if (!existing) return null;
    const level = pendingPatch.level || existing.observation?.level || "";
    const concept = (pendingPatch.concept || existing.observation?.concept || "").replace(/_/g, " ");
    const existingText = (existing.lastRendered.findings || "").trim();
    const newText = (pendingPatch.findingsText || pendingPatch.incoming?.findings || "").trim();
    if (!concept && !level) return null;
    return { level, concept, existingText, newText };
  }, [pendingPatch, patches]);

  const title = pendingPatch && sameSlot
    ? `${sameSlot.level ? `${sameSlot.level} ` : ""}${sameSlot.concept || "finding"} already exists`
    : pendingPatch
      ? "Overwrite existing content?"
      : formatName
        ? `Apply “${formatName}”?`
        : "Overwrite existing content?";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="max-w-md" data-testid={pendingPatch ? "confirm-overwrite-dialog" : "confirm-format-overwrite-dialog"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> {title}
          </DialogTitle>
          <DialogDescription>
            {pendingPatch
              ? "Manually edited content will be replaced only if you confirm. Unrelated text is kept."
              : "Manual or ambiguous sections will be replaced. Patient and DICOM identity stay unchanged."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {pendingPatch && sameSlot ? (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-1.5"
              data-testid="same-slot-conflict"
            >
              {sameSlot.existingText ? (
                <div>
                  <div className="font-semibold text-[10px] uppercase tracking-wider text-amber-800/80">Existing</div>
                  <div data-testid="same-slot-existing">{sameSlot.existingText}</div>
                </div>
              ) : null}
              {sameSlot.newText ? (
                <div>
                  <div className="font-semibold text-[10px] uppercase tracking-wider text-amber-800/80">New</div>
                  <div data-testid="same-slot-new">{sameSlot.newText}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
              {pendingPatch
                ? "This merge may replace a manually edited anatomy/pathology sentence. Unrelated text is kept. Confirm to overwrite the owned block."
                : (
                  <>
                    {analysis?.regionChanging && analysis.regionFrom && analysis.regionTo ? (
                      <div className="mb-1.5" data-testid="confirm-format-region-change">
                        <span className="font-semibold">Reporting region:</span>{" "}
                        {analysis.regionFrom} → {analysis.regionTo}
                      </div>
                    ) : null}
                    {confirming.length > 0 ? (
                      <div data-testid="confirm-format-manual-sections">
                        <div className="font-semibold mb-0.5">Manually edited / ambiguous sections that will be replaced:</div>
                        <ul className="list-disc pl-4">
                          {confirming.map((s) => (
                            <li key={s}>{SECTION_LABEL[s] ?? s}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <>Applying <b>{formats.length} format{formats.length === 1 ? "" : "s"}</b> will overwrite clinical editor fields.</>
                    )}
                  </>
                )}
            </div>
          )}
          {formats.length > 0 && !pendingPatch && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">About to apply:</div>
              {formats.map((f, i) => (
                <div key={f.id} className="flex items-center gap-1.5 text-[11px]">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="rounded bg-muted px-1 text-[9px] font-bold">{i === 0 ? "A" : "B"}</span>
                  <span className="font-semibold">{f.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={cancel}
            data-testid={pendingPatch ? "confirm-overwrite-cancel" : "confirm-format-cancel"}
          >
            {pendingPatch ? "Keep existing" : "Cancel"}
          </Button>
          <Button
            onClick={confirm}
            className="bg-amber-600 hover:bg-amber-700"
            data-testid={pendingPatch ? "confirm-overwrite-replace" : "confirm-format-apply"}
          >
            {pendingPatch ? "Replace" : "Apply Format"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
