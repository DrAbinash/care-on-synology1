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
import { Search, Plus, Trash2, Database } from "lucide-react";

interface RagDocument {
  id: number;
  documentId: string;
  documentType: string;
  content: string;
  embedding: string | null;
  embeddingDimension: number | null;
  modality: string | null;
  patientId: number | null;
  studyId: number | null;
  sourceTitle: string | null;
  searchCount: number;
  isActive: boolean;
  createdAt: string;
}

export default function RagVectorStore() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    documentId: "",
    documentType: "report",
    content: "",
    modality: "",
    patientId: "",
    sourceTitle: "",
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["ragDocuments", searchTerm, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      if (typeFilter) params.set("documentType", typeFilter);
      return await api.get<RagDocument[]>(`/api/ai-reporting/rag-documents?${params.toString()}`);
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      return await api.post<{ id: number; action: string }>("/api/ai-reporting/rag-documents", body);
    },
    onSuccess: () => {
      toast({ title: "Document saved" });
      qc.invalidateQueries({ queryKey: ["ragDocuments"] });
      setModalOpen(false);
      setForm({ documentId: "", documentType: "report", content: "", modality: "", patientId: "", sourceTitle: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.delete<{ ok: boolean }>(`/api/ai-reporting/rag-documents/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Document removed" });
      qc.invalidateQueries({ queryKey: ["ragDocuments"] });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="RAG Vector Store"
        subtitle="Phase 9 — Manage document embeddings for semantic search and retrieval augmentation."
      />
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Search</Label>
          <Input placeholder="Search documents" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="w-48">
          <Label className="text-sm">Type</Label>
          <Input placeholder="report / template / finding / guideline" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} />
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Document
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Document ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Modality</TableHead>
                <TableHead>Content Preview</TableHead>
                <TableHead>Dimension</TableHead>
                <TableHead>Searches</TableHead>
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
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No documents found.</TableCell>
                </TableRow>
              )}
              {data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.id}</TableCell>
                  <TableCell className="font-mono text-xs">{d.documentId}</TableCell>
                  <TableCell><Badge variant="outline">{d.documentType}</Badge></TableCell>
                  <TableCell>{d.modality ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate" title={d.content}>{d.content.slice(0, 80)}…</TableCell>
                  <TableCell>{d.embeddingDimension ?? "—"}</TableCell>
                  <TableCell>{d.searchCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(d.id)} disabled={deleteMutation.isPending}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Document to RAG Store</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Document ID</Label><Input value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })} placeholder="e.g. report:123" /></div>
            <div><Label>Document Type</Label><Input value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} placeholder="report / template / finding / guideline" /></div>
            <div><Label>Content</Label><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Full text content for embedding" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Modality</Label><Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="MRI / CT / USG" /></div>
              <div><Label>Patient ID</Label><Input value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} placeholder="Optional" /></div>
            </div>
            <div><Label>Source Title</Label><Input value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} placeholder="Optional title" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => upsertMutation.mutate({
                documentId: form.documentId,
                documentType: form.documentType,
                content: form.content,
                modality: form.modality || undefined,
                patientId: form.patientId ? Number(form.patientId) : undefined,
                sourceTitle: form.sourceTitle || undefined,
              })}
              disabled={upsertMutation.isPending || !form.documentId || !form.content}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
