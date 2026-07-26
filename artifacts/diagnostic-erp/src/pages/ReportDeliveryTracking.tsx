import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Send, CheckCheck, Check, Clock, XCircle, ShieldAlert, RefreshCw, Receipt } from "lucide-react";

type DeliverySettings = { mode: "manual" | "auto"; autoSendOnVerify: boolean; whatsappEnabled: boolean };
type Deliverable = {
  reportId: number; reportNumber: string; testName: string; reportStatus: string; type: string;
  billId: number | null; billNumber: string | null; patientId: number;
  patientFirstName: string | null; patientLastName: string | null; phone: string | null;
  createdAt: string; lastSendStatus: string | null;
};
type Receipt = {
  id: number; reportId: number | null; patientId: number | null; providerMessageId: string | null;
  phone: string; reportNumber: string | null; testName: string | null; patientName: string | null;
  status: string; sentAt: string; deliveredAt: string | null; readAt: string | null;
  sentByName: string | null; remindersCount: number;
};
type Summary = { sent: number; delivered: number; read: number; failed: number; total: number };

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: Check },
  delivered: { label: "Delivered", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: CheckCheck },
  read: { label: "Read", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", icon: CheckCheck },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: "bg-muted text-muted-foreground", icon: Clock };
  const Icon = s.icon;
  return <Badge variant="outline" className={`gap-1 ${s.cls}`}><Icon className="h-3 w-3" />{s.label}</Badge>;
}

