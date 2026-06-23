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
import { Plus, Check, X } from "lucide-react";

interface PeerReview {
  id: number;
  reportId: number;
  assignedToName: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "in_review" | "approved" | "rejected";
  aiConfidenceScore: number | null;
  autoAssignedReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

function priorityBadge(p: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = { low: "outline", normal: "secondary", high: "destructive", urgent: "destructive" };
  return <Badge variant={map[p] ?? "outline"}>{p.toUpperCase()}</Badge>;
}

function statusBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = { pending: "secondary", in_review: "default", approved: "outline", rejected: "destructive" };
  return <Badge variant={map[s] ?? "outline"}>{s}</Badge>;
}

export default function PeerReviewAssignments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [actionItem, setActionItem] = useState<PeerReview | null>(null);
  const [form, setForm] = useState({ reportId: "", assignedToId: "", assignedToName: "", priority: "normal", aiConfidenceScore: "", autoAssignedReason: "" });
  const [notes, setNotes] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["peerReviewAssignments", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<PeerReview[]>(`/api/ai-reporting/peer-review-assignments?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number }>("/api/ai-reporting/peer-review-assignments", {
        reportId: Number(form.reportId),
        assignedToId: Number(form.assignedToId),
        assignedToName: form.assignedToName || undefined,
        priority: form.priority,
        aiConfidenceScore: form.aiConfidenceScore ? Number(form.aiConfidenceScore) : undefined,
        autoAssignedReason: form.autoAssignedReason || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Assigned" });
      qc.invalidateQueries({ queryKey: ["peerReviewAssignments"] });
      setModalOpen(false);
      setForm({ reportId: "", assignedToId: "", assignedToName: "", priority: "normal", aiConfidenceScore: "", autoAssignedReason: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      return await api.patch<{ ok: boolean }>(`/api/ai-reporting/peer-review-assignments/${id}`, { status, notes });
    },
    onSuccess: () => {
      toast({ title: "Updated" });
      qc.invalidateQueries({ queryKey: ["peerReviewAssignments"] });
      setActionItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Peer Review Assignments" subtitle="Phase 17 — Auto-assign complex reports for peer review." />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Status</Label>
          <Input placeholder="pending / in_review / approved / rejected" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>
        <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4 mr-1" /> Assign</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>Report</TableHead><TableHead>Priority</TableHead>
                <TableHead>Status</TableHead><TableHead>AI Confidence</TableHead><TableHead>Reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No assignments.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.reportId}</TableCell>
                  <TableCell>{priorityBadge(item.priority)}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.aiConfidenceScore ?? "—"}%</TableCell>
                  <TableCell>{item.autoAssignedReason ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setActionItem(item); setNotes(""); }}>
                      <Check className="w-4 h-4" />
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
          <DialogHeader><DialogTitle>Assign Peer Review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Report ID</Label><Input value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })} /></div>
            <div><Label>Assigned To ID</Label><Input value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })} /></div>
            <div><Label>Assigned To Name</Label><Input value={form.assignedToName} onChange={(e) => setForm({ ...form, assignedToName: e.target.value })} /></div>
            <div><Label>Priority</Label>
              <select className="w-full border rounded px-2 py-1 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">low</option><option value="normal">normal</option><option value="high">high</option><option value="urgent">urgent</option>
              </select>
            </div>
            <div><Label>AI Confidence</Label><Input value={form.aiConfidenceScore} onChange={(e) => setForm({ ...form, aiConfidenceScore: e.target.value })} placeholder="0-100" /></div>
            <div><Label>Auto-Assigned Reason</Label><Input value={form.autoAssignedReason} onChange={(e) => setForm({ ...form, autoAssignedReason: e.target.value })} placeholder="e.g. LOW_AI_CONFIDENCE" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.reportId || !form.assignedToId}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Action dialog */}
      <Dialog open={!!actionItem} onOpenChange={() => setActionItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Peer Review Action #{actionItem?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Completion notes" />
          </div>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setActionItem(null)}>Cancel</Button>
            <Button variant="default" onClick={() => actionItem && updateMutation.mutate({ id: actionItem.id, status: "approved", notes })} disabled={updateMutation.isPending}>
              <Check className="w-4 h-4 mr-1" /> Approve
            </Button>
            <Button variant="destructive" onClick={() => actionItem && updateMutation.mutate({ id: actionItem.id, status: "rejected", notes })} disabled={updateMutation.isPending}>
              <X className="w-4 h-4 mr-1" /> Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
