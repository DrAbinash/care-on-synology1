import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fetchApi } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle, ArrowLeft, CheckCircle2, Clock, Plus, ShieldCheck,
  Activity, TrendingUp, FileText, History,
} from "lucide-react";

interface CriticalAlert {
  id: number; severity: string; findingType: string; description: string;
  patientName: string; patientId: number | null; accessionNumber: string;
  studyDescription: string | null; flaggedBy: string; flaggedById: number | null;
  status: string; acknowledged: boolean; acknowledgedBy: string | null; acknowledgedAt: string | null;
  resolvedAt: string | null; createdAt: string;
}

interface Productivity {
  windowDays: number;
  reports: { drafts: number; pending: number; verified: number; finalized: number; amended: number; total: number };
  measurements: { approved: number; pending: number; rejected: number };
  doppler: { approved: number; pending: number };
  criticalAlerts: number;
  perUser: Array<{ userName: string; finalizedCount: number; openCount: number; avgTatMinutes: number | null }>;
}

interface AuditRow {
  id: number; entityType: string; entityId: number | null; action: string;
  performedBy: string; performedByRole: string | null;
  studyInstanceUID: string | null; patientId: number | null;
  details: string; createdAt: string;
}

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high:     "bg-orange-100 text-orange-800 border-orange-200",
  medium:   "bg-amber-100 text-amber-800 border-amber-200",
  low:      "bg-yellow-100 text-yellow-800 border-yellow-200",
};

