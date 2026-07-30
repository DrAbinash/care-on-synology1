// Diagnostic Integration admin — HOPE ↔ CARE connection, sync health, permissions.
// Doctor-friendly: one-click Hope setup, toggle WhatsApp permission, copy API key once.
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send, RotateCw, AlertTriangle, Plug, FlaskConical, CheckCircle2, MessageCircle, Copy, KeyRound } from "lucide-react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface OutboxEvent {
  id: number; eventType: string; eventVersion: string; correlationId: string | null;
  status: string; attempts: number; maxAttempts: number; lastError: string | null;
  nextAttemptAt: string; sentAt: string | null; createdAt: string;
}
interface Partner {
  id: number; code: string; name: string; isActive: boolean;
  keyPrefix: string | null; lastUsedAt: string | null; permissions: unknown;
}
interface Mapping {
  id: number; sourceName: string; sourceCode: string | null;
  mappingStatus: string; careTestId: number | null; carePackageId: number | null;
}
interface PermMeta { id: string; label: string; hint: string }

const statusBadge = (s: string) => {
  if (s === "dead") return "bg-red-100 text-red-800";
  if (s === "failed" || s === "sending") return "bg-amber-100 text-amber-800";
  if (s === "sent") return "bg-green-100 text-green-800";
  return "bg-slate-100 text-slate-700";
};

function parsePerms(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === "string") : [];
    } catch { return []; }
  }
  return [];
}

