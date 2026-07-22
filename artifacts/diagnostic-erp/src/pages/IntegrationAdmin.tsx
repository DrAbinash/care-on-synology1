// ============================================================================
// Diagnostic Integration admin — failed-sync reconciliation dashboard (brief
// §16: "Admin view for failed integrations"). Surfaces the transactional outbox
// (pending/failed/dead events), partner credentials, and catalogue mappings that
// need review, with manual retry + dispatch/reconcile triggers. Admin-only
// (backend requireAdminRole); reads/writes only the additive /api/integration/admin
// endpoints. Never touches billing/accounting.
// ============================================================================
import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send, RotateCw, AlertTriangle, Plug, FlaskConical, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface OutboxEvent {
  id: number; eventType: string; eventVersion: string; correlationId: string | null;
  status: string; attempts: number; maxAttempts: number; lastError: string | null;
  nextAttemptAt: string; sentAt: string | null; createdAt: string;
}
interface Partner { id: number; code: string; name: string; isActive: boolean; keyPrefix: string | null; lastUsedAt: string | null; permissions: unknown }
interface Mapping { id: number; sourceName: string; sourceCode: string | null; mappingStatus: string; careTestId: number | null; carePackageId: number | null }

const statusBadge = (s: string) => {
  if (s === "dead") return "bg-red-100 text-red-800";
  if (s === "failed" || s === "sending") return "bg-amber-100 text-amber-800";
  if (s === "sent") return "bg-green-100 text-green-800";
  return "bg-slate-100 text-slate-700";
};

