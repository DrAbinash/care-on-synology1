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
import { Plus, Zap, ClipboardCheck, Copy, Trash2, Merge } from "lucide-react";

interface NormalTemplate {
  id: number;
  name: string;
  modality: string;
  bodyPart: string | null;
  category: string;
  findings: string;
  impression: string;
  technique: string | null;
  clinicalHistory: string | null;
  comparison: string | null;
  sortOrder: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  normal: "Normal",
  pathology: "Pathology",
  trauma: "Trauma",
  screening: "Screening",
  contrast: "Contrast",
};
const CATEGORY_COLORS: Record<string, string> = {
  normal: "bg-green-50 text-green-700 border-green-200",
  pathology: "bg-amber-50 text-amber-700 border-amber-200",
  trauma: "bg-red-50 text-red-700 border-red-200",
  screening: "bg-blue-50 text-blue-700 border-blue-200",
  contrast: "bg-purple-50 text-purple-700 border-purple-200",
};

export default function NormalReportTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalityFilter, setModalityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [applyItem, setApplyItem] = useState<NormalTemplate | null>(null);
  const [worklistId, setWorklistId] = useState("");
  const [appliedText, setAppliedText] = useState("");
  const [form, setForm] = useState({
    name: "", modality: "", bodyPart: "", category: "normal", findings: "", impression: "", technique: "", clinicalHistory: "", comparison: "", sortOrder: "",
  });
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<number[]>([]);
  const [mergePreview, setMergePreview] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["normalTemplates", modalityFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (modalityFilter) params.set("modality", modalityFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      return await api.get<NormalTemplate[]>(`/api/ai-reporting/normal-templates?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number }>("/api/ai-reporting/normal-templates", {
        name: form.name, modality: form.modality, bodyPart: form.bodyPart || undefined,
        category: form.category || "normal",
        findings: form.findings, impression: form.impression,
        technique: form.technique || undefined, clinicalHistory: form.clinicalHistory || undefined,
        comparison: form.comparison || undefined, sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
      });
    },
    onSuccess: () => {
      toast({ title: "Template saved" });
      qc.invalidateQueries({ queryKey: ["normalTemplates"] });
      setModalOpen(false);
      setForm({ name: "", modality: "", bodyPart: "", category: "normal", findings: "", impression: "", technique: "", clinicalHistory: "", comparison: "", sortOrder: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.delete<{ ok: boolean }>(`/api/ai-reporting/normal-templates/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["normalTemplates"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async ({ id, wlId }: { id: number; wlId: string }) => {
      return await api.post<{ reportText: string; templateName: string }>(`/api/ai-reporting/normal-templates/${id}/apply`, { worklistId: wlId });
    },
    onSuccess: (res) => {
      toast({ title: `Applied: ${res.templateName}` });
      setAppliedText(res.reportText);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ reportText: string; mergedName: string; mergedHeading: string }>("/api/ai-reporting/normal-templates/merge", { templateIds: mergeIds });
    },
    onSuccess: (res) => {
      toast({ title: `Merged: ${res.mergedName}` });
      setMergePreview(res.reportText);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="One-Click Normal Report Templates"
        subtitle="Phase 26 — Pre-built normal templates for common studies. Click to apply, edit, and finalize."
      />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Modality</Label>
          <Input placeholder="Filter: MRI / CT / USG / X-Ray" value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-sm">Category</Label>
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            <option value="normal">Normal</option>
            <option value="pathology">Pathology</option>
            <option value="trauma">Trauma</option>
            <option value="screening">Screening</option>
            <option value="contrast">Contrast</option>
          </select>
        </div>
        <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        <Button variant={mergeMode ? "default" : "outline"} onClick={() => { setMergeMode(!mergeMode); setMergeIds([]); setMergePreview(""); }}>
          <Merge className="w-4 h-4 mr-1" /> Merge
        </Button>
      </div>
      {mergeMode && (
        <div className="bg-muted rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm">{mergeIds.length === 0 ? "Select 2+ templates to merge" : `${mergeIds.length} selected`}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setMergeIds([]); setMergePreview(""); }}>Clear</Button>
            <Button size="sm" onClick={() => { if (mergeIds.length >= 2) { mergeMutation.mutate(); setMergeOpen(true); } }} disabled={mergeIds.length < 2 || mergeMutation.isPending}>
              <Merge className="w-4 h-4 mr-1" /> Merge & Preview
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {data.map((t) => (
          <Card key={t.id} className={mergeMode && mergeIds.includes(t.id) ? "border-primary ring-1 ring-primary" : ""}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{t.modality}</Badge>
                  <span className={`text-xs px-2 py-0.5 rounded border ${CATEGORY_COLORS[t.category] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>{CATEGORY_LABELS[t.category] || t.category}</span>
                  <span className="font-semibold">{t.name}</span>
                </div>
                <div className="flex gap-1">
                  {mergeMode ? (
                    <Button size="sm" variant={mergeIds.includes(t.id) ? "default" : "outline"} onClick={() => {
                      setMergeIds((prev) => prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]);
                    }}>
                      {mergeIds.includes(t.id) ? "Selected" : "Select"}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => { setApplyItem(t); setWorklistId(""); setAppliedText(""); }}>
                        <Zap className="w-4 h-4 text-blue-500" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(t.id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">{t.bodyPart ?? "—"}</div>
              <div className="text-sm bg-muted p-2 rounded whitespace-pre-wrap">{t.findings}</div>
              <div className="text-sm font-medium">Impression: {t.impression}</div>
            </CardContent>
          </Card>
        ))}
        {isLoading && <div className="col-span-2 text-center py-6 text-muted-foreground">Loading…</div>}
        {!isLoading && data.length === 0 && <div className="col-span-2 text-center py-6 text-muted-foreground">No templates. Add one to start.</div>}
      </div>
      {/* Apply dialog */}
      <Dialog open={!!applyItem} onOpenChange={() => { setApplyItem(null); setAppliedText(""); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Apply: {applyItem?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label>Worklist ID</Label>
                <Input value={worklistId} onChange={(e) => setWorklistId(e.target.value)} placeholder="Enter worklist ID" />
              </div>
              <Button className="mt-6" onClick={() => applyItem && worklistId && applyMutation.mutate({ id: applyItem.id, wlId: worklistId })} disabled={applyMutation.isPending || !worklistId}>
                <Zap className="w-4 h-4 mr-1" /> Apply
              </Button>
            </div>
            {appliedText && (
              <div>
                <Label className="text-sm font-medium">Generated Report</Label>
                <div className="relative mt-1">
                  <pre className="text-sm whitespace-pre-wrap bg-muted p-3 rounded pr-10">{appliedText}</pre>
                  <Button size="sm" variant="ghost" className="absolute top-1 right-1" onClick={() => { navigator.clipboard.writeText(appliedText); toast({ title: "Copied" }); }}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <Badge variant="outline" className="mt-2">AI Draft – Requires Radiologist Review</Badge>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApplyItem(null); setAppliedText(""); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Create dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Normal Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. MRI Brain – Normal" /></div>
              <div><Label>Modality</Label><Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="MRI / CT / USG / X-Ray" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Body Part</Label><Input value={form.bodyPart} onChange={(e) => setForm({ ...form, bodyPart: e.target.value })} /></div>
              <div>
                <Label>Category</Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="normal">Normal</option>
                  <option value="pathology">Pathology</option>
                  <option value="trauma">Trauma</option>
                  <option value="screening">Screening</option>
                  <option value="contrast">Contrast</option>
                </select>
              </div>
              <div><Label>Sort Order</Label><Input value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} placeholder="0, 1, 2…" /></div>
            </div>
            <div><Label>Findings</Label><Textarea value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} rows={4} placeholder="Normal findings text…" /></div>
            <div><Label>Impression</Label><Input value={form.impression} onChange={(e) => setForm({ ...form, impression: e.target.value })} placeholder="e.g. Normal MRI brain." /></div>
            <div><Label>Technique</Label><Input value={form.technique} onChange={(e) => setForm({ ...form, technique: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Clinical History</Label><Input value={form.clinicalHistory} onChange={(e) => setForm({ ...form, clinicalHistory: e.target.value })} /></div>
              <div><Label>Comparison</Label><Input value={form.comparison} onChange={(e) => setForm({ ...form, comparison: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name || !form.modality || !form.findings || !form.impression}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Merge preview dialog */}
      <Dialog open={mergeOpen} onOpenChange={() => { setMergeOpen(false); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Merged Report Preview</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {mergeMutation.isPending && <div className="text-center py-6 text-muted-foreground">Merging templates…</div>}
            {mergePreview && (
              <div>
                <div className="relative mt-1">
                  <pre className="text-sm whitespace-pre-wrap bg-muted p-3 rounded pr-10 max-h-96 overflow-y-auto">{mergePreview}</pre>
                  <Button size="sm" variant="ghost" className="absolute top-1 right-1" onClick={() => { navigator.clipboard.writeText(mergePreview); toast({ title: "Copied" }); }}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <Badge variant="outline" className="mt-2">AI Draft – Requires Radiologist Review</Badge>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMergeOpen(false); setMergePreview(""); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
