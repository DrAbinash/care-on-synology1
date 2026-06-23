// ── Phase 5: Structured Smart Findings Panel ──
// Deterministic, rules-based text generation. NO AI.

import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Construction, Wand2, Save, X, Star, RotateCcw, ChevronDown, ChevronUp,
  AlertTriangle, Info, Check,
} from "lucide-react";
import {
  ALL_BUILDERS, detectBuilderType, getBuilderForType, defaultSelections,
  generateSmartReport, generateImpressionText, generateRecommendations,
  classifyCanalStenosis, type SmartBuilder, type SmartBuilderSection, type SmartBuilderField,
} from "@/lib/radiologySmartEngine";

interface Props {
  worklistId: number;
  modality: string;
  studyDescription?: string | null;
  onApplyFindings?: (findings: string) => void;
  onApplyImpression?: (impression: string) => void;
}

interface FavoriteSet {
  id: number;
  setName: string;
  builderType: string;
  selections: Record<string, unknown>;
}

export default function RadiologySmartFindingsPanel({
  worklistId, modality, studyDescription, onApplyFindings, onApplyImpression,
}: Props) {
  const { toast } = useToast();
  const [selectedBuilder, setSelectedBuilder] = useState<string>("");
  const [selections, setSelections] = useState<Record<string, unknown>>({});
  const [showPreview, setShowPreview] = useState(false);
  const [generatedFindings, setGeneratedFindings] = useState("");
  const [generatedImpression, setGeneratedImpression] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showFavorites, setShowFavorites] = useState(false);
  const [saveFavName, setSaveFavName] = useState("");

  const detectedType = useMemo(() => detectBuilderType(modality, studyDescription), [modality, studyDescription]);
  const activeBuilder = useMemo(() => {
    const bt = selectedBuilder || detectedType || ALL_BUILDERS[0]?.type;
    return bt ? getBuilderForType(bt) : undefined;
  }, [selectedBuilder, detectedType]);

  const { data: favoriteSets = [] } = useQuery<FavoriteSet[]>({
    queryKey: ["smart-favorite-sets", activeBuilder?.type],
    queryFn: () => api.get(`/api/radiology/smart/favorite-sets?builderType=${activeBuilder?.type ?? ""}`),
    enabled: !!activeBuilder?.type,
  });

  const saveMutation = useMutation({
    mutationFn: (data: { worklistId: number; builderType: string; studyType: string; selections: Record<string, unknown>; generatedFindings: string; generatedImpression: string }) =>
      api.post("/api/radiology/smart/findings", data),
    onSuccess: () => {
      toast({ title: "Smart findings saved", description: "Generated text has been recorded for audit." });
    },
    onError: () => {
      toast({ title: "Save failed", variant: "destructive" });
    },
  });

  const saveFavMutation = useMutation({
    mutationFn: (data: { setName: string; builderType: string; selections: Record<string, unknown> }) =>
      api.post("/api/radiology/smart/favorite-sets", data),
    onSuccess: () => {
      toast({ title: "Favorite set saved", description: "You can reuse this configuration later." });
      setSaveFavName("");
    },
  });

  const resetSelections = useCallback(() => {
    if (activeBuilder) {
      setSelections(defaultSelections(activeBuilder.type));
      setShowPreview(false);
      setGeneratedFindings("");
      setGeneratedImpression("");
    }
  }, [activeBuilder]);

  const handleSelectionChange = (fieldId: string, value: unknown) => {
    setSelections((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleGenerate = () => {
    if (!activeBuilder) return;
    const report = generateSmartReport(activeBuilder.type, selections);
    setGeneratedFindings(report.findings);
    setGeneratedImpression(report.impression);
    setShowPreview(true);
  };

  const handleApply = () => {
    if (generatedFindings) onApplyFindings?.(generatedFindings);
    if (generatedImpression) onApplyImpression?.(generatedImpression);
    toast({ title: "Applied to report", description: "Text inserted into the findings / impression areas." });
  };

  const handleSave = () => {
    if (!activeBuilder) return;
    saveMutation.mutate({
      worklistId,
      builderType: activeBuilder.type,
      studyType: activeBuilder.studyType,
      selections,
      generatedFindings,
      generatedImpression,
    });
  };

  const handleSaveFavorite = () => {
    if (!saveFavName.trim() || !activeBuilder) return;
    saveFavMutation.mutate({
      setName: saveFavName.trim(),
      builderType: activeBuilder.type,
      selections,
    });
  };

  const handleLoadFavorite = (fav: FavoriteSet) => {
    setSelections(fav.selections);
    toast({ title: "Loaded favorite set", description: fav.setName });
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  if (!activeBuilder) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <Info className="h-4 w-4 inline mr-1" /> No smart builder detected for this study type.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <div className="flex items-center gap-2">
          <Construction className="h-4 w-4 text-blue-500" />
          <span className="font-semibold text-sm">Smart Findings</span>
          <Badge variant="outline" className="text-[10px] h-5">{activeBuilder.label}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={resetSelections} title="Reset">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Builder selector */}
      <div className="flex gap-1 px-3 py-2 border-b">
        {ALL_BUILDERS.map((b) => (
          <Button
            key={b.type}
            size="sm"
            variant={activeBuilder.type === b.type ? "default" : "outline"}
            className="h-6 text-[10px]"
            onClick={() => {
              setSelectedBuilder(b.type);
              setSelections(defaultSelections(b.type));
              setShowPreview(false);
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {activeBuilder.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            selections={selections}
            onChange={handleSelectionChange}
            expanded={expandedSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}

        {/* Favorites */}
        <div className="pt-2 border-t">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] w-full justify-start"
            onClick={() => setShowFavorites((v) => !v)}
          >
            <Star className="h-3.5 w-3.5 mr-1" />
            {showFavorites ? "Hide" : "Show"} Favorites ({favoriteSets.length})
            {showFavorites ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </Button>
          {showFavorites && (
            <div className="mt-1 space-y-1">
              {favoriteSets.map((fav) => (
                <Button
                  key={fav.id}
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] w-full justify-start"
                  onClick={() => handleLoadFavorite(fav)}
                >
                  <Star className="h-3 w-3 mr-1" /> {fav.setName}
                </Button>
              ))}
              {favoriteSets.length === 0 && (
                <p className="text-[10px] text-muted-foreground">No favorite sets saved yet.</p>
              )}
              <div className="flex gap-1 mt-1">
                <Input
                  className="h-6 text-[10px]"
                  placeholder="Name this set..."
                  value={saveFavName}
                  onChange={(e) => setSaveFavName(e.target.value)}
                />
                <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleSaveFavorite} disabled={!saveFavName.trim()}>
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t p-2 space-y-2">
        <Button size="sm" className="w-full text-xs" onClick={handleGenerate} disabled={!activeBuilder}>
          <Wand2 className="h-3.5 w-3.5 mr-1" /> Generate
        </Button>

        {showPreview && (
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground">
              <Info className="h-3 w-3 inline mr-1" />
              AI Draft — Requires Radiologist Review
            </div>
            <Textarea
              className="text-xs min-h-[60px]"
              value={generatedFindings}
              onChange={(e) => setGeneratedFindings(e.target.value)}
              placeholder="Generated findings..."
            />
            <Textarea
              className="text-xs min-h-[40px]"
              value={generatedImpression}
              onChange={(e) => setGeneratedImpression(e.target.value)}
              placeholder="Generated impression..."
            />
            <div className="flex gap-1">
              <Button size="sm" variant="default" className="flex-1 text-xs" onClick={handleApply}>
                <Check className="h-3.5 w-3.5 mr-1" /> Apply
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={handleSave}>
                <Save className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section Card ──
function SectionCard({
  section, selections, onChange, expanded, onToggle,
}: {
  section: SmartBuilderSection;
  selections: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasValue = section.fields.some((f) => {
    const v = selections[f.id];
    if (f.type === "checkbox") return v === true;
    if (f.type === "multiselect") return Array.isArray(v) && v.length > 0;
    return v !== undefined && v !== "" && v !== "None" && v !== "Normal";
  });

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium hover:bg-muted/50"
        onClick={onToggle}
      >
        <span className="flex items-center gap-1">
          {section.label}
          {hasValue && <Badge variant="default" className="text-[8px] h-3 px-1">Set</Badge>}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {section.fields.map((field) => (
            <FieldInput key={field.id} field={field} value={selections[field.id]} onChange={(v) => onChange(field.id, v)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field Input ──
function FieldInput({ field, value, onChange }: { field: SmartBuilderField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case "select":
      return (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">{field.label}</label>
          <select
            className="w-full text-xs border rounded-md px-2 py-1 bg-background"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">-- Select --</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    case "multiselect":
      return (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">{field.label}</label>
          <div className="flex flex-wrap gap-1">
            {field.options?.map((o) => {
              const selected = (value as string[] ?? []).includes(o);
              return (
                <button
                  key={o}
                  className={`text-[10px] px-2 py-0.5 rounded-md border ${selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50"}`}
                  onClick={() => {
                    const arr = (value as string[] ?? []).slice();
                    if (selected) arr.splice(arr.indexOf(o), 1);
                    else arr.push(o);
                    onChange(arr);
                  }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    case "number":
      return (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">{field.label} {field.unit ? `(${field.unit})` : ""}</label>
          <Input
            type="number"
            className="h-6 text-xs"
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            value={value as string | number ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === "" ? "" : Number(v));
            }}
          />
          {field.id === "canalDiameter" && value !== undefined && value !== "" && Number(value) > 0 && (
            <CanalSeverityBadge diameter={Number(value)} />
          )}
        </div>
      );
    case "text":
      return (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">{field.label}</label>
          <Input
            className="h-6 text-xs"
            placeholder={field.placeholder}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-xs">{field.label}</span>
        </label>
      );
    default:
      return null;
  }
}

function CanalSeverityBadge({ diameter }: { diameter: number }) {
  const result = classifyCanalStenosis(diameter);
  const colors: Record<string, string> = {
    normal: "bg-green-100 text-green-700 border-green-300",
    mild: "bg-yellow-100 text-yellow-700 border-yellow-300",
    moderate: "bg-orange-100 text-orange-700 border-orange-300",
    severe: "bg-red-100 text-red-700 border-red-300",
  };
  return (
    <Badge variant="outline" className={`text-[10px] h-4 mt-0.5 ${colors[result.severity] ?? ""}`}>
      {result.label}
    </Badge>
  );
}
