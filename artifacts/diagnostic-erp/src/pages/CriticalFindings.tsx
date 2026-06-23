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
import { Plus, AlertTriangle, Check, Send } from "lucide-react";

interface CriticalFinding {
  id: number;
  reportId: number;
  patientId: number | null;
  findingKeywords: string;
  severity: string;
  status: string;
  notifiedTo: string | null;
  notificationMethod: string | null;
  escalationReason: string | null;
  createdAt: string;
}

function statusBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    pending_notification: "secondary", notified: "default", acknowledged: "outline", escalated: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"}>{s.replace(/_/g, " ")}</Badge>;
}

function severityBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = { high: "destructive", critical: "destructive" };
  return <Badge variant={map[s] ?? "outline"}>{s.toUpperCase()}</Badge>;
}

export default function CriticalFindings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [actionItem, setActionItem] = useState<CriticalFinding | null>(null);
  const [form, setForm] = useState({ reportId: "", patientId: "", keywords: "", severity: "high" });
  const [notifyTo, setNotifyTo] = useState("");
  const [method, setMethod] = useState("email");

  const { data = [], isLoading } = useQuery({
    queryKey: ["criticalFindings", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<CriticalFinding[]>(`/api/ai-reporting/critical-findings?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number }>("/api/ai-reporting/critical-findings", {
        reportId: Number(form.reportId),
        patientId: form.patientId ? Number(form.patientId) : undefined,
        findingKeywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        severity: form.severity,
      });
    },
    onSuccess: () => {
      toast({ title: "Critical finding recorded" });
      qc.invalidateQueries({ queryKey: ["criticalFindings"] });
      setModalOpen(false);
      setForm({ reportId: "", patientId: "", keywords: "", severity: "high" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const notifyMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return await api.patch<{ ok: boolean }>(`/api/ai-reporting/critical-findings/${id}`, { status, notifiedTo: notifyTo, notificationMethod: method });
    },
    onSuccess: () => {
      toast({ title: "Notification updated" });
      qc.invalidateQueries({ queryKey: ["criticalFindings"] });
      setActionItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Critical Finding Escalation" subtitle="Phase 21 — Auto-flag critical findings for immediate notification to referring physician." />
      <div className="flex gap-2 items-end">
        <div className="flex-1"><Label className="text-sm">Status</Label><Input placeholder="pending_notification / notified / acknowledged / escalated" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} /></div>
        <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4 mr-1" /> Record</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>Report</TableHead><TableHead>Patient</TableHead>
                <TableHead>Severity</TableHead><TableHead>Keywords</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No critical findings.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.reportId}</TableCell>
                  <TableCell>{item.patientId ?? "—"}</TableCell>
                  <TableCell>{severityBadge(item.severity)}</TableCell>
                  <TableCell className="max-w-xs truncate">{item.findingKeywords}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setActionItem(item); setNotifyTo(""); setMethod("email"); }}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* Create dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Critical Finding</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Report ID</Label><Input value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })} /></div>
            <div><Label>Patient ID</Label><Input value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} /></div>
            <div><Label>Keywords (comma-separated)</Label><Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="acute hemorrhage, mass lesion" /></div>
            <div><Label>Severity</Label>
              <select className="w-full border rounded px-2 py-1 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="high">high</option><option value="critical">critical</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.reportId || !form.keywords}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Notify dialog */}
      <Dialog open={!!actionItem} onOpenChange={() => setActionItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Notify / Escalate #{actionItem?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Notify To</Label><Input value={notifyTo} onChange={(e) => setNotifyTo(e.target.value)} placeholder="Email or phone" /></div>
            <div><Label>Method</Label>
              <select className="w-full border rounded px-2 py-1 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="email">email</option><option value="sms">sms</option><option value="whatsapp">whatsapp</option>
              </select>
            </div>
          </div>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setActionItem(null)}>Cancel</Button>
            <Button variant="default" onClick={() => actionItem && notifyMutation.mutate({ id: actionItem.id, status: "notified" })} disabled={notifyMutation.isPending || !notifyTo}>
              <Send className="w-4 h-4 mr-1" /> Notify
            </Button>
            <Button variant="destructive" onClick={() => actionItem && notifyMutation.mutate({ id: actionItem.id, status: "escalated" })} disabled={notifyMutation.isPending}>
              <AlertTriangle className="w-4 h-4 mr-1" /> Escalate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
