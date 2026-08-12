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
  Library, Brain, MonitorPlay, ChevronDown, ChevronRight,
} from "lucide-react";
import CareCopilotPanel, { type CopilotAction } from "@/components/radiology/CareCopilotPanel";
import FindingsLibraryPanel from "@/components/radiology/FindingsLibraryPanel";
import ViewerMeasurementsPanel from "@/components/radiology/ViewerMeasurementsPanel";
import UsgMeasurementReviewPanel from "@/components/radiology/UsgMeasurementReviewPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import PreferencesPanel from "@/components/PreferencesPanel";
import RadiologyKnowledgePanel from "@/components/RadiologyKnowledgePanel";
import OpenStudyPanel from "@/components/radiology/OpenStudyPanel";
import ReportLayoutQuickSelect, { type ReportLayoutKey } from "@/components/radiology/ReportLayoutQuickSelect";
import { AiDraftPanel } from "@/components/ai/AiDraftPanel";
import { analyzeCopilot, type CopilotItem, type CopilotReport } from "@/lib/copilotOrchestrator";
import { useCopilotPrefs } from "@/hooks/useCopilotPrefs";
import { isUltrasoundModality } from "@/lib/usgModality";

export type LegacyBoxTab =
  | "links"
  | "copilot"
  | "library"
  | "templates"
  | "measurements"
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
  { id: "templates", label: "Prefs / Macros", icon: <BookOpen className="h-3 w-3" /> },
  { id: "measurements", label: "Measure", icon: <Ruler className="h-3 w-3" /> },
  { id: "knowledge", label: "Knowledge", icon: <Brain className="h-3 w-3" /> },
  { id: "diff", label: "AI Diff", icon: <FileDiff className="h-3 w-3" /> },
  { id: "print", label: "Print Preview", icon: <Printer className="h-3 w-3" /> },
  { id: "ai", label: "AI Draft", icon: <Sparkles className="h-3 w-3" /> },
  { id: "teaching", label: "Teaching", icon: <GraduationCap className="h-3 w-3" /> },
  { id: "open-study", label: "Open Study", icon: <MonitorPlay className="h-3 w-3" /> },
];

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
}

export default function LegacyBox(props: LegacyBoxProps) {
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
  const [printLayout, setPrintLayout] = useState<ReportLayoutKey>("care-classic");
  const [teachingNotes, setTeachingNotes] = useState("");
  const [teachingBusy, setTeachingBusy] = useState(false);

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

  // Reset dismissals when study changes
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
    } finally {
      setTeachingBusy(false);
    }
  }

  const isUs = isUltrasoundModality(props.modality);

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
                  Also available inline above the editor when applicable: USG Companion, OB strip, MRI readiness, Open Study (tab).
                </p>
              </div>
            )}

            {tab === "copilot" && (
              <CareCopilotPanel
                report={careReport}
                dismissed={dismissed}
                onInsert={insertCopilot}
                onDismiss={dismissCopilot}
                onGoToConflict={(match) => {
                  if (match && props.findingsText.toLowerCase().includes(match.toLowerCase())) {
                    /* advisory only — editor focus left to user */
                  }
                }}
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
              <PreferencesPanel
                currentUserId={props.currentUserId}
                onApplyTemplate={(name) => props.onAppendFindings(`[Template: ${name}]`)}
                onInsertFindingText={props.onAppendFindings}
                onInsertImpressionPoint={props.onAppendImpression}
              />
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
                    activeKey={printLayout}
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
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
