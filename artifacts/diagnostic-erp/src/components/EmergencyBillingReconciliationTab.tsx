import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Download, RefreshCcw } from "lucide-react";

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
  transaction: {
    netAmount: number;
    amountReceived: number;
    dueAmount: number;
    patient: { firstName: string; lastName: string; mobile: string; uhid: string | null };
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

export function EmergencyBillingReconciliationTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("");
  const [fetchToken, setFetchToken] = useState("");
  const [csvText, setCsvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<{ summary: Summary; rows: PreviewRow[]; sessions?: unknown[]; errors?: string[] } | null>(null);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);

  const { data: config, isLoading } = useQuery<NasConfig>({
    queryKey: ["emergency-nas-config"],
    queryFn: async () => {
      const c = await api.get<NasConfig>("/api/emergency-billing/config");
      setBaseUrl(c.baseUrl || "");
      return c;
    },
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
      setFetchToken("");
      toast({ title: "Emergency NAS settings saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const pushMaster = useMutation({
    mutationFn: () => api.post("/api/emergency-billing/push-master", {}),
    onSuccess: (r: { syncedAt: string; serviceCount: number }) => {
      qc.invalidateQueries({ queryKey: ["emergency-nas-config"] });
      toast({ title: "Master data pushed", description: `${r.serviceCount} services at ${r.syncedAt}` });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
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
              Last fetch: {config?.lastFetchAt ? new Date(config.lastFetchAt).toLocaleString("en-IN") : "never"}
              {" · "}
              Last master push: {config?.lastMasterPushAt ? new Date(config.lastMasterPushAt).toLocaleString("en-IN") : "never"}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>Save connection</Button>
              <Button variant="outline" onClick={() => pushMaster.mutate()} disabled={pushMaster.isPending}>
                <RefreshCcw size={14} className="mr-1" /> Push master data to DS225+
              </Button>
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
          <p className="text-xs text-muted-foreground">PROBABLE / CONFLICT rows are left for review. One bad row does not block the rest. Re-uploading the same file will report already imported — 0 duplicates created.</p>
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
                    </td>
                    <td className="p-2 text-right">{inr(r.transaction.netAmount)}</td>
                    <td className="p-2 text-right">{inr(r.transaction.amountReceived)}</td>
                    <td className="p-2 text-right">{inr(r.transaction.dueAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
