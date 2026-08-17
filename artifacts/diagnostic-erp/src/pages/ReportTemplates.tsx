import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Edit2, Trash2, RefreshCw, Copy,
  FileText, Sparkles, BookOpen, ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { StructuredFormatBuilder, type TemplateMeta } from "@/components/radiology/StructuredFormatBuilder";
import { adaptSectionsJson, MRI_LS_SPINE_CARE_STANDARD, MRI_LS_SPINE_CARE_STANDARD_META, allNormalFindingsMap } from "@/lib/structuredFormat";

const STRUCTURED_TEMPLATES_API = "/api/radiology/structured-report-templates";

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
  schemaVersion?: number;
  formatVersion?: number;
  isDefault?: boolean;
  tags?: string;
  previousVersions?: string;
}

const MODALITIES = ["MRI", "CT", "USG", "X-RAY", "DOPPLER", "ECHO", "PET-CT", "FLUOROSCOPY", "OTHER"];

const MODALITY_COLORS: Record<string, string> = {
  MRI: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  CT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  USG: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  "X-RAY": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  DOPPLER: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

function toMeta(t?: StructuredTemplate): TemplateMeta | undefined {
  if (!t) return undefined;
  return {
    id: t.id,
    templateName: t.templateName,
    modality: t.modality,
    bodyPart: t.bodyPart,
    studyType: t.studyType ?? "",
    defaultFindings: t.defaultFindings ?? "",
    defaultImpression: t.defaultImpression ?? "",
    isActive: t.isActive,
    isDefault: t.isDefault ?? false,
    tags: t.tags ?? "",
    schemaVersion: t.schemaVersion ?? 1,
    formatVersion: t.formatVersion ?? 1,
    previousVersions: t.previousVersions ?? "[]",
    sectionsJson: t.sectionsJson,
    macrosJson: t.macrosJson,
    isPreset: t.isPreset,
  };
}

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
    queryFn: () => api.get(STRUCTURED_TEMPLATES_API),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => api.post(STRUCTURED_TEMPLATES_API, data),
    onSuccess: () => { toast({ title: "Format saved" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); setShowForm(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => api.patch(`${STRUCTURED_TEMPLATES_API}/${id}`, data),
    onSuccess: () => { toast({ title: "Format updated" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); setShowForm(false); setEditingTemplate(undefined); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`${STRUCTURED_TEMPLATES_API}/${id}`),
    onSuccess: () => { toast({ title: "Format deleted" }); void queryClient.invalidateQueries({ queryKey: ["structured-report-templates"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => api.post(`${STRUCTURED_TEMPLATES_API}/seed`, {}),
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

  const hasCareStandard = templates.some((t) => t.templateName === MRI_LS_SPINE_CARE_STANDARD_META.templateName);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Structured Report Templates"
        subtitle="Create your own formats: sections, repeating levels, fields, tokens. Used by the Reporting Workspace."
        actions={
          <div className="flex gap-2 flex-wrap">
            {templates.length === 0 && (
              <Button variant="outline" className="gap-2" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                {seedMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Load presets
              </Button>
            )}
            {!hasCareStandard && (
              <Button variant="outline" className="gap-2" onClick={() => createMutation.mutate({
                ...MRI_LS_SPINE_CARE_STANDARD_META,
                sectionsJson: JSON.stringify(MRI_LS_SPINE_CARE_STANDARD),
                macrosJson: "[]",
                schemaVersion: 2,
                isPreset: false,
              })}>
                <Sparkles size={14} /> Add LS Spine CARE Standard
              </Button>
            )}
            <Button className="gap-2" onClick={() => { setEditingTemplate(undefined); setShowForm(true); }}>
              <Plus size={14} /> New format
            </Button>
          </div>
        }
      />

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
          <h3 className="font-semibold">No formats yet</h3>
          <p className="text-sm text-muted-foreground">Load presets or create a format with sections and repeating groups.</p>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="rounded-xl border bg-card overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
              <FileText size={14} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold">{group}</h3>
              <span className="text-xs text-muted-foreground ml-auto">{items.length} format{items.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y">
              {items.map((t) => {
                const doc = adaptSectionsJson(t.sectionsJson);
                const map = allNormalFindingsMap(doc);
                const isExpanded = expandedId === t.id;
                const v2 = doc.schemaVersion === 2 && doc.sections.some((s) => s.fields.length > 0 || s.repeat);
                return (
                  <div key={t.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{t.templateName}</p>
                          <Badge className={`text-[10px] h-4 ${MODALITY_COLORS[t.modality] ?? "bg-muted text-muted-foreground"}`}>{t.modality}</Badge>
                          {t.studyType && <Badge variant="outline" className="text-[10px] h-4">{t.studyType}</Badge>}
                          {v2 && <Badge variant="outline" className="text-[10px] h-4 border-indigo-300 text-indigo-700">Structured v2</Badge>}
                          {t.isDefault && <Badge variant="outline" className="text-[10px] h-4">Default</Badge>}
                          {t.isPreset && <Badge variant="outline" className="text-[10px] h-4">Preset</Badge>}
                          {!t.isActive && <Badge variant="outline" className="text-[10px] h-4 text-red-500">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {Object.keys(map).length} sections · {doc.repeatingGroupDefs.length} repeating groups · {doc.sections.reduce((n, s) => n + s.fields.length, 0)} fields
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Duplicate" onClick={() => {
                          createMutation.mutate({
                            templateName: `${t.templateName} (copy)`,
                            modality: t.modality,
                            bodyPart: t.bodyPart,
                            studyType: t.studyType,
                            sectionsJson: t.sectionsJson,
                            defaultFindings: t.defaultFindings,
                            defaultImpression: t.defaultImpression,
                            macrosJson: t.macrosJson,
                            schemaVersion: t.schemaVersion ?? 1,
                            isPreset: false,
                            parentId: t.id,
                          });
                        }}>
                          <Copy size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingTemplate(t); setShowForm(true); }}>
                          <Edit2 size={13} />
                        </Button>
                        {!t.isPreset && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-red-500 hover:bg-red-50"
                            onClick={() => { if (confirm("Delete this format?")) deleteMutation.mutate(t.id); }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4 border-l-2">
                        {Object.entries(map).map(([label, v]) => (
                          <div key={label} className="text-xs p-2 rounded bg-muted/30 border">
                            <p className="font-medium">{label}</p>
                            <p className="text-muted-foreground mt-0.5 line-clamp-2">{v.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <StructuredFormatBuilder
          template={toMeta(editingTemplate)}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingTemplate(undefined); }}
        />
      )}
    </div>
  );
}
