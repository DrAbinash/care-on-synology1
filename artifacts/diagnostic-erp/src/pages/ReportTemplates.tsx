import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Edit2, Trash2, RefreshCw, Save, X, Copy,
  FileText, Sparkles, BookOpen, ChevronDown, ChevronUp, Search,
  Download, Star, StarOff,
} from "lucide-react";

interface StructuredTemplate {
  id: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  studyType: string | null;
  sectionsJson: string | null;
  defaultFindings: string | null;
  defaultImpression: string | null;
  macrosJson: string | null;
  isActive: boolean;
  isPreset: boolean;
  createdBy: string | null;
  updatedAt: string;
}

interface Macro {
  key: string;
  label: string;
  text: string;
}

interface Sections {
  technique?: string;
  findingsItems?: { label: string; normal: string }[];
}

const MODALITIES = ["MRI", "CT", "USG", "X-RAY", "DOPPLER", "ECHO", "PET-CT", "FLUOROSCOPY", "OTHER"];
const BODY_PARTS = ["BRAIN", "SPINE_LS", "SPINE_CERVICAL", "SPINE_DORSAL", "CHEST", "ABDOMEN", "PELVIS", "CARDIAC", "NECK", "KNEE", "SHOULDER", "HIP", "CAROTID", "OTHER"];

