import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, AlertTriangle, AlertCircle, XCircle, ShieldAlert, Eye, Plus } from "lucide-react";

interface AnomalyAlert {
  id: number;
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  scope: string | null;
  relatedId: number | null;
  relatedTable: string | null;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface SummaryItem {
  severity: string;
  status: string;
  count: number;
}

function severityIcon(severity: string) {
  switch (severity) {
    case "critical": return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "high": return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    case "medium": return <ShieldAlert className="w-4 h-4 text-yellow-500" />;
    default: return <CheckCircle className="w-4 h-4 text-blue-500" />;
  }
}

function severityBadge(severity: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    critical: "destructive",
    high: "destructive",
    medium: "secondary",
    low: "outline",
  };
  return <Badge variant={map[severity] ?? "outline"}>{severity.toUpperCase()}</Badge>;
}

function statusBadge(status: string) {
  const map: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
    open: "secondary",
    acknowledged: "default",
    resolved: "outline",
    ignored: "destructive",
  };
  return <Badge variant={map[status] ?? "outline"}>{status}</Badge>;
}

export default function AnomalyAlertsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [viewItem, setViewItem] = useState<AnomalyAlert | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ alertType: "", severity: "medium", message: "", scope: "", relatedId: "" });

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["anomalyAlerts", statusFilter, severityFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (severityFilter) params.set("severity", severityFilter);
      if (typeFilter) params.set("type", typeFilter);
      params.set("limit", "50");
      return await api.get<AnomalyAlert[]>(`/api/ai-reporting/anomaly-alerts?${params.toString()}`);
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["anomalyAlertsSummary"],
    queryFn: async () => {
      return await api.get<{ summary: SummaryItem[] }>("/api/ai-reporting/anomaly-alerts/summary");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      return await api.patch<{ ok: boolean }>(`/api/ai-reporting/anomaly-alerts/${id}`, { status, notes });
    },
    onSuccess: () => {
      toast({ title: "Alert updated" });
      qc.invalidateQueries({ queryKey: ["anomalyAlerts"] });
      qc.invalidateQueries({ queryKey: ["anomalyAlertsSummary"] });
      setViewItem(null);
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number }>("/api/ai-reporting/anomaly-alerts", {
        alertType: form.alertType,
        severity: form.severity,
        message: form.message,
        scope: form.scope || undefined,
        relatedId: form.relatedId ? Number(form.relatedId) : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Alert created" });
      qc.invalidateQueries({ queryKey: ["anomalyAlerts"] });
      qc.invalidateQueries({ queryKey: ["anomalyAlertsSummary"] });
      setCreateOpen(false);
      setForm({ alertType: "", severity: "medium", message: "", scope: "", relatedId: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const openCount = summary?.summary?.filter((s) => s.status === "open").reduce((a, c) => a + c.count, 0) ?? 0;
  const criticalCount = summary?.summary?.filter((s) => s.severity === "critical").reduce((a, c) => a + c.count, 0) ?? 0;
  const highCount = summary?.summary?.filter((s) => s.severity === "high").reduce((a, c) => a + c.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anomaly Detection & Alerting"
        subtitle="Phase 7 — Monitor unusual patterns in AI quality, radiology workflow, and system health."
      />

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <div>
              <div className="text-2xl font-bold">{criticalCount}</div>
              <div className="text-sm text-muted-foreground">Critical Alerts</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="w-8 h-8 text-orange-500" />
            <div>
              <div className="text-2xl font-bold">{highCount}</div>
              <div className="text-sm text-muted-foreground">High Alerts</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="w-8 h-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">{openCount}</div>
              <div className="text-sm text-muted-foreground">Open Alerts</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm">Status</Label>
          <Input placeholder="open / acknowledged / resolved / ignored" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-sm">Severity</Label>
          <Input placeholder="low / medium / high / critical" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-sm">Alert Type</Label>
          <Input placeholder="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Create Alert
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Acknowledged By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && alerts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No anomaly alerts found.</TableCell>
                </TableRow>
              )}
              {alerts.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="flex items-center gap-2">
                    {severityIcon(item.severity)}
                    {severityBadge(item.severity)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.alertType}</TableCell>
                  <TableCell className="max-w-sm truncate" title={item.message}>{item.message}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell>{item.acknowledgedByName ?? "—"}</TableCell>
                  <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewItem(item)} title="View">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View / Action dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {severityIcon(viewItem?.severity ?? "medium")}
              Alert #{viewItem?.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex gap-2">
              {severityBadge(viewItem?.severity ?? "medium")}
              {statusBadge(viewItem?.status ?? "open")}
            </div>
            <div><span className="text-muted-foreground">Type:</span> {viewItem?.alertType}</div>
            <div><span className="text-muted-foreground">Scope:</span> {viewItem?.scope ?? "—"}</div>
            <div><span className="text-muted-foreground">Related ID:</span> {viewItem?.relatedId ?? "—"}</div>
            <div>
              <span className="text-muted-foreground">Message:</span>
              <p className="mt-1 p-2 bg-muted rounded">{viewItem?.message}</p>
            </div>
            {viewItem?.acknowledgedByName && (
              <div>
                <span className="text-muted-foreground">Acknowledged by:</span> {viewItem.acknowledgedByName} on {new Date(viewItem.acknowledgedAt!).toLocaleString()}
              </div>
            )}
            {viewItem?.resolvedAt && (
              <div>
                <span className="text-muted-foreground">Resolved:</span> {new Date(viewItem.resolvedAt).toLocaleString()}
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setViewItem(null)}>Close</Button>
            {viewItem?.status === "open" && (
              <Button variant="default" onClick={() => viewItem && updateMutation.mutate({ id: viewItem.id, status: "acknowledged" })} disabled={updateMutation.isPending}>
                <CheckCircle className="w-4 h-4 mr-1" /> Acknowledge
              </Button>
            )}
            {viewItem?.status !== "resolved" && viewItem?.status !== "ignored" && (
              <Button variant="outline" onClick={() => viewItem && updateMutation.mutate({ id: viewItem.id, status: "resolved" })} disabled={updateMutation.isPending}>
                <CheckCircle className="w-4 h-4 mr-1" /> Resolve
              </Button>
            )}
            {viewItem?.status !== "ignored" && (
              <Button variant="ghost" onClick={() => viewItem && updateMutation.mutate({ id: viewItem.id, status: "ignored" })} disabled={updateMutation.isPending}>
                <XCircle className="w-4 h-4 mr-1" /> Ignore
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Anomaly Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Alert Type</Label><Input value={form.alertType} onChange={(e) => setForm({ ...form, alertType: e.target.value })} placeholder="e.g. LOW_CONFIDENCE_DRAFT" /></div>
            <div><Label>Severity</Label>
              <select className="w-full border rounded px-2 py-1 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <div><Label>Message</Label><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Describe the anomaly" /></div>
            <div><Label>Scope</Label><Input value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="e.g. radiology_worklist" /></div>
            <div><Label>Related ID</Label><Input value={form.relatedId} onChange={(e) => setForm({ ...form, relatedId: e.target.value })} placeholder="Optional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.alertType || !form.message}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
