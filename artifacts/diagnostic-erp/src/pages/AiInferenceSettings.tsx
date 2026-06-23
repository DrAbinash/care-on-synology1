import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, RefreshCw, Save, Server, Activity, Zap, Clock,
  AlertTriangle, CheckCircle2, XCircle, Gauge, Database,
  BrainCircuit, Wifi, WifiOff, ExternalLink, Settings2,
} from "lucide-react";

interface InferenceConfig {
  gpuEndpointUrl: string;
  modelName: string;
  batchSize: number;
  timeoutSeconds: number;
  concurrency: number;
  enabled: boolean;
  fallbackToCloud: boolean;
  useLocalGpu: boolean;
  cloudProvider: string;
  warmUpOnStartup: boolean;
  cacheResults: boolean;
  maxRetries: number;
  requestPriority: string;
}

interface HealthEntry {
  provider: string;
  model: string | null;
  status: string;
  latencyMs: number | null;
  success: boolean;
  createdAt: string;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return iso; }
}

const PRESET_MODELS = [
  { label: "CheXNet (Chest X-Ray)", value: "chexnet", type: "xray" },
  { label: "Lung CT Classification", value: "lung-ct-classifier", type: "ct" },
  { label: "MRI Brain Tumor Seg", value: "brain-mri-seg", type: "mri" },
  { label: "Mammography CAD", value: "mammography-cad", type: "mammography" },
  { label: "Chest CT Nodule Detect", value: "chest-ct-nodule", type: "ct" },
  { label: "Abdominal USG Analyzer", value: "abdominal-usg", type: "ultrasound" },
];

