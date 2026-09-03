import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, PlayCircle, CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle,
  ChevronDown, ChevronRight, Clock, GitCommit, Server, Timer, Database, ScrollText, Network, Gauge, Tv, ExternalLink,
} from "lucide-react";

// ── Types (mirror the server OpsHealthReport; the API is the source of truth) ──
type OpsStatus = "PASS" | "WARNING" | "FAIL" | "SKIPPED" | "UNKNOWN";
interface OpsCheck {
  id: string; name: string; category: string; status: OpsStatus; message: string;
  checkedAt: string; durationMs: number; required: boolean;
  metadata?: Record<string, unknown>; recommendedAction?: string;
}
interface OpsReport {
  overall: OpsStatus; generatedAt: string; durationMs: number; trigger: string;
  version: { version: string; build: string; releaseName: string | null; commit: string; branch: string | null; buildTime: string | null; nodeEnv: string; uptimeSeconds?: number | null };
  checks: OpsCheck[];
  summary: { pass: number; warning: number; fail: number; skipped: number; unknown: number; total: number };
}
interface OpsRunRow {
  id: number; runId: string; trigger: string; overallStatus: OpsStatus; version: string | null;
  gitCommit: string | null; startedAt: string; finishedAt: string; durationMs: number;
  initiatedBy: string | null; createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  application: "Application", database: "Database", authentication: "Authentication",
  core_erp: "Core ERP", radiology_pacs: "Radiology / PACS", queue_displays: "Queue Displays",
  integrations: "Integrations", storage_backup: "Storage & Backup",
};
const CATEGORY_ORDER = ["application", "database", "authentication", "core_erp", "radiology_pacs", "queue_displays", "integrations", "storage_backup"];

const STATUS_UI: Record<OpsStatus, { badge: string; text: string; ring: string; dot: string; light: string; icon: ReactNode }> = {
  PASS: { badge: "bg-emerald-100 text-emerald-800 border-emerald-300", text: "text-emerald-700", ring: "border-l-emerald-500", dot: "bg-emerald-500", light: "Healthy", icon: <CheckCircle2 size={14} className="text-emerald-600" /> },
  WARNING: { badge: "bg-amber-100 text-amber-800 border-amber-300", text: "text-amber-700", ring: "border-l-amber-500", dot: "bg-amber-500", light: "Warning", icon: <AlertTriangle size={14} className="text-amber-600" /> },
  FAIL: { badge: "bg-red-100 text-red-800 border-red-300", text: "text-red-700", ring: "border-l-red-500", dot: "bg-red-500", light: "Critical", icon: <XCircle size={14} className="text-red-600" /> },
  SKIPPED: { badge: "bg-slate-100 text-slate-600 border-slate-300", text: "text-slate-500", ring: "border-l-slate-300", dot: "bg-slate-400", light: "—", icon: <MinusCircle size={14} className="text-slate-400" /> },
  UNKNOWN: { badge: "bg-purple-100 text-purple-800 border-purple-300", text: "text-purple-700", ring: "border-l-purple-400", dot: "bg-purple-500", light: "Unknown", icon: <HelpCircle size={14} className="text-purple-600" /> },
};

