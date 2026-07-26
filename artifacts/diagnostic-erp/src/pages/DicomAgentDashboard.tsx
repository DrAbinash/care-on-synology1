import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Wifi, WifiOff, Clock, CheckCircle2, AlertCircle,
  Activity, Search, XCircle, Radio, Server, Zap, MonitorPlay, Tv2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { openWeasisLaunchRedirect } from "@/lib/viewerService";

// ── Types ──────────────────────────────────────────────────────────────────────

type AgentStatus = {
  id: number;
  agentName: string;
  agentHost: string;
  lastHeartbeatAt: string | null;
  lastSuccessfulPullAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  isOnline: boolean;
  studiesFoundToday: number;
  studiesPulledToday: number;
  failedToday: number;
  updatedAt: string;
};

type AgentLog = {
  id: number;
  agentName: string | null;
  agentHost: string | null;
  eventType: string;
  sourceAeTitle: string | null;
  sourceIp: string | null;
  modality: string | null;
  studyInstanceUID: string | null;
  accessionNumber: string | null;
  patientName: string | null;
  patientId: string | null;
  status: string;
  message: string;
  createdAt: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { hour12: true });
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  FAILED:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  WARNING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  INFO:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  C_ECHO:     <Radio size={12} />,
  C_FIND:     <Search size={12} />,
  C_MOVE:     <Zap size={12} />,
  C_GET:      <Zap size={12} />,
  C_STORE:    <CheckCircle2 size={12} />,
  HEARTBEAT:  <Activity size={12} />,
  ERP_POST:   <Server size={12} />,
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentStatus }) {
  const heartbeatAge = agent.lastHeartbeatAt
    ? Date.now() - new Date(agent.lastHeartbeatAt).getTime()
    : Infinity;
  const stale = heartbeatAge > 5 * 60 * 1000; // >5 min = stale

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${agent.isOnline && !stale ? "border-green-200 dark:border-green-800" : "border-gray-200 dark:border-gray-700"}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${agent.isOnline && !stale ? "bg-green-50 dark:bg-green-900/20" : "bg-gray-50 dark:bg-gray-800/40"}`}>
        <div className="flex items-center gap-2">
          {agent.isOnline && !stale
            ? <Wifi size={16} className="text-green-600 dark:text-green-400" />
            : <WifiOff size={16} className="text-gray-500" />}
          <span className="font-bold text-sm">{agent.agentName}</span>
          <span className="text-xs text-muted-foreground font-mono">{agent.agentHost}</span>
        </div>
        <Badge className={agent.isOnline && !stale
          ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 border-0"
          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 border-0"}>
          {agent.isOnline && !stale ? "ONLINE" : "OFFLINE"}
        </Badge>
      </div>

      {/* Stats grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{agent.studiesFoundToday}</p>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-0.5">Found Today</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{agent.studiesPulledToday}</p>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-0.5">Pulled Today</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-bold ${agent.failedToday > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>{agent.failedToday}</p>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-0.5">Failed Today</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 pb-4 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Clock size={11} className="shrink-0" />
          <span className="font-medium">Last heartbeat:</span>
          <span>{timeAgo(agent.lastHeartbeatAt)} · {fmtTs(agent.lastHeartbeatAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 size={11} className="shrink-0 text-green-500" />
          <span className="font-medium">Last successful pull:</span>
          <span>{timeAgo(agent.lastSuccessfulPullAt)}</span>
        </div>
        {agent.lastErrorAt && (
          <div className="flex items-start gap-2">
            <AlertCircle size={11} className="shrink-0 text-red-500 mt-0.5" />
            <div>
              <span className="font-medium text-red-600 dark:text-red-400">Last error:</span>{" "}
              <span>{timeAgo(agent.lastErrorAt)}</span>
              {agent.lastErrorMessage && (
                <p className="mt-0.5 text-red-500 dark:text-red-400 truncate max-w-xs">{agent.lastErrorMessage}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function DicomAgentPanel() {
  const { toast } = useToast();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const [filters, setFilters] = useState({
    dateFrom: today,
    dateTo: today,
    status: "",
    modality: "",
    patient: "",
    accession: "",
  });
  const [pending, setPending] = useState(filters);
  const [page, setPage] = useState(1);

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus, isFetching: statusFetching } = useQuery<{ agents: AgentStatus[] }>({
    queryKey: ["dicom-agent-status"],
    queryFn: () => api.get("/api/dicom-agent/status"),
    refetchInterval: 30_000,
  });

  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs, isFetching: logsFetching } = useQuery<{ logs: AgentLog[]; total: number; page: number; limit: number }>({
    queryKey: ["dicom-agent-logs", filters, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo)   params.set("dateTo",   filters.dateTo);
      if (filters.status)   params.set("status",   filters.status);
      if (filters.modality) params.set("modality", filters.modality);
      if (filters.patient)  params.set("patient",  filters.patient);
      if (filters.accession) params.set("accession", filters.accession);
      return api.get(`/api/dicom-agent/logs?${params}`);
    },
    refetchInterval: 30_000,
  });

  const applyFilters = useCallback(() => {
    setFilters(pending);
    setPage(1);
  }, [pending]);

  const clearFilters = useCallback(() => {
    const reset = { dateFrom: today, dateTo: today, status: "", modality: "", patient: "", accession: "" };
    setPending(reset);
    setFilters(reset);
    setPage(1);
  }, [today]);

  const agents = statusData?.agents ?? [];
  const logs   = logsData?.logs ?? [];
  const total  = logsData?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => { void refetchStatus(); void refetchLogs(); }} disabled={statusFetching || logsFetching}>
          <RefreshCw size={14} className={(statusFetching || logsFetching) ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* ── Agent Status Cards ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Agent Status</h2>
        {statusLoading ? (
          <div className="text-sm text-muted-foreground">Loading agent status…</div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            <WifiOff size={32} className="mx-auto mb-3 opacity-40" />
            <p className="font-semibold">No agents have connected yet.</p>
            <p className="mt-1">Configure and start the DICOM Pull Agent on your Windows server.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
          </div>
        )}
      </section>

      {/* ── Log Filters ── */}
      <section className="rounded-xl border bg-card shadow-sm">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Search size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold">Filter Logs</h2>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From Date</label>
            <Input type="date" value={pending.dateFrom} onChange={(e) => setPending(p => ({ ...p, dateFrom: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To Date</label>
            <Input type="date" value={pending.dateTo} onChange={(e) => setPending(p => ({ ...p, dateTo: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <select value={pending.status} onChange={(e) => setPending(p => ({ ...p, status: e.target.value }))}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">All</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="WARNING">WARNING</option>
              <option value="INFO">INFO</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Modality</label>
            <select value={pending.modality} onChange={(e) => setPending(p => ({ ...p, modality: e.target.value }))}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">All</option>
              {["MR", "CT", "CR", "DX", "US", "MG", "XA", "OT"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Patient Name</label>
            <Input placeholder="Search…" value={pending.patient} onChange={(e) => setPending(p => ({ ...p, patient: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Accession #</label>
            <Input placeholder="Search…" value={pending.accession} onChange={(e) => setPending(p => ({ ...p, accession: e.target.value }))} className="h-8 text-xs" />
          </div>
        </div>
        <div className="px-4 pb-4 flex gap-2">
          <Button size="sm" onClick={applyFilters} disabled={logsFetching}>
            <Search size={13} /> Apply
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            <XCircle size={13} /> Clear
          </Button>
        </div>
      </section>

      {/* ── Logs Table ── */}
      <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Activity size={14} /> Agent Event Log
            {total > 0 && <span className="text-xs font-normal text-muted-foreground">({total.toLocaleString()} events)</span>}
          </h2>
          {logsFetching && <RefreshCw size={13} className="animate-spin text-muted-foreground" />}
        </div>

        {logsLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading logs…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Activity size={28} className="mx-auto mb-2 opacity-40" />
            No log entries found for the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  {["Time", "Agent", "Event", "Modality", "Patient", "Accession", "Study UID", "Status", "Message", "View"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtTs(log.createdAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground text-[10px]">{log.agentName ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted font-medium">
                        {EVENT_ICONS[log.eventType] ?? <Radio size={12} />}
                        {log.eventType}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {log.modality
                        ? <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">{log.modality}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 font-semibold max-w-[140px] truncate">{log.patientName ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{log.accessionNumber ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10px] max-w-[120px] truncate text-muted-foreground" title={log.studyInstanceUID ?? ""}>{log.studyInstanceUID ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${STATUS_COLORS[log.status] ?? STATUS_COLORS.INFO}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate" title={log.message}>{log.message}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {log.studyInstanceUID ? (
                        <div className="flex gap-1">
                          <a
                            href={`/erp/radiology/viewer/${log.studyInstanceUID}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
                            title="Open in OHIF Viewer"
                          >
                            <MonitorPlay size={10} /> OHIF
                          </a>
                          <button
                            type="button"
                            onClick={() => void openWeasisLaunchRedirect(log.studyInstanceUID!, toast)}
                            className="inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium"
                            title="Open in Weasis"
                          >
                            <Tv2 size={10} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} total events</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function DicomAgentDashboard() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="DICOM Agent Monitor" subtitle="Live status and event log from the Windows DICOM Pull Agent" />
      <DicomAgentPanel />
    </div>
  );
}
