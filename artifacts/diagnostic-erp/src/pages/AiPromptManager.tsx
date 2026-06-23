// Phase 7A: AI Prompt Manager
// Enterprise-grade prompt library with 9 prompt types per category,
// version control, testing, JSON import/export, and doctor-specific libraries.

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Pencil, Download, Upload, History, Search,
  ChevronDown, ChevronUp, BookOpen, Copy, Check, ArrowLeft,
  Terminal, Sparkles, AlertTriangle, Save, Trash2,
} from "lucide-react";

const PROMPT_TYPES = [
  { key: "system", label: "System Prompt", desc: "Defines the AI persona and role" },
  { key: "image_review", label: "Image Review", desc: "How to analyze medical images" },
  { key: "findings", label: "Findings Extraction", desc: "How to extract findings from text/images" },
  { key: "impression", label: "Impression Prompt", desc: "How to generate the impression section" },
  { key: "differential", label: "Differential Diagnosis", desc: "How to generate differential diagnoses" },
  { key: "followup", label: "Follow-Up", desc: "How to generate follow-up recommendations" },
  { key: "quality", label: "Quality Check", desc: "How to check report quality" },
  { key: "polish", label: "Language Polish", desc: "How to refine language without changing facts" },
  { key: "formatting", label: "Formatting", desc: "How to structure the report output" },
] as const;

const CATEGORIES = [
  "MRI Brain", "MRI Spine", "MRI Knee", "MRI Shoulder", "MRI Abdomen", "MRI Pelvis",
  "CT Brain", "CT Trauma", "CT Chest", "HRCT Chest",
  "USG Abdomen", "Obstetric USG", "Doppler",
  "Mammography", "X-Ray", "Generic Reporting",
] as const;

const MODALITIES = ["MRI", "CT", "USG", "X-Ray", "Mammography", "Doppler", "OTHER"] as const;

const OWNERS = [
  { value: "care_diagnostics", label: "Care Diagnostics" },
  { value: "dr_sugandha", label: "Dr. Sugandha" },
  { value: "dr_abinash", label: "Dr. Abinash" },
  { value: "hope_hospital", label: "Hope Hospital" },
] as const;

const PROVIDERS = [
  { value: "gemini", label: "Google Gemini" },
  { value: "openai", label: "OpenAI / ChatGPT" },
  { value: "anthropic", label: "Anthropic Claude" },
  { value: "ollama", label: "Ollama (Local)" },
] as const;

interface PromptEntry {
  id: number;
  name: string;
  modality: string;
  prompts: Record<string, string>;
  version: number;
  libraryOwner: string;
  isActive: boolean;
  isSystem: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: Array<{
    id: number;
    version: number;
    changeNotes: string | null;
    createdBy: string | null;
    createdAt: string;
  }>;
}

interface EditState {
  id: number | null;
  name: string;
  modality: string;
  prompts: Record<string, string>;
  libraryOwner: string;
  changeNotes: string;
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: "",
  modality: "MRI",
  prompts: {},
  libraryOwner: "care_diagnostics",
  changeNotes: "",
};

