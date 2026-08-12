import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  RefreshCw, ListChecks, FileStack, Radio, Eraser,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

type MwlCheckStatus = "pass" | "warn" | "fail" | "skip";
type MwlVerdict = "healthy" | "degraded" | "failed";

type MwlCheck = {
  id: string;
  title: string;
  status: MwlCheckStatus;
  detail: string;
  fix?: string;
};

type MwlDeploymentStatus = {
  ready: boolean;
  verdict?: MwlVerdict;
  checks: MwlCheck[];
  worklistDir: string | null;
  worklistHostHint: string | null;
  stagingDir?: string | null;
  stagingHostHint?: string | null;
  wlFileCount: number;
  quarantineCount?: number;
  activeProcedureCount?: number;
  procedureStats: Record<string, number>;
  recentActive: Array<{
    accessionNumber: string;
    patientName: string | null;
    modality: string | null;
    status: string | null;
    scheduledDate: string | null;
    hasWlFile: boolean;
  }>;
  orthancInternal?: {
    display: string;
    networkNote: string;
  };
  lastSync?: {
    written: number | null;
    removed: number | null;
    total: number | null;
    at: string | null;
    error: string | null;
  } | null;
  setupSteps: string[];
  cleanupRetry?: {
    pending: number;
    retrying: number;
    abandoned: number;
    overdue: number;
    oldestPendingAgeMs: number | null;
    lastSuccessAt: string | null;
    trafficLight: "green" | "amber" | "red";
    detail: string;
    staleTerminalWlCount?: number;
  };
};

function statusIcon(status: MwlCheckStatus) {
  switch (status) {
    case "pass": return <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />;
    case "warn": return <AlertTriangle size={15} className="text-amber-600 shrink-0" />;
    case "fail": return <XCircle size={15} className="text-red-600 shrink-0" />;
    default: return <MinusCircle size={15} className="text-muted-foreground shrink-0" />;
  }
}

function statusBadge(status: MwlCheckStatus) {
  const cls = status === "pass"
    ? "text-emerald-700 border-emerald-200 bg-emerald-50"
    : status === "warn"
    ? "text-amber-700 border-amber-200 bg-amber-50"
    : status === "fail"
    ? "text-red-700 border-red-200 bg-red-50"
    : "text-muted-foreground";
  return <Badge variant="outline" className={`text-[10px] uppercase ${cls}`}>{status}</Badge>;
}

