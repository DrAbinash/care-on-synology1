import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewRowCanResolve, resolvedCaption } from "./emergencyPreviewResolve";
import { AlertTriangle, Download, RefreshCcw } from "lucide-react";
import { readStaffSession, normalizeRole } from "@/lib/staffSession";

type NasStatus = {
  nasStatus: "ONLINE" | "OFFLINE";
  configured: boolean;
  neverSynced: boolean;
  lastSuccessfulPushAt: string | null;
  snapshotAgeHours: number | null;
  ageBand: "never" | "fresh" | "warning" | "stale";
  counts: { serviceCount: number; doctorCount: number; patientCount: number; staffCount: number } | null;
  lastFailure: { at: string; error: string; initiatedBy: string } | null;
  syncIntervalHours: number;
  contract?: {
    status: "COMPATIBLE" | "MISMATCH" | "UNAVAILABLE";
    careExpected: string;
    remoteSupported: string[];
    remotePrimary: string | null;
  };
  app225?: {
    appVersion: string | null;
    buildSha: string | null;
    databaseHealthy: boolean | null;
    masterSnapshotPresent: boolean | null;
    masterSnapshotCreatedAt: string | null;
  };
  careIntegration?: {
    expectedContract: string;
    appVersion: string | null;
    buildSha: string | null;
  };
  lastSuccessfulFetchAt?: string | null;
  lastSuccessfulReconciliationAt?: string | null;
  pendingEmergencyBills?: number | null;
  openEmergencySessions?: number | null;
  failedImportCount24h?: number;
};

type PushLogRow = {
  id: number;
  pushedAt: string;
  initiatedBy: string;
  userName: string | null;
  targetUrl: string | null;
  snapshotFormat: string | null;
  snapshotVersion: number | null;
  serviceCount: number | null;
  doctorCount: number | null;
  patientCount: number | null;
  staffCount: number | null;
  success: boolean;
  errorMessage: string | null;
};

type PushResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  syncedAt?: string;
  serviceCount?: number;
  doctorCount?: number;
  patientCount?: number;
  staffCount?: number;
  error?: string;
};

type NasConfig = {
  baseUrl: string;
  fetchTokenSet: boolean;
  lastFetchAt: string | null;
  lastMasterPushAt: string | null;
};

type PreviewRow = {
  emergencyTransactionUuid: string;
  emergencyBillNumber: string;
  matchClass: string;
  matchReason: string;
  carePatientId: number | null;
  carePatientLabel: string | null;
  alreadyImported: boolean;
  careBillId: number | null;
  blocked: boolean;
  blockReason: string | null;
  candidates?: Array<{
    carePatientId: number;
    uhid: string;
    firstName: string;
    lastName: string;
    phone: string;
    sex: string | null;
    dateOfBirth?: string | null;
    ageValue?: number | null;
    ageUnit?: string | null;
    address?: string | null;
    lastVisitAt?: string | null;
  }>;
  resolution?: {
    action: "select_existing" | "create_new";
    carePatientId: number | null;
    carePatientLabel: string | null;
    resolvedByStaffName: string;
    resolvedAt: string;
  } | null;
  transaction: {
    emergencyTransactionUuid: string;
    emergencyBillNumber: string;
    status?: string;
    netAmount: number;
    amountReceived: number;
    dueAmount: number;
    patient: {
      firstName: string;
      lastName: string;
      mobile: string;
      uhid: string | null;
      sex?: string;
      ageValue?: number | null;
      ageUnit?: string | null;
      dateOfBirth?: string | null;
    };
  };
};

type Summary = {
  sessionUuid: string | null;
  sessionStartedAt: string | null;
  sessionEndedAt: string | null;
  bills: number;
  gross: number;
  discount: number;
  net: number;
  collected: number;
  due: number;
  cash: number;
  upi: number;
  card: number;
  exactMatches: number;
  newPatients: number;
  needsReview: number;
  conflicts: number;
  alreadyImported: number;
  safeToImport: number;
};

type ImportResult = {
  supplied: number;
  imported: number;
  alreadyReconciled: number;
  created: number;
  duplicates: number;
  failures: number;
  conflicts: number;
  skippedReview: number;
  failureDetails: Array<{ uuid: string; error: string }>;
};

