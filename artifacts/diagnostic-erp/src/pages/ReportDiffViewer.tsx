import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface DiffData {
  worklistId: number;
  aiDraft: string;
  finalReport: string;
  aiDraftStatus: string;
  aiSafetyLabel: string;
  diff: {
    addedByRadiologist: string[];
    removedByRadiologist: string[];
    unchanged: string[];
  };
}

export default function ReportDiffViewer() {
  const [wlId, setWlId] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["reportDiff", wlId],
    enabled: submitted && !!wlId,
    queryFn: async () => {
      return await api.get<DiffData>(`/api/ai-reporting/report-diff/${wlId}`);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="AI Report Diff Viewer" subtitle="Phase 13 — Compare AI draft vs. final radiologist report." />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Worklist ID</Label>
          <Input placeholder="Enter worklist ID" value={wlId} onChange={(e) => setWlId(e.target.value)} />
        </div>
        <Button onClick={() => setSubmitted(true)} disabled={!wlId}>Compare</Button>
      </div>
      {isLoading && <div className="text-muted-foreground">Loading diff…</div>}
      {data && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Badge variant="secondary">{data.aiSafetyLabel}</Badge>
            <Badge variant="outline">Status: {data.aiDraftStatus}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">AI Draft</h3>
                <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded">{data.aiDraft || "No AI draft available."}</pre>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-2">Final Radiologist Report</h3>
                <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded">{data.finalReport || "No final report available."}</pre>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">Diff Summary</h3>
              <div>
                <span className="text-sm font-medium text-red-600">Removed by Radiologist ({data.diff.removedByRadiologist.length}):</span>
                <ul className="text-sm list-disc pl-5 mt-1">
                  {data.diff.removedByRadiologist.length === 0 && <li className="text-muted-foreground">None</li>}
                  {data.diff.removedByRadiologist.map((l, i) => <li key={i} className="text-red-600">{l}</li>)}
                </ul>
              </div>
              <div>
                <span className="text-sm font-medium text-green-600">Added by Radiologist ({data.diff.addedByRadiologist.length}):</span>
                <ul className="text-sm list-disc pl-5 mt-1">
                  {data.diff.addedByRadiologist.length === 0 && <li className="text-muted-foreground">None</li>}
                  {data.diff.addedByRadiologist.map((l, i) => <li key={i} className="text-green-600">{l}</li>)}
                </ul>
              </div>
              <div>
                <span className="text-sm font-medium">Unchanged ({data.diff.unchanged.length}):</span>
                <ul className="text-sm list-disc pl-5 mt-1">
                  {data.diff.unchanged.length === 0 && <li className="text-muted-foreground">None</li>}
                  {data.diff.unchanged.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {submitted && !isLoading && !data && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="w-4 h-4" /> No diff data found for this worklist.
        </div>
      )}
    </div>
  );
}
