import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Play, Trash2, ShieldAlert, BellRing } from "lucide-react";

type Rule = { id: number; label: string; matchType: "all" | "test"; matchValue: string | null; intervalDays: number; messageTemplate: string; enabled: boolean };
type QueueEntry = { id: number; patientId: number; reportId: number | null; testName: string | null; phone: string | null; patientName: string | null; dueDate: string; status: string; sentAt: string | null; remindersCount: number; lastError: string | null };
type QueueSummary = { pending: number; sent: number; snoozed: number; opted_out: number; cancelled: number; total: number };

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  sent: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  snoozed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  opted_out: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function RecallPage() {
  const q = useQuery({ queryKey: ["recall-rules"], queryFn: () => api.get<Rule[]>("/api/recall/rules"), retry: false });
  if (q.error) {
    const msg = (q.error as Error).message || "";
    const shadow = msg.includes("disabled") || msg.includes("503");
    return (
      <div className="space-y-4">
        <PageHeader title="Recall & Follow-up" subtitle="Automated patient recall reminders" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">{shadow ? "Recall engine is in Shadow Mode" : "Could not load"}</p>
            <p className="text-xs">{shadow ? "Enable the ff_recall_engine feature flag to configure recalls." : msg}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Recall & Follow-up" subtitle="Rules → daily due-recall queue → WhatsApp reminders" />
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4"><QueueTab /></TabsContent>
        <TabsContent value="rules" className="mt-4"><RulesTab rules={q.data ?? []} loading={q.isLoading} /></TabsContent>
      </Tabs>
    </div>
  );
}

function RulesTab({ rules, loading }: { rules: Rule[]; loading: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<{ label: string; matchType: "all" | "test"; matchValue: string; intervalDays: string; messageTemplate: string }>({
    label: "", matchType: "all", matchValue: "", intervalDays: "180", messageTemplate: "",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["recall-rules"] });
  const createMut = useMutation({
    mutationFn: () => api.post<Rule>("/api/recall/rules", {
      label: form.label, matchType: form.matchType, matchValue: form.matchType === "test" ? form.matchValue : null,
      intervalDays: Number(form.intervalDays), messageTemplate: form.messageTemplate,
    }),
    onSuccess: () => { toast({ title: "Rule created" }); setForm({ label: "", matchType: "all", matchValue: "", intervalDays: "180", messageTemplate: "" }); invalidate(); },
    onError: (e) => toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" }),
  });
  const toggleMut = useMutation({
    mutationFn: (r: Rule) => api.patch<Rule>(`/api/recall/rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: invalidate,
  });
  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/recall/rules/${id}`),
    onSuccess: () => { toast({ title: "Rule deleted" }); invalidate(); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recall Rules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />) :
            rules.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">No rules yet. Add one to start recalls.</p> :
            rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.matchType === "all" ? "All reports" : `Test contains "${r.matchValue}"`} · recall after {r.intervalDays} days
                  </div>
                </div>
                <Switch checked={r.enabled} onCheckedChange={() => toggleMut.mutate(r)} />
                <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add Rule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label className="text-xs">Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="USG 6-month recall" /></div>
          <div>
            <Label className="text-xs">Match</Label>
            <Select value={form.matchType} onValueChange={(v) => setForm({ ...form, matchType: v as "all" | "test" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reports</SelectItem>
                <SelectItem value="test">Test name contains…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.matchType === "test" && (
            <div><Label className="text-xs">Test name contains</Label><Input value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} placeholder="USG" /></div>
          )}
          <div><Label className="text-xs">Recall after (days)</Label><Input type="number" value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} /></div>
          <div><Label className="text-xs">Message (optional; {"{{name}} {{testName}} {{days}}"})</Label><Input value={form.messageTemplate} onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })} placeholder="Leave blank for default" /></div>
          <Button className="w-full" disabled={!form.label || !form.intervalDays || createMut.isPending} onClick={() => createMut.mutate()}>
            <BellRing className="h-4 w-4 mr-1.5" /> Add Rule
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function QueueTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");

  const { data: summary } = useQuery({ queryKey: ["recall-summary"], queryFn: () => api.get<QueueSummary>("/api/recall/queue/summary") });
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ["recall-queue", statusFilter],
    queryFn: () => api.get<QueueEntry[]>(`/api/recall/queue${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["recall-queue"] }); qc.invalidateQueries({ queryKey: ["recall-summary"] }); };
  const runMut = useMutation({
    mutationFn: () => api.post<{ generated: { queued: number }; sent: { sent: number } }>("/api/recall/run", {}),
    onSuccess: (r) => { toast({ title: "Recall run complete", description: `Queued ${r.generated.queued}, sent ${r.sent.sent}` }); invalidate(); },
    onError: (e) => toast({ title: "Run failed", description: (e as Error).message, variant: "destructive" }),
  });
  const actMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "snooze" | "cancel" | "opt_out" }) =>
      api.patch(`/api/recall/queue/${id}`, action === "snooze"
        ? { action, dueDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) }
        : { action }),
    onSuccess: invalidate,
  });

  const cards: Array<{ key: keyof QueueSummary; label: string; cls: string }> = [
    { key: "pending", label: "Pending", cls: "text-amber-600" },
    { key: "sent", label: "Sent", cls: "text-green-600" },
    { key: "snoozed", label: "Snoozed", cls: "text-blue-600" },
    { key: "opted_out", label: "Opted out", cls: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
          {cards.map((c) => (
            <Card key={c.key} className={`cursor-pointer ${statusFilter === c.key ? "ring-2 ring-primary" : ""}`} onClick={() => setStatusFilter(statusFilter === c.key ? "" : c.key)}>
              <CardContent className="py-3 text-center">
                <div className={`text-xl font-bold ${c.cls}`}>{summary?.[c.key] ?? 0}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}><Play className="h-4 w-4 mr-1.5" /> Run now</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div> :
            queue.length === 0 ? <div className="py-10 text-center text-muted-foreground text-sm"><CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-50" />No recalls in this view.</div> :
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Test</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {queue.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="max-w-[160px] truncate">{e.patientName || "—"}<div className="text-xs text-muted-foreground">{e.phone}</div></TableCell>
                      <TableCell className="max-w-[180px] truncate">{e.testName || "—"}</TableCell>
                      <TableCell className="text-xs">{e.dueDate}</TableCell>
                      <TableCell><Badge variant="outline" className={STATUS_CLS[e.status] ?? ""}>{e.status}</Badge></TableCell>
                      <TableCell>
                        {e.status === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" title="Snooze 7 days" onClick={() => actMut.mutate({ id: e.id, action: "snooze" })}>Snooze</Button>
                            <Button size="sm" variant="ghost" title="Opt out" onClick={() => actMut.mutate({ id: e.id, action: "opt_out" })}>Opt out</Button>
                            <Button size="sm" variant="ghost" title="Cancel" onClick={() => actMut.mutate({ id: e.id, action: "cancel" })}>Cancel</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>}
        </CardContent>
      </Card>
    </div>
  );
}
