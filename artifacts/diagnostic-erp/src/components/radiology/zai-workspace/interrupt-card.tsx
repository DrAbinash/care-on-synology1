import { useWorkspace, useWorkspaceSelector } from "@/lib/zai-workspace/store";
import { AlertTriangle, Phone, MessageSquare, X, Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function InterruptChannelCard() {
  const n = useWorkspaceSelector(s => s.notification);
  const clear = useWorkspaceSelector(s => s.clearNotification);
  const study = useWorkspaceSelector(s => s.studies.find(x => x.id === s.activeStudyId));
  const [open, setOpen] = useState(false);
  if (!n || n.kind !== "interrupt") return null;
  return (
    <>
      <div role="alert" className="fixed top-4 left-1/2 z-40 w-[480px] max-w-[95vw] -translate-x-1/2 animate-in slide-in-from-top-2">
        <div className="rounded-xl border-2 border-rose-400 bg-white shadow-2xl">
          <div className="flex items-start gap-2 border-b border-rose-200 bg-rose-50 px-3 py-2">
            <div className="relative flex-none">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-rose-700">Critical finding detected</div>
              <div className="truncate text-xs text-rose-700/80">{n.text}</div>
            </div>
            <button onClick={clear} className="flex h-6 w-6 items-center justify-center rounded-full text-rose-500 hover:bg-rose-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-3">
            <div className="mb-2 text-[10px] text-muted-foreground">
              {"One-keystroke: Ctrl+Shift+C"}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 flex-1 bg-rose-600 text-[11px] hover:bg-rose-700" onClick={() => setOpen(true)}>
                <Zap className="mr-1 h-3 w-3" /> Launch workflow
              </Button>
              <Button size="sm" variant="outline" className="h-7 border-rose-300 text-[11px] text-rose-700 hover:bg-rose-50" onClick={clear}>
                Snooze 30s
              </Button>
            </div>
          </div>
        </div>
      </div>
      {open && <Workflow onClose={() => { setOpen(false); clear(); }} study={study} />}
    </>
  );
}

function Workflow({ onClose, study }: { onClose: () => void; study: any }) {
  const [rec, setRec] = useState(study?.patient?.referringDoctor ?? "");
  const [method, setMethod] = useState<"phone" | "whatsapp" | "in-person" | "email">("phone");
  const [note, setNote] = useState("");
  const [logged, setLogged] = useState(false);
  const log = () => { setLogged(true); setTimeout(onClose, 800); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] max-w-[95vw] rounded-xl border-2 border-rose-400 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          <div className="flex-1">
            <div className="text-sm font-bold text-rose-700">Critical-Results Communication</div>
            <div className="text-[10px] text-rose-600/80">Log the call for medico-legal record</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-rose-500 hover:bg-rose-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Communicated to</label>
            <input value={rec} onChange={e => setRec(e.target.value)} className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 text-sm" placeholder="Dr. S. Mehta, MD Med" />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Method</label>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {(["phone", "whatsapp", "in-person", "email"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)} className={`rounded-md border px-2 py-1.5 text-xs ${method === m ? "border-rose-400 bg-rose-50 text-rose-700" : "border-border hover:bg-muted"}`}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} className="mt-1 min-h-[60px] w-full rounded-md border border-border px-2.5 py-1.5 text-sm" placeholder="Acknowledged, advised urgent referral" />
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> {new Date().toLocaleString()}</div>
            <div className="mt-0.5">Actor: Dr. Abinash Kumar</div>
          </div>
          <Button onClick={log} disabled={!rec.trim() || logged} className="w-full bg-rose-600 hover:bg-rose-700">
            {logged ? "✓ Logged" : "Log communication"}
          </Button>
        </div>
      </div>
    </div>
  );
}