export function AiInferencePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: configData, isLoading: configLoading } = useQuery<InferenceConfig>({
    queryKey: ["ai-inference-config"],
    queryFn: () => api.get(`/api/radiology/ai-inference-config`),
    staleTime: 5 * 60_000,
  });

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery<{
    providers: Record<string, { total: number; success: number; avgLatency: number; lastStatus: string }>;
    recentLogs: HealthEntry[];
  }>({
    queryKey: ["ai-health"],
    queryFn: () => api.get(`/api/radiology/ai-health`),
    refetchInterval: 30_000,
  });

  const [form, setForm] = useState<InferenceConfig>({
    gpuEndpointUrl: "",
    modelName: "",
    batchSize: 1,
    timeoutSeconds: 30,
    concurrency: 4,
    enabled: true,
    fallbackToCloud: true,
    useLocalGpu: true,
    cloudProvider: "gemini",
    warmUpOnStartup: true,
    cacheResults: true,
    maxRetries: 2,
    requestPriority: "normal",
  });

  // Sync form from API when loaded
  useState(() => {
    if (configData) setForm(configData);
  });

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/api/radiology/ai-inference-config`, form),
    onSuccess: () => {
      toast({ title: "Configuration saved" });
      void qc.invalidateQueries({ queryKey: ["ai-inference-config"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post(`/api/radiology/ai-inference-test`, { endpoint: form.gpuEndpointUrl, model: form.modelName }),
    onSuccess: (r: { ok: boolean; latency?: number; error?: string }) => {
      toast({
        title: r.ok ? "Inference server reachable" : "Connection failed",
        description: r.latency ? `Latency: ${r.latency}ms` : r.error ?? "",
        variant: r.ok ? "default" : "destructive",
      });
    },
    onError: (err) => {
      toast({ title: "Test failed", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    },
  });

  const providers = healthData?.providers ?? {};
  const recentLogs = healthData?.recentLogs ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refetchHealth()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh Health
        </Button>
      </div>

      {/* Health Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3" /> GPU Endpoint</span>
          <span className="text-sm font-bold flex items-center gap-1">
            {form.useLocalGpu ? <Wifi className="h-3 w-3 text-green-600" /> : <WifiOff className="h-3 w-3 text-slate-400" />}
            {form.useLocalGpu ? "Local GPU" : "Cloud Only"}
          </span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Total Calls (24h)</span>
          <span className="text-xl font-bold">{Object.values(providers).reduce((s, p) => s + p.total, 0)}</span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Success Rate</span>
          <span className="text-xl font-bold">
            {(() => {
              const totals = Object.values(providers);
              const total = totals.reduce((s, p) => s + p.total, 0);
              const success = totals.reduce((s, p) => s + p.success, 0);
              return total > 0 ? `${Math.round((success / total) * 100)}%` : "\u2014";
            })()}
          </span>
        </div>
        <div className="rounded-lg border p-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Avg Latency</span>
          <span className="text-xl font-bold">
            {(() => {
              const totals = Object.values(providers);
              const avg = totals.length > 0
                ? Math.round(totals.reduce((s, p) => s + p.avgLatency, 0) / totals.length)
                : 0;
              return avg > 0 ? `${avg}ms` : "\u2014";
            })()}
          </span>
        </div>
      </div>

      {/* Recent logs */}
      {recentLogs.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="bg-muted/50 px-3 py-2 text-xs font-semibold flex items-center gap-2">
            <Database className="h-3 w-3" /> Recent Health Checks (last 24h)
          </div>
          <div className="divide-y max-h-40 overflow-y-auto">
            {recentLogs.slice(0, 10).map((log, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                {log.success ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <XCircle className="h-3 w-3 text-red-600" />}
                <span className="font-mono">{log.provider}</span>
                <span className="text-muted-foreground">{log.model ?? "default"}</span>
                <Badge variant="outline" className="text-[10px]">{log.status}</Badge>
                {log.latencyMs != null && <span className="text-muted-foreground">{log.latencyMs}ms</span>}
                <span className="ml-auto text-muted-foreground">{fmtDate(log.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="rounded-lg border p-4 flex flex-col gap-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Inference Backend Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">GPU Endpoint URL</label>
            <Input
              placeholder="http://localhost:8080/predict"
              value={form.gpuEndpointUrl}
              onChange={(e) => setForm((f) => ({ ...f, gpuEndpointUrl: e.target.value }))}
            />
            <span className="text-[11px] text-muted-foreground">e.g. http://192.168.1.50:8080/v1/infer or your Triton/TensorRT URL</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Model Name</label>
            <Input
              placeholder="chexnet"
              value={form.modelName}
              onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
              list="inference-models"
            />
            <datalist id="inference-models">
              {PRESET_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </datalist>
            <div className="flex gap-1 flex-wrap mt-1">
              {PRESET_MODELS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setForm((f) => ({ ...f, modelName: m.value }))}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted border hover:bg-accent transition-colors"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Batch Size</label>
            <Input type="number" min={1} max={64} value={form.batchSize} onChange={(e) => setForm((f) => ({ ...f, batchSize: Number(e.target.value) }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Timeout (seconds)</label>
            <Input type="number" min={1} max={300} value={form.timeoutSeconds} onChange={(e) => setForm((f) => ({ ...f, timeoutSeconds: Number(e.target.value) }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Max Concurrent Requests</label>
            <Input type="number" min={1} max={32} value={form.concurrency} onChange={(e) => setForm((f) => ({ ...f, concurrency: Number(e.target.value) }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Max Retries</label>
            <Input type="number" min={0} max={10} value={form.maxRetries} onChange={(e) => setForm((f) => ({ ...f, maxRetries: Number(e.target.value) }))} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Switch id="enabled" checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
            <label htmlFor="enabled" className="text-xs cursor-pointer">Enable inference</label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="local-gpu" checked={form.useLocalGpu} onCheckedChange={(v) => setForm((f) => ({ ...f, useLocalGpu: v }))} />
            <label htmlFor="local-gpu" className="text-xs cursor-pointer">Use local GPU</label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="fallback" checked={form.fallbackToCloud} onCheckedChange={(v) => setForm((f) => ({ ...f, fallbackToCloud: v }))} />
            <label htmlFor="fallback" className="text-xs cursor-pointer">Fallback to cloud</label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="cache" checked={form.cacheResults} onCheckedChange={(v) => setForm((f) => ({ ...f, cacheResults: v }))} />
            <label htmlFor="cache" className="text-xs cursor-pointer">Cache results</label>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" /> Save Configuration
          </Button>
          <Button size="sm" variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !form.gpuEndpointUrl}>
            <Zap className="h-4 w-4 mr-1" /> Test Connection
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">GPU Inference: </span>
          When enabled, AI report drafts are generated by your local GPU server (NVIDIA Triton, TensorRT, or custom Flask/FastAPI endpoint)
          instead of cloud APIs. Ensure your GPU server implements the expected JSON request/response schema.
          If local GPU is unreachable and fallback is enabled, the system automatically routes to Gemini cloud API.
        </div>
      </div>
    </div>
  );
}

export default function AiInferenceSettings() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="AI Inference Settings" subtitle="Configure GPU/CPU inference backend for radiology AI" />
      <AiInferencePanel />
    </div>
  );
}
