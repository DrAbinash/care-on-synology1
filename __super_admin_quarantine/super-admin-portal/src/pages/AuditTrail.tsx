import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Shield, Search, Download, Calendar, User, Layers, Activity,
  FileText, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface AuditLog {
  id: number;
  userId: number | null;
  userName: string;
  role: string;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface AuditResponse {
  data: AuditLog[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

const actionColor = (action: string) => {
  switch (action) {
    case "CREATE": return "bg-green-500/10 text-green-500 border-green-500/20";
    case "UPDATE": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    case "DELETE": return "bg-red-500/10 text-red-500 border-red-500/20";
    case "VIEW": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "PRINT": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
    case "EXPORT": return "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
    case "APPROVE": return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

export default function AuditTrail({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    userName: "",
    module: "",
    action: "",
    entityType: "",
    entityId: "",
  });
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.userName) params.set("userName", filters.userName);
  if (filters.module) params.set("module", filters.module);
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.entityId) params.set("entityId", filters.entityId);

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["/api/admin/audit-logs", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load audit logs");
      return res.json();
    },
  });

  const totalPages = data ? data.pagination.totalPages : 0;

  const exportCsv = async () => {
    try {
      const exportParams = new URLSearchParams(params.toString());
      exportParams.delete("page");
      exportParams.delete("pageSize");
      const res = await fetch(`/api/admin/audit-logs/export?${exportParams.toString()}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-trail_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: "CSV downloaded." });
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Audit Trail</h1>
              <p className="text-sm text-muted-foreground">Immutable log of every sensitive action across the system.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={14} className="mr-2" />Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
            <Filter size={14} />Filters
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="text-xs" />
            <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="text-xs" />
            <Input placeholder="User name" value={filters.userName} onChange={e => setFilters(f => ({ ...f, userName: e.target.value }))} className="text-xs" />
            <Input placeholder="Module" value={filters.module} onChange={e => setFilters(f => ({ ...f, module: e.target.value }))} className="text-xs" />
            <Input placeholder="Action" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} className="text-xs" />
            <Input placeholder="Entity type" value={filters.entityType} onChange={e => setFilters(f => ({ ...f, entityType: e.target.value }))} className="text-xs" />
            <Input placeholder="Entity ID" value={filters.entityId} onChange={e => setFilters(f => ({ ...f, entityId: e.target.value }))} className="text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setPage(1); }}><Search size={13} className="mr-1.5" />Apply</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFilters({ from:"",to:"",userName:"",module:"",action:"",entityType:"",entityId:"" }); setPage(1); }}>Reset</Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span><Activity size={13} className="inline mr-1" />{data?.pagination.total.toLocaleString() ?? 0} total records</span>
          <span>Page {page} of {totalPages || 1}</span>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading audit trail…</TableCell></TableRow>
                )}
                {!isLoading && (!data?.data || data.data.length === 0) && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No audit records match the filters.</TableCell></TableRow>
                )}
                {data?.data.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail(log)}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(log.createdAt)}</TableCell>
                    <TableCell className="text-xs font-medium">{log.userName}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{log.role}</Badge></TableCell>
                    <TableCell><Badge className={`text-[10px] ${actionColor(log.action)}`}>{log.action}</Badge></TableCell>
                    <TableCell className="text-xs">{log.module}</TableCell>
                    <TableCell className="text-xs">{log.entityType ?? "-"}{log.entityId ? ` #${log.entityId}` : ""}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{log.ipAddress ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft size={14} /></Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={14} /></Button>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield size={16} />Audit Record #{detail?.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">User</span><p className="font-medium">{detail?.userName}</p></div>
              <div><span className="text-muted-foreground">Role</span><p className="font-medium">{detail?.role}</p></div>
              <div><span className="text-muted-foreground">Action</span><p><Badge className={detail ? actionColor(detail.action) : ""}>{detail?.action}</Badge></p></div>
              <div><span className="text-muted-foreground">Module</span><p className="font-medium">{detail?.module}</p></div>
            </div>
            {detail?.reason && (
              <div className="bg-muted rounded-lg p-3">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">Reason</span>
                <p className="mt-1">{detail.reason}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div><User size={11} className="inline mr-1" />User ID: {detail?.userId ?? "N/A"}</div>
              <div><Calendar size={11} className="inline mr-1" />{detail ? formatDate(detail.createdAt) : ""}</div>
              <div><Layers size={11} className="inline mr-1" />Entity: {detail?.entityType ?? "-"} #{detail?.entityId ?? "-"}</div>
              <div><FileText size={11} className="inline mr-1" />IP: {detail?.ipAddress ?? "-"}</div>
            </div>
            {detail?.userAgent && (
              <div className="text-xs text-muted-foreground border-t border-border pt-2">
                User-Agent: {detail.userAgent.slice(0, 120)}{detail.userAgent.length > 120 ? "…" : ""}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
