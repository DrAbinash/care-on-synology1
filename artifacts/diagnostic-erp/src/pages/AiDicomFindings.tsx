import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X, Eye, ThumbsUp, ThumbsDown } from "lucide-react";

interface AiDicomFinding {
  id: number;
  worklistId: number;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  modality: string | null;
  bodyPart: string | null;
  studyDescription: string | null;
  suggestedFindings: string | null;
  suggestedImpression: string | null;
  confidenceScore: number | null;
  aiSafetyLabel: string;
  status: "pending" | "reviewed" | "accepted" | "rejected";
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewedNotes: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "outline" | "secondary" | "destructive"; label: string }> = {
    pending: { variant: "secondary", label: "Pending" },
    reviewed: { variant: "outline", label: "Reviewed" },
    accepted: { variant: "default", label: "Accepted" },
    rejected: { variant: "destructive", label: "Rejected" },
  };
  const c = map[status] ?? { variant: "outline", label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default function AiDicomFindings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [worklistId, setWorklistId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewItem, setViewItem] = useState<AiDicomFinding | null>(null);
  const [reviewItem, setReviewItem] = useState<AiDicomFinding | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"accepted" | "rejected" | "reviewed">("reviewed");

  const { data = [], isLoading } = useQuery({
    queryKey: ["aiDicomFindings", worklistId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (worklistId) params.set("worklistId", worklistId);
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<AiDicomFinding[]>(`/api/ai-reporting/dicom-findings?${params.toString()}`);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      return await api.patch<{ ok: boolean }>(`/api/ai-reporting/dicom-findings/${id}`, { status, reviewedNotes: notes });
    },
    onSuccess: () => {
      toast({ title: "Review saved" });
      qc.invalidateQueries({ queryKey: ["aiDicomFindings"] });
      setReviewItem(null);
      setReviewNotes("");
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI-Powered DICOM Findings"
        subtitle="Phase 3 — Auto-suggested findings from DICOM metadata, pending radiologist review."
      />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Worklist ID</Label>
          <Input placeholder="Filter by worklist ID" value={worklistId} onChange={(e) => setWorklistId(e.target.value)} />
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
                <TableHead>ID</TableHead>
                <TableHead>Worklist</TableHead>
                <TableHead>Modality</TableHead>
                <TableHead>Body Part</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Reviewed By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No AI DICOM findings found.</TableCell>
                </TableRow>
              )}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell>{item.worklistId}</TableCell>
                  <TableCell>{item.modality ?? "—"}</TableCell>
                  <TableCell>{item.bodyPart ?? "—"}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.confidenceScore ?? "—"}%</TableCell>
                  <TableCell>{item.reviewedByName ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewItem(item)} title="View">
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setReviewItem(item); setReviewNotes(item.reviewedNotes ?? ""); }} title="Review">
                      <ThumbsUp className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI DICOM Finding #{viewItem?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex gap-2">
              <Badge variant="secondary">{viewItem?.aiSafetyLabel}</Badge>
              {statusBadge(viewItem?.status ?? "pending")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-muted-foreground">Worklist:</span> {viewItem?.worklistId}</div>
              <div><span className="text-muted-foreground">Modality:</span> {viewItem?.modality ?? "—"}</div>
              <div><span className="text-muted-foreground">Body Part:</span> {viewItem?.bodyPart ?? "—"}</div>
              <div><span className="text-muted-foreground">Confidence:</span> {viewItem?.confidenceScore ?? "—"}%</div>
              <div><span className="text-muted-foreground">Study UID:</span> {viewItem?.studyInstanceUID ?? "—"}</div>
              <div><span className="text-muted-foreground">Accession:</span> {viewItem?.accessionNumber ?? "—"}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Study Description:</span>
              <p className="mt-1">{viewItem?.studyDescription ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Suggested Findings:</span>
              <div className="mt-1 p-2 bg-muted rounded">{viewItem?.suggestedFindings ?? "—"}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Suggested Impression:</span>
              <div className="mt-1 p-2 bg-muted rounded">{viewItem?.suggestedImpression ?? "—"}</div>
            </div>
            {viewItem?.reviewedByName && (
              <div>
                <span className="text-muted-foreground">Reviewed by:</span> {viewItem.reviewedByName} on {new Date(viewItem.reviewedAt!).toLocaleString()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewItem(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={!!reviewItem} onOpenChange={() => setReviewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review AI DICOM Finding #{reviewItem?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={reviewStatus === "accepted" ? "default" : "outline"} onClick={() => setReviewStatus("accepted")}><Check className="w-4 h-4 mr-1" /> Accept</Button>
              <Button variant={reviewStatus === "rejected" ? "destructive" : "outline"} onClick={() => setReviewStatus("rejected")}><X className="w-4 h-4 mr-1" /> Reject</Button>
              <Button variant={reviewStatus === "reviewed" ? "secondary" : "outline"} onClick={() => setReviewStatus("reviewed")}>Mark Reviewed</Button>
            </div>
            <Label>Review Notes</Label>
            <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Optional notes for the audit trail" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewItem(null)}>Cancel</Button>
            <Button
              onClick={() => reviewItem && reviewMutation.mutate({ id: reviewItem.id, status: reviewStatus, notes: reviewNotes })}
              disabled={reviewMutation.isPending}
            >
              Save Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
