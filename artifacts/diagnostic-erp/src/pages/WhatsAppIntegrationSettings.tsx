// =============================================================================
// Unified WhatsApp Cloud API Settings — /admin/integrations/whatsapp
//
// ONE settings surface for every WhatsApp concern: provider/credentials,
// numbers, webhook diagnostics, automation controls (shadow mode, allowlist,
// quiet hours, limits, emergency pause), templates, consent/safety, and the
// outbox health/diagnostics panel. Backed entirely by routes/whatsapp.ts —
// see the completion report for the full endpoint list. Never renders a
// complete secret; the backend masks accessToken/appSecret to "••••••••".
// =============================================================================
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Save, RefreshCw, PlusCircle, Trash2, Send, ShieldAlert, ShieldCheck,
  Activity, Webhook as WebhookIcon, Settings2, MessageSquare, KeyRound, PauseCircle, PlayCircle,
} from "lucide-react";

interface WaSettings {
  id: number;
  enabled: boolean;
  outboundMessagingEnabled: boolean;
  inboundProcessingEnabled: boolean;
  phoneNumberId: string;
  accessToken: string; // masked
  appSecret: string; // masked
  businessDisplayName: string;
  graphApiVersion: string;
  wabaId: string;
  webhookVerifyToken: string;
  defaultCountryCode: string;
  templateName: string;
  templateLang: string;
  lastSuccessfulCheckAt: string | null;
  lastCheckError: string;
  lastCheckErrorAt: string | null;
  lastWebhookReceivedAt: string | null;
  lastValidSignatureAt: string | null;
  lastRejectedSignatureAt: string | null;
  rejectedSignatureCount: number;
  shadowMode: boolean;
  testAllowlist: string[];
  blockNonAllowlisted: boolean;
  reportReadyMessagesEnabled: boolean;
  paymentMessagesEnabled: boolean;
  appointmentReminderEnabled: boolean;
  duesReminderEnabled: boolean;
  autoSendBillCreated: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxRetryAttempts: number;
  retryDelayBaseSeconds: number;
  dailyMessageLimit: number;
  monthlyMessageBudgetWarning: number;
  emergencyPaused: boolean;
  emergencyPausedReason: string;
  emergencyPausedAt: string | null;
  transactionalMessagesAllowed: boolean;
  reminderMessagesAllowed: boolean;
  marketingMessagesAllowed: boolean;
  stopStartHandlingEnabled: boolean;
  phiProtectionEnabled: boolean;
  secureReportLinkRequired: boolean;
  aiAssistantEnabled: boolean;
}

interface WaNumber {
  id: number;
  name: string;
  phoneNumberId: string;
  displayNumber: string;
  accessToken: string; // masked
  role: string;
  enabled: boolean;
  isDefault: boolean;
  connectionStatus?: string;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
}

interface WaHealth {
  featureEnabled: boolean;
  masterEnabled: boolean;
  outboundMessagingEnabled: boolean;
  emergencyPaused: boolean;
  emergencyPausedReason: string | null;
  shadowMode: boolean;
  outbox: { queued: number; processing: number; failed: number; deadLetter: number; suppressed: number; lastSent: string | null; lastDelivered: string | null; lastRead: string | null };
  webhook: { lastWebhookReceivedAt: string | null; lastValidSignatureAt: string | null; lastRejectedSignatureAt: string | null; rejectedSignatureCount: number };
}

interface WaOutboxRow {
  id: number; recipientPhone: string; messagePurpose: string; status: string;
  attemptCount: number; maxAttempts: number; lastErrorMessage: string | null;
  nextAttemptAt: string; createdAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
}

