/**
 * Pre-deploy Ollama auto AI draft verification — Settings → Radiology (ERP only).
 */
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, ShieldCheck, Play, MinusCircle,
} from "lucide-react";

export type OllamaVerifyStatus = "PASS" | "FAIL" | "WARNING" | "SKIPPED";

export interface OllamaVerifyCheck {
  id: string;
  group: string;
  name: string;
  status: OllamaVerifyStatus;
  detail: string;
  remediation?: string;
  blocking?: boolean;
}

export interface OllamaVerifyResult {
  ok: boolean;
  blockingFailed?: boolean;
  checks: OllamaVerifyCheck[];
  summary: string;
  ranAt: string;
}

const STATUS_ICON: Record<OllamaVerifyStatus, typeof CheckCircle2> = {
  PASS: CheckCircle2,
  FAIL: XCircle,
  WARNING: AlertTriangle,
  SKIPPED: MinusCircle,
};

const STATUS_CLASS: Record<OllamaVerifyStatus, string> = {
  PASS: "text-green-600 border-green-200 bg-green-50 dark:bg-green-950/20",
  FAIL: "text-red-600 border-red-200 bg-red-50 dark:bg-red-950/20",
  WARNING: "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/20",
  SKIPPED: "text-muted-foreground border-muted bg-muted/30",
};

export function OllamaAiDraftVerifyPanel({
  compact = false,
  autoRunOnMount = true,
}: {
  compact?: boolean;
  /** Run quick checks when the panel opens (no live Ollama call). */
  autoRunOnMount?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OllamaVerifyResult | null>(null);
  const autoRan = useRef(false);

  async function runVerify(dryRun: boolean, opts?: { silent?: boolean }) {
    setBusy(true);
    try {
      const r = await api.post<OllamaVerifyResult>("/api/radiology-ollama/verify", {
        dryRun,
        runDraft: !dryRun,
      });
      setResult(r);
      if (!opts?.silent) {
        toast({
          title: r.ok ? "Verification passed" : "Verification needs attention",
          description: r.summary,
          variant: r.ok ? "default" : "destructive",
        });
      }
      return r;
    } catch (e: unknown) {
      if (!opts?.silent) {
        toast({
          title: "Verification failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRunOnMount || autoRan.current) return;
    autoRan.current = true;
    void runVerify(true, { silent: true });
  }, [autoRunOnMount]);

  const groups = result
    ? [...new Set(result.checks.map((c) => c.group))]
    : [];

  return (
    <div
      className="rounded-xl border bg-card p-4 space-y-3"
      data-testid="ollama-ai-draft-verify-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck size={14} className="text-primary" />
            Verify before redeploy
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">
            Runs inside the ERP — no terminal or SSH on the NAS. Each row shows PASS, FAIL, WARNING, or SKIPPED
            with the reason and what to fix. Safe: no fake patients, no report changes.
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={() => void runVerify(true)}
            data-testid="ollama-verify-quick"
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Re-run quick
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1"
            disabled={busy}
            onClick={() => void runVerify(false)}
            data-testid="ollama-verify-full-run"
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
            Full test
          </Button>
        </div>
      </div>

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Quick checks run automatically when you open this panel. <strong>Full test</strong> asks Ollama to
          generate once (~30–120s) to confirm drafting works end-to-end.
        </p>
      )}

      {busy && !result && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <RefreshCw size={14} className="animate-spin" />
          Running verification…
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.ok ? "default" : "destructive"} className="text-[10px]">
              {result.ok ? "Ready to redeploy" : "Fix before redeploy"}
            </Badge>
            <span className="text-xs text-muted-foreground">{result.summary}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(result.ranAt).toLocaleString()}
            </span>
          </div>

          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                {result.checks
                  .filter((c) => c.group === group)
                  .map((c) => {
                    const Icon = STATUS_ICON[c.status];
                    return (
                      <div
                        key={c.id}
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${STATUS_CLASS[c.status]}`}
                      >
                        <Icon size={14} className="shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[9px] h-4 font-semibold uppercase ${STATUS_CLASS[c.status]}`}
                            >
                              {c.status}
                            </Badge>
                            <span className="font-medium">{c.name}</span>
                            {c.blocking && c.status === "FAIL" && (
                              <Badge variant="destructive" className="text-[9px] h-4">must fix</Badge>
                            )}
                          </div>
                          <p className="text-[11px] mt-0.5 opacity-90">{c.detail}</p>
                          {c.remediation && (
                            <p className="text-[10px] mt-1 font-medium">→ {c.remediation}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
