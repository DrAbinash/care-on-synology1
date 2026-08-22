import { useState } from "react";
import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { patientAccent, modalityAccent } from "@/lib/zai-workspace/types";
import { Clock, Lock, AlertTriangle, ChevronRight, Archive, Flame } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PR: Record<string, { l: string; t: string }> = {
  stat: { l: "STAT", t: "bg-rose-100 text-rose-700 border-rose-200" },
  urgent: { l: "URGENT", t: "bg-amber-100 text-amber-700 border-amber-200" },
  routine: { l: "ROUTINE", t: "bg-slate-100 text-slate-600 border-slate-200" },
  vip: { l: "VIP", t: "bg-violet-100 text-violet-700 border-violet-200" },
};
const FALLBACK_PRIO = PR.routine;

export type ReadingQueueDatePreset = "today-yesterday" | "today" | "all";

export function WorklistStrip({
  onSelectStudy,
  onNextStudy,
  modalityFilter = "MR",
  onModalityFilterChange,
  datePreset = "today-yesterday",
  onDatePresetChange,
  onWarmMriTodayYesterday,
  mriWarmBusy,
  mriWarmLabel,
}: {
  onSelectStudy?: (id: string) => void;
  /** Same Next as the top-bar Prev/Next — CARE worklist order, not the Z.ai store skip. */
  onNextStudy?: () => void;
  modalityFilter?: string;
  onModalityFilterChange?: (value: string) => void;
  datePreset?: ReadingQueueDatePreset;
  onDatePresetChange?: (value: ReadingQueueDatePreset) => void;
  /** Touch Orthanc + browser DICOMweb for Today & Yesterday MR only. */
  onWarmMriTodayYesterday?: () => void;
  mriWarmBusy?: boolean;
  mriWarmLabel?: string | null;
} = {}) {
  const studies = useWorkspaceSelector(s => s.studies);
  const activeId = useWorkspaceSelector(s => s.activeStudyId);
  const completed = useWorkspaceSelector(s => s.completedStudyIds);
  const parked = useWorkspaceSelector(s => s.parkedStudyIds);
  const select = useWorkspaceSelector(s => s.selectStudy);
  const MAX_VISIBLE = 50;
  const [visibleCount, setVisibleCount] = useState(MAX_VISIBLE);
  const visibleStudies = studies.slice(0, visibleCount);
  const hasMore = studies.length > visibleCount;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-emerald-200/50 px-3 py-2 space-y-1.5 bg-gradient-to-b from-emerald-50/60 to-transparent">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Reading Queue</div>
            <div className="text-[10px] text-emerald-600/70">
              {studies.length - completed.size} pending · {completed.size} signed · {parked.size} parked
            </div>
          </div>
          <button
            type="button"
            data-testid="reading-queue-next"
            onClick={() => {
              if (onNextStudy) onNextStudy();
              else useWorkspace.getState().advanceToNextStudy();
            }}
            className="inline-flex items-center gap-1 rounded-md bg-gradient-to-b from-emerald-500 to-emerald-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/30"
          >
            <ChevronRight className="h-3 w-3" /> Next
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select
            aria-label="Queue modality"
            data-testid="reading-queue-modality"
            className="h-6 flex-1 min-w-0 rounded border border-emerald-200/60 bg-background px-1 text-[10px] focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300 outline-none"
            value={modalityFilter}
            onChange={(e) => onModalityFilterChange?.(e.target.value)}
          >
            <option value="MR">MRI</option>
            <option value="CT">CT</option>
            <option value="XR">X-Ray</option>
            <option value="US">USG</option>
            <option value="all">All</option>
          </select>
          <select
            aria-label="Queue date"
            data-testid="reading-queue-date"
            className="h-6 flex-1 min-w-0 rounded border border-emerald-200/60 bg-background px-1 text-[10px] focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300 outline-none"
            value={datePreset}
            onChange={(e) => onDatePresetChange?.(e.target.value as ReadingQueueDatePreset)}
          >
            <option value="today-yesterday">Today &amp; Yesterday</option>
            <option value="today">Today</option>
            <option value="all">All dates</option>
          </select>
        </div>
        {onWarmMriTodayYesterday ? (
          <button
            type="button"
            data-testid="warm-mri-today-yesterday"
            title="Pre-load Today & Yesterday MRI in Orthanc and DICOMweb for faster opens"
            disabled={mriWarmBusy}
            onClick={() => onWarmMriTodayYesterday()}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          >
            <Flame className={`h-3 w-3 ${mriWarmBusy ? "animate-pulse" : ""}`} />
            {mriWarmBusy ? "Warming MRI…" : "Warm MRI · Today & Yesterday"}
            {mriWarmLabel ? <span className="text-[9px] font-normal opacity-80">({mriWarmLabel})</span> : null}
          </button>
        ) : null}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-1.5">
          {studies.length === 0 && (
            <div className="rounded border border-dashed border-emerald-300/60 bg-emerald-50/30 p-3 text-[11px] text-emerald-700/80 text-center mt-4">
              No studies in queue.<br />
              <span className="text-[10px] text-emerald-600/60">Waiting for worklist…</span>
            </div>
          )}
          {visibleStudies.map(s => {
            const patient = s.patient ?? { id: "0", name: "Unknown", age: 0, sex: "O" as const, uhid: "", referringDoctor: "" };
            const a = patientAccent(patient.id || "0");
            const isActive = s.id === activeId;
            const isDone = completed.has(s.id);
            const isParked = parked.has(s.id);
            const mod = modalityAccent(s.modality);
            const prio = PR[s.priority] ?? FALLBACK_PRIO;
            const sla = s.tatMinutes > s.slaMinutes * 0.8;
            return (
              <button
                key={s.id}
                onClick={() => {
                  select(s.id);
                  onSelectStudy?.(s.id);
                }}
                className={cn(
                  "group relative flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition",
                  isActive ? "border-emerald-400 bg-gradient-to-r from-emerald-50 to-emerald-100/50 shadow-md shadow-emerald-500/10" : "border-transparent hover:border-emerald-200 hover:bg-emerald-50/30",
                )}
                style={isActive ? { boxShadow: `inset 3px 0 0 0 ${a.ring}` } : undefined}
              >
                <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: a.ring, opacity: isActive ? 1 : 0.55 }} />
                <div className="flex items-start justify-between gap-2 pl-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: mod.color ?? "oklch(0.55 0.1 250)" }}>
                        {mod.label}
                      </span>
                      <span className="truncate text-xs font-semibold">{patient.name}</span>
                      {isDone && <Badge variant="outline" className="bg-emerald-50 text-[9px] text-emerald-700 border-emerald-200">SIGNED</Badge>}
                      {isParked && <Badge variant="outline" className="bg-amber-50 text-[9px] text-amber-700 border-amber-200">PARKED</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {patient.age ? `${patient.age}${patient.sex}` : patient.sex} · {s.studyDescription} · {s.bodyPart}
                    </div>
                    {patient.referringDoctor?.trim() ? (
                      <div
                        className="mt-0.5 truncate text-[10px] text-emerald-800/80"
                        data-testid="queue-referring-doctor"
                        title={`Ref: ${patient.referringDoctor.trim()}`}
                      >
                        <span className="font-semibold text-emerald-700/90">Ref:</span>{" "}
                        {patient.referringDoctor.trim()}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn("rounded border px-1 py-0.5 text-[8.5px] font-bold tracking-wider", prio.t)}>{prio.l}</span>
                    {s.criticalFlag && <AlertTriangle className="h-3 w-3 text-rose-500" />}
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-2 text-[10px] text-muted-foreground">
                  <span className={cn("inline-flex items-center gap-1", sla && "text-rose-600 font-semibold")}>
                    <Clock className="h-2.5 w-2.5" />{s.tatMinutes}min / {s.slaMinutes}min
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Archive className="h-2.5 w-2.5" />{s.priorCount} prior{s.priorCount === 1 ? "" : "s"}
                  </span>
                  {s.lockedBy && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Lock className="h-2.5 w-2.5" /> You
                    </span>
                  )}
                  {s.aiDraftReady && (
                    <span className="rounded bg-emerald-50 px-1 text-[9px] text-emerald-700 border border-emerald-200">AI</span>
                  )}
                </div>
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleCount(c => c + MAX_VISIBLE)}
              className="w-full rounded-lg border border-dashed border-emerald-300/60 bg-emerald-50/30 py-2 text-[11px] font-medium text-emerald-700/80 hover:bg-emerald-50/60 transition"
            >
              Show {Math.min(MAX_VISIBLE, studies.length - visibleCount)} more of {studies.length - visibleCount} remaining…
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
