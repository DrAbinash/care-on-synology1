/**
 * useFinalizeFlow — promise-based finalize confirmation for the radiology
 * workspace. Replaces window.confirm with a dialog that can collect a
 * signer when multiple active signatures exist, and can hard-block on
 * unacknowledged critical findings.
 */
import { useCallback, useRef, useState } from "react";
import type { FinalizeQualityGate } from "@/lib/reportQualityFinalize";
import type { FinalizeCheckNotRun, FinalizeServiceChecks } from "@/lib/finalizeChecks";

export type SignatureOption = { id: number; name: string };

export type FinalizePromptInput = {
  identity: string;
  validationSummary: string;
  warningBlock: string;
  safetyBlock: string;
  unbilledNote: string;
  signatures: SignatureOption[];
  /** When true, confirm is disabled until the radiologist acknowledges. */
  criticalRequiresAck: boolean;
  criticalSummary?: string;
  /** Canonical report-quality evaluation snapshot (workspace-finalize source). */
  qualityGate?: FinalizeQualityGate | null;
  /** Service checks that did not look at this report. Absent or empty means all ran. */
  checksIncomplete?: FinalizeCheckNotRun[];
  /**
   * Re-runs the service checks and returns a fresh set. The dialog's Retry button
   * calls this and renders from whatever comes back, so a radiologist can fix a
   * transient failure without closing the dialog, losing their signer choice and
   * starting the whole gauntlet again.
   */
  onRetryChecks?: () => Promise<FinalizeServiceChecks>;
  compositionImpressionNeedsRefresh?: boolean;
  compositionSiblingWarnings?: Array<{ sentence: string; token: string; hint: string }>;
  compositionOrphanedRecommendations?: Array<{ sentence: string; hint: string }>;
  compositionStalePatchCount?: number;
};

export type FinalizePromptResult = {
  confirmed: boolean;
  signatureId: number | null;
  /** The caller must act on this: it is the tick that gates Confirm, and the
   *  report row carries criticalAcknowledgedAt/By for exactly this attestation. */
  criticalAcknowledged: boolean;
  /** The caller must act on this. There is no outbound channel behind it (the
   *  shipped /critical-alerts/:id/notify records attempts for the same reason),
   *  so it is recorded as intent in the report's audit details. */
  notifyReferring: boolean;
  /** Dialog-internal, reported for completeness only. Both are consumed inside
   *  FinalizeSignDialog by compositionFinalizeAllowed before Confirm is enabled,
   *  and onRefreshImpression already calls refreshImpressionFromLedger() — so the
   *  caller correctly does nothing with them. Do not "fix" that. */
  impressionReviewedAnyway?: boolean;
  impressionRefreshed?: boolean;
  /**
   * Which checks had still not completed at the moment Sign was pressed — after
   * any retry, so what is recorded is what the radiologist was shown rather than
   * what the first attempt happened to return. Consumed by useStudyFinalize's
   * signing audit details; absent when the dialog carried no check state.
   */
  checksIncompleteAtSigning?: string[];
  /** RIS throughput: open the next eligible study after finalize. */
  advanceToNext?: boolean;
  /**
   * RIS throughput: print the SIGNED artifact (GET /api/patient-reports/:id/print,
   * which autoPrints itself) as soon as finalize completes, before the
   * auto-advance. The popup is opened at the Confirm click — the user gesture
   * popup blockers key on — and filled only once the signature has landed, so
   * the print can never race the sign that produces it.
   */
  printAfterSigning?: boolean;
};

const CANCELLED: FinalizePromptResult = {
  confirmed: false,
  signatureId: null,
  criticalAcknowledged: false,
  notifyReferring: false,
  advanceToNext: false,
  printAfterSigning: false,
};

export function useFinalizeFlow() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<FinalizePromptInput | null>(null);
  const resolverRef = useRef<((r: FinalizePromptResult) => void) | null>(null);

  const promptFinalize = useCallback((payload: FinalizePromptInput): Promise<FinalizePromptResult> => {
    setInput(payload);
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolve = useCallback((result: FinalizePromptResult) => {
    setOpen(false);
    setInput(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(result);
  }, []);

  const cancel = useCallback(() => resolve(CANCELLED), [resolve]);

  return { open, input, promptFinalize, resolve, cancel };
}
