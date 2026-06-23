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
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Send, MessageSquare, Sparkles, Check, FileText } from "lucide-react";

interface PatientCommunication {
  id: number;
  worklistId: number | null;
  reportId: number | null;
  patientId: number | null;
  communicationType: string;
  language: string;
  originalText: string | null;
  aiDraft: string | null;
  aiSafetyLabel: string;
  status: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  sentAt: string | null;
  sentByName: string | null;
  createdAt: string;
}

function statusBadge(s: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    pending: "secondary", drafted: "default", reviewed: "outline", sent: "default", error: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"}>{s}</Badge>;
}

export default function PatientCommunicationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewItem, setViewItem] = useState<PatientCommunication | null>(null);
  const [correctedText, setCorrectedText] = useState("");
  const [form, setForm] = useState({
    worklistId: "", reportId: "", patientId: "", communicationType: "result_summary", language: "en", originalText: "",
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["patientCommunications", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return await api.get<PatientCommunication[]>(`/api/ai-reporting/patient-communications?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number; message: string }>("/api/ai-reporting/patient-communications", {
        worklistId: form.worklistId ? Number(form.worklistId) : undefined,
        reportId: form.reportId ? Number(form.reportId) : undefined,
        patientId: form.patientId ? Number(form.patientId) : undefined,
        communicationType: form.communicationType,
        language: form.language,
        originalText: form.originalText,
      });
    },
    onSuccess: (res) => {
      toast({ title: "Created", description: res.message });
      qc.invalidateQueries({ queryKey: ["patientCommunications"] });
      setCreateOpen(false);
      setForm({ worklistId: "", reportId: "", patientId: "", communicationType: "result_summary", language: "en", originalText: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const draftMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post<{ id: number; aiDraft: string; status: string }>(`/api/ai-reporting/patient-communications/${id}/draft`, {});
    },
    onSuccess: (res) => {
      toast({ title: "AI Draft generated" });
      qc.invalidateQueries({ queryKey: ["patientCommunications"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) => {
      return await api.patch<{ id: number; aiDraft: string }>(`/api/ai-reporting/patient-communications/${id}`, { aiDraft: text, status: "reviewed" });
    },
    onSuccess: () => {
      toast({ title: "Reviewed and saved" });
      qc.invalidateQueries({ queryKey: ["patientCommunications"] });
      setViewItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post<{ id: number; status: string; message: string }>(`/api/ai-reporting/patient-communications/${id}/send`, {});
    },
    onSuccess: (res) => {
      toast({ title: "Sent", description: res.message });
      qc.invalidateQueries({ queryKey: ["patientCommunications"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Patient Communication Assistant"
        subtitle="Phase 25 — Draft patient-friendly summaries, follow-up instructions, and messages from radiology reports."
      />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Status</Label>
          <Input placeholder="pending / drafted / reviewed / sent" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>
        <Button onClick={() => setCreateOpen(true)}><MessageSquare className="w-4 h-4 mr-1" /> New</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewed By</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No communications found.</TableCell></TableRow>}
              {data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell className="capitalize">{item.communicationType.replace(/_/g, " ")}</TableCell>
                  <TableCell>{item.language}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.reviewedByName ?? "—"}</TableCell>
                  <TableCell>{item.sentAt ? new Date(item.sentAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {item.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => draftMutation.mutate(item.id)} disabled={draftMutation.isPending}>
                          <Sparkles className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "drafted" && (
                        <Button size="sm" variant="outline" onClick={() => { setViewItem(item); setCorrectedText(item.aiDraft ?? ""); }}>
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "reviewed" && (
                        <Button size="sm" variant="default" onClick={() => sendMutation.mutate(item.id)} disabled={sendMutation.isPending}>
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Patient Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Worklist</Label><Input value={form.worklistId} onChange={(e) => setForm({ ...form, worklistId: e.target.value })} /></div>
              <div><Label>Report</Label><Input value={form.reportId} onChange={(e) => setForm({ ...form, reportId: e.target.value })} /></div>
              <div><Label>Patient</Label><Input value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <select className="w-full border rounded px-2 py-1 text-sm" value={form.communicationType} onChange={(e) => setForm({ ...form, communicationType: e.target.value })}>
                  <option value="result_summary">Result Summary</option>
                  <option value="followup_instructions">Follow-up Instructions</option>
                  <option value="general_message">General Message</option>
                </select>
              </div>
              <div><Label>Language</Label>
                <select className="w-full border rounded px-2 py-1 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="bn">Bengali</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                </select>
              </div>
            </div>
            <div><Label>Original Report Text</Label>
              <Textarea value={form.originalText} onChange={(e) => setForm({ ...form, originalText: e.target.value })} placeholder="Paste the radiologist report text here…" rows={6} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.originalText}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Review & Edit dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Review AI Draft #{viewItem?.id}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Badge variant="outline">{viewItem?.aiSafetyLabel}</Badge>
            <div>
              <Label className="text-sm font-medium">Original Report</Label>
              <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded mt-1">{viewItem?.originalText ?? "—"}</pre>
            </div>
            <div>
              <Label className="text-sm font-medium">AI Draft</Label>
              <Textarea className="mt-1" rows={8} value={correctedText} onChange={(e) => setCorrectedText(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewItem(null)}>Cancel</Button>
            <Button onClick={() => viewItem && reviewMutation.mutate({ id: viewItem.id, text: correctedText })} disabled={reviewMutation.isPending}>Save Review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