export default function IntegrationAdmin() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("dead,failed,pending");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const outbox = useQuery<{ events: OutboxEvent[] }>({
    queryKey: ["intg-outbox", statusFilter],
    queryFn: () => api.get(`/api/integration/admin/outbox?status=${encodeURIComponent(statusFilter)}`),
  });
  const partners = useQuery<{ partners: Partner[] }>({ queryKey: ["intg-partners"], queryFn: () => api.get("/api/integration/admin/partners") });
  const pendingMappings = useQuery<{ mappings: Mapping[] }>({ queryKey: ["intg-mappings-pending"], queryFn: () => api.get("/api/integration/admin/mappings?status=pending_review") });
  const attempts = useQuery<{ attempts: Array<{ id: number; attemptNo: number; status: string; httpStatus: number | null; error: string | null; createdAt: string }> }>({
    queryKey: ["intg-attempts", expanded], queryFn: () => api.get(`/api/integration/admin/outbox/${expanded}/attempts`), enabled: expanded != null,
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["intg-outbox"] }); qc.invalidateQueries({ queryKey: ["intg-partners"] }); qc.invalidateQueries({ queryKey: ["intg-mappings-pending"] }); };
  const ok = (msg: string) => { setBanner({ kind: "ok", msg }); refresh(); };
  const err = (e: unknown) => setBanner({ kind: "err", msg: (e as Error)?.message ?? "Action failed" });

  const retry = useMutation({ mutationFn: (id: number) => api.post(`/api/integration/admin/outbox/${id}/retry`, {}), onSuccess: () => ok("Event re-queued for delivery."), onError: err });
  const dispatch = useMutation({ mutationFn: () => api.post<{ sent: number; failed: number; dead: number; claimed: number }>("/api/integration/admin/dispatch-outbox", {}), onSuccess: (r) => ok(`Dispatch: ${r.sent} sent, ${r.failed} failed, ${r.dead} dead of ${r.claimed}.`), onError: err });
  const reconcile = useMutation({ mutationFn: () => api.post("/api/integration/admin/reconcile-results", {}), onSuccess: () => ok("Reconcile run complete."), onError: err });

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Plug className="h-6 w-6 text-blue-600" />
        <h1 className="text-xl font-semibold">Diagnostic Integration</h1>
        <span className="text-sm text-muted-foreground">HOPE ↔ CARE sync health, failed-integration retry, partners & mapping review.</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}><Send className="h-4 w-4 mr-1" />Dispatch now</Button>
          <Button variant="outline" size="sm" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}><RotateCw className="h-4 w-4 mr-1" />Reconcile now</Button>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        </div>
      </div>

      {banner && (
        <div className={`rounded-md px-3 py-2 text-sm ${banner.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {banner.msg}<button className="float-right opacity-60 hover:opacity-100" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* Outbox / sync errors */}
      <section className="rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 p-3 border-b">
          <AlertTriangle className="h-4 w-4 text-amber-600" /><h2 className="font-medium">Outbound event queue</h2>
          <select className="ml-auto text-sm border rounded px-2 py-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="dead,failed,pending">Unresolved (pending/failed/dead)</option>
            <option value="dead">Dead-lettered</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Event</th><th className="p-2">Referral</th><th className="p-2">Status</th><th className="p-2">Attempts</th><th className="p-2">Last error</th><th className="p-2">Next try</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {outbox.isLoading && <tr><td colSpan={7} className="p-4 text-muted-foreground">Loading…</td></tr>}
              {outbox.data?.events.length === 0 && <tr><td colSpan={7} className="p-4 text-green-700"><CheckCircle2 className="inline h-4 w-4 mr-1" />No unresolved events — all synced.</td></tr>}
              {outbox.data?.events.map((e) => (
                <Fragment key={e.id}>
                  <tr className="border-t hover:bg-slate-50">
                    <td className="p-2 font-medium">{e.eventType}</td>
                    <td className="p-2 text-xs text-muted-foreground">{e.correlationId ?? "—"}</td>
                    <td className="p-2"><span className={`text-[10px] rounded px-1.5 py-0.5 ${statusBadge(e.status)}`}>{e.status}</span></td>
                    <td className="p-2">{e.attempts}/{e.maxAttempts}</td>
                    <td className="p-2 text-xs text-red-700 max-w-[220px] truncate" title={e.lastError ?? ""}>{e.lastError ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{e.status === "pending" ? new Date(e.nextAttemptAt).toLocaleString() : "—"}</td>
                    <td className="p-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>Attempts</Button>
                      {(e.status === "dead" || e.status === "failed") && <Button size="sm" variant="outline" onClick={() => retry.mutate(e.id)}>Retry</Button>}
                    </td>
                  </tr>
                  {expanded === e.id && (
                    <tr className="bg-slate-50"><td colSpan={7} className="p-2">
                      <div className="text-xs">
                        {attempts.isLoading ? "Loading attempts…" : (attempts.data?.attempts.length ? attempts.data.attempts.map((a) => (
                          <div key={a.id} className="flex gap-3 py-0.5"><span className="tabular-nums">#{a.attemptNo}</span><span className={a.status === "success" ? "text-green-700" : "text-red-700"}>{a.status}</span><span>{a.httpStatus ?? ""}</span><span className="text-muted-foreground">{a.error ?? ""}</span><span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span></div>
                        )) : <span className="text-muted-foreground">No delivery attempts yet.</span>)}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Partners */}
        <section className="rounded-lg border border-slate-200">
          <div className="flex items-center gap-2 p-3 border-b"><Plug className="h-4 w-4 text-blue-600" /><h2 className="font-medium">Integration partners</h2></div>
          <div className="p-2 flex flex-col gap-1">
            {partners.data?.partners.length === 0 && <div className="text-sm text-muted-foreground p-2">No partners provisioned yet (create via the admin API — see the go-live runbook).</div>}
            {partners.data?.partners.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div><span className="font-medium">{p.code}</span> <span className="text-muted-foreground">{p.name}</span> <span className="text-xs text-muted-foreground">{p.keyPrefix}…</span></div>
                <Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "active" : "inactive"}</Badge>
              </div>
            ))}
          </div>
        </section>

        {/* Mappings needing review */}
        <section className="rounded-lg border border-slate-200">
          <div className="flex items-center gap-2 p-3 border-b"><FlaskConical className="h-4 w-4 text-orange-600" /><h2 className="font-medium">Mappings pending review</h2></div>
          <div className="p-2 flex flex-col gap-1">
            {pendingMappings.data?.mappings.length === 0 && <div className="text-sm text-green-700 p-2"><CheckCircle2 className="inline h-4 w-4 mr-1" />No mappings awaiting review.</div>}
            {pendingMappings.data?.mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div><span className="font-medium">{m.sourceName}</span> {m.sourceCode ? <span className="text-xs text-muted-foreground">[{m.sourceCode}]</span> : null}</div>
                <span className="text-xs text-muted-foreground">{m.careTestId ? `→ test ${m.careTestId}` : m.carePackageId ? `→ package ${m.carePackageId}` : "unmapped"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
