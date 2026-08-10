// ============================================================================
// HOPE Hospital Connection — owner setup wizard for the HOPE ↔ CARE referral
// integration and related WhatsApp patient messaging. Separate from the
// Diagnostic Integration ops dashboard (/diagnostic-integration), which handles
// outbox retry and mapping review after go-live.
// ============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, KeyRound, MessageSquare, Plug, CheckCircle2, AlertTriangle,
  Copy, RefreshCw, ExternalLink, ShieldCheck, ArrowRight,
} from "lucide-react";

interface Partner {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  keyPrefix: string | null;
  callbackUrl: string | null;
  lastUsedAt: string | null;
}

interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  description: string;
}

interface WaHealth {
  featureEnabled: boolean;
  masterEnabled: boolean;
  outboundMessagingEnabled: boolean;
  emergencyPaused: boolean;
  shadowMode: boolean;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

export default function HopeHospitalConnection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("connection");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");

  const partners = useQuery<{ partners: Partner[] }>({
    queryKey: ["intg-partners"],
    queryFn: () => api.get("/api/integration/admin/partners"),
  });
  const flags = useQuery<FeatureFlagRow[]>({
    queryKey: ["feature-flags"],
    queryFn: () => api.get("/api/feature-flags"),
  });
  const waHealth = useQuery<WaHealth>({
    queryKey: ["wa-health"],
    queryFn: () => api.get("/api/whatsapp/health"),
  });