type HistoryBatch = {
  id: number;
  batchUuid: string;
  emergencySessionUuid: string | null;
  sourceNas: string | null;
  importMethod: string;
  suppliedCount: number;
  importedCount: number;
  alreadyImportedCount: number;
  conflictCount: number;
  failureCount: number;
  importedBy: string;
  importedAt: string;
};

function inr(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtIst(iso: string | null | undefined) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtCount(n: number | null | undefined) {
  return Number(n || 0).toLocaleString("en-IN");
}

function ageLabel(hours: number | null | undefined) {
  if (hours == null) return "never";
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (hours < 48) {
    const h = Math.round(hours * 10) / 10;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function shaShort(sha: string | null | undefined) {
  if (!sha || sha === "unknown") return "unknown";
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

function successMessage(r: PushResult) {
  const when = fmtIst(r.syncedAt);
  return [
    `Last push: ${when}`,
    `Services: ${fmtCount(r.serviceCount)}`,
    `Doctors: ${fmtCount(r.doctorCount)}`,
    `Patients cached: ${fmtCount(r.patientCount)}`,
    `Staff: ${fmtCount(r.staffCount)}`,
  ].join("\n");
}

export function EmergencyBillingReconciliationTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isSuperAdmin = normalizeRole(readStaffSession()?.user.role ?? "") === "super_admin";
  const [baseUrl, setBaseUrl] = useState("");
  const [fetchToken, setFetchToken] = useState("");
  const [csvText, setCsvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<{ summary: Summary; rows: PreviewRow[]; sessions?: unknown[]; errors?: string[] } | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [resolveRow, setResolveRow] = useState<PreviewRow | null>(null);

  const { data: config, isLoading } = useQuery<NasConfig>({
    queryKey: ["emergency-nas-config"],
    queryFn: async () => {
      const c = await api.get<NasConfig>("/api/emergency-billing/config");
      setBaseUrl(c.baseUrl || "");
      return c;
    },
  });

  const { data: status } = useQuery<NasStatus>({
    queryKey: ["emergency-nas-status"],
    queryFn: () => api.get("/api/emergency-billing/status"),
    refetchInterval: 30_000,
  });

  const { data: pushLog = [] } = useQuery<PushLogRow[]>({
    queryKey: ["emergency-push-log"],
    queryFn: () => api.get("/api/emergency-billing/push-log"),
  });

  const { data: history = [] } = useQuery<HistoryBatch[]>({
    queryKey: ["emergency-history"],
    queryFn: () => api.get("/api/emergency-billing/history"),
  });

  const { data: historyDetail } = useQuery<{ batch: HistoryBatch; transactions: Array<{ originalEmgBillNumber: string; emergencyTransactionUuid: string; careBillId: number | null; matchClass: string }> }>({
    queryKey: ["emergency-history", historyId],
    queryFn: () => api.get(`/api/emergency-billing/history/${historyId}`),
    enabled: historyId != null,
  });

  const saveConfig = useMutation({
    mutationFn: () => api.put("/api/emergency-billing/config", { baseUrl, fetchToken: fetchToken || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emergency-nas-config"] });
      qc.invalidateQueries({ queryKey: ["emergency-nas-status"] });
      setFetchToken("");
      toast({ title: "Emergency NAS settings saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const pushMaster = useMutation({
    mutationFn: () => api.post<PushResult>("/api/emergency-billing/push-master", {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["emergency-nas-config"] });
      qc.invalidateQueries({ queryKey: ["emergency-nas-status"] });
      qc.invalidateQueries({ queryKey: ["emergency-push-log"] });
      if (!r.ok) {
        toast({ title: "Push failed", description: r.error || "Master data was not synchronized", variant: "destructive" });
        return;
      }
      toast({ title: "Master data synchronized successfully", description: successMessage(r) });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  const downloadUsbSeed = useMutation({
    mutationFn: async () => {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).replace(/-/g, "");
      await api.downloadFile("/api/emergency-billing/usb-seed", `CARE_ULTRA_EMERGENCY_SEED_${day}.zip`);
    },
    onSuccess: () => toast({ title: "USB seed downloaded", description: "Copy seed/ onto the pendrive. This zip is not a bill import." }),
    onError: (e: Error) => toast({ title: "USB seed download failed", description: e.message, variant: "destructive" }),
  });

  const fetchNas = useMutation({
    mutationFn: () => api.post<{ summary: Summary; rows: PreviewRow[]; sessions: unknown[] }>("/api/emergency-billing/fetch", {}),
    onSuccess: (data) => {
      setPreview(data);
      setLastImport(null);
      toast({ title: "Fetched from Emergency NAS", description: `${data.summary.bills} bills in preview` });
    },
    onError: (e: Error) => toast({ title: "Fetch failed", description: e.message, variant: "destructive" }),
  });

  const previewCsv = useMutation({
    mutationFn: () => api.post<{ summary: Summary; rows: PreviewRow[]; errors: string[] }>("/api/emergency-billing/preview-csv", { csv: csvText }),
    onSuccess: (data) => { setPreview(data); setLastImport(null); },
    onError: (e: Error) => toast({ title: "CSV preview failed", description: e.message, variant: "destructive" }),
  });

  const previewJson = useMutation({
    mutationFn: () => api.post<{ summary: Summary; rows: PreviewRow[]; errors: string[] }>("/api/emergency-billing/preview-json", { json: jsonText }),
    onSuccess: (data) => { setPreview(data); setLastImport(null); },
    onError: (e: Error) => toast({ title: "JSON preview failed", description: e.message, variant: "destructive" }),
  });

  const importSafe = useMutation({
    mutationFn: async () => {
      if (csvText.trim()) return api.post<{ result: ImportResult }>("/api/emergency-billing/import-csv", { csv: csvText, onlySafe: true });
      if (jsonText.trim()) return api.post<{ result: ImportResult }>("/api/emergency-billing/import-json", { json: jsonText, onlySafe: true });
      return api.post<{ result: ImportResult }>("/api/emergency-billing/import-fetched", { onlySafe: true });
    },
    onSuccess: (data) => {
      setLastImport(data.result);
      qc.invalidateQueries({ queryKey: ["emergency-history"] });
      toast({
        title: "Import finished",
        description: `${data.result.created} created, ${data.result.alreadyReconciled} already imported, ${data.result.duplicates} duplicates, ${data.result.failures} failures`,
      });
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const resolvePatient = useMutation({
    mutationFn: (body: { transaction: PreviewRow["transaction"]; action: "select_existing" | "create_new"; carePatientId?: number }) =>
      api.post<{ row: PreviewRow; summary: Summary }>("/api/emergency-billing/resolve-patient", body),
    onSuccess: (data) => {
      setPreview((prev) => {
        if (!prev) return { summary: data.summary, rows: [data.row] };
        const rows = prev.rows.map((r) => r.emergencyTransactionUuid === data.row.emergencyTransactionUuid ? data.row : r);
        const next = { ...prev, rows };
        const s = prev.summary;
        const conflicts = rows.filter((r) => r.matchClass === "CONFLICT" && !r.alreadyImported && !r.blocked).length;
        const needsReview = rows.filter((r) => r.matchClass === "PROBABLE_MATCH" && !r.alreadyImported && !r.blocked).length;
        const exactMatches = rows.filter((r) => r.matchClass === "EXACT_MATCH" && !r.alreadyImported && !r.blocked).length;
        const newPatients = rows.filter((r) => r.matchClass === "NEW_PATIENT" && !r.alreadyImported && !r.blocked).length;
        const safeToImport = rows.filter((r) => !r.alreadyImported && !r.blocked && (r.matchClass === "EXACT_MATCH" || r.matchClass === "NEW_PATIENT")).length;
        next.summary = { ...s, conflicts, needsReview, exactMatches, newPatients, safeToImport };
        return next;
      });
      setResolveRow(null);
      toast({ title: "Patient resolved", description: data.row.carePatientLabel || data.row.matchReason });
    },
    onError: (e: Error) => toast({ title: "Resolve failed", description: e.message, variant: "destructive" }),
  });

  function onFile(kind: "csv" | "json", file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (kind === "csv") setCsvText(text);
      else setJsonText(text);
    };
    reader.readAsText(file);
  }

  const contractMismatch = status?.contract?.status === "MISMATCH";
  const s = preview?.summary;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
        <div className="flex gap-2 font-semibold text-amber-900 dark:text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          DS225+ Emergency Billing is capture-only. CARE on DS1522+ remains the source of truth.
        </div>
        <p className="mt-1 text-amber-800 dark:text-amber-200">
          Do not run two live billing databases. Import creates ordinary CARE bills (accounting and commission follow automatically). The same UUID uploaded twice will never create a duplicate bill.
        </p>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">Emergency Billing</h2>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm font-mono leading-6" data-testid="emergency-contract-card">
          <div>Emergency NAS: <strong>{status?.nasStatus ?? "OFFLINE"}</strong>{status?.configured === false ? " (not configured)" : ""}</div>
          <div>225app contract: <strong>{status?.contract?.remotePrimary || (status?.nasStatus === "ONLINE" ? "unknown" : "—")}</strong></div>
          <div>CARE expected contract: <strong>{status?.contract?.careExpected || status?.careIntegration?.expectedContract || "CARE_EMERGENCY_MASTER_V1"}</strong></div>
          <div>
            Status:{" "}
            {status?.contract?.status === "COMPATIBLE" ? (
              <strong className="text-emerald-700 dark:text-emerald-300">✓ COMPATIBLE</strong>
            ) : status?.contract?.status === "MISMATCH" ? (
              <strong className="text-red-700 dark:text-red-300">⚠ VERSION MISMATCH</strong>
            ) : (
              <strong className="text-muted-foreground">unknown</strong>
            )}
          </div>
          {status?.app225?.appVersion && (
            <div className="text-xs text-muted-foreground font-sans mt-1">
              225app {status.app225.appVersion}
              {status.app225.buildSha ? ` · ${shaShort(status.app225.buildSha)}` : ""}
              {status.careIntegration?.buildSha ? ` · CARE ${shaShort(status.careIntegration.buildSha)}` : ""}
            </div>
          )}
        </div>
        {contractMismatch && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm">
            <div className="font-semibold text-red-900 dark:text-red-100">⚠ VERSION MISMATCH</div>
            <p className="mt-1 text-red-800 dark:text-red-200">
              CARE expects: {status?.contract?.careExpected}<br />
              225app supports: {status?.contract?.remoteSupported.join(", ") || "(none)"}
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">Master-data sync is blocked until both sides use the same contract.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Emergency NAS status:</span>
          <Badge variant={status?.nasStatus === "ONLINE" ? "default" : "destructive"}>
            {status?.nasStatus ?? "OFFLINE"}
          </Badge>
        </div>
        {status?.neverSynced && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm">
            <div className="font-semibold text-red-900 dark:text-red-100">Emergency NAS has never been synchronized.</div>
            <p className="mt-1 text-red-800 dark:text-red-200">Push the initial master-data snapshot before the first emergency session.</p>
            <Button className="mt-2" onClick={() => pushMaster.mutate()} disabled={pushMaster.isPending || contractMismatch}>
              <RefreshCcw size={14} className="mr-1" /> Push Initial Master Data
            </Button>
          </div>
        )}
        {status && !status.neverSynced && status.ageBand === "stale" && (
          <div className="rounded-lg border border-orange-400 bg-orange-50 dark:bg-orange-950/30 p-3 text-sm font-medium">
            Snapshot is older than 24 hours. Emergency billing on DS225+ still uses the last valid cache — push when CARE can reach the NAS.
          </div>
        )}
        {status && !status.neverSynced && status.ageBand === "warning" && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            Snapshot is more than 6 hours old. Scheduled sync interval is {status.syncIntervalHours} hours.
          </div>
        )}
        <div className="text-sm space-y-1">
          <div>Last successful master-data push: <strong>{fmtIst(status?.lastSuccessfulPushAt)}</strong></div>
          <div>Age of snapshot: <strong>{ageLabel(status?.snapshotAgeHours)}</strong></div>
          {status?.app225?.masterSnapshotCreatedAt && (
            <div>225app snapshot: <strong>{fmtIst(status.app225.masterSnapshotCreatedAt)}</strong></div>
          )}
          <div>Last successful emergency fetch: <strong>{fmtIst(status?.lastSuccessfulFetchAt)}</strong></div>
          <div>Last successful reconciliation: <strong>{fmtIst(status?.lastSuccessfulReconciliationAt)}</strong></div>
          {status?.counts && (
            <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap">{`Services: ${fmtCount(status.counts.serviceCount)}
Doctors: ${fmtCount(status.counts.doctorCount)}
Patients cached: ${fmtCount(status.counts.patientCount)}
Staff: ${fmtCount(status.counts.staffCount)}`}</pre>
          )}
          {status?.lastFailure && (
            <div className="text-destructive text-xs">Last failed push ({status.lastFailure.initiatedBy} at {fmtIst(status.lastFailure.at)}): {status.lastFailure.error}</div>
          )}
        </div>
        <Button onClick={() => pushMaster.mutate()} disabled={pushMaster.isPending || contractMismatch} size="lg">
          <RefreshCcw size={16} className="mr-1" /> Push Master Data Now
        </Button>
        {isSuperAdmin ? (
          <div className="rounded-lg border border-dashed p-3 space-y-2" data-testid="emergency-usb-seed">
            <div className="font-medium text-sm">Pendrive ultra-emergency seed</div>
            <p className="text-xs text-muted-foreground">
              Download doctors + tests (and the master JSON) for the USB stick when CARE and DS225+ are both down.
              Do not upload this zip as emergency bills. Super admin login only.
            </p>
            <Button variant="outline" onClick={() => downloadUsbSeed.mutate()} disabled={downloadUsbSeed.isPending}>
              <Download size={14} className="mr-1" /> Download USB seed
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">USB seed download is available only when logged in as super admin.</p>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">Emergency NAS connection</h2>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>DS225+ base URL</Label>
                <Input placeholder="http://192.168.50.10" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div>
                <Label>Fetch token {config?.fetchTokenSet ? <Badge variant="secondary">set</Badge> : <Badge variant="outline">not set</Badge>}</Label>
                <Input type="password" placeholder={config?.fetchTokenSet ? "Leave blank to keep" : "Paste token from DS225+ .env"} value={fetchToken} onChange={(e) => setFetchToken(e.target.value)} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Last fetch: {config?.lastFetchAt ? fmtIst(config.lastFetchAt) : "never"}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>Save connection</Button>
            </div>
          </>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">Recover emergency transactions</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fetchNas.mutate()} disabled={fetchNas.isPending}>
            <Download size={14} className="mr-1" /> Fetch from Emergency NAS
          </Button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Upload emergency CSV (CARE_EMERGENCY_BILLING_V1)</Label>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile("csv", e.target.files?.[0] ?? null)} />
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => previewCsv.mutate()} disabled={!csvText || previewCsv.isPending}>Preview CSV</Button>
            </div>
          </div>
          <div>
            <Label>Upload emergency JSON (CARE_EMERGENCY_BILLING_JSON_V1)</Label>
            <Input type="file" accept=".json,application/json" onChange={(e) => onFile("json", e.target.files?.[0] ?? null)} />
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => previewJson.mutate()} disabled={!jsonText || previewJson.isPending}>Preview JSON</Button>
            </div>
          </div>
        </div>
        {(csvText || jsonText) && (
          <p className="text-xs text-muted-foreground">File loaded in this browser. Import uses this file; otherwise Fetch from NAS is used.</p>
        )}
      </div>

      {s && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h2 className="font-bold text-lg">Emergency session preview</h2>
          <div className="text-sm text-muted-foreground">
            Session {s.sessionUuid ? s.sessionUuid.slice(0, 8) : "—"}
            {s.sessionStartedAt ? ` · ${new Date(s.sessionStartedAt).toLocaleString("en-IN")}` : ""}
            {s.sessionEndedAt ? ` – ${new Date(s.sessionEndedAt).toLocaleString("en-IN")}` : ""}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Stat label="Bills" value={String(s.bills)} />
            <Stat label="Gross" value={inr(s.gross)} />
            <Stat label="Discount" value={inr(s.discount)} />
            <Stat label="Net" value={inr(s.net)} />
            <Stat label="Collected" value={inr(s.collected)} />
            <Stat label="Due" value={inr(s.due)} />
            <Stat label="Cash" value={inr(s.cash)} />
            <Stat label="UPI" value={inr(s.upi)} />
            <Stat label="Card" value={inr(s.card)} />
            <Stat label="Exact matches" value={String(s.exactMatches)} />
            <Stat label="New patients" value={String(s.newPatients)} />
            <Stat label="Needs review" value={String(s.needsReview)} />
            <Stat label="Conflicts" value={String(s.conflicts)} />
            <Stat label="Already imported" value={String(s.alreadyImported)} />
            <Stat label="Safe to import" value={String(s.safeToImport)} />
          </div>
          <Button onClick={() => importSafe.mutate()} disabled={importSafe.isPending || s.safeToImport + s.alreadyImported === 0}>
            Import safe transactions
          </Button>
          <p className="text-xs text-muted-foreground">PROBABLE / CONFLICT rows stay blocked until you click Resolve and choose a CARE patient (or create as new). Name-only is never merged. Already imported UUIDs cannot be resolved again.</p>
          {lastImport && (
            <div className="rounded-lg border p-3 text-sm">
              Supplied {lastImport.supplied} · created {lastImport.created} · already imported {lastImport.alreadyReconciled} · duplicates {lastImport.duplicates} · conflicts {lastImport.conflicts} · review {lastImport.skippedReview} · failures {lastImport.failures}
              {lastImport.failureDetails.length > 0 && (
                <ul className="mt-2 text-destructive list-disc pl-4">
                  {lastImport.failureDetails.map((f) => <li key={f.uuid}>{f.uuid}: {f.error}</li>)}
                </ul>
              )}
            </div>
          )}
          {preview?.errors?.length ? <p className="text-sm text-destructive">{preview.errors.join("; ")}</p> : null}
          <div className="overflow-auto max-h-96 border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2">EMG</th>
                  <th className="text-left p-2">Patient</th>
                  <th className="text-left p-2">Match</th>
                  <th className="text-right p-2">Net</th>
                  <th className="text-right p-2">Paid</th>
                  <th className="text-right p-2">Due</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.rows ?? []).map((r) => (
                  <tr key={r.emergencyTransactionUuid} className="border-t">
                    <td className="p-2 font-mono">{r.emergencyBillNumber}</td>
                    <td className="p-2">{r.transaction.patient.firstName} {r.transaction.patient.lastName} {r.transaction.patient.uhid ? `(${r.transaction.patient.uhid})` : ""}</td>
                    <td className="p-2">
                      {r.alreadyImported ? "ALREADY IMPORTED" : r.blocked ? "VOID" : r.matchClass}
                      <div className="text-muted-foreground">{r.matchReason || r.blockReason}</div>
                      {resolvedCaption(r) && <div className="text-emerald-700 dark:text-emerald-300 mt-1">{resolvedCaption(r)}</div>}
                    </td>
                    <td className="p-2 text-right">{inr(r.transaction.netAmount)}</td>
                    <td className="p-2 text-right">{inr(r.transaction.amountReceived)}</td>
                    <td className="p-2 text-right">{inr(r.transaction.dueAmount)}</td>
                    <td className="p-2">
                      {previewRowCanResolve(r) ? (
                        <Button size="sm" variant="outline" onClick={() => setResolveRow(r)}>Resolve</Button>
                      ) : r.alreadyImported ? (
                        <span className="text-muted-foreground">Read-only</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">Master-data push history</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">When</th>
                <th className="p-2">By</th>
                <th className="p-2">User</th>
                <th className="p-2">Target</th>
                <th className="p-2">Version</th>
                <th className="p-2">Counts</th>
                <th className="p-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {pushLog.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">{fmtIst(row.pushedAt)}</td>
                  <td className="p-2">{row.initiatedBy}</td>
                  <td className="p-2">{row.userName || "—"}</td>
                  <td className="p-2 font-mono text-xs">{row.targetUrl || "—"}</td>
                  <td className="p-2 text-xs">{row.snapshotFormat || "—"} v{row.snapshotVersion ?? "—"}</td>
                  <td className="p-2 text-xs">{fmtCount(row.serviceCount)} svc · {fmtCount(row.doctorCount)} dr · {fmtCount(row.patientCount)} pt · {fmtCount(row.staffCount)} staff</td>
                  <td className="p-2">{row.success ? "success" : <span className="text-destructive">{row.errorMessage || "failed"}</span>}</td>
                </tr>
              ))}
              {pushLog.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={7}>No master-data pushes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-lg">Emergency reconciliation history</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">When</th>
                <th className="p-2">Method</th>
                <th className="p-2">Supplied</th>
                <th className="p-2">Imported</th>
                <th className="p-2">Already</th>
                <th className="p-2">Conflicts</th>
                <th className="p-2">Failures</th>
                <th className="p-2">By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t cursor-pointer hover:bg-muted/50" onClick={() => setHistoryId(h.id)}>
                  <td className="p-2">{new Date(h.importedAt).toLocaleString("en-IN")}</td>
                  <td className="p-2">{h.importMethod}</td>
                  <td className="p-2">{h.suppliedCount}</td>
                  <td className="p-2">{h.importedCount}</td>
                  <td className="p-2">{h.alreadyImportedCount}</td>
                  <td className="p-2">{h.conflictCount}</td>
                  <td className="p-2">{h.failureCount}</td>
                  <td className="p-2">{h.importedBy}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td className="p-2 text-muted-foreground" colSpan={8}>No imports yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {historyDetail && (
          <div className="text-xs border rounded-lg p-3 space-y-1">
            <div className="font-semibold">Batch {historyDetail.batch.batchUuid}</div>
            {historyDetail.transactions.map((t) => (
              <div key={t.emergencyTransactionUuid}>{t.originalEmgBillNumber} → CARE bill {t.careBillId ?? "—"} ({t.matchClass})</div>
            ))}
          </div>
        )}
        <details>
          <summary className="text-sm cursor-pointer">Paste CSV / JSON manually</summary>
          <div className="grid md:grid-cols-2 gap-2 mt-2">
            <Textarea rows={6} placeholder="CSV…" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
            <Textarea rows={6} placeholder="JSON…" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          </div>
        </details>
      </div>

      <Dialog open={!!resolveRow} onOpenChange={(open) => { if (!open) setResolveRow(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Resolve patient — {resolveRow?.emergencyBillNumber}</DialogTitle>
          </DialogHeader>
          {resolveRow && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="font-semibold">Emergency capture</div>
                <div>{resolveRow.transaction.patient.firstName} {resolveRow.transaction.patient.lastName}</div>
                <div className="text-muted-foreground">
                  Age/sex: {resolveRow.transaction.patient.ageValue ?? "—"}{resolveRow.transaction.patient.ageUnit ? ` ${resolveRow.transaction.patient.ageUnit}` : ""} / {resolveRow.transaction.patient.sex || "—"}
                  {" · "}Mobile {resolveRow.transaction.patient.mobile || "—"}
                  {resolveRow.transaction.patient.uhid ? ` · UHID ${resolveRow.transaction.patient.uhid}` : ""}
                </div>
                <div className="text-muted-foreground mt-1">{resolveRow.matchClass}: {resolveRow.matchReason}</div>
              </div>
              <div className="overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">UHID</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Age/DOB</th>
                      <th className="text-left p-2">Sex</th>
                      <th className="text-left p-2">Mobile</th>
                      <th className="text-left p-2">Address</th>
                      <th className="text-left p-2">Last visit</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resolveRow.candidates ?? []).map((c) => (
                      <tr key={c.carePatientId} className="border-t">
                        <td className="p-2 font-mono">{c.uhid}</td>
                        <td className="p-2">{c.firstName} {c.lastName}</td>
                        <td className="p-2">{c.ageValue != null ? `${c.ageValue}${c.ageUnit ? ` ${c.ageUnit}` : ""}` : "—"}{c.dateOfBirth ? ` / ${c.dateOfBirth}` : ""}</td>
                        <td className="p-2">{c.sex || "—"}</td>
                        <td className="p-2">{c.phone || "—"}</td>
                        <td className="p-2">{c.address || "—"}</td>
                        <td className="p-2">{c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString("en-IN") : "—"}</td>
                        <td className="p-2">
                          <Button
                            size="sm"
                            disabled={resolvePatient.isPending || resolveRow.alreadyImported}
                            onClick={() => resolvePatient.mutate({
                              transaction: resolveRow.transaction,
                              action: "select_existing",
                              carePatientId: c.carePatientId,
                            })}
                          >
                            Select existing
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {(resolveRow.candidates ?? []).length === 0 && (
                      <tr><td className="p-3 text-muted-foreground" colSpan={8}>No CARE candidates on this phone/UHID.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Selecting an existing patient does not change that patient’s demographics. Create as new uses CARE’s normal patient registration (UHID P-#####), not an emergency-only table.</p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setResolveRow(null)}>Cancel / leave unresolved</Button>
            <Button
              variant="secondary"
              disabled={!resolveRow || resolvePatient.isPending || resolveRow.alreadyImported}
              onClick={() => resolveRow && resolvePatient.mutate({ transaction: resolveRow.transaction, action: "create_new" })}
            >
              Create as new patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
