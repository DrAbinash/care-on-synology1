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
import { Plus } from "lucide-react";

interface ExportItem {
  id: number;
  exportName: string;
  modality: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  minQualityScore: number | null;
  recordsCount: number | null;
  status: string;
  filePath: string | null;
  exportedByName: string | null;
  createdAt: string;
}

function statusBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    pending: "secondary", processing: "default", ready: "outline", failed: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"}>{s}</Badge>;
}

export default function TrainingDataExports() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ exportName: "", modality: "", dateFrom: "", dateTo: "", minQualityScore: "" });

  const { data = [], isLoading } = useQuery({
    queryKey: ["trainingDataExports"],
    queryFn: async () => {
      return await api.get<ExportItem[]>("/api/ai-reporting/training-data-exports");
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number; status: string }>("/api/ai-reporting/training-data-exports", {
        exportName: form.exportName,
        modality: form.modality || undefined,
        dateFrom: form.dateFrom || undefined,
        dateTo: form.dateTo || undefined,
        minQualityScore: form.minQualityScore ? Number(form.minQualityScore) : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Export queued" });
      qc.invalidateQueries({ queryKey: ["trainingDataExports"] });
      setModalOpen(false);
      setForm({ exportName: "", modality: "", dateFrom: "", dateTo: "", minQualityScore: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="AI Training Data Export" subtitle="Phase 19 — Export radiologist-approved reports as labeled training datasets. Super-admin gated." />
      <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4 mr-1" /> Queue Export</Button>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Modality</TableHead>
                <TableHead>Period</TableHead><TableHead>Min Quality</TableHead><TableHead>Records</TableHead>
                <TableHead>Status</TableHead><TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No exports found.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.exportName}</TableCell>
                  <TableCell>{item.modality ?? "—"}</TableCell>
                  <TableCell>{item.dateFrom ?? "—"} — {item.dateTo ?? "—"}</TableCell>
                  <TableCell>{item.minQualityScore ?? "—"}</TableCell>
                  <TableCell>{item.recordsCount ?? "—"}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.exportedByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Queue Training Data Export</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Export Name</Label><Input value={form.exportName} onChange={(e) => setForm({ ...form, exportName: e.target.value })} /></div>
            <div><Label>Modality</Label><Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="MRI / CT / USG" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date From</Label><Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} /></div>
              <div><Label>Date To</Label><Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} /></div>
            </div>
            <div><Label>Min Quality Score</Label><Input value={form.minQualityScore} onChange={(e) => setForm({ ...form, minQualityScore: e.target.value })} placeholder="0-100" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.exportName}>Queue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