function formatUptime(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function OverallBanner({ report, live }: { report: OpsReport; live: boolean }) {
  const ui = STATUS_UI[report.overall];
  const s = report.summary;
  const uptime = formatUptime(report.version.uptimeSeconds);
  // Database schema state — surfaced from the existing db.schema_verify check
  // (no new backend data), so operators see the schema-verification result.
  const schema = report.checks.find((c) => c.id === "db.schema_verify");
  return (
    <div className={`rounded-lg border-l-4 ${ui.ring} border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2`}>
      {/* Traffic-light headline: Healthy / Warning / Critical */}
      <div className="flex items-center gap-2">
        <span className={`inline-block h-3.5 w-3.5 rounded-full ${ui.dot}`} />
        <span className="text-lg font-bold">{ui.light}</span>
        <Badge variant="outline" className={`text-[10px] ${ui.badge}`}>{report.overall}</Badge>
        <Badge variant="outline" className="text-[10px]">{live ? "LIVE" : "LAST RUN"}</Badge>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="text-emerald-700 font-medium">{s.pass} pass</span>
        <span className="text-amber-700 font-medium">{s.warning} warn</span>
        <span className="text-red-700 font-medium">{s.fail} fail</span>
        <span>{s.skipped} skipped</span>
        <span className="text-purple-700">{s.unknown} unknown</span>
      </div>
      <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ml-auto flex-wrap">
        <span className="flex items-center gap-1"><Clock size={12} /> {new Date(report.generatedAt).toLocaleString()} · {report.durationMs}ms</span>
        <span className="flex items-center gap-1"><Server size={12} /> v{report.version.version} (build {report.version.build})</span>
        <span className="flex items-center gap-1"><GitCommit size={12} /> {report.version.commit}{report.version.buildTime ? ` · ${report.version.buildTime}` : ""}</span>
        {uptime && <span className="flex items-center gap-1"><Timer size={12} /> up {uptime}</span>}
        {schema && (
          <span className="flex items-center gap-1" title={schema.message}>
            <Database size={12} /> schema {schema.status === "PASS" ? "verified" : schema.status.toLowerCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: OpsCheck }) {
  const [open, setOpen] = useState(false);
  const ui = STATUS_UI[check.status];
  const hasDetails = (check.metadata && Object.keys(check.metadata).length > 0) || !!check.recommendedAction;
  return (
    <div className={`border-l-2 ${ui.ring} pl-3 py-1.5`}>
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        className={`w-full flex items-start gap-2 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="mt-0.5 shrink-0">{ui.icon}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{check.name}</span>
            <Badge variant="outline" className={`text-[9px] ${ui.badge}`}>{check.status}</Badge>
            {!check.required && <span className="text-[9px] text-muted-foreground">optional</span>}
            <span className="text-[10px] text-muted-foreground ml-auto">{check.durationMs}ms</span>
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">{check.message}</span>
        </span>
        {hasDetails && <span className="mt-0.5 shrink-0 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>}
      </button>
      {open && hasDetails && (
        <div className="ml-6 mt-1.5 space-y-1.5">
          {check.recommendedAction && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-900">
              <span className="font-semibold">Recommended: </span>{check.recommendedAction}
            </div>
          )}
          {check.metadata && Object.keys(check.metadata).length > 0 && (
            <pre className="text-[10px] bg-muted/40 rounded px-2 py-1 overflow-x-auto text-muted-foreground">{JSON.stringify(check.metadata, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function OperationalHealth() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"ALL" | "FAIL" | "WARNING">("ALL");
  const [ranReport, setRanReport] = useState<OpsReport | null>(null);

  const { data: liveReport, isFetching, refetch } = useQuery<OpsReport>({
    queryKey: ["/api/admin/operations/health"],
    queryFn: () => api.get<OpsReport>("/api/admin/operations/health?includeOptional=1"),
    // Manual refresh + a gentle 60s auto-refresh (never aggressive polling).
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: history } = useQuery<{ runs: OpsRunRow[] }>({
    queryKey: ["/api/admin/operations/history"],
    queryFn: () => api.get<{ runs: OpsRunRow[] }>("/api/admin/operations/history?limit=15"),
    staleTime: 30_000,
  });

  const runSmoke = useMutation({
    mutationFn: () => api.post<{ runId: string; report: OpsReport }>("/api/admin/operations/smoke-run", { includeOptional: true }),
    onSuccess: (res) => {
      setRanReport(res.report);
      toast({ title: "Smoke test complete", description: `Overall: ${res.report.overall}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/operations/history"] });
    },
    onError: (e) => toast({ title: "Smoke test failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" }),
  });

  const report = ranReport ?? liveReport;

  const grouped = useMemo(() => {
    if (!report) return [];
    const byCat = new Map<string, OpsCheck[]>();
    for (const c of report.checks) {
      if (filter === "FAIL" && c.status !== "FAIL") continue;
      if (filter === "WARNING" && c.status !== "WARNING") continue;
      if (!byCat.has(c.category)) byCat.set(c.category, []);
      byCat.get(c.category)!.push(c);
    }
    return CATEGORY_ORDER.filter((cat) => byCat.has(cat)).map((cat) => ({ category: cat, checks: byCat.get(cat)! }));
  }, [report, filter]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <PageHeader
        title="Operational Health"
        subtitle="Post-deployment smoke test — verify the system is operational within a minute of a Container Manager rebuild."
        actions={
          <>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {(["ALL", "FAIL", "WARNING"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1.5 transition-colors ${filter === f ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"}`}
                >
                  {f === "ALL" ? "All" : f === "FAIL" ? "Failures" : "Warnings"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => { setRanReport(null); refetch(); }} disabled={isFetching}>
              <RefreshCw size={14} className={`mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => runSmoke.mutate()} disabled={runSmoke.isPending}>
              <PlayCircle size={14} className={`mr-1.5 ${runSmoke.isPending ? "animate-pulse" : ""}`} /> Run full smoke test
            </Button>
          </>
        }
      />

      {!report && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {isFetching ? "Running health checks…" : "No report yet."}
        </CardContent></Card>
      )}

      {report && (
        <>
          <OverallBanner report={report} live={!ranReport} />
          <p className="text-xs text-muted-foreground -mt-2">
            {ranReport
              ? "Showing the smoke-test run you just executed (persisted to history)."
              : "Showing current live health (on-demand probes — not a historical smoke-test row)."}
          </p>

          {/* Contextual actions — reuse existing routes; no new surfaces. The
              deeper PACS/viewer launchers (Orthanc/OHIF) live on Network
              Control; logs on PACS Logs; queue displays open in a new tab. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Related tools:</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => runSmoke.mutate()} disabled={runSmoke.isPending}>
              <PlayCircle size={13} className="mr-1" /> Run smoke test again
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/radiology/network-control-center")}>
              <Network size={13} className="mr-1" /> Orthanc / OHIF (Network Control)
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/radiology/pacs-logs")}>
              <ScrollText size={13} className="mr-1" /> View PACS Logs
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/radiology/operations-dashboard")}>
              <Gauge size={13} className="mr-1" /> Operations Dashboard
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open("/queue/usg", "_blank", "noopener")}>
              <Tv size={13} className="mr-1" /> Open Queue <ExternalLink size={11} className="ml-1" />
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {grouped.map(({ category, checks }) => (
              <Card key={category}>
                <CardContent className="p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {CATEGORY_LABELS[category] ?? category}
                  </div>
                  <div className="space-y-1">
                    {checks.map((c) => <CheckRow key={c.id} check={c} />)}
                  </div>
                </CardContent>
              </Card>
            ))}
            {grouped.length === 0 && (
              <Card className="md:col-span-2"><CardContent className="py-8 text-center text-sm text-muted-foreground">
                No checks match the “{filter}” filter.
              </CardContent></Card>
            )}
          </div>

          {/* Recent smoke-test history */}
          <Card>
            <CardContent className="p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Historical smoke-test runs</div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Persisted results only — July (or older) rows mean no newer smoke-run was saved. They are not deleted. Live health is the banner above.
              </p>
              {!history?.runs?.length && <div className="text-xs text-muted-foreground py-2">No persisted runs yet. Use “Run full smoke test” or the <code>pnpm smoke:production --save-result</code> CLI.</div>}
              {!!history?.runs?.length && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left border-b">
                        <th className="py-1 pr-3 font-medium">When</th>
                        <th className="py-1 pr-3 font-medium">Trigger</th>
                        <th className="py-1 pr-3 font-medium">Overall</th>
                        <th className="py-1 pr-3 font-medium">Version</th>
                        <th className="py-1 pr-3 font-medium">Commit</th>
                        <th className="py-1 pr-3 font-medium">By</th>
                        <th className="py-1 pr-3 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.runs.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-1 pr-3 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="py-1 pr-3">{r.trigger}</td>
                          <td className="py-1 pr-3"><Badge variant="outline" className={`text-[9px] ${STATUS_UI[r.overallStatus]?.badge ?? ""}`}>{r.overallStatus}</Badge></td>
                          <td className="py-1 pr-3">{r.version ?? "—"}</td>
                          <td className="py-1 pr-3 font-mono">{(r.gitCommit ?? "—").slice(0, 8)}</td>
                          <td className="py-1 pr-3">{r.initiatedBy ?? "—"}</td>
                          <td className="py-1 pr-3">{r.durationMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
