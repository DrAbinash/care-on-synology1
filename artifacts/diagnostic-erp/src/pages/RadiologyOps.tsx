// RadiologyOps.tsx — the "Backend Ops" panel embedded in the Radiology Flight
// Deck (the one admin diagnostics page). Surfaces /api/radiology-ops (Backend
// v1 operational surface): health, consistency/drift/audit checks, re-delivery
// obligation backlog, durable-job dead-letter management, the radiology flag
// registry, and safe dry-run→confirm repairs. Admin/owner only; the router is
// gated by requireStaffPermission("/radiology") + requireAdminRole per action.
// NOT a standalone route — it renders inside RadiologyFlightDeck's tabs so the
// admin has one place to diagnose AND operate the radiology stack.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Activity, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, PlayCircle, Wrench, Flag, Inbox } from "lucide-react";

type OpsStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";
interface HealthComponent { status: OpsStatus; detail: string; data?: Record<string, unknown> }
interface Health { overall: OpsStatus; ranAt: string; components: Record<string, HealthComponent> }
interface ConsistencyFinding { check: string; severity: "ERROR" | "WARNING"; count?: number; message?: string }
interface ConsistencyReport { errorCount: number; warningCount: number; findings: ConsistencyFinding[] }
interface DriftSummary { checkedCount: number; driftCount: number }
interface FlagEntry { key: string; enabled: boolean; wired?: boolean; enableOrder?: number; dependsOn?: string[]; defaultValue?: boolean }
interface FlagsResponse { registry: FlagEntry[]; violations: unknown[]; safeEnableOrder: string[] }
interface RepairOutcome { action: string; dryRun: boolean; affected: Array<Record<string, unknown>>; executed: boolean }
type Row = Record<string, unknown>;