export default function WhatsAppIntegrationSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("provider");
  const [form, setForm] = useState<Partial<WaSettings>>({});
  const [allowlistInput, setAllowlistInput] = useState("");
  const [newNumber, setNewNumber] = useState({ name: "", phoneNumberId: "", displayNumber: "", accessToken: "", role: "general" });
  const [testPhone, setTestPhone] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  const { data: settings, isLoading } = useQuery<WaSettings>({
    queryKey: ["wa-settings"],
    queryFn: () => api.get("/api/whatsapp/settings"),
  });
  const { data: numbers } = useQuery<WaNumber[]>({
    queryKey: ["wa-numbers"],
    queryFn: () => api.get("/api/whatsapp/numbers"),
  });
  const { data: health, refetch: refetchHealth } = useQuery<WaHealth>({
    queryKey: ["wa-health"],
    queryFn: () => api.get("/api/whatsapp/health"),
    refetchInterval: 30_000,
  });
  const { data: outboxRows } = useQuery<WaOutboxRow[]>({
    queryKey: ["wa-outbox", "dead_letter"],
    queryFn: () => api.get("/api/whatsapp/outbox?status=dead_letter&limit=50"),
    enabled: tab === "health",
  });

  const s: WaSettings | undefined = settings;
  const merged = { ...s, ...form };

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put("/api/whatsapp/settings", body),
    onSuccess: () => {
      toast({ title: "Saved" });
      setForm({});
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
    },
    onError: (e: unknown) => toast({ title: "Save failed", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });

  const pauseMutation = useMutation({
    mutationFn: (reason: string) => api.post("/api/whatsapp/emergency-pause", { reason }),
    onSuccess: () => { toast({ title: "WhatsApp sending paused" }); qc.invalidateQueries({ queryKey: ["wa-settings"] }); qc.invalidateQueries({ queryKey: ["wa-health"] }); },
  });
  const resumeMutation = useMutation({
    mutationFn: () => api.post("/api/whatsapp/emergency-resume", {}),
    onSuccess: () => { toast({ title: "WhatsApp sending resumed" }); qc.invalidateQueries({ queryKey: ["wa-settings"] }); qc.invalidateQueries({ queryKey: ["wa-health"] }); },
  });
  const testConnMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>("/api/whatsapp/test-connection", {}),
    onSuccess: (r) => toast({ title: r.ok ? "Connection OK" : "Connection failed", description: r.error, variant: r.ok ? undefined : "destructive" }),
  });
  const testSendMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string; skipped?: boolean }>("/api/whatsapp/test", { phone: testPhone }),
    onSuccess: (r) => toast({ title: r.ok ? "Test message queued" : (r.skipped ? "Skipped (disabled / shadow mode)" : "Test send failed"), description: r.error, variant: r.ok || r.skipped ? undefined : "destructive" }),
  });
  const retryMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/whatsapp/outbox/${id}/retry`, {}),
    onSuccess: () => { toast({ title: "Retry queued" }); qc.invalidateQueries({ queryKey: ["wa-outbox"] }); qc.invalidateQueries({ queryKey: ["wa-health"] }); },
  });
  const addNumberMutation = useMutation({
    mutationFn: () => api.post("/api/whatsapp/numbers", newNumber),
    onSuccess: () => { toast({ title: "Number added" }); setNewNumber({ name: "", phoneNumberId: "", displayNumber: "", accessToken: "", role: "general" }); qc.invalidateQueries({ queryKey: ["wa-numbers"] }); },
    onError: (e: unknown) => toast({ title: "Failed to add number", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });
  const deleteNumberMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/whatsapp/numbers/${id}`),
    onSuccess: () => { toast({ title: "Number removed" }); qc.invalidateQueries({ queryKey: ["wa-numbers"] }); },
    onError: (e: unknown) => toast({ title: "Failed to remove", description: String((e as Error)?.message ?? e), variant: "destructive" }),
  });
  const toggleNumberMutation = useMutation({
    mutationFn: (p: { id: number; enabled: boolean }) => api.put(`/api/whatsapp/numbers/${p.id}`, { enabled: p.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-numbers"] }),
  });

  function set<K extends keyof WaSettings>(key: K, value: WaSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function save(extra?: Record<string, unknown>) {
    saveMutation.mutate({ ...form, ...extra });
  }

  if (isLoading || !s) {
    return <div className="p-8 text-center text-muted-foreground">Loading WhatsApp settings…</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp Integration"
        subtitle="Meta WhatsApp Business Cloud API — the ONE place every WhatsApp setting lives."
        actions={
          <div className="flex items-center gap-2">
            {health?.emergencyPaused ? (
              <Badge variant="destructive" className="gap-1"><PauseCircle className="h-3 w-3" /> Emergency paused</Badge>
            ) : health?.featureEnabled ? (
              <Badge variant="default" className="gap-1"><ShieldCheck className="h-3 w-3" /> Live</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1"><ShieldAlert className="h-3 w-3" /> Feature flag off</Badge>
            )}
            {health?.shadowMode && <Badge variant="outline">Shadow mode</Badge>}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="provider"><KeyRound className="h-4 w-4 mr-1" />Provider &amp; Credentials</TabsTrigger>
            <TabsTrigger value="numbers"><MessageSquare className="h-4 w-4 mr-1" />Numbers</TabsTrigger>
            <TabsTrigger value="webhook"><WebhookIcon className="h-4 w-4 mr-1" />Webhook</TabsTrigger>
            <TabsTrigger value="automation"><Settings2 className="h-4 w-4 mr-1" />Automation</TabsTrigger>
            <TabsTrigger value="safety"><ShieldCheck className="h-4 w-4 mr-1" />Consent &amp; Safety</TabsTrigger>
            <TabsTrigger value="health"><Activity className="h-4 w-4 mr-1" />Health</TabsTrigger>
          </TabsList>

          {/* ── A/B: Provider & Credentials ── */}
          <TabsContent value="provider" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Provider</CardTitle>
                <CardDescription>Meta is the only supported production provider. Evolution API and other adapters are not used for real patient messaging.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">WhatsApp enabled</div>
                    <div className="text-sm text-muted-foreground">Master switch — off disables all outbound sending.</div>
                  </div>
                  <Switch checked={merged.enabled ?? false} onCheckedChange={(v) => set("enabled", v)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Business display name</label>
                    <Input value={merged.businessDisplayName ?? ""} onChange={(e) => set("businessDisplayName", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Graph API version</label>
                    <Input value={merged.graphApiVersion ?? ""} onChange={(e) => set("graphApiVersion", e.target.value)} placeholder="v21.0" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">WABA ID</label>
                    <Input value={merged.wabaId ?? ""} onChange={(e) => set("wabaId", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Default country code</label>
                    <Input value={merged.defaultCountryCode ?? ""} onChange={(e) => set("defaultCountryCode", e.target.value)} placeholder="91" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credentials</CardTitle>
                <CardDescription>Stored encrypted. Never re-displayed — leave blank to keep the current value.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Access token {s.accessToken && <Badge variant="outline" className="ml-1">configured</Badge>}</label>
                    <Input type="password" placeholder="••••••••" value={form.accessToken ?? ""} onChange={(e) => set("accessToken", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Default phone number ID</label>
                    <Input value={merged.phoneNumberId ?? ""} onChange={(e) => set("phoneNumberId", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">App secret (webhook HMAC) {s.appSecret && <Badge variant="outline" className="ml-1">configured</Badge>}</label>
                    <Input type="password" placeholder="••••••••" value={form.appSecret ?? ""} onChange={(e) => set("appSecret", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Template name / language</label>
                    <div className="flex gap-2">
                      <Input value={merged.templateName ?? ""} onChange={(e) => set("templateName", e.target.value)} placeholder="bill_ready" />
                      <Input className="w-24" value={merged.templateLang ?? ""} onChange={(e) => set("templateLang", e.target.value)} placeholder="en" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={() => save()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
                  <Button variant="outline" onClick={() => testConnMutation.mutate()} disabled={testConnMutation.isPending}>
                    <RefreshCw className="h-4 w-4 mr-1" />Test config
                  </Button>
                  {s.lastCheckError && <span className="text-sm text-destructive">Last error: {s.lastCheckError} ({fmt(s.lastCheckErrorAt)})</span>}
                  {!s.lastCheckError && s.lastSuccessfulCheckAt && <span className="text-sm text-muted-foreground">Last verified: {fmt(s.lastSuccessfulCheckAt)}</span>}
                </div>
                <Separator />
                <div className="flex items-center gap-2">
                  <Input className="max-w-xs" placeholder="Recipient phone for test send" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                  <Button variant="outline" onClick={() => testSendMutation.mutate()} disabled={!testPhone || testSendMutation.isPending}>
                    <Send className="h-4 w-4 mr-1" />Send test template
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── C: Numbers ── */}
          <TabsContent value="numbers" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle>WhatsApp numbers</CardTitle><CardDescription>Route messages by role (general / Form F / reports).</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Phone number ID</TableHead><TableHead>Role</TableHead>
                      <TableHead>Status</TableHead><TableHead>Enabled</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(numbers ?? []).map((n) => (
                      <TableRow key={n.id}>
                        <TableCell>{n.name}{n.isDefault && <Badge variant="outline" className="ml-2">default</Badge>}</TableCell>
                        <TableCell className="font-mono text-xs">{n.phoneNumberId}</TableCell>
                        <TableCell>{n.role}</TableCell>
                        <TableCell>{n.connectionStatus ?? "—"}</TableCell>
                        <TableCell><Switch checked={n.enabled} onCheckedChange={(v) => toggleNumberMutation.mutate({ id: n.id, enabled: v })} /></TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => deleteNumberMutation.mutate(n.id)} disabled={n.isDefault}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!numbers || numbers.length === 0) && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No numbers configured — the legacy single-number credentials above are used.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <Separator className="my-4" />
                <div className="grid gap-2 sm:grid-cols-5">
                  <Input placeholder="Name" value={newNumber.name} onChange={(e) => setNewNumber((v) => ({ ...v, name: e.target.value }))} />
                  <Input placeholder="Phone number ID" value={newNumber.phoneNumberId} onChange={(e) => setNewNumber((v) => ({ ...v, phoneNumberId: e.target.value }))} />
                  <Input placeholder="Access token" type="password" value={newNumber.accessToken} onChange={(e) => setNewNumber((v) => ({ ...v, accessToken: e.target.value }))} />
                  <Select value={newNumber.role} onValueChange={(v) => setNewNumber((n) => ({ ...n, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="form_f">Form F</SelectItem>
                      <SelectItem value="reports">Reports</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={() => addNumberMutation.mutate()} disabled={!newNumber.name || !newNumber.phoneNumberId}>
                    <PlusCircle className="h-4 w-4 mr-1" />Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── D: Webhook ── */}
          <TabsContent value="webhook" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Webhook</CardTitle>
                <CardDescription>
                  ONE endpoint: <code>POST /api/whatsapp/webhook</code>. Signature-verified against the App Secret above
                  (<code>x-hub-signature-256</code>, HMAC-SHA256, fail-closed) before anything is processed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Verify token (GET subscription challenge)</label>
                    <Input value={merged.webhookVerifyToken ?? ""} onChange={(e) => set("webhookVerifyToken", e.target.value)} />
                  </div>
                </div>
                <Button onClick={() => save()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
                <Separator />
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>Last webhook received: <strong>{fmt(s.lastWebhookReceivedAt)}</strong></div>
                  <div>Last valid signature: <strong>{fmt(s.lastValidSignatureAt)}</strong></div>
                  <div>Last rejected signature: <strong>{fmt(s.lastRejectedSignatureAt)}</strong></div>
                  <div>Rejected signature count: <strong>{s.rejectedSignatureCount}</strong></div>
                </div>
                {s.rejectedSignatureCount > 0 && (
                  <p className="text-sm text-amber-600">Rejected signatures usually mean the App Secret here doesn't match the Meta App's App Secret, or a stale second webhook is still configured in the Meta dashboard.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── E: Automation controls ── */}
          <TabsContent value="automation" className="space-y-4 mt-4">
            <Card className={health?.emergencyPaused ? "border-destructive" : undefined}>
              <CardHeader><CardTitle>Emergency pause</CardTitle><CardDescription>Stops ALL outbound sending immediately — no redeploy needed.</CardDescription></CardHeader>
              <CardContent className="flex items-center gap-2 flex-wrap">
                {health?.emergencyPaused ? (
                  <>
                    <Badge variant="destructive">Paused: {health.emergencyPausedReason}</Badge>
                    <Button variant="default" onClick={() => resumeMutation.mutate()}><PlayCircle className="h-4 w-4 mr-1" />Resume sending</Button>
                  </>
                ) : (
                  <>
                    <Input className="max-w-sm" placeholder="Reason (shown to staff)" value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} />
                    <Button variant="destructive" onClick={() => pauseMutation.mutate(pauseReason)}><PauseCircle className="h-4 w-4 mr-1" />Emergency pause</Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Shadow mode &amp; test allowlist</CardTitle><CardDescription>Outside production, an empty allowlist blocks ALL real sends. Shadow mode queues and validates every message but never calls Meta unless the recipient is allowlisted.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Shadow mode</div>
                  <Switch checked={merged.shadowMode ?? false} onCheckedChange={(v) => set("shadowMode", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="font-medium">Block non-allowlisted (non-production)</div>
                  <Switch checked={merged.blockNonAllowlisted ?? false} onCheckedChange={(v) => set("blockNonAllowlisted", v)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Test allowlist (E.164, comma-separated)</label>
                  <div className="flex gap-2">
                    <Input value={allowlistInput || (merged.testAllowlist ?? []).join(", ")} onChange={(e) => setAllowlistInput(e.target.value)} placeholder="919876543210, 919812345678" />
                    <Button variant="outline" onClick={() => { set("testAllowlist", allowlistInput.split(",").map((x) => x.trim()).filter(Boolean) as unknown as string[]); }}>Apply</Button>
                  </div>
                  <div className="flex gap-1 flex-wrap mt-2">
                    {(merged.testAllowlist ?? []).map((n) => <Badge key={n} variant="outline">{n}</Badge>)}
                  </div>
                </div>
                <Button onClick={() => save()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Per-type toggles, quiet hours &amp; limits</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["outboundMessagingEnabled", "Outbound messaging"],
                    ["inboundProcessingEnabled", "Inbound processing (bot replies)"],
                    ["appointmentReminderEnabled", "Appointment reminders"],
                    ["duesReminderEnabled", "Dues reminders"],
                    ["reportReadyMessagesEnabled", "Report-ready notifications"],
                    ["paymentMessagesEnabled", "Payment link messages"],
                    ["autoSendBillCreated", "Auto-send on bill created"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <div className="text-sm">{label}</div>
                      <Switch checked={!!merged[key]} onCheckedChange={(v) => set(key, v as never)} />
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">Quiet hours start (HH:MM, blank = off)</label>
                    <Input value={merged.quietHoursStart ?? ""} onChange={(e) => set("quietHoursStart", e.target.value)} placeholder="21:00" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Quiet hours end (HH:MM)</label>
                    <Input value={merged.quietHoursEnd ?? ""} onChange={(e) => set("quietHoursEnd", e.target.value)} placeholder="08:00" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Max retry attempts</label>
                    <Input type="number" min={1} max={20} value={merged.maxRetryAttempts ?? 5} onChange={(e) => set("maxRetryAttempts", Number(e.target.value) as never)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Daily message limit (0 = unlimited)</label>
                    <Input type="number" min={0} value={merged.dailyMessageLimit ?? 0} onChange={(e) => set("dailyMessageLimit", Number(e.target.value) as never)} />
                  </div>
                </div>
                <Button onClick={() => save()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── G: Consent & Safety ── */}
          <TabsContent value="safety" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle>Consent &amp; safety</CardTitle><CardDescription>STOP/START opt-out and the DOB gate are always enforced regardless of these toggles — they cannot be switched off from here.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["transactionalMessagesAllowed", "Transactional messages (bills, reports, OTP)"],
                    ["reminderMessagesAllowed", "Reminder messages (appointments, dues)"],
                    ["marketingMessagesAllowed", "Marketing messages"],
                    ["secureReportLinkRequired", "Require secure/tokenized report links"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <div className="text-sm">{label}</div>
                      <Switch checked={!!merged[key]} onCheckedChange={(v) => set(key, v as never)} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between opacity-60">
                    <div className="text-sm">STOP/START handling (always on)</div>
                    <Switch checked disabled />
                  </div>
                  <div className="flex items-center justify-between opacity-60">
                    <div className="text-sm">PHI protection (always on)</div>
                    <Switch checked disabled />
                  </div>
                </div>
                <Button onClick={() => save()} disabled={saveMutation.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── H: Health & Diagnostics ── */}
          <TabsContent value="health" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{health?.outbox.queued ?? 0}</div><div className="text-xs text-muted-foreground">Queued</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{health?.outbox.processing ?? 0}</div><div className="text-xs text-muted-foreground">Processing</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-destructive">{health?.outbox.deadLetter ?? 0}</div><div className="text-xs text-muted-foreground">Dead-lettered</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{health?.outbox.suppressed ?? 0}</div><div className="text-xs text-muted-foreground">Suppressed (shadow mode)</div></CardContent></Card>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div>Last sent: <strong>{fmt(health?.outbox.lastSent)}</strong></div>
              <div>Last delivered: <strong>{fmt(health?.outbox.lastDelivered)}</strong></div>
              <div>Last read: <strong>{fmt(health?.outbox.lastRead)}</strong></div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchHealth()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>

            <Card>
              <CardHeader><CardTitle>Dead-lettered messages</CardTitle><CardDescription>Permanently failed after max retry attempts. Retry after fixing the underlying issue.</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Phone</TableHead><TableHead>Purpose</TableHead><TableHead>Attempts</TableHead><TableHead>Error</TableHead><TableHead>Created</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {(outboxRows ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.recipientPhone}</TableCell>
                        <TableCell>{r.messagePurpose}</TableCell>
                        <TableCell>{r.attemptCount}/{r.maxAttempts}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-xs truncate">{r.lastErrorMessage}</TableCell>
                        <TableCell className="text-xs">{fmt(r.createdAt)}</TableCell>
                        <TableCell><Button size="sm" variant="outline" onClick={() => retryMutation.mutate(r.id)}>Retry</Button></TableCell>
                      </TableRow>
                    ))}
                    {(!outboxRows || outboxRows.length === 0) && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No dead-lettered messages.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
