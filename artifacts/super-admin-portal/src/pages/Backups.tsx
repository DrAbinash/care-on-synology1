import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Database, Download, Clock, CheckCircle2, AlertTriangle, HardDrive,
  Trash2, RotateCw, FileJson, ChevronRight, Calendar,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface BackupLog {
  id: number;
  backupType: "manual" | "auto" | "cron";
  status: "success" | "failed" | "running";
  format: string;
  rowCount: number;
  sizeBytes: number;
  performedBy: string;
  errorMessage: string | null;
  encrypted: boolean | null;
  createdAt: string;
}

interface BackupInfo {
  tables: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default function Backups({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<BackupLog | null>(null);

  const { data: logs, isLoading: logsLoading } = useQuery<BackupLog[]>({
    queryKey: ["/api/backup/logs"],
    queryFn: async () => {
      const res = await fetch("/api/backup/logs", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load backup logs");
      return res.json();
    },
  });

  const { data: info } = useQuery<BackupInfo>({
    queryKey: ["/api/backup/info"],
    queryFn: async () => {
      const res = await fetch("/api/backup/info", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load backup info");
      return res.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backup/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...saAuthHeaders() },
        body: JSON.stringify({ performedBy: "super-admin" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Backup failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "backup.json";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({ title: "Backup complete", description: "Your backup was generated and downloaded." });
      void queryClient.invalidateQueries({ queryKey: ["/api/backup/logs"] });
    },
    onError: (e: Error) => {
      toast({ title: "Backup failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/backups/${id}`, {
        method: "DELETE",
        headers: saAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete backup record");
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Backup record removed from log." });
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/backup/logs"] });
    },
    onError: (e: Error) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Success</Badge>;
    if (status === "failed") return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>;
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Running</Badge>;
  };

  return (
    <div className="min-h-screen w-full bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={14} /></Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Database Backups</h1>
            <p className="text-sm text-muted-foreground">Generate, track, and manage backups of master data and settings.</p>
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <HardDrive size={13} />Tables in Backup
            </div>
            <p className="text-2xl font-bold">{info?.tables.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">Settings + master data only</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Clock size={13} />Total Backups
            </div>
            <p className="text-2xl font-bold">{logs?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">From all sources</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-muted-foreground text-xs uppercase tracking-wide">
              <CheckCircle2 size={13} />Success Rate
            </div>
            <p className="text-2xl font-bold">
              {logs && logs.length > 0
                ? `${Math.round((logs.filter(l => l.status === "success").length / logs.length) * 100)}%`
                : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Historical runs</p>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileJson size={14} />JSON export format
          </div>
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <RotateCw size={14} className={`mr-2 ${runMutation.isPending ? "animate-spin" : ""}`} />
            {runMutation.isPending ? "Generating backup…" : "Run Backup Now"}
          </Button>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
            <Database size={14} className="text-primary" />
            Backup History
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading backup history…</TableCell></TableRow>
                )}
                {!logsLoading && (!logs || logs.length === 0) && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No backups yet.</TableCell></TableRow>
                )}
                {logs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{log.backupType}</Badge>
                    </TableCell>
                    <TableCell>{statusBadge(log.status)}</TableCell>
                    <TableCell>{log.rowCount.toLocaleString()}</TableCell>
                    <TableCell>{formatBytes(log.sizeBytes)}</TableCell>
                    <TableCell>{log.performedBy}</TableCell>
                    <TableCell>{formatDate(log.createdAt)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={() => setConfirmDelete(log)}>
                        <Trash2 size={13} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Tables covered */}
        {info?.tables && info.tables.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm font-medium mb-2">Tables included in backup</p>
            <div className="flex flex-wrap gap-2">
              {info.tables.map(t => (
                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove backup record?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the log entry for the backup created on {confirmDelete ? formatDate(confirmDelete.createdAt) : ""}. The actual file is not affected.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)} disabled={deleteMutation.isPending}>
              Remove Record
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
