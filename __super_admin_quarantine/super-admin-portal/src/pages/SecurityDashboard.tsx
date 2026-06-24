import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Shield, Activity, Users, Lock, AlertTriangle,
  CheckCircle2, XCircle, Clock, HardDrive, Database, Search,
  Trash2, RefreshCw, ChevronLeft, ChevronRight, Unlock,
  Download, ShieldCheck,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface PortalSession {
  id: number;
  token: string;
  scope: string;
  subjectId: number;
  subjectName: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActivityAt: string;
  createdAt: string;
}

interface BackupJob {
  id: number;
  jobName: string;
  backupType: string;
  schedule: string;
  lastStatus: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
}

interface BackupLog {
  id: number;
  jobId: number;
  status: string;
  completedAt: string | null;
  rowCount: number | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  notes: string | null;
  encrypted: boolean | null;
}

interface AuditSummaryRow {
  action: string;
  count: number;
}

interface LockedAccount {
  id: number;
  name: string;
  email: string;
  username: string | null;
  role: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

interface ExportAuditEvent {
  id: number;
  userName: string;
  role: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface SecurityData {
  sessions: { sessions: PortalSession[]; total: number };
  failedLogins: { events: { id: number; userName: string; ipAddress: string | null; createdAt: string; reason: string | null }[]; total: number };
  backupStatus: { jobs: BackupJob[]; recentLogs: BackupLog[] };
  auditSummary: { since: string; summary: AuditSummaryRow[] };
  lockedAccounts: { accounts: LockedAccount[] };
  dataExports: { since: string; exports: ExportAuditEvent[] };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function SecurityDashboard({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [killSession, setKillSession] = useState<PortalSession | null>(null);
  const [activeTab, setActiveTab] = useState<"sessions" | "backups" | "logins" | "locked" | "exports">("sessions");

  const { data, isLoading } = useQuery<SecurityData>({
    queryKey: ["security-dashboard"],
    queryFn: async () => {
      const [sessions, failedLogins, backupStatus, auditSummary, lockedAccounts, dataExports] = await Promise.all([
        fetch("/api/super-admin/security/sessions", { headers: saAuthHeaders() }).then(r => r.json()),
        fetch("/api/super-admin/security/failed-logins", { headers: saAuthHeaders() }).then(r => r.json()),
        fetch("/api/super-admin/security/backup-status", { headers: saAuthHeaders() }).then(r => r.json()),
        fetch("/api/super-admin/security/audit-summary", { headers: saAuthHeaders() }).then(r => r.json()),
        fetch("/api/super-admin/security/locked-accounts", { headers: saAuthHeaders() }).then(r => r.json()),
        fetch("/api/super-admin/security/data-exports", { headers: saAuthHeaders() }).then(r => r.json()),
      ]);
      return { sessions, failedLogins, backupStatus, auditSummary, lockedAccounts, dataExports };
    },
    refetchInterval: 30_000,
  });

  const killMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/security/sessions/${id}`, {
        method: "DELETE",
        headers: saAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to terminate session");
    },
    onSuccess: () => {
      toast({ title: "Session terminated" });
      setKillSession(null);
      void queryClient.invalidateQueries({ queryKey: ["security-dashboard"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/security/unlock-account/${id}`, {
        method: "POST",
        headers: saAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to unlock account");
    },
    onSuccess: () => {
      toast({ title: "Account unlocked" });
      void queryClient.invalidateQueries({ queryKey: ["security-dashboard"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const statusBadge = (status: string) => {
    if (status === "success" || status === "active") return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">{status}</Badge>;
    if (status === "failed") return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">{status}</Badge>;
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">{status}</Badge>;
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Security Dashboard</h1>
            <p className="text-sm text-muted-foreground">Sessions, backups, audit trail, failed logins, locked accounts, and data exports.</p>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Users size={13} /> Active Sessions
            </div>
            <p className="text-2xl font-bold">{data?.sessions.total ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Staff + patient tokens</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <AlertTriangle size={13} /> Failed Logins (24h)
            </div>
            <p className="text-2xl font-bold">{data?.failedLogins.total ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">From audit trail</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <HardDrive size={13} /> Backup Jobs
            </div>
            <p className="text-2xl font-bold">{data?.backupStatus.jobs.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.backupStatus.jobs.filter(j => j.isEnabled).length ?? 0} enabled
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Download size={13} /> Data Exports (30d)
            </div>
            <p className="text-2xl font-bold">{data?.dataExports.exports.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">CSV / XML / JSON</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Shield size={13} /> Audit Events (7d)
            </div>
            <p className="text-2xl font-bold">
              {data?.auditSummary.summary.reduce((s, r) => s + r.count, 0) ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Actions tracked</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-1">
          {(["sessions", "backups", "logins", "locked", "exports"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === t
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "sessions" && <span className="flex items-center gap-1.5"><Users size={13} /> Active Sessions</span>}
              {t === "backups" && <span className="flex items-center gap-1.5"><HardDrive size={13} /> Backups</span>}
              {t === "logins" && <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> Failed Logins</span>}
              {t === "locked" && <span className="flex items-center gap-1.5"><Lock size={13} /> Locked Accounts</span>}
              {t === "exports" && <span className="flex items-center gap-1.5"><Download size={13} /> Data Exports</span>}
            </button>
          ))}
        </div>

        {/* Sessions tab */}
        {activeTab === "sessions" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock size={14} className="text-primary" />
                Active Sessions
              </div>
              <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["security-dashboard"] })}>
                <RefreshCw size={13} className="mr-1" /> Refresh
              </Button>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading sessions…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.sessions.sessions || data.sessions.sessions.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No active sessions.</TableCell>
                      </TableRow>
                    )}
                    {data?.sessions.sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell><Badge variant="outline" className="capitalize">{s.scope}</Badge></TableCell>
                        <TableCell className="font-medium">{s.subjectName}</TableCell>
                        <TableCell className="font-mono text-xs">{s.ipAddress ?? "—"}</TableCell>
                        <TableCell className="text-xs">{formatDate(s.lastActivityAt)}</TableCell>
                        <TableCell className="text-xs">{formatDate(s.expiresAt)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={() => setKillSession(s)}>
                            <Trash2 size={13} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Backups tab */}
        {activeTab === "backups" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
                <HardDrive size={14} className="text-primary" />
                Backup Jobs
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Run</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.backupStatus.jobs || data.backupStatus.jobs.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No backup jobs configured.</TableCell>
                      </TableRow>
                    )}
                    {data?.backupStatus.jobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium">{j.jobName}</TableCell>
                        <TableCell><Badge variant="outline">{j.backupType}</Badge></TableCell>
                        <TableCell>{j.schedule}</TableCell>
                        <TableCell>{statusBadge(j.lastStatus ?? "unknown")}</TableCell>
                        <TableCell className="text-xs">{j.lastRunAt ? formatDate(j.lastRunAt) : "—"}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-[200px] truncate">{j.lastError ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
                <Database size={14} className="text-primary" />
                Recent Backup Logs
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Encrypted</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.backupStatus.recentLogs || data.backupStatus.recentLogs.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No recent backup logs.</TableCell>
                      </TableRow>
                    )}
                    {data?.backupStatus.recentLogs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{statusBadge(l.status)}</TableCell>
                        <TableCell>{l.rowCount?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell>{l.sizeBytes ? formatBytes(l.sizeBytes) : "—"}</TableCell>
                        <TableCell>{l.encrypted ? <ShieldCheck size={14} className="text-green-500" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs max-w-[300px] truncate">{l.notes ?? l.errorMessage ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.completedAt ? formatDate(l.completedAt) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {/* Failed logins tab */}
        {activeTab === "logins" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
              <AlertTriangle size={14} className="text-primary" />
              Failed Login Attempts (Last 24 Hours)
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.failedLogins.events || data.failedLogins.events.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No failed logins in the last 24 hours.</TableCell>
                      </TableRow>
                    )}
                    {data?.failedLogins.events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.userName}</TableCell>
                        <TableCell className="font-mono text-xs">{e.ipAddress ?? "—"}</TableCell>
                        <TableCell className="text-xs">{e.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Locked Accounts tab */}
        {activeTab === "locked" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock size={14} className="text-primary" />
                Locked &amp; Suspicious Accounts
              </div>
              <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["security-dashboard"] })}>
                <RefreshCw size={13} className="mr-1" /> Refresh
              </Button>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Failed Attempts</TableHead>
                      <TableHead>Locked Until</TableHead>
                      <TableHead className="w-[120px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.lockedAccounts.accounts || data.lockedAccounts.accounts.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No locked accounts.</TableCell>
                      </TableRow>
                    )}
                    {data?.lockedAccounts.accounts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.name}
                          <div className="text-xs text-muted-foreground">{a.email}{a.username ? ` / ${a.username}` : ""}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{a.role}</Badge></TableCell>
                        <TableCell>{a.failedLoginAttempts}</TableCell>
                        <TableCell className="text-xs">
                          {a.lockedUntil && new Date(a.lockedUntil) > new Date() ? (
                            <span className="text-destructive font-semibold">{formatDate(a.lockedUntil)}</span>
                          ) : (
                            <span className="text-muted-foreground">Not locked</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {(a.lockedUntil && new Date(a.lockedUntil) > new Date()) || a.failedLoginAttempts > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-green-600 h-8 w-8 p-0"
                              onClick={() => unlockMutation.mutate(a.id)}
                              disabled={unlockMutation.isPending}
                            >
                              <Unlock size={13} />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Data Exports tab */}
        {activeTab === "exports" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Download size={14} className="text-primary" />
                Data Exports (Last 30 Days)
              </div>
              <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["security-dashboard"] })}>
                <RefreshCw size={13} className="mr-1" /> Refresh
              </Button>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data?.dataExports.exports || data.dataExports.exports.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No data exports recorded in the last 30 days.</TableCell>
                      </TableRow>
                    )}
                    {data?.dataExports.exports.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{formatDate(e.createdAt)}</TableCell>
                        <TableCell className="font-medium">{e.userName}<br/><span className="text-xs text-muted-foreground capitalize">{e.role}</span></TableCell>
                        <TableCell><Badge variant="outline">{e.module}</Badge></TableCell>
                        <TableCell className="text-xs">{e.entityType}{e.entityId ? `: ${e.entityId}` : ""}</TableCell>
                        <TableCell className="text-xs max-w-xs truncate" title={e.reason ?? ""}>{e.reason ?? <span className="text-muted-foreground">-</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.ipAddress ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Audit Summary mini-chart */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium">
            <Shield size={14} className="text-primary" />
            Audit Summary (Last 7 Days)
          </div>
          {isLoading ? (
            <div className="text-center text-muted-foreground py-4">Loading audit summary…</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {data?.auditSummary.summary.map((row) => (
                <div key={row.action} className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground capitalize">{row.action}</span>
                  <span className="ml-2 font-bold">{row.count}</span>
                </div>
              ))}
              {(!data?.auditSummary.summary || data.auditSummary.summary.length === 0) && (
                <span className="text-sm text-muted-foreground">No audit events in the last 7 days.</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Kill session confirmation */}
      {/* Chain Integrity Check widget */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium">
          <Shield size={14} className="text-primary" />
          Audit Chain Integrity
        </div>
        <div className="flex items-center gap-3">
          <ChainVerifyButton />
        </div>
      </div>

      <Dialog open={!!killSession} onOpenChange={(o) => !o && setKillSession(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminate session?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will immediately invalidate the session for <strong>{killSession?.subjectName}</strong> ({killSession?.scope}). The user will be forced to log in again.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setKillSession(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => killSession && killMutation.mutate(killSession.id)} disabled={killMutation.isPending}>
              Terminate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChainVerifyButton() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ integrity: string; checked: number; brokenAt: number | null } | null>(null);
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/super-admin/security/verify-audit-chain", { method: "POST", headers: saAuthHeaders() });
      const data = await res.json();
      setResult(data);
      if (data.integrity === "ok") {
        toast({ title: "Audit chain verified", description: `${data.checked} entries checked — no tampering detected.` });
      } else {
        toast({ variant: "destructive", title: "Chain integrity broken!", description: `First mismatch at ID ${data.brokenAt}.` });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Verification failed", description: String(e) });
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={run} disabled={pending}>
        {pending ? <RefreshCw size={13} className="animate-spin mr-1" /> : <Shield size={13} className="mr-1" />}
        {pending ? "Verifying…" : "Verify Chain"}
      </Button>
      {result && (
        <Badge variant={result.integrity === "ok" ? "default" : "destructive"}>
          {result.integrity === "ok" ? <CheckCircle2 size={12} className="mr-1" /> : <XCircle size={12} className="mr-1" />}
          {result.integrity === "ok" ? `${result.checked} rows OK` : `Broken at #${result.brokenAt}`}
        </Badge>
      )}
    </>
  );
}
