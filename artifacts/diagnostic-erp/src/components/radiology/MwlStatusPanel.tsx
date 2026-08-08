import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  RefreshCw, ListChecks, FileStack, Radio,
} from "lucide-react";

type MwlCheckStatus = "pass" | "warn" | "fail" | "skip";

type MwlCheck = {
  id: string;
  title: string;
  status: MwlCheckStatus;
  detail: string;
  fix?: string;
};

type MwlDeploymentStatus = {
  ready: boolean;
  checks: MwlCheck[];
  worklistDir: string | null;
  worklistHostHint: string | null;
  wlFileCount: number;
  procedureStats: Record<string, number>;
  recentActive: Array<{
    accessionNumber: string;
    patientName: string | null;
    modality: string | null;
    status: string | null;
    scheduledDate: string | null;
    hasWlFile: boolean;
  }>;
  setupSteps: string[];
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

  return (
    <div className="space-y-4">
      {/* Overall banner */}
      <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
        data.ready
          ? "border-emerald-200 bg-emerald-50/80 dark:bg-emerald-950/20"
          : "border-amber-200 bg-amber-50/80 dark:bg-amber-950/20"
      }`}>
        <div className="flex items-start gap-3">
          {data.ready
            ? <CheckCircle2 size={22} className="text-emerald-600 mt-0.5 shrink-0" />
            : <AlertTriangle size={22} className="text-amber-600 mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold text-sm">
              {data.ready ? "MWL ready — bill → USG auto-fill can work" : "MWL not fully configured yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.wlFileCount} worklist file(s) on disk
              {data.worklistDir ? ` · ${data.worklistDir}` : ""}
              {data.worklistHostHint ? ` (host: ${data.worklistHostHint})` : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {/* Checklist */}
      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ListChecks size={16} className="text-primary" /> Deployment checks
        </h3>
        <div className="space-y-2">
          {data.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 p-2.5 rounded-lg border bg-muted/30">
              {statusIcon(c.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{c.title}</span>
                  {statusBadge(c.status)}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{c.detail}</p>
                {c.fix && c.status !== "pass" && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
                    <strong>Fix:</strong> {c.fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Setup steps */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileStack size={16} className="text-primary" /> Simple setup steps
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground">
          {data.setupSteps.map((step, i) => (
            <li key={i} className="leading-relaxed pl-1">{step}</li>
          ))}
        </ol>
      </div>

      {/* Today's active procedures */}
      {data.recentActive.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Radio size={16} className="text-primary" /> Active today (waiting for USG/modality)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 pr-2">Accession</th>
                  <th className="py-1.5 pr-2">Patient</th>
                  <th className="py-1.5 pr-2">Mod</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5">.wl file</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActive.map((r) => (
                  <tr key={r.accessionNumber} className="border-b border-muted/50">
                    <td className="py-1.5 pr-2 font-mono">{r.accessionNumber}</td>
                    <td className="py-1.5 pr-2">{r.patientName ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.modality ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.status}</td>
                    <td className="py-1.5">
                      {r.hasWlFile
                        ? <span className="text-emerald-600 font-semibold">Yes</span>
                        : <span className="text-amber-600">Missing — click Sync</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Procedure stats + sync */}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">All procedures: </span>
          {Object.entries(data.procedureStats).length === 0
            ? "none yet"
            : Object.entries(data.procedureStats).map(([k, v]) => `${k}: ${v}`).join(" · ")}
        </div>
        <Button
          size="sm"
          disabled={!isAdmin || syncing}
          onClick={onSync}
        >
          {syncing ? "Syncing…" : "Sync MWL files now"}
        </Button>
      </div>
    </div>
  );
}
