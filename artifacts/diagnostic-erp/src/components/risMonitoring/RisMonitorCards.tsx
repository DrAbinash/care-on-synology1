/**
 * RIS/PACS Production Hardening Cards — Phase 11
 * 10 monitoring features: acquisition, retry, storage, backup,
 * downtime, audit, delivery, escalation, daily ops, health watchdog.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Monitor, RotateCw, HardDrive, ShieldAlert, WifiOff, FileSearch,
  Send, AlertTriangle, BarChart3, Activity, Download, Eye,
  Printer, CheckCircle, XCircle, Clock, Server, Database,
  Wifi, Zap, ArrowUpCircle,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function CardFrame({ title, icon, badge, children, className = "" }: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card shadow-sm ${className}`}>
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon} {title}
        </div>
        {badge}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatBadge({ label, value, variant = "default" }: {
  label: string; value: React.ReactNode; variant?: "default" | "success" | "warn" | "danger";
}) {
  const cls = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-green-100 text-green-700",
    warn: "bg-yellow-100 text-yellow-700",
    danger: "bg-red-100 text-red-700",
  }[variant];
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${cls}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

// ── 1. Acquisition Monitor ────────────────────────────────────────────────────────────────────────────────────

export function AcquisitionMonitorCard() {
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "acquisition"],
    queryFn: () => api.get("/api/ris-monitor/acquisition"),
    refetchInterval: 30_000,
  });
  const agents = data?.agents ?? [];
  const machines = data?.machines ?? [];
  const failed = data?.failedTransfersToday ?? 0;

  return (
    <CardFrame title="Acquisition Monitor" icon={<Monitor size={14} />} badge={failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {agents.map((a: any) => (
            <div key={a.id} className="rounded border p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{a.agentName}</span>
                <Badge variant={a.isOnline ? "outline" : "destructive"} className="text-[10px]">{a.isOnline ? "Online" : "Offline"}</Badge>
              </div>
              <div className="text-muted-foreground mt-1">Last: {formatDate(a.lastHeartbeatAt)}</div>
              <div className="text-muted-foreground">Studies: {a.studiesPulledToday} pulled today</div>
            </div>
          ))}
          {agents.length === 0 && <span className="text-muted-foreground text-xs">No agents reporting</span>}
        </div>
        <div className="text-xs font-semibold text-muted-foreground">Machines</div>
        <div className="grid grid-cols-2 gap-2">
          {machines.map((m: any) => (
            <div key={m.id} className="rounded border p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{m.machineName}</span>
                <Badge variant={m.lastConnectionStatus === "online" ? "outline" : "destructive"} className="text-[10px]">{m.lastConnectionStatus ?? "unknown"}</Badge>
              </div>
              <div className="text-muted-foreground mt-1">{m.modality ?? "?"} • {m.aeTitle ?? "—"}</div>
              <div className="text-muted-foreground">Seen: {formatDate(m.lastSeenAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </CardFrame>
  );
}

// ── 2. Auto Retry Queue ────────────────────────────────────────────────────────────────────────────────────────

export function RetryQueueCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any[]>({
    queryKey: ["ris-monitor", "retry-queue"],
    queryFn: () => api.get("/api/ris-monitor/retry-queue"),
    refetchInterval: 30_000,
  });
  const retryMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/ris-monitor/retry-queue/${id}/retry`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ris-monitor", "retry-queue"] }); toast({ title: "Retry queued" }); },
  });
  const abandonMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/ris-monitor/retry-queue/${id}/abandon`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ris-monitor", "retry-queue"] }); toast({ title: "Abandoned" }); },
  });

  const rows = data ?? [];
  const pendingCount = rows.filter((r: any) => ["pending", "retrying"].includes(r.status)).length;

  return (
    <CardFrame title="Auto Retry Queue" icon={<RotateCw size={14} />} badge={pendingCount > 0 ? <Badge variant="destructive">{pendingCount} pending</Badge> : <Badge variant="outline" className="text-[10px]">Clear</Badge>}>
      <div className="max-h-52 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-xs"><TableHead>Op</TableHead><TableHead>Entity</TableHead><TableHead>Status</TableHead><TableHead>Retry</TableHead><TableHead>Reason</TableHead><TableHead>Action</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 10).map((r: any) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="font-mono">{r.operationType}</TableCell>
                <TableCell>{r.entityType} #{r.entityId}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{r.status}</Badge></TableCell>
                <TableCell>{r.retryCount}/{r.maxRetries}</TableCell>
                <TableCell className="max-w-[120px] truncate">{r.failureReason ?? r.errorDetailsJson ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {r.status !== "success" && <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => retryMut.mutate(r.id)}><RotateCw size={10} /></Button>}
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => abandonMut.mutate(r.id)}><XCircle size={10} /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center text-xs">Queue empty</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </CardFrame>
  );
}

// ── 3. Storage Dashboard ───────────────────────────────────────────────────────────────────────────────────────

export function StorageDashboardCard() {
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "storage"],
    queryFn: () => api.get("/api/ris-monitor/storage"),
    refetchInterval: 60_000,
  });
  const byMod = data?.byModality ?? [];
  const latest = data?.latestSnapshot;
  const alert = latest?.alertTriggered ?? false;

  const fmtGb = (b: number) => b ? `${(b / 1e9).toFixed(1)} GB` : "—";

  return (
    <CardFrame title="Storage Dashboard" icon={<HardDrive size={14} />} badge={alert ? <Badge variant="destructive">Threshold alert</Badge> : <Badge variant="outline" className="text-[10px]">Healthy</Badge>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <StatBadge label="Studies" value={data?.totalStudies ?? 0} />
          <StatBadge label="Images" value={data?.totalImages ?? 0} />
          <StatBadge label="Today" value={data?.studiesToday ?? 0} />
        </div>
        {latest && (
          <div className="rounded border p-2 text-xs space-y-1">
            <div className="flex justify-between"><span>Used</span><span className="font-mono">{fmtGb(latest.totalBytesUsed)}</span></div>
            <div className="flex justify-between"><span>Archive</span><span className="font-mono">{fmtGb(latest.archiveBytes)}</span></div>
            <div className="flex justify-between"><span>Hot</span><span className="font-mono">{fmtGb(latest.hotStorageBytes)}</span></div>
            <div className="flex justify-between"><span>Threshold</span><span className="font-mono">{latest.thresholdPercent}%</span></div>
          </div>
        )}
        <div className="text-xs font-semibold text-muted-foreground">By Modality</div>
        <div className="grid grid-cols-2 gap-1">
          {byMod.map((m: any) => (
            <div key={m.modality} className="rounded border p-1.5 text-xs flex justify-between">
              <span>{m.modality}</span>
              <span className="font-mono">{m.count} / {m.images} img</span>
            </div>
          ))}
        </div>
      </div>
    </CardFrame>
  );
}

// ── 4. Backup Verification ─────────────────────────────────────────────────────────────────────────────────────

export function BackupVerificationCard() {
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "backup"],
    queryFn: () => api.get("/api/ris-monitor/backup"),
    refetchInterval: 120_000,
  });
  const backupLogs = data?.backupLogs ?? [];
  const verifications = data?.verifications ?? [];
  const latest = backupLogs[0];
  const latestVer = verifications[0];
  const stale = latest && new Date().getTime() - new Date(latest.createdAt).getTime() > 86400000;

  return (
    <CardFrame title="Backup Verification" icon={<ShieldAlert size={14} />} badge={stale ? <Badge variant="destructive">Stale</Badge> : <Badge variant="outline" className="text-[10px]">OK</Badge>}>
      <div className="space-y-3">
        {latest && (
          <div className="rounded border p-2 text-xs space-y-1">
            <div className="flex justify-between"><span>Type</span><span className="font-semibold">{latest.backupType}</span></div>
            <div className="flex justify-between"><span>Status</span><Badge variant={latest.status === "success" ? "outline" : "destructive"} className="text-[10px]">{latest.status}</Badge></div>
            <div className="flex justify-between"><span>Size</span><span className="font-mono">{((latest.sizeBytes ?? 0) / 1e6).toFixed(1)} MB</span></div>
            <div className="flex justify-between"><span>Rows</span><span className="font-mono">{latest.rowCount ?? 0}</span></div>
            <div className="flex justify-between"><span>At</span><span>{formatDate(latest.createdAt)}</span></div>
          </div>
        )}
        {latestVer && (
          <div className="rounded border p-2 text-xs space-y-1">
            <div className="flex justify-between"><span>Restore Test</span><Badge variant={latestVer.restoreTestStatus === "pass" ? "outline" : latestVer.restoreTestStatus === "fail" ? "destructive" : "secondary"} className="text-[10px]">{latestVer.restoreTestStatus}</Badge></div>
            <div className="flex justify-between"><span>Verified</span><span>{formatDate(latestVer.restoreTestedAt)}</span></div>
          </div>
        )}
        {!latest && <div className="text-xs text-muted-foreground">No backup logs yet.</div>}
      </div>
    </CardFrame>
  );
}

// ── 5. Downtime Mode ───────────────────────────────────────────────────────────────────────────────────────────────

export function DowntimeModeCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any[]>({
    queryKey: ["ris-monitor", "downtime-pending"],
    queryFn: () => api.get("/api/ris-monitor/downtime/pending"),
    refetchInterval: 30_000,
  });
  const { data: conflicts } = useQuery<any[]>({
    queryKey: ["ris-monitor", "downtime-conflicts"],
    queryFn: () => api.get("/api/ris-monitor/downtime/conflicts"),
    refetchInterval: 30_000,
  });
  const resolveMut = useMutation({
    mutationFn: ({ id, strategy }: { id: number; strategy: string }) => api.post("/api/ris-monitor/downtime/resolve", { queueId: id, strategy }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ris-monitor"] }); toast({ title: "Resolved" }); },
  });

  const pending = data ?? [];
  const conflictCount = (conflicts ?? []).length;

  return (
    <CardFrame title="Downtime Mode" icon={<WifiOff size={14} />} badge={pending.length > 0 ? <Badge variant="destructive">{pending.length} pending</Badge> : <Badge variant="outline" className="text-[10px]">Online</Badge>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <StatBadge label="Pending Sync" value={pending.length} variant={pending.length > 0 ? "warn" : "success"} />
          <StatBadge label="Conflicts" value={conflictCount} variant={conflictCount > 0 ? "danger" : "success"} />
        </div>
        <div className="max-h-40 overflow-auto text-xs">
          {pending.slice(0, 8).map((r: any) => (
            <div key={r.id} className="rounded border p-2 mb-1 flex justify-between items-center">
              <div>
                <div className="font-semibold">{r.action} {r.tableName}</div>
                <div className="text-muted-foreground">ID {r.localId} • {formatDate(r.createdAt)}</div>
              </div>
              {r.syncResult && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-5 text-[10px]" onClick={() => resolveMut.mutate({ id: r.id, strategy: "server_wins" })}>Server</Button>
                  <Button size="sm" variant="outline" className="h-5 text-[10px]" onClick={() => resolveMut.mutate({ id: r.id, strategy: "local_wins" })}>Local</Button>
                </div>
              )}
            </div>
          ))}
          {pending.length === 0 && <div className="text-muted-foreground text-center py-2">No pending offline changes</div>}
        </div>
      </div>
    </CardFrame>
  );
}

// ── 6. Audit Export ────────────────────────────────────────────────────────────────────────────────────────────

export function AuditExportCard() {
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [user, setUser] = useState("");
  const [rows, setRows] = useState<any[]>([]);

  const fetchAudit = async () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (user) params.set("user", user);
    const data = await api.get(`/api/ris-monitor/audit-export?${params.toString()}`) as any;
    setRows(data.rows ?? []);
  };

  // /api/ris-monitor/audit-export is staff-authed — window.open(url) can
  // never carry the Authorization header, so this always 401'd instead of
  // downloading the CSV.
  const downloadCsv = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (user) params.set("user", user);
    params.set("format", "csv");
    void api.downloadFile(`/api/ris-monitor/audit-export?${params.toString()}`, "audit-export.csv").catch((err) => {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    });
  };

  return (
    <CardFrame title="Audit Export" icon={<FileSearch size={14} />}>
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Input type="date" className="h-7 text-xs" value={from} onChange={e => setFrom(e.target.value)} />
          <Input type="date" className="h-7 text-xs" value={to} onChange={e => setTo(e.target.value)} />
          <Input placeholder="User" className="h-7 text-xs" value={user} onChange={e => setUser(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs" onClick={fetchAudit}><Eye size={12} /> Preview</Button>
          <Button size="sm" variant="outline" className="text-xs" onClick={downloadCsv}><Download size={12} /> CSV</Button>
        </div>
        <div className="max-h-40 overflow-auto text-xs">
          {rows.slice(0, 10).map((r: any) => (
            <div key={r.id} className="rounded border p-2 mb-1">
              <div className="flex justify-between"><span className="font-semibold">{r.action}</span><span className="text-muted-foreground">{formatDate(r.createdAt)}</span></div>
              <div className="text-muted-foreground">{r.actorName} • {r.actorRole}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-muted-foreground text-center py-2">No results</div>}
        </div>
      </div>
    </CardFrame>
  );
}

// ── 7. Report Delivery Tracking ────────────────────────────────────────────────────────────────────────────────────────

export function DeliveryTrackingCard() {
  const { data } = useQuery<any[]>({
    queryKey: ["ris-monitor", "delivery"],
    queryFn: () => api.get("/api/ris-monitor/delivery"),
    refetchInterval: 60_000,
  });
  const rows = data ?? [];
  const failed = rows.filter((r: any) => r.whatsappStatus === "failed" || r.printStatus === "failed").length;

  return (
    <CardFrame title="Report Delivery" icon={<Send size={14} />} badge={failed > 0 ? <Badge variant="destructive">{failed} failed</Badge> : <Badge variant="outline" className="text-[10px]">All clear</Badge>}>
      <div className="max-h-52 overflow-auto text-xs">
        <Table>
          <TableHeader><TableRow className="text-xs"><TableHead>Report</TableHead><TableHead>WhatsApp</TableHead><TableHead>Print</TableHead><TableHead>Portal</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.slice(0, 10).map((r: any) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell>#{r.reportDraftId}</TableCell>
                <TableCell>
                  {r.whatsappStatus === "delivered" ? <CheckCircle size={12} className="text-green-600 inline" /> :
                   r.whatsappStatus === "failed" ? <XCircle size={12} className="text-red-600 inline" /> :
                   <Clock size={12} className="text-muted-foreground inline" />}
                </TableCell>
                <TableCell>
                  {r.printStatus === "printed" ? <Printer size={12} className="text-green-600 inline" /> :
                   r.printStatus === "failed" ? <XCircle size={12} className="text-red-600 inline" /> :
                   <Clock size={12} className="text-muted-foreground inline" />}
                </TableCell>
                <TableCell>
                  {r.portalViewCount > 0 ? <Eye size={12} className="text-blue-600 inline" /> : <span className="text-muted-foreground">—</span>}
                  {r.portalViewCount > 0 && <span className="ml-1">{r.portalViewCount}</span>}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center">No tracking records</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </CardFrame>
  );
}

// ── 8. Critical Result Escalation ─────────────────────────────────────────────────────────────────────────────────────────

export function CriticalEscalationCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "critical-escalation"],
    queryFn: () => api.get("/api/ris-monitor/critical-escalation"),
    refetchInterval: 30_000,
  });
  const ackMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/ris-monitor/critical-escalation/${id}/acknowledge`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ris-monitor", "critical-escalation"] }); toast({ title: "Acknowledged" }); },
  });
  const escMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/ris-monitor/critical-escalation/${id}/escalate`, { escalatedTo: "Head Radiologist", escalatedToRole: "head", notificationMethod: "phone" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ris-monitor", "critical-escalation"] }); toast({ title: "Escalated" }); },
  });

  const open = (data?.openFindings ?? []).slice(0, 6);
  const esc = (data?.openEscalations ?? []).slice(0, 4);

  return (
    <CardFrame title="Critical Escalation" icon={<AlertTriangle size={14} />} badge={open.length > 0 ? <Badge variant="destructive">{open.length} open</Badge> : <Badge variant="outline" className="text-[10px]">Clear</Badge>}>
      <div className="space-y-3 text-xs">
        {open.map((f: any) => (
          <div key={f.id} className="rounded border p-2 border-l-4 border-l-red-500">
            <div className="flex justify-between"><span className="font-semibold">{f.finding}</span><Badge variant="destructive" className="text-[10px]">{f.severity}</Badge></div>
            <div className="text-muted-foreground mt-1">{f.category} • Study #{f.studyId}</div>
            <div className="flex gap-1 mt-2">
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => ackMut.mutate(f.id)}><CheckCircle size={10} /> Ack</Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => escMut.mutate(f.id)}><ArrowUpCircle size={10} /> Escalate</Button>
            </div>
          </div>
        ))}
        {esc.length > 0 && (
          <div className="text-muted-foreground font-semibold mt-2">Active Escalations</div>
        )}
        {esc.map((e: any) => (
          <div key={e.id} className="rounded border p-2 border-l-2 border-l-orange-500">
            <div className="flex justify-between"><span>Lvl {e.escalationLevel} → {e.escalatedTo}</span><Badge className="text-[10px]">{e.resolutionStatus}</Badge></div>
            <div className="text-muted-foreground">{formatDate(e.escalatedAt)}</div>
          </div>
        ))}
        {open.length === 0 && <div className="text-muted-foreground text-center py-2">No unacknowledged critical findings</div>}
      </div>
    </CardFrame>
  );
}

// ── 9. Daily Operations Dashboard ─────────────────────────────────────────────────────────────────────────────────────────────

export function DailyOpsDashboardCard() {
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "daily-ops"],
    queryFn: () => api.get("/api/ris-monitor/daily-ops"),
    refetchInterval: 30_000,
  });

  return (
    <CardFrame title="Daily Operations" icon={<BarChart3 size={14} />} badge={<span className="text-[10px] text-muted-foreground">{data?.date}</span>}>
      <div className="grid grid-cols-2 gap-2">
        <StatBadge label="Studies" value={data?.studiesReceived ?? 0} />
        <StatBadge label="Pending" value={data?.reportsPending ?? 0} variant={data?.reportsPending > 5 ? "warn" : "default"} />
        <StatBadge label="Finalized" value={data?.reportsFinalized ?? 0} variant="success" />
        <StatBadge label="Critical" value={data?.criticalAlerts ?? 0} variant={data?.criticalAlerts > 0 ? "danger" : "success"} />
        <StatBadge label="Failed Xfers" value={data?.failedTransfers ?? 0} variant={data?.failedTransfers > 0 ? "warn" : "success"} />
        <StatBadge label="Retries" value={data?.pendingRetries ?? 0} variant={data?.pendingRetries > 0 ? "warn" : "success"} />
        <StatBadge label="Backup" value={data?.backupStatus === "success" ? "OK" : "Fail"} variant={data?.backupStatus === "success" ? "success" : "danger"} />
        <StatBadge label="Avg TAT" value={data?.avgReportTatMinutes != null ? `${data.avgReportTatMinutes}m` : "—"} />
      </div>
    </CardFrame>
  );
}

// ── 10. System Health Watchdog ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SystemHealthWatchdogCard() {
  const { data } = useQuery<any>({
    queryKey: ["ris-monitor", "health"],
    queryFn: () => api.get("/api/ris-monitor/health"),
    refetchInterval: 15_000,
  });
  const live = data?.liveChecks ?? {};
  const snapshot = data?.snapshot;
  const uptime = data?.uptime ? `${Math.floor(data.uptime / 60)}m` : "—";

  const svc = [
    { key: "api", label: "API", icon: <Server size={12} /> },
    { key: "db", label: "Database", icon: <Database size={12} /> },
    { key: "pacs", label: "PACS", icon: <HardDrive size={12} /> },
    { key: "aiService", label: "AI Service", icon: <Zap size={12} /> },
    { key: "frontend", label: "Frontend", icon: <Monitor size={12} /> },
  ];

  return (
    <CardFrame title="Health Watchdog" icon={<Activity size={14} />} badge={<Badge variant="outline" className="text-[10px]">Uptime {uptime}</Badge>}>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {svc.map(s => {
            const status = live[s.key] ?? "ok";
            const variant = status === "ok" ? "success" : status === "degraded" ? "warn" : "danger";
            return (
              <div key={s.key} className={`rounded border p-2 text-xs flex items-center gap-2 ${variant === "success" ? "border-green-200" : variant === "warn" ? "border-yellow-200" : "border-red-200"}`}>
                {s.icon}
                <span className="font-semibold">{s.label}</span>
                <Badge variant={status === "ok" ? "outline" : "destructive"} className="text-[10px] ml-auto">{status}</Badge>
              </div>
            );
          })}
        </div>
        {snapshot && (
          <div className="rounded border p-2 text-xs space-y-1">
            <div className="flex justify-between"><span>Disk</span><span className="font-mono">{snapshot.diskUsagePercent}%</span></div>
            <div className="flex justify-between"><span>Memory</span><span className="font-mono">{snapshot.memoryUsagePercent}%</span></div>
            <div className="flex justify-between"><span>Snapshot</span><span>{formatDate(snapshot.snapshotAt)}</span></div>
          </div>
        )}
      </div>
    </CardFrame>
  );
}

// ── Master Grid ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function RisMonitorCommandGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <DailyOpsDashboardCard />
      <SystemHealthWatchdogCard />
      <AcquisitionMonitorCard />
      <RetryQueueCard />
      <CriticalEscalationCard />
      <DeliveryTrackingCard />
      <StorageDashboardCard />
      <BackupVerificationCard />
      <DowntimeModeCard />
      <AuditExportCard />
    </div>
  );
}
