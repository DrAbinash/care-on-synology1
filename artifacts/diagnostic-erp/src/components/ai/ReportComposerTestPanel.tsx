/**
 * Local AI → Report Composer Test card.
 * Exercises real runReportComposer via POST /api/radiology/report-composer/test.
 * Never writes clinical report data.
 */
import { useState } from "react";
import { Bot, CheckCircle2, RefreshCw, TestTube2, XCircle, AlertTriangle } from "lucide-react";
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
  deepSeekNote?: string | null;
};

type TestResponse = {
  ok?: boolean;
  writesClinicalReport?: boolean;
  runtime?: {
    enabled?: boolean;
    model?: string;
    fallbackModel?: string | null;
    endpoint?: string;
    endpointSource?: string;
    statusMessage?: string | null;
    transport?: string;
  };
  compose?: {
    ok?: boolean;
    model?: string;
    fallbackUsed?: boolean;
    latencyMs?: number;
    safeError?: string;
    displayStatus?: string;
    ollamaCalled?: boolean;
    personaLoaded?: boolean;
    personaVersion?: string | null;
    provider?: string | null;
    httpStatus?: number | null;
    userMessage?: string | null;
    draft?: {
      findings?: string;
      impression?: string;
      recommendation?: string;
      warnings?: string[];
    } | null;
  };
  validationOk?: boolean;
  validation?: {
    ok?: boolean;
    warnings?: string[];
    errors?: string[];
  };
  error?: string;
};

type Props = {
  diagnostics: ComposerRuntimeDiag | null;
  diagnosticsLoading?: boolean;
  onRefreshDiagnostics: () => void;
  /** When true, local UI composer selection differs from persisted clinic_settings. */
  hasUnsavedComposerChanges: boolean;
  disabled?: boolean;
};