  const hopePartner = partners.data?.partners.find((p) => p.code.toUpperCase() === "HOPE") ?? null;
  const hopeFlag = flags.data?.find((f) => f.key === "ff_hope_care_referrals");
  const inboundUrl = `${window.location.origin}/api/integration/v1/diagnostic-referrals`;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["intg-partners"] });
    qc.invalidateQueries({ queryKey: ["feature-flags"] });
    qc.invalidateQueries({ queryKey: ["wa-health"] });
  };

  const createPartner = useMutation({
    mutationFn: () => api.post<{ partner: { id: number; code: string }; apiKey: string }>(
      "/api/integration/admin/partners",
      { code: "HOPE", name: "Hope Hospital", sourceOrgCode: "HOPE", isActive: true },
    ),
    onSuccess: (r) => {
      setIssuedKey(r.apiKey);
      toast({ title: "Hope Hospital partner created", description: "Copy the API key now — it is shown only once." });
      refresh();
    },
    onError: (e: unknown) => toast({ title: "Could not create partner", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const saveCallback = useMutation({
    mutationFn: () => api.put(`/api/integration/admin/partners/${hopePartner!.id}`, { callbackUrl: callbackUrl.trim() || null }),
    onSuccess: () => { toast({ title: "Callback URL saved" }); refresh(); },
    onError: (e: unknown) => toast({ title: "Save failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const togglePartner = useMutation({
    mutationFn: (active: boolean) => api.put(`/api/integration/admin/partners/${hopePartner!.id}`, { isActive: active }),
    onSuccess: () => { toast({ title: "Partner updated" }); refresh(); },
    onError: (e: unknown) => toast({ title: "Update failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const rotateKey = useMutation({
    mutationFn: () => api.post<{ apiKey: string }>(`/api/integration/admin/partners/${hopePartner!.id}/rotate-key`, {}),
    onSuccess: (r) => {
      setIssuedKey(r.apiKey);
      toast({ title: "New API key issued", description: "Copy it now — shown only once." });
      refresh();
    },
    onError: (e: unknown) => toast({ title: "Rotate failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const toggleFlag = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/api/feature-flags/ff_hope_care_referrals`, { enabled }),
    onSuccess: () => {
      toast({ title: "Integration flag updated" });
      refresh();
      window.dispatchEvent(new Event("featureFlagsChanged"));
    },
    onError: (e: unknown) => toast({ title: "Could not update flag", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const step1Done = !!hopePartner?.isActive && !!hopePartner.keyPrefix;
  const step2Done = !!hopeFlag?.enabled;
  const waReady = !!waHealth.data?.masterEnabled && !!waHealth.data?.featureEnabled;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Hope Hospital Connection"
        subtitle="Set up HOPE → CARE diagnostic referrals and WhatsApp patient messaging."
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="connection"><Plug className="h-4 w-4 mr-1" />Connection</TabsTrigger>
            <TabsTrigger value="whatsapp"><MessageSquare className="h-4 w-4 mr-1" />WhatsApp</TabsTrigger>
            <TabsTrigger value="go-live"><ShieldCheck className="h-4 w-4 mr-1" />Go Live</TabsTrigger>
          </TabsList>

          {/* ── Connection tab ── */}
          <TabsContent value="connection" className="space-y-4 mt-4">
            <Card className="border-blue-200 bg-blue-50/80">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-blue-700" />
                  <CardTitle className="text-blue-950">Step 1 — Connect Hope Hospital</CardTitle>
                  {step1Done ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>
                  ) : (
                    <Badge variant="outline" className="text-blue-800 border-blue-300">Setup required</Badge>
                  )}
                </div>
                <CardDescription className="text-blue-900/80">
                  Issue an inbound API key for Hope Hospital ERP. Hope uses this key to send diagnostic referrals
                  (lab/radiology orders) into CARE without re-entering patient data.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hopePartner ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="text-sm text-blue-900/90 flex-1">No HOPE partner provisioned yet.</p>
                    <Button onClick={() => createPartner.mutate()} disabled={createPartner.isPending}>
                      <KeyRound className="h-4 w-4 mr-1" />Create Hope Hospital partner
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{hopePartner.name}</span>
                      <Badge variant="outline">{hopePartner.code}</Badge>
                      {hopePartner.keyPrefix && <span className="text-muted-foreground font-mono text-xs">key {hopePartner.keyPrefix}…</span>}
                      <Badge variant={hopePartner.isActive ? "default" : "secondary"}>{hopePartner.isActive ? "active" : "inactive"}</Badge>
                      {hopePartner.lastUsedAt && <span className="text-xs text-muted-foreground">Last used {fmt(hopePartner.lastUsedAt)}</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">Partner active</span>
                        <Switch checked={hopePartner.isActive} onCheckedChange={(v) => togglePartner.mutate(v)} />
                      </div>
                      <Button variant="outline" size="sm" onClick={() => rotateKey.mutate()} disabled={rotateKey.isPending}>
                        <KeyRound className="h-4 w-4 mr-1" />Rotate API key
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">HOPE callback URL (where CARE sends results)</label>
                      <div className="flex gap-2 flex-wrap">
                        <Input
                          className="max-w-xl"
                          placeholder="https://hope.example/api/integration/care-callback"
                          value={callbackUrl || hopePartner.callbackUrl || ""}
                          onChange={(e) => setCallbackUrl(e.target.value)}
                        />
                        <Button variant="outline" onClick={() => saveCallback.mutate()} disabled={saveCallback.isPending}>Save</Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Also set <code className="text-[11px]">INTEGRATION_HOPE_SIGNING_SECRET</code> on the CARE server (env-only, never stored in DB).
                      </p>
                    </div>

                    <div className="rounded-md border bg-white/70 p-3 space-y-2 text-sm">
                      <div className="font-medium">Give Hope Hospital IT team:</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">Inbound URL:</span>
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded">{inboundUrl}</code>
                        <Button size="sm" variant="ghost" onClick={() => { copyText(inboundUrl); toast({ title: "Copied inbound URL" }); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Hope sends <code>Authorization: Bearer &lt;api-key&gt;</code> with each referral POST.
                        See <code>docs/hope-care-integration/04_HOPE_ADAPTER_REFERENCE.md</code> in the repo.
                      </p>
                    </div>
                  </div>
                )}

                {issuedKey && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="text-sm font-medium text-amber-900 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />API key — copy now, shown only once
                    </div>
                    <div className="flex gap-2">
                      <Input readOnly value={issuedKey} className="font-mono text-xs" />
                      <Button variant="outline" onClick={() => { copyText(issuedKey); toast({ title: "API key copied" }); }}>
                        <Copy className="h-4 w-4 mr-1" />Copy
                      </Button>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setIssuedKey(null)}>Dismiss</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">After connection</CardTitle>
                <CardDescription>Once Hope is sending referrals, staff use these modules (visible after Go Live).</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Link href="/hope-referrals"><Button variant="outline" size="sm"><ArrowRight className="h-4 w-4 mr-1" />HOPE Referrals inbox</Button></Link>
                <Link href="/diagnostic-integration"><Button variant="outline" size="sm"><ArrowRight className="h-4 w-4 mr-1" />Diagnostic Integration (sync health)</Button></Link>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── WhatsApp tab ── */}
          <TabsContent value="whatsapp" className="space-y-4 mt-4">
            <Card className="border-blue-200 bg-blue-50/80">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-blue-700" />
                  <CardTitle className="text-blue-950">Step 2 — WhatsApp for Hope patients</CardTitle>
                  {waReady ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Live</Badge>
                  ) : (
                    <Badge variant="outline" className="text-blue-800 border-blue-300">Configure WhatsApp</Badge>
                  )}
                </div>
                <CardDescription className="text-blue-900/80">
                  Hope-referred patients receive CARE bills, report-ready alerts, and booking links via WhatsApp.
                  Configure the Meta Cloud API once — all modules share the same WhatsApp account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>WhatsApp feature: <strong>{waHealth.data?.featureEnabled ? "enabled" : "disabled"}</strong></div>
                  <div>Master switch: <strong>{waHealth.data?.masterEnabled ? "on" : "off"}</strong></div>
                  <div>Outbound messaging: <strong>{waHealth.data?.outboundMessagingEnabled ? "on" : "off"}</strong></div>
                  <div>Emergency pause: <strong>{waHealth.data?.emergencyPaused ? "yes" : "no"}</strong></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/admin/integrations/whatsapp">
                    <Button><ExternalLink className="h-4 w-4 mr-1" />Open WhatsApp Integration settings</Button>
                  </Link>
                  <Link href="/whatsapp-chatbot"><Button variant="outline">WhatsApp Chatbot</Button></Link>
                </div>
                <p className="text-xs text-muted-foreground">
                  Hope partner booking page: <code>caredeoghar.com/book?source=hope</code> — configure allowed tests under
                  Settings → Online Booking → Hope Booking Catalog.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Go Live tab ── */}
          <TabsContent value="go-live" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Enable HOPE integration</CardTitle>
                <CardDescription>
                  Turning this on activates the inbound referral API, HOPE Referrals inbox, background sync workers,
                  and the Diagnostic Integration admin panel for all staff with access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <div className="font-medium">ff_hope_care_referrals</div>
                    <div className="text-sm text-muted-foreground">{hopeFlag?.description ?? "HOPE → CARE diagnostic referral integration"}</div>
                  </div>
                  <Switch
                    checked={hopeFlag?.enabled ?? false}
                    onCheckedChange={(v) => toggleFlag.mutate(v)}
                    disabled={toggleFlag.isPending || !hopeFlag}
                  />
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    {step1Done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    <span>Hope Hospital partner provisioned and active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {waReady ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                    <span>WhatsApp configured (recommended for patient notifications)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {step2Done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                    <span>Integration feature flag enabled</span>
                  </div>
                </div>

                {!step1Done && hopeFlag?.enabled && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                    The flag is on but no active HOPE partner exists — inbound referrals will be rejected until Step 1 is complete.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
