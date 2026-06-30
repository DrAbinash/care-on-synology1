import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession, normalizeRole } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound, Plus, Ban, Copy, ShieldCheck, X, ScrollText, CheckCircle2, XCircle, Lock,
} from "lucide-react";

// Types mirror artifacts/api-server/src/routes/aiCallerCredentials.ts exactly.

interface AiCallerCredential {
  id: number;
  name: string;
  channel: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

interface CreatedCredential extends AiCallerCredential {
  apiKey: string;
}

interface AuditLogRow {
  id: number;
  credentialId: string | null;
  credentialName: string;
  channel: string;
  method: string;
  path: string;
  allowed: boolean;
  denyReason: string | null;
  createdAt: string;
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) return String((err as { error: unknown }).error);
  return err instanceof Error ? err.message : "Unknown error";
}

export default function AiCallerCredentials() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const isSuperAdmin = normalizeRole(session?.user.role ?? "") === "super_admin";

  const [creating, setCreating] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [draft, setDraft] = useState({ name: "", channel: "" });
  const [justCreated, setJustCreated] = useState<CreatedCredential | null>(null);

  const credsQ = useQuery({
    queryKey: ["ai-caller-credentials"],
    queryFn: () => api.get<AiCallerCredential[]>("/api/ai-caller-credentials"),
    enabled: isSuperAdmin,
  });

  const permsQ = useQuery({
    queryKey: ["ai-caller-permissions"],
    queryFn: () => api.get<string[]>("/api/ai-caller-credentials/permissions"),
    enabled: isSuperAdmin,
  });

  const auditQ = useQuery({
    queryKey: ["ai-caller-audit-log"],
    queryFn: () => api.get<AuditLogRow[]>("/api/ai-caller-credentials/audit-log"),
    enabled: isSuperAdmin && showAuditLog,
  });

  const createMut = useMutation({
    mutationFn: (body: typeof draft) => api.post<CreatedCredential>("/api/ai-caller-credentials", body),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["ai-caller-credentials"] });
      setCreating(false);
      setDraft({ name: "", channel: "" });
      setJustCreated(created);
    },
    onError: (err: unknown) => toast({ title: "Could not create credential", description: errMsg(err), variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/ai-caller-credentials/${id}/revoke`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-caller-credentials"] });
      toast({ title: "Credential revoked" });
    },
    onError: (err: unknown) => toast({ title: "Could not revoke credential", description: errMsg(err), variant: "destructive" }),
  });

  const creds = credsQ.data ?? [];

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="AI Caller Credentials" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <Lock className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <h2 className="font-semibold mb-1">Super Admin only</h2>
            <p className="text-sm text-muted-foreground">
              Issuing or revoking AI caller credentials is restricted to Super Admin, not general Admin — this credential class is deliberately scoped more tightly than any other setting in this ERP.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="AI Caller Credentials"
        subtitle="Machine credentials for external AI services (a future Conversation Manager, Voice Gateway, etc.) calling into this ERP's AI-facing APIs. Not used by the WhatsApp bot, which runs in-process and needs no credential of its own."
        actions={
          <>
            <Button variant={showAuditLog ? "default" : "outline"} size="sm" onClick={() => setShowAuditLog((v) => !v)}>
              <ScrollText className="h-4 w-4 mr-1.5" /> Audit Log
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Credential
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold text-sm flex items-center gap-2 mb-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> What an AI caller can do — fixed, not configurable
          </h2>
          <p className="text-xs text-muted-foreground mb-2">
            This list cannot be widened from this screen or any API call. It only changes if an engineer edits the source code directly, and an automated test fails the build if it's ever loosened to include a refund, delete, or radiologist-share permission.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(permsQ.data ?? []).map((p) => (
              <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 font-mono">{p}</span>
            ))}
          </div>
        </div>

        {justCreated && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-amber-900 dark:text-amber-200">Save this key now — it will not be shown again</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setJustCreated(null)}><X className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">This system only stores a one-way hash of the key, the same way a password is stored — there is no way to retrieve it again later, even by an administrator. If it's lost, revoke this credential and issue a new one.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-card border border-border rounded px-3 py-2 font-mono break-all">{justCreated.apiKey}</code>
              <Button
                variant="outline" size="sm"
                onClick={() => { navigator.clipboard.writeText(justCreated.apiKey); toast({ title: "Copied" }); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {creating && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> New AI Caller Credential</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreating(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. whatsapp-conversation-manager" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Channel</label>
              <Input value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })} placeholder="e.g. whatsapp, voice, website" />
              <p className="text-xs text-muted-foreground mt-1">Every search this credential performs is attributed to this channel — it cannot claim to be a different one later.</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
              <Button size="sm" onClick={() => createMut.mutate(draft)} disabled={createMut.isPending || !draft.name.trim() || !draft.channel.trim()}>
                {createMut.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        )}

        {showAuditLog && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-sm mb-3">Recent authentication attempts</h2>
            {auditQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (auditQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No AI caller activity recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {auditQ.data!.map((row) => (
                  <div key={row.id} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-muted/50">
                    <span className="flex items-center gap-2 min-w-0">
                      {row.allowed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />}
                      <span className="truncate">{row.method} {row.path} {row.credentialName ? `· ${row.credentialName}` : ""} {row.denyReason ? `· ${row.denyReason}` : ""}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 ml-2">{new Date(row.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {credsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : creds.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <KeyRound className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No AI caller credentials issued yet.</p>
            <p className="text-xs mt-1">Nothing in this ERP currently needs one — the WhatsApp bot runs in-process. This is ready for whenever an external AI service is added.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {creds.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
                      {c.isActive ? "active" : "revoked"}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">{c.channel}</span>
                  </div>
                  <h3 className="font-semibold text-sm">{c.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created by {c.createdBy || "unknown"} · {new Date(c.createdAt).toLocaleDateString()}
                    {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleString()}` : " · never used"}
                    {c.revokedAt ? ` · revoked by ${c.revokedBy || "unknown"} on ${new Date(c.revokedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                {c.isActive && (
                  <Button variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => revokeMut.mutate(c.id)}>
                    <Ban className="h-4 w-4 mr-1.5" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
