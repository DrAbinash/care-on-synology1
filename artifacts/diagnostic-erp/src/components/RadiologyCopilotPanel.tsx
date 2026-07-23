/**
 * Phase 8: Radiology Copilot Panel
 * Prior Study Auto-Fetch, Smart Impression, Consistency Checker, Follow-up Suggestions
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { isFeatureEnabled } from "@/lib/staffSession";
import { api } from "@/lib/fetchApi";
import { buildPriorStudiesPath } from "@/lib/priorStudiesPanelState";
import {
  History,
  Brain,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
  User,
  Sparkles,
  Clock,
  ArrowRight,
  List,
  Database,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  GitCompare,
  Layers,
} from "lucide-react";
import SpineIntelligencePanel from "./SpineIntelligencePanel";
import BrainIntelligencePanel from "./BrainIntelligencePanel";
import TumorFollowupPanel from "./TumorFollowupPanel";
import MultiAIReviewPanel from "./MultiAIReviewPanel";
import ImageAnnotationToolbar from "./ImageAnnotationToolbar";
import AIConfidenceBadge from "./AIConfidenceBadge";

interface PriorStudy {
  id: number;
  accessionNumber: string;
  modality: string;
  bodyPart: string | null;
  studyDate: string;
  testName: string;
  testCode: string | null;
  impression: string | null;
  finalReport: string | null;
  reportedBy: string | null;
  reportedAt: string | null;
  status: string;
  reportId?: number | null;
  reportStatus?: string | null;
}

interface ConsistencyIssue {
  type: string;
  message: string;
  severity: "warning" | "error" | "info";
}

// ── Phase 10C: Generate Teaching Case from report — inline button component ──
function GenerateTeachingCaseButton({
  modality, bodyPart, findingsText, impressionText,
}: { modality?: string; bodyPart?: string; findingsText?: string; impressionText?: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; diagnosis: string } | null>(null);

  const handleGenerate = async () => {
    if (!findingsText?.trim()) return;
    setLoading(true);
    try {
      const data = await api.post<{ case?: { title?: string; diagnosis?: string }; error?: string }>(
        "/api/teaching-cases/generate-from-report",
        { modality, bodyPart, findings: findingsText, impression: impressionText },
      );
      setResult({
        title: data.case?.title ?? "Teaching Case Draft",
        diagnosis: data.case?.diagnosis ?? "",
      });
      toast({ title: "Teaching case created", description: "AI Draft — Requires Radiologist Review before publishing." });
    } catch (err: unknown) {
      toast({ title: "Could not generate teaching case", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" className="w-full text-xs" disabled={loading} onClick={handleGenerate}>
        <Sparkles size={12} className="mr-1.5 text-primary" />
        {loading ? "Generating teaching case..." : "Generate Teaching Case from This Report"}
      </Button>
      {result && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] space-y-0.5">
          <div className="text-amber-700 font-medium flex items-center gap-1">
            <AlertTriangle size={10} /> AI Draft — Requires Radiologist Review
          </div>
          <div className="font-medium">{result.title}</div>
          {result.diagnosis && <div className="text-muted-foreground">Diagnosis: {result.diagnosis}</div>}
          <a href="/erp/teaching-cases" className="text-primary text-[10px] underline">View in Teaching Files →</a>
        </div>
      )}
    </div>
  );
}

interface FollowUpSuggestion {
  category: string;
  recommendation: string;
  urgency: "routine" | "urgent" | "immediate";
  timeframe: string;
  source: string;
}

interface DicomMetadata {
  modality: string | null;
  bodyPart: string | null;
  studyDescription: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string | null;
  scheduledStationAETitle: string | null;
  referringDoctor: string | null;
  numImages: number | null;
  technique: string;
}

type ComparisonResult = {
  comparison: Array<{ parameter: string; status: string; confidence: string; detail: string; priorValue: string | null; currentValue: string | null }>;
  overallTrend: string;
  counts: Record<string, number>;
  totalParameters: number;
};

// C2 (Cockpit→Workspace merge): build a narrative "COMPARISON:" paragraph from
// the ACTUAL structured-comparison result (real per-parameter detail from the
// server), rather than the Cockpit's generic "Interval Changes: " placeholder
// with nothing filled in.
function buildComparisonNarrative(result: ComparisonResult): string {
  if (result.comparison.length === 0) {
    return "COMPARISON: No significant interval change compared to the prior study.";
  }
  const lines = result.comparison.map((item) => `${item.parameter}: ${item.detail}`);
  return `COMPARISON: ${lines.join("\n")}`;
}

interface Props {
  patientId?: number;
  currentOrderId?: number;
  studyId?: number;
  studyInstanceUid?: string | null;
  findingsText?: string;
  impressionText?: string;
  onImpressionSuggestion?: (text: string) => void;
  // C2 (Cockpit→Workspace merge): one-click narrative comparison insert,
  // driven off THIS panel's own structured-comparison result — not a
  // re-fetch of the prior report — so there's a single source of truth for
  // "what changed since the prior study."
  onInsertComparisonText?: (text: string) => void;
  initialTab?: "prior" | "impression" | "consistency" | "followup" | "dicom" | "compare" | "changes" | "organ";
}

export default function RadiologyCopilotPanel({
  patientId,
  currentOrderId,
  studyId,
  studyInstanceUid: studyInstanceUidProp,
  findingsText,
  impressionText,
  onImpressionSuggestion,
  onInsertComparisonText,
  initialTab,
}: Props) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"prior" | "impression" | "consistency" | "followup" | "dicom" | "compare" | "changes" | "organ">(initialTab ?? "prior");
  const [priorStudies, setPriorStudies] = useState<PriorStudy[]>([]);
  const [loadingPrior, setLoadingPrior] = useState(false);
  const [priorError, setPriorError] = useState(false);
  const [expandedStudy, setExpandedStudy] = useState<number | null>(null);
  const [suggestedImpression, setSuggestedImpression] = useState("");
  const [loadingImpression, setLoadingImpression] = useState(false);
  const [consistencyIssues, setConsistencyIssues] = useState<ConsistencyIssue[]>([]);
  const [loadingConsistency, setLoadingConsistency] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);
  const [dicomMeta, setDicomMeta] = useState<DicomMetadata | null>(null);
  const [loadingDicomMeta, setLoadingDicomMeta] = useState(false);

  // Phase 10A: Structured comparison state
  const [priorFindingsInput, setPriorFindingsInput] = useState("");
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Phase 10A: Change detector state
  const [changesPriorInput, setChangesPriorInput] = useState("");
  const [changesResult, setChangesResult] = useState<null | {
    changes: Array<{ category: string; categoryLabel: string; description: string; severity: string; priorSnippet?: string; currentSnippet?: string }>;
    totalChanges: number;
    criticalCount: number;
    warningCount: number;
  }>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);

  // Fetch prior studies when the patient (or current study) changes — through
  // the authenticated api helper on the canonical /api path, excluding the
  // current study server-side.
  const loadPriorStudies = useCallback(() => {
    if (!patientId) return;
    setLoadingPrior(true);
    setPriorError(false);
    api.get<{ studies: PriorStudy[] }>(buildPriorStudiesPath({ patientId, limit: 20, excludeStudyId: studyId }))
      .then((data) => {
        setPriorStudies(data.studies ?? []);
      })
      .catch(() => {
        setPriorError(true);
        toast({ title: "Could not load prior studies", variant: "destructive" });
      })
      .finally(() => setLoadingPrior(false));
  }, [patientId, studyId, toast]);

  useEffect(() => {
    loadPriorStudies();
  }, [loadPriorStudies]);

  // Smart impression suggestion
  const generateImpression = useCallback(async () => {
    if (!findingsText?.trim()) {
      toast({ title: "Enter findings first", variant: "destructive" });
      return;
    }
    setLoadingImpression(true);
    try {
      const r = await fetch("/radiology-copilot/impression-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: findingsText }),
      });
      const data = await r.json();
      if (r.ok) {
        setSuggestedImpression(data.impression);
      } else {
        toast({ title: "Could not generate impression", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not generate impression", variant: "destructive" });
    } finally {
      setLoadingImpression(false);
    }
  }, [findingsText, toast]);

  // Consistency check
  const checkConsistency = useCallback(async () => {
    if (!findingsText?.trim() || !impressionText?.trim()) {
      toast({ title: "Enter both findings and impression", variant: "destructive" });
      return;
    }
    setLoadingConsistency(true);
    try {
      const r = await fetch("/radiology-copilot/consistency-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: findingsText, impression: impressionText }),
      });
      const data = await r.json();
      if (r.ok) {
        setConsistencyIssues(data.issues ?? []);
      } else {
        toast({ title: "Could not check consistency", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not check consistency", variant: "destructive" });
    } finally {
      setLoadingConsistency(false);
    }
  }, [findingsText, impressionText, toast]);

  // Follow-up suggestions
  const getFollowUp = useCallback(async () => {
    if (!impressionText?.trim()) {
      toast({ title: "Enter impression first", variant: "destructive" });
      return;
    }
    setLoadingFollowUp(true);
    try {
      const r = await fetch("/radiology-copilot/follow-up-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impression: impressionText }),
      });
      const data = await r.json();
      if (r.ok) {
        setFollowUpSuggestions(data.suggestions ?? []);
      } else {
        toast({ title: "Could not get follow-up suggestions", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not get follow-up suggestions", variant: "destructive" });
    } finally {
      setLoadingFollowUp(false);
    }
  }, [impressionText, toast]);

  // Fetch DICOM metadata when studyId changes
  useEffect(() => {
    if (!studyId) return;
    setLoadingDicomMeta(true);
    fetch(`/radiology-copilot/dicom-metadata/${studyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.technique) setDicomMeta(data);
      })
      .catch(() => {})
      .finally(() => setLoadingDicomMeta(false));
  }, [studyId]);

  // Feature-flag gating for Phase 10A tabs
  const phase10Master = useMemo(() => isFeatureEnabled("dicomImageIntelligence"), []);
  const changeDetectionEnabled = useMemo(() => phase10Master && isFeatureEnabled("changeDetection"), [phase10Master]);
  const spineEnabled = useMemo(() => isFeatureEnabled("spineIntelligence"), []);
  const brainEnabled = useMemo(() => isFeatureEnabled("brainIntelligence"), []);
  const tumorEnabled = useMemo(() => isFeatureEnabled("tumorFollowup"), []);
  const organIntelligenceEnabled = spineEnabled || brainEnabled || tumorEnabled;
  const multiAIEnabled = useMemo(() => isFeatureEnabled("multiAIImageReview"), []);
  const annotationsEnabled = useMemo(() => isFeatureEnabled("imageAnnotations"), []);
  const aiConfidenceEnabled = useMemo(() => isFeatureEnabled("confidenceVisualization"), []);

  // ── Auto-run: debounced comparison with most-recent prior study ──────────
  // Fires 2.5s after currentFindings settles, but only once per (findingsText, priorStudies[0].id) pair
  const lastAutoComparedRef = useRef<{ findingsKey: string; priorId: number } | null>(null);
  useEffect(() => {
    if (!phase10Master) return;
    if (!findingsText || findingsText.trim().length < 30) return;   // need meaningful text
    const topPrior = priorStudies.find((s) => s.impression);        // most recent with a report
    if (!topPrior) return;

    const key = { findingsKey: findingsText.slice(0, 80), priorId: topPrior.id };
    if (
      lastAutoComparedRef.current?.findingsKey === key.findingsKey &&
      lastAutoComparedRef.current?.priorId === key.priorId
    ) return; // already ran this exact pair

    const timer = setTimeout(async () => {
      lastAutoComparedRef.current = key;
      setLoadingComparison(true);
      try {
        const r = await fetch("/api/radiology-copilot/structured-comparison", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentFindings: findingsText, priorStudyId: topPrior.id }),
        });
        const data = await r.json();
        if (r.ok) setComparisonResult(data);
      } catch { /* silent — auto-run failure is non-critical */ }
      finally { setLoadingComparison(false); }
    }, 2500);

    return () => clearTimeout(timer);
  }, [phase10Master, findingsText, priorStudies]);

  // Auto-compare: when a prior study impression is known, pre-fill and offer one-click compare
  const autoCompare = useCallback(async (priorStudyId: number) => {
    if (!findingsText?.trim()) return;
    setLoadingComparison(true);
    setActiveTab("compare");
    try {
      const r = await fetch("/api/radiology-copilot/structured-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentFindings: findingsText, priorStudyId }),
      });
      const data = await r.json();
      if (r.ok) {
        setComparisonResult(data);
        if (data.resolvedPriorStudy) {
          setPriorFindingsInput(`[Auto-fetched from study ${data.resolvedPriorStudy.accessionNumber}]`);
        }
      } else {
        toast({ title: data.error ?? "Could not auto-compare", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not run auto-comparison", variant: "destructive" });
    } finally {
      setLoadingComparison(false);
    }
  }, [findingsText, toast]);

  // Phase 10A: run structured comparison
  const runComparison = useCallback(async () => {
    if (!findingsText?.trim() || !priorFindingsInput.trim()) {
      toast({ title: "Enter current findings and paste prior study findings", variant: "destructive" });
      return;
    }
    setLoadingComparison(true);
    try {
      const r = await fetch("/api/radiology-copilot/structured-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentFindings: findingsText, priorFindings: priorFindingsInput }),
      });
      const data = await r.json();
      if (r.ok) setComparisonResult(data);
      else toast({ title: "Could not run comparison", variant: "destructive" });
    } catch {
      toast({ title: "Could not run comparison", variant: "destructive" });
    } finally {
      setLoadingComparison(false);
    }
  }, [findingsText, priorFindingsInput, toast]);

  // Phase 10A: run change detector
  const runChangeDetector = useCallback(async () => {
    if (!findingsText?.trim() || !changesPriorInput.trim()) {
      toast({ title: "Enter current findings and paste prior study findings", variant: "destructive" });
      return;
    }
    setLoadingChanges(true);
    try {
      const r = await fetch("/api/radiology-copilot/change-detector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentFindings: findingsText, priorFindings: changesPriorInput }),
      });
      const data = await r.json();
      if (r.ok) setChangesResult(data);
      else toast({ title: "Could not detect changes", variant: "destructive" });
    } catch {
      toast({ title: "Could not detect changes", variant: "destructive" });
    } finally {
      setLoadingChanges(false);
    }
  }, [findingsText, changesPriorInput, toast]);

  const tabs = useMemo(() => {
    const all = [
      { id: "prior" as const, label: "Prior", icon: History },
      { id: "impression" as const, label: "Impression", icon: Brain },
      // Phase 10A tabs — only shown when flags are ON
      ...(phase10Master ? [{ id: "compare" as const, label: "Compare", icon: GitCompare }] : []),
      ...(changeDetectionEnabled ? [{ id: "changes" as const, label: "Changes", icon: Zap }] : []),
      { id: "consistency" as const, label: "Consistency", icon: CheckCircle },
      { id: "followup" as const, label: "Follow-up", icon: Clock },
      { id: "dicom" as const, label: "DICOM", icon: Database },
      // Phase 10B: Organ Intelligence tab — shown only when ≥1 organ flag is ON
      ...(organIntelligenceEnabled ? [{ id: "organ" as const, label: "Organ", icon: Layers }] : []),
    ];
    return all;
  }, [phase10Master, changeDetectionEnabled, organIntelligenceEnabled]);

  return (
    <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
        <Sparkles size={14} className="text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Radiology Copilot</span>
      </div>

      {/* Tab buttons */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            }`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {activeTab === "prior" && (
          <>
            {loadingPrior ? (
              <div className="text-center py-4 text-xs text-muted-foreground">Loading prior studies...</div>
            ) : priorError ? (
              <div className="text-center py-4 text-xs space-y-2" data-testid="copilot-prior-error">
                <p className="text-destructive flex items-center justify-center gap-1">
                  <AlertTriangle size={12} /> Couldn't load prior studies.
                </p>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={loadPriorStudies}>Retry</Button>
              </div>
            ) : priorStudies.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                {patientId ? "No prior studies found for this patient." : "Select a patient to see prior studies."}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <List size={11} />
                  {priorStudies.length} prior study{priorStudies.length > 1 ? "ies" : "y"} found
                </div>
                {priorStudies.map((study) => (
                  <div key={study.id} className="border rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                      onClick={() => setExpandedStudy(expandedStudy === study.id ? null : study.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-mono uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {study.modality}
                        </span>
                        <span className="text-xs truncate">{study.testName}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          <Calendar size={10} className="inline mr-0.5" />
                          {new Date(study.studyDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </span>
                        {expandedStudy === study.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </div>
                    </button>
                    {expandedStudy === study.id && (
                      <div className="px-3 py-2 border-t bg-muted/10 text-xs space-y-1.5">
                        {study.bodyPart && (
                          <div className="text-muted-foreground">Body Part: {study.bodyPart}</div>
                        )}
                        {study.impression && (
                          <div>
                            <span className="font-medium text-[10px] uppercase text-muted-foreground">Impression</span>
                            <p className="text-[11px] mt-0.5">{study.impression}</p>
                          </div>
                        )}
                        {study.reportedBy && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <User size={10} /> {study.reportedBy}
                            {study.reportedAt && (
                              <span>
                                <Calendar size={10} className="inline mx-0.5" />
                                {new Date(study.reportedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Phase 10A: Auto-compare button — only shown when flag is on */}
                        {phase10Master && findingsText?.trim() && study.impression && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-[10px] h-7 mt-1"
                            onClick={() => autoCompare(study.id)}
                            disabled={loadingComparison}
                          >
                            <GitCompare size={10} className="mr-1" />
                            {loadingComparison ? "Comparing..." : "Auto-Compare with this Study"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Phase 10A: Inline structured diff — auto-populated when flags are ON */}
            {phase10Master && (loadingComparison || comparisonResult) && (
              <div className="mt-3 border border-border rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
                  <GitCompare size={12} className="text-primary" />
                  <span className="text-[11px] font-semibold text-primary">Structured Prior Comparison</span>
                  {loadingComparison && (
                    <span className="text-[10px] text-muted-foreground ml-auto animate-pulse">Comparing...</span>
                  )}
                  {comparisonResult && !loadingComparison && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto ${
                      comparisonResult.overallTrend === "progressed" ? "bg-red-100 text-red-700"
                      : comparisonResult.overallTrend === "improved" ? "bg-green-100 text-green-700"
                      : "bg-blue-100 text-blue-700"
                    }`}>
                      Overall: {comparisonResult.overallTrend}
                    </span>
                  )}
                </div>
                {comparisonResult && !loadingComparison && (
                  <div className="p-2 space-y-1.5 max-h-48 overflow-y-auto">
                    {comparisonResult.comparison.length === 0 ? (
                      <div className="text-center py-2 text-[10px] text-muted-foreground">No significant parameter changes detected.</div>
                    ) : (
                      comparisonResult.comparison.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-[10px]">
                          <span className={`mt-0.5 flex-shrink-0 px-1 py-0.5 rounded text-[9px] font-medium ${
                            item.status === "progressed" ? "bg-red-100 text-red-700"
                            : item.status === "improved" ? "bg-green-100 text-green-700"
                            : item.status === "new" ? "bg-orange-100 text-orange-700"
                            : item.status === "resolved" ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                          }`}>{item.status}</span>
                          <div>
                            <span className="font-medium">{item.parameter}</span>
                            <span className="text-muted-foreground ml-1">— {item.detail.substring(0, 80)}</span>
                          </div>
                        </div>
                      ))
                    )}
                    <div className="text-[9px] text-amber-600 flex items-center gap-1 pt-1 border-t border-border">
                      <AlertTriangle size={8} /> AI Draft – Requires Radiologist Review
                    </div>
                    {/* C2 (Cockpit→Workspace merge): one-click insert of a narrative
                        comparison paragraph built from THIS result — not a generic
                        placeholder, the actual per-parameter comparison text. */}
                    {onInsertComparisonText && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-[10px] h-7 mt-1"
                        onClick={() => onInsertComparisonText(buildComparisonNarrative(comparisonResult))}
                      >
                        Insert Comparison into Findings
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "impression" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Suggest an impression based on current findings. The radiologist always has final authority.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              disabled={loadingImpression || !findingsText?.trim()}
              onClick={generateImpression}
            >
              <Brain size={13} className="mr-1.5" />
              {loadingImpression ? "Generating..." : "Suggest Impression"}
            </Button>
            {suggestedImpression && (
              <div className="space-y-2">
                <div className="text-[10px] text-amber-600 font-medium flex items-center gap-1">
                  <AlertTriangle size={10} /> AI Draft — Requires Radiologist Review
                </div>
                {aiConfidenceEnabled ? (
                  <AIConfidenceBadge
                    metadata={{ confidence: 75, provider: "gemini", evidenceBullets: ["Based on submitted findings text"], uncertaintyReasons: ["Clinical context not fully known"] }}
                  >
                    <Textarea
                      value={suggestedImpression}
                      onChange={(e) => setSuggestedImpression(e.target.value)}
                      className="text-xs min-h-[60px]"
                    />
                  </AIConfidenceBadge>
                ) : (
                  <Textarea
                    value={suggestedImpression}
                    onChange={(e) => setSuggestedImpression(e.target.value)}
                    className="text-xs min-h-[60px]"
                  />
                )}
                {onImpressionSuggestion && (
                  <Button
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => onImpressionSuggestion(suggestedImpression)}
                  >
                    <ArrowRight size={12} className="mr-1" /> Use This Impression
                  </Button>
                )}
              </div>
            )}
            {/* Phase 10C: Generate Teaching Case from this report */}
            {isFeatureEnabled("teachingGenerator") && findingsText?.trim() && (
              <div className="border-t border-border pt-3 mt-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Teaching Case Generator</p>
                <GenerateTeachingCaseButton
                  modality={dicomMeta?.modality ?? undefined}
                  bodyPart={dicomMeta?.bodyPart ?? undefined}
                  findingsText={findingsText}
                  impressionText={impressionText}
                />
              </div>
            )}
            {/* Phase 10C: Multi-AI review — gated by multiAIImageReview flag */}
            {multiAIEnabled && (
              <div className="border-t border-border pt-3 mt-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Multi-AI Review</p>
                <MultiAIReviewPanel
                  modality={dicomMeta?.modality ?? undefined}
                  bodyPart={dicomMeta?.bodyPart ?? undefined}
                  findingsText={findingsText}
                  impressionText={impressionText}
                  onUseResult={(r) => {
                    if (r.findings) setSuggestedImpression(r.findings);
                    if (r.findings && onImpressionSuggestion) onImpressionSuggestion(r.findings);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "consistency" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Check if findings and impression are consistent. Detects side mismatches and region mismatches.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              disabled={loadingConsistency || !findingsText?.trim() || !impressionText?.trim()}
              onClick={checkConsistency}
            >
              <CheckCircle size={13} className="mr-1.5" />
              {loadingConsistency ? "Checking..." : "Check Consistency"}
            </Button>
            {consistencyIssues.length > 0 && (
              <div className="space-y-1.5">
                {consistencyIssues.map((issue, i) => (
                  <div
                    key={i}
                    className={`px-2.5 py-1.5 rounded text-[11px] flex items-start gap-1.5 ${
                      issue.severity === "error"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : issue.severity === "warning"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-green-50 text-green-700 border border-green-200"
                    }`}
                  >
                    {issue.severity === "error" ? (
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-red-500" />
                    ) : issue.severity === "warning" ? (
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircle size={12} className="mt-0.5 flex-shrink-0 text-green-500" />
                    )}
                    {issue.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "followup" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Guideline-based follow-up suggestions from BI-RADS, TI-RADS, and best practice.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              disabled={loadingFollowUp || !impressionText?.trim()}
              onClick={getFollowUp}
            >
              <Clock size={13} className="mr-1.5" />
              {loadingFollowUp ? "Loading..." : "Suggest Follow-up"}
            </Button>
            {followUpSuggestions.length > 0 && (
              <div className="space-y-2">
                {followUpSuggestions.map((s, i) => (
                  <div key={i} className="border rounded-lg p-2.5 text-xs space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                          s.urgency === "immediate"
                            ? "bg-red-100 text-red-700"
                            : s.urgency === "urgent"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {s.urgency}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground">{s.category}</span>
                    </div>
                    <p className="font-medium text-[11px]">{s.recommendation}</p>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock size={10} /> {s.timeframe}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <FileText size={10} /> {s.source}
                    </div>
                  </div>
                ))}
                <div className="text-[10px] text-muted-foreground text-center pt-1">
                  AI Draft — Requires Radiologist Review
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "compare" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Paste the prior study findings below, then run a structured comparison against current findings.
              Each parameter is assessed as Improved / Stable / Progressed / New / Resolved.
            </p>
            <Textarea
              value={priorFindingsInput}
              onChange={(e) => setPriorFindingsInput(e.target.value)}
              className="text-xs min-h-[80px] resize-none"
              placeholder="Paste prior study findings here..."
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              disabled={loadingComparison || !findingsText?.trim() || !priorFindingsInput.trim()}
              onClick={runComparison}
            >
              <GitCompare size={13} className="mr-1.5" />
              {loadingComparison ? "Comparing..." : "Run Structured Comparison"}
            </Button>
            {comparisonResult && (
              <div className="space-y-2">
                {/* Overall trend badge */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    comparisonResult.overallTrend === "progressed" ? "bg-red-100 text-red-700"
                    : comparisonResult.overallTrend === "improved" ? "bg-green-100 text-green-700"
                    : "bg-blue-100 text-blue-700"
                  }`}>
                    Overall: {comparisonResult.overallTrend.charAt(0).toUpperCase() + comparisonResult.overallTrend.slice(1)}
                  </span>
                  {Object.entries(comparisonResult.counts).filter(([, v]) => v > 0).map(([k, v]) => (
                    <span key={k} className="text-[9px] text-muted-foreground">{v} {k}</span>
                  ))}
                </div>
                {/* Per-parameter rows */}
                {comparisonResult.comparison.map((item, i) => (
                  <div key={i} className="border border-border rounded-lg p-2 text-[11px] space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.parameter}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        item.status === "progressed" ? "bg-red-100 text-red-700"
                        : item.status === "improved" ? "bg-green-100 text-green-700"
                        : item.status === "new" ? "bg-orange-100 text-orange-700"
                        : item.status === "resolved" ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                      }`}>
                        {item.status === "progressed" ? <TrendingUp size={9} className="inline mr-0.5" />
                          : item.status === "improved" ? <TrendingDown size={9} className="inline mr-0.5" />
                          : <Minus size={9} className="inline mr-0.5" />}
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                      <span className={`text-[9px] text-muted-foreground ml-auto ${item.confidence === "low" ? "text-amber-600" : ""}`}>
                        {item.confidence} confidence
                      </span>
                    </div>
                    <div className="text-muted-foreground leading-relaxed">{item.detail}</div>
                  </div>
                ))}
                <div className="text-[9px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={9} /> AI Draft – Requires Radiologist Review
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "changes" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Paste prior study findings to detect categorized interval changes — new lesions, growth,
              regression, haemorrhage evolution, infarct evolution, edema, hydrocephalus.
            </p>
            <Textarea
              value={changesPriorInput}
              onChange={(e) => setChangesPriorInput(e.target.value)}
              className="text-xs min-h-[80px] resize-none"
              placeholder="Paste prior study findings here..."
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              disabled={loadingChanges || !findingsText?.trim() || !changesPriorInput.trim()}
              onClick={runChangeDetector}
            >
              <Zap size={13} className="mr-1.5" />
              {loadingChanges ? "Detecting..." : "Detect Interval Changes"}
            </Button>
            {changesResult && (
              <div className="space-y-2">
                {/* Summary badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  {changesResult.criticalCount > 0 && (
                    <span className="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      {changesResult.criticalCount} Critical
                    </span>
                  )}
                  {changesResult.warningCount > 0 && (
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                      {changesResult.warningCount} Warning
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground">{changesResult.totalChanges} total changes</span>
                </div>
                {changesResult.totalChanges === 0 ? (
                  <div className="text-center py-3 text-xs text-muted-foreground">No significant interval changes detected by pattern analysis.</div>
                ) : (
                  changesResult.changes.map((change, i) => (
                    <div key={i} className={`border rounded-lg p-2 text-[11px] space-y-1 ${
                      change.severity === "critical" ? "border-red-200 bg-red-50"
                      : change.severity === "warning" ? "border-amber-200 bg-amber-50"
                      : "border-border"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        {change.severity === "critical" ? (
                          <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
                        ) : change.severity === "warning" ? (
                          <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />
                        ) : (
                          <CheckCircle size={11} className="text-green-500 flex-shrink-0" />
                        )}
                        <span className="font-semibold text-[10px]">{change.categoryLabel}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{change.description}</p>
                      {(change.priorSnippet || change.currentSnippet) && (
                        <div className="grid grid-cols-2 gap-1 pt-0.5">
                          {change.priorSnippet && (
                            <div className="text-[9px]">
                              <span className="font-medium text-muted-foreground">Prior:</span>
                              <span className="text-muted-foreground"> {change.priorSnippet.substring(0, 60)}...</span>
                            </div>
                          )}
                          {change.currentSnippet && (
                            <div className="text-[9px]">
                              <span className="font-medium">Current:</span>
                              <span className="text-foreground"> {change.currentSnippet.substring(0, 60)}...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div className="text-[9px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={9} /> AI Draft – Requires Radiologist Review
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "dicom" && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              DICOM metadata from the study. Used to auto-generate the technique section.
            </p>
            {loadingDicomMeta ? (
              <div className="text-center py-4 text-xs text-muted-foreground">Loading metadata...</div>
            ) : !dicomMeta ? (
              <div className="text-center py-4 text-xs text-muted-foreground">
                {studyId ? "No DICOM metadata available for this study." : "Select a study to view DICOM metadata."}
              </div>
            ) : (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">Modality</span>
                  <span className="font-mono uppercase">{dicomMeta.modality ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">Body Part</span>
                  <span>{dicomMeta.bodyPart ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">Images</span>
                  <span>{dicomMeta.numImages ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">Accession</span>
                  <span className="font-mono">{dicomMeta.accessionNumber ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border py-1">
                  <span className="text-muted-foreground">Station</span>
                  <span>{dicomMeta.scheduledStationAETitle ?? "—"}</span>
                </div>
                <div className="pt-1">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Technique</span>
                  <p className="text-[11px] mt-0.5 leading-relaxed">{dicomMeta.technique}</p>
                </div>
                <div className="text-[10px] text-muted-foreground text-center pt-1">
                  AI Draft — Requires Radiologist Review
                </div>
              </div>
            )}
            {/* Phase 10C: Image Annotation Toolbar — gated by imageAnnotations flag */}
            {annotationsEnabled && (
              <div className="border-t border-border pt-3 mt-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-2">Annotations</p>
                <ImageAnnotationToolbar
                  studyInstanceUid={studyInstanceUidProp ?? dicomMeta?.studyInstanceUid}
                  orderId={currentOrderId}
                  patientId={patientId}
                  studyId={studyId}
                />
              </div>
            )}
          </div>
        )}
        {/* Phase 10B: Organ Intelligence tab */}
        {activeTab === "organ" && (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
              AI Draft — Requires Radiologist Review. Organ Intelligence panels provide structured data entry for longitudinal follow-up only.
            </div>
            {spineEnabled && (
              <SpineIntelligencePanel
                patientId={patientId}
                orderId={currentOrderId}
                studyId={studyId}
              />
            )}
            {brainEnabled && (
              <BrainIntelligencePanel
                patientId={patientId}
                orderId={currentOrderId}
                studyId={studyId}
              />
            )}
            {tumorEnabled && (
              <TumorFollowupPanel
                patientId={patientId}
                orderId={currentOrderId}
                studyId={studyId}
              />
            )}
            {!spineEnabled && !brainEnabled && !tumorEnabled && (
              <div className="text-center py-6 text-muted-foreground text-xs">
                Enable Spine Intelligence, Brain Intelligence, or Tumor Follow-up in Settings → Radiology → Phase 10 to activate this tab.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
