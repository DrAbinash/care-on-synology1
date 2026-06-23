import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Search, Plus, X } from "lucide-react";

type PacsLog = {
  id: number;
  logType: string | null;
  severity: string;
  source: string | null;
  eventType: string | null;
  message: string;
  studyInstanceUid: string | null;
  accessionNumber: string | null;
  patientId: string | null;
  modality: string | null;
  payload: string | null;
  errorStack: string | null;
  createdAt: string;
};

const SEV_BADGE: Record<string, string> = {
  info:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  error:   "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  debug:   "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function PacsLogsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [addMsg, setAddMsg] = useState("");
  const [addSev, setAddSev] = useState("info");
  const [addSrc, setAddSrc] = useState("");
  const [addEvt, setAddEvt] = useState("");
  const [addAcc, setAddAcc] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: logs = [], isFetching, refetch } = useQuery<PacsLog[]>({
    queryKey: ["pacs-logs", severity],
    queryFn: () => api.get(`/api/radiology/pacs-logs?severity=${severity}`),
    refetchInterval: 30_000,
  });

  const addLog = useMutation({
    mutationFn: (body: object) => api.post("/api/radiology/pacs-logs", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pacs-logs"] });
      toast({ title: "Log entry added" });
      setAddMsg(""); setAddSrc(""); setAddEvt(""); setAddAcc(""); setShowAdd(false);
    },
    onError: () => toast({ title: "Failed to add log", variant: "destructive" }),
  });

  const filtered = logs.filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return l.message.toLowerCase().includes(q)
      || (l.accessionNumber ?? "").toLowerCase().includes(q)
      || (l.source ?? "").toLowerCase().includes(q)
      || (l.eventType ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} />{showAdd ? "Cancel" : "Add Entry"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* Add manual log entry */}
      {showAdd && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Manual Log Entry</h3>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Message *" value={addMsg} onChange={(e) => setAddMsg(e.target.value)} className="flex-1 min-w-[200px] h-8 text-sm" />
            <select value={addSev} onChange={(e) => setAddSev(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
              {["info", "warning", "error", "debug"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <Input placeholder="Source (e.g. conquest)" value={addSrc} onChange={(e) => setAddSrc(e.target.value)} className="w-36 h-8 text-sm" />
            <Input placeholder="Event type" value={addEvt} onChange={(e) => setAddEvt(e.target.value)} className="w-36 h-8 text-sm" />
            <Input placeholder="Accession #" value={addAcc} onChange={(e) => setAddAcc(e.target.value)} className="w-36 h-8 text-sm" />
            <Button size="sm" className="h-8" onClick={() => {
              if (!addMsg.trim()) return;
              addLog.mutate({ message: addMsg.trim(), severity: addSev, source: addSrc || null, eventType: addEvt || null, accessionNumber: addAcc || null });
            }} disabled={addLog.isPending}>
              {addLog.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}Add
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search message, accession, source…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-8 text-sm border rounded-md px-2 bg-background">
          <option value="all">All severities</option>
          {["info", "warning", "error", "debug"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
      </div>

      {/* Log table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="divide-y">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-5">{isFetching ? "Loading…" : "No log entries found."}</p>
          ) : (
            filtered.map((log) => (
              <div key={log.id}>
                <button
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${SEV_BADGE[log.severity] ?? SEV_BADGE.info}`}>{log.severity}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{log.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {log.source ? `${log.source} · ` : ""}{log.eventType ? `${log.eventType} · ` : ""}{log.accessionNumber ? `ACC: ${log.accessionNumber} · ` : ""}{log.modality ?? ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
                </button>
                {expanded === log.id && (
                  <div className="bg-muted/30 px-4 pb-3 pt-0 text-xs space-y-1.5 border-t">
                    {log.studyInstanceUid && <p><span className="font-medium">Study UID:</span> <span className="font-mono break-all">{log.studyInstanceUid}</span></p>}
                    {log.patientId && <p><span className="font-medium">Patient ID:</span> {log.patientId}</p>}
                    {log.logType && <p><span className="font-medium">Log Type:</span> {log.logType}</p>}
                    {log.payload && (
                      <div>
                        <p className="font-medium mb-0.5">Payload:</p>
                        <pre className="bg-muted rounded p-2 overflow-x-auto max-h-32 text-xs">{(() => { try { return JSON.stringify(JSON.parse(log.payload), null, 2); } catch { return log.payload; } })()}</pre>
                      </div>
                    )}
                    {log.errorStack && (
                      <div>
                        <p className="font-medium mb-0.5 text-red-600">Stack Trace:</p>
                        <pre className="bg-red-50 dark:bg-red-950/30 rounded p-2 overflow-x-auto max-h-40 text-xs text-red-700 dark:text-red-400">{log.errorStack}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function PacsLogs() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="PACS Logs" subtitle="Event log from Conquest Lua hooks, Python agent, and RIS automation" />
      <PacsLogsPanel />
    </div>
  );
}