export function MwlStatusPanel({
  isAdmin,
  onSync,
  syncing,
}: {
  isAdmin: boolean;
  onSync: () => void;
  syncing?: boolean;
}) {
  const { toast } = useToast();
  const [cleanupRetrying, setCleanupRetrying] = useState(false);
  const { data, isLoading, isFetching, refetch, error } = useQuery<MwlDeploymentStatus>({
    queryKey: ["mwl-deployment-status"],
    queryFn: () => api.get("/api/radiology/mwl-status"),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground animate-pulse">
        Checking MWL deployment…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load MWL status. {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  const verdict = data.verdict ?? (data.ready ? "healthy" : "failed");
  const banner =
    verdict === "healthy"
      ? "border-emerald-200 bg-emerald-50/80 dark:bg-emerald-950/20"
      : verdict === "degraded"
        ? "border-amber-200 bg-amber-50/80 dark:bg-amber-950/20"
        : "border-red-200 bg-red-50/80 dark:bg-red-950/20";

  const cleanup = data.cleanupRetry;
  const cleanupLight = cleanup?.trafficLight ?? "green";

  const runCleanupRetry = async () => {
    setCleanupRetrying(true);
    try {
      const r = await api.post<{ ran: number; succeeded: number; failed: number }>(
        "/api/radiology-diagnostics/mwl-cleanup/retry",
        {},
      );
      toast({
        title: "MWL cleanup retry",
        description: `Processed ${r.ran}: ${r.succeeded} ok, ${r.failed} failed`,
      });
      void refetch();
    } catch (e: unknown) {
      toast({
        title: "Cleanup retry failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setCleanupRetrying(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="mwl-status-panel">
      <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${banner}`}>
        <div className="flex items-start gap-3">
          {verdict === "healthy"
            ? <CheckCircle2 size={22} className="text-emerald-600 mt-0.5 shrink-0" />
            : verdict === "degraded"
              ? <AlertTriangle size={22} className="text-amber-600 mt-0.5 shrink-0" />
              : <XCircle size={22} className="text-red-600 mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold text-sm uppercase tracking-wide" data-testid="mwl-verdict">
              MWL {verdict}{data.ready ? "" : " — not ready for modalities"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.wlFileCount} live .wl
              {typeof data.activeProcedureCount === "number" ? ` · ${data.activeProcedureCount} active procedures` : ""}
              {data.quarantineCount ? ` · ${data.quarantineCount} quarantined` : ""}
              {data.worklistDir ? ` · live ${data.worklistDir}` : ""}
              {data.stagingDir ? ` · staging ${data.stagingDir}` : ""}
            </p>
            {data.orthancInternal && (
              <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
                Orthanc internal: {data.orthancInternal.display}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" className="h-8 gap-1.5" onClick={onSync} disabled={syncing}>
              <Radio size={13} /> {syncing ? "Syncing…" : "Sync worklist"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {cleanup && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            cleanupLight === "green"
              ? "border-emerald-200 bg-emerald-50/50"
              : cleanupLight === "amber"
                ? "border-amber-200 bg-amber-50/50"
                : "border-red-200 bg-red-50/50"
          }`}
          data-testid="mwl-cleanup-retry-status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Eraser size={16} className="text-primary" />
              MWL cancel cleanup
            </h3>
            <Badge
              variant="outline"
              className={`text-[10px] uppercase ${
                cleanupLight === "green"
                  ? "text-emerald-700 border-emerald-200"
                  : cleanupLight === "amber"
                    ? "text-amber-700 border-amber-200"
                    : "text-red-700 border-red-200"
              }`}
            >
              {cleanupLight === "green" ? "GREEN" : cleanupLight === "amber" ? "AMBER" : "RED"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{cleanup.detail}</p>
          <p className="text-[11px] text-muted-foreground font-mono">
            pending={cleanup.pending} · retrying={cleanup.retrying} · abandoned={cleanup.abandoned}
            {cleanup.staleTerminalWlCount ? ` · stale .wl=${cleanup.staleTerminalWlCount}` : ""}
            {cleanup.lastSuccessAt ? ` · last ok ${cleanup.lastSuccessAt}` : ""}
          </p>
          {isAdmin && (cleanup.pending + cleanup.retrying + cleanup.abandoned > 0 || (cleanup.staleTerminalWlCount ?? 0) > 0) && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => void runCleanupRetry()}
              disabled={cleanupRetrying}
              data-testid="mwl-cleanup-retry-now"
            >
              <Eraser size={13} /> {cleanupRetrying ? "Retrying…" : "Retry MWL Cleanup Now"}
            </Button>
          )}
        </div>
      )}

      {data.lastSync && (
        <div className={`rounded-lg border p-3 text-xs ${data.lastSync.error || data.lastSync.written === 0 && (data.lastSync.total ?? 0) > 0 ? "border-red-200 bg-red-50 text-red-800" : "bg-muted/30 text-muted-foreground"}`}>
          Last sync{data.lastSync.at ? ` @ ${data.lastSync.at}` : ""}: wrote {data.lastSync.written ?? "—"},
          removed {data.lastSync.removed ?? "—"} of {data.lastSync.total ?? "—"}
          {data.lastSync.error ? ` — ${data.lastSync.error}` : ""}
        </div>
      )}

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ListChecks size={16} className="text-primary" /> Deployment checks
        </h3>
        <ul className="space-y-2">
          {data.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs border-b border-border/60 pb-2 last:border-0">
              {statusIcon(c.status)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{c.title}</span>
                  {statusBadge(c.status)}
                </div>
                <p className="text-muted-foreground mt-0.5 break-words">{c.detail}</p>
                {c.fix && c.status !== "pass" && (
                  <p className="text-[10px] text-amber-800 mt-1">Fix: {c.fix}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {data.recentActive.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileStack size={16} className="text-primary" /> Recent active procedures
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 pr-2">Accession</th>
                  <th className="py-1 pr-2">Patient</th>
                  <th className="py-1 pr-2">Mod</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1">.wl</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActive.map((r) => (
                  <tr key={r.accessionNumber} className="border-b border-border/40">
                    <td className="py-1 pr-2 font-mono">{r.accessionNumber}</td>
                    <td className="py-1 pr-2">{r.patientName ?? "—"}</td>
                    <td className="py-1 pr-2">{r.modality ?? "—"}</td>
                    <td className="py-1 pr-2">{r.status ?? "—"}</td>
                    <td className="py-1">{r.hasWlFile ? "✓" : "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.setupSteps?.length > 0 && (
        <div className="rounded-xl border border-dashed p-4 text-[11px] text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground text-xs">Setup checklist</p>
          <ol className="list-decimal pl-4 space-y-1">
            {data.setupSteps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