const STATUS_STYLE: Record<OpsStatus, string> = {
  HEALTHY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40",
  DEGRADED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40",
  UNHEALTHY: "bg-red-100 text-red-700 dark:bg-red-950/40",
  UNKNOWN: "bg-slate-100 text-slate-600 dark:bg-slate-800/60",
};
function StatusPill({ status }: { status: OpsStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN}`}>{status}</span>;
}
const val = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function RadiologyOpsPanel() {
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Backend v1 operational surface — health, integrity checks, durable jobs, re-delivery obligations, flag registry and safe dry-run→confirm repairs. Admin actions here are audited.</p>
      <Tabs defaultValue="health">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="health"><Activity className="h-3.5 w-3.5 mr-1" />Health</TabsTrigger>
          <TabsTrigger value="checks"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Checks</TabsTrigger>
          <TabsTrigger value="obligations"><Inbox className="h-3.5 w-3.5 mr-1" />Obligations</TabsTrigger>
          <TabsTrigger value="jobs"><PlayCircle className="h-3.5 w-3.5 mr-1" />Jobs</TabsTrigger>
          <TabsTrigger value="flags"><Flag className="h-3.5 w-3.5 mr-1" />Flags</TabsTrigger>
          <TabsTrigger value="repairs"><Wrench className="h-3.5 w-3.5 mr-1" />Repairs</TabsTrigger>
        </TabsList>
        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="checks" className="mt-4"><ChecksTab toast={toast} /></TabsContent>
        <TabsContent value="obligations" className="mt-4"><ObligationsTab toast={toast} /></TabsContent>
        <TabsContent value="jobs" className="mt-4"><JobsTab toast={toast} /></TabsContent>
        <TabsContent value="flags" className="mt-4"><FlagsTab /></TabsContent>
        <TabsContent value="repairs" className="mt-4"><RepairsTab toast={toast} /></TabsContent>
      </Tabs>
    </div>
  );
}

function HealthTab() {
  const { data, isFetching, refetch } = useQuery<Health>({ queryKey: ["radops-health"], queryFn: () => api.get("/api/radiology-ops/health"), refetchInterval: 30_000 });
  const components = data ? Object.entries(data.components) : [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {data && <><span className="text-sm text-muted-foreground">Overall</span><StatusPill status={data.overall} /><span className="text-xs text-muted-foreground">· {new Date(data.ranAt).toLocaleString("en-IN")}</span></>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {components.map(([name, c]) => (
          <Card key={name}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{name.replace(/([A-Z])/g, " $1").trim()}</span>
                <StatusPill status={c.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{c.detail}</p>
              {c.data && Object.keys(c.data).length > 0 && <p className="text-[11px] text-muted-foreground mt-1 font-mono break-all">{JSON.stringify(c.data)}</p>}
            </CardContent>
          </Card>
        ))}
        {!data && <p className="text-sm text-muted-foreground">Loading health…</p>}
      </div>
    </div>
  );
}

function ChecksTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [consistency, setConsistency] = useState<ConsistencyReport | null>(null);
  const [drift, setDrift] = useState<DriftSummary | null>(null);
  const [audit, setAudit] = useState<Row | null>(null);

  const runConsistency = useMutation({ mutationFn: () => api.get<ConsistencyReport>("/api/radiology-ops/consistency"), onSuccess: setConsistency, onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });
  const runDrift = useMutation({ mutationFn: () => api.post<DriftSummary>("/api/radiology-ops/drift-scan", {}), onSuccess: setDrift, onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });
  const runAudit = useMutation({ mutationFn: () => api.post<Row>("/api/radiology-ops/audit-verify", { mode: "window" }), onSuccess: setAudit, onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between gap-2"><CardTitle className="text-base">Data consistency</CardTitle>
          <Button size="sm" onClick={() => runConsistency.mutate()} disabled={runConsistency.isPending}>{runConsistency.isPending ? "Running…" : "Run check"}</Button></CardHeader>
        <CardContent>
          {!consistency ? <p className="text-sm text-muted-foreground">Read-only integrity scan across drafts, reports and finding instances.</p> : (
            <div className="space-y-2">
              <div className="flex gap-2 text-sm">
                <Badge variant={consistency.errorCount > 0 ? "destructive" : "secondary"}>{consistency.errorCount} errors</Badge>
                <Badge variant={consistency.warningCount > 0 ? "default" : "secondary"}>{consistency.warningCount} warnings</Badge>
                {consistency.errorCount === 0 && consistency.warningCount === 0 && <span className="flex items-center gap-1 text-emerald-600 text-sm"><CheckCircle2 className="h-4 w-4" />All checks passed</span>}
              </div>
              {consistency.findings.length > 0 && (
                <div className="divide-y text-sm">
                  {consistency.findings.map((f, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="font-mono text-xs">{f.check}{f.message ? <span className="font-sans text-muted-foreground"> · {f.message}</span> : ""}</span>
                      <Badge variant={f.severity === "ERROR" ? "destructive" : "default"} className="text-[10px]">{f.severity}{f.count != null ? ` ×${f.count}` : ""}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-2"><CardTitle className="text-base">Structured drift</CardTitle>
            <Button size="sm" variant="outline" onClick={() => runDrift.mutate()} disabled={runDrift.isPending}>{runDrift.isPending ? "Scanning…" : "Scan"}</Button></CardHeader>
          <CardContent className="text-sm">
            {!drift ? <p className="text-muted-foreground">Compares draft structured JSON against the source of truth.</p> : (
              <div className="flex gap-2"><Badge variant="secondary">{drift.checkedCount} checked</Badge><Badge variant={drift.driftCount > 0 ? "default" : "secondary"}>{drift.driftCount} drifted</Badge></div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-2"><CardTitle className="text-base">Audit chain</CardTitle>
            <Button size="sm" variant="outline" onClick={() => runAudit.mutate()} disabled={runAudit.isPending}>{runAudit.isPending ? "Verifying…" : "Verify"}</Button></CardHeader>
          <CardContent className="text-sm">
            {!audit ? <p className="text-muted-foreground">Verifies the tamper-evident audit hash chain (recent window).</p> : (
              <p className="font-mono text-xs break-all">{JSON.stringify(audit)}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ObligationsTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const key = ["radops-obligations", status];
  const { data } = useQuery<{ obligations: Row[] }>({ queryKey: key, queryFn: () => api.get(`/api/radiology-ops/obligations?status=${status}`), retry: false });
  const obligations = data?.obligations ?? [];
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) => api.post(`/api/radiology-ops/obligations/${id}/${action}`, {}),
    onSuccess: (_r, v) => { toast({ title: `Obligation ${v.action}d` }); qc.invalidateQueries({ queryKey: ["radops-obligations"] }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Re-delivery obligations</CardTitle>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {obligations.length === 0 ? <p className="text-sm text-muted-foreground">No {status} obligations.</p> : (
          <div className="divide-y">
            {obligations.map((o) => {
              const id = Number(o.id);
              return (
                <div key={id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">#{id}</span> <span className="text-muted-foreground">report {val(o.reportId ?? o.report_id)} · {val(o.channel)}</span>
                    <div className="text-xs text-muted-foreground">{val(o.recipient ?? o.recipientFingerprint ?? o.recipient_fingerprint)}</div>
                  </div>
                  {status === "pending" || status === "acknowledged" || status === "failed" ? (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id, action: "queue" })}>Queue send</Button>
                      <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id, action: "acknowledge" })}>Ack</Button>
                      <Button size="sm" variant="outline" className="text-red-700" disabled={act.isPending} onClick={() => act.mutate({ id, action: "dismiss" })}>Dismiss</Button>
                    </div>
                  ) : <Badge variant="secondary" className="text-[10px] shrink-0">{val(o.status)}</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JobsTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ jobs: Row[] }>({ queryKey: ["radops-deadletter"], queryFn: () => api.get("/api/radiology-ops/jobs/dead-letter"), retry: false });
  const jobs = data?.jobs ?? [];
  const tick = useMutation({ mutationFn: () => api.post<Row>("/api/radiology-ops/jobs/tick", {}), onSuccess: (r) => { toast({ title: "Job tick ran", description: val(r) }); qc.invalidateQueries({ queryKey: ["radops-deadletter"] }); }, onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });
  const retry = useMutation({ mutationFn: (jobId: number) => api.post("/api/radiology-ops/repair", { action: "retry_dead_job", dryRun: false, confirmToken: "REPAIR-retry_dead_job", jobId }), onSuccess: () => { toast({ title: "Job marked retryable" }); qc.invalidateQueries({ queryKey: ["radops-deadletter"] }); }, onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });
  const restore = useMutation({ mutationFn: () => api.post<Row>("/api/radiology-ops/restore-verify", {}), onSuccess: (r) => toast({ title: "Restore-verify queued", description: val(r.note ?? r) }), onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => tick.mutate()} disabled={tick.isPending}><PlayCircle className="h-3.5 w-3.5 mr-1" />{tick.isPending ? "Ticking…" : "Run job tick"}</Button>
        <Button size="sm" variant="outline" onClick={() => restore.mutate()} disabled={restore.isPending}>{restore.isPending ? "Queuing…" : "Queue restore-verify"}</Button>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Dead-letter jobs</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? <p className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />No dead-letter jobs.</p> : (
            <div className="divide-y">
              {jobs.map((j) => {
                const id = Number(j.id);
                return (
                  <div key={id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">#{id}</span> <span className="font-mono text-xs">{val(j.operationType ?? j.operation_type)}</span>
                      <div className="text-xs text-muted-foreground truncate">attempts {val(j.attempts)} · {val(j.lastError ?? j.last_error)}</div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" disabled={retry.isPending} onClick={() => retry.mutate(id)}>Retry</Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FlagsTab() {
  const { data } = useQuery<FlagsResponse>({ queryKey: ["radops-flags"], queryFn: () => api.get("/api/radiology-ops/flags"), retry: false });
  const registry = data?.registry ?? [];
  const violations = data?.violations ?? [];
  return (
    <div className="space-y-3">
      {violations.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" />{violations.length} dependency violation(s):</p>
          <ul className="mt-1 text-xs font-mono">{violations.map((v, i) => <li key={i}>{val(v)}</li>)}</ul>
        </div>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Radiology feature-flag registry</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-1 pr-2">Flag</th><th className="py-1 px-2">Order</th><th className="py-1 px-2">Wired</th><th className="py-1 px-2">Depends on</th><th className="py-1 pl-2 text-right">Enabled</th></tr></thead>
            <tbody>
              {registry.map((f) => (
                <tr key={f.key} className="border-t">
                  <td className="py-1.5 pr-2 font-mono text-xs">{f.key}</td>
                  <td className="py-1.5 px-2 tabular-nums">{f.enableOrder ?? "—"}</td>
                  <td className="py-1.5 px-2">{f.wired ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="py-1.5 px-2 text-xs text-muted-foreground">{f.dependsOn && f.dependsOn.length ? f.dependsOn.join(", ") : "—"}</td>
                  <td className="py-1.5 pl-2 text-right"><Badge variant={f.enabled ? "default" : "secondary"} className="text-[10px]">{f.enabled ? "on" : "off"}</Badge></td>
                </tr>
              ))}
              {registry.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Loading…</td></tr>}
            </tbody>
          </table>
          {data?.safeEnableOrder && data.safeEnableOrder.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Safe enable order: <span className="font-mono">{data.safeEnableOrder.join(" → ")}</span></p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const REPAIR_ACTIONS = [
  { value: "release_stale_locks", label: "Release stale worklist locks", needs: null },
  { value: "clear_duplicate_obligation", label: "Clear duplicate obligations (with completed twin)", needs: null },
  { value: "reconcile_amendment_obligations", label: "Reconcile missing amendment obligations", needs: null },
  { value: "regenerate_draft_structured_cache", label: "Regenerate draft structured cache", needs: "draftId" },
  { value: "retry_dead_job", label: "Retry a dead-letter job", needs: "jobId" },
] as const;

function RepairsTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [action, setAction] = useState<string>(REPAIR_ACTIONS[0].value);
  const [idVal, setIdVal] = useState("");
  const [preview, setPreview] = useState<RepairOutcome | null>(null);
  const needs = REPAIR_ACTIONS.find((a) => a.value === action)?.needs ?? null;

  const body = () => {
    const b: Record<string, unknown> = { action };
    if (needs === "draftId") b.draftId = Number(idVal);
    if (needs === "jobId") b.jobId = Number(idVal);
    return b;
  };
  const dry = useMutation({
    mutationFn: () => api.post<RepairOutcome>("/api/radiology-ops/repair", { ...body(), dryRun: true }),
    onSuccess: (r) => { setPreview(r); toast({ title: `Dry run: ${r.affected.length} affected` }); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });
  const execute = useMutation({
    mutationFn: () => api.post<RepairOutcome>("/api/radiology-ops/repair", { ...body(), dryRun: false, confirmToken: `REPAIR-${action}` }),
    onSuccess: (r) => { toast({ title: r.executed ? "Repair executed" : "Nothing to repair" }); setPreview(null); setIdVal(""); },
    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  const needsId = needs !== null;
  const idReady = !needsId || Number(idVal) > 0;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" />Safe repairs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-300">
          Repairs only touch mechanically unambiguous cases — never signed structured JSON or clinical prose. Always run a dry run first; execution needs an explicit confirmation.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={action} onValueChange={(v) => { setAction(v); setPreview(null); setIdVal(""); }}>
            <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
            <SelectContent>{REPAIR_ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
          {needsId && <Input type="number" className="w-32" placeholder={needs === "jobId" ? "Job ID" : "Draft ID"} value={idVal} onChange={(e) => { setIdVal(e.target.value); setPreview(null); }} />}
          <Button size="sm" variant="outline" disabled={!idReady || dry.isPending} onClick={() => dry.mutate()}>{dry.isPending ? "Running…" : "Dry run"}</Button>
          {preview && preview.action === action && (
            <Button size="sm" disabled={execute.isPending} onClick={() => execute.mutate()}>{execute.isPending ? "Executing…" : `Execute (${preview.affected.length})`}</Button>
          )}
        </div>
        {preview && (
          <div className="text-sm">
            <p className="text-muted-foreground mb-1">Dry run — {preview.affected.length} record(s) would be affected:</p>
            {preview.affected.length === 0 ? <p className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-4 w-4" />Nothing to repair.</p> : (
              <div className="max-h-56 overflow-y-auto rounded border divide-y">
                {preview.affected.slice(0, 50).map((r, i) => <div key={i} className="px-2 py-1 font-mono text-[11px] break-all">{JSON.stringify(r)}</div>)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
