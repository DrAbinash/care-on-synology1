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
  /** What the server could prove about this job's last artifact. Absent on an older server. */
  evidence?: JobEvidence;
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

/** The four states the server's evidence layer can answer with. UNKNOWN is not a soft warning:
 *  it means CARE could not look, and the page must not guess on top of that. */
type EvidenceState = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";

const EVIDENCE_CLASSES: Record<EvidenceState, string> = {
  HEALTHY: "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400",
  WARNING: "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
  UNKNOWN: "bg-gray-100 text-gray-700 dark:bg-gray-950/40 dark:text-gray-400",
};

const EVIDENCE_ICON_CLASS: Record<EvidenceState, string> = {
  HEALTHY: "text-green-500",
  WARNING: "text-amber-500",
  CRITICAL: "text-red-500",
  UNKNOWN: "text-muted-foreground",
};

interface JobEvidence {
  jobId: number;
  jobName: string;
  state: EvidenceState;
  reasons: string[];
  scheduleLabel: string;
  nextRunAt: string | null;
  dueNow: boolean;
  overdue: boolean;
  artifact: {
    status: "present" | "missing" | "mismatched" | "not-recorded" | "not-checked";
    path: string | null;
    sizeBytes: number | null;
    modifiedAt: string | null;
    checksumRecorded: boolean;
  };
  verified: boolean;
}

interface BackupStatus {
  generatedAt: string;
  serverTimezone: string;
  jobs: { id: number; jobName: string; backupType: string; destinationPath: string | null; isEnabled: boolean; evidence: JobEvidence }[];
  overview: {
    lastVerifiedAt: string | null;
    lastVerifiedJob: string | null;
    lastVerifiedSizeBytes: number | null;
    nextScheduledAt: string | null;
    nextScheduledJob: string | null;
    needsAttention: { jobId: number; jobName: string; state: EvidenceState; reasons: string[] }[];
    counts: Record<EvidenceState, number>;
    anyDueNow: boolean;
  };
  restoreVerification: { status: EvidenceState | string; message: string; ranAt: string | null; stepCount: number; failedSteps: string[] };
  offNas: { state: EvidenceState; message: string; sameVolumeAsAppData: boolean | null };
}

/**
 * A stored cron time means the server's local zone — the container is pinned to Asia/Kolkata — so
 * "Daily at 20:00" must be rendered in that zone. Rendering it in the browser's zone instead would
 * show the nightly backup arriving at 14:30 and read like the schedule had been changed.
 */
function useServerZoneFormatter(tz: string | undefined, opts: Intl.DateTimeFormatOptions) {
  const zone = tz || undefined;
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: zone }).format;
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format;
  }
}

function formatBackupSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function EvidenceCard(props: { state: EvidenceState; title: string; primary: string; secondary?: string; detail?: string }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${props.state === "CRITICAL" ? "border-red-300" : props.state === "UNKNOWN" ? "border-dashed" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        {props.state === "HEALTHY"
          ? <CheckCircle2 size={16} className={EVIDENCE_ICON_CLASS[props.state]} />
          : <AlertTriangle size={16} className={EVIDENCE_ICON_CLASS[props.state]} />}
        <p className="text-sm font-semibold">{props.title}</p>
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${EVIDENCE_CLASSES[props.state]}`}>{props.state}</span>
      </div>
      <p className="text-xs text-muted-foreground">{props.primary}</p>
      {props.secondary && <p className="text-[10px] text-muted-foreground mt-0.5">{props.secondary}</p>}
      {props.detail && <p className="text-[10px] mt-1 leading-snug">{props.detail}</p>}
    </div>
  );
}

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
                <option value="0 20 * * *">Daily 8:00 PM (server time)</option>
                <option value="0 2 * * *">Daily 2:00 AM (server time)</option>
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
    onSuccess: () => { toast({ title: "Backup job created" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); void queryClient.invalidateQueries({ queryKey: ["backup-status"] }); setShowForm(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => api.patch(`/api/admin/backup-replication/jobs/${id}`, data),
    onSuccess: () => { toast({ title: "Job updated" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); void queryClient.invalidateQueries({ queryKey: ["backup-status"] }); setShowForm(false); setEditingJob(undefined); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/backup-replication/jobs/${id}`),
    onSuccess: () => { toast({ title: "Job deleted" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); void queryClient.invalidateQueries({ queryKey: ["backup-status"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: number) => api.post<{ message: string }>(`/api/admin/backup-replication/jobs/${id}/run`, {}),
    onSuccess: (r) => { toast({ title: r.message || "Backup started" }); void queryClient.invalidateQueries({ queryKey: ["backup-jobs"] }); void queryClient.invalidateQueries({ queryKey: ["backup-status"] }); if (expandedJob) void queryClient.invalidateQueries({ queryKey: ["backup-job-logs", expandedJob] }); },
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

  // Evidence, not the ledger echo. /status re-reads backup_job_logs against the files on disk, the
  // weekly restore-verification proof, and what CARE can and cannot see about off-box copies.
  const { data: status } = useQuery<BackupStatus>({
    queryKey: ["backup-status"],
    queryFn: () => api.get("/api/admin/backup-replication/status"),
  });
  const overview = status?.overview ?? null;
  const fmtDateTime = useServerZoneFormatter(status?.serverTimezone, { dateStyle: "medium", timeStyle: "short" });

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

      {/* Evidence cards. "Last Successful" used to read the last_status column, which said nothing
          about whether a file exists; these four report what was actually checked, and say UNKNOWN
          when CARE cannot check it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <EvidenceCard
          state={overview ? (overview.lastVerifiedAt ? "HEALTHY" : overview.needsAttention.length ? "CRITICAL" : "UNKNOWN") : "UNKNOWN"}
          title="Last verified backup"
          primary={overview?.lastVerifiedAt
            ? fmtDateTime(new Date(overview.lastVerifiedAt))
            : status ? "No backup has been verified on disk" : "Checking…"}
          secondary={overview?.lastVerifiedAt
            ? `${overview.lastVerifiedJob ?? ""} · ${formatBackupSize(overview.lastVerifiedSizeBytes)} on disk`
            : undefined}
          detail={overview && !overview.lastVerifiedAt
            ? "Verified means the ledger's success row and a file of the recorded size both exist. A green tick on a run that wrote nothing no longer counts."
            : undefined}
        />
        <EvidenceCard
          state={overview ? (overview.nextScheduledAt ? (overview.anyDueNow ? "WARNING" : "HEALTHY") : "UNKNOWN") : "UNKNOWN"}
          title="Next scheduled backup"
          primary={overview?.nextScheduledAt
            ? `${fmtDateTime(new Date(overview.nextScheduledAt))}${overview.anyDueNow ? " — due now" : ""}`
            : status ? "Nothing is scheduled" : "Checking…"}
          secondary={overview?.nextScheduledJob ? `Job: ${overview.nextScheduledJob}` : undefined}
          detail={overview && !overview.nextScheduledAt
            ? "No enabled job has a schedule the runner can read. A cron expression it cannot parse never fires."
            : undefined}
        />
        <EvidenceCard
          state={overview ? (overview.needsAttention.length ? (overview.counts.CRITICAL > 0 ? "CRITICAL" : "WARNING") : "HEALTHY") : "UNKNOWN"}
          title="Needs attention"
          primary={overview
            ? overview.needsAttention.length === 0
              ? "All jobs match their schedules and their files are on disk"
              : `${overview.needsAttention.length} job${overview.needsAttention.length === 1 ? "" : "s"}: ${overview.needsAttention.map((j) => `${j.jobName} (${j.state})`).join(", ")}`
            : "Checking…"}
          detail={overview?.needsAttention.slice(0, 2).map((j) => j.reasons.join(" ")).join(" · ")}
        />
        <EvidenceCard
          state={(status?.restoreVerification.status as EvidenceState) ?? "UNKNOWN"}
          title="Restore verification"
          primary={status ? status.restoreVerification.message : "Checking…"}
          secondary={status?.restoreVerification.ranAt
            ? `Last proof run ${fmtDateTime(new Date(status.restoreVerification.ranAt))}`
            : "No proof has ever been run"}
          detail={status?.restoreVerification.failedSteps.length
            ? `Failed steps: ${status.restoreVerification.failedSteps.join(", ")}. Until this passes, "backup exists" is not the same as "backup restores".`
            : undefined}
        />
        <EvidenceCard
          state={(overview === null && !status) ? "UNKNOWN" : (status?.offNas.state ?? "UNKNOWN")}
          title="Copy outside this box"
          primary={status ? status.offNas.message : "Checking…"}
          secondary={status?.offNas.sameVolumeAsAppData === true
            ? "RAID1 mirrors the same disks. A second folder on the same volume is the same copy, not a second one."
            : undefined}
        />
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
        {/* .enc accepted: scheduled backups are written encrypted, and the
            restore path now decrypts them (openssl format + legacy envelopes)
            instead of feeding ciphertext to psql. */}
        <input ref={fileInputRef} type="file" className="hidden" accept=".sql,.zip,.enc,.gz" onChange={onFileChange} />
        <p className="text-[11px] text-muted-foreground">
          Browser upload is limited to a few MB. For a real database or snapshot, use
          &ldquo;Restore from a backup on the server&rdquo; below — it reads the file directly and has no size limit.
        </p>
      </div>

      {/* Server-side restore — the path that actually works for full-size backups */}
      <ServerBackupRestore
        onRestore={(file, type) => {
          setPendingImport({ type, filePath: file.filePath });
          setShowImportConfirm(file.fileName);
        }}
      />

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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[job.lastStatus] ?? "bg-muted"}`} title="What the scheduler recorded for its last run — not a check that a file exists">
                        recorded: {job.lastStatus}
                      </span>
                    )}
                    {job.evidence && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${EVIDENCE_CLASSES[job.evidence.state]}`}>
                        {job.evidence.verified ? "artifact verified on disk" : job.evidence.state}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span>
                      <Clock size={10} className="inline mr-0.5" />
                      {job.evidence?.scheduleLabel ?? (job.schedule === "MANUAL" ? "Manual only" : job.schedule)}
                      {job.evidence?.nextRunAt && (
                        <> · next {fmtDateTime(new Date(job.evidence.nextRunAt))}</>
                      )}
                    </span>
                    {job.evidence?.artifact.status === "present" && (
                      <span>{formatBackupSize(job.evidence.artifact.sizeBytes)} on disk</span>
                    )}
                    {job.evidence?.artifact.status === "missing" && <span className="text-red-600">file not on disk</span>}
                    {job.evidence?.artifact.status === "mismatched" && <span className="text-red-600">size does not match the ledger</span>}
                    {job.destinationPath && <code className="truncate max-w-xs">{job.destinationPath}</code>}
                  </div>
                  {job.evidence && job.evidence.state !== "HEALTHY" && job.evidence.reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {job.evidence.reasons.map((r, i) => (
                        <li key={i} className={`text-[11px] leading-snug ${job.evidence!.state === "CRITICAL" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
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
                            // Staff/admin-authed route — a plain <a href> navigation can
                            // never carry the Authorization header, so this always 401'd
                            // instead of downloading the backup.
                            <button
                              type="button"
                              onClick={() => {
                                const fileName = log.filePath!.split("/").pop() ?? "";
                                void api.downloadFile(`/api/admin/backup-replication/download?file=${encodeURIComponent(fileName)}`, fileName).catch((err) => {
                                  toast({ title: "Download failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
                                });
                              }}
                              className="text-blue-500 hover:underline"
                            >
                              <Download size={10} className="inline" />
                            </button>
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

interface ServerBackupFile {
  filePath: string;
  fileName: string;
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
  encrypted: boolean;
}

/**
 * Restore from a backup file the SERVER can already see.
 *
 * The upload-based restore path sends the whole file base64-encoded in a JSON
 * body against a 5 MB express.json limit — roughly a 3.6 MB ceiling, which no
 * real database dump fits under. Scheduled jobs already write to their
 * destination (usually a NAS mount) and manual exports stay in the backup dir,
 * so this lists what is on disk and restores it in place: no upload, no size cap.
 */
function ServerBackupRestore({ onRestore }: { onRestore: (file: ServerBackupFile, type: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery<{ files: ServerBackupFile[]; directories: string[] }>({
    queryKey: ["backup-server-files"],
    queryFn: () => api.get("/api/admin/backup-replication/files"),
    enabled: open,
  });
  const files = data?.files ?? [];

  // A .sql/.sql.enc/.sql.gz artifact is a database dump; a .zip is either a
  // files-only export or a full snapshot, which the admin picks explicitly.
  function typeFor(f: ServerBackupFile): string {
    const n = f.fileName.toLowerCase();
    if (n.includes("snapshot")) return "snapshot";
    if (n.includes("files")) return "files";
    return "db";
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <Server size={16} className="text-blue-500" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Restore from a backup on the server</h3>
          <p className="text-[11px] text-muted-foreground">
            No upload, no size limit — reads scheduled-job destinations and the local backup directory. Encrypted (.enc) backups are decrypted automatically.
          </p>
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
            </Button>
            {data?.directories?.length ? (
              <span className="text-[10px] text-muted-foreground truncate">Scanned: {data.directories.join(", ")}</span>
            ) : null}
          </div>

          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No backup files found on the server. Run an export above, or set a destination path on a backup job so scheduled backups are written somewhere durable.
            </p>
          ) : (
            <div className="divide-y max-h-72 overflow-y-auto rounded-md border">
              {files.map((f) => (
                <div key={f.filePath} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {f.fileName}
                      {f.encrypted && <Badge variant="outline" className="ml-1.5 text-[9px]">encrypted</Badge>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {formatBytes(f.sizeBytes)} · {new Date(f.modifiedAt).toLocaleString("en-IN")} · {f.directory}
                    </p>
                  </div>
                  <Button size="sm" variant="destructive" className="shrink-0 text-[11px] h-7" onClick={() => onRestore(f, typeFor(f))}>
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
