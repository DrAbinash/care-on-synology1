/**
 * AI Model Test Lab — provider-neutral Report Composer / vision trial surface.
 * Exercises real runReportComposer. Never writes clinical report data.
 */
import { useState } from "react";
import { Bot, CheckCircle2, RefreshCw, TestTube2, XCircle, AlertTriangle, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/fetchApi";

const DEFAULT_OBSERVATIONS = [
  "Loss of lumbar lordosis.",
  "Disc desiccation at L3-4, L4-5 and L5-S1.",
  "Diffuse disc bulge at L4-5 causing anterior thecal sac compression",
  "with mild bilateral nerve-root impingement.",
  "AP spinal canal diameters:",
  "L1-2 12.3 mm,",
  "L2-3 11.8 mm,",
  "L3-4 10.6 mm,",
  "L4-5 9.4 mm,",
  "L5-S1 12.1 mm.",
].join("\n");

export type ComposerRuntimeDiag = {
  enabled?: boolean;
  endpoint?: string | null;
  endpointSource?: string | null;
  model?: string | null;
  fallbackModel?: string | null;
  healthy?: boolean;
  statusMessage?: string | null;
  lastError?: string | null;
  transport?: string | null;
  deepSeekConfigured?: boolean;
  deepSeekNote?: string | null;
  deepSeekTextModel?: string | null;
  deepSeekVisionModel?: string | null;
  qwenConfigured?: boolean;
  qwenNote?: string | null;
  qwenDefaultModel?: string | null;
  openaiConfigured?: boolean;
  openaiNote?: string | null;
  nightVisionProvider?: string | null;
  deepseekCloudVisionAllowed?: boolean;
};

type ComposeBlock = {
  ok?: boolean;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
  safeError?: string;
  displayStatus?: string;
  ollamaCalled?: boolean;
  deepseekCalled?: boolean;
  personaLoaded?: boolean;
  personaVersion?: string | null;
  provider?: string | null;
  httpStatus?: number | null;
  userMessage?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  approximateCostUsd?: number | null;
  draft?: {
    findings?: string;
    impression?: string;
    recommendation?: string;
    warnings?: string[];
  } | null;
};

type TestResponse = {
  ok?: boolean;
  writesClinicalReport?: boolean;
  execution?: string;
  validationOk?: boolean;
  runtime?: {
    enabled?: boolean;
    model?: string;
    fallbackModel?: string | null;
    endpoint?: string;
    endpointSource?: string;
    statusMessage?: string | null;
    transport?: string;
  };
  compose?: ComposeBlock;
  validation?: { ok?: boolean; warnings?: string[]; errors?: string[] };
  error?: string;
};

type CompareResponse = {
  ok?: boolean;
  writesClinicalReport?: boolean;
  deepSeekConfigured?: boolean;
  qwenConfigured?: boolean;
  local?: TestResponse;
  qwen?: TestResponse;
  deepseek?: TestResponse;
};

type VisionTrialResponse = {
  ok?: boolean;
  writesClinicalReport?: boolean;
  deepSeekConfigured?: boolean;
  sameImageCount?: number;
  samePrompt?: string;
  privacy?: { rawDicomExcluded?: boolean; identifiersExcluded?: boolean; burnedInPhiFlags?: string[] };
  local?: {
    ok?: boolean;
    model?: string;
    latencyMs?: number;
    proposalText?: string | null;
    safeError?: string | null;
    execution?: string;
    provider?: string;
  };
  deepseek?: {
    ok?: boolean;
    model?: string;
    latencyMs?: number;
    proposalText?: string | null;
    safeError?: string | null;
    execution?: string;
    provider?: string;
    approximateCostUsd?: number | null;
  };
};

type Props = {
  diagnostics: ComposerRuntimeDiag | null;
  diagnosticsLoading?: boolean;
  onRefreshDiagnostics: () => void;
  hasUnsavedComposerChanges: boolean;
  disabled?: boolean;
};

function formatCompareFailure(safeError: string | null | undefined, fallback?: string | null): string {
  const err = (safeError ?? fallback ?? "").trim();
  if (!err) return "FAILED — compose failed";
  if (/api_key_not_configured/i.test(err)) return "NOT CONFIGURED — API key missing";
  if (/base_url_missing|endpoint_not_configured|endpoint_missing/i.test(err)) {
    return "ENDPOINT MISSING — set QWEN_BASE_URL / provider endpoint";
  }
  return `FAILED — ${err}`;
}

function ResultCard({
  title,
  result,
}: {
  title: string;
  result: TestResponse | null;
}) {
  const display = result?.compose?.displayStatus;
  const draft = result?.compose?.draft;
  return (
    <div className="space-y-2 border rounded-md p-2.5 bg-white/80 dark:bg-background/40" data-testid="composer-test-result">
      <p className="text-[11px] font-semibold">{title}</p>
      {!result ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-950">
          NOT CONFIGURED — no result returned for this provider
        </div>
      ) : (
      <div
        className={`rounded-md border px-2.5 py-2 text-[11px] font-semibold ${
          display === "LOCAL_AI_SUCCESS"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
            : display === "CLOUD_AI_SUCCESS"
              ? "border-sky-300 bg-sky-50 text-sky-950"
              : display === "FALLBACK_DRAFT"
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-red-300 bg-red-50 text-red-900"
        }`}
      >
        {display === "LOCAL_AI_SUCCESS" && (
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> LOCAL AI SUCCESS</span>
        )}
        {display === "CLOUD_AI_SUCCESS" && (
          <span className="inline-flex items-center gap-1"><Cloud size={12} /> CLOUD AI SUCCESS</span>
        )}
        {display === "FALLBACK_DRAFT" && (
          <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> FALLBACK DRAFT — Local AI was not used.</span>
        )}
        {display !== "LOCAL_AI_SUCCESS" && display !== "CLOUD_AI_SUCCESS" && display !== "FALLBACK_DRAFT" && (
          <span>{formatCompareFailure(result.compose?.safeError, result.error)}</span>
        )}
      </div>
      )}
      <div className="text-[11px] space-y-0.5 font-mono">
        <p>Execution: {result?.execution ?? "—"}</p>
        <p>Provider: {result?.compose?.provider ?? result?.runtime?.transport ?? "—"}</p>
        <p>Resolved endpoint: {result?.runtime?.endpoint ?? "—"}</p>
        <p>Resolved model: {result?.compose?.model ?? "—"}</p>
        <p>Fallback used: {result?.compose?.fallbackUsed ? "YES" : "NO"}</p>
        <p>Persona loaded: {result?.compose?.personaLoaded ? "YES" : "NO"}
          {result?.compose?.personaVersion ? ` (${result.compose.personaVersion})` : ""}
        </p>
        <p>Latency: {result?.compose?.latencyMs ?? "—"} ms</p>
        <p>Tokens: in={result?.compose?.promptTokens ?? "—"} out={result?.compose?.completionTokens ?? "—"}</p>
        <p>Approx cost: {result?.compose?.approximateCostUsd != null ? `$${result.compose.approximateCostUsd.toFixed(6)}` : "—"}</p>
        <p>
          Validation:{" "}
          {result
            ? (result.validationOk ?? result.validation?.ok)
              ? `PASS${(result.validation?.warnings?.length ?? 0) > 0 ? ` · warnings` : ""}`
              : `FAIL · ${(result.validation?.errors ?? []).join(", ") || "errors"}`
            : "—"}
        </p>
        <p>Writes clinical report: {result?.writesClinicalReport ? "YES" : "NO"}</p>
      </div>
      {draft && (
        <pre className="max-h-48 overflow-auto rounded border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap font-mono">
          {`FINDINGS\n${draft.findings || "(empty)"}\n\nIMPRESSION\n${draft.impression || "(empty)"}\n\nRECOMMENDATION\n${draft.recommendation || "(empty)"}`}
        </pre>
      )}
    </div>
  );
}

