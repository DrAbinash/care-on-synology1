/**
 * LegacyBox — additive home for legacy Reporting Workspace tools that are not
 * yet the default surface of the new Z.ai workspace.
 *
 * RULE: never replace or remove new-workspace UI. Mount every useful legacy
 * panel here (or link to it) so radiologists can keep using them while we
 * decide what stays after real use.
 */
import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Archive, Sparkles, BookOpen, Ruler, Printer, FileDiff, GraduationCap,
  Library, Brain, MonitorPlay, ChevronDown, ChevronRight, ClipboardPlus, Heart,
} from "lucide-react";
import CareCopilotPanel, { type CopilotAction } from "@/components/radiology/CareCopilotPanel";
import FindingsLibraryPanel from "@/components/radiology/FindingsLibraryPanel";
import ViewerMeasurementsPanel from "@/components/radiology/ViewerMeasurementsPanel";
import UsgMeasurementReviewPanel from "@/components/radiology/UsgMeasurementReviewPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import PreferencesPanel from "@/components/PreferencesPanel";
import RadiologyKnowledgePanel from "@/components/RadiologyKnowledgePanel";
import RadiologyMemoryPanel from "@/components/RadiologyMemoryPanel";
import OpenStudyPanel from "@/components/radiology/OpenStudyPanel";
import ReportLayoutQuickSelect, { type ReportLayoutKey } from "@/components/radiology/ReportLayoutQuickSelect";
import { AiDraftPanel } from "@/components/ai/AiDraftPanel";
import { analyzeCopilot, type CopilotItem, type CopilotReport } from "@/lib/copilotOrchestrator";
import { useCopilotPrefs } from "@/hooks/useCopilotPrefs";
import { isUltrasoundModality } from "@/lib/usgModality";
import { useToast } from "@/hooks/use-toast";

export type LegacyBoxTab =
  | "links"
  | "copilot"
  | "library"
  | "templates"
  | "measurements"
  | "memory"
  | "knowledge"
  | "diff"
  | "print"
  | "ai"
  | "teaching"
  | "open-study";

const TABS: Array<{ id: LegacyBoxTab; label: string; icon: ReactNode }> = [
  { id: "links", label: "Links", icon: <Archive className="h-3 w-3" /> },
  { id: "copilot", label: "CARE Copilot", icon: <Sparkles className="h-3 w-3" /> },
  { id: "library", label: "Findings Lib", icon: <Library className="h-3 w-3" /> },
  { id: "templates", label: "Templates", icon: <BookOpen className="h-3 w-3" /> },
  { id: "measurements", label: "Measure", icon: <Ruler className="h-3 w-3" /> },
  { id: "memory", label: "Memory", icon: <Heart className="h-3 w-3" /> },
  { id: "knowledge", label: "Knowledge", icon: <Brain className="h-3 w-3" /> },
  { id: "diff", label: "AI Diff", icon: <FileDiff className="h-3 w-3" /> },
  { id: "print", label: "Print Preview", icon: <Printer className="h-3 w-3" /> },
  { id: "ai", label: "AI Draft", icon: <Sparkles className="h-3 w-3" /> },
  { id: "teaching", label: "Teaching", icon: <GraduationCap className="h-3 w-3" /> },
  { id: "open-study", label: "Open Study", icon: <MonitorPlay className="h-3 w-3" /> },
];

type MasterTemplate = {
  id: number;
  groupName: string;
  templateName: string;
  modality: string;
  bodyPart: string | null;
  findings: string;
  impression: string;
  recommendations: string | null;
};

type UsgTemplate = {
  id: string;
  label: string;
  category: string;
};

