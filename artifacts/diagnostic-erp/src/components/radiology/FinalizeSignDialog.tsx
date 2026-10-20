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
import {
  describeFinalizeQualityStatus,
  type CanonicalQualityFinding,
  type FinalizeQualityStatus,
} from "@/lib/reportQualityFinalize";
import {
  formatIncompleteChecks,
  hasRetryableCheck,
  type FinalizeServiceChecks,
} from "@/lib/finalizeChecks";
import { CompositionFinalizeGate, compositionFinalizeAllowed } from "@/components/radiology/zai-workspace/finalize-dialog";
import { useWorkspace } from "@/lib/zai-workspace/store";

const SESSION_SIGNER_KEY = "radiology_finalize_signer_id";

/**
 * One badge for the whole quality gate, coloured by what it found. Before this the
 * dialog rendered a hard-coded green "Ready to sign" beside a grey
 * `{warningCount} advisory` — and since every rule in the catalogue is
 * severity "warning" by settled policy, the green badge had no input that could
 * ever change it and the grey one counted a laterality contradiction as an
 * advisory. Both numbers now come from describeFinalizeQualityStatus, which also
 * produces the three lists rendered below it, so the badge cannot describe a
 * report the lists do not show.
 */
const QUALITY_BADGE_CLASS: Record<FinalizeQualityStatus["tone"], string> = {
  positive: "bg-emerald-600",
  neutral: "",
  caution: "bg-amber-500 text-amber-950",
  alert: "bg-red-600",
};

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
  // `signatures` is the eligible pool, filtered by the caller through
  // reportSignerEligibility: active rows only, and retired blocks are not offered
  // (#134 — the picker used to list them because GET /api/signatures answers them for
  // the admin screen, and a retired block could end up as the signer of record).
  const multi = signatures.length > 1;
  const single = signatures.length === 1 ? signatures[0]! : null;
  const [signerId, setSignerId] = useState<string>("");
  const [criticalAck, setCriticalAck] = useState(false);
  const [notifyReferring, setNotifyReferring] = useState(false);
  const [rememberSigner, setRememberSigner] = useState(true);
  const [impressionReviewedAnyway, setImpressionReviewedAnyway] = useState(false);
  const [impressionRefreshed, setImpressionRefreshed] = useState(false);
  const [advanceToNext, setAdvanceToNext] = useState(loadAutoAdvanceAfterFinalize);
  // What the last Retry returned, if a retry has happened. The dialog renders
  // from this rather than from the input it was opened with, so a check that
  // failed on the way in and succeeded on retry stops being shown as failed —
  // and what gets recorded at signing is what is on the screen at that moment.
  const [checksAfterRetry, setChecksAfterRetry] = useState<FinalizeServiceChecks | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);

  useEffect(() => {
    if (!open || !input) return;
    setCriticalAck(false);
    // Was pre-ticked from `input.criticalRequiresAck`, so a radiologist signing a
    // critical report was shown an already-checked box they had never chosen. An
    // attestation that starts true is not an attestation.
    setNotifyReferring(false);
    setImpressionReviewedAnyway(false);
    setImpressionRefreshed(false);
    setChecksAfterRetry(null);
    setRetryBusy(false);
    const remembered = loadSessionSignerId();
    if (multi) {
      // A remembered id is a browser convenience, not authority: it is honoured only
      // while it is still in this study's eligible pool. With two signers and no
      // usable memory the choice is left blank and Confirm stays disabled — nobody
      // signs a report as somebody else because a list had an order.
      const rememberedMatch = remembered != null && signatures.some((s) => s.id === remembered);
      setSignerId(rememberedMatch ? String(remembered) : "");
    } else if (single) {
      setSignerId(String(single.id));
    } else {
      setSignerId("");
    }
  }, [open, input, multi, single, signatures]);

  const qualityGate = checksAfterRetry?.qualityGate ?? input?.qualityGate ?? null;
  const checksIncomplete = checksAfterRetry?.checksIncomplete ?? input?.checksIncomplete ?? [];
  const validationSummary = checksAfterRetry?.validationSummary ?? input?.validationSummary ?? "";
  const checksAllRanAfterRetry = checksAfterRetry !== null && checksAfterRetry.checksIncomplete.length === 0;
  /** Retry is only offered when it can change the answer. A check that had
   *  nothing to read (no saved draft to validate) has nothing to read on the
   *  second attempt either, so a button that re-runs it would be naming a remedy
   *  that does not work — the block says so instead. */
  const retryCanHelp = input?.onRetryChecks != null && hasRetryableCheck(checksIncomplete);
  const qualityStatus = useMemo(
    () => (qualityGate ? describeFinalizeQualityStatus(qualityGate) : null),
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

  const retryChecks = () => {
    if (!input.onRetryChecks) return;
    setRetryBusy(true);
    // runFinalizeCheck() converts a rejection into a named failure, so this
    // promise resolves whatever the services do; there is no error branch here
    // to invent, and the block stays on screen until a check actually completes.
    input.onRetryChecks().then(setChecksAfterRetry).finally(() => setRetryBusy(false));
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
          {validationSummary}
          {input.warningBlock}
          {input.safetyBlock}
          {input.unbilledNote}
          {"\n"}After finalizing, editing is disabled.
        </pre>

        {/* What did not run, said in its own block in its own colour. The
            alternative is the summary above reading like a report nothing is
            wrong with, when the truth is that two services never looked at it.
            Deliberately not a gate: Confirm stays enabled, because these checks
            were advisory before this change and are advisory now — whether a
            failed check should stop a signature is the owner's policy call
            (ARCHITECTURE.md §8.1), not something a reliability fix gets to make. */}
        {checksIncomplete.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2"
          >
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Not checked
            </p>
            <pre className="whitespace-pre-wrap text-[11px] font-sans text-amber-900 dark:text-amber-100">
              {formatIncompleteChecks(checksIncomplete)}
            </pre>
            {retryCanHelp && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="finalize-retry-checks"
                disabled={retryBusy}
                onClick={retryChecks}
              >
                {retryBusy ? "Retrying checks…" : "Retry checks"}
              </Button>
            )}
          </div>
        )}

        {checksAllRanAfterRetry && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="finalize-retry-complete">
            All validation checks completed on retry.
          </p>
        )}

        <CompositionFinalizeGate
          gate={{
            impressionNeedsRefresh: Boolean(input.compositionImpressionNeedsRefresh),
            siblingWarnings: input.compositionSiblingWarnings ?? [],
            orphanedRecommendations: input.compositionOrphanedRecommendations ?? [],
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

        {qualityGate && qualityStatus && (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Report quality</span>
              <Badge variant="outline">Score {qualityGate.score}/100</Badge>
              <Badge
                variant={qualityStatus.tone === "neutral" ? "secondary" : "default"}
                className={QUALITY_BADGE_CLASS[qualityStatus.tone]}
                data-testid="finalize-quality-status"
              >
                {qualityStatus.label}
              </Badge>
            </div>

            {qualityStatus.unresolved.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Review before signing (does not block)
                </p>
                {qualityStatus.unresolved.map((f) => (
                  <FindingRow key={`block-${f.ruleId}-${f.evaluationId}`} finding={f} tone="blocker" />
                ))}
              </div>
            )}

            {/* Amber, and named as a contradiction. These are the findings saying
                two parts of THIS report disagree about a clinical fact — the side,
                the level, or whether a finding is still there. Signing stays
                unblocked (that policy is the owner's: ARCHITECTURE.md §8.1), but a
                contradiction is no longer filed under the same count as a repeated
                word. Not sliced: nothing the radiologist has to decide on may sit
                behind a "+N more". */}
            {qualityStatus.clinical.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Clinical contradictions in this report (review before signing — does not block)
                </p>
                {qualityStatus.clinical.map((f) => (
                  <FindingRow
                    key={`clin-${f.ruleId}-${f.evaluationId}-${f.message}`}
                    finding={f}
                    tone="warning"
                  />
                ))}
              </div>
            )}

            {/* Grey, not amber: prose and completeness gaps were competing for the
                same colour as the contradictions above, which is how a wrong level
                became invisible in a wall of style notes. */}
            {qualityStatus.advisory.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Advisories — wording and completeness (do not block finalize)
                </p>
                {qualityStatus.advisory.slice(0, 8).map((f) => (
                  <FindingRow key={`adv-${f.ruleId}-${f.message}`} finding={f} tone="info" />
                ))}
                {qualityStatus.advisory.length > 8 && (
                  <p className="text-[11px] text-muted-foreground">
                    +{qualityStatus.advisory.length - 8} more advisory finding(s)
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
                I have communicated this critical result to the treating clinician. Recorded permanently
                against your signed-in name; it cannot be cleared.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={notifyReferring} onCheckedChange={(v) => setNotifyReferring(v === true)} />
              <span className="text-xs leading-snug">
                I will contact the referring doctor myself. Saved to this report&rsquo;s audit trail as your
                intent — this screen sends no WhatsApp and no email.
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
                checksIncompleteAtSigning: checksIncomplete.map((f) => f.key),
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
