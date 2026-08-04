import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ruler } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import { formatViewerMeasurementLabel, formatViewerMeasurementLine } from "@/lib/formatViewerMeasurementLine";
import { useViewerMeasurements } from "@/components/radiology/ViewerMeasurementsPanel";

interface Props {
  studyInstanceUID: string | null | undefined;
  disabled?: boolean;
  onInsertAll: (lines: string[]) => void;
  onOpenMeasureTab: () => void;
}

/** Prominent pending-measurement strip in the main report column. */
export default function ViewerMeasurementsBanner({
  studyInstanceUID,
  disabled,
  onInsertAll,
  onOpenMeasureTab,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: measurements = [] } = useViewerMeasurements(studyInstanceUID);
  const pending = measurements.filter((m) => m.status === "pending");

  const importAllMutation = useMutation({
    mutationFn: (ids: number[]) =>
      api.post(`/api/radiology-lesions/viewer-measurements/import-all`, { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["viewer-measurements", studyInstanceUID] });
    },
  });

  if (pending.length === 0) return null;

  function insertAll() {
    const lines = pending.map((m) => formatViewerMeasurementLine(m));
    onInsertAll(lines);
    importAllMutation.mutate(pending.map((m) => m.id));
    toast({ title: `${lines.length} measurement${lines.length > 1 ? "s" : ""} inserted into Findings` });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-emerald-300 bg-emerald-50/80 text-[11px] shrink-0"
      data-testid="viewer-measurements-banner"
    >
      <Ruler size={14} className="text-emerald-700 shrink-0" />
      <span className="text-emerald-900 flex-1 min-w-[160px]">
        <span className="font-semibold">{pending.length} viewer measurement{pending.length > 1 ? "s" : ""} pending</span>
        <span className="text-emerald-800/80"> — {pending.slice(0, 2).map((m) => formatViewerMeasurementLabel(m)).join(" · ")}
          {pending.length > 2 ? ` · +${pending.length - 2} more` : ""}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        className="h-6 text-[10px] bg-emerald-700 hover:bg-emerald-800"
        disabled={disabled || importAllMutation.isPending}
        onClick={insertAll}
      >
        Insert all into Findings
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 text-[10px]"
        onClick={onOpenMeasureTab}
      >
        Review →
      </Button>
    </div>
  );
}