export default function ReportDeliveryTracking() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["report-delivery-settings"],
    queryFn: () => api.get<DeliverySettings>("/api/report-delivery-tracking/settings"),
    retry: false,
  });

  const modeMut = useMutation({
    mutationFn: (mode: "manual" | "auto") => api.put<DeliverySettings>("/api/report-delivery-tracking/settings", { mode }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-delivery-settings"] }); toast({ title: "Delivery mode updated" }); },
    onError: (e) => toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (settingsQ.error) {
    const msg = (settingsQ.error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <div className="space-y-4">
        <PageHeader title="Report Delivery" subtitle="Staff-selected WhatsApp report delivery + read receipts" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">{shadow ? "Report delivery tracking is in Shadow Mode" : "Could not load"}</p>
            <p className="text-xs">{shadow ? "Enable the ff_report_delivery_receipts feature flag to use WhatsApp report delivery tracking." : msg}</p>
          </div>
        </Card>
      </div>
    );
  }

  const settings = settingsQ.data;
  const isAuto = settings?.mode === "auto";

  return (
    <div className="space-y-4">
      <PageHeader title="Report Delivery" subtitle="Staff-selected WhatsApp report delivery + read receipts + reminders" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4" /> Delivery Mode</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="mode" className="text-sm">{isAuto ? "Automatic — report sends on verify" : "Manual — staff selects reports to send"}</Label>
            <Switch id="mode" checked={isAuto} disabled={modeMut.isPending || settingsQ.isLoading}
              onCheckedChange={(v) => modeMut.mutate(v ? "auto" : "manual")} />
            <span className="text-sm font-medium">{isAuto ? "Auto" : "Manual"}</span>
          </div>
          {!settings?.whatsappEnabled && (
            <Badge variant="outline" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">WhatsApp is disabled in settings</Badge>
          )}
          <p className="text-xs text-muted-foreground basis-full">
            In manual mode, pick specific reports bill/test-wise below — the clinic sends selected reports, not every report automatically.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send">Send Reports</TabsTrigger>
          <TabsTrigger value="tracking">Delivery Tracking</TabsTrigger>
        </TabsList>
        <TabsContent value="send" className="mt-4"><SendTab /></TabsContent>
        <TabsContent value="tracking" className="mt-4"><TrackingTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function SendTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [onlyUnsent, setOnlyUnsent] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["deliverable-reports", onlyUnsent],
    queryFn: () => api.get<Deliverable[]>(`/api/report-delivery-tracking/deliverable?onlyUnsent=${onlyUnsent ? "true" : "false"}`),
  });

  const sendMut = useMutation({
    mutationFn: (reportIds: number[]) => api.post<{ sent: number; failed: number; total: number }>("/api/report-delivery-tracking/send", { reportIds }),
    onSuccess: (r) => {
      toast({ title: `Sent ${r.sent}/${r.total}`, description: r.failed ? `${r.failed} failed` : "All sent" });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["deliverable-reports"] });
      qc.invalidateQueries({ queryKey: ["delivery-receipts"] });
      qc.invalidateQueries({ queryKey: ["delivery-summary"] });
    },
    onError: (e) => toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" }),
  });

  const groups = useMemo(() => {
    const m = new Map<string, { billNumber: string | null; billId: number | null; rows: Deliverable[] }>();
    for (const r of reports) {
      const key = r.billId ? `bill-${r.billId}` : "unbilled";
      if (!m.has(key)) m.set(key, { billNumber: r.billNumber, billId: r.billId, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return Array.from(m.values());
  }, [reports]);

  const toggle = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (rows: Deliverable[]) => setSelected((prev) => {
    const n = new Set(prev);
    const allOn = rows.every((r) => n.has(r.reportId));
    for (const r of rows) { if (allOn) n.delete(r.reportId); else n.add(r.reportId); }
    return n;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyUnsent} onCheckedChange={(v) => setOnlyUnsent(Boolean(v))} />
          Show only unsent / failed
        </label>
        <Button disabled={selected.size === 0 || sendMut.isPending} onClick={() => sendMut.mutate(Array.from(selected))}>
          <Send className="h-4 w-4 mr-1.5" /> Send {selected.size > 0 ? `${selected.size} ` : ""}selected via WhatsApp
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : reports.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">No verified reports to send.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g, gi) => {
            const allOn = g.rows.every((r) => selected.has(r.reportId));
            return (
              <Card key={gi}>
                <CardHeader className="pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={allOn} onCheckedChange={() => toggleGroup(g.rows)} />
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{g.billNumber ? `Bill ${g.billNumber}` : "Unbilled reports"}</CardTitle>
                    <span className="text-xs text-muted-foreground">· {g.rows.length} report{g.rows.length > 1 ? "s" : ""}</span>
                  </label>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y">
                    {g.rows.map((r) => (
                      <label key={r.reportId} className="flex items-center gap-3 py-2 cursor-pointer">
                        <Checkbox checked={selected.has(r.reportId)} onCheckedChange={() => toggle(r.reportId)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.testName} <span className="text-xs text-muted-foreground">({r.reportNumber})</span></div>
                          <div className="text-xs text-muted-foreground truncate">
                            {(r.patientFirstName ?? "") + " " + (r.patientLastName ?? "")} · {r.phone ?? "no phone"}
                          </div>
                        </div>
                        {r.lastSendStatus && <StatusBadge status={r.lastSendStatus} />}
                        <Badge variant="outline" className="text-xs">{r.type}</Badge>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrackingTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["delivery-summary"],
    queryFn: () => api.get<Summary>("/api/report-delivery-tracking/receipts/summary"),
  });
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["delivery-receipts", statusFilter],
    queryFn: () => api.get<Receipt[]>(`/api/report-delivery-tracking/receipts${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const remindMut = useMutation({
    // The route can respond HTTP 200 with { ok: false, error } on a genuine
    // WhatsApp send failure -- it isn't only a network/HTTP-level failure.
    // Check the body before claiming success (the bulk "Send Reports" flow
    // elsewhere on this page already does this correctly via r.sent/r.failed).
    mutationFn: (id: number) => api.post<{ ok: boolean; error?: string }>(`/api/report-delivery-tracking/remind/${id}`, {}),
    onSuccess: (data) => {
      if (!data.ok) {
        toast({ title: "Reminder failed", description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: "Reminder sent" });
      qc.invalidateQueries({ queryKey: ["delivery-receipts"] });
    },
    onError: (e) => toast({ title: "Reminder failed", description: (e as Error).message, variant: "destructive" }),
  });

  const cards: Array<{ key: keyof Summary; label: string; cls: string }> = [
    { key: "sent", label: "Sent", cls: "text-blue-600" },
    { key: "delivered", label: "Delivered", cls: "text-amber-600" },
    { key: "read", label: "Read", cls: "text-green-600" },
    { key: "failed", label: "Failed", cls: "text-red-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card key={c.key} className={`cursor-pointer ${statusFilter === c.key ? "ring-2 ring-primary" : ""}`} onClick={() => setStatusFilter(statusFilter === c.key ? "" : c.key)}>
            <CardContent className="py-4 text-center">
              <div className={`text-2xl font-bold ${c.cls}`}>{summary?.[c.key] ?? 0}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : receipts.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">No delivery records yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead><TableHead>Report</TableHead><TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead><TableHead>Read</TableHead><TableHead>By</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[160px] truncate">{r.patientName || "—"}<div className="text-xs text-muted-foreground">{r.phone}</div></TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.testName}<div className="text-xs text-muted-foreground">{r.reportNumber}</div></TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs">{new Date(r.sentAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{r.readAt ? new Date(r.readAt).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs">{r.sentByName || "—"}</TableCell>
                      <TableCell>
                        {r.status !== "read" && (
                          <Button size="sm" variant="ghost" disabled={remindMut.isPending} onClick={() => remindMut.mutate(r.id)} title="Resend reminder">
                            <RefreshCw className="h-3.5 w-3.5" />{r.remindersCount > 0 ? <span className="ml-1 text-xs">{r.remindersCount}</span> : null}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
