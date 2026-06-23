import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Save, RefreshCw, Play, Trash2, X, CheckCircle2,
  AlertTriangle, Database, HardDrive, Cloud, Clock, Settings,
  ChevronDown, ChevronUp, Server, Info, Download, Upload, Archive,
  FileUp, FileDown, ShieldAlert,
} from "lucide-react";

interface BackupJob {
  id: number;
  jobName: string;
  backupType: string;
  destinationType: string;
  destinationPath: string | null;
  schedule: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  retentionDays: number;
  isEnabled: boolean;
  createdAt: string;
}

interface BackupJobLog {
  id: number;
  jobId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
  filePath: string | null;
  errorMessage: string | null;
  notes: string | null;
}

interface ExportResult {
  ok: boolean;
  filename: string;
  filePath: string;
  sizeBytes: number;
  downloadUrl?: string;
  includedFolders?: string[];
  metadata?: Record<string, unknown>;
}

const BACKUP_TYPES = ["DB", "REPORTS", "DICOM_METADATA", "CONFIG", "FULL"];
const DESTINATION_TYPES = ["LOCAL", "SYNOLOGY_NAS", "S3_COMPATIBLE", "GOOGLE_DRIVE_PLACEHOLDER"];

const DEST_ICONS: Record<string, typeof Server> = {
  LOCAL: HardDrive,
  SYNOLOGY_NAS: Server,
  S3_COMPATIBLE: Cloud,
  GOOGLE_DRIVE_PLACEHOLDER: Cloud,
};

