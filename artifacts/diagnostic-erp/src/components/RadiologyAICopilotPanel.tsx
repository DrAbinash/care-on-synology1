// ── Phase 6: AI Copilot Panel ──
// Multi-AI provider copilot shell. All outputs are editable. Radiologist has final authority.

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Sparkles, AlertTriangle, Check, X, Copy, ArrowRight,
  Stethoscope, Calendar, Image, History, ShieldCheck, Languages,
  Terminal, ChevronDown, ChevronUp,
} from "lucide-react";
import { getDifferential, getAllDifferentialIds, searchDifferentials, type DifferentialItem } from "@/lib/radiologyDifferentialEngine";
import { getFollowUp, getAllFollowUpIds, searchFollowUp, type FollowUpRecommendation } from "@/lib/radiologyFollowUpEngine";
import { runQualityCheck, type QualityCheck } from "@/lib/radiologyIntelligenceEngine";

interface Props {
  worklistId: number;
  modality: string;
  studyDescription?: string | null;
  studyInstanceUID?: string | null;
  reportBody: string;
  impression: string;
  onInsert: (text: string) => void;
  onInsertImpression: (text: string) => void;
  // Feature flags
  ffDraft: boolean;
  ffDifferential: boolean;
  ffFollowUp: boolean;
  ffImageReview: boolean;
  ffCompare: boolean;
  ffQuality: boolean;
  ffPolish: boolean;
  ffPromptManager: boolean;
}