const MODALITY_COLORS: Record<string, string> = {
  MRI: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  CT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  USG: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  "X-RAY": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  DOPPLER: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

// ─── Template Form ────────────────────────────────────────────────────────────
function TemplateForm({
  template,
  onSave,
  onClose,
}: {
  template?: StructuredTemplate;
  onSave: (data: object) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.templateName ?? "");
  const [modality, setModality] = useState(template?.modality ?? "MRI");
  const [bodyPart, setBodyPart] = useState(template?.bodyPart ?? "BRAIN");
  const [studyType, setStudyType] = useState(template?.studyType ?? "");
  const [technique, setTechnique] = useState(() => {
    try { return (JSON.parse(template?.sectionsJson ?? "{}") as Sections).technique ?? ""; }
    catch { return ""; }
  });
  const [findingsItems, setFindingsItems] = useState<{ label: string; normal: string }[]>(() => {
    try { return (JSON.parse(template?.sectionsJson ?? "{}") as Sections).findingsItems ?? []; }
    catch { return []; }
  });
  const [defaultFindings, setDefaultFindings] = useState(template?.defaultFindings ?? "");
  const [defaultImpression, setDefaultImpression] = useState(template?.defaultImpression ?? "");
  const [macros, setMacros] = useState<Macro[]>(() => {
    try { return JSON.parse(template?.macrosJson ?? "[]") as Macro[]; }
    catch { return []; }
  });

  function addFindingsItem() {
    setFindingsItems([...findingsItems, { label: "", normal: "" }]);
  }
  function removeFindingsItem(i: number) {
    setFindingsItems(findingsItems.filter((_, idx) => idx !== i));
  }
  function updateFindingsItem(i: number, field: "label" | "normal", value: string) {
    setFindingsItems(findingsItems.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }
  function addMacro() {
    setMacros([...macros, { key: `macro_${Date.now()}`, label: "", text: "" }]);
  }
  function removeMacro(i: number) {
    setMacros(macros.filter((_, idx) => idx !== i));
  }
  function updateMacro(i: number, field: keyof Macro, value: string) {
    setMacros(macros.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  }

  function handleSave() {
    const sectionsJson = JSON.stringify({ technique, findingsItems });
    const macrosJson = JSON.stringify(macros);
    onSave({ templateName: name, modality, bodyPart, studyType: studyType || null, sectionsJson, defaultFindings, defaultImpression, macrosJson });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-background border-l shadow-2xl overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{template ? "Edit Template" : "New Template"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X size={16} /></button>
        </div>

        {/* Basic info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Template Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" placeholder="e.g. MRI Brain Plain" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Modality</label>
            <select value={modality} onChange={(e) => setModality(e.target.value)} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
              {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Body Part</label>
            <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
              {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Study Type (optional)</label>
            <input value={studyType} onChange={(e) => setStudyType(e.target.value)} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" placeholder="e.g. PLAIN, CONTRAST, DOPPLER" />
          </div>
        </div>

        {/* Technique */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground">Technique / Protocol</label>
          <textarea value={technique} onChange={(e) => setTechnique(e.target.value)} rows={3} className="w-full p-2 text-sm rounded-lg border bg-background resize-none" placeholder="MRI Brain was performed on a 1.5T/3T scanner using standard brain protocol..." />
        </div>

        {/* Findings items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground">Findings Sections</label>
            <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={addFindingsItem}><Plus size={10} /> Add Section</Button>
          </div>
          {findingsItems.map((item, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2 bg-muted/20">
              <div className="flex gap-2">
                <input value={item.label} onChange={(e) => updateFindingsItem(i, "label", e.target.value)} placeholder="Section label (e.g. Brain Parenchyma)" className="flex-1 h-8 px-2 text-xs rounded border bg-background" />
                <button onClick={() => removeFindingsItem(i)} className="p-1 text-muted-foreground hover:text-red-500"><X size={13} /></button>
              </div>
              <textarea value={item.normal} onChange={(e) => updateFindingsItem(i, "normal", e.target.value)} placeholder="Normal text for this section..." rows={2} className="w-full p-2 text-xs rounded border bg-background resize-none" />
            </div>
          ))}
          {findingsItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No findings sections yet. Click "Add Section" to add one.</p>
          )}
        </div>

        {/* Default Findings (full text) */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground">Default Normal Findings (full prose)</label>
          <textarea value={defaultFindings} onChange={(e) => setDefaultFindings(e.target.value)} rows={4} className="w-full p-2 text-sm rounded-lg border bg-background resize-none" placeholder="Full normal findings text inserted when 'Insert Normal' is clicked..." />
        </div>

        {/* Default Impression */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground">Default Normal Impression</label>
          <textarea value={defaultImpression} onChange={(e) => setDefaultImpression(e.target.value)} rows={2} className="w-full p-2 text-sm rounded-lg border bg-background resize-none" placeholder="e.g. Normal MRI Brain study. No significant intracranial abnormality." />
        </div>

        {/* Macros */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground">Quick-Insert Macros</label>
            <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={addMacro}><Plus size={10} /> Add Macro</Button>
          </div>
          {macros.map((macro, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2 bg-muted/20">
              <div className="flex gap-2">
                <input value={macro.label} onChange={(e) => updateMacro(i, "label", e.target.value)} placeholder="Macro label (e.g. Acute Infarct)" className="flex-1 h-8 px-2 text-xs rounded border bg-background" />
                <button onClick={() => removeMacro(i)} className="p-1 text-muted-foreground hover:text-red-500"><X size={13} /></button>
              </div>
              <textarea value={macro.text} onChange={(e) => updateMacro(i, "text", e.target.value)} placeholder="Macro text inserted at cursor..." rows={2} className="w-full p-2 text-xs rounded border bg-background resize-none" />
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-2 border-t">
          <Button onClick={handleSave} className="flex-1 gap-2"><Save size={14} /> Save Template</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReportTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterModality, setFilterModality] = useState("ALL");
  const [editingTemplate, setEditingTemplate] = useState<StructuredTemplate | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: templates = [], isLoading } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-report-templates"],
    queryFn: () => api.get("/api/structured-report-templates"),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => api.post("/api/structured-report-templates", data),
    onSuccess: () => { toast({ title: "Template created" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); setShowForm(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => api.patch(`/api/structured-report-templates/${id}`, data),
    onSuccess: () => { toast({ title: "Template updated" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); setShowForm(false); setEditingTemplate(undefined); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/structured-report-templates/${id}`),
    onSuccess: () => { toast({ title: "Template deleted" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => api.post("/api/structured-report-templates/seed", {}),
    onSuccess: (r: { inserted: number }) => { toast({ title: `${r.inserted} preset templates loaded` }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); },
    onError: (e: Error) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  const filtered = templates.filter((t) => {
    const matchSearch = !search || t.templateName.toLowerCase().includes(search.toLowerCase()) || t.bodyPart.toLowerCase().includes(search.toLowerCase());
    const matchModality = filterModality === "ALL" || t.modality === filterModality;
    return matchSearch && matchModality;
  });

  function handleSave(data: object) {
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const grouped = filtered.reduce<Record<string, StructuredTemplate[]>>((acc, t) => {
    const key = `${t.modality} — ${t.bodyPart}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Structured Report Templates"
        subtitle="Modality-based reporting templates with findings sections, normal presets, and quick macros"
        actions={
          <div className="flex gap-2">
            {templates.length === 0 && (
              <Button variant="outline" className="gap-2" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Load 14 Preset Templates
              </Button>
            )}
            <Button className="gap-2" onClick={() => { setEditingTemplate(undefined); setShowForm(true); }}>
              <Plus size={14} /> New Template
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="h-9 pl-9 pr-3 text-sm rounded-lg border bg-background w-60"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {["ALL", ...MODALITIES.slice(0, 6)].map((m) => (
            <button
              key={m}
              onClick={() => setFilterModality(m)}
              className={`h-8 px-3 text-xs rounded-lg border font-medium transition-colors ${filterModality === m ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      )}

      {!isLoading && templates.length === 0 && (
        <div className="rounded-xl border-2 border-dashed p-10 text-center space-y-3">
          <BookOpen size={32} className="mx-auto text-muted-foreground" />
          <h3 className="font-semibold">No templates yet</h3>
          <p className="text-sm text-muted-foreground">Load 14 preset clinical templates or create your own.</p>
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="gap-2 mt-2">
            <Sparkles size={14} /> Load Preset Templates
          </Button>
        </div>
      )}

      {!isLoading && templates.length > 0 && Object.keys(grouped).length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">No templates match your filters.</div>
      )}

      {/* Template groups */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="rounded-xl border bg-card overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
              <FileText size={14} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold">{group}</h3>
              <span className="text-xs text-muted-foreground ml-auto">{items.length} template{items.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y">
              {items.map((t) => {
                const sections = (() => { try { return JSON.parse(t.sectionsJson ?? "{}") as Sections; } catch { return {}; } })();
                const macros = (() => { try { return JSON.parse(t.macrosJson ?? "[]") as Macro[]; } catch { return []; } })();
                const isExpanded = expandedId === t.id;
                return (
                  <div key={t.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{t.templateName}</p>
                          <Badge className={`text-[10px] h-4 ${MODALITY_COLORS[t.modality] ?? "bg-muted text-muted-foreground"}`}>{t.modality}</Badge>
                          {t.studyType && <Badge variant="outline" className="text-[10px] h-4">{t.studyType}</Badge>}
                          {t.isPreset && <Badge variant="outline" className="text-[10px] h-4 border-purple-300 text-purple-700"><Star size={8} className="mr-0.5" />Preset</Badge>}
                          {!t.isActive && <Badge variant="outline" className="text-[10px] h-4 text-red-500">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(sections.findingsItems?.length ?? 0)} findings sections · {macros.length} macros
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingTemplate(t); setShowForm(true); }}>
                          <Edit2 size={13} />
                        </Button>
                        {!t.isPreset && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-red-500 hover:bg-red-50"
                            onClick={() => { if (confirm("Delete this template?")) deleteMutation.mutate(t.id); }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-3 pl-4 border-l-2 border-muted">
                        {sections.technique && (
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Technique</p>
                            <p className="text-xs text-muted-foreground">{sections.technique}</p>
                          </div>
                        )}
                        {(sections.findingsItems?.length ?? 0) > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Findings Sections</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {sections.findingsItems?.map((item, i) => (
                                <div key={i} className="text-xs p-2 rounded bg-muted/30 border">
                                  <p className="font-medium">{item.label}</p>
                                  <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.normal}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {t.defaultImpression && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Default Impression</p>
                            <p className="text-xs italic text-muted-foreground mt-0.5">{t.defaultImpression}</p>
                          </div>
                        )}
                        {macros.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Macros ({macros.length})</p>
                            <div className="flex flex-wrap gap-1">
                              {macros.map((m, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-muted border">{m.label}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Form drawer */}
      {showForm && (
        <TemplateForm
          template={editingTemplate}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingTemplate(undefined); }}
        />
      )}
    </div>
  );
}
