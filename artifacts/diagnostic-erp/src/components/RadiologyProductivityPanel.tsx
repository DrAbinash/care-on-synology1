import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession } from "@/lib/staffSession";
import {
  Plus, Zap, Star, History, ChevronRight, Check,
  X, Search, Trash2, Copy, ArrowUpDown,
} from "lucide-react";
import {
  type StudyContext,
  type QuickAddButton,
  type SmartFormat,
  detectStudyContext,
  mergeSmartFormats,
  STUDY_CONTEXTS,
  DEFAULT_MACROS,
} from "@/lib/radiologyQuickAddData";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Snippet {
  id: number;
  type: "quick_add" | "smart_format" | "favorite" | "macro" | "normal_template";
  label: string;
  shortcut: string | null;
  modality: string | null;
  bodyPart: string | null;
  testKeywords: string | null;
  titleText: string | null;
  techniqueText: string | null;
  findingsText: string | null;
  impressionText: string | null;
  adviceText: string | null;
  isActive: boolean;
  isDefault: boolean;
  isGlobal: boolean;
  createdBy: string;
  sortOrder: number;
  createdAt: string;
}

interface PreviousReport {
  id: number;
  reportNumber: string;
  title: string;
  body: string;
  impression: string | null;
  createdAt: string;
  status: string;
  signedByName: string | null;
  testName: string | null;
  testCode: string | null;
}

interface Props {
  mode: "quick_add" | "smart_format" | "previous" | "favorites" | "macros";
  modality: string;
  studyDescription?: string | null;
  testName?: string | null;
  bodyPart?: string | null;
  patientId?: number | null;
  isFinal: boolean;
  reportBody: string;
  impression: string;
  onInsertBody: (text: string, replace?: boolean) => void;
  onInsertImpression: (text: string) => void;
  onSetBody: (text: string) => void;
  onSetImpression: (text: string) => void;
}

// ─── Quick Add Panel ─────────────────────────────────────────────────────────

