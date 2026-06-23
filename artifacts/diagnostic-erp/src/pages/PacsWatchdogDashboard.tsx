import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle,
  Clock, RotateCcw, Server, Cpu, Zap, RadioTower, Database,
  CheckCircle2, XCircle, Settings, HeartPulse, HardDrive,
} from "lucide-react";

interface WatchdogService {
  id: number;
  serviceName: string;
  displayName: string;
  status: string;
  lastHeartbeat: string | null;
  lastError: string | null;
  restartCount: number;
  maxRestarts: number;
  autoRestartEnabled: boolean;
  consecutiveFailures: number;
  checkIntervalSeconds: number;
  nextCheckAt: string | null;
  metadata: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  healthy:    { icon: <CheckCircle2 className="h-4 w-4" />, color: "text-green-700",    bg: "bg-green-50 border-green-200" },
  degraded:   { icon: <AlertTriangle className="h-4 w-4" />, color: "text-amber-700",   bg: "bg-amber-50 border-amber-200" },
  down:       { icon: <XCircle className="h-4 w-4" />,      color: "text-red-700",      bg: "bg-red-50 border-red-200" },
  restarting: { icon: <RotateCcw className="h-4 w-4 animate-spin" />, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  unknown:    { icon: <Clock className="h-4 w-4" />,        color: "text-slate-700",    bg: "bg-slate-50 border-slate-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon} {status}
    </span>
  );
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  dicom_pull_agent: <RadioTower className="h-4 w-4" />,
  pacs_bridge: <Server className="h-4 w-4" />,
  ai_worker: <Cpu className="h-4 w-4" />,
  conquest_sync: <Database className="h-4 w-4" />,
  orthanc_sync: <Database className="h-4 w-4" />,
  hl7_bridge: <HeartPulse className="h-4 w-4" />,
  report_delivery: <Zap className="h-4 w-4" />,
  storage_monitor: <HardDrive className="h-4 w-4" />,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "Never";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch { return iso; }
}

export function WatchdogPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{
    services: WatchdogService[];
    downCount: number;
    healthyCount: number;
  }>({
    queryKey: ["pacs-watchdog"],
    queryFn: () => api.get(`/api/radiology/watchdog`),
    refetchInterval: 15_000,
  });

  const services = data?.services ?? [];
  const downCount = data?.downCount ?? 0;
  const healthyCount = data?.healthyCount ?? 0;

  const toggleAutoRestart = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      return api.patch(`/api/radiology/watchdog/${id}/toggle-restart`, { autoRestartEnabled: enabled });
    },
    onSuccess: () => {
      toast({ title: "Setting updated" });
      void qc.invalidateQueries({ queryKey: ["pacs-watchdog"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    },
  });

  const restartService = useMutation({
    mutationFn: async (id: number) => api.post(`/api/radiology/watchdog/${id}/restart`, {}),
    onSuccess: () => {
      toast({ title: "Restart signal sent" });
      void qc.invalidateQueries({ queryKey: ["pacs-watchdog"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Total Services</span>
          <span className="text-xl font-bold">{services.length}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Healthy</span>
          <span className="text-xl font-bold text-green-700">{healthyCount}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Down / Degraded</span>
          <span className={`text-xl font-bold ${downCount > 0 ? "text-red-700" : ""}`}>{downCount}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Total Restarts</span>
          <span className="text-xl font-bold">{services.reduce((s, svc) => s + svc.restartCount, 0)}</span>
        </div>
      </div>

      {/* Services list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Server className="h-12 w-12" />
          <p className="text-base font-semibold">No watchdog services registered</p>
          <p className="text-sm max-w-md text-center">Services will appear once they begin sending heartbeats to /api/radiology/watchdog/:service/heartbeat</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {services.map((svc) => {
            const isDown = svc.status === "down" || svc.consecutiveFailures > 3;
            const meta = (() => { try { return JSON.parse(svc.metadata); } catch { return {}; } })();
            return (
              <div key={svc.id} className={`rounded-lg border p-4 flex flex-col gap-3 ${isDown ? "border-red-300 bg-red-50/30" : ""}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {SERVICE_ICONS[svc.serviceName] ?? <Server className="h-4 w-4" />}
                    <span className="font-semibold text-sm">{svc.displayName}</span>
                  </div>
                  <StatusBadge status={svc.status} />
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Last heartbeat:</span>
                  <span className="text-right font-medium">{fmtDate(svc.lastHeartbeat)}</span>
                  <span className="text-muted-foreground">Consecutive failures:</span>
                  <span className={`text-right font-medium ${svc.consecutiveFailures > 2 ? "text-red-700" : ""}`}>{svc.consecutiveFailures}</span>
                  <span className="text-muted-foreground">Restarts:</span>
                  <span className="text-right font-medium">{svc.restartCount} / {svc.maxRestarts}</span>
                  <span className="text-muted-foreground">Check interval:</span>
                  <span className="text-right font-medium">{svc.checkIntervalSeconds}s</span>
                </div>

                {svc.lastError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 truncate" title={svc.lastError}>
                    <AlertTriangle className="h-3 w-3 inline mr-1" />{svc.lastError}
                  </div>
                )}

                {Object.keys(meta).length > 0 && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
                    {Object.entries(meta).slice(0, 3).map(([k, v]) => (
                      <span key={k} className="mr-2">{k}: <span className="font-mono font-medium">{String(v)}</span></span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t">
                  <div className="flex items-center gap-2 text-xs">
                    <Switch
                      id={`ar-${svc.id}`}
                      checked={svc.autoRestartEnabled}
                      onCheckedChange={(v) => toggleAutoRestart.mutate({ id: svc.id, enabled: v })}
                      disabled={toggleAutoRestart.isPending}
                    />
                    <label htmlFor={`ar-${svc.id}`} className="cursor-pointer">Auto-restart</label>
                  </div>
                  <Button
                    size="sm"
                    variant={isDown ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => restartService.mutate(svc.id)}
                    disabled={restartService.isPending}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" /> Restart
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Settings className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">Watchdog: </span>
          Each background service sends a heartbeat to <code className="font-mono bg-white/50 px-1 rounded">POST /api/radiology/watchdog/:service/heartbeat</code> every N seconds.
          After 3 consecutive missed heartbeats, the service is marked DOWN. If auto-restart is enabled, a restart signal is triggered.
          Configure check intervals and max restarts per service.
        </div>
      </div>
    </div>
  );
}

export default function PacsWatchdogDashboard() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Watchdog Dashboard" subtitle="Background service health monitoring and auto-restart control" />
      <WatchdogPanel />
    </div>
  );
}
