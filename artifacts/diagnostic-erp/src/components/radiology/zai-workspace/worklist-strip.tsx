import { useWorkspace } from "@/lib/zai-workspace/store";
import { patientAccent, modalityAccent } from "@/lib/zai-workspace/types";
import { Clock, Lock, AlertTriangle, ChevronRight, Archive } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
const PR: Record<string, { l: string; t: string }> = { stat: { l: "STAT", t: "bg-rose-100 text-rose-700 border-rose-200" }, urgent: { l: "URGENT", t: "bg-amber-100 text-amber-700 border-amber-200" }, routine: { l: "ROUTINE", t: "bg-slate-100 text-slate-600 border-slate-200" }, vip: { l: "VIP", t: "bg-violet-100 text-violet-700 border-violet-200" } };
export function WorklistStrip() {
  const studies = useWorkspace(s => s.studies); const activeId = useWorkspace(s => s.activeStudyId);
  const completed = useWorkspace(s => s.completedStudyIds); const parked = useWorkspace(s => s.parkedStudyIds); const select = useWorkspace(s => s.selectStudy);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2"><div><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reading Queue</div><div className="text-[10px] text-muted-foreground/70">{studies.length - completed.size} pending · {completed.size} signed · {parked.size} parked</div></div><button onClick={() => useWorkspace.getState().advanceToNextStudy()} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-emerald-700"><ChevronRight className="h-3 w-3" /> Next</button></div>
      <ScrollArea className="flex-1"><div className="space-y-1 p-1.5">
        {studies.length === 0 && <div className="rounded border border-dashed border-border p-3 text-[11px] text-muted-foreground text-center mt-4">No studies in queue.<br /><span className="text-[10px]">Fetching from /api/radiology/pacs-worklist...</span></div>}
        {studies.map(s => { const a = patientAccent(s.patient.id); const isActive = s.id === activeId; const isDone = completed.has(s.id); const isParked = parked.has(s.id); const mod = modalityAccent(s.modality); const prio = PR[s.priority]; const sla = s.tatMinutes > s.slaMinutes * 0.8;
          return <button key={s.id} onClick={() => select(s.id)} className={cn("group relative flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition", isActive ? "border-emerald-400 bg-emerald-50/60 shadow-sm" : "border-transparent hover:border-border hover:bg-muted/40")} style={isActive ? { boxShadow: `inset 3px 0 0 0 ${a.ring}` } : undefined}>
            <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: a.ring, opacity: isActive ? 1 : 0.55 }} />
            <div className="flex items-start justify-between gap-2 pl-2"><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: mod.color }}>{mod.label}</span><span className="truncate text-xs font-semibold">{s.patient.name}</span>{isDone && <Badge variant="outline" className="bg-emerald-50 text-[9px] text-emerald-700 border-emerald-200">SIGNED</Badge>}{isParked && <Badge variant="outline" className="bg-amber-50 text-[9px] text-amber-700 border-amber-200">PARKED</Badge>}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{s.patient.age}{s.patient.sex} · {s.studyDescription} · {s.bodyPart}</div></div><div className="flex flex-col items-end gap-1"><span className={cn("rounded border px-1 py-0.5 text-[8.5px] font-bold tracking-wider", prio.t)}>{prio.l}</span>{s.criticalFlag && <AlertTriangle className="h-3 w-3 text-rose-500" />}</div></div>
            <div className="flex items-center gap-3 pl-2 text-[10px] text-muted-foreground"><span className={cn("inline-flex items-center gap-1", sla && "text-rose-600 font-semibold")}><Clock className="h-2.5 w-2.5" />{s.tatMinutes}min / {s.slaMinutes}min</span><span className="inline-flex items-center gap-1"><Archive className="h-2.5 w-2.5" />{s.priorCount} prior{s.priorCount === 1 ? "" : "s"}</span>{s.lockedBy && <span className="inline-flex items-center gap-1 text-amber-600"><Lock className="h-2.5 w-2.5" /> You</span>}{s.aiDraftReady && <span className="rounded bg-emerald-50 px-1 text-[9px] text-emerald-700 border border-emerald-200">AI</span>}</div>
          </button>; })}
      </div></ScrollArea>
    </div>
  );
}
