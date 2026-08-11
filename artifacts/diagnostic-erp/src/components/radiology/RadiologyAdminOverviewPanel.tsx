import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, CheckCircle2, RefreshCw, Server, Radio, MonitorPlay, Workflow,
} from "lucide-react";

type TrafficLight = "green" | "yellow" | "red" | "unknown";

type Overview = {
  generatedAt: string;
  overall: TrafficLight;
  components: Array<{ id: string; label: string; status: TrafficLight; detail: string }>;
  mwl: {
    verdict: "healthy" | "degraded" | "failed";
    ready: boolean;
    wlFileCount: number;
    activeProcedureCount: number;
    quarantineCount: number;
  };
  orthancInternal: {
    display: string;
    source: string;
    networkNote: string;
  };
  syncWorkers: Array<{ id: string; label: string; enabled: boolean; detail: string }>;
  duplicateSyncWarning: string | null;
  deployment: {
    orthancWorklistDir: string | null;
    stagingDir: string | null;
    orthancCredentialsConfigured: boolean;
    internalApiKeyConfigured: boolean;
    secrets: { orthancPasswordSet: boolean; internalApiKeySet: boolean };
  };
};

const LIGHT: Record<TrafficLight, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
  unknown: "bg-slate-300",
};

const ICONS: Record<string, typeof Server> = {
  orthanc: Server,
  mwl: Radio,
  sync: Workflow,
  ohif: MonitorPlay,
};

export function RadiologyAdminOverviewPanel({
  onGotoTab,
}: {
  onGotoTab?: (tab: string) => void;
}) {
  const { data, isLoading, isFetching, refetch, error } = useQuery<Overview>({
    queryKey: ["radiology-admin-overview"],
    queryFn: () => api.get("/api/radiology/admin-overview"),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="rounded-xl border p-6 text-sm text-muted-foreground animate-pulse">Loading radiology overview…</div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load overview. {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="radiology-admin-overview">
      <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
        data.overall === "green"
          ? "border-emerald-200 bg-emerald-50/80"
          : data.overall === "yellow"
            ? "border-amber-200 bg-amber-50/80"
            : "border-red-200 bg-red-50/80"
      }`}>
        <div className="flex items-start gap-3">
          {data.overall === "green"
            ? <CheckCircle2 className="text-emerald-600 mt-0.5 shrink-0" size={22} />
            : <AlertTriangle className={data.overall === "yellow" ? "text-amber-600 mt-0.5 shrink-0" : "text-red-600 mt-0.5 shrink-0"} size={22} />}
          <div>
            <p className="font-semibold text-sm uppercase tracking-wide">
              Overall: {data.overall}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              MWL {data.mwl.verdict} · {data.mwl.wlFileCount} live .wl · {data.mwl.activeProcedureCount} active procedures
              {data.mwl.quarantineCount > 0 ? ` · ${data.mwl.quarantineCount} quarantined` : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.components.map((c) => {
          const Icon = ICONS[c.id] ?? Activity;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onGotoTab?.(c.id === "mwl" ? "mwl" : c.id === "ohif" ? "viewers" : c.id === "sync" ? "sync" : c.id === "orthanc" ? "pacs" : "overview")}
              className="text-left rounded-xl border bg-card p-4 hover:bg-muted/40 transition-colors"
              data-testid={`overview-card-${c.id}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={`h-2.5 w-2.5 rounded-full ${LIGHT[c.status]}`} />
                <Icon size={14} className="text-muted-foreground" />
                <span className="text-xs font-semibold">{c.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-3 font-mono break-all">{c.detail}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold">Internal Orthanc endpoint (server-side)</h3>
        <p className="text-xs font-mono break-all">{data.orthancInternal.display}</p>
        <p className="text-[11px] text-muted-foreground">{data.orthancInternal.networkNote}</p>
        <p className="text-[10px] text-muted-foreground">
          This is not a browser URL. Credentials are never shown here
          (password set: {data.deployment.secrets.orthancPasswordSet ? "yes" : "no"};
          INTERNAL_API_KEY set: {data.deployment.secrets.internalApiKeySet ? "yes" : "no"}).
        </p>
      </div>

      {data.duplicateSyncWarning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Possible duplicate sync workers</p>
            <p className="mt-0.5">{data.duplicateSyncWarning}</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold">Sync / automation workers</h3>
        <ul className="space-y-1.5">
          {data.syncWorkers.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-2 text-xs">
              <span>{w.label}</span>
              <Badge variant="outline" className={w.enabled ? "text-emerald-700 border-emerald-200" : "text-muted-foreground"}>
                {w.enabled ? "ON" : "OFF"}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
        Storage paths are managed in care-pacs — not editable here.
        Live MWL: <code className="font-mono">{data.deployment.orthancWorklistDir ?? "—"}</code>
        {" · "}Staging: <code className="font-mono">{data.deployment.stagingDir ?? "—"}</code>
      </div>
    </div>
  );
}
