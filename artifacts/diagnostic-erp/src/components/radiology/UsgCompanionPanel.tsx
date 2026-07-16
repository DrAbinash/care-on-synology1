/**
 * UsgCompanionPanel.tsx — CARE USG Companion (Phase 1)
 *
 * A workflow-automation surface that sits INSIDE the existing Reporting
 * Workspace (not a new page). It turns the machine information the Voluson
 * pipeline already extracted into a structured pre-report snapshot: Study
 * Summary, Report Readiness Score (pure workflow completeness), Companion
 * Timeline, machine-measurement summary, previous-study check, and one-click
 * actions that reuse the workspace's existing engines.
 *
 * HARD RULES honoured: builds no new engine. Study recognition, template,
 * protocol, measurements, comparison and Copilot all come from existing
 * infrastructure — this component only composes and presents them, and threads
 * its measurement outcome into the existing Copilot context.
 *
 * Reliability: independent fetch, fully defensive. An assembly failure renders a
 * quiet degraded state and NEVER blocks reporting.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles, Activity, Gauge, Clock, Image as ImageIcon, Stethoscope,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, History,
  ClipboardList, FileText, Wand2, ArrowRight, Cpu,
} from "lucide-react";
import { api } from "@/lib/fetchApi";
import { retryWithBackoff, isTransientError } from "@/lib/reliability";
import {
  computeReadinessScore, buildCompanionTimeline,
  type TimelineStage,
} from "@/lib/usgCompanionReadiness";
import type { CompanionAssembly, CompanionCopilotContext } from "@/lib/usgCompanionTypes";

export interface UsgCompanionPanelProps {
  studyInstanceUID: string;
  studyId?: number;
  patientId?: number;
  disabled?: boolean;
  // Live workspace signals for readiness + timeline (the workspace owns these).
  templateSelected: boolean;
  protocolSelected: boolean;
  historyPresent: boolean;
  quickFindingsSelected: boolean;
  copilotClear: boolean;
  userEdited: boolean;
  reportSaved: boolean;
  reportFinalized: boolean;
  // Actions the workspace wires to its existing functions (all optional).
  onOpenTab?: (tab: string) => void;
  onApplyProtocol?: () => void;
  onSuggestHistory?: () => void;
  // Thread the measurement outcome up into the existing Copilot context.
  onCopilotContext?: (ctx: CompanionCopilotContext | null) => void;
}

function pct(n: number): string { return `${Math.round(n)}%`; }

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

export default function UsgCompanionPanel(props: UsgCompanionPanelProps) {
  const { studyInstanceUID } = props;
  const [collapsed, setCollapsed] = useState(false);
  const postedRef = useRef<string>("");

  const { data, isLoading, isError } = useQuery<CompanionAssembly>({
    queryKey: ["usg-companion", studyInstanceUID],
    queryFn: () => api.get<CompanionAssembly>(`/api/care-usg-companion/study/${encodeURIComponent(studyInstanceUID)}`),
    enabled: !!studyInstanceUID,
    staleTime: 30_000,
    retry: 1,
  });

  const measurements = data?.measurements;

  // Readiness — composes server measurement facts with live workspace signals.
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

  // Thread the measurement outcome up into the existing Copilot context.
  useEffect(() => {
    if (!props.onCopilotContext) return;
    if (!data || !measurements) { props.onCopilotContext(null); return; }
    const isRejected = measurements.status === "rejected";
    const present = measurements.items.filter((i) => i.present);
    const ctx: CompanionCopilotContext = {
      studyType: data.detectedStudyType.id,
      imported: isRejected ? [] : present.map((i) => ({ label: i.label, value: i.value })),
      rejected: isRejected ? present.map((i) => ({ label: i.label, value: i.value })) : [],
      modified: present.filter((i) => (i.source || "").toUpperCase() === "MANUAL").map((i) => ({ label: i.label, value: i.value })),
      missing: measurements.missing.map((m) => m.label),
    };
    props.onCopilotContext(ctx);
    return () => props.onCopilotContext?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, measurements]);

  // Fire-and-forget telemetry once per assembled study (best-effort).
  useEffect(() => {
    if (!data || !measurements) return;
    const sig = `${studyInstanceUID}:${measurements.foundCount}:${data.extraction.status}:${readiness.score}`;
    if (postedRef.current === sig) return;
    postedRef.current = sig;
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
      status: "assembled",
      measurementsExpected: measurements.expectedCount,
      measurementsFound: measurements.foundCount,
      measurementsImported: measurements.foundCount,
      missingMeasurements: measurements.missing.map((m) => m.label),
      readinessScore: readiness.score,
      warnings: data.warnings,
    }), { shouldRetry: isTransientError })
      .catch(() => { /* telemetry must never disturb reporting */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, measurements, readiness.score]);

  if (!studyInstanceUID) return null;

  // Quiet degraded state — the workspace keeps working regardless.
  if (isError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
        <AlertTriangle size={14} /> CARE USG Companion is unavailable for this study. Reporting continues normally.
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
            <span className="text-sm font-bold text-gray-800">CARE USG Companion</span>
            {detected && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                {detected.label}
              </span>
            )}
            {machine?.isVoluson && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 inline-flex items-center gap-1">
                <Cpu size={10} /> Voluson
              </span>
            )}
            {data?.degraded && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">partial</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            {isLoading ? "Assembling study…" : `${study?.studyDescription || "Ultrasound study"}${machine?.model ? ` · ${machine.model}` : ""}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <div className={`text-[11px] font-semibold ${tone.text}`}>{tone.label}</div>
            <div className="text-[9px] text-gray-400">readiness</div>
          </div>
          <ReadinessRing score={readiness.score} />
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

          {/* Readiness breakdown */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Gauge size={13} className="text-indigo-500" />
              <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Report Readiness</span>
              <span className="text-[10px] text-gray-400">workflow completeness · not AI</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {readiness.axes.map((a) => (
                <div key={a.key} className="flex items-center gap-1.5" title={a.detail}>
                  {a.done ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    : <div className="h-3 w-3 rounded-full border-2 border-gray-300 shrink-0" />}
                  <span className={`text-[11px] ${a.done ? "text-gray-700" : "text-gray-400"}`}>{a.label}</span>
                  {a.key === "measurements" && a.detail && (
                    <span className="text-[9px] text-gray-400 ml-auto">{a.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={13} className="text-indigo-500" />
              <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Companion Timeline</span>
            </div>
            <TimelineRow stages={timeline} />
          </div>

          {/* Measurements detected / missing */}
          {measurements && (measurements.expectedCount > 0 || foundChips.length > 0 || extras.length > 0) && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity size={13} className="text-indigo-500" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Machine Measurements</span>
                {props.onOpenTab && (
                  <button onClick={() => props.onOpenTab?.("measurements")}
                    className="ml-auto text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">
                    Review &amp; import <ArrowRight size={11} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {foundChips.map((i) => (
                  <span key={i.key} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {i.label}: {i.value}
                  </span>
                ))}
                {extras.map((i) => (
                  <span key={i.key} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">
                    {i.label}: {i.value}
                  </span>
                ))}
                {missing.map((m) => (
                  <span key={m.key} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                    {m.label} missing
                  </span>
                ))}
                {foundChips.length === 0 && extras.length === 0 && missing.length === 0 && (
                  <span className="text-[10px] text-gray-400">No auto-measurements for this study type — enter manually.</span>
                )}
              </div>
            </div>
          )}

          {/* Previous studies */}
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
                      {arr.length} prior {label}
                      {arr[0]?.dateIso ? ` · ${new Date(arr[0].dateIso).toLocaleDateString()}` : ""}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* One-click actions (reuse existing workspace engines) */}
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