export interface LegacyBoxProps {
  /** Controlled tab — parent can open a specific legacy tool. */
  activeTab?: LegacyBoxTab | null;
  onTabChange?: (tab: LegacyBoxTab) => void;
  worklistId?: number | null;
  studyId?: number | null;
  patientId?: number | null;
  orderId?: number | null;
  draftId?: number | null;
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  modality?: string | null;
  studyDescription?: string | null;
  bodyPart?: string | null;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  techniqueText: string;
  clinicalHistoryText: string;
  selectedFindingLabels?: string[];
  criticalMarked?: boolean;
  criticalCommunicated?: boolean;
  isAdmin?: boolean;
  disabled?: boolean;
  currentUserId?: number | null;
  onAppendFindings: (text: string) => void;
  onAppendImpression: (text: string) => void;
  onAppendRecommendation: (text: string) => void;
  onSetFindings: (text: string) => void;
  onSetImpression: (text: string) => void;
  onSetTechnique: (text: string) => void;
  onApplyReport: (r: { findingsText: string; impressionLines: string[]; technique?: string }) => void;
  /** Optional: notify parent when Dual/Open Study launches (popup blocked → split). */
  onViewerLaunchResult?: (result: { success: boolean; errorCode?: string | null }) => void;
  /** Controlled Classic/Premium layout — shared with workspace export panel. */
  printLayout?: ReportLayoutKey;
  onPrintLayoutChange?: (key: ReportLayoutKey) => void;
  clinicActiveLayout?: string | null;
}

