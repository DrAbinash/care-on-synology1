// ── Phase 4: Radiology Knowledge Platform Panel ──
// Integrates master templates, personal library, template packs, knowledge base,
// sign-off profiles, version history, and usage analytics into the report workspace.

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession } from "@/lib/staffSession";
import {
  BookOpen, Star, Layers, FolderOpen, History, BarChart3, UserCircle,
  Search, Plus, Copy, Check, Trash2, X, ChevronRight, ChevronDown,
  Lock, Unlock, Clock, ArrowLeftRight, Eye, RefreshCw, AlertCircle,
  Sparkles, FileText, Brain,
} from "lucide-react";

// ── Types ──

interface MasterTemplate {
  id: number;
  groupName: string;
  templateName: string;
  modality: string;
  studyType: string | null;
  bodyPart: string | null;
  findings: string;
  impression: string;
  recommendations: string | null;
  tags: string[];
  version: number;
  isLocked: boolean;
  isActive: boolean;
  createdBy: string | null;
  modifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PersonalTemplate {
  id: number;
  staffId: number;
  folder: string;
  templateName: string;
  modality: string | null;
  studyType: string | null;
  bodyPart: string | null;
  findings: string | null;
  impression: string | null;
  recommendations: string | null;
  measurements: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateVersion {
  id: number;
  masterTemplateId: number;
  version: number;
  findings: string;
  impression: string;
  recommendations: string | null;
  tags: string[];
  changeNotes: string | null;
  changedBy: string | null;
  changedAt: string;
}

interface TemplatePack {
  id: number;
  staffId: number;
  packName: string;
  description: string | null;
  templateIds: number[];
  isActive: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeArticle {
  id: number;
  title: string;
  category: string;
  content: string;
  classificationSystem: string | null;
  classificationGrades: string[];
  measurementReferences: string | null;
  reportingTips: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RadiologistProfile {
  id: number;
  staffId: number;
  profileName: string;
  defaultMasterGroup: string | null;
  defaultModality: string | null;
  defaultBodyPart: string | null;
  defaultTemplateIds: number[];
  autoImpression: boolean;
  autoPriority: boolean;
  showKnowledgeBase: boolean;
  showTemplatePacks: boolean;
  aiDraftEnabled: boolean;
  aiComparisonEnabled: boolean;
  aiVoiceEnabled: boolean;
  updatedAt: string;
}

interface TemplateUsage {
  id: number;
  staffId: number;
  templateId: number;
  templateSource: string;
  templateName: string;
  modality: string | null;
  bodyPart: string | null;
  action: string;
  studyId: number | null;
  createdAt: string;
}

interface AnalyticsGlobal {
  totalUsage: number;
  topTemplates: { templateName: string; count: number }[];
  topFindings: { finding: string; count: number }[];
  topImpressions: { impression: string; count: number }[];
  mostActiveProfile: string | null;
  dailyUsage: { date: string; count: number }[];
}

// ── Constants ──

const MASTER_GROUPS = [
  { id: "DR_SUGANDHA_MASTER", label: "Dr Sugandha Master" },
  { id: "DR_ABINASH_MASTER", label: "Dr Abinash Master" },
  { id: "CARE_DIAGNOSTICS_MASTER", label: "Care Diagnostics" },
  { id: "HOPE_HOSPITAL_MASTER", label: "Hope Hospital" },
];

const PERSONAL_FOLDERS = [
  "Brain", "Spine", "Chest", "Abdomen", "Pelvis", "MSK", "Obstetric", "General",
];

const KNOWLEDGE_CATEGORIES = [
  "Brain", "Spine", "Chest", "Abdomen", "Pelvis", "MSK", "Obstetrics", "General",
];

const MODALITIES = ["MR", "CT", "US", "XR", "NM", "PET", "MG"];

// ── Helpers ──

function getStaffRole(): string {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("erp_session") : null;
    if (!raw) return "";
    const s = JSON.parse(raw);
    return s?.user?.role?.toLowerCase() ?? "";
  } catch { return ""; }
}

function isAdminRole(): boolean {
  const r = getStaffRole();
  return r === "admin" || r === "super_admin";
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// ── 1. Master Template Library Panel ──

function MasterTemplateLibraryPanel({
  onUse,
  onInsert,
}: {
  onUse?: (t: MasterTemplate) => void;
  onInsert?: (text: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeGroup, setActiveGroup] = useState("DR_SUGANDHA_MASTER");
  const [query, setQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MasterTemplate | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const { data: templates = [], isLoading } = useQuery<MasterTemplate[]>({
    queryKey: ["radiology-master-templates", activeGroup],
    queryFn: () => api.get(`/api/radiology/knowledge/master-templates?group=${encodeURIComponent(activeGroup)}`),
    enabled: true,
  });

  const { data: versions = [] } = useQuery<TemplateVersion[]>({
    queryKey: ["radiology-template-versions", selectedTemplate?.id],
    queryFn: () => api.get(`/api/radiology/knowledge/master-templates/${selectedTemplate!.id}/versions`),
    enabled: !!selectedTemplate?.id && showVersions,
  });

  const cloneMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/radiology/knowledge/master-templates/${id}/clone`, {}),
    onSuccess: () => {
      toast({ title: "Cloned to personal library" });
      void qc.invalidateQueries({ queryKey: ["radiology-personal-templates"] });
    },
    onError: () => toast({ title: "Clone failed", variant: "destructive" }),
  });

  const favoriteMutation = useMutation({
    mutationFn: (templateId: number) => api.post(`/api/radiology/knowledge/favorites`, {
      templateId, templateSource: "master", folder: "Favorites",
    }),
    onSuccess: () => toast({ title: "Added to favorites" }),
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter((t) =>
      t.templateName.toLowerCase().includes(q) ||
      t.modality.toLowerCase().includes(q) ||
      (t.bodyPart?.toLowerCase() ?? "").includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      t.findings.toLowerCase().includes(q)
    );
  }, [templates, query]);

  const handleUse = (t: MasterTemplate) => {
    if (onUse) onUse(t);
    else {
      const text = `\n${t.findings}\n\nIMPRESSION: ${t.impression}\n${t.recommendations ? `\nRECOMMENDATIONS: ${t.recommendations}` : ""}\n`;
      if (onInsert) onInsert(text);
    }
    toast({ title: `Applied: ${t.templateName}` });
  };

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <BookOpen className="h-3 w-3" /> Master Template Library
      </h3>

      {/* Group tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {MASTER_GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => { setActiveGroup(g.id); setSelectedTemplate(null); setShowVersions(false); }}
            className={`text-[10px] px-2 py-1 rounded border whitespace-nowrap ${activeGroup === g.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          className="h-7 text-xs pl-7"
          placeholder="Search by name, modality, body part, tag..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Template list */}
      {isLoading ? (
        <p className="text-[10px] text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No templates found.</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`rounded border bg-background px-2 py-1.5 text-xs space-y-1 ${selectedTemplate?.id === t.id ? "border-primary ring-1 ring-primary/30" : "border-card-border"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{t.templateName}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">{t.modality}</Badge>
                  {t.bodyPart && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{t.bodyPart}</Badge>}
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => handleUse(t)} className="p-1 rounded hover:bg-green-100" title="Use">
                    <Check className="h-3 w-3 text-green-600" />
                  </button>
                  <button onClick={() => cloneMutation.mutate(t.id)} className="p-1 rounded hover:bg-blue-100" title="Clone to personal">
                    <Copy className="h-3 w-3 text-blue-600" />
                  </button>
                  <button onClick={() => favoriteMutation.mutate(t.id)} className="p-1 rounded hover:bg-amber-100" title="Favorite">
                    <Star className="h-3 w-3 text-amber-600" />
                  </button>
                  <button onClick={() => { setSelectedTemplate(t); setShowVersions(true); }} className="p-1 rounded hover:bg-purple-100" title="Versions">
                    <History className="h-3 w-3 text-purple-600" />
                  </button>
                </div>
              </div>
              {selectedTemplate?.id === t.id && (
                <div className="border-t border-dashed pt-1 space-y-1">
                  <p className="text-[10px] text-muted-foreground line-clamp-2">{t.findings}</p>
                  <p className="text-[10px] font-medium">IMP: {t.impression}</p>
                  {t.recommendations && <p className="text-[10px] text-muted-foreground">Rec: {t.recommendations}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Version history popover */}
      {showVersions && selectedTemplate && (
        <div className="border rounded-md bg-muted/20 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold">Versions of {selectedTemplate.templateName}</span>
            <button onClick={() => setShowVersions(false)} className="p-0.5 rounded hover:bg-muted">
              <X className="h-3 w-3" />
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No versions recorded.</p>
          ) : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div key={v.id} className="text-[10px] flex items-start gap-1.5 border-t border-dashed pt-1">
                  <Badge variant="outline" className="text-[8px] h-3 px-0.5 shrink-0">v{v.version}</Badge>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">{v.changeNotes || "Version update"}</p>
                    <p className="text-[9px] text-muted-foreground">{v.changedBy || "Unknown"} · {new Date(v.changedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 2. Personal Library Panel ──

function PersonalLibraryPanel({
  onInsert,
  selectedText,
}: {
  onInsert: (text: string) => void;
  selectedText?: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeFolder, setActiveFolder] = useState("General");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PersonalTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFindings, setNewFindings] = useState("");
  const [newImpression, setNewImpression] = useState("");
  const [newFolder, setNewFolder] = useState("General");

  const { data: templates = [], isLoading } = useQuery<PersonalTemplate[]>({
    queryKey: ["radiology-personal-templates"],
    queryFn: () => api.get(`/api/radiology/knowledge/personal-templates`),
    enabled: true,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/radiology/knowledge/personal-templates`, body),
    onSuccess: () => {
      toast({ title: "Saved to personal library" });
      void qc.invalidateQueries({ queryKey: ["radiology-personal-templates"] });
      setShowCreate(false);
      setNewName(""); setNewFindings(""); setNewImpression(""); setNewFolder("General");
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.patch(`/api/radiology/knowledge/personal-templates/${id}`, body),
    onSuccess: () => {
      toast({ title: "Updated" });
      void qc.invalidateQueries({ queryKey: ["radiology-personal-templates"] });
      setEditing(null);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/knowledge/personal-templates/${id}`),
    onSuccess: () => {
      toast({ title: "Deleted" });
      void qc.invalidateQueries({ queryKey: ["radiology-personal-templates"] });
      setEditing(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let items = templates.filter((t) => t.isActive);
    if (activeFolder !== "All") items = items.filter((t) => t.folder === activeFolder);
    const q = query.toLowerCase().trim();
    if (q) {
      items = items.filter((t) =>
        t.templateName.toLowerCase().includes(q) ||
        (t.modality?.toLowerCase() ?? "").includes(q) ||
        (t.bodyPart?.toLowerCase() ?? "").includes(q)
      );
    }
    return items;
  }, [templates, activeFolder, query]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    PERSONAL_FOLDERS.forEach((f) => { counts[f] = 0; });
    templates.filter((t) => t.isActive).forEach((t) => {
      counts[t.folder] = (counts[t.folder] || 0) + 1;
    });
    return counts;
  }, [templates]);

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <FolderOpen className="h-3 w-3" /> Personal Library
      </h3>

      {/* Folder tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveFolder("All")}
          className={`text-[10px] px-2 py-1 rounded border ${activeFolder === "All" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
        >
          All
        </button>
        {PERSONAL_FOLDERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFolder(f)}
            className={`text-[10px] px-2 py-1 rounded border ${activeFolder === f ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
          >
            {f} ({folderCounts[f] || 0})
          </button>
        ))}
      </div>

      {/* Search + Save selection */}
      <div className="flex gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input className="h-7 text-xs pl-7" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {selectedText && (
          <Button size="sm" className="h-7 text-[10px] px-2" onClick={() => {
            setNewFindings(selectedText);
            setShowCreate(true);
          }} title="Save selected text as template">
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border rounded-md p-2 space-y-2 bg-muted/20">
          <Input className="h-7 text-xs" placeholder="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select className="h-7 text-xs rounded border bg-background px-2" value={newFolder} onChange={(e) => setNewFolder(e.target.value)}>
            {PERSONAL_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <textarea className="w-full text-xs rounded border bg-background px-2 py-1 min-h-[60px]" placeholder="Findings" value={newFindings} onChange={(e) => setNewFindings(e.target.value)} />
          <textarea className="w-full text-xs rounded border bg-background px-2 py-1 min-h-[30px]" placeholder="Impression (optional)" value={newImpression} onChange={(e) => setNewImpression(e.target.value)} />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-[10px]" onClick={() => {
              if (!newName.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
              createMutation.mutate({
                folder: newFolder, templateName: newName.trim(),
                findings: newFindings, impression: newImpression || null,
                modality: null, bodyPart: null,
              });
            }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Template list */}
      {isLoading ? (
        <p className="text-[10px] text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No personal templates. Save selected text to create one.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {filtered.map((t) => (
            <div key={t.id} className="rounded border bg-background px-2 py-1.5 text-xs space-y-1 border-card-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="font-medium">{t.templateName}</span>
                  <Badge variant="outline" className="text-[8px] h-3 px-0.5">{t.folder}</Badge>
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => {
                    const text = `\n${t.findings || ""}\n${t.impression ? `\nIMPRESSION: ${t.impression}` : ""}\n`;
                    onInsert(text);
                    toast({ title: `Inserted: ${t.templateName}` });
                  }} className="p-1 rounded hover:bg-green-100" title="Insert">
                    <Check className="h-3 w-3 text-green-600" />
                  </button>
                  <button onClick={() => setEditing(t)} className="p-1 rounded hover:bg-blue-100" title="Edit">
                    <Sparkles className="h-3 w-3 text-blue-600" />
                  </button>
                  <button onClick={() => {
                    if (confirm("Delete this template?")) deleteMutation.mutate(t.id);
                  }} className="p-1 rounded hover:bg-red-100" title="Delete">
                    <Trash2 className="h-3 w-3 text-red-600" />
                  </button>
                </div>
              </div>
              {editing?.id === t.id && (
                <div className="border-t border-dashed pt-1 space-y-1">
                  <Input className="h-7 text-xs" defaultValue={t.templateName} onBlur={(e) => {
                    updateMutation.mutate({ id: t.id, body: { templateName: e.target.value } });
                  }} />
                  <textarea className="w-full text-xs rounded border bg-background px-2 py-1 min-h-[40px]" defaultValue={t.findings || ""} onBlur={(e) => {
                    updateMutation.mutate({ id: t.id, body: { findings: e.target.value } });
                  }} />
                  <textarea className="w-full text-xs rounded border bg-background px-2 py-1 min-h-[30px]" defaultValue={t.impression || ""} onBlur={(e) => {
                    updateMutation.mutate({ id: t.id, body: { impression: e.target.value } });
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3. Template Packs Panel ──

function TemplatePacksPanel({
  onInsert,
}: {
  onInsert: (text: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [packName, setPackName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: packs = [] } = useQuery<TemplatePack[]>({
    queryKey: ["radiology-template-packs"],
    queryFn: () => api.get(`/api/radiology/knowledge/template-packs`),
  });

  const { data: personalTemplates = [] } = useQuery<PersonalTemplate[]>({
    queryKey: ["radiology-personal-templates"],
    queryFn: () => api.get(`/api/radiology/knowledge/personal-templates`),
  });

  const createPackMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/radiology/knowledge/template-packs`, body),
    onSuccess: () => {
      toast({ title: "Pack created" });
      void qc.invalidateQueries({ queryKey: ["radiology-template-packs"] });
      setShowCreate(false);
      setPackName(""); setDescription(""); setSelectedIds([]);
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const applyPack = (pack: TemplatePack) => {
    const items = personalTemplates.filter((t) => pack.templateIds.includes(t.id));
    const text = items.map((t) =>
      `\n${t.templateName}\n${t.findings || ""}\n${t.impression ? `IMPRESSION: ${t.impression}` : ""}`
    ).join("\n\n---\n\n");
    onInsert(text + "\n");
    toast({ title: `Applied pack: ${pack.packName}` });
  };

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Layers className="h-3 w-3" /> Template Packs
      </h3>

      <div className="flex gap-1">
        <Button size="sm" className="h-7 text-[10px]" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" /> New Pack
        </Button>
      </div>

      {showCreate && (
        <div className="border rounded-md p-2 space-y-2 bg-muted/20">
          <Input className="h-7 text-xs" placeholder="Pack name" value={packName} onChange={(e) => setPackName(e.target.value)} />
          <Input className="h-7 text-xs" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <p className="text-[10px] font-semibold">Select templates:</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {personalTemplates.filter((t) => t.isActive).map((t) => (
              <label key={t.id} className="flex items-center gap-1 text-[10px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(t.id)}
                  onChange={() => setSelectedIds((prev) => prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id])}
                />
                {t.templateName} ({t.folder})
              </label>
            ))}
            {personalTemplates.filter((t) => t.isActive).length === 0 && (
              <p className="text-[10px] text-muted-foreground">Create personal templates first.</p>
            )}
          </div>
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-[10px]" onClick={() => {
              if (!packName.trim() || selectedIds.length === 0) { toast({ title: "Name and at least 1 template required", variant: "destructive" }); return; }
              createPackMutation.mutate({ packName: packName.trim(), description: description || null, templateIds: selectedIds });
            }}>Create</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {packs.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No packs yet. Create one from your personal templates.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {packs.filter((p) => p.isActive).map((p) => (
            <div key={p.id} className="rounded border bg-background px-2 py-1.5 text-xs border-card-border">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.packName}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">({p.templateIds.length} templates)</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => applyPack(p)} className="p-1 rounded hover:bg-green-100" title="Load pack">
                    <Check className="h-3 w-3 text-green-600" />
                  </button>
                  <button onClick={() => {
                    const items = personalTemplates.filter((t) => p.templateIds.includes(t.id));
                    alert(items.map((t) => `${t.templateName}\n${t.findings || ""}\n${t.impression || ""}`).join("\n\n---\n\n"));
                  }} className="p-1 rounded hover:bg-blue-100" title="Preview">
                    <Eye className="h-3 w-3 text-blue-600" />
                  </button>
                </div>
              </div>
              {p.description && <p className="text-[10px] text-muted-foreground">{p.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 4. Knowledge Base Sidebar Panel ──

function KnowledgeBaseSidebarPanel({
  onInsert,
}: {
  onInsert: (text: string) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeArticle | null>(null);

  const { data: articles = [], isLoading } = useQuery<KnowledgeArticle[]>({
    queryKey: ["radiology-knowledge-base", category, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (query.trim()) params.set("q", query.trim());
      return api.get(`/api/radiology/knowledge/knowledge-base?${params.toString()}`).then((r: { articles: KnowledgeArticle[] }) => r.articles);
    },
  });

  const handleInsert = (article: KnowledgeArticle) => {
    const text = `\n[${article.title} - ${article.classificationSystem || article.category}]\n${article.content}\n${article.measurementReferences ? `\nRef: ${article.measurementReferences}` : ""}\n${article.reportingTips ? `\nTips: ${article.reportingTips}` : ""}\n`;
    onInsert(text);
    toast({ title: `Inserted: ${article.title}` });
  };

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Brain className="h-3 w-3" /> Knowledge Base
      </h3>

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setCategory("")}
          className={`text-[10px] px-2 py-1 rounded border ${category === "" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
        >
          All
        </button>
        {KNOWLEDGE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`text-[10px] px-2 py-1 rounded border ${category === c ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input className="h-7 text-xs pl-7" placeholder="Search knowledge base..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {/* Articles */}
      {isLoading ? (
        <p className="text-[10px] text-muted-foreground">Loading...</p>
      ) : articles.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No articles found.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {articles.map((a) => (
            <div key={a.id} className={`rounded border bg-background px-2 py-1.5 text-xs border-card-border ${selectedArticle?.id === a.id ? "ring-1 ring-primary/30" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="font-medium">{a.title}</span>
                  <Badge variant="outline" className="text-[8px] h-3 px-0.5">{a.category}</Badge>
                  {a.classificationSystem && <Badge variant="outline" className="text-[8px] h-3 px-0.5">{a.classificationSystem}</Badge>}
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => handleInsert(a)} className="p-1 rounded hover:bg-green-100" title="Insert reference">
                    <Check className="h-3 w-3 text-green-600" />
                  </button>
                  <button onClick={() => setSelectedArticle(selectedArticle?.id === a.id ? null : a)} className="p-1 rounded hover:bg-blue-100" title="View">
                    <Eye className="h-3 w-3 text-blue-600" />
                  </button>
                </div>
              </div>
              {selectedArticle?.id === a.id && (
                <div className="border-t border-dashed pt-1 mt-1 space-y-1">
                  <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">{a.content}</p>
                  {a.classificationGrades.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {a.classificationGrades.map((g) => (
                        <Badge key={g} variant="outline" className="text-[8px] h-3 px-0.5">{g}</Badge>
                      ))}
                    </div>
                  )}
                  {a.measurementReferences && <p className="text-[10px] text-muted-foreground">Ref: {a.measurementReferences}</p>}
                  {a.reportingTips && <p className="text-[10px] text-muted-foreground">Tips: {a.reportingTips}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 5. Sign-off Profile Switcher Panel ──

function SignOffProfileSwitcherPanel({
  onProfileChange,
}: {
  onProfileChange?: (profile: RadiologistProfile) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  const { data: profile, isLoading } = useQuery<RadiologistProfile>({
    queryKey: ["radiologist-profile"],
    queryFn: () => api.get(`/api/radiology/knowledge/profiles`),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/api/radiology/knowledge/profiles`, body),
    onSuccess: (updated) => {
      toast({ title: "Profile updated" });
      void qc.invalidateQueries({ queryKey: ["radiologist-profile"] });
      if (onProfileChange) onProfileChange(updated as unknown as RadiologistProfile);
      setEditing(false);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const groups = [
    { id: "DR_SUGANDHA_MASTER", label: "Dr Sugandha" },
    { id: "DR_ABINASH_MASTER", label: "Dr Abinash" },
    { id: "CARE_DIAGNOSTICS_MASTER", label: "Care Diagnostics" },
    { id: "HOPE_HOSPITAL_MASTER", label: "Hope Hospital" },
  ];

  if (isLoading) return (
    <div className="shrink-0 border-t p-3">
      <p className="text-[10px] text-muted-foreground">Loading profile...</p>
    </div>
  );

  const p = profile ?? {
    id: 0, staffId: 0, profileName: "Default", defaultMasterGroup: null,
    defaultModality: null, defaultBodyPart: null, defaultTemplateIds: [],
    autoImpression: false, autoPriority: false, showKnowledgeBase: true,
    showTemplatePacks: true, aiDraftEnabled: false, aiComparisonEnabled: false,
    aiVoiceEnabled: false, updatedAt: "",
  };

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <UserCircle className="h-3 w-3" /> Sign-off Profile
      </h3>

      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{p.profileName}</span>
        <button onClick={() => setEditing((v) => !v)} className="text-[10px] text-muted-foreground hover:text-primary">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing && (
        <div className="border rounded-md p-2 space-y-2 bg-muted/20">
          <label className="text-[10px] block">Profile Name</label>
          <Input className="h-7 text-xs" defaultValue={p.profileName} onBlur={(e) => updateMutation.mutate({ profileName: e.target.value })} />

          <label className="text-[10px] block">Preferred Master Group</label>
          <select className="h-7 text-xs rounded border bg-background px-2 w-full" defaultValue={p.defaultMasterGroup || ""} onChange={(e) => updateMutation.mutate({ defaultMasterGroup: e.target.value || null })}>
            <option value="">None</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>

          <label className="text-[10px] block">Default Modality</label>
          <select className="h-7 text-xs rounded border bg-background px-2 w-full" defaultValue={p.defaultModality || ""} onChange={(e) => updateMutation.mutate({ defaultModality: e.target.value || null })}>
            <option value="">Any</option>
            {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <label className="text-[10px] block">Default Body Part</label>
          <Input className="h-7 text-xs" defaultValue={p.defaultBodyPart || ""} onBlur={(e) => updateMutation.mutate({ defaultBodyPart: e.target.value || null })} />

          <div className="space-y-1 pt-1">
            {[
              { key: "autoImpression", label: "Auto-suggest impression" },
              { key: "autoPriority", label: "Auto-classify priority" },
              { key: "showKnowledgeBase", label: "Show knowledge base" },
              { key: "showTemplatePacks", label: "Show template packs" },
              { key: "aiDraftEnabled", label: "AI draft enabled" },
              { key: "aiComparisonEnabled", label: "AI comparison" },
              { key: "aiVoiceEnabled", label: "AI voice dictation" },
            ].map((opt) => (
              <label key={opt.key} className="flex items-center gap-1 text-[10px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={(p as unknown as Record<string, boolean>)[opt.key] ?? false}
                  onChange={(e) => updateMutation.mutate({ [opt.key]: e.target.checked })}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Quick group switch buttons */}
      <div className="flex gap-1 flex-wrap">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => updateMutation.mutate({ defaultMasterGroup: g.id })}
            className={`text-[10px] px-2 py-1 rounded border ${p.defaultMasterGroup === g.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 6. Template Version History Panel ──

function TemplateVersionHistoryPanel() {
  const { toast } = useToast();
  const [selectedMaster, setSelectedMaster] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);

  const { data: masters = [] } = useQuery<MasterTemplate[]>({
    queryKey: ["radiology-master-templates-all"],
    queryFn: () => api.get(`/api/radiology/knowledge/master-templates`),
  });

  const { data: versions = [] } = useQuery<TemplateVersion[]>({
    queryKey: ["radiology-template-versions", selectedMaster],
    queryFn: () => api.get(`/api/radiology/knowledge/master-templates/${selectedMaster}/versions`),
    enabled: !!selectedMaster,
  });

  const admin = isAdminRole();

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <History className="h-3 w-3" /> Version History
      </h3>

      {/* Master selector */}
      <select
        className="h-7 text-xs rounded border bg-background px-2 w-full"
        value={selectedMaster ?? ""}
        onChange={(e) => { setSelectedMaster(e.target.value ? Number(e.target.value) : null); setCompareVersion(null); }}
      >
        <option value="">Select a master template...</option>
        {masters.map((m) => (
          <option key={m.id} value={m.id}>{m.templateName} ({m.groupName})</option>
        ))}
      </select>

      {selectedMaster && versions.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No versions recorded.</p>
      )}

      {versions.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {versions.map((v, i) => {
            const prev = versions[i + 1];
            return (
              <div key={v.id} className="rounded border bg-background px-2 py-1.5 text-xs border-card-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[8px] h-3 px-0.5">v{v.version}</Badge>
                    <span className="text-[10px] text-muted-foreground">{v.changeNotes || "Update"}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => setCompareVersion(compareVersion === v.version ? null : v.version)} className="p-1 rounded hover:bg-blue-100" title="Compare">
                      <ArrowLeftRight className="h-3 w-3 text-blue-600" />
                    </button>
                    {admin && (
                      <button onClick={() => {
                        if (confirm(`Restore version ${v.version}?`)) {
                          api.post(`/api/radiology/knowledge/master-templates/${selectedMaster}/restore`, { version: v.version })
                            .then(() => toast({ title: `Restored v${v.version}` }))
                            .catch(() => toast({ title: "Restore failed", variant: "destructive" }));
                        }
                      }} className="p-1 rounded hover:bg-amber-100" title="Restore (admin only)">
                        <RefreshCw className="h-3 w-3 text-amber-600" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground">{v.changedBy || "Unknown"} · {new Date(v.changedAt).toLocaleDateString()}</p>

                {compareVersion === v.version && prev && (
                  <div className="border-t border-dashed pt-1 mt-1 space-y-1">
                    <p className="text-[10px] font-semibold">Compare v{prev.version} → v{v.version}</p>
                    {v.findings !== prev.findings && (
                      <div className="text-[10px] space-y-0.5">
                        <p className="text-red-600">- {prev.findings.slice(0, 100)}...</p>
                        <p className="text-green-600">+ {v.findings.slice(0, 100)}...</p>
                      </div>
                    )}
                    {v.impression !== prev.impression && (
                      <div className="text-[10px] space-y-0.5">
                        <p className="text-red-600">- IMP: {prev.impression.slice(0, 80)}...</p>
                        <p className="text-green-600">+ IMP: {v.impression.slice(0, 80)}...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!admin && selectedMaster && (
        <p className="text-[10px] text-muted-foreground">View-only. Admin can restore versions.</p>
      )}
    </div>
  );
}

// ── 7. Usage Analytics Mini Panel ──

function UsageAnalyticsPanel() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const admin = isAdminRole();

  const { data: myAnalytics = [] } = useQuery<TemplateUsage[]>({
    queryKey: ["radiology-analytics-me", range],
    queryFn: () => api.get(`/api/radiology/knowledge/analytics/usage?range=${range}`),
    enabled: true,
  });

  const { data: globalAnalytics } = useQuery<AnalyticsGlobal>({
    queryKey: ["radiology-analytics-global", range],
    queryFn: () => api.get(`/api/radiology/knowledge/analytics/global?range=${range}`),
    enabled: admin,
  });

  if (!admin) {
    return (
      <div className="shrink-0 border-t p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <BarChart3 className="h-3 w-3" /> My Usage
        </h3>
        <p className="text-[10px] text-muted-foreground mt-1">Recent: {myAnalytics.length} template uses</p>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <BarChart3 className="h-3 w-3" /> Usage Analytics (Admin)
      </h3>

      <div className="flex gap-1">
        {(["7d", "30d", "90d"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`text-[10px] px-2 py-1 rounded border ${range === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-card-border hover:bg-muted"}`}
          >
            {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
          </button>
        ))}
      </div>

      {globalAnalytics ? (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Usage</span>
            <span className="font-semibold">{globalAnalytics.totalUsage}</span>
          </div>

          {globalAnalytics.mostActiveProfile && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Most Active</span>
              <span className="font-semibold">{globalAnalytics.mostActiveProfile}</span>
            </div>
          )}

          {globalAnalytics.topTemplates.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold mb-1">Top Templates</p>
              <div className="space-y-0.5">
                {globalAnalytics.topTemplates.slice(0, 5).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="truncate max-w-[120px]">{t.templateName}</span>
                    <span className="text-muted-foreground">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {myAnalytics.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold mb-1">My Recent ({myAnalytics.length})</p>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {myAnalytics.slice(0, 10).map((u, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="truncate max-w-[120px]">{u.templateName}</span>
                    <span className="text-muted-foreground">{u.action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">No analytics data yet.</p>
      )}
    </div>
  );
}

// ── Main Exported Component ──

export interface RadiologyKnowledgePanelProps {
  activePanel: string | null;
  onInsert: (text: string) => void;
  selectedText?: string;
}

export default function RadiologyKnowledgePanel({ activePanel, onInsert, selectedText }: RadiologyKnowledgePanelProps) {
  if (!activePanel) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      {activePanel === "master" && <MasterTemplateLibraryPanel onInsert={onInsert} />}
      {activePanel === "personal" && <PersonalLibraryPanel onInsert={onInsert} selectedText={selectedText} />}
      {activePanel === "packs" && <TemplatePacksPanel onInsert={onInsert} />}
      {activePanel === "knowledge" && <KnowledgeBaseSidebarPanel onInsert={onInsert} />}
      {activePanel === "profile" && <SignOffProfileSwitcherPanel />}
      {activePanel === "versions" && <TemplateVersionHistoryPanel />}
      {activePanel === "analytics" && <UsageAnalyticsPanel />}
    </div>
  );
}