export function ReportComposerTestPanel({
  diagnostics,
  diagnosticsLoading,
  onRefreshDiagnostics,
  hasUnsavedComposerChanges,
  disabled,
}: Props) {
  const [region, setRegion] = useState("MRI LS Spine");
  const [observations, setObservations] = useState(DEFAULT_OBSERVATIONS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    if (hasUnsavedComposerChanges) {
      setError("Save Local AI Settings before testing — UI selection is not active runtime yet.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<TestResponse>("/api/radiology/report-composer/test", {
        studyType: region,
        region: region.toUpperCase().includes("LS") ? "LS_SPINE" : region,
        modality: "MR",
        observationsText: observations,
      });
      setResult(r);
      onRefreshDiagnostics();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const display = result?.compose?.displayStatus;
  const draft = result?.compose?.draft;

  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50/40 dark:bg-sky-950/10 p-5 space-y-3"
      data-testid="report-composer-test-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Bot size={14} className="text-sky-700" /> Report Composer Test
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Uses the real Draft-from-Observations engine (<code className="bg-muted px-1 rounded">runReportComposer</code>).
            Synthetic non-PHI only — never writes a clinical report.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 shrink-0"
          disabled={diagnosticsLoading}
          onClick={onRefreshDiagnostics}
        >
          <RefreshCw size={11} className={diagnosticsLoading ? "animate-spin" : undefined} />
          Refresh status
        </Button>
      </div>

      <div
        className="rounded-md border bg-white/80 dark:bg-background/40 p-2.5 text-[11px] space-y-1 font-mono"
        data-testid="composer-runtime-status"
      >
        <p>
          <span className="text-muted-foreground">Endpoint:</span>{" "}
          {diagnostics?.endpoint ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Primary model:</span>{" "}
          {diagnostics?.model || "(not configured)"}
        </p>
        <p>
          <span className="text-muted-foreground">Fallback:</span>{" "}
          {diagnostics?.fallbackModel || "(none)"}
        </p>
        <p>
          <span className="text-muted-foreground">Healthy:</span>{" "}
          {diagnostics?.healthy ? "YES" : "NO"}
          {diagnostics?.statusMessage ? ` — ${diagnostics.statusMessage}` : ""}
        </p>
        <p>
          <span className="text-muted-foreground">Source:</span>{" "}
          {diagnostics?.endpointSource ?? "—"} · transport {diagnostics?.transport ?? "ollama"}
        </p>
      </div>

      {diagnostics?.deepSeekNote && (
        <p className="text-[10px] text-muted-foreground border-l-2 border-amber-300 pl-2">
          {diagnostics.deepSeekNote}
        </p>
      )}

      {hasUnsavedComposerChanges && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 text-amber-950 p-2 text-[11px]"
          data-testid="composer-unsaved-warning"
        >
          <strong>Unsaved changes</strong> — composer model selection is not active until you click{" "}
          <em>Save Local AI Settings</em>. Test is blocked.
        </div>
      )}

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

      <Button
        className="w-full h-9 text-xs gap-1.5"
        disabled={disabled || busy || hasUnsavedComposerChanges}
        onClick={() => void runTest()}
        data-testid="composer-test-run"
      >
        {busy ? <RefreshCw size={14} className="animate-spin" /> : <TestTube2 size={14} />}
        TEST REPORT COMPOSER
      </Button>

      {error && (
        <p className="text-xs text-red-700 flex items-center gap-1" data-testid="composer-test-error">
          <XCircle size={12} /> {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 border-t pt-3" data-testid="composer-test-result">
          <div
            className={`rounded-md border px-2.5 py-2 text-[11px] font-semibold ${
              display === "LOCAL_AI_SUCCESS"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : display === "FALLBACK_DRAFT"
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : "border-red-300 bg-red-50 text-red-900"
            }`}
            data-testid="composer-test-display-status"
          >
            {display === "LOCAL_AI_SUCCESS" && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={12} /> LOCAL AI SUCCESS
              </span>
            )}
            {display === "FALLBACK_DRAFT" && (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle size={12} /> FALLBACK DRAFT — Local AI was not used.
              </span>
            )}
            {display !== "LOCAL_AI_SUCCESS" && display !== "FALLBACK_DRAFT" && (
              <span>FAILED — {result.compose?.safeError ?? result.error ?? "compose failed"}</span>
            )}
          </div>

          <div className="rounded-md border bg-white/80 dark:bg-background/40 p-2.5 text-[11px] space-y-0.5 font-mono">
            <p>Provider: {result.compose?.provider ?? result.runtime?.transport ?? "—"}</p>
            <p>Resolved endpoint: {result.runtime?.endpoint ?? "—"}</p>
            <p>Resolved model: {result.compose?.model ?? "—"}</p>
            <p>Local vs Cloud: Local Ollama endpoint (cloud tags only if Ollama serves them)</p>
            <p>Fallback used: {result.compose?.fallbackUsed ? "YES" : "NO"}</p>
            <p>Persona loaded: {result.compose?.personaLoaded ? "YES" : "NO"}
              {result.compose?.personaVersion ? ` (${result.compose.personaVersion})` : ""}
            </p>
            <p>Latency: {result.compose?.latencyMs ?? "—"} ms</p>
            <p>HTTP: {result.compose?.httpStatus ?? (result.compose?.ollamaCalled ? 200 : "n/a")}</p>
            <p>
              Validation:{" "}
              {(result.validationOk ?? result.validation?.ok)
                ? `PASS${(result.validation?.warnings?.length ?? 0) > 0 ? ` · warnings: ${result.validation!.warnings!.join(", ")}` : ""}`
                : `FAIL · ${(result.validation?.errors ?? []).join(", ") || "errors"}`}
            </p>
            <p>Writes clinical report: {result.writesClinicalReport ? "YES" : "NO"}</p>
          </div>

          {draft && (
            <div className="space-y-1" data-testid="composer-test-draft">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Generated report (read-only)
              </p>
              <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap font-mono">
                {`FINDINGS\n${draft.findings || "(empty)"}\n\nIMPRESSION\n${draft.impression || "(empty)"}\n\nRECOMMENDATION\n${draft.recommendation || "(empty)"}`}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
