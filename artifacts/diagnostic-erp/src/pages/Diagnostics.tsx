import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle } from "lucide-react";

type RecentRequest = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  role: string;
  timestamp: string;
};

type EndpointStat = {
  method: string;
  path: string;
  count: number;
  avgMs: number;
  maxMs: number;
  slowCount: number;
  errorCount: number;
};

type DiagnosticsSummary = {
  ok: boolean;
  slowThresholdMs: number;
  recent: RecentRequest[];
  endpoints: EndpointStat[];
};

function StatusBadge({ code }: { code: number }) {
  const cls =
    code >= 500 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    : code >= 400 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  return <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${cls}`}>{code}</span>;
}

function DurationCell({ ms, threshold }: { ms: number; threshold: number }) {
  const slow = ms > threshold;
  return (
    <span className={slow ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground"}>
      {ms.toLocaleString()} ms
    </span>
  );
}

export function DiagnosticsPanel() {
  const [tab, setTab] = useState<"endpoints" | "recent">("endpoints");

  const { data, isFetching, refetch } = useQuery<DiagnosticsSummary>({
    queryKey: ["diagnostics-summary"],
    queryFn: () => api.get("/api/diagnostics/summary?limit=300"),
    refetchInterval: 15_000,
  });

  const threshold = data?.slowThresholdMs ?? 1000;
  const endpoints = data?.endpoints ?? [];
  const recent = data?.recent ?? [];
  const slowEndpointCount = endpoints.filter((e) => e.slowCount > 0).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Endpoints tracked</p>
          <p className="text-2xl font-bold mt-1">{endpoints.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Slow endpoints (&gt;{threshold}ms)</p>
          <p className={`text-2xl font-bold mt-1 ${slowEndpointCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
            {slowEndpointCount}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Requests in buffer</p>
          <p className="text-2xl font-bold mt-1">{recent.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Errors (5xx) seen</p>
          <p className="text-2xl font-bold mt-1">{endpoints.reduce((sum, e) => sum + e.errorCount, 0)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setTab("endpoints")}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${tab === "endpoints" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            By Endpoint
          </button>
          <button
            onClick={() => setTab("recent")}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${tab === "recent" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Recent Requests
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {tab === "endpoints" ? (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Endpoint</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
                <th className="text-right px-3 py-2 font-medium">Avg</th>
                <th className="text-right px-3 py-2 font-medium">Max</th>
                <th className="text-right px-3 py-2 font-medium">Slow hits</th>
                <th className="text-right px-3 py-2 font-medium">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {endpoints.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                  {isFetching ? "Loading…" : "No requests recorded yet."}
                </td></tr>
              ) : endpoints.map((e) => (
                <tr key={`${e.method} ${e.path}`} className={e.slowCount > 0 ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-muted-foreground mr-1.5">{e.method}</span>
                    <span className="font-mono text-xs">{e.path}</span>
                  </td>
                  <td className="text-right px-3 py-2">{e.count}</td>
                  <td className="text-right px-3 py-2"><DurationCell ms={e.avgMs} threshold={threshold} /></td>
                  <td className="text-right px-3 py-2"><DurationCell ms={e.maxMs} threshold={threshold} /></td>
                  <td className="text-right px-3 py-2">
                    {e.slowCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                        <AlertTriangle size={12} />{e.slowCount}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="text-right px-3 py-2">{e.errorCount > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{e.errorCount}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Endpoint</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-right px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">
                  {isFetching ? "Loading…" : "No requests recorded yet."}
                </td></tr>
              ) : recent.map((r, i) => (
                <tr key={i} className={r.durationMs > threshold ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.timestamp).toLocaleTimeString()}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs font-mono text-muted-foreground mr-1.5">{r.method}</span>
                    <span className="font-mono text-xs">{r.path}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.role}</td>
                  <td className="text-right px-3 py-2"><StatusBadge code={r.statusCode} /></td>
                  <td className="text-right px-3 py-2"><DurationCell ms={r.durationMs} threshold={threshold} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Diagnostics() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="API Diagnostics"
        subtitle="Live request performance — endpoints, durations, and errors (admin only)"
      />
      <DiagnosticsPanel />
    </div>
  );
}
