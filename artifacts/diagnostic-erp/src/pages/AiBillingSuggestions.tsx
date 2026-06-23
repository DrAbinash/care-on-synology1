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
import { Check, X, ThumbsUp } from "lucide-react";

interface BillingSuggestion {
  id: number;
  worklistId: number;
  reportId: number | null;
  cptCodes: string | null;
  icdCodes: string | null;
  overallConfidence: number | null;
  aiSafetyLabel: string;
  status: "pending" | "reviewed" | "accepted" | "rejected";
  reviewedByName: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    pending: "secondary", reviewed: "outline", accepted: "default", rejected: "destructive",
  };
  return <Badge variant={map[status] ?? "outline"}>{status}</Badge>;
}

export default function AiBillingSuggestions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [worklistId, setWorklistId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reviewItem, setReviewItem] = useState<BillingSuggestion | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"accepted" | "rejected" | "reviewed">("reviewed");
  const [reviewNotes, setReviewNotes] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["billingSuggestions", worklistId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (worklistId) params.set("worklistId", worklistId);
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<BillingSuggestion[]>(`/api/ai-reporting/billing-suggestions?${params.toString()}`);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      return await api.patch<{ ok: boolean }>(`/api/ai-reporting/billing-suggestions/${id}`, { status, reviewedNotes: notes });
    },
    onSuccess: () => {
      toast({ title: "Review saved" });
      qc.invalidateQueries({ queryKey: ["billingSuggestions"] });
      setReviewItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="AI Billing Code Suggestions" subtitle="Phase 16 — CPT/ICD suggestions from AI. Never auto-bills — always radiologist-approved." />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Worklist ID</Label>
          <Input placeholder="Filter" value={worklistId} onChange={(e) => setWorklistId(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-sm">Status</Label>
          <Input placeholder="pending / reviewed / accepted / rejected" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>Worklist</TableHead><TableHead>Status</TableHead>
                <TableHead>Confidence</TableHead><TableHead>CPT</TableHead><TableHead>ICD</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No suggestions found.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.worklistId}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.overallConfidence ?? "—"}%</TableCell>
                  <TableCell className="max-w-xs truncate">{item.cptCodes ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{item.icdCodes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setReviewItem(item); setReviewNotes(""); }}>
                      <ThumbsUp className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={!!reviewItem} onOpenChange={() => setReviewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Review Billing Suggestion #{reviewItem?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={reviewStatus === "accepted" ? "default" : "outline"} onClick={() => setReviewStatus("accepted")}><Check className="w-4 h-4 mr-1" /> Accept</Button>
              <Button variant={reviewStatus === "rejected" ? "destructive" : "outline"} onClick={() => setReviewStatus("rejected")}><X className="w-4 h-4 mr-1" /> Reject</Button>
              <Button variant={reviewStatus === "reviewed" ? "secondary" : "outline"} onClick={() => setReviewStatus("reviewed")}>Mark Reviewed</Button>
            </div>
            <Label>Notes</Label>
            <Input value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Optional notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewItem(null)}>Cancel</Button>
            <Button onClick={() => reviewItem && reviewMutation.mutate({ id: reviewItem.id, status: reviewStatus, notes: reviewNotes })} disabled={reviewMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