export default function IntegrationAdmin() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("dead,failed,pending");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);

  const outbox = useQuery<{ events: OutboxEvent[] }>({
    queryKey: ["intg-outbox", statusFilter],
    queryFn: () => api.get(`/api/integration/admin/outbox?status=${encodeURIComponent(statusFilter)}`),
  });
  const partners = useQuery<{ partners: Partner[] }>({
    queryKey: ["intg-partners"],
    queryFn: () => api.get("/api/integration/admin/partners"),
  });
  const permMeta = useQuery<{ permissions: PermMeta[]; hopeDefaults: string[] }>({
    queryKey: ["intg-permissions"],
    queryFn: () => api.get("/api/integration/admin/permissions"),
  });
  const pendingMappings = useQuery<{ mappings: Mapping[] }>({
    queryKey: ["intg-mappings-pending"],
    queryFn: () => api.get("/api/integration/admin/mappings?status=pending_review"),
  });
  const attempts = useQuery<{ attempts: Array<{ id: number; attemptNo: number; status: string; httpStatus: number | null; error: string | null; createdAt: string }> }>({
    queryKey: ["intg-attempts", expanded],
    queryFn: () => api.get(`/api/integration/admin/outbox/${expanded}/attempts`),
    enabled: expanded != null,
  });

  const hopePartner = useMemo(
    () => partners.data?.partners.find((p) => p.code.toUpperCase() === "HOPE"),
    [partners.data],
  );
  const hopePerms = parsePerms(hopePartner?.permissions);
  const waEnabled = hopePerms.includes("whatsapp:enqueue");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["intg-outbox"] });
    qc.invalidateQueries({ queryKey: ["intg-partners"] });
    qc.invalidateQueries({ queryKey: ["intg-mappings-pending"] });
  };
  const ok = (msg: string) => { setBanner({ kind: "ok", msg }); refresh(); };
  const err = (e: unknown) => setBanner({ kind: "err", msg: (e as Error)?.message ?? "Action failed" });

  const retry = useMutation({
    mutationFn: (id: number) => api.post(`/api/integration/admin/outbox/${id}/retry`, {}),
    onSuccess: () => ok("Event re-queued for delivery."),
    onError: err,
  });
  const dispatch = useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number; dead: number; claimed: number }>("/api/integration/admin/dispatch-outbox", {}),
    onSuccess: (r) => ok(`Dispatch: ${r.sent} sent, ${r.failed} failed, ${r.dead} dead of ${r.claimed}.`),
    onError: err,
  });
  const reconcile = useMutation({
    mutationFn: () => api.post("/api/integration/admin/reconcile-results", {}),
    onSuccess: () => ok("Reconcile run complete."),
    onError: err,
  });

  const createHope = useMutation({
    mutationFn: () => api.post<{ apiKey: string; partner: { id: number; code: string } }>("/api/integration/admin/partners", {
      code: "HOPE",
      name: "Hope NeuroTrauma Hospital",
      sourceOrgCode: "HOPE",
      permissions: permMeta.data?.hopeDefaults,
    }),
    onSuccess: (data) => {
      setNewApiKey(data.apiKey);
      ok("Hope connection created. Copy the API key below into Hope's CARE_PARTNER_KEY — it is shown only once.");
    },
    onError: err,
  });

  const updatePartner = useMutation({
    mutationFn: (payload: { id: number; permissions?: string[]; isActive?: boolean }) =>
      api.put(`/api/integration/admin/partners/${payload.id}`, payload),
    onSuccess: () => ok("Saved."),
    onError: err,
  });

  const rotateKey = useMutation({
    mutationFn: (id: number) => api.post<{ apiKey: string }>(`/api/integration/admin/partners/${id}/rotate-key`, {}),
    onSuccess: (data) => {
      setNewApiKey(data.apiKey);
      ok("New API key generated — copy it into Hope now. The old key stops working immediately.");
    },
    onError: err,
  });

  function toggleWa(on: boolean) {
    if (!hopePartner || !permMeta.data) return;
    const base = new Set(parsePerms(hopePartner.permissions));
    if (on) base.add("whatsapp:enqueue");
    else base.delete("whatsapp:enqueue");
    updatePartner.mutate({ id: hopePartner.id, permissions: [...base] });
  }

  function togglePerm(permId: string, on: boolean) {
    if (!hopePartner) return;
    const base = new Set(parsePerms(hopePartner.permissions));
    if (on) base.add(permId);
    else base.delete(permId);
    updatePartner.mutate({ id: hopePartner.id, permissions: [...base] });
  }

  async function copyKey() {
    if (!newApiKey) return;
    await navigator.clipboard.writeText(newApiKey);
    ok("API key copied to clipboard.");
  }

  return (
    <div className="p-4 flex flex-col gap-4 max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <Plug className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold">Hope Hospital connection</h1>
          <p className="text-sm text-muted-foreground">Link CARE Diagnostics with Hope ERP — lab orders & shared WhatsApp.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
            <Send className="h-4 w-4 mr-1" />Sync now
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
        </div>
      </div>

      {banner && (
        <div className={`rounded-md px-3 py-2 text-sm ${banner.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {banner.msg}
          <button type="button" className="float-right opacity-60 hover:opacity-100" onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      {/* ── Hope setup card (doctor-friendly) ── */}
      <section className="rounded-lg border-2 border-blue-200 bg-blue-50/40 p-4 space-y-4">
        <div className="flex items-start gap-3">
          <MessageCircle className="h-8 w-8 text-green-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h2 className="font-semibold text-lg">Step 1 — Connect Hope Hospital</h2>
            <p className="text-sm text-muted-foreground">
              One connection key lets Hope send lab orders <em>and</em> patient WhatsApp messages through CARE's number (you pay Meta once, not twice).
            </p>
          </div>
        </div>

        {!hopePartner ? (
          <div className="rounded-md border border-dashed bg-white p-4 text-center space-y-3">
            <p className="text-sm">No Hope connection yet.</p>
            <Button onClick={() => createHope.mutate()} disabled={createHope.isPending || !permMeta.data}>
              <KeyRound className="h-4 w-4 mr-2" />
              {createHope.isPending ? "Creating…" : "Create Hope connection"}
            </Button>
          </div>
        ) : (
          <div className="rounded-md bg-white border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{hopePartner.name}</span>
                <span className="text-xs text-muted-foreground ml-2">key {hopePartner.keyPrefix}…</span>
                {hopePartner.lastUsedAt && (
                  <span className="text-xs text-muted-foreground ml-2">last used {new Date(hopePartner.lastUsedAt).toLocaleString()}</span>
                )}
              </div>
              <Badge variant={hopePartner.isActive ? "default" : "secondary"}>{hopePartner.isActive ? "Active" : "Inactive"}</Badge>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-green-200 bg-green-50/60 p-3">
              <div>
                <Label className="font-medium">WhatsApp from Hope Hospital</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Follow-up reminders & billing texts go through CARE's WhatsApp — toggle this on after WhatsApp is configured in CARE Settings.
                </p>
              </div>
              <Switch checked={waEnabled} onCheckedChange={toggleWa} disabled={updatePartner.isPending} />
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Other permissions</summary>
              <div className="mt-2 space-y-2 pl-1">
                {(permMeta.data?.permissions ?? []).filter((p) => p.id !== "whatsapp:enqueue").map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-1">
                    <div>
                      <div className="font-medium text-sm">{p.label}</div>
                      <div className="text-xs text-muted-foreground">{p.hint}</div>
                    </div>
                    <Switch
                      checked={hopePerms.includes(p.id)}
                      onCheckedChange={(on) => togglePerm(p.id, on)}
                      disabled={updatePartner.isPending}
                    />
                  </div>
                ))}
              </div>
            </details>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => rotateKey.mutate(hopePartner.id)} disabled={rotateKey.isPending}>
                <RotateCw className="h-3.5 w-3.5 mr-1" />Generate new API key
              </Button>
            </div>
          </div>
        )}

        {newApiKey && (
          <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-900">Copy this key into Hope's <code className="text-xs bg-white px-1 rounded">CARE_PARTNER_KEY</code> — shown only once:</p>
            <div className="flex gap-2">
              <code className="flex-1 text-xs break-all bg-white border rounded p-2 font-mono">{newApiKey}</code>
              <Button size="sm" variant="outline" onClick={() => void copyKey()}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-amber-800">In Hope .env also set: ENABLE_CARE_INTEGRATION=1, CARE_REFERRAL_URL=…/api/integration/v1, NOTIFY_PROVIDER=care</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-3">
          <strong>Free option (no WhatsApp Business API):</strong> In Hope set NOTIFY_PROVIDER=manual — staff use "Open WhatsApp" buttons; no key needed for messaging.
        </div>
      </section>

      {/* Outbox — collapsed by default for doctors */}
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer p-3 font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Sync errors & advanced tools
        </summary>
        <div className="border-t px-3 pb-3 space-y-3">
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
              <RotateCw className="h-4 w-4 mr-1" />Reconcile results
            </Button>
            <select className="text-sm border rounded px-2 py-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="dead,failed,pending">Unresolved</option>
              <option value="dead">Dead-lettered</option>
              <option value="sent">Sent</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Event</th><th className="p-2">Referral</th><th className="p-2">Status</th><th className="p-2">Error</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {outbox.isLoading && <tr><td colSpan={5} className="p-4 text-muted-foreground">Loading…</td></tr>}
                {outbox.data?.events.length === 0 && <tr><td colSpan={5} className="p-4 text-green-700"><CheckCircle2 className="inline h-4 w-4 mr-1" />All synced.</td></tr>}
                {outbox.data?.events.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="border-t">
                      <td className="p-2">{e.eventType}</td>
                      <td className="p-2 text-xs">{e.correlationId ?? "—"}</td>
                      <td className="p-2"><span className={`text-[10px] rounded px-1.5 py-0.5 ${statusBadge(e.status)}`}>{e.status}</span></td>
                      <td className="p-2 text-xs text-red-700 truncate max-w-[180px]">{e.lastError ?? "—"}</td>
                      <td className="p-2">
                        {(e.status === "dead" || e.status === "failed") && (
                          <Button size="sm" variant="outline" onClick={() => retry.mutate(e.id)}>Retry</Button>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <section className="rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 p-3 border-b">
          <FlaskConical className="h-4 w-4 text-orange-600" />
          <h2 className="font-medium">Test name mappings to review</h2>
        </div>
        <div className="p-2 flex flex-col gap-1">
          {pendingMappings.data?.mappings.length === 0 && (
            <div className="text-sm text-green-700 p-2"><CheckCircle2 className="inline h-4 w-4 mr-1" />Nothing pending.</div>
          )}
          {pendingMappings.data?.mappings.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div><span className="font-medium">{m.sourceName}</span></div>
              <span className="text-xs text-muted-foreground">{m.careTestId ? `→ test ${m.careTestId}` : "needs mapping"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
