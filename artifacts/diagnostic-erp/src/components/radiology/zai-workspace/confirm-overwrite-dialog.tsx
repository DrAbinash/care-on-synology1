import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, MinusCircle, PlusCircle } from "lucide-react";
import { useMemo } from "react";

const SECTION_LABEL: Record<string, string> = {
  technique: "Technique",
  findings: "Findings",
  impression: "Impression",
  recommendation: "Recommendation",
};

/** One labelled line inside the removed/added lists. */
function ChangeRow({ label, sentence }: { label: string; sentence: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-[3px] rounded bg-muted px-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground flex-none">
        {label}
      </span>
      <span className="min-w-0">{sentence}</span>
    </div>
  );
}

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

  // ── Priority 2 — name the exact words at risk, both directions ─────────────
  // The dialog used to answer "what exists?" by looking the INCOMING row up in
  // the ledger — while the pending click had already parked that row there — so
  // "Existing" and "New" rendered the same sentence twice and the sentence
  // Replace would actually delete was never named. Under the Priority 1 hold
  // the click writes nothing, so the two sides are read honestly instead:
  //   REMOVE — the radiologist's own sentences the force pass will evict
  //            (`manualKept`, captured by the overlay's walk), plus the vacated
  //            row's own wording when this is a same-slot upgrade;
  //   ADD    — the sentences the tile writes (its resolved incoming).
  const vacatedRow = useMemo(() => {
    const id = (pendingPatch?.vacatedObservationId ?? "").trim();
    if (!id) return null;
    return patches.find((p) => p.id === id) ?? null;
  }, [pendingPatch, patches]);

  const removedRows = useMemo(() => {
    if (!pendingPatch) return [];
    const out: { label: string; sentence: string }[] = [];
    const seen = new Set<string>();
    const push = (label: string, sentence: string) => {
      const s = (sentence ?? "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push({ label, sentence: s });
    };
    for (const field of ["findings", "impression"] as const) {
      for (const sentence of pendingPatch.manualKept?.[field] ?? []) {
        push(SECTION_LABEL[field] ?? field, sentence);
      }
    }
    // A same-slot upgrade also takes the vacated row's own wording off the page
    // — that wording is not the radiologist's, but it IS a sentence Replace
    // deletes, so it belongs in the same honest list.
    for (const field of ["findings", "impression"] as const) {
      const text = (vacatedRow?.lastRendered?.[field] ?? "").trim();
      if (text) push(SECTION_LABEL[field] ?? field, text);
    }
    return out;
  }, [pendingPatch, vacatedRow]);

  const addedRows = useMemo(() => {
    if (!pendingPatch) return [];
    const out: { label: string; sentence: string }[] = [];
    const seen = new Set<string>();
    const push = (label: string, sentence: string) => {
      const s = (sentence ?? "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push({ label, sentence: s });
    };
    for (const field of ["findings", "impression"] as const) {
      const text = (pendingPatch.incoming?.[field] ?? pendingPatch.findingsText ?? "").trim();
      if (text) push(SECTION_LABEL[field] ?? field, text);
    }
    return out;
  }, [pendingPatch]);

  const manualAtRisk = removedRows.length > 0;

  const title = pendingPatch
    ? manualAtRisk
      ? "Replace your own wording?"
      : vacatedRow
        ? `${(pendingPatch.level ? `${pendingPatch.level} ` : "")}${(pendingPatch.concept ?? "").replace(/_/g, " ") || "finding"} — replace the previous wording?`
        : "Overwrite existing content?"
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
              ? manualAtRisk
                ? "You wrote or reworded the sentence(s) below. Replace removes them and writes the tile's wording. Keep existing leaves the report exactly as it is."
                : "Replace removes the previous wording shown below and writes the tile's wording. Keep existing leaves the report exactly as it is."
              : "Manual or ambiguous sections will be replaced. Patient and DICOM identity stay unchanged."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {pendingPatch ? (
            <>
              <div
                className="rounded-md border border-rose-200 bg-rose-50/60 p-2.5 text-xs text-rose-900 space-y-1"
                data-testid="replace-will-remove"
              >
                <div className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-rose-700/90">
                  <MinusCircle className="h-3 w-3" /> Replace will remove
                </div>
                {removedRows.length > 0 ? removedRows.map((r) => (
                  <ChangeRow key={r.sentence} label={r.label} sentence={r.sentence} />
                )) : (
                  <div className="text-rose-800/80" data-testid="replace-removes-nothing">Nothing — the report keeps every sentence it has now.</div>
                )}
              </div>
              <div
                className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-900 space-y-1"
                data-testid="replace-will-add"
              >
                <div className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-emerald-700/90">
                  <PlusCircle className="h-3 w-3" /> and will write
                </div>
                {addedRows.length > 0 ? addedRows.map((r) => (
                  <ChangeRow key={r.sentence} label={r.label} sentence={r.sentence} />
                )) : (
                  <div className="text-emerald-800/80">(no new sentence)</div>
                )}
                {pendingPatch.vacatedObservationId ? (
                  <div className="text-[10px] text-emerald-800/90" data-testid="same-slot-vacate-note">
                    The previous observation row is taken over by this one; linked measurements move with it when possible.
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
              <div className="mb-1.5" data-testid="confirm-format-region-change">
                {analysis?.regionChanging && analysis.regionFrom && analysis.regionTo ? (
                  <>
                    <span className="font-semibold">Reporting region:</span>{" "}
                    {analysis.regionFrom} → {analysis.regionTo}
                  </>
                ) : null}
              </div>
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
