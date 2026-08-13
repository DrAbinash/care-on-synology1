/**
 * FinalizeSignDialog — workspace finalize confirmation with optional
 * signer picker (multi-signature clinics), critical-finding gate, and
 * canonical report-quality findings with override workflow.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import type { FinalizePromptInput, FinalizePromptResult } from "@/hooks/useFinalizeFlow";
import {
  computeUnresolvedBlockers,
  type CanonicalQualityFinding,
  type QualityOverrideRow,
} from "@/lib/reportQualityFinalize";
import { submitQualityOverride } from "@/lib/reportQualityFinalizeApi";

const SESSION_SIGNER_KEY = "radiology_finalize_signer_id";

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
  const multi = signatures.length > 1;
  const single = signatures.length === 1 ? signatures[0] : null;
  const [signerId, setSignerId] = useState<string>("");
  const [criticalAck, setCriticalAck] = useState(false);
  const [notifyReferring, setNotifyReferring] = useState(false);
  const [rememberSigner, setRememberSigner] = useState(true);
  const [localOverrides, setLocalOverrides] = useState<QualityOverrideRow[]>([]);
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overridePending, setOverridePending] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !input) return;
    setCriticalAck(false);
    setNotifyReferring(input.criticalRequiresAck);
    setLocalOverrides([]);
    setOverrideReasons({});
    setOverrideError(null);
    setOverridePending(null);
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
  const mergedOverrides = useMemo(
    () => [...(qualityGate?.overrides ?? []), ...localOverrides],
    [qualityGate?.overrides, localOverrides],
  );
  const unresolvedBlockers = useMemo(
    () => (qualityGate ? computeUnresolvedBlockers(qualityGate.findings, mergedOverrides) : []),
    [qualityGate, mergedOverrides],
  );
  const advisoryWarnings = useMemo(
    () =>
      qualityGate?.advisoryFindings.filter((f) => f.severity === "warning" || f.severity === "blocker") ?? [],
    [qualityGate],
  );

  if (!input) return null;

  const needsSigner = multi || single != null;
  const qualityBlocksFinalize = unresolvedBlockers.length > 0;
  const canConfirm =
    (!input.criticalRequiresAck || criticalAck) &&
    (!needsSigner || !!signerId || signatures.length === 0) &&
    !qualityBlocksFinalize;

  const handleOverride = async (finding: CanonicalQualityFinding) => {
    const reason = overrideReasons[finding.ruleId]?.trim();
    if (!reason || !finding.evaluationId) {
      setOverrideError("Enter a justification before overriding.");
      return;
    }
    setOverrideError(null);
    setOverridePending(finding.ruleId);
    try {
      const overrideId = await submitQualityOverride(finding.evaluationId, finding.ruleId, reason);
      setLocalOverrides((prev) => [
        ...prev,
        {
          id: overrideId,
          evaluationId: finding.evaluationId!,
          ruleId: finding.ruleId,
          reason,
          action: "override",
        },
      ]);
      setOverrideReasons((prev) => ({ ...prev, [finding.ruleId]: "" }));
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Override failed");
    } finally {
      setOverridePending(null);
    }
  };

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

        {qualityGate && (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Report quality</span>
              <Badge variant="outline">Score {qualityGate.score}/100</Badge>
              {qualityBlocksFinalize ? (
                <Badge variant="destructive">
                  {unresolvedBlockers.length} blocker(s) — override required
                </Badge>
              ) : (
                <Badge className="bg-emerald-600">Ready to sign</Badge>
              )}
              {qualityGate.warningCount > 0 && (
                <Badge variant="secondary">{qualityGate.warningCount} advisory</Badge>
              )}
            </div>

            {unresolvedBlockers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-800 dark:text-red-200 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blocking issues (structured rules — override with reason to proceed)
                </p>
                {unresolvedBlockers.map((f) => (
                  <div key={`block-${f.ruleId}-${f.evaluationId}`} className="space-y-1">
                    <FindingRow finding={f} tone="blocker" />
                    <div className="flex flex-wrap gap-2 items-end pl-1">
                      <div className="flex-1 min-w-[200px] space-y-1">
                        <Label className="text-[10px]">Override reason</Label>
                        <Input
                          className="h-8 text-xs"
                          value={overrideReasons[f.ruleId] ?? ""}
                          onChange={(e) =>
                            setOverrideReasons((prev) => ({ ...prev, [f.ruleId]: e.target.value }))
                          }
                          placeholder="Clinical justification (required)"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={overridePending === f.ruleId}
                        onClick={() => void handleOverride(f)}
                      >
                        {overridePending === f.ruleId ? "Saving…" : "Override"}
                      </Button>
                    </div>
                  </div>
                ))}
                {overrideError && (
                  <p className="text-xs text-red-600">{overrideError}</p>
                )}
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

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              const id = signerId ? Number(signerId) : null;
              if (id && rememberSigner) saveSessionSignerId(id);
              onResolve({
                confirmed: true,
                signatureId: id && Number.isInteger(id) ? id : null,
                criticalAcknowledged: criticalAck,
                notifyReferring,
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
