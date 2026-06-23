import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Pencil, Trash2, Download, Search, BrainCircuit, ShieldCheck,
} from "lucide-react";

interface PromptTemplate {
  id: number;
  name: string;
  modality: string;
  promptContent: string;
  version: number;
  createdBy: string | null;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

const MODALITIES = ["MRI", "CT", "USG", "X-Ray", "OTHER"] as const;

const MODALITY_COLORS: Record<string, string> = {
  MRI: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  CT: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  USG: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "X-Ray": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  OTHER: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

interface EditState {
  id: number | null;
  name: string;
  modality: string;
  promptContent: string;
  isActive: boolean;
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: "",
  modality: "MRI",
  promptContent: "",
  isActive: true,
};

export default function AiPromptTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modalityFilter, setModalityFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-prompt-templates"],
    queryFn: () => api.get<{ templates: PromptTemplate[] }>("/api/ai-prompt-templates"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ai-prompt-templates"] });
    // Keep the AI reporting drawer's template list fresh too.
    qc.invalidateQueries({ queryKey: ["ai-reporting-settings"] });
  };

  const seedMutation = useMutation({
    mutationFn: () => api.post<{ inserted: number; skipped: number }>("/api/ai-prompt-templates/seed", {}),
    onSuccess: (res) => {
      toast({
        title: "Presets loaded",
        description: `${res.inserted} added, ${res.skipped} already present.`,
      });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Could not load presets", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: EditState) => {
      const body = {
        name: payload.name,
        modality: payload.modality,
        promptContent: payload.promptContent,
        isActive: payload.isActive,
      };
      return payload.id
        ? api.put(`/api/ai-prompt-templates/${payload.id}`, body)
        : api.post("/api/ai-prompt-templates", body);
    },
    onSuccess: () => {
      toast({ title: edit.id ? "Template updated" : "Template created" });
      setEditOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/ai-prompt-templates/${id}`),
    onSuccess: () => {
      toast({ title: "Template deleted" });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const templates = data?.templates ?? [];
  const filtered = templates.filter((t) => {
    if (modalityFilter !== "ALL" && t.modality !== modalityFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.promptContent.toLowerCase().includes(q);
    }
    return true;
  });

  const openCreate = () => { setEdit(EMPTY_EDIT); setEditOpen(true); };
  const openEdit = (t: PromptTemplate) => {
    setEdit({ id: t.id, name: t.name, modality: t.modality, promptContent: t.promptContent, isActive: t.isActive });
    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Prompt Templates"
        subtitle="Modality-aware prompts that drive AI radiology draft generation. Fully editable — no code changes required."
      />

      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 flex items-start gap-2">
        <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          These prompts produce <strong>AI drafts only</strong>. Every generated report is marked
          <em> "AI Draft – Requires Radiologist Review"</em> and must be reviewed and finalized by a radiologist. AI never signs or finalizes reports.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={modalityFilter} onValueChange={setModalityFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All modalities</SelectItem>
            {MODALITIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
          <Download className="h-4 w-4 mr-2" />
          Load Care Diagnostics presets
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">
            {templates.length === 0
              ? "No prompt templates yet. Load the curated Care Diagnostics library to get started."
              : "No templates match your filter."}
          </p>
          {templates.length === 0 && (
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Download className="h-4 w-4 mr-2" />
              Load Care Diagnostics presets
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border bg-card p-4 flex flex-col gap-2 ${!t.isActive ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${MODALITY_COLORS[t.modality] ?? MODALITY_COLORS.OTHER}`}>
                    {t.modality}
                  </span>
                  <h3 className="font-semibold text-sm leading-tight">{t.name}</h3>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">v{t.version}</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-4 flex-1">{t.promptContent}</p>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  {!t.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                  {t.isSystem && <Badge variant="outline" className="text-[10px]">Preset</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{edit.id ? "Edit Template" : "New Template"}</DialogTitle>
            <DialogDescription>
              Editing the prompt content bumps the version automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-sm font-medium">Prompt Name</label>
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder="e.g. MRI Brain"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Modality</label>
                <Select value={edit.modality} onValueChange={(v) => setEdit({ ...edit, modality: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODALITIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Prompt Content</label>
              <Textarea
                value={edit.promptContent}
                onChange={(e) => setEdit({ ...edit, promptContent: e.target.value })}
                placeholder="Describe how the AI should report this study type…"
                rows={10}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={edit.isActive} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} />
              <span className="text-sm">Active (available for AI report generation)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate(edit)}
              disabled={saveMutation.isPending || !edit.name.trim() || !edit.promptContent.trim()}
            >
              {edit.id ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              "{deleteTarget?.name}" will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
