/**
 * UsgCompanionPanel.tsx — CARE USG Companion (Phase 1 + Phase 2)
 *
 * A workflow-automation surface INSIDE the existing Reporting Workspace (not a
 * new page). Phase 1: Study Summary, Readiness, Timeline, machine measurements,
 * previous-study check. Phase 2 (Intelligent Auto Report Population): a
 * deterministic Auto-Populate action + provenance ledger (what came from where),
 * a live checklist, report-confidence metrics, Companion suggestions sourced
 * from the existing quick-select engine, and a previous-comparison view built on
 * the existing comparison engine.
 *
 * HARD RULES honoured: builds no new engine. Study recognition, template,
 * protocol, measurements, comparison, suggestions and Copilot all come from
 * existing infrastructure — this composes and presents them. All population is
 * non-destructive (manual/finalized text is never overwritten) and applied
 * through the workspace's existing setters.
 *
 * Reliability: independent fetch, fully defensive. Any failure renders a quiet
 * degraded state and NEVER blocks reporting.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles, Activity, Gauge, Clock, Image as ImageIcon, Stethoscope,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, History,
  ClipboardList, FileText, Wand2, ArrowRight, Cpu, Lightbulb, ListChecks,
  TrendingUp, TrendingDown, Minus, ShieldCheck, Circle, SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/fetchApi";
import { retryWithBackoff, isTransientError } from "@/lib/reliability";
import {
  computeReadinessScore, buildCompanionTimeline, type TimelineStage,
} from "@/lib/usgCompanionReadiness";
import {
  buildAutoPopulatePlan, deriveProvenance, countEdits,
  type AutoPopulateMeasurement, type AutoPopulatePlan, type PopulateBlock, type BlockStatus,
} from "@/lib/usgCompanionAutoPopulate";
import {
  buildCompanionSuggestions, buildLiveChecklist, computeReportConfidence,
  type SuggestionFinding, type ChecklistItem,
} from "@/lib/usgCompanionSuggestions";
import { extractMeasurements, compareMeasurementRows } from "@/lib/radiologyComparison";
import type { CompanionAssembly, CompanionCopilotContext } from "@/lib/usgCompanionTypes";
import { matchRecommendations, recommendationQuestions } from "@/lib/clinicalRecommendations";

export interface UsgCompanionPanelProps {
  studyInstanceUID: string;
  studyId?: number;
  patientId?: number;
  disabled?: boolean;
  // Live workspace signals (readiness + timeline + confidence).
  templateSelected: boolean;
  protocolSelected: boolean;
  historyPresent: boolean;
  quickFindingsSelected: boolean;
  copilotClear: boolean;
  userEdited: boolean;
  reportSaved: boolean;
  reportFinalized: boolean;
  // Phase 2 — current report field values (plan / provenance / confidence / comparison).
  currentTechnique: string;
  currentFindings: string;
  currentImpression: string[];
  currentRecommendation: string;
  // Phase 2 — protocol text used for deterministic auto-population.
  protocolTechnique?: string | null;
  protocolNormals?: string | null;
  protocolRecommendation?: string | null;
  ruleImpressionLines?: string[];
  // Phase 2 — suggestion inputs.
  selectedFindingIds: number[];
  region: string | null;
  checklistRemaining?: string[];
  // Phase 2 — blocks the workspace has applied (for the provenance ledger).
  autoPopulatedBlocks?: PopulateBlock[];
  // Actions.
  onOpenTab?: (tab: string) => void;
  onApplyProtocol?: () => void;
  onSuggestHistory?: () => void;
  onAutoPopulate?: (plan: AutoPopulatePlan) => void;
  onCopilotContext?: (ctx: CompanionCopilotContext | null) => void;
}

function readinessTone(score: number): { ring: string; text: string; label: string } {
  if (score >= 85) return { ring: "#059669", text: "text-emerald-600", label: "Ready" };
  if (score >= 60) return { ring: "#d97706", text: "text-amber-600", label: "Almost ready" };
  return { ring: "#dc2626", text: "text-red-600", label: "In progress" };
}

function ReadinessRing({ score }: { score: number }) {
  const tone = readinessTone(score);
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circ;
  return (
    <div className="relative shrink-0" style={{ width: 64, height: 64 }} aria-label={`Report readiness ${score} percent`}>
      <svg width={64} height={64} className="-rotate-90">
        <circle cx={32} cy={32} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={32} cy={32} r={r} fill="none" stroke={tone.ring} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-bold ${tone.text}`}>{score}</span>
        <span className="text-[8px] text-gray-400 -mt-0.5">/100</span>
      </div>
    </div>
  );
}

function SummaryStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
      <span className="text-gray-400">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">{label}</div>
        <div className={`text-xs font-semibold truncate ${tone ?? "text-gray-700"}`}>{value}</div>
      </div>
    </div>
  );
}

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{label}</span><span className="font-semibold text-gray-700">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function TimelineRow({ stages }: { stages: TimelineStage[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-1" style={{ minWidth: 62 }}>
            <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold
              ${s.done ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-400"}`}>
              {s.done ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] text-center leading-tight ${s.done ? "text-gray-700" : "text-gray-400"}`}>{s.label}</span>
          </div>
          {i < stages.length - 1 && (
            <div className={`h-0.5 w-4 rounded ${stages[i + 1].done || s.done ? "bg-emerald-300" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

const PROV_BADGE: Record<string, { label: string; cls: string }> = {
  machine: { label: "Machine Derived", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  template: { label: "Template Normal", cls: "bg-sky-50 text-sky-700 border-sky-100" },
  rule: { label: "Rule-based", cls: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  protocol: { label: "Protocol", cls: "bg-purple-50 text-purple-700 border-purple-100" },
};
const STATUS_BADGE: Record<BlockStatus, { label: string; cls: string }> = {
  present: { label: "Auto", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  edited: { label: "Edited", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  removed: { label: "Removed", cls: "bg-gray-50 text-gray-400 border-gray-200" },
};

function checklistIcon(status: ChecklistItem["status"]) {
  if (status === "ok") return <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle size={12} className="text-amber-500 shrink-0" />;
  return <Circle size={12} className="text-gray-300 shrink-0" />;
}

export default function UsgCompanionPanel(props: UsgCompanionPanelProps) {
  const { studyInstanceUID } = props;
  const [collapsed, setCollapsed] = useState(false);
  // Progressive disclosure (§9 owner-review simplification). Basic (default)
  // shows only the clinical essentials; Advanced additionally reveals the
  // technical detail — the provenance ledger (what came from where), the
  // completeness/confidence metrics, and the companion pipeline timeline.
  // Persisted per-browser so a radiologist's choice sticks. Capability is never
  // removed — it is one click away.
  const [advanced, setAdvanced] = useState<boolean>(() => {
    try { return localStorage.getItem("usg-companion-advanced") === "1"; } catch { return false; }
  });
  const toggleAdvanced = () => setAdvanced((a) => {
    const next = !a;
    try { localStorage.setItem("usg-companion-advanced", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
  const postedRef = useRef<string>("");

  const { data, isLoading, isError } = useQuery<CompanionAssembly>({
    queryKey: ["usg-companion", studyInstanceUID],
    queryFn: () => api.get<CompanionAssembly>(`/api/care-usg-companion/study/${encodeURIComponent(studyInstanceUID)}`),
    enabled: !!studyInstanceUID,
    staleTime: 30_000,
    retry: 1,
  });

  // Shared quick-select cache (same key QuickFindingsPanel uses — no extra network).
  const { data: quickSelect } = useQuery<{ findings: SuggestionFinding[] }>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get<{ findings: SuggestionFinding[] }>("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  const measurements = data?.measurements;
  const current = useMemo(() => ({
    technique: props.currentTechnique,
    findings: props.currentFindings,
    impression: props.currentImpression,
    recommendation: props.currentRecommendation,
  }), [props.currentTechnique, props.currentFindings, props.currentImpression, props.currentRecommendation]);

  const readiness = useMemo(() => computeReadinessScore({
    measurementsExpected: measurements?.expectedCount ?? 0,
    measurementsFound: measurements?.foundCount ?? 0,
    templateSelected: props.templateSelected,
    protocolSelected: props.protocolSelected,
    historyPresent: props.historyPresent,
    quickFindingsSelected: props.quickFindingsSelected,
    copilotClear: props.copilotClear,
  }), [measurements?.expectedCount, measurements?.foundCount, props.templateSelected,
    props.protocolSelected, props.historyPresent, props.quickFindingsSelected, props.copilotClear]);

  const timeline = useMemo(() => buildCompanionTimeline({
    receivedAt: data?.study.receivedAt ?? null,
    measurementsImported: (measurements?.foundCount ?? 0) > 0 || data?.extraction.status === "completed",
    measurementsAt: data?.extraction.lastRunAt ?? null,
    templateLoaded: props.templateSelected,
    protocolLoaded: props.protocolSelected,
    userEdited: props.userEdited,
    reportSaved: props.reportSaved,
    reportFinalized: props.reportFinalized,
  }), [data?.study.receivedAt, data?.extraction.status, data?.extraction.lastRunAt,
    measurements?.foundCount, props.templateSelected, props.protocolSelected,
    props.userEdited, props.reportSaved, props.reportFinalized]);

  // Machine measurements → AutoPopulate shape (key doubles as the usg_measurements field).
  const autoMeasurements = useMemo<AutoPopulateMeasurement[]>(() =>
    (measurements?.items ?? []).map((i) => ({
      key: i.key, label: i.label, value: i.value, unit: i.unit,
      field: i.key.startsWith("extra:") ? undefined : i.key,
      confidence: i.confidence, source: i.source, present: i.present,
    })), [measurements?.items]);

  const plan = useMemo(() => buildAutoPopulatePlan({
    measurementItems: autoMeasurements,
    techniqueText: props.protocolTechnique,
    normalsText: props.protocolNormals,
    recommendationText: props.protocolRecommendation,
    ruleImpressionLines: props.ruleImpressionLines,
    current,
  }), [autoMeasurements, props.protocolTechnique, props.protocolNormals, props.protocolRecommendation, props.ruleImpressionLines, current]);

  const ledger = useMemo(() => deriveProvenance(props.autoPopulatedBlocks ?? [], current), [props.autoPopulatedBlocks, current]);
  const edits = useMemo(() => countEdits(props.autoPopulatedBlocks ?? [], current), [props.autoPopulatedBlocks, current]);

  // Companion suggestions from the existing quick-select engine, plus
  // follow-up QUESTIONS consumed from the shared Clinical Recommendation
  // Registry (the Companion asks; it never creates recommendations).
  const suggestions = useMemo(() => {
    const reportText = `${current.findings}\n${current.impression.join("\n")}`;
    const base = quickSelect?.findings
      ? buildCompanionSuggestions({
          findings: quickSelect.findings,
          region: props.region,
          selectedIds: props.selectedFindingIds,
          reportText,
        })
      : [];
    const matches = matchRecommendations({
      modality: data?.study?.modality ?? "",
      measurements: (measurements?.items ?? []).map((m) => ({
        label: m.label, value: Number.parseFloat(m.value), unit: m.unit ?? "",
      })).filter((m) => Number.isFinite(m.value)),
      reportText,
      priorChanges: [],
    });
    const questions = recommendationQuestions(matches)
      .filter((q) => !base.some((s) => s.id === q.id))
      .map((q) => ({
        id: q.id, kind: "followup" as const, label: q.question,
        detail: "From the Clinical Recommendation Registry", sourceLabel: "Registry",
      }));
    return [...base, ...questions];
  }, [quickSelect?.findings, props.region, props.selectedFindingIds, current.findings, current.impression, data?.study?.modality, measurements?.items]);

  // Live checklist.
  const checklist = useMemo(() => buildLiveChecklist({
    templateSelected: props.templateSelected,
    protocolSelected: props.protocolSelected,
    measurementsFound: measurements?.foundCount ?? 0,
    measurementsExpected: measurements?.expectedCount ?? 0,
    historyPresent: props.historyPresent,
    findingsPresent: current.findings.trim().length > 0,
    impressionPresent: current.impression.filter(Boolean).length > 0,
    recommendationPresent: current.recommendation.trim().length > 0,
    missingMeasurements: (measurements?.missing ?? []).map((m) => m.label),
    checklistRemaining: props.checklistRemaining ?? [],
    mismatches: [],
  }), [props.templateSelected, props.protocolSelected, measurements, props.historyPresent, current, props.checklistRemaining]);

  const confidence = useMemo(() => computeReportConfidence({
    measurementsFound: measurements?.foundCount ?? 0,
    measurementsExpected: measurements?.expectedCount ?? 0,
    findingsPresent: current.findings.trim().length > 0,
    impressionPresent: current.impression.filter(Boolean).length > 0,
    recommendationPresent: current.recommendation.trim().length > 0,
    techniquePresent: current.technique.trim().length > 0,
    readinessScore: readiness.score,
    locked: !!props.reportFinalized,
    hasBlockingWarnings: (data?.warnings.length ?? 0) > 0 && (measurements?.foundCount ?? 0) === 0,
  }), [measurements, current, readiness.score, props.reportFinalized, data?.warnings.length]);

  // Previous comparison via the existing comparison engine.
  const comparisonRows = useMemo(() => {
    const priorText = data?.previousStudies.priorUsgText;
    if (!priorText) return [];
    const currentText = `${(measurements?.items ?? []).filter((i) => i.present).map((i) => `${i.label}: ${i.value}`).join(". ")}. ${current.findings}`;
    const prior = extractMeasurements(priorText);
    const cur = extractMeasurements(currentText);
    return compareMeasurementRows(prior, cur).filter((r) => r.comparable);
  }, [data?.previousStudies.priorUsgText, measurements?.items, current.findings]);

  // Thread the measurement + auto-population outcome up into the existing Copilot.
  useEffect(() => {
    if (!props.onCopilotContext) return;
    if (!data || !measurements || !data.detectedStudyType?.id) { props.onCopilotContext(null); return; }
    const isRejected = measurements.status === "rejected";
    const present = measurements.items.filter((i) => i.present);
    props.onCopilotContext({
      studyType: data.detectedStudyType.id,
      imported: isRejected ? [] : present.map((i) => ({ label: i.label, value: i.value })),
      rejected: isRejected ? present.map((i) => ({ label: i.label, value: i.value })) : [],
      modified: present.filter((i) => (i.source || "").toUpperCase() === "MANUAL").map((i) => ({ label: i.label, value: i.value })),
      missing: measurements.missing.map((m) => m.label),
      autoPopulated: (props.autoPopulatedBlocks ?? []).map((b) => ({ section: b.section, text: b.text, kind: b.kind })),
    });
    return () => props.onCopilotContext?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, measurements, props.autoPopulatedBlocks]);

  // Fire-and-forget telemetry (Phase 1 + Phase 2 fields).
  useEffect(() => {
    if (!data || !measurements || !data.detectedStudyType?.id) return;
    const applied = props.autoPopulatedBlocks ?? [];
    const sig = `${studyInstanceUID}:${measurements.foundCount}:${data.extraction.status}:${readiness.score}:${applied.length}:${edits}`;
    if (postedRef.current === sig) return;
    postedRef.current = sig;
    const rejectedLabels = measurements.status === "rejected" ? measurements.items.filter((i) => i.present).map((i) => i.label) : [];
    void retryWithBackoff(() => api.post("/api/care-usg-companion/runs", {
      studyInstanceUID,
      worklistId: data.study.worklistId,
      accessionNumber: data.study.accessionNumber,
      patientId: data.study.patientId,
      detectedStudyType: data.detectedStudyType.id,
      templateId: props.templateSelected ? data.detectedStudyType.id : null,
      protocolApplied: props.protocolSelected ? "applied" : null,
      machineManufacturer: data.machine.manufacturer,
      machineModel: data.machine.model,
      machineName: data.machine.station,
      extractionStatus: data.extraction.status,
      status: applied.length > 0 ? "populated" : "assembled",
      measurementsExpected: measurements.expectedCount,
      measurementsFound: measurements.foundCount,
      measurementsImported: measurements.foundCount,
      missingMeasurements: measurements.missing.map((m) => m.label),
      rejectedMeasurements: rejectedLabels,
      readinessScore: readiness.score,
      autoPopulated: applied.length > 0,
      sectionsPopulated: new Set(applied.map((b) => b.section)).size,
      editsAfterPopulate: edits,
      reportCompletionPct: confidence.reportCompleteness,
      warnings: data.warnings,
    }), { shouldRetry: isTransientError })
      .catch(() => { /* telemetry must never disturb reporting */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, measurements, readiness.score, props.autoPopulatedBlocks, edits, confidence.reportCompleteness]);

  if (!studyInstanceUID) return null;

  if (isError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
        <AlertTriangle size={14} /> CARE Reporting Companion is unavailable for this study. Reporting continues normally.
      </div>
    );
  }

  const study = data?.study;
  const machine = data?.machine;
  const detected = data?.detectedStudyType;
  const tone = readinessTone(readiness.score);
  const foundChips = measurements?.items.filter((i) => i.present) ?? [];
  const extras = measurements?.extras ?? [];
  const missing = measurements?.missing ?? [];
  const prior = data?.previousStudies;
  const canPopulate = !props.disabled && plan.eligible && plan.blocks.length > 0;

  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 to-white shadow-sm overflow-hidden"
      data-testid="usg-companion-panel">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-indigo-100 bg-white/60">
        <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-800">CARE Reporting Companion</span>
            {detected && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{detected.label}</span>
            )}
            {machine?.isVoluson && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 inline-flex items-center gap-1">
                <Cpu size={10} /> Voluson
              </span>
            )}
            {data?.degraded && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">partial</span>}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            {isLoading ? "Assembling study…" : `${study?.studyDescription || "Study"}${machine?.model ? ` · ${machine.model}` : ""}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <div className={`text-[11px] font-semibold ${tone.text}`}>{tone.label}</div>
            <div className="text-[9px] text-gray-400">readiness</div>
          </div>
          <ReadinessRing score={readiness.score} />
          <button onClick={toggleAdvanced}
            className={`text-[10px] font-semibold px-2 py-1 rounded-md border inline-flex items-center gap-1 ${advanced ? "border-indigo-300 text-indigo-700 bg-indigo-50" : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50"}`}
            title={advanced ? "Hide technical detail — switch to Basic view" : "Show technical detail — switch to Advanced view"}
            aria-pressed={advanced}
            data-testid="companion-advanced-toggle">
            <SlidersHorizontal size={11} /> {advanced ? "Advanced" : "Basic"}
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="text-gray-400 hover:text-gray-600 p-1"
            aria-label={collapsed ? "Expand companion" : "Collapse companion"}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-3">
          {isLoading && <div className="text-xs text-gray-400 py-2">Loading machine information…</div>}

          {/* Study Summary */}
          {study && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SummaryStat icon={<Cpu size={14} />} label="Machine"
                value={machine?.manufacturer ? `${machine.manufacturer}${machine.model ? " " + machine.model : ""}` : "Unknown"} />
              <SummaryStat icon={<Clock size={14} />} label="Study Date"
                value={study.studyDate ? String(study.studyDate).slice(0, 10) : (study.receivedAt ? new Date(study.receivedAt).toLocaleDateString() : "—")} />
              <SummaryStat icon={<ImageIcon size={14} />} label="Images" value={String(study.imageCount)}
                tone={study.imageCount > 0 ? "text-gray-700" : "text-amber-600"} />
              <SummaryStat icon={<Activity size={14} />} label="Measurements"
                value={measurements ? `${measurements.foundCount}/${measurements.expectedCount || "—"} detected` : "—"}
                tone={measurements && measurements.missingCount > 0 ? "text-amber-600" : "text-emerald-600"} />
            </div>
          )}

          {/* ── Phase 2: Auto-Populate ── */}
          {data && (
            <div className="rounded-lg border border-indigo-100 bg-white/70 p-2.5">
              <div className="flex items-center gap-2">
                <Wand2 size={14} className="text-indigo-600" />
                <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Auto-Populate Report</span>
                {props.onAutoPopulate && (
                  <button
                    onClick={() => props.onAutoPopulate?.(plan)}
                    disabled={!canPopulate}
                    className={`ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-md inline-flex items-center gap-1
                      ${canPopulate ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                    data-testid="companion-auto-populate"
                    title={canPopulate ? "Populate empty sections deterministically" : "Nothing new to populate"}
                  >
                    <Wand2 size={12} /> {ledger.length > 0 ? "Re-populate" : "Auto-Populate"}
                  </button>
                )}
              </div>
              {ledger.length === 0 ? (
                <p className="text-[10.5px] text-gray-500 mt-1.5">
                  {plan.eligible
                    ? `Ready to populate ${plan.blocks.length} section(s) from machine measurements, template normals and protocol — non-destructive, never overwriting your text.`
                    : (plan.reasons[0] ?? "Waiting for machine information.")}
                </p>
              ) : !advanced ? (
                <p className="text-[10.5px] text-gray-500 mt-1.5">
                  {ledger.length} section(s) auto-populated · {edits} edited by you. Your typed text is never overwritten.
                  <span className="text-gray-400"> Switch to Advanced to see the source of each.</span>
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="text-[10px] text-gray-400">{ledger.length} auto-generated item(s) · {edits} edited by you</div>
                  {ledger.slice(0, 14).map((b) => {
                    const prov = PROV_BADGE[b.kind] ?? PROV_BADGE.template;
                    const st = STATUS_BADGE[b.status];
                    return (
                      <div key={b.id} className="flex items-center gap-1.5 text-[10.5px]">
                        <span className={`px-1 py-0.5 rounded border text-[8px] ${prov.cls}`}>{prov.label}</span>
                        <span className={`px-1 py-0.5 rounded border text-[8px] ${st.cls}`}>{st.label}</span>
                        <span className="truncate text-gray-600" title={b.text}>{b.text}</span>
                        {b.field && props.onOpenTab && (
                          <button onClick={() => props.onOpenTab?.("measurements")}
                            className="ml-auto text-[9px] text-indigo-500 hover:text-indigo-700 shrink-0" title="Trace to machine measurement">trace</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Phase 2: Report Confidence (Advanced — workflow completeness metrics) ── */}
          {advanced && data && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ShieldCheck size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Report Confidence</span>
                {confidence.readyForFinalization
                  ? <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Ready to finalize</span>
                  : <span className="ml-auto text-[10px] text-gray-400">workflow metrics · not AI</span>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <ConfidenceBar label="Machine" value={confidence.machineCompleteness} />
                <ConfidenceBar label="Clinical" value={confidence.clinicalCompleteness} />
                <ConfidenceBar label="Report" value={confidence.reportCompleteness} />
              </div>
            </div>
          )}

          {/* ── Phase 2: Live Checklist ── */}
          {data && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <ListChecks size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Intelligent Checklist</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                {checklist.map((c) => (
                  <div key={c.key} className="flex items-center gap-1.5" title={c.detail}>
                    {checklistIcon(c.status)}
                    <span className={`text-[11px] ${c.status === "ok" ? "text-gray-700" : c.status === "warn" ? "text-amber-700" : "text-gray-400"}`}>{c.label}</span>
                    {c.detail && c.status !== "warn" && <span className="text-[9px] text-gray-400 ml-auto">{c.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline (Advanced — companion pipeline stages) */}
          {advanced && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Companion Timeline</span>
              </div>
              <TimelineRow stages={timeline} />
            </div>
          )}

          {/* Machine measurements */}
          {measurements && (measurements.expectedCount > 0 || foundChips.length > 0 || extras.length > 0) && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Machine Measurements</span>
                {props.onOpenTab && (
                  <button onClick={() => props.onOpenTab?.("measurements")}
                    className="ml-auto text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">
                    Review &amp; trace <ArrowRight size={11} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {foundChips.map((i) => (
                  <span key={i.key} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">{i.label}: {i.value}</span>
                ))}
                {extras.map((i) => (
                  <span key={i.key} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">{i.label}: {i.value}</span>
                ))}
                {missing.map((m) => (
                  <span key={m.key} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">{m.label} missing</span>
                ))}
                {foundChips.length === 0 && extras.length === 0 && missing.length === 0 && (
                  <span className="text-[10px] text-gray-400">No auto-measurements for this study type — enter manually.</span>
                )}
              </div>
            </div>
          )}

          {/* ── Phase 2: Companion Suggestions ── */}
          {suggestions.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Lightbulb size={13} className="text-amber-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Companion Suggestions</span>
                {props.onOpenTab && (
                  <button onClick={() => props.onOpenTab?.("quickselect")}
                    className="ml-auto text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">
                    Open findings <ArrowRight size={11} />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {suggestions.slice(0, 8).map((s) => (
                  <div key={s.id} className="flex items-start gap-1.5 text-[10.5px]" title={s.detail}>
                    <Lightbulb size={11} className="text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-gray-600">
                      <span className="font-semibold text-gray-700">{s.label}</span>
                      {s.sourceLabel && <span className="text-gray-400"> · with {s.sourceLabel}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Phase 2: Previous Comparison ── */}
          {comparisonRows.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <History size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Compared with previous</span>
                {prior?.priorUsgDateIso && <span className="text-[9px] text-gray-400 ml-auto">{new Date(prior.priorUsgDateIso).toLocaleDateString()}</span>}
              </div>
              <div className="flex flex-col gap-0.5">
                {comparisonRows.slice(0, 8).map((r) => {
                  const up = (r.delta ?? 0) > 0, down = (r.delta ?? 0) < 0;
                  return (
                    <div key={r.label} className="flex items-center gap-2 text-[10.5px]">
                      <span className="text-gray-600 truncate flex-1" title={r.label}>{r.label}</span>
                      <span className="text-gray-400">{r.previous}{r.unit} → {r.current}{r.unit}</span>
                      <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? "text-red-600" : down ? "text-emerald-600" : "text-gray-500"}`}>
                        {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
                        {r.deltaText}{r.unit} ({r.percentText})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Previous studies availability */}
          {prior && prior.total > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <History size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Previous Studies</span>
                {props.onOpenTab && (
                  <button onClick={() => props.onOpenTab?.("prior")}
                    className="ml-auto text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">
                    Compare <ArrowRight size={11} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {([["USG", prior.usg], ["MRI", prior.mri], ["CT", prior.ct], ["Other", prior.other]] as const)
                  .filter(([, arr]) => arr.length > 0)
                  .map(([label, arr]) => (
                    <span key={label} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                      {arr.length} prior {label}{arr[0]?.dateIso ? ` · ${new Date(arr[0].dateIso).toLocaleDateString()}` : ""}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* One-click actions */}
          {!props.disabled && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-indigo-50">
              {props.onSuggestHistory && (
                <button onClick={props.onSuggestHistory}
                  className="text-[11px] font-medium px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 inline-flex items-center gap-1">
                  <Stethoscope size={12} /> Suggest history
                </button>
              )}
              {props.onApplyProtocol && !props.protocolSelected && (
                <button onClick={props.onApplyProtocol}
                  className="text-[11px] font-medium px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 inline-flex items-center gap-1">
                  <ClipboardList size={12} /> Apply protocol
                </button>
              )}
              {props.onOpenTab && (
                <button onClick={() => props.onOpenTab?.("templates")}
                  className="text-[11px] font-medium px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 inline-flex items-center gap-1">
                  <FileText size={12} /> Template
                </button>
              )}
              {props.onOpenTab && (
                <button onClick={() => props.onOpenTab?.("copilot")}
                  className="text-[11px] font-medium px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 inline-flex items-center gap-1">
                  <Wand2 size={12} /> Copilot
                </button>
              )}
            </div>
          )}

          {/* Warnings */}
          {data?.warnings && data.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5">
              <ul className="text-[10.5px] text-amber-800 space-y-0.5">
                {data.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { PopulateBlock, AutoPopulatePlan };