export default function UsgCriticalAlerts() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"alerts" | "productivity" | "audit">("alerts");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    patientName: "", patientId: "", accessionNumber: "",
    findingType: "", severity: "high", description: "",
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<CriticalAlert[]>({
    queryKey: ["usg-critical-alerts", "all"],
    queryFn: () => fetchApi("/api/usg-critical/alerts"),
    refetchInterval: 60_000,
  });

  const { data: productivity, isLoading: prodLoading } = useQuery<Productivity>({
    queryKey: ["usg-productivity", 7],
    queryFn: () => fetchApi("/api/usg-critical/productivity?days=7"),
    refetchInterval: 120_000,
  });

  const { data: audit = [], isLoading: auditLoading } = useQuery<AuditRow[]>({
    queryKey: ["usg-audit"],
    queryFn: () => fetchApi("/api/usg-critical/audit?limit=100"),
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      fetchApi("/api/usg-critical/alerts", { method: "POST", body: JSON.stringify({
        patientName:      body.patientName,
        patientId:        body.patientId ? Number(body.patientId) : undefined,
        accessionNumber:  body.accessionNumber,
        findingType:      body.findingType,
        severity:         body.severity,
        description:      body.description,
      }) }),
    onSuccess: () => {
      toast({ title: "Critical alert flagged" });
      setShowCreate(false);
      setForm({ patientName: "", patientId: "", accessionNumber: "", findingType: "", severity: "high", description: "" });
      void qc.invalidateQueries({ queryKey: ["usg-critical-alerts"] });
    },
    onError: () => toast({ title: "Failed to flag alert", variant: "destructive" }),
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/usg-critical/alerts/${id}/acknowledge`, { method: "POST", body: "{}" }),
    onSuccess: () => { toast({ title: "Acknowledged" }); void qc.invalidateQueries({ queryKey: ["usg-critical-alerts"] }); },
  });
  const resolveMutation = useMutation({
    mutationFn: (id: number) => fetchApi(`/api/usg-critical/alerts/${id}/resolve`, { method: "POST", body: "{}" }),
    onSuccess: () => { toast({ title: "Resolved" }); void qc.invalidateQueries({ queryKey: ["usg-critical-alerts"] }); },
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="USG Critical Alerts & Productivity"
        subtitle="Flag critical findings, monitor TAT, productivity, and the full audit trail"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/usg")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> USG Dashboard
            </Button>
            {tab === "alerts" && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-1" /> Flag Critical
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-1 border-b border-border">
        {([
          { id: "alerts",       label: "Critical Alerts",   icon: AlertCircle },
          { id: "productivity", label: "Productivity (7d)", icon: TrendingUp },
          { id: "audit",        label: "Audit Log",         icon: History },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "alerts" && (
        <div className="space-y-3">
          {showCreate && (
            <Card className="border-red-200/60 bg-red-50/30 dark:bg-red-950/10">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" /> Flag a Critical USG Finding
                </CardTitle>
                <CardDescription>The clinician on duty will be notified.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5"><Label>Patient Name *</Label>
                    <Input value={form.patientName} onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Patient ID</Label>
                    <Input value={form.patientId} onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Accession # *</Label>
                    <Input value={form.accessionNumber} onChange={(e) => setForm((f) => ({ ...f, accessionNumber: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Finding Type *</Label>
                    <Input placeholder="e.g. Ruptured ectopic, AAA, Suspicious mass…"
                      value={form.findingType} onChange={(e) => setForm((f) => ({ ...f, findingType: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Severity</Label>
                    <div className="flex gap-1">
                      {["critical", "high", "medium", "low"].map((s) => (
                        <button key={s} onClick={() => setForm((f) => ({ ...f, severity: s }))}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold border capitalize ${
                            form.severity === s ? "bg-primary text-primary-foreground border-primary" : "border-border"
                          }`}
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5"><Label>Description *</Label>
                  <Textarea rows={3} value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700"
                    onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}
                  >{createMutation.isPending ? "Flagging…" : "Flag Critical"}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {alertsLoading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
          {!alertsLoading && alerts.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <ShieldCheck className="h-10 w-10 mx-auto text-emerald-400 mb-2" />
              <p className="text-sm text-muted-foreground">No active USG critical alerts.</p>
            </CardContent></Card>
          )}

          {alerts.map((a) => (
            <Card key={a.id} className={a.status === "resolved" ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${a.status === "resolved" ? "text-gray-400" : "text-red-600"}`} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">{a.patientName}</span>
                      <Badge variant="outline" className="text-[10px]">{a.accessionNumber}</Badge>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase ${SEV_BADGE[a.severity] ?? SEV_BADGE.high}`}>
                        {a.severity}
                      </span>
                      <Badge variant={a.status === "resolved" ? "secondary" : "default"} className="text-[10px] capitalize">{a.status}</Badge>
                    </div>
                    <p className="text-sm font-semibold">{a.findingType}</p>
                    <p className="text-xs text-muted-foreground">{a.description}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Flagged by {a.flaggedBy} · {new Date(a.createdAt).toLocaleString()}
                      {a.acknowledgedAt && ` · Ack by ${a.acknowledgedBy} at ${new Date(a.acknowledgedAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {!a.acknowledged && a.status !== "resolved" && (
                      <Button size="sm" variant="outline" onClick={() => ackMutation.mutate(a.id)}>Acknowledge</Button>
                    )}
                    {a.status !== "resolved" && (
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => resolveMutation.mutate(a.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "productivity" && (
        <div className="space-y-4">
          {prodLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {productivity && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={FileText} label="Finalized" value={productivity.reports.finalized} color="emerald" />
                <StatCard icon={Clock} label="Pending+Draft" value={productivity.reports.pending + productivity.reports.drafts} color="amber" />
                <StatCard icon={Activity} label="Measurements" value={productivity.measurements.approved} color="cyan" />
                <StatCard icon={AlertCircle} label="Critical (7d)" value={productivity.criticalAlerts} color="red" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Per-User Productivity (last {productivity.windowDays} days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase">
                      <tr><th className="text-left py-2">User</th><th className="text-right">Finalized</th>
                        <th className="text-right">Open</th><th className="text-right">Avg TAT</th></tr>
                    </thead>
                    <tbody>
                      {productivity.perUser.map((u) => (
                        <tr key={u.userName} className="border-t border-border/40">
                          <td className="py-2 font-semibold">{u.userName}</td>
                          <td className="text-right">{u.finalizedCount}</td>
                          <td className="text-right">{u.openCount}</td>
                          <td className="text-right">{u.avgTatMinutes ? `${u.avgTatMinutes} min` : "—"}</td>
                        </tr>
                      ))}
                      {productivity.perUser.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No reports finalized yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "audit" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">USG Audit Log (latest 100)</CardTitle>
            <CardDescription>Every action across templates, drafts, verify/finalize, amendments and critical alerts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {auditLoading && <p className="text-muted-foreground">Loading…</p>}
            {audit.map((row) => (
              <div key={row.id} className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0">
                <span className="text-[10px] text-muted-foreground w-32 flex-shrink-0">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
                <Badge variant="outline" className="text-[10px]">{row.entityType}{row.entityId ? ` #${row.entityId}` : ""}</Badge>
                <span className="font-semibold uppercase text-[10px] text-primary">{row.action}</span>
                <span className="flex-1 truncate">{row.performedBy}{row.performedByRole ? ` (${row.performedByRole})` : ""}</span>
              </div>
            ))}
            {!auditLoading && audit.length === 0 && (
              <p className="text-muted-foreground text-center py-6">No audit entries yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number; color: "emerald" | "amber" | "cyan" | "red";
}) {
  const COLOR_BG: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    amber:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    cyan:    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
    red:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${COLOR_BG[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
