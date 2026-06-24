import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Heart, Server, Database, Cpu, HardDrive, Clock, Globe,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, MemoryStick,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";

interface HealthStatus {
  database: string;
  redis: "connected" | "missing" | "error";
  queue: "running" | "disabled";
  uptimeSeconds: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  version: string;
  nodeVersion: string;
  platform: string;
  startedAt: string;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  if (!parts.length) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function StatusDot({ status }: { status: string }) {
  if (status === "connected" || status === "running" || status === "ok") {
    return <span className="inline-flex items-center gap-1.5 text-green-500"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />Healthy</span>;
  }
  if (status === "missing" || status === "disabled") {
    return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="w-2 h-2 rounded-full bg-muted-foreground" />Not configured</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-red-500"><span className="w-2 h-2 rounded-full bg-red-500" />Error</span>;
}

export default function SystemHealth({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, refetch } = useQuery<HealthStatus>({
    queryKey: ["/api/admin/system-health", now],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-health", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load system health");
      return res.json();
    },
    refetchInterval: 10000,
  });

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">System Health</h1>
              <p className="text-sm text-muted-foreground">Real-time status of infrastructure, memory, and queues.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void refetch(); toast({ title: "Refreshed" }); }}>
            <RefreshCw size={13} className="mr-1.5" />Refresh
          </Button>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
            Loading system health…
          </div>
        )}

        {data && (
          <>
            {/* Status row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                  <Database size={13} />PostgreSQL
                </div>
                <div className="text-sm"><StatusDot status={data.database} /></div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                  <Server size={13} />Redis
                </div>
                <div className="text-sm"><StatusDot status={data.redis} /></div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                  <Clock size={13} />Queue Worker
                </div>
                <div className="text-sm"><StatusDot status={data.queue} /></div>
              </div>
            </div>

            {/* Server info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Cpu size={14} className="text-primary" />Server Info
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">App Version</span>
                    <span className="font-mono">{data.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Node.js</span>
                    <span className="font-mono">{data.nodeVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Platform</span>
                    <span className="font-medium capitalize">{data.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Started</span>
                    <span>{new Date(data.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Uptime</span>
                    <span className="font-medium">{formatDuration(data.uptimeSeconds)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MemoryStick size={14} className="text-primary" />Memory Usage
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">RSS</span>
                    <span className="font-mono">{formatBytes(data.memory.rss)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heap Total</span>
                    <span className="font-mono">{formatBytes(data.memory.heapTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heap Used</span>
                    <span className="font-mono">{formatBytes(data.memory.heapUsed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">External</span>
                    <span className="font-mono">{formatBytes(data.memory.external)}</span>
                  </div>
                </div>
                {/* Memory bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Heap Used / Total</span>
                    <span>{Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, (data.memory.heapUsed / data.memory.heapTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Warnings */}
            {(data.redis === "error" || data.database === "error") && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">System Alert</p>
                  <p className="text-xs text-destructive/80 mt-1">
                    {data.database === "error" && "Database connection is unavailable. "}
                    {data.redis === "error" && "Redis connection is failing. "}
                    Check service status immediately.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