export default function AiPromptManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [owner, setOwner] = useState("care_diagnostics");
  const [modalityFilter, setModalityFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testPrompt, setTestPrompt] = useState("");
  const [testProvider, setTestProvider] = useState("gemini");
  const [testResult, setTestResult] = useState<{ response: string; success: boolean; error: string | null; elapsedMs: number } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [expandedVersions, setExpandedVersions] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-prompt-library", owner, modalityFilter],
    queryFn: () => api.get<{ entries: PromptEntry[] }>(`/api/ai-prompt-library?owner=${owner}&modality=${modalityFilter === "ALL" ? "" : modalityFilter}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["ai-prompt-library", detailId],
    queryFn: () => api.get<PromptEntry>(`/api/ai-prompt-library/${detailId}`),
    enabled: !!detailId,
  });

  const entries = useMemo(() => {
    let list = data?.entries ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return list;
  }, [data, search]);

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => {
      if (edit.id) {
        return api.put<{ entry: PromptEntry }>(`/api/ai-prompt-library/${edit.id}`, body);
      }
      return api.post<{ entry: PromptEntry }>("/api/ai-prompt-library", body);
    },
    onSuccess: () => {
      toast({ title: edit.id ? "Prompt updated" : "Prompt created" });
      setEditOpen(false);
      setEdit(EMPTY_EDIT);
      refetch();
      qc.invalidateQueries({ queryKey: ["ai-prompt-library"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/ai-prompt-library/${id}`),
    onSuccess: () => {
      toast({ title: "Deleted" });
      setDetailId(null);
      refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const cloneMutation = useMutation({
    mutationFn: (body: { id: number; newName: string; newOwner: string }) =>
      api.post<{ entry: PromptEntry }>(`/api/ai-prompt-library/${body.id}/clone`, body),
    onSuccess: () => {
      toast({ title: "Cloned" });
      refetch();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (body: { id: number; version: number }) =>
      api.post<{ entry: PromptEntry }>(`/api/ai-prompt-library/${body.id}/restore`, body),
    onSuccess: () => {
      toast({ title: "Restored" });
      refetch();
      qc.invalidateQueries({ queryKey: ["ai-prompt-library", detailId] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!edit.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" }); return;
    }
    saveMutation.mutate({
      name: edit.name.trim(),
      modality: edit.modality,
      prompts: edit.prompts,
      libraryOwner: edit.libraryOwner,
      changeNotes: edit.changeNotes || undefined,
    });
  };

  const handleTest = async () => {
    if (!testPrompt.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await api.post<{ response: string; success: boolean; error: string | null; elapsedMs: number }>("/api/ai-prompt-library/test", {
        promptText: testPrompt,
        provider: testProvider,
      });
      setTestResult(res);
    } catch (e) {
      setTestResult({ response: "", success: false, error: e instanceof Error ? e.message : "Unknown error", elapsedMs: 0 });
    } finally {
      setTestLoading(false);
    }
  };

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importJson);
      const res = await api.post<{ imported: Array<{ id: number; name: string }>; skipped: string[]; count: number }>("/api/ai-prompt-library/import", {
        entries: parsed.entries || parsed,
        overwrite: true,
      });
      toast({ title: `Imported ${res.count} prompts` });
      setImportOpen(false);
      setImportJson("");
      refetch();
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    const res = await api.post<{ exportedAt: string; entries: unknown[] }>("/api/ai-prompt-library/export", { owner });
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-prompt-library-${owner}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported" });
  };

  const startEdit = (entry?: PromptEntry) => {
    if (entry) {
      setEdit({
        id: entry.id,
        name: entry.name,
        modality: entry.modality,
        prompts: entry.prompts ?? {},
        libraryOwner: entry.libraryOwner,
        changeNotes: "",
      });
    } else {
      setEdit(EMPTY_EDIT);
    }
    setEditOpen(true);
  };

  const updatePrompt = (key: string, value: string) => {
    setEdit((prev) => ({ ...prev, prompts: { ...prev.prompts, [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="AI Prompt Manager" subtitle="Enterprise prompt library with version control, testing, and doctor-specific libraries" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OWNERS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={modalityFilter} onValueChange={setModalityFilter}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Modalities</SelectItem>
            {MODALITIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search categories..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>

        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1" /> Import
        </Button>
        <Button onClick={() => startEdit()}>
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </div>

      {/* Category list */}
      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground">
          No prompts found for this library. Click "New" to create one, or switch to a different library.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {entries.map((e) => (
            <button
              key={e.id}
              className="text-left rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors"
              onClick={() => setDetailId(e.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary">{e.modality}</Badge>
                <span className="text-[11px] text-muted-foreground">v{e.version}</span>
              </div>
              <div className="font-medium text-sm">{e.name}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {Object.keys(e.prompts ?? {}).length} of {PROMPT_TYPES.length} prompts configured
              </div>
              {e.isSystem && <Badge variant="outline" className="mt-2 text-[10px]">System</Badge>}
            </button>
          ))}
        </div>
      )}

      {/* Detail view */}
      {detailId && detail && (
        <div className="border rounded-lg bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDetailId(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="font-semibold">{detail.name}</div>
                <div className="text-xs text-muted-foreground">
                  {detail.modality} • {OWNERS.find((o) => o.value === detail.libraryOwner)?.label ?? detail.libraryOwner} • v{detail.version}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => startEdit(detail)}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const newName = prompt("Clone as new name:", detail.name + " (Copy)");
                if (newName) cloneMutation.mutate({ id: detail.id, newName, newOwner: detail.libraryOwner });
              }}>
                <Copy className="h-4 w-4 mr-1" /> Clone
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                if (confirm("Delete this prompt?")) deleteMutation.mutate(detail.id);
              }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
          </div>

          {/* Prompts */}
          <div className="space-y-3">
            {PROMPT_TYPES.map((pt) => (
              <div key={pt.key} className="border rounded p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{pt.label}</span>
                  <span className="text-[10px] text-muted-foreground">{pt.desc}</span>
                </div>
                <div className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2 min-h-[40px] whitespace-pre-wrap">
                  {(detail.prompts ?? {})[pt.key] || <span className="italic opacity-50">Not configured</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Version history */}
          <div className="border rounded p-3">
            <button
              className="flex items-center gap-2 text-sm font-medium w-full"
              onClick={() => setExpandedVersions(expandedVersions === detail.id ? null : detail.id)}
            >
              <History className="h-4 w-4" /> Version History
              {expandedVersions === detail.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expandedVersions === detail.id && (
              <div className="mt-2 space-y-1">
                {(detail.versions ?? []).map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-[11px] bg-muted/30 rounded p-2">
                    <div>
                      <span className="font-medium">v{v.version}</span>
                      <span className="text-muted-foreground ml-2">{v.changeNotes || "No notes"}</span>
                      <span className="text-muted-foreground ml-2">{v.createdBy ? `by ${v.createdBy}` : ""} {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : ""}</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => {
                      if (confirm(`Restore version ${v.version}? This will create a new version.`)) {
                        restoreMutation.mutate({ id: detail.id, version: v.version });
                      }
                    }}>
                      <Save className="h-3 w-3 mr-1" /> Restore
                    </Button>
                  </div>
                ))}
                {(detail.versions ?? []).length === 0 && (
                  <div className="text-[11px] text-muted-foreground">No version history yet.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit.id ? "Edit Prompt" : "New Prompt"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={edit.name} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. MRI Brain" />
              </div>
              <div>
                <Label>Modality</Label>
                <Select value={edit.modality} onValueChange={(v) => setEdit((p) => ({ ...p, modality: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODALITIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Library Owner</Label>
              <Select value={edit.libraryOwner} onValueChange={(v) => setEdit((p) => ({ ...p, libraryOwner: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OWNERS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {edit.id && (
              <div>
                <Label>Change Notes</Label>
                <Input value={edit.changeNotes} onChange={(e) => setEdit((p) => ({ ...p, changeNotes: e.target.value }))} placeholder="What changed in this version?" />
              </div>
            )}
            <div className="space-y-3">
              {PROMPT_TYPES.map((pt) => (
                <div key={pt.key}>
                  <Label className="text-xs">{pt.label} <span className="text-muted-foreground font-normal">{pt.desc}</span></Label>
                  <Textarea
                    value={edit.prompts[pt.key] || ""}
                    onChange={(e) => updatePrompt(pt.key, e.target.value)}
                    placeholder={`Enter ${pt.label.toLowerCase()}...`}
                    rows={3}
                    className="text-xs mt-1"
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between">
            <Button variant="outline" onClick={() => {
              setTestPrompt(edit.prompts["system"] || "");
              setTestOpen(true);
            }}>
              <Terminal className="h-4 w-4 mr-1" /> Test Prompt
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Test Prompt</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Provider</Label>
              <Select value={testProvider} onValueChange={setTestProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prompt</Label>
              <Textarea value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} rows={6} />
            </div>
            <Button onClick={handleTest} disabled={testLoading} className="w-full">
              {testLoading ? <Sparkles className="h-4 w-4 animate-spin mr-1" /> : <Terminal className="h-4 w-4 mr-1" />}
              Run Test
            </Button>
            {testResult && (
              <div className="border rounded p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  {testResult.success ? <Check className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
                  <span>{testResult.success ? "Success" : "Failed"}</span>
                  <span className="text-muted-foreground">{testResult.elapsedMs}ms</span>
                </div>
                <div className="text-[11px] whitespace-pre-wrap bg-muted/30 rounded p-2">{testResult.response}</div>
                {testResult.error && <div className="text-[11px] text-red-600">{testResult.error}</div>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Prompt Library</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder="Paste JSON here..."
              rows={12}
              className="text-xs font-mono"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button onClick={handleImport}>
                <Upload className="h-4 w-4 mr-1" /> Import
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-sm font-medium mb-1 ${className ?? ""}`}>{children}</div>;
}