const STATUS_CLASSES: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400",
};

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function JobForm({ job, onSave, onClose }: { job?: BackupJob; onSave: (d: object) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    jobName: job?.jobName ?? "",
    backupType: job?.backupType ?? "DB",
    destinationType: job?.destinationType ?? "LOCAL",
    destinationPath: job?.destinationPath ?? "",
    schedule: job?.schedule ?? "MANUAL",
    retentionDays: job?.retentionDays ?? 30,
    isEnabled: job?.isEnabled ?? true,
  });

  const DEST_PLACEHOLDER: Record<string, string> = {
    LOCAL: "/var/backups/diagnoscenter  or  C:\\Backups\\CareDiagnostics",
    SYNOLOGY_NAS: "\\\\SYNOLOGY-NAS\\care-diagnostics-backup  or  rsync://nas/backup",
    S3_COMPATIBLE: "s3://my-bucket/diagnoscenter-backups",
    GOOGLE_DRIVE_PLACEHOLDER: "Google Drive integration (not yet configured)",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl border shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{job ? "Edit Backup Job" : "New Backup Job"}</h2>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Job Name</label>
            <input value={form.jobName} onChange={(e) => setForm((f) => ({ ...f, jobName: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" placeholder="e.g. Nightly DB Backup" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Backup Type</label>
              <select value={form.backupType} onChange={(e) => setForm((f) => ({ ...f, backupType: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
                {BACKUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Destination</label>
              <select value={form.destinationType} onChange={(e) => setForm((f) => ({ ...f, destinationType: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
                {DESTINATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Destination Path</label>
            <input value={form.destinationPath} onChange={(e) => setForm((f) => ({ ...f, destinationPath: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background font-mono text-xs" placeholder={DEST_PLACEHOLDER[form.destinationType]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Schedule</label>
              <select value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background">
                <option value="MANUAL">Manual only</option>
                <option value="0 2 * * *">Daily 2:00 AM</option>
                <option value="0 2 * * 0">Weekly (Sunday)</option>
                <option value="0 2 1 * *">Monthly (1st)</option>
                <option value="CUSTOM">Custom cron…</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Retention (days)</label>
              <input type="number" min={1} max={365} value={form.retentionDays} onChange={(e) => setForm((f) => ({ ...f, retentionDays: Number(e.target.value) }))} className="w-full h-9 px-3 text-sm rounded-lg border bg-background" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))} className="w-4 h-4" />
            <span className="text-sm">Enable this job</span>
          </label>
        </div>
        <div className="flex gap-2 pt-2 border-t">
          <Button onClick={() => onSave(form)} className="flex-1 gap-2"><Save size={14} /> Save Job</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function BackupReplication() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<BackupJob | undefined>();
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ type: string; filePath: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: jobs = [], isLoading } = useQuery<BackupJob[]>({
    queryKey: ["backup-jobs"],
    queryFn: () => api.get("/api/admin/backup-replication/jobs"),
  });

  const { data: logs = [] } = useQuery<BackupJobLog[]>({
    queryKey: ["backup-job-logs", expandedJob],
    queryFn: () => api.get(`/api/admin/backup-replication/jobs/${expandedJob}/logs`),
    enabled: expandedJob !== null,
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => api.post("/api/admin/backup-replication/jobs", data),
    onSuccess: () => { toast({ title: "Backup job created" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); setShowForm(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => api.patch(`/api/admin/backup-replication/jobs/${id}`, data),
    onSuccess: () => { toast({ title: "Job updated" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); setShowForm(false); setEditingJob(undefined); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/backup-replication/jobs/${id}`),
    onSuccess: () => { toast({ title: "Job deleted" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: number) => api.post<{ message: string }>(`/api/admin/backup-replication/jobs/${id}/run`, {}),
    onSuccess: (r) => { toast({ title: r.message || "Backup started" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); if (expandedJob) void queryClient.invalidateQueries({ queryKey: ["backup-job-logs", expandedJob] }); },
    onError: (e: Error) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  // Direct export mutations
  const exportDbMutation = useMutation({
    mutationFn: () => api.post<ExportResult>("/api/admin/backup-replication/export-db", {}),
    onSuccess: (r) => {
      toast({ title: "Database exported", description: `${r.filename} (${formatBytes(r.sizeBytes)})` });
      if (r.downloadUrl) window.open(r.downloadUrl, "_blank");
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const exportFilesMutation = useMutation({
    mutationFn: () => api.post<ExportResult>("/api/admin/backup-replication/export-files", {}),
    onSuccess: (r) => {
      toast({ title: "Files exported", description: `${r.filename} (${formatBytes(r.sizeBytes)})` });
      if (r.downloadUrl) window.open(r.downloadUrl, "_blank");
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const exportSnapshotMutation = useMutation({
    mutationFn: () => api.post<ExportResult>("/api/admin/backup-replication/export-snapshot", {}),
    onSuccess: (r) => {
      toast({ title: "Snapshot exported", description: `${r.filename} (${formatBytes(r.sizeBytes)})` });
      if (r.downloadUrl) window.open(r.downloadUrl, "_blank");
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  // Import mutations
  const importDbMutation = useMutation({
    mutationFn: ({ filePath, confirm }: { filePath: string; confirm: boolean }) =>
      api.post("/api/admin/backup-replication/import-db", { filePath, confirm }),
    onSuccess: () => { toast({ title: "Database restored" }); setShowImportConfirm(null); setPendingImport(null); },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const importFilesMutation = useMutation({
    mutationFn: ({ filePath, confirm }: { filePath: string; confirm: boolean }) =>
      api.post("/api/admin/backup-replication/import-files", { filePath, confirm }),
    onSuccess: () => { toast({ title: "Files restored" }); setShowImportConfirm(null); setPendingImport(null); },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const importSnapshotMutation = useMutation({
    mutationFn: ({ filePath, confirm }: { filePath: string; confirm: boolean }) =>
      api.post("/api/admin/backup-replication/import-snapshot", { filePath, confirm }),
    onSuccess: () => { toast({ title: "Snapshot restored" }); setShowImportConfirm(null); setPendingImport(null); },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ filename, data }: { filename: string; data: string }) =>
      api.post<{ filePath: string }>("/api/admin/backup-replication/upload", { filename, data }),
    onSuccess: (r, vars) => {
      toast({ title: "File uploaded", description: vars.filename });
      if (pendingImport) {
        const fp = r.filePath;
        if (pendingImport.type === "db") importDbMutation.mutate({ filePath: fp, confirm: true });
        else if (pendingImport.type === "files") importFilesMutation.mutate({ filePath: fp, confirm: true });
        else if (pendingImport.type === "snapshot") importSnapshotMutation.mutate({ filePath: fp, confirm: true });
      }
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  function handleFileSelect(type: string) {
    setPendingImport({ type, filePath: "" });
    fileInputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !pendingImport) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({ filename: file.name, data: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const successJobs = jobs.filter((j) => j.lastStatus === "success").length;
  const failedJobs = jobs.filter((j) => j.lastStatus === "failed").length;
  const lastSuccess = jobs.filter((j) => j.lastStatus === "success").sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""))[0];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Backup & Replication"
        subtitle="Configure automated backup jobs and perform manual export/import for database and uploaded files"
        actions={
          <Button className="gap-2" onClick={() => { setEditingJob(undefined); setShowForm(true); }}>
            <Plus size={14} /> New Backup Job
          </Button>
        }
      />

      {/* Replit notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 flex gap-3 text-xs">
        <ShieldAlert size={14} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><strong>Manual export recommended on Replit.</strong> Scheduled backup jobs are not fully supported on Replit because the environment may sleep or restart. Use the buttons below for on-demand exports, and download the files to your local machine for safekeeping.</p>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-500" />
            <p className="text-sm font-semibold">Last Successful</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {lastSuccess?.lastRunAt ? new Date(lastSuccess.lastRunAt).toLocaleString() : "Never"}
          </p>
          {lastSuccess && <p className="text-[10px] text-muted-foreground mt-0.5">{lastSuccess.jobName}</p>}
        </div>
        <div className={`rounded-xl border bg-card p-4 ${failedJobs > 0 ? "border-red-200" : ""}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className={failedJobs > 0 ? "text-red-500" : "text-muted-foreground"} />
            <p className="text-sm font-semibold">Failed Jobs</p>
          </div>
          <p className={`text-2xl font-bold ${failedJobs > 0 ? "text-red-600" : "text-muted-foreground"}`}>{failedJobs}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Database size={16} className="text-blue-500" />
            <p className="text-sm font-semibold">Total Jobs</p>
          </div>
          <p className="text-2xl font-bold">{jobs.length}</p>
          <p className="text-xs text-muted-foreground">{jobs.filter((j) => j.isEnabled).length} enabled</p>
        </div>
      </div>

      {/* Export / Import Actions */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" disabled={exportDbMutation.isPending} onClick={() => exportDbMutation.mutate()}>
            <Database size={16} className="text-blue-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Export Database SQL</p>
              <p className="text-[10px] text-muted-foreground">caredeoghar-db-YYYY-MM-DD.sql</p>
            </div>
          </Button>
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" disabled={exportFilesMutation.isPending} onClick={() => exportFilesMutation.mutate()}>
            <FileDown size={16} className="text-green-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Export Files ZIP</p>
              <p className="text-[10px] text-muted-foreground">Uploads + reports + attached assets</p>
            </div>
          </Button>
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" disabled={exportSnapshotMutation.isPending} onClick={() => exportSnapshotMutation.mutate()}>
            <Archive size={16} className="text-purple-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Export Full Snapshot</p>
              <p className="text-[10px] text-muted-foreground">DB + files + metadata.json</p>
            </div>
          </Button>
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" onClick={() => { setPendingImport({ type: "db", filePath: "" }); fileInputRef.current?.click(); }}>
            <FileUp size={16} className="text-orange-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Import Database SQL</p>
              <p className="text-[10px] text-muted-foreground">Restore from .sql file</p>
            </div>
          </Button>
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" onClick={() => { setPendingImport({ type: "files", filePath: "" }); fileInputRef.current?.click(); }}>
            <Upload size={16} className="text-orange-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Import Files ZIP</p>
              <p className="text-[10px] text-muted-foreground">Restore uploaded files</p>
            </div>
          </Button>
          <Button variant="outline" className="gap-2 h-auto py-3 justify-start" onClick={() => { setPendingImport({ type: "snapshot", filePath: "" }); fileInputRef.current?.click(); }}>
            <Archive size={16} className="text-orange-500" />
            <div className="text-left">
              <p className="text-sm font-medium">Import Full Snapshot</p>
              <p className="text-[10px] text-muted-foreground">Restore DB + files from snapshot</p>
            </div>
          </Button>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" accept=".sql,.zip" onChange={onFileChange} />
      </div>

      {/* Synology hint */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-4 flex gap-3 text-xs">
        <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><strong>Synology NAS / Docker:</strong> Exported SQL is PostgreSQL 16 compatible. The ZIP can be extracted into a Docker volume mounted at <code className="bg-muted px-1 rounded">/app/data/uploads</code>. Do not overwrite <code className="bg-muted px-1 rounded">.env</code>, <code className="bg-muted px-1 rounded">docker-compose.yml</code>, or <code className="bg-muted px-1 rounded">Dockerfile</code> during import.</p>
        </div>
      </div>

      {/* Jobs list */}
      {isLoading && <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-muted-foreground" /></div>}

      {!isLoading && jobs.length === 0 && (
        <div className="rounded-xl border-2 border-dashed p-10 text-center space-y-3">
          <HardDrive size={32} className="mx-auto text-muted-foreground" />
          <p className="font-semibold">No backup jobs configured</p>
          <Button className="gap-2" onClick={() => setShowForm(true)}><Plus size={14} /> Create First Job</Button>
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const Icon = DEST_ICONS[job.destinationType] ?? HardDrive;
          const isExpanded = expandedJob === job.id;
          return (
            <div key={job.id} className="rounded-xl border bg-card overflow-hidden">
              <div className="p-4 flex items-center gap-3">
                <Icon size={18} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{job.jobName}</p>
                    <Badge variant="outline" className="text-[10px]">{job.backupType}</Badge>
                    <Badge variant="outline" className="text-[10px]">{job.destinationType}</Badge>
                    {!job.isEnabled && <Badge variant="outline" className="text-[10px] text-muted-foreground">Disabled</Badge>}
                    {job.lastStatus && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[job.lastStatus] ?? "bg-muted"}`}>{job.lastStatus}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span><Clock size={10} className="inline mr-0.5" />{job.schedule === "MANUAL" ? "Manual only" : job.schedule}</span>
                    {job.lastRunAt && <span>Last: {new Date(job.lastRunAt).toLocaleDateString()}</span>}
                    {job.destinationPath && <code className="truncate max-w-xs">{job.destinationPath}</code>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={runNowMutation.isPending} onClick={() => runNowMutation.mutate(job.id)}>
                    {runNowMutation.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
                    Run Now
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingJob(job); setShowForm(true); }}><Settings size={13} /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={() => { if (confirm("Delete this job?")) deleteMutation.mutate(job.id); }}><Trash2 size={13} /></Button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t bg-muted/10 p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground">Recent Runs</h4>
                  {logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No runs yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {logs.slice(0, 10).map((log) => (
                        <div key={log.id} className="flex items-center gap-3 text-xs p-2 rounded bg-background border">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${STATUS_CLASSES[log.status] ?? "bg-muted"}`}>{log.status}</span>
                          <span className="text-muted-foreground">{new Date(log.startedAt).toLocaleString()}</span>
                          {log.sizeBytes && <span>{formatBytes(log.sizeBytes)}</span>}
                          {log.rowCount && <span>{log.rowCount} rows</span>}
                          {log.errorMessage && <span className="text-red-500 truncate">{log.errorMessage}</span>}
                          {log.filePath && (
                            <a href={`/api/admin/backup-replication/download?file=${encodeURIComponent(log.filePath.split("/").pop() ?? "")}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                              <Download size={10} className="inline" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showForm && (
        <JobForm
          job={editingJob}
          onSave={(data) => editingJob ? updateMutation.mutate({ id: editingJob.id, data }) : createMutation.mutate(data)}
          onClose={() => { setShowForm(false); setEditingJob(undefined); }}
        />
      )}

      {/* Import confirmation dialog */}
      {showImportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowImportConfirm(null)} />
          <div className="relative bg-background rounded-xl border shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={20} />
              <h2 className="text-base font-semibold">Confirm Import</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will overwrite current data. A pre-restore backup will be created automatically. Continue?
            </p>
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="destructive" className="flex-1" onClick={() => {
                if (pendingImport?.type === "db") importDbMutation.mutate({ filePath: pendingImport.filePath, confirm: true });
                else if (pendingImport?.type === "files") importFilesMutation.mutate({ filePath: pendingImport.filePath, confirm: true });
                else if (pendingImport?.type === "snapshot") importSnapshotMutation.mutate({ filePath: pendingImport.filePath, confirm: true });
              }}>
                Yes, Continue
              </Button>
              <Button variant="outline" onClick={() => setShowImportConfirm(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
