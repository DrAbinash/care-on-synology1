import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { QueueStudy } from "@/lib/reportingWorkflow";
import { formatStudySectionTitle } from "@/lib/multiStudyReport";

/**
 * Pick a second worklist row to combine into the open report.
 * Rows come from the workflow queue already in memory — this dialog does
 * not fetch or call setStudies (single zustand ingress).
 */
export function LinkStudyDialog({
  open,
  onOpenChange,
  currentStudyId,
  currentPatientId,
  queue,
  linkedStudyId,
  onSelect,
  onUnlink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStudyId: number | null;
  currentPatientId: number | null;
  queue: QueueStudy[];
  linkedStudyId: string | null;
  onSelect: (study: QueueStudy) => void;
  onUnlink: () => void;
}) {
  const [search, setSearch] = useState("");
  const [samePatientOnly, setSamePatientOnly] = useState(true);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((row) => {
      if (currentStudyId != null && row.id === currentStudyId) return false;
      if (samePatientOnly && currentPatientId != null && row.patientId !== currentPatientId) return false;
      if (!q) return true;
      const hay = `${row.patientName} ${row.modality} ${row.studyDescription ?? ""} ${row.accessionNumber}`.toLowerCase();
      return hay.includes(q);
    });
  }, [queue, search, samePatientOnly, currentPatientId, currentStudyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="link-study-dialog">
        <DialogHeader>
          <DialogTitle>Link study</DialogTitle>
          <DialogDescription>
            Combine a second study into this report. Findings get one sub-section per study. One sign-off finalizes both worklist rows.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, accession, or study…"
          className="h-8 text-sm"
          data-testid="link-study-search"
          autoFocus
        />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={samePatientOnly}
            onChange={(e) => setSamePatientOnly(e.target.checked)}
            data-testid="link-study-same-patient"
          />
          Same patient only
        </label>
        <div className="max-h-64 overflow-y-auto rounded border" data-testid="link-study-results">
          {rows.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No matching studies in the current worklist.</p>
          ) : rows.map((row) => {
            const title = formatStudySectionTitle(row.modality, row.studyDescription);
            const selected = linkedStudyId != null && String(row.id) === linkedStudyId;
            return (
              <button
                key={row.id}
                type="button"
                className={`flex w-full items-start gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-emerald-50 ${selected ? "bg-emerald-50" : ""}`}
                data-testid={`link-study-row-${row.id}`}
                onClick={() => {
                  onSelect(row);
                  onOpenChange(false);
                }}
              >
                <span className="rounded bg-slate-800 px-1 py-0.5 text-[9px] font-bold text-white">{row.modality}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{title}</span>
                  <span className="block truncate text-muted-foreground">
                    {row.patientName} · {row.accessionNumber}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {linkedStudyId ? (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { onUnlink(); onOpenChange(false); }} data-testid="unlink-study">
            Remove linked study
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
