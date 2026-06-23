import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Check, AlertTriangle } from "lucide-react";

interface QualityGate {
  id: number;
  reportId: number;
  findingsPresent: boolean;
  impressionPresent: boolean;
  signaturePresent: boolean;
  clinicalHistoryPresent: boolean;
  techniquePresent: boolean;
  comparisonPresent: boolean;
  allPassed: boolean;
  failedChecks: string | null;
  passedAt: string | null;
  createdAt: string;
}

export default function ReportQualityGates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reportId, setReportId] = useState("");
  const [passedFilter, setPassedFilter] = useState("");
  const [runModal, setRunModal] = useState(false);
  const [form, setForm] = useState({
    reportId: "", findingsPresent: true, impressionPresent: true, signaturePresent: true,
    clinicalHistoryPresent: false, techniquePresent: false, comparisonPresent: false,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["qualityGates", reportId, passedFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (reportId) params.set("reportId", reportId);
      if (passedFilter) params.set("passed", passedFilter);
      return await api.get<QualityGate[]>(`/api/ai-reporting/quality-gates?${params.toString()}`);
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number; allPassed: boolean; failedChecks: string[] }>("/api/ai-reporting/quality-gates", {
        reportId: Number(form.reportId),
        findingsPresent: form.findingsPresent,
        impressionPresent: form.impressionPresent,
        signaturePresent: form.signaturePresent,
        clinicalHistoryPresent: form.clinicalHistoryPresent,
        techniquePresent: form.techniquePresent,
        comparisonPresent: form.comparisonPresent,
      });
    },
    onSuccess: (res) => {
      toast({ title: res.allPassed ? "All checks passed" : "Some checks failed" });
      qc.invalidateQueries({ queryKey: ["qualityGates"] });
      setRunModal(false);
      setForm({ reportId: "", findingsPresent: true, impressionPresent: true, signaturePresent: true, clinicalHistoryPresent: false, techniquePresent: false, comparisonPresent: false });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Report Quality Gates" subtitle="Phase 20 — Enforce minimum required fields before a report can be finalized." />
      <div className="flex gap-2 items-end">
        <div className="flex-1"><Label className="text-sm">Report ID</Label><Input placeholder="Filter" value={reportId} onChange={(e) => setReportId(e.target.value)} /></div>
        <div className="w-40"><Label className="text-sm">Passed</Label>
          <select className="w-full border rounded px-2 py-1 text-sm" value={passedFilter} onChange={(e) => setPassedFilter(e.target.value)}>
            <option value="">All</option><option value="true">Passed</option><option value="false">Failed</option>
          </select>
        </div>
        <Button onClick={() => setRunModal(true)}>Run Check</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead><TableHead>Findings</TableHead><TableHead>Impression</TableHead>
                <TableHead>Signature</TableHead><TableHead>History</TableHead><TableHead>Technique</TableHead>
                <TableHead>Comparison</TableHead><TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No quality gates found.</TableCell></TableRow>}
              {data.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{g.reportId}</TableCell>
                  <TableCell>{g.findingsPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.impressionPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.signaturePresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.clinicalHistoryPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.techniquePresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.comparisonPresent ? <Check className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}</TableCell>
                  <TableCell>{g.allPassed ? <Badge variant="outline" className="text-green-600">Passed</Badge> : <Badge variant="destructive">Failed</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={runModal} onOpenChange={setRunModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Run Quality Gate Check</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Report ID</Label><Input value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })} /></div>
            {[
              { key: "findingsPresent" as const, label: "Findings Present" },
              { key: "impressionPresent" as const, label: "Impression Present" },
              { key: "signaturePresent" as const, label: "Signature Present" },
              { key: "clinicalHistoryPresent" as const, label: "Clinical History Present" },
              { key: "techniquePresent" as const, label: "Technique Present" },
              { key: "comparisonPresent" as const, label: "Comparison Present" },
            ].map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <input type="checkbox" checked={form[c.key]} onChange={(e) => setForm({ ...form, [c.key]: e.target.checked })} />
                <Label className="text-sm">{c.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunModal(false)}>Cancel</Button>
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !form.reportId}>Run Check</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
