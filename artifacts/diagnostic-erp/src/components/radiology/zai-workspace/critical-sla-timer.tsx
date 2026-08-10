import { useWorkspace } from "@/lib/zai-workspace/store";
import { useEffect, useState } from "react";
import { Clock, AlertTriangle, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
export function CriticalSlaTimer() {
  const startedAt = useWorkspace(s => s.criticalSlaStartedAt); const slaMin = useWorkspace(s => s.criticalSlaMinutes); const esc = useWorkspace(s => s.criticalSlaEscalated); const escalate = useWorkspace(s => s.escalateCriticalSla);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!startedAt) return; const tick = () => { const s = Math.floor((Date.now() - startedAt) / 1000); setElapsed(s); if (s >= slaMin * 60 && !useWorkspace.getState().criticalSlaEscalated) escalate(); }; tick(); const i = setInterval(tick, 1000); return () => clearInterval(i); }, [startedAt, slaMin, escalate]);
  if (!startedAt) return null;
  const rem = Math.max(0, slaMin * 60 - elapsed); const m = Math.floor(rem / 60); const s = rem % 60; const breached = rem === 0; const warn = rem > 0 && rem <= 60;
  return <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border transition", esc || breached ? "bg-rose-100 text-rose-700 border-rose-300 animate-pulse" : warn ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-rose-50 text-rose-600 border-rose-200")} title="Critical finding SLA">{esc || breached ? <Bell className="h-3 w-3" /> : <Clock className="h-3 w-3" />}<span>{esc || breached ? `ESCALATED · ${Math.floor(elapsed / 60)}m` : `SLA · ${m}:${String(s).padStart(2, "0")}`}</span>{warn && !esc && <AlertTriangle className="h-3 w-3 animate-pulse" />}</div>;
}
