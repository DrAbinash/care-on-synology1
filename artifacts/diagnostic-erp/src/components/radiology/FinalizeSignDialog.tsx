/**
 * FinalizeSignDialog — workspace finalize confirmation with optional
 * signer picker (multi-signature clinics) and critical-finding ack.
 * Quality findings are advisory only — they do not block sign-off
 * (single-radiologist clinic; fewer gates at software start).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import type { FinalizePromptInput, FinalizePromptResult } from "@/hooks/useFinalizeFlow";
import { computeUnresolvedBlockers, type CanonicalQualityFinding } from "@/lib/reportQualityFinalize";
import { CompositionFinalizeGate, compositionFinalizeAllowed } from "@/components/radiology/zai-workspace/finalize-dialog";
import { useWorkspace } from "@/lib/zai-workspace/store";

const SESSION_SIGNER_KEY = "radiology_finalize_signer_id";

/** RIS throughput pref — auto-open the next eligible study after finalize. */
const AUTO_ADVANCE_KEY = "care_auto_advance_after_finalize";

export function loadAutoAdvanceAfterFinalize(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_ADVANCE_KEY);
    if (raw == null) return true; // default ON — clinic asked for fast output
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

function saveAutoAdvanceAfterFinalize(v: boolean) {
  try { localStorage.setItem(AUTO_ADVANCE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}

export function loadSessionSignerId(): number | null {
  try {
    const raw = sessionStorage.getItem(SESSION_SIGNER_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveSessionSignerId(id: number) {
  try {
    sessionStorage.setItem(SESSION_SIGNER_KEY, String(id));
  } catch { /* ignore */ }
}

type Props = {
  open: boolean;
  input: FinalizePromptInput | null;
  onResolve: (result: FinalizePromptResult) => void;
  onCancel: () => void;
};

function FindingRow({
  finding,
  tone,
}: {
  finding: CanonicalQualityFinding;
  tone: "blocker" | "warning" | "info";
}) {
  const cls =
    tone === "blocker"
      ? "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        : "border-border bg-muted/30";
  return (
    <div className={`text-xs rounded border px-3 py-2 ${cls}`}>
      <span className="font-semibold">{finding.ruleId}</span>
      {finding.tier && (
        <span className="text-[10px] uppercase ml-1 opacity-70">{finding.tier}</span>
      )}
      <span> — {finding.message}</span>
      {finding.suggestedFix && (
        <p className="mt-1 text-[11px] opacity-80">Fix: {finding.suggestedFix}</p>
      )}
    </div>
  );
}

export default function FinalizeSignDialog({ open, input, onResolve, onCancel }: Props) {
  const signatures = useMemo(
    () => (Array.isArray(input?.signatures) ? input.signatures : []),
    [input?.signatures],
  );
  const sugandha = signatures.find((s) => /sugandha/i.test(s.name));
  const multi = signatures.length > 1 && !sugandha;
  const single = signatures.length === 1 ? signatures[0]! : sugandha ?? null;
  const [signerId, setSignerId] = useState<string>("");
  const [criticalAck, setCriticalAck] = useState(false);
  const [notifyReferring, setNotifyReferring] = useState(false);
  const [rememberSigner, setRememberSigner] = useState(true);
  const [impressionReviewedAnyway, setImpressionReviewedAnyway] = useState(false);
  const [impressionRefreshed, setImpressionRefreshed] = useState(false);
  const [advanceToNext, setAdvanceToNext] = useState(loadAutoAdvanceAfterFinalize);

  useEffect(() => {
    if (!open || !input) return;
    setCriticalAck(false);
    setNotifyReferring(input.criticalRequiresAck);
    setImpressionReviewedAnyway(false);
    setImpressionRefreshed(false);
    const remembered = loadSessionSignerId();
    if (multi) {
      const match = remembered && signatures.some((s) => s.id === remembered)
        ? String(remembered)
        : String(signatures[0]?.id ?? "");
      setSignerId(match);
    } else if (single) {
      setSignerId(String(single.id));
    } else {
      setSignerId("");
    }
  }, [open, input, multi, single, signatures]);

  const qualityGate = input?.qualityGate ?? null;
  const unresolvedBlockers = useMemo(
    () => (qualityGate ? computeUnresolvedBlockers(qualityGate.findings, qualityGate.overrides ?? []) : []),
    [qualityGate],
  );
  const advisoryWarnings = useMemo(
    () =>
      qualityGate?.advisoryFindings.filter((f) => f.severity === "warning" || f.severity === "blocker") ?? [],
    [qualityGate],
  );

  if (!input) return null;

  const needsSigner = multi || single != null;
  const compositionOk = compositionFinalizeAllowed({
    impressionNeedsRefresh: Boolean(input.compositionImpressionNeedsRefresh),
    impressionRefreshed,
    impressionReviewedAnyway,
  });
  const canConfirm =
    (!input.criticalRequiresAck || criticalAck) &&
    (!needsSigner || !!signerId || signatures.length === 0) &&
    compositionOk;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Finalize and sign this report?</DialogTitle>
        </DialogHeader>

        <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded-md p-3 border border-border font-sans">
          {input.identity}
          {"\n\n"}
          {input.validationSummary}
          {input.warningBlock}
          {input.safetyBlock}
          {input.unbilledNote}
          {"\n"}After finalizing, editing is disabled.
        </pre>

        <CompositionFinalizeGate
          gate={{
            impressionNeedsRefresh: Boolean(input.compositionImpressionNeedsRefresh),
            siblingWarnings: input.compositionSiblingWarnings ?? [],
            stalePatchCount: input.compositionStalePatchCount ?? 0,
          }}
          impressionRefreshed={impressionRefreshed}
          impressionReviewedAnyway={impressionReviewedAnyway}
          onImpressionReviewedAnyway={setImpressionReviewedAnyway}
          onRefreshImpression={() => {
            useWorkspace.getState().refreshImpressionFromLedger();
            setImpressionRefreshed(true);
          }}
        />

        {qualityGate && (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Report quality</span>
              <Badge variant="outline">Score {qualityGate.score}/100</Badge>
              <Badge className="bg-emerald-600">Ready to sign</Badge>
              {qualityGate.warningCount > 0 && (
                <Badge variant="secondary">{qualityGate.warningCount} advisory</Badge>
              )}
            </div>

            {unresolvedBlockers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Review before signing (does not block)
                </p>
                {unresolvedBlockers.map((f) => (
                  <FindingRow key={`block-${f.ruleId}-${f.evaluationId}`} finding={f} tone="blocker" />
                ))}
              </div>
            )}

            {advisoryWarnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Advisories (review before signing — do not block finalize)
                </p>
                {advisoryWarnings.slice(0, 8).map((f) => (
                  <FindingRow key={`adv-${f.ruleId}-${f.message}`} finding={f} tone="warning" />
                ))}
                {advisoryWarnings.length > 8 && (
                  <p className="text-[11px] text-muted-foreground">
                    +{advisoryWarnings.length - 8} more advisory finding(s)
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {input.criticalRequiresAck && (
          <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 p-3 space-y-2 text-sm">
            <p className="font-semibold text-rose-800 dark:text-rose-200">Critical finding — acknowledge before signing</p>
            {input.criticalSummary && (
              <p className="text-xs text-rose-700 dark:text-rose-300">{input.criticalSummary}</p>
            )}
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={criticalAck} onCheckedChange={(v) => setCriticalAck(v === true)} />
              <span className="text-xs leading-snug">
                I have reviewed this critical finding and documented communication with the referring clinician (or will notify now).
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={notifyReferring} onCheckedChange={(v) => setNotifyReferring(v === true)} />
              <span className="text-xs leading-snug">
                Notify referring doctor after finalize (WhatsApp/email template when configured).
              </span>
            </label>
          </div>
        )}

        {multi && (
          <div className="space-y-2">
            <Label className="text-xs">Sign as</Label>
            <Select value={signerId} onValueChange={setSignerId}>
              <SelectTrigger><SelectValue placeholder="Choose signature" /></SelectTrigger>
              <SelectContent>
                {signatures.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox checked={rememberSigner} onCheckedChange={(v) => setRememberSigner(v === true)} />
              Remember my choice for this session
            </label>
          </div>
        )}

        {!multi && single && (
          <p className="text-xs text-muted-foreground">Will sign as <strong>{single.name}</strong>.</p>
        )}

        {signatures.length === 0 && (
          <p className="text-xs text-amber-700">
            No active signature on file — finalize will mark the study final; sign later from Report Hub.
          </p>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={advanceToNext}
            onCheckedChange={(v) => {
              const next = v === true;
              setAdvanceToNext(next);
              saveAutoAdvanceAfterFinalize(next);
            }}
          />
          <span>After finalize, open the next study in my queue automatically</span>
        </label>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            disabled={!canConfirm}
            data-testid="finalize-confirm-sign"
            onClick={() => {
              const id = signerId ? Number(signerId) : null;
              if (id && rememberSigner) saveSessionSignerId(id);
              onResolve({
                confirmed: true,
                signatureId: id && Number.isInteger(id) ? id : null,
                criticalAcknowledged: criticalAck,
                notifyReferring,
                impressionReviewedAnyway,
                impressionRefreshed,
                advanceToNext,
              });
            }}
          >
            Confirm &amp; sign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
