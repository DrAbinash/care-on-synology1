/**
 * useFinalizeFlow — promise-based finalize confirmation for the radiology
 * workspace. Replaces window.confirm with a dialog that can collect a
 * signer when multiple active signatures exist, and can hard-block on
 * unacknowledged critical findings.
 */
import { useCallback, useRef, useState } from "react";
import type { FinalizeQualityGate } from "@/lib/reportQualityFinalize";

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
};

export type FinalizePromptResult = {
  confirmed: boolean;
  signatureId: number | null;
  criticalAcknowledged: boolean;
  notifyReferring: boolean;
};

const CANCELLED: FinalizePromptResult = {
  confirmed: false,
  signatureId: null,
  criticalAcknowledged: false,
  notifyReferring: false,
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
