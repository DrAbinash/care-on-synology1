import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Activity, ShieldAlert, RefreshCw, FileClock, Send, Bell, IndianRupee, HeartPulse } from "lucide-react";

type Summary = {
  reports: { pending: number; deliveredToday: number };
  delivery: { failuresToday: number };
  recall: { pending: number };
  billing: { billsToday: number; revenueToday: number; outstanding: number };
  alerts: { low: number; medium: number; high: number; critical: number; total: number };
  smokeTest: { status: string; at: string | null } | null;
  reliability?: { deadLetters: number | null; outboxStalledHours: number | null; backupAgeHours: number | null };
  generatedAt: string;
};
type Alert = { id: number; alertType: string; severity: string; message: string; scope: string | null; createdAt: string };

const SEV_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};
const SMOKE_CLS: Record<string, string> = {
  PASS: "text-green-600", WARNING: "text-amber-600", FAIL: "text-red-600",
};

// A reading that was not taken is displayed as not taken. Falling back to 0 here
// would be the friendliest possible lie: "0 h" means "the backup is fresh", while
// the server sent null because no successful backup has ever been recorded.
const UNMEASURED = "Not measured";
function ageText(h: number | null | undefined, suffix: string): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return UNMEASURED;
  if (h < 1) return `${Math.round(h * 60)} min${suffix}`;
  return `${h.toFixed(h < 10 ? 1 : 0)} h${suffix}`;
}
function ageCls(h: number | null | undefined, warnH: number, critH: number): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "text-red-600";
  if (h >= critH) return "text-red-600";
  if (h >= warnH) return "text-orange-600";
  return "text-green-600";
}

export default function OpsCockpit() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const summaryQ = useQuery({ queryKey: ["ops-summary"], queryFn: () => api.get<Summary>("/api/ops-cockpit/summary"), retry: false, refetchInterval: 60_000 });
  const alertsQ = useQuery({ queryKey: ["ops-alerts"], queryFn: () => api.get<Alert[]>("/api/ops-cockpit/alerts") });

  const scanMut = useMutation({
    mutationFn: () => api.post<{ created: number; scanned: number; failed?: boolean; reason?: string }>("/api/ops-cockpit/scan", {}),
    // A scan that could not read its metrics answers `scanned: 0, created: 0` — the same
    // numbers an idle clinic produces — so it must not be announced as "Scan complete".
    onSuccess: (r) => {
      if (r.failed) toast({ title: "Scan did not run", description: r.reason || "the metric queries did not complete", variant: "destructive" });
      else toast({ title: "Scan complete", description: `${r.created} new alert(s)` });
      qc.invalidateQueries({ queryKey: ["ops-summary"] }); qc.invalidateQueries({ queryKey: ["ops-alerts"] });
    },
    onError: (e) => toast({ title: "Scan failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (summaryQ.error) {
    const msg = (summaryQ.error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <div className="space-y-4">
        <PageHeader title="Operations Cockpit" subtitle="Unified operational health" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">{shadow ? "Operations cockpit is in Shadow Mode" : "Could not load"}</p>
            <p className="text-xs">{shadow ? "Enable the ff_ops_cockpit feature flag to view the operational cockpit." : msg}</p>
          </div>
        </Card>
      </div>
    );
  }

  const s = summaryQ.data;
  const kpis = [
    { label: "Pending reports", value: s?.reports.pending ?? 0, icon: FileClock, cls: "" },
    { label: "Delivered today", value: s?.reports.deliveredToday ?? 0, icon: Send, cls: "text-green-600" },
    { label: "Delivery failures", value: s?.delivery.failuresToday ?? 0, icon: ShieldAlert, cls: (s?.delivery.failuresToday ?? 0) > 0 ? "text-red-600" : "" },
    { label: "Recalls pending", value: s?.recall.pending ?? 0, icon: Bell, cls: "" },
    { label: "Bills today", value: s?.billing.billsToday ?? 0, icon: IndianRupee, cls: "" },
    { label: "Outstanding ₹", value: Math.round(s?.billing.outstanding ?? 0), icon: IndianRupee, cls: "" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Operations Cockpit" subtitle="Live KPIs + proactive anomaly alerts" />
        <Button onClick={() => scanMut.mutate()} disabled={scanMut.isPending}><RefreshCw className="h-4 w-4 mr-1.5" /> Run scan</Button>
      </div>

      {summaryQ.isLoading ? <div className="grid grid-cols-2 md:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div> :
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <Card key={k.label}><CardContent className="py-4 text-center">
                <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                <div className={`text-2xl font-bold ${k.cls}`}>{k.value}</div>
                <div className="text-xs text-muted-foreground">{k.label}</div>
              </CardContent></Card>
            );
          })}
        </div>}

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Open alerts ({s?.alerts.total ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alertsQ.isLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />) :
              (alertsQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No open alerts — all clear.</p> :
              (alertsQ.data ?? []).map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Badge variant="outline" className={SEV_CLS[a.severity] ?? ""}>{a.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.alertType}</div>
                    <div className="text-xs text-muted-foreground">{a.message}</div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleTimeString()}</div>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><HeartPulse className="h-4 w-4" /> System health</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Latest smoke test</div>
              {s?.smokeTest ? <div className={`font-bold ${SMOKE_CLS[s.smokeTest.status] ?? ""}`}>{s.smokeTest.status}</div> : <div className="text-muted-foreground">Never run</div>}
              {s?.smokeTest?.at && <div className="text-xs text-muted-foreground">{new Date(s.smokeTest.at).toLocaleString()}</div>}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last recorded backup</div>
              <div className={`font-bold ${ageCls(s?.reliability?.backupAgeHours, 26, 48)}`}>
                {ageText(s?.reliability?.backupAgeHours, " ago")}
              </div>
              <div className="text-[10px] text-muted-foreground">From <code>backup_logs</code>: the app's own record. It is not a restore proof — <code>ops-backup-inventory</code> is.</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Dead letters</div>
                <div className={`font-bold ${s?.reliability?.deadLetters ? "text-red-600" : ""}`}>
                  {s?.reliability?.deadLetters ?? UNMEASURED}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Unsent event</div>
                <div className={`font-bold ${ageCls(s?.reliability?.outboxStalledHours, 6, 24)}`}>
                  {s?.reliability?.outboxStalledHours === 0 ? "none waiting" : ageText(s?.reliability?.outboxStalledHours, " overdue")}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs text-muted-foreground">Critical</div><div className="font-bold text-red-600">{s?.alerts.critical ?? 0}</div></div>
              <div><div className="text-xs text-muted-foreground">High</div><div className="font-bold text-orange-600">{s?.alerts.high ?? 0}</div></div>
            </div>
            {s?.generatedAt && <div className="text-[10px] text-muted-foreground">Updated {new Date(s.generatedAt).toLocaleTimeString()}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
