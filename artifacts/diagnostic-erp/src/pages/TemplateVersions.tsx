import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";

interface TemplateVersion {
  id: number;
  templateId: string;
  version: number;
  name: string;
  content: string;
  createdByName: string | null;
  changeNotes: string | null;
  createdAt: string;
}

export default function TemplateVersions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterId, setFilterId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ templateId: "", name: "", content: "", changeNotes: "" });

  const { data = [], isLoading } = useQuery({
    queryKey: ["templateVersions", filterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterId) params.set("templateId", filterId);
      return await api.get<TemplateVersion[]>(`/api/ai-reporting/template-versions?${params.toString()}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number; version: number }>("/api/ai-reporting/template-versions", {
        templateId: form.templateId, name: form.name, content: form.content, changeNotes: form.changeNotes,
      });
    },
    onSuccess: () => {
      toast({ title: "Version saved" });
      qc.invalidateQueries({ queryKey: ["templateVersions"] });
      setModalOpen(false);
      setForm({ templateId: "", name: "", content: "", changeNotes: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Report Template Versions" subtitle="Phase 15 — Track every change to structured templates with audit trail." />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Template ID</Label>
          <Input placeholder="Filter by template ID" value={filterId} onChange={(e) => setFilterId(e.target.value)} />
        </div>
        <Button onClick={() => setModalOpen(true)}><Plus className="w-4 h-4 mr-1" /> Save Version</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template ID</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Change Notes</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No versions found.</TableCell></TableRow>}
              {data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.templateId}</TableCell>
                  <TableCell>{v.version}</TableCell>
                  <TableCell>{v.name}</TableCell>
                  <TableCell>{v.changeNotes ?? "—"}</TableCell>
                  <TableCell>{v.createdByName ?? "—"}</TableCell>
                  <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Save Template Version</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Template ID</Label><Input value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })} placeholder="e.g. MRI_brain_sequence" /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Content</Label><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Template content or JSON" /></div>
            <div><Label>Change Notes</Label><Input value={form.changeNotes} onChange={(e) => setForm({ ...form, changeNotes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.templateId || !form.name || !form.content}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