export default function RadiologyAICopilotPanel({
  worklistId,
  modality,
  studyDescription,
  studyInstanceUID,
  reportBody,
  impression,
  onInsert,
  onInsertImpression,
  ffDraft,
  ffDifferential,
  ffFollowUp,
  ffImageReview,
  ffCompare,
  ffQuality,
  ffPolish,
  ffPromptManager,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (ffDraft) return "draft";
    if (ffDifferential) return "differential";
    if (ffFollowUp) return "followup";
    if (ffImageReview) return "image";
    if (ffCompare) return "compare";
    if (ffQuality) return "quality";
    if (ffPolish) return "polish";
    if (ffPromptManager) return "prompts";
    return "draft";
  });

  const tabs = useMemo(() => {
    const t: { id: string; label: string; icon: React.ReactNode }[] = [];
    if (ffDraft) t.push({ id: "draft", label: "Draft", icon: <Sparkles className="h-3.5 w-3.5" /> });
    if (ffDifferential) t.push({ id: "differential", label: "Differential", icon: <Stethoscope className="h-3.5 w-3.5" /> });
    if (ffFollowUp) t.push({ id: "followup", label: "Follow-up", icon: <Calendar className="h-3.5 w-3.5" /> });
    if (ffImageReview) t.push({ id: "image", label: "Image", icon: <Image className="h-3.5 w-3.5" /> });
    if (ffCompare) t.push({ id: "compare", label: "Compare", icon: <History className="h-3.5 w-3.5" /> });
    if (ffQuality) t.push({ id: "quality", label: "Quality", icon: <ShieldCheck className="h-3.5 w-3.5" /> });
    if (ffPolish) t.push({ id: "polish", label: "Polish", icon: <Languages className="h-3.5 w-3.5" /> });
    if (ffPromptManager) t.push({ id: "prompts", label: "Prompts", icon: <Terminal className="h-3.5 w-3.5" /> });
    return t;
  }, [ffDraft, ffDifferential, ffFollowUp, ffImageReview, ffCompare, ffQuality, ffPolish, ffPromptManager]);

  return (
    <div className="w-96 border-l bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b p-3 flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Copilot</span>
        </div>
        <Badge variant="outline" className="text-[10px] font-normal bg-amber-50 text-amber-700 border-amber-200">
          <AlertTriangle className="h-3 w-3 mr-1" /> Draft
        </Badge>
      </div>

      {/* AI Safety Disclaimer */}
      <div className="shrink-0 px-3 py-2 bg-amber-50 border-b border-amber-100">
        <p className="text-[10px] text-amber-700 leading-tight">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          AI-generated content requires radiologist review. The AI is a drafting assistant; the radiologist is the final authority.
        </p>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`shrink-0 px-3 py-2 text-[11px] font-medium flex items-center gap-1 border-b-2 transition-colors ${
              activeTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "draft" && ffDraft && (
          <DraftTab
            worklistId={worklistId}
            modality={modality}
            studyDescription={studyDescription}
            reportBody={reportBody}
            impression={impression}
            onInsert={onInsert}
            onInsertImpression={onInsertImpression}
          />
        )}
        {activeTab === "differential" && ffDifferential && (
          <DifferentialTab reportBody={reportBody} onInsert={onInsert} />
        )}
        {activeTab === "followup" && ffFollowUp && (
          <FollowUpTab reportBody={reportBody} onInsert={onInsert} />
        )}
        {activeTab === "image" && ffImageReview && (
          <ImageReviewTab worklistId={worklistId} studyInstanceUID={studyInstanceUID} onInsert={onInsert} />
        )}
        {activeTab === "compare" && ffCompare && (
          <CompareTab worklistId={worklistId} studyInstanceUID={studyInstanceUID} onInsert={onInsert} />
        )}
        {activeTab === "quality" && ffQuality && (
          <QualityTab reportBody={reportBody} impression={impression} onInsert={onInsert} />
        )}
        {activeTab === "polish" && ffPolish && (
          <PolishTab reportBody={reportBody} onInsert={onInsert} />
        )}
        {activeTab === "prompts" && ffPromptManager && (
          <PromptManagerTab />
        )}
      </div>
    </div>
  );
}

// ── Tab: AI Draft ──
function DraftTab({
  worklistId,
  modality,
  studyDescription,
  reportBody,
  impression,
  onInsert,
  onInsertImpression,
}: {
  worklistId: number;
  modality: string;
  studyDescription?: string | null;
  reportBody: string;
  impression: string;
  onInsert: (text: string) => void;
  onInsertImpression: (text: string) => void;
}) {
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [provider, setProvider] = useState<string>("auto");
  const [draft, setDraft] = useState<string | null>(null);
  const [draftImpression, setDraftImpression] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setDraft(null);
    setDraftImpression(null);
    try {
      const res = await fetch(`/api/ai-reporting/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worklistId,
          modality,
          studyDescription,
          reportBody,
          impression,
          clinicalHistory,
          provider: provider === "auto" ? undefined : provider,
        }),
      });
      if (!res.ok) throw new Error("Draft generation failed");
      const data = await res.json();
      setDraft(data.draft || null);
      setDraftImpression(data.impression || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div>
        <label className="text-[10px] font-medium text-muted-foreground">Clinical History</label>
        <Textarea
          value={clinicalHistory}
          onChange={(e) => setClinicalHistory(e.target.value)}
          rows={2}
          placeholder="Optional clinical history to guide the draft"
          className="text-xs mt-1"
        />
      </div>
      <div>
        <label className="text-[10px] font-medium text-muted-foreground">Provider</label>
        <div className="flex gap-1 mt-1">
          {["auto", "gemini", "openai", "claude", "ollama", "openrouter"].map((p) => (
            <button
              key={p}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                provider === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-muted-foreground/30 hover:bg-muted"
              }`}
              onClick={() => setProvider(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        className="w-full text-xs bg-purple-600 hover:bg-purple-700"
        onClick={handleGenerate}
        disabled={isGenerating || (!reportBody.trim() && !clinicalHistory.trim())}
      >
        {isGenerating ? <Sparkles className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
        Generate Draft
      </Button>
      {error && (
        <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded border border-red-200">
          {error}
        </div>
      )}
      {draft && (
        <div className="space-y-2">
          <div className="border rounded p-2 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground">Draft Findings</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-[10px]" onClick={() => onInsert(draft)} title="Insert">
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="text-[11px] whitespace-pre-wrap text-muted-foreground">{draft}</div>
          </div>
          {draftImpression && (
            <div className="border rounded p-2 bg-muted/20">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-muted-foreground">Draft Impression</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-[10px]" onClick={() => onInsertImpression(draftImpression)} title="Insert">
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="text-[11px] whitespace-pre-wrap text-muted-foreground">{draftImpression}</div>
            </div>
          )}
          <div className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Review and edit before inserting.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Differential Diagnosis ──
function DifferentialTab({
  reportBody,
  onInsert,
}: {
  reportBody: string;
  onInsert: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const ids = useMemo(() => {
    if (!query.trim()) return getAllDifferentialIds();
    return searchDifferentials(query);
  }, [query]);

  const handleToggle = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleInsert = () => {
    if (!selectedId) return;
    const group = getDifferential(selectedId);
    if (!group) return;
    const items = group.items.filter((_, i) => selectedItems.has(`${selectedId}-${i}`));
    if (items.length === 0) return;
    const lines = items.map((item) => {
      let line = `${item.diagnosis} (${item.confidence} confidence)`;
      if (item.rationale) line += `\n  → ${item.rationale}`;
      if (item.supportingFeatures?.length) line += `\n  Supporting: ${item.supportingFeatures.join(", ")}`;
      if (item.distinguishingFeatures?.length) line += `\n  Distinguishing: ${item.distinguishingFeatures.join(", ")}`;
      return line;
    });
    onInsert(`Differential Diagnosis:\n${lines.join("\n\n")}`);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Structured differential diagnoses with confidence levels. No AI.
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search differentials..."
        className="w-full text-xs px-2 py-1.5 border rounded"
      />
      <div className="space-y-1">
        {ids.map((id) => {
          const group = getDifferential(id);
          if (!group) return null;
          const isOpen = selectedId === id;
          return (
            <div key={id} className="border rounded overflow-hidden">
              <button
                className={`w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium transition-colors ${isOpen ? "bg-muted" : "hover:bg-muted/50"}`}
                onClick={() => handleToggle(id)}
              >
                <span>{group.title}</span>
                {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {isOpen && (
                <div className="p-2 space-y-2">
                  {group.items.map((item, idx) => {
                    const itemId = `${id}-${idx}`;
                    const isSelected = selectedItems.has(itemId);
                    return (
                      <div
                        key={idx}
                        className={`text-[11px] p-2 rounded border cursor-pointer transition-colors ${isSelected ? "bg-purple-50 border-purple-200" : "bg-background hover:bg-muted/50"}`}
                        onClick={() => handleToggleItem(itemId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            item.confidence === "high" ? "bg-green-500" : item.confidence === "medium" ? "bg-yellow-500" : "bg-red-500"
                          }`} />
                          <span className="font-medium">{item.diagnosis}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {item.confidence}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground mt-0.5">{item.rationale}</div>
                        {item.supportingFeatures && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Supporting: {item.supportingFeatures.join(", ")}
                          </div>
                        )}
                        {item.distinguishingFeatures && (
                          <div className="text-[10px] text-muted-foreground">
                            Distinguishing: {item.distinguishingFeatures.join(", ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Button size="sm" className="w-full text-xs" disabled={selectedItems.size === 0} onClick={handleInsert}>
                    <ArrowRight className="h-3 w-3 mr-1" /> Insert Selected
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Follow-Up Recommendations ──
function FollowUpTab({
  reportBody,
  onInsert,
}: {
  reportBody: string;
  onInsert: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const ids = useMemo(() => {
    if (!query.trim()) return getAllFollowUpIds();
    return searchFollowUp(query);
  }, [query]);

  const handleToggle = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const handleToggleItem = (idx: number) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleInsert = () => {
    if (!selectedId) return;
    const items = getFollowUp(selectedId);
    if (!items) return;
    const selected = items.filter((_, i) => selectedItems.has(i));
    if (selected.length === 0) return;
    const lines = selected.map((item) => {
      let line = `${item.followUp} — ${item.interval}`;
      if (item.rationale) line += `\n  → ${item.rationale}`;
      return line;
    });
    onInsert(`Follow-Up Recommendations:\n${lines.join("\n\n")}`);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Condition-based follow-up and surveillance recommendations. No AI.
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search conditions..."
        className="w-full text-xs px-2 py-1.5 border rounded"
      />
      <div className="space-y-1">
        {ids.map((id) => {
          const items = getFollowUp(id);
          if (!items) return null;
          const isOpen = selectedId === id;
          return (
            <div key={id} className="border rounded overflow-hidden">
              <button
                className={`w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium transition-colors ${isOpen ? "bg-muted" : "hover:bg-muted/50"}`}
                onClick={() => handleToggle(id)}
              >
                <span>{items[0]?.condition.split(" —")[0] ?? id}</span>
                {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {isOpen && (
                <div className="p-2 space-y-2">
                  {items.map((item, idx) => {
                    const isSelected = selectedItems.has(idx);
                    return (
                      <div
                        key={idx}
                        className={`text-[11px] p-2 rounded border cursor-pointer transition-colors ${isSelected ? "bg-blue-50 border-blue-200" : "bg-background hover:bg-muted/50"}`}
                        onClick={() => handleToggleItem(idx)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            item.priority === "critical" ? "bg-red-500" : item.priority === "urgent" ? "bg-orange-500" : "bg-green-500"
                          }`} />
                          <span className="font-medium">{item.condition}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {item.priority}
                          </Badge>
                        </div>
                        <div className="mt-0.5">{item.followUp} — {item.interval}</div>
                        <div className="text-muted-foreground">{item.rationale}</div>
                      </div>
                    );
                  })}
                  <Button size="sm" className="w-full text-xs" disabled={selectedItems.size === 0} onClick={handleInsert}>
                    <ArrowRight className="h-3 w-3 mr-1" /> Insert Selected
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Image Review ──
function ImageReviewTab({
  worklistId,
  studyInstanceUID,
  onInsert,
}: {
  worklistId: number;
  studyInstanceUID?: string | null;
  onInsert: (text: string) => void;
}) {
  const [isReviewing, setIsReviewing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReview = async () => {
    setIsReviewing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/ai-reporting/image-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worklistId,
          studyInstanceUID,
          reportBody: "", // current context
        }),
      });
      if (!res.ok) throw new Error("Image review failed");
      const data = await res.json();
      setResult(data.aiResponse || "No additional findings suggested.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Vision-capable AI secondary review. Requires a vision-capable provider (Gemini, GPT-4o, Claude).
      </div>
      {!studyInstanceUID && (
        <div className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
          <AlertTriangle className="h-3 w-3 inline mr-1" />No DICOM study linked. Image review requires a study with images.
        </div>
      )}
      <Button
        size="sm"
        className="w-full text-xs bg-purple-600 hover:bg-purple-700"
        onClick={handleReview}
        disabled={isReviewing || !studyInstanceUID}
      >
        {isReviewing ? <Sparkles className="h-3 w-3 animate-spin mr-1" /> : <Image className="h-3 w-3 mr-1" />}
        Run Image Review
      </Button>
      {error && (
        <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</div>
      )}
      {result && (
        <div className="space-y-2">
          <div className="border rounded p-2 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground">AI Image Review</span>
              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-[10px]" onClick={() => onInsert(result)} title="Insert">
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="text-[11px] whitespace-pre-wrap text-muted-foreground">{result}</div>
          </div>
          <div className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Review all AI suggestions against the actual images.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Previous Report Comparison ──
function CompareTab({
  worklistId,
  studyInstanceUID,
  onInsert,
}: {
  worklistId: number;
  studyInstanceUID?: string | null;
  onInsert: (text: string) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [prevReports, setPrevReports] = useState<{ id: number; date: string; modality: string; body: string; impression: string }[]>([]);
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-reporting/previous-reports?worklistId=${worklistId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to load previous reports");
      const data = await res.json();
      setPrevReports(data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompare = async (reportId: number) => {
    setSelectedReport(reportId);
    setDiffText(null);
    try {
      const res = await fetch(`/api/ai-reporting/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worklistId, previousReportId: reportId }),
      });
      if (!res.ok) throw new Error("Comparison failed");
      const data = await res.json();
      setDiffText(data.comparison || "No significant changes detected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Compare with previous imaging and highlight progression.
      </div>
      <Button size="sm" className="w-full text-xs" onClick={handleLoad} disabled={isLoading}>
        <History className="h-3 w-3 mr-1" /> Load Previous Reports
      </Button>
      {error && (
        <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</div>
      )}
      {prevReports.length > 0 && (
        <div className="space-y-1">
          {prevReports.map((r) => (
            <button
              key={r.id}
              className={`w-full text-left text-[11px] px-2 py-1.5 rounded border transition-colors ${
                selectedReport === r.id ? "bg-blue-50 border-blue-200" : "bg-background hover:bg-muted/50"
              }`}
              onClick={() => handleCompare(r.id)}
            >
              <div className="font-medium">{r.modality} — {r.date}</div>
              <div className="text-muted-foreground truncate">{r.impression}</div>
            </button>
          ))}
        </div>
      )}
      {diffText && (
        <div className="space-y-2">
          <div className="border rounded p-2 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground">Comparison</span>
              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-[10px]" onClick={() => onInsert(diffText)} title="Insert">
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="text-[11px] whitespace-pre-wrap text-muted-foreground">{diffText}</div>
          </div>
          <div className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Review comparison for accuracy.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Quality Checker ──
function QualityTab({
  reportBody,
  impression,
  onInsert,
}: {
  reportBody: string;
  impression: string;
  onInsert: (text: string) => void;
}) {
  const [check, setCheck] = useState<QualityCheck | null>(null);

  const handleRunCheck = () => {
    setCheck(runQualityCheck(reportBody, impression));
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Detect missing impression, measurements, contradictions, and errors.
      </div>
      <Button size="sm" className="w-full text-xs" onClick={handleRunCheck}>
        <ShieldCheck className="h-3 w-3 mr-1" /> Run Quality Check
      </Button>
      {check && (
        <div className="space-y-2">
          <div className={`text-[11px] font-medium px-2 py-1 rounded border flex items-center gap-1 ${
            check.pass ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
          }`}>
            {check.pass ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Quality Score: {check.score}%
          </div>
          <div className="space-y-1">
            {check.checks.map((item) => (
              <div key={item.id} className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 ${
                item.pass ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
              }`}>
                {item.pass ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {item.label} {item.message ? `— ${item.message}` : ""}
              </div>
            ))}
          </div>
          {check.warnings.length > 0 && (
            <div className="space-y-1">
              {check.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />{w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Language Polish ──
function PolishTab({
  reportBody,
  onInsert,
}: {
  reportBody: string;
  onInsert: (text: string) => void;
}) {
  const [polished, setPolished] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePolish = async () => {
    if (!reportBody.trim()) return;
    setIsPolishing(true);
    setError(null);
    setPolished(null);
    try {
      const res = await fetch(`/api/ai-reporting/polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reportBody }),
      });
      if (!res.ok) throw new Error("Polish failed");
      const data = await res.json();
      setPolished(data.polished || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsPolishing(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Refine language, grammar, and formatting. Does not change medical content.
      </div>
      <Button
        size="sm"
        className="w-full text-xs"
        onClick={handlePolish}
        disabled={isPolishing || !reportBody.trim()}
      >
        <Languages className="h-3 w-3 mr-1" /> Polish Language
      </Button>
      {error && (
        <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded border border-red-200">
          {error}
        </div>
      )}
      {polished && (
        <div className="space-y-2">
          <div className="border rounded p-2 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground">Polished</span>
              <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-[10px]" onClick={() => onInsert(polished)} title="Insert">
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="text-[11px] whitespace-pre-wrap text-muted-foreground">{polished}</div>
          </div>
          <div className="text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Review for accuracy before inserting.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Prompt Manager ──
function PromptManagerTab() {
  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Admin-editable prompt library with version history.
      </div>
      <div className="text-[11px] text-muted-foreground bg-muted/30 p-3 rounded border text-center">
        Prompt Manager is coming soon.
      </div>
    </div>
  );
}
