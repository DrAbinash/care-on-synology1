/**
 * One-click AI Pipeline Self-Test — Settings → Radiology → Local AI.
 * Distinguishes direct qwen vision from CARE /api/ai-reporting/draft path.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, MinusCircle, RefreshCw, Play, Copy, ChevronDown, ChevronRight, Activity,
} from "lucide-react";

type StepStatus = "pending" | "running" | "pass" | "fail" | "skip";

interface SelfTestStep {
  id: string;
  group: string;
  name: string;
  status: StepStatus;
  detail: string;
  elapsedMs?: number;
}

interface SelfTestResult {
  id: string;
  status: "queued" | "running" | "completed";
  final: "PASS" | "FAIL" | "PARTIAL" | "RUNNING" | "NO_MRI";
  summary: string;
  steps: SelfTestStep[];
  technical: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  progressLabel: string;
  diagnosticReport?: string;
}

const STEP_ICON: Record<StepStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  fail: XCircle,
  skip: MinusCircle,
  pending: MinusCircle,
  running: RefreshCw,
};

const STEP_CLASS: Record<StepStatus, string> = {
  pass: "text-green-700 border-green-200 bg-green-50 dark:bg-green-950/20",
  fail: "text-red-700 border-red-200 bg-red-50 dark:bg-red-950/20",
  skip: "text-muted-foreground border-muted bg-muted/30",
  pending: "text-muted-foreground border-muted bg-muted/20",
  running: "text-sky-800 border-sky-200 bg-sky-50 dark:bg-sky-950/20",
};

const FINAL_BADGE: Record<SelfTestResult["final"], { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  PASS: { label: "PASS", variant: "default" },
  FAIL: { label: "FAIL", variant: "destructive" },
  PARTIAL: { label: "PARTIAL / FAIL", variant: "destructive" },
  RUNNING: { label: "Running…", variant: "secondary" },
  NO_MRI: { label: "No MRI", variant: "outline" },
};

export function AiPipelineSelfTestPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [studyUid, setStudyUid] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  async function refreshStatus(id: string) {
    const r = await api.get<SelfTestResult>(`/api/radiology-ollama/pipeline-self-test/${id}`);
    setResult(r);
    if (r.status === "completed") {
      stopPoll();
      setBusy(false);
      toast({
        title: r.final === "PASS" ? "AI pipeline healthy" : "AI pipeline self-test finished",
        description: r.summary,
        variant: r.final === "PASS" ? "default" : "destructive",
      });
    }
    return r;
  }

  async function startTest() {
    stopPoll();
    setBusy(true);
    setDetailsOpen(false);
    try {
      const started = await api.post<SelfTestResult>("/api/radiology-ollama/pipeline-self-test", {
        studyInstanceUid: studyUid.trim() || undefined,
      });
      setResult(started);
      pollRef.current = setInterval(() => {
        void refreshStatus(started.id).catch(() => {
          /* keep polling; transient errors ok */
        });
      }, 2000);
      // Immediate first poll
      void refreshStatus(started.id);
    } catch (e: unknown) {
      setBusy(false);
      toast({
        title: "Could not start self-test",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function copyReport() {
    if (!result) return;
    const text =
      result.diagnosticReport ||
      [
        "AI PIPELINE SELF-TEST",
        result.summary,
        ...result.steps.map((s) => `${s.status.toUpperCase()} [${s.group}] ${s.name}: ${s.detail}`),
        JSON.stringify(result.technical, null, 2),
      ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Diagnostic report copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  const groups = result ? [...new Set(result.steps.map((s) => s.group))] : [];
  const finalMeta = result ? FINAL_BADGE[result.final] : null;

  return (
    <div
      className="rounded-xl border bg-card p-4 space-y-3"
      data-testid="ai-pipeline-self-test-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} className="text-primary" />
            AI Pipeline Self-Test
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">
            One click runs the same production checks from care-api: Orthanc MRI → one rendered JPEG →
            direct qwen vision → CARE <code className="bg-muted px-1 rounded">/api/ai-reporting/draft</code> path.
            Diagnostic only — no clinical report write, no bulk enqueue.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {result && result.status !== "completed" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              disabled={!result}
              onClick={() => result && void refreshStatus(result.id)}
              data-testid="ai-pipeline-self-test-refresh"
            >
              <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
              Refresh status
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={() => void startTest()}
            data-testid="ai-pipeline-self-test-run"
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
            {busy ? "Running…" : "Run AI Pipeline Self-Test"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px] space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground">Study (optional)</label>
          <input
            type="text"
            value={studyUid}
            onChange={(e) => setStudyUid(e.target.value)}
            placeholder="Leave empty = Use recent MRI"
            className="w-full h-8 px-2 text-xs rounded-md border bg-background font-mono"
            data-testid="ai-pipeline-self-test-study-uid"
          />
        </div>
        <p className="text-[10px] text-muted-foreground pb-1">
          [Use recent MRI] when empty, or paste Study Instance UID to [Choose study].
        </p>
      </div>

      {busy && result && result.status !== "completed" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <RefreshCw size={14} className="animate-spin" />
          {result.progressLabel || "Running…"}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {finalMeta && (
              <Badge variant={finalMeta.variant} className="text-[10px]">
                {finalMeta.label}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{result.summary}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(result.startedAt).toLocaleString()}
            </span>
            {result.status === "completed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px] gap-1"
                onClick={() => void copyReport()}
                data-testid="ai-pipeline-self-test-copy"
              >
                <Copy size={11} />
                Copy diagnostic report
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                {result.steps
                  .filter((s) => s.group === group)
                  .map((s) => {
                    const Icon = STEP_ICON[s.status];
                    return (
                      <div
                        key={s.id}
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${STEP_CLASS[s.status]}`}
                      >
                        <Icon
                          size={14}
                          className={`shrink-0 mt-0.5 ${s.status === "running" ? "animate-spin" : ""}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            {s.elapsedMs != null && (
                              <span className="text-[10px] opacity-80">{(s.elapsedMs / 1000).toFixed(1)}s</span>
                            )}
                          </div>
                          <p className="text-[11px] mt-0.5 opacity-90">{s.detail}</p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setDetailsOpen((v) => !v)}
          >
            {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Technical details
          </button>
          {detailsOpen && (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(result.technical, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
