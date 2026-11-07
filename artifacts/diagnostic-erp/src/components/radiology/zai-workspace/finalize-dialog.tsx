/**
 * Composition finalize gate — stale impression, unowned sibling leftovers and
 * recommendations whose finding has since changed.
 *
 * The workspace's FinalizeSignDialog is the canonical sign path. This module
 * supplies the warning block it renders so a stale impression cannot be signed
 * silently. Emergency finalizes stay available via explicit acknowledgement.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  compositionFinalizeAllowed,
  staleImpressionRecovery,
  type CompositionFinalizeGateState,
} from "@/lib/observationLedger";

export { compositionFinalizeAllowed };
export type { CompositionFinalizeGateState };

export function CompositionFinalizeGate({
  gate,
  impressionRefreshed,
  impressionReviewedAnyway,
  refreshUnsettledReasons = [],
  onImpressionReviewedAnyway,
  onRefreshImpression,
}: {
  gate: CompositionFinalizeGateState;
  impressionRefreshed: boolean;
  impressionReviewedAnyway: boolean;
  /** Non-empty when a pressed Refresh rebuilt the Conclusion and the store still
   *  reports the pairing unsatisfied. Until this was passed, that press was the
   *  dialog's own evidence that the gate was answered (`impressionRefreshed`), so
   *  Confirm went green, the click resolved, and the finalize caller — which reads
   *  the live store — refused it. Measured in the browser as a Confirm & sign that
   *  sent no request. */
  refreshUnsettledReasons?: string[];
  onImpressionReviewedAnyway: (v: boolean) => void;
  onRefreshImpression: () => void;
}) {
  const stale = gate.impressionNeedsRefresh && !impressionRefreshed;
  const siblings = gate.siblingWarnings;
  const orphanedAdvice = gate.orphanedRecommendations;
  if (!stale && siblings.length === 0 && orphanedAdvice.length === 0 && gate.stalePatchCount === 0) {
    return null;
  }
  const unsettled = stale && refreshUnsettledReasons.length > 0;
  const recovery = staleImpressionRecovery(refreshUnsettledReasons);

  return (
    <div
      data-testid="composition-finalize-gate"
      className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2 text-sm"
    >
      <p className="font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        Review composition before signing
      </p>

      {stale && (
        <div data-testid="stale-impression-gate" className="space-y-2">
          <p className="text-xs text-amber-900/90">
            {unsettled
              ? recovery.text
              : "Impression is out of date relative to the observation ledger. Refresh it now, or explicitly acknowledge that you reviewed the current impression."}
          </p>
          {(!unsettled || recovery.mentionsRefreshAsRemedy) && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                data-testid="refresh-impression-now"
                onClick={onRefreshImpression}
              >
                Refresh Impression now
              </Button>
            </div>
          )}
          {unsettled && !recovery.mentionsRefreshAsRemedy && (
            <p
              className="text-[11px] text-amber-900/80"
              data-testid="stale-impression-unsettled"
            >
              Confirm &amp; sign stays disabled until you do one of those, so the button
              cannot look ready and then sign nothing.
            </p>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={impressionReviewedAnyway}
              onCheckedChange={(v) => onImpressionReviewedAnyway(v === true)}
              data-testid="sign-anyway-impression-ack"
            />
            <span className="text-xs leading-snug">Sign anyway — impression reviewed</span>
          </label>
        </div>
      )}

      {siblings.length > 0 && (
        <div data-testid="finalize-sibling-warnings" className="space-y-1">
          <p className="text-xs font-medium text-amber-900">
            Unowned leftover text (kept as written — not deleted)
          </p>
          <ul className={`space-y-1 text-[11px] text-amber-950/90 ${siblings.length > 2 ? "max-h-24 overflow-y-auto" : ""}`}>
            {siblings.map((w, i) => (
              <li key={`${w.token}-${i}`} data-testid={`finalize-sibling-warning-${i}`}>
                <span className="font-semibold">“{w.token}”</span>
                {" — "}
                <span>{w.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {orphanedAdvice.length > 0 && (
        <div data-testid="finalize-orphaned-recommendations" className="space-y-1">
          <p className="text-xs font-medium text-amber-900">
            Recommendation may no longer follow from the Findings (kept as written — not deleted)
          </p>
          <ul className={`space-y-1 text-[11px] text-amber-950/90 ${orphanedAdvice.length > 2 ? "max-h-24 overflow-y-auto" : ""}`}>
            {orphanedAdvice.map((w, i) => (
              <li key={`${w.sentence}-${i}`} data-testid={`finalize-orphaned-recommendation-${i}`}>
                <span>{w.sentence}</span>
                {" — "}
                <span className="text-amber-900/80">{w.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
