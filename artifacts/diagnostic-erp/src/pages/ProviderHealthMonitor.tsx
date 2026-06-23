import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

interface HealthLog {
  id: number;
  provider: string;
  model: string | null;
  latencyMs: number | null;
  status: string;
  isSuccess: boolean;
  errorMessage: string | null;
  createdAt: string;
}

interface ProviderAggregate {
  total: number;
  success: number;
  avgLatency: number;
  lastStatus: string;
  lastAt: string;
}

function statusIcon(s: string) {
  if (s === "healthy") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (s === "degraded") return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

export default function ProviderHealthMonitor() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [providerFilter, setProviderFilter] = useState("");
  const [logModal, setLogModal] = useState(false);
  const [form, setForm] = useState({ provider: "", status: "healthy", latencyMs: "", errorMessage: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["providerHealth", providerFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (providerFilter) params.set("provider", providerFilter);
      return await api.get<{ logs: HealthLog[]; providers: Record<string, ProviderAggregate> }>(`/api/ai-reporting/provider-health?${params.toString()}`);
    },
  });

  const logMutation = useMutation({
    mutationFn: async () => {
      return await api.post<{ id: number }>("/api/ai-reporting/provider-health", {
        provider: form.provider,
        status: form.status,
        latencyMs: form.latencyMs ? Number(form.latencyMs) : undefined,
        errorMessage: form.errorMessage || undefined,
        isSuccess: form.status === "healthy",
      });
    },
    onSuccess: () => {
      toast({ title: "Health check logged" });
      qc.invalidateQueries({ queryKey: ["providerHealth"] });
      setLogModal(false);
      setForm({ provider: "", status: "healthy", latencyMs: "", errorMessage: "" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const providers = data?.providers ?? {};

  return (
    <div className="space-y-6">
      <PageHeader title="AI Provider Health Monitor" subtitle="Phase 22 — Dashboard showing all AI providers — uptime, latency, error rate, last status." />
      <div className="flex gap-2 items-end">
        <div className="flex-1"><Label className="text-sm">Provider</Label><Input placeholder="Filter" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} /></div>
        <Button onClick={() => setLogModal(true)}><Activity className="w-4 h-4 mr-1" /> Log Check</Button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(providers).map(([name, p]) => (
          <Card key={name}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold">{statusIcon(p.lastStatus)} {name}</div>
              <div className="text-sm text-muted-foreground">Total: {p.total} | Success: {p.success} | Avg Latency: {p.avgLatency}ms</div>
              <div className="text-xs text-muted-foreground">Last: {new Date(p.lastAt).toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
        {Object.keys(providers).length === 0 && !isLoading && (
          <div className="col-span-3 text-center text-muted-foreground py-6">No provider health data yet.</div>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Latency</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead><TableHead>Time</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && (data?.logs?.length ?? 0) === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No logs.</TableCell></TableRow>}
              {data?.logs?.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.provider}</TableCell>
                  <TableCell>{log.model ?? "—"}</TableCell>
                  <TableCell>{log.latencyMs ?? "—"}ms</TableCell>
                  <TableCell><Badge variant={log.isSuccess ? "outline" : "destructive"}>{log.status}</Badge></TableCell>
                  <TableCell className="max-w-xs truncate text-red-500">{log.errorMessage ?? "—"}</TableCell>
                  <TableCell>{new Date(log.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={logModal} onOpenChange={setLogModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Log Health Check</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Provider</Label><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
            <div><Label>Status</Label>
              <select className="w-full border rounded px-2 py-1 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="healthy">healthy</option><option value="degraded">degraded</option><option value="error">error</option><option value="unreachable">unreachable</option>
              </select>
            </div>
            <div><Label>Latency (ms)</Label><Input value={form.latencyMs} onChange={(e) => setForm({ ...form, latencyMs: e.target.value })} /></div>
            <div><Label>Error Message</Label><Input value={form.errorMessage} onChange={(e) => setForm({ ...form, errorMessage: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogModal(false)}>Cancel</Button>
            <Button onClick={() => logMutation.mutate()} disabled={logMutation.isPending || !form.provider}>Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