export function ReportComposerTestPanel({
  diagnostics,
  diagnosticsLoading,
  onRefreshDiagnostics,
  hasUnsavedComposerChanges,
  disabled,
}: Props) {
  const [region, setRegion] = useState("MRI LS Spine");
  const [observations, setObservations] = useState(DEFAULT_OBSERVATIONS);
  const [provider, setProvider] = useState<"ollama" | "qwen" | "deepseek" | "openai">("ollama");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [vision, setVision] = useState<VisionTrialResponse | null>(null);
  const [confirmCloudVision, setConfirmCloudVision] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTest(selected: "ollama" | "qwen" | "deepseek" | "openai" = provider) {
    if (hasUnsavedComposerChanges) {
      setError("Save Local AI Settings before testing — UI selection is not active runtime yet.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setCompare(null);
    try {
      const r = await api.post<TestResponse>("/api/radiology/report-composer/test", {
        studyType: region,
        region: region.toUpperCase().includes("LS") ? "LS_SPINE" : region,
        modality: "MR",
        observationsText: observations,
        provider: selected,
      });
      setResult(r);
      onRefreshDiagnostics();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    if (hasUnsavedComposerChanges) {
      setError("Save Local AI Settings before testing.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setCompare(null);
    try {
      const r = await api.post<CompareResponse>("/api/radiology/report-composer/test/compare", {
        studyType: region,
        region: "LS_SPINE",
        modality: "MR",
        observationsText: observations,
        arms: [
          { provider: "ollama" },
          { provider: "qwen", model: diagnostics?.qwenDefaultModel ?? "qwen3.7-plus" },
          { provider: "deepseek", model: diagnostics?.deepSeekTextModel ?? "deepseek-v4-pro" },
        ],
      });
      setCompare(r);
      onRefreshDiagnostics();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runVisionTrial() {
    setBusy(true);
    setError(null);
    setVision(null);
    try {
      const r = await api.post<VisionTrialResponse>("/api/radiology/report-composer/vision-trial", {
        confirmCloudVisionTrial: confirmCloudVision,
        cloudVisionAllowed: confirmCloudVision || diagnostics?.deepseekCloudVisionAllowed === true,
        clinicalPrompt: `Limited MRI review trial. Region: ${region}. Synthetic/de-identified only.`,
        runLocal: true,
        runDeepSeek: true,
      });
      setVision(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50/40 dark:bg-sky-950/10 p-5 space-y-3"
      data-testid="report-composer-test-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Bot size={14} className="text-sky-700" /> AI Model Test Lab
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Provider-neutral text / vision / compare trials via the CARE AI provider layer.
            Synthetic non-PHI only — never writes a clinical report.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" disabled={diagnosticsLoading} onClick={onRefreshDiagnostics}>
          <RefreshCw size={11} className={diagnosticsLoading ? "animate-spin" : undefined} />
          Refresh status
        </Button>
      </div>

      <div className="rounded-md border bg-white/80 dark:bg-background/40 p-2.5 text-[11px] space-y-1 font-mono" data-testid="composer-runtime-status">
        <p><span className="text-muted-foreground">Endpoint:</span> {diagnostics?.endpoint ?? "—"}</p>
        <p><span className="text-muted-foreground">Primary model:</span> {diagnostics?.model || "(not configured)"}</p>
        <p><span className="text-muted-foreground">Fallback:</span> {diagnostics?.fallbackModel || "(none)"}</p>
        <p><span className="text-muted-foreground">Healthy:</span> {diagnostics?.healthy ? "YES" : "NO"}
          {diagnostics?.statusMessage ? ` — ${diagnostics.statusMessage}` : ""}
        </p>
        <p><span className="text-muted-foreground">DeepSeek API configured:</span> {diagnostics?.deepSeekConfigured ? "YES" : "NO"}</p>
        <p><span className="text-muted-foreground">Qwen API configured:</span> {diagnostics?.qwenConfigured ? "YES" : "NO"}</p>
        <p><span className="text-muted-foreground">OpenAI API configured:</span> {diagnostics?.openaiConfigured ? "YES" : "NO"}</p>
        <p><span className="text-muted-foreground">Night vision provider:</span> {diagnostics?.nightVisionProvider ?? "local"}</p>
        <p><span className="text-muted-foreground">Source:</span> {diagnostics?.endpointSource ?? "—"} · transport {diagnostics?.transport ?? "ollama"}</p>
      </div>

      {diagnostics?.deepSeekNote && (
        <p className="text-[10px] text-muted-foreground border-l-2 border-amber-300 pl-2">{diagnostics.deepSeekNote}</p>
      )}

      {hasUnsavedComposerChanges && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-950 p-2 text-[11px]" data-testid="composer-unsaved-warning">
          <strong>Unsaved changes</strong> — Save Local AI Settings first. Test is blocked.
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">Provider</label>
        <select
          className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
          value={provider}
          onChange={(e) => setProvider(e.target.value as "ollama" | "qwen" | "deepseek" | "openai")}
          data-testid="composer-test-provider"
        >
          <optgroup label="LOCAL OLLAMA">
            <option value="ollama">Local Ollama (clinic composer model)</option>
          </optgroup>
          <optgroup label="CLOUD">
            <option value="qwen">Qwen3.7-Plus ({diagnostics?.qwenDefaultModel ?? "qwen3.7-plus"})</option>
            <option value="deepseek">DeepSeek V4 Pro ({diagnostics?.deepSeekTextModel ?? "deepseek-v4-pro"})</option>
            <option value="openai">OpenAI ({diagnostics?.openaiConfigured ? "configured" : "key required"})</option>
          </optgroup>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">Study type / region</label>
        <input
          className="w-full h-9 px-3 text-xs rounded-lg border bg-background"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          data-testid="composer-test-region"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">Observations</label>
        <textarea
          className="w-full min-h-[9rem] px-3 py-2 text-xs rounded-lg border bg-background font-mono leading-5"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          data-testid="composer-test-observations"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button className="flex-1 h-9 text-xs gap-1.5" disabled={disabled || busy || hasUnsavedComposerChanges} onClick={() => void runTest()} data-testid="composer-test-run">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <TestTube2 size={14} />}
          TEST REPORT COMPOSER
        </Button>
        <Button className="flex-1 h-9 text-xs gap-1.5" variant="outline" disabled={disabled || busy || hasUnsavedComposerChanges} onClick={() => void runCompare()} data-testid="composer-test-compare">
          COMPARE LOCAL / QWEN / DEEPSEEK
        </Button>
      </div>

      {error && (
        <p className="text-xs text-red-700 flex items-center gap-1" data-testid="composer-test-error">
          <XCircle size={12} /> {error}
        </p>
      )}

      {result && <ResultCard title="Single run" result={result} />}
      {compare && (
        <div className="grid md:grid-cols-3 gap-2" data-testid="composer-compare-results">
          <ResultCard title="LOCAL OLLAMA" result={compare.local ?? null} />
          <ResultCard title="QWEN 3.7 PLUS" result={compare.qwen ?? null} />
          <ResultCard title="DEEPSEEK V4 PRO" result={compare.deepseek ?? null} />
        </div>
      )}

      <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-3 space-y-2" data-testid="deepseek-vision-trial">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Cloud size={12} /> Experimental DeepSeek Vision A/B
        </h4>
        <p className="text-[10px] text-muted-foreground">
          Compares local <code className="bg-muted px-1 rounded">qwen3-vl:8b</code> vs{" "}
          <code className="bg-muted px-1 rounded">{diagnostics?.deepSeekVisionModel ?? "deepseek-v4-flash-vision-exp"}</code>{" "}
          on the same synthetic de-identified image set. Does not replace overnight. No clinical write.
        </p>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={confirmCloudVision} onChange={(e) => setConfirmCloudVision(e.target.checked)} />
          Cloud Vision Trial — I confirm sending only de-identified derived images to DeepSeek official API
        </label>
        <Button size="sm" variant="outline" className="h-8 text-xs w-full" disabled={disabled || busy || !confirmCloudVision} onClick={() => void runVisionTrial()}>
          RUN VISION A/B TRIAL
        </Button>
        {vision && (
          <div className="grid md:grid-cols-2 gap-2 text-[11px]">
            <div className="rounded border p-2 space-y-1 font-mono">
              <p className="font-semibold">LOCAL VISION</p>
              <p>model: {vision.local?.model ?? "—"}</p>
              <p>latency: {vision.local?.latencyMs ?? "—"} ms</p>
              <p>ok: {vision.local?.ok ? "YES" : "NO"} {vision.local?.safeError ? `· ${vision.local.safeError}` : ""}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{vision.local?.proposalText ?? "(none)"}</pre>
            </div>
            <div className="rounded border p-2 space-y-1 font-mono">
              <p className="font-semibold">DEEPSEEK VISION</p>
              <p>model: {vision.deepseek?.model ?? "—"}</p>
              <p>latency: {vision.deepseek?.latencyMs ?? "—"} ms</p>
              <p>cost≈ {vision.deepseek?.approximateCostUsd != null ? `$${vision.deepseek.approximateCostUsd.toFixed(6)}` : "—"}</p>
              <p>ok: {vision.deepseek?.ok ? "YES" : "NO"} {vision.deepseek?.safeError ? `· ${vision.deepseek.safeError}` : ""}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{vision.deepseek?.proposalText ?? "(none)"}</pre>
            </div>
            <p className="md:col-span-2 text-[10px] text-muted-foreground">
              images={vision.sameImageCount} · writesClinicalReport={String(vision.writesClinicalReport)} ·
              DICOM excluded={String(vision.privacy?.rawDicomExcluded)} · IDs excluded={String(vision.privacy?.identifiersExcluded)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