function QuickAddPanel({
  modality, studyDescription, testName, bodyPart, isFinal, onInsertBody, onInsertImpression,
}: Props) {
  const { toast } = useToast();
  const context = useMemo(
    () => detectStudyContext(modality, studyDescription, testName, bodyPart),
    [modality, studyDescription, testName, bodyPart],
  );

  const handleInsert = (btn: QuickAddButton) => {
    onInsertBody(btn.text);
    if (btn.impression) {
      onInsertImpression(btn.impression);
    }
    toast({ title: `Inserted: ${btn.label}`, description: btn.shortcut });
  };

  if (!context) {
    return (
      <div className="p-3">
        <p className="text-[10px] text-muted-foreground">
          No study context detected for {modality}.
          <br />Select a study type below:
        </p>
        <div className="space-y-1 mt-2">
          {STUDY_CONTEXTS.slice(0, 6).map((ctx) => (
            <button
              key={ctx.id}
              onClick={() => {
                ctx.buttons.forEach((btn, i) => {
                  setTimeout(() => handleInsert(btn), i * 50);
                });
              }}
              className="w-full text-left text-xs rounded border bg-background px-2 py-1 hover:bg-blue-50"
              disabled={isFinal}
            >
              {ctx.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{context.label}</h3>
        <span className="text-[9px] text-muted-foreground">{context.buttons.length} buttons</span>
      </div>
      <div className="space-y-1">
        {context.buttons.map((btn, idx) => (
          <button
            key={btn.label}
            onClick={() => handleInsert(btn)}
            className="w-full text-left text-xs rounded border bg-background px-2 py-1.5 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
            disabled={isFinal}
            title={`${btn.label} — ${btn.shortcut}`}
          >
            <span className="font-medium">{btn.label}</span>
            <span className="text-[10px] text-muted-foreground ml-1 opacity-0 group-hover:opacity-100">
              {btn.shortcut}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Smart Format Panel ─────────────────────────────────────────────────────

function SmartFormatPanel({
  modality, studyDescription, testName, bodyPart, isFinal, onSetBody, onSetImpression,
}: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const context = useMemo(
    () => detectStudyContext(modality, studyDescription, testName, bodyPart),
    [modality, studyDescription, testName, bodyPart],
  );

  const formats = context?.smartFormats ?? [];
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectedFormats = formats.filter((f) => selected.has(f.id));
  const merged = selectedFormats.length > 0 ? mergeSmartFormats(selectedFormats) : null;

  const applyMerge = () => {
    if (!merged) return;
    onSetBody(merged.findings);
    if (merged.impression) onSetImpression(merged.impression);
    toast({ title: `Merged ${selectedFormats.length} formats applied` });
    setSelected(new Set());
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          {context ? context.label : "Smart Format"}
        </h3>
        {selected.size > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              variant="default"
              className="h-5 text-[10px] px-1.5"
              onClick={applyMerge}
              disabled={isFinal}
            >
              <Check className="h-3 w-3 mr-0.5" /> Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 w-5 p-0"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-1">
        {formats.map((fmt) => {
          const isSel = selected.has(fmt.id);
          return (
            <button
              key={fmt.id}
              onClick={() => toggle(fmt.id)}
              className={`w-full text-left text-xs rounded border px-2 py-1.5 transition-colors ${
                isSel
                  ? "bg-blue-50 border-blue-300"
                  : "bg-background hover:bg-blue-50 hover:border-blue-200"
              }`}
              disabled={isFinal}
              title={fmt.shortcut}
            >
              <div className="flex items-center gap-1">
                <div className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                  isSel ? "bg-blue-500 border-blue-500" : "border-gray-300"
                }`}>
                  {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <span className="font-medium">{fmt.label}</span>
              </div>
              {isSel && fmt.impression && (
                <div className="text-[10px] text-muted-foreground mt-0.5 ml-4">
                  {fmt.impression}
                </div>
              )}
            </button>
          );
        })}
        {formats.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No smart formats for this study type.</p>
        )}
      </div>
    </div>
  );
}

// ─── Previous Reports Panel ──────────────────────────────────────────────────

function PreviousReportsPanel({ patientId, modality, isFinal, onInsertBody, onSetImpression }: Props) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ items: PreviousReport[] }>({
    queryKey: ["previous-reports", patientId, modality],
    queryFn: () => api.get(`/api/patient-reports/patient/${patientId}?type=radiology`),
    enabled: !!patientId,
  });

  const items = data?.items ?? [];

  if (isLoading) return <div className="p-3 text-xs text-muted-foreground">Loading...</div>;
  if (!patientId) return <div className="p-3 text-xs text-muted-foreground">No patient linked.</div>;
  if (items.length === 0) return <div className="p-3 text-xs text-muted-foreground">No prior radiology reports.</div>;

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Previous Reports</h3>
      {items.slice(0, 10).map((r) => (
        <div key={r.id} className="text-xs rounded border bg-background p-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{r.testName || r.title}</span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </div>
          {r.impression && (
            <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{r.impression}</div>
          )}
          <div className="flex items-center gap-1 mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-[10px] px-1"
              onClick={() => {
                const text = `Compared to previous report dated ${new Date(r.createdAt).toLocaleDateString()} (${r.testName || r.title}): `;
                onInsertBody(text);
                toast({ title: "Comparison phrase inserted" });
              }}
              disabled={isFinal}
            >
              <ArrowUpDown className="h-3 w-3 mr-0.5" /> Compare
            </Button>
            {r.impression && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 text-[10px] px-1"
                onClick={() => {
                  onSetImpression(r.impression || "");
                  toast({ title: "Impression copied" });
                }}
                disabled={isFinal}
              >
                <Copy className="h-3 w-3 mr-0.5" /> Copy Imp
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Favorites Panel ─────────────────────────────────────────────────────────

function FavoritesPanel({
  modality, isFinal, onInsertBody, onSetImpression, onInsertImpression,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newFindings, setNewFindings] = useState("");
  const [newImpression, setNewImpression] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading } = useQuery<{ items: Snippet[] }>({
    queryKey: ["radiology-snippets", "favorite", modality],
    queryFn: () => api.get(`/api/radiology/snippets?type=favorite&modality=${encodeURIComponent(modality)}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/radiology/snippets", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["radiology-snippets"] });
      setShowAdd(false);
      setNewLabel("");
      setNewFindings("");
      setNewImpression("");
      toast({ title: "Favorite saved" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/radiology/snippets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["radiology-snippets"] });
      toast({ title: "Favorite deleted" });
    },
  });

  const favorites = (data?.items ?? []).filter((f) => f.isActive);
  const filtered = search
    ? favorites.filter((f) => f.label.toLowerCase().includes(search.toLowerCase()))
    : favorites;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Favorites</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {showAdd && (
        <div className="space-y-1 mb-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label"
            className="h-6 text-xs"
          />
          <Input
            value={newFindings}
            onChange={(e) => setNewFindings(e.target.value)}
            placeholder="Findings text"
            className="h-6 text-xs"
          />
          <Input
            value={newImpression}
            onChange={(e) => setNewImpression(e.target.value)}
            placeholder="Impression (optional)"
            className="h-6 text-xs"
          />
          <Button
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => {
              createMutation.mutate({
                type: "favorite",
                label: newLabel || "Untitled",
                findingsText: newFindings,
                impressionText: newImpression || null,
                modality: modality || "ALL",
                isGlobal: false,
              });
            }}
            disabled={!newLabel || createMutation.isPending}
          >
            <Star className="h-3 w-3 mr-0.5" /> Save
          </Button>
        </div>
      )}
      <div className="relative mb-2">
        <Search className="absolute left-1.5 top-1 h-3 w-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search favorites..."
          className="h-6 text-xs pl-6"
        />
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-1">
          {filtered.map((f) => (
            <div
              key={f.id}
              className="text-xs rounded border bg-background p-2 group hover:bg-blue-50"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.label}</span>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0"
                    onClick={() => {
                      if (f.findingsText) onInsertBody(f.findingsText);
                      if (f.impressionText) onInsertImpression(f.impressionText);
                      toast({ title: `Inserted: ${f.label}` });
                    }}
                    disabled={isFinal}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-red-500"
                    onClick={() => deleteMutation.mutate(f.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {f.findingsText && (
                <div className="text-[10px] text-muted-foreground line-clamp-1">{f.findingsText}</div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-[10px] text-muted-foreground">No favorites. Click + to save current text.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Macro Engine Panel ──────────────────────────────────────────────────────

function MacrosPanel({
  modality, isFinal, onInsertBody,
}: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data } = useQuery<{ items: Snippet[] }>({
    queryKey: ["radiology-snippets", "macro", modality],
    queryFn: () => api.get(`/api/radiology/snippets?type=macro&modality=${encodeURIComponent(modality)}`),
  });

  const macros = useMemo(() => {
    const dbMacros = (data?.items ?? []).filter((m) => m.isActive && m.shortcut);
    const dbEntries = dbMacros.map((m) => ({
      id: String(m.id),
      shortcut: m.shortcut!,
      expansion: m.findingsText || m.label,
    }));
    return [...DEFAULT_MACROS, ...dbEntries];
  }, [data]);

  const filtered = search
    ? macros.filter((m) => m.shortcut.toLowerCase().includes(search.toLowerCase()))
    : macros;

  return (
    <div className="p-3">
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Macros</h3>
        <p className="text-[10px] text-muted-foreground">Type "/shortcut" in the report body to expand.</p>
      </div>
      <div className="relative mb-2">
        <Search className="absolute left-1.5 top-1 h-3 w-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search macros..."
          className="h-6 text-xs pl-6"
        />
      </div>
      <div className="space-y-1">
        {filtered.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              onInsertBody(m.expansion);
              toast({ title: `Macro: /${m.shortcut}` });
            }}
            className="w-full text-left text-xs rounded border bg-background px-2 py-1.5 hover:bg-purple-50 hover:border-purple-200 transition-colors group"
            disabled={isFinal}
          >
            <span className="font-mono font-medium text-purple-600">/{m.shortcut}</span>
            <span className="text-[10px] text-muted-foreground ml-2 line-clamp-1">
              {m.expansion}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No macros found.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Switch Panel ───────────────────────────────────────────────────────

export default function RadiologyProductivityPanel(props: Props) {
  switch (props.mode) {
    case "quick_add":
      return <QuickAddPanel {...props} />;
    case "smart_format":
      return <SmartFormatPanel {...props} />;
    case "previous":
      return <PreviousReportsPanel {...props} />;
    case "favorites":
      return <FavoritesPanel {...props} />;
    case "macros":
      return <MacrosPanel {...props} />;
    default:
      return null;
  }
}