export default function LegacyBox(props: LegacyBoxProps) {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [internalTab, setInternalTab] = useState<LegacyBoxTab>("links");
  const tab = props.activeTab ?? internalTab;
  const setTab = (t: LegacyBoxTab) => {
    setInternalTab(t);
    props.onTabChange?.(t);
    setCollapsed(false);
  };

  const { prefs: copilotPrefs, set: setCopilotPrefs } = useCopilotPrefs();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [recentActions, setRecentActions] = useState<CopilotAction[]>([]);
  const [knowledgeSub, setKnowledgeSub] = useState("master");
  const [internalPrintLayout, setInternalPrintLayout] = useState<ReportLayoutKey>("care-classic");
  const printLayout = props.printLayout ?? internalPrintLayout;
  const setPrintLayout = (key: ReportLayoutKey) => {
    setInternalPrintLayout(key);
    props.onPrintLayoutChange?.(key);
  };
  const [teachingNotes, setTeachingNotes] = useState("");
  const [teachingBusy, setTeachingBusy] = useState(false);
  const [formFBusy, setFormFBusy] = useState(false);
  const [usgApplyBusy, setUsgApplyBusy] = useState<string | null>(null);

  const careReport: CopilotReport = useMemo(
    () => analyzeCopilot({
      modality: props.modality ?? "",
      studyDescription: props.studyDescription ?? "",
      clinicalHistory: props.clinicalHistoryText,
      findings: props.findingsText,
      impression: props.impressionText.split("\n").filter(Boolean),
      recommendation: props.recommendationText,
      technique: props.techniqueText,
      selectedFindingLabels: props.selectedFindingLabels ?? [],
      criticalMarked: props.criticalMarked,
      criticalCommunicated: props.criticalCommunicated,
    }),
    [
      props.modality, props.studyDescription, props.clinicalHistoryText,
      props.findingsText, props.impressionText, props.recommendationText,
      props.techniqueText, props.selectedFindingLabels,
      props.criticalMarked, props.criticalCommunicated,
    ],
  );

  useEffect(() => {
    setDismissed(new Set());
    setRecentActions([]);
  }, [props.worklistId, props.studyInstanceUID]);

  const { data: reportDiff } = useQuery<{ diffHtml?: string; summary?: string; error?: string }>({
    queryKey: ["legacy-report-diff", props.worklistId],
    queryFn: async () => {
      try {
        return await api.get(`/api/ai-reporting/report-diff/${props.worklistId}`);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Diff unavailable" };
      }
    },
    enabled: tab === "diff" && !!props.worklistId,
    staleTime: 60_000,
  });

  const printPreviewUrl = useMemo(() => {
    if (!props.draftId) return null;
    const q = printLayout ? `?template=${encodeURIComponent(printLayout)}` : "";
    return `/api/radiology/report-generator/drafts/${props.draftId}/print-preview${q}`;
  }, [props.draftId, printLayout]);

  const { data: printHtml, isFetching: printLoading } = useQuery<string>({
    queryKey: ["legacy-print-preview", props.draftId, printLayout],
    queryFn: async () => {
      const res = await fetch(printPreviewUrl!, { credentials: "include" });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      return res.text();
    },
    enabled: tab === "print" && !!printPreviewUrl,
    staleTime: 30_000,
  });

  const { data: masterTemplatesResp } = useQuery<{ templates: MasterTemplate[]; count: number }>({
    queryKey: ["radiology-master-templates-v2"],
    queryFn: () => api.get("/api/radiology/knowledge/master-templates"),
    staleTime: 300_000,
    enabled: tab === "templates",
  });
  const masterTemplates = masterTemplatesResp?.templates ?? [];

  const isUs = isUltrasoundModality(props.modality);
  const { data: usgTemplates = [] } = useQuery<UsgTemplate[]>({
    queryKey: ["usg-report-templates"],
    queryFn: () => api.get("/api/usg-reports/templates"),
    staleTime: 300_000,
    enabled: tab === "templates" && isUs,
  });

  function insertCopilot(item: CopilotItem) {
    const text = item.insertText?.trim();
    if (!text) return;
    if (item.insertTarget === "impression") props.onAppendImpression(text);
    else if (item.insertTarget === "recommendation") props.onAppendRecommendation(text);
    else props.onAppendFindings(text);
    setRecentActions((prev) => [{ id: item.id, title: item.title, category: item.category, outcome: "accepted" as const }, ...prev].slice(0, 8));
  }

  function dismissCopilot(item: CopilotItem) {
    setDismissed((prev) => new Set(prev).add(item.id));
    setRecentActions((prev) => [{ id: item.id, title: item.title, category: item.category, outcome: "ignored" as const }, ...prev].slice(0, 8));
  }

  async function saveTeachingCase() {
    if (!props.worklistId) return;
    setTeachingBusy(true);
    try {
      await api.post("/api/teaching-cases/generate-from-report", {
        studyId: props.worklistId,
        findings: props.findingsText,
        impression: props.impressionText,
        notes: teachingNotes,
      });
      setTeachingNotes("");
      toast({ title: "Saved as teaching case" });
    } catch (err) {
      toast({ title: "Teaching save failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setTeachingBusy(false);
    }
  }

  function applyMasterTemplate(tpl: MasterTemplate) {
    if (props.disabled) return;
    const hasTyped = props.findingsText.trim().length > 0 || props.impressionText.trim().length > 0;
    if (hasTyped && !window.confirm(`Replace the current Findings and Impression with "${tpl.templateName}"?`)) return;
    props.onSetFindings(tpl.findings || "");
    props.onSetImpression(tpl.impression || "");
    if (tpl.recommendations?.trim()) props.onAppendRecommendation(tpl.recommendations);
    toast({ title: "Master template applied", description: tpl.templateName });
  }

  async function applyUsgTemplate(templateId: string) {
    if (props.disabled || !props.studyInstanceUID) return;
    setUsgApplyBusy(templateId);
    try {
      const res = await api.post<{
        findings?: string;
        impression?: string;
        technique?: string;
        recommendation?: string;
      }>("/api/usg-reports/auto-generate", { templateId, studyInstanceUID: props.studyInstanceUID });
      if (res.findings) props.onSetFindings(res.findings);
      if (res.impression) props.onSetImpression(res.impression);
      if (res.technique) props.onSetTechnique(res.technique);
      if (res.recommendation) props.onAppendRecommendation(res.recommendation);
      toast({ title: "USG template applied" });
    } catch (err) {
      toast({
        title: "USG template failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setUsgApplyBusy(null);
    }
  }

  async function reviewAndMapToFormF() {
    if (!props.studyInstanceUID) return;
    setFormFBusy(true);
    try {
      const rows = await api.get<Array<Record<string, unknown>>>(
        `/api/usg-extraction/study/${encodeURIComponent(props.studyInstanceUID)}`,
      );
      const m = rows?.[0];
      if (!m || m.status !== "approved") {
        toast({
          title: "No approved measurements yet",
          description: "Approve extracted measurements in Measure before mapping to Form F.",
          variant: "destructive",
        });
        return;
      }
      const parts: string[] = [];
      const add = (label: string, v: unknown) => { if (v) parts.push(`${label}: ${v}`); };
      add("GA", m.ga); add("CRL", m.crl); add("EDD", m.edd); add("FHR", m.fhr);
      add("BPD", m.bpd); add("HC", m.hc); add("AC", m.ac); add("FL", m.fl); add("EFW", m.efw);
      add("Placenta", m.placentaPosition); add("Liquor/AFI", m.liquorAfi);
      add("Presentation", m.fetalPresentation);
      if (parts.length === 0) {
        toast({ title: "No obstetric measurements to map", variant: "destructive" });
        return;
      }
      let fetalUsgStudyId: number | null = null;
      if (props.studyId != null) {
        try {
          const strip = await api.get<{ found: boolean; fetalStudyId?: number }>(
            `/api/fetal-usg-dashboard/strip/${props.studyId}`,
          );
          if (strip.found && strip.fetalStudyId) fetalUsgStudyId = strip.fetalStudyId;
        } catch { /* best-effort */ }
      }
      const params = new URLSearchParams({ prefillUsgSummary: parts.join(", ") });
      if (fetalUsgStudyId != null) params.set("prefillFetalUsgStudyId", String(fetalUsgStudyId));
      window.open(`/form-f?${params.toString()}`, "_blank", "noopener");
    } catch {
      toast({ title: "Failed to load measurements for Form F", variant: "destructive" });
    } finally {
      setFormFBusy(false);
    }
  }

  const modalityFilteredMaster = masterTemplates.filter((m) => {
    if (!props.modality) return true;
    const want = props.modality.trim().toUpperCase();
    const have = (m.modality || "").trim().toUpperCase();
    return !have || have === want || have.startsWith(want) || want.startsWith(have);
  }).slice(0, 16);

  return (
    <div className="border-t border-amber-200/80 bg-amber-50/30" data-testid="legacy-box">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-50/80"
        onClick={() => setCollapsed((v) => !v)}
        data-testid="legacy-box-toggle"
      >
        <Archive className="h-3.5 w-3.5 text-amber-700 shrink-0" />
        <span className="text-xs font-semibold text-amber-900 flex-1">Legacy Box</span>
        <Badge variant="outline" className="text-[9px] bg-amber-100 text-amber-800 border-amber-300">
          keep for now
        </Badge>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-amber-700" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-700" />}
      </button>

      {!collapsed && (
        <div className="px-2 pb-3 space-y-2">
          <p className="text-[10px] text-amber-800/80 px-1">
            Old workspace tools kept alongside the new UI. Use them freely — we will prune after real use.
          </p>

          <div className="flex flex-wrap gap-1" data-testid="legacy-box-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${
                  tab === t.id
                    ? "bg-amber-700 text-white border-amber-700"
                    : "bg-white/80 border-amber-200 text-amber-900 hover:bg-amber-100"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="rounded-md border border-amber-200 bg-card/90 p-2 max-h-[420px] overflow-y-auto" data-testid={`legacy-box-panel-${tab}`}>
            {tab === "links" && (
              <div className="space-y-2 text-[11px]">
                <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Quick links</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {TABS.filter((t) => t.id !== "links").map((t) => (
                    <Button key={t.id} type="button" size="sm" variant="outline" className="h-7 justify-start text-[10px] gap-1"
                      onClick={() => setTab(t.id)}>
                      {t.icon}{t.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground pt-1">
                  Inline above the editor when applicable: USG Companion, OB strip, MRI readiness.
                  Report / Print DICOM image pickers sit under the viewer (center column).
                </p>
              </div>
            )}

            {tab === "copilot" && (
              <CareCopilotPanel
                report={careReport}
                dismissed={dismissed}
                onInsert={insertCopilot}
                onDismiss={dismissCopilot}
                onGoToConflict={() => { /* advisory */ }}
                recentActions={recentActions}
                onUndoLast={() => setRecentActions((prev) => prev.slice(1))}
                provider="local"
                prefs={copilotPrefs}
                onSetPref={(patch) => setCopilotPrefs(patch)}
              />
            )}

            {tab === "library" && (
              <FindingsLibraryPanel
                modalityHint={props.modality ?? undefined}
                studyHint={props.studyDescription ?? undefined}
                disabled={props.disabled}
                onApplyReport={props.onApplyReport}
              />
            )}

            {tab === "templates" && (
              <div className="space-y-3">
                {isUs && usgTemplates.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">USG Templates</div>
                    <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto">
                      {usgTemplates.map((t) => (
                        <Button
                          key={t.id}
                          size="sm"
                          variant="outline"
                          className="h-auto py-1.5 text-left justify-start px-2 flex-col items-start gap-0"
                          disabled={props.disabled || !props.studyInstanceUID || usgApplyBusy === t.id}
                          onClick={() => void applyUsgTemplate(t.id)}
                        >
                          <span className="text-xs font-medium">{t.label}</span>
                          <span className="text-[10px] opacity-70">{t.category}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {modalityFilteredMaster.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Master Library</div>
                    <div className="flex flex-wrap gap-1.5">
                      {modalityFilteredMaster.map((m) => (
                        <Button
                          key={`master-${m.id}`}
                          size="sm"
                          variant="outline"
                          title={`${m.groupName.replace(/_/g, " ")}${m.bodyPart ? " · " + m.bodyPart : ""}`}
                          onClick={() => applyMasterTemplate(m)}
                          disabled={props.disabled}
                          className="h-7 text-[10px]"
                        >
                          {m.templateName}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-[10px] font-semibold uppercase text-muted-foreground pt-1">Prefs / Macros</div>
                <PreferencesPanel
                  currentUserId={props.currentUserId}
                  onApplyTemplate={(name) => {
                    // Prefer master match by name; else open as findings note.
                    const match = masterTemplates.find((m) => m.templateName === name);
                    if (match) applyMasterTemplate(match);
                    else props.onAppendFindings(`[Template: ${name}]`);
                  }}
                  onInsertFindingText={props.onAppendFindings}
                  onInsertImpressionPoint={props.onAppendImpression}
                />
              </div>
            )}

            {tab === "measurements" && (
              <div className="space-y-3">
                <ViewerMeasurementsPanel
                  studyInstanceUID={props.studyInstanceUID}
                  onInsertToFindings={props.onAppendFindings}
                  onInsertToImpression={props.onAppendImpression}
                />
                {isUs && props.studyInstanceUID && (
                  <UsgMeasurementReviewPanel
                    studyInstanceUID={props.studyInstanceUID}
                    draftId={props.draftId ?? undefined}
                    onInsertMeasurement={(label, value, unit) => {
                      props.onAppendFindings(`${label}: ${value}${unit ? ` ${unit}` : ""}`);
                    }}
                  />
                )}
                {isUs && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] w-full"
                    disabled={!props.studyInstanceUID || formFBusy || props.disabled}
                    onClick={() => void reviewAndMapToFormF()}
                    data-testid="legacy-form-f-map"
                  >
                    <ClipboardPlus className="h-3.5 w-3.5 mr-1" />
                    {formFBusy ? "Opening Form F…" : "Review & Map to Form F"}
                  </Button>
                )}
                <MeasurementAssistantPanel
                  patientId={props.patientId ?? undefined}
                  studyId={props.studyId ?? undefined}
                  orderId={props.orderId ?? undefined}
                  modality={props.modality ?? undefined}
                  bodyPart={props.bodyPart ?? undefined}
                  onMeasurementsChange={(compiled) => {
                    if (compiled?.trim()) props.onAppendFindings(compiled);
                  }}
                />
              </div>
            )}

            {tab === "memory" && (
              <RadiologyMemoryPanel
                patientId={props.patientId ?? undefined}
                orderId={props.orderId ?? undefined}
                modality={props.modality ?? undefined}
                bodyPart={props.bodyPart ?? undefined}
                findingsText={props.findingsText}
                impressionText={props.impressionText}
                onSuggestionInsert={props.onAppendFindings}
              />
            )}

            {tab === "knowledge" && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {["master", "personal", "packs", "knowledge", "profile"].map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setKnowledgeSub(sub)}
                      className={`rounded border px-1.5 py-0.5 text-[10px] capitalize ${
                        knowledgeSub === sub ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
                <RadiologyKnowledgePanel
                  activePanel={knowledgeSub}
                  onInsert={(text) => props.onAppendFindings(text)}
                  selectedText={props.findingsText.slice(0, 200)}
                />
              </div>
            )}

            {tab === "diff" && (
              <div className="space-y-2 text-[11px]">
                <p className="font-semibold">AI draft vs final (legacy Report Diff)</p>
                {!props.worklistId && <p className="text-muted-foreground">Open a study to compare.</p>}
                {reportDiff?.error && <p className="text-rose-700">{reportDiff.error}</p>}
                {reportDiff?.summary && <p className="text-muted-foreground">{reportDiff.summary}</p>}
                {reportDiff?.diffHtml ? (
                  <div className="prose prose-sm max-w-none border rounded p-2 bg-white" dangerouslySetInnerHTML={{ __html: reportDiff.diffHtml }} />
                ) : props.worklistId && !reportDiff?.error ? (
                  <p className="text-muted-foreground">No diff payload returned for this study.</p>
                ) : null}
              </div>
            )}

            {tab === "print" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Layout</span>
                  <ReportLayoutQuickSelect
                    value={printLayout}
                    onChange={setPrintLayout}
                    activeKey={props.clinicActiveLayout ?? printLayout}
                  />
                </div>
                {!props.draftId && (
                  <p className="text-[11px] text-muted-foreground">Save a draft first to load clinic print preview.</p>
                )}
                {printLoading && <p className="text-[11px] text-muted-foreground">Loading preview…</p>}
                {printHtml && (
                  <iframe title="Legacy print preview" srcDoc={printHtml} className="w-full h-72 border rounded bg-white" />
                )}
                {printHtml && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const w = window.open("", "_blank");
                      if (!w) return;
                      w.document.write(printHtml);
                      w.document.close();
                      w.focus();
                      w.print();
                    }}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1" /> Print
                  </Button>
                )}
              </div>
            )}

            {tab === "ai" && (
              <AiDraftPanel
                studyInstanceUid={props.studyInstanceUID ?? null}
                modality={props.modality ?? null}
                onInsertText={props.onAppendFindings}
              />
            )}

            {tab === "teaching" && (
              <div className="space-y-2 text-[11px]">
                <p className="font-semibold">Teaching case notes (legacy)</p>
                <textarea
                  className="w-full min-h-[80px] rounded border p-2 text-[11px]"
                  placeholder="Why is this a teaching case?"
                  value={teachingNotes}
                  onChange={(e) => setTeachingNotes(e.target.value)}
                  disabled={props.disabled}
                />
                <Button type="button" size="sm" className="h-7 text-[11px]" disabled={!props.worklistId || teachingBusy || props.disabled}
                  onClick={() => void saveTeachingCase()}>
                  <GraduationCap className="h-3.5 w-3.5 mr-1" />
                  {teachingBusy ? "Saving…" : "Save teaching case"}
                </Button>
              </div>
            )}

            {tab === "open-study" && (
              <OpenStudyPanel
                study={{
                  studyInstanceUID: props.studyInstanceUID ?? null,
                  accessionNumber: props.accessionNumber ?? null,
                  patientId: props.patientId ?? null,
                  worklistId: props.worklistId ?? null,
                }}
                isAdmin={!!props.isAdmin}
                onLaunchStateChange={(state) => {
                  if (state?.lastResult) {
                    props.onViewerLaunchResult?.({
                      success: !!state.lastResult.success,
                      errorCode: state.lastResult.errorCode ?? null,
                    });
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
