/**
 * FinalizeSignDialog — workspace finalize confirmation with optional
 * signer picker (multi-signature clinics) and critical-finding gate.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { FinalizePromptInput, FinalizePromptResult } from "@/hooks/useFinalizeFlow";

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

  useEffect(() => {
    if (!open || !input) return;
    setCriticalAck(false);
    setNotifyReferring(input.criticalRequiresAck);
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

  if (!input) return null;

  const needsSigner = multi || single != null;
  const canConfirm =
    (!input.criticalRequiresAck || criticalAck) &&
    (!needsSigner || !!signerId || signatures.length === 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
