import { toast } from "@/hooks/use-toast";

/**
 * Used for both the toast's own lifetime and the suppression window, so the
 * two cannot drift apart: while a refusal is still on screen a repeat adds
 * nothing, and the moment it is gone the next one is owed a fresh toast.
 */
const ANNOUNCE_MS = 8000;

const lastAnnounced = new Map<string, number>();

/**
 * Says out loud that a clinical write to a signed report was refused.
 *
 * `refuseSignedMutation` had only ever logged this, so all 21 guarded mutators
 * refused silently. Most of them are reachable from a control that is still
 * enabled — the Confirm button of an overwrite dialog armed before somebody
 * signed, a canvas tile, a macro — and every one of them returned having
 * changed nothing. The radiologist clicked, the dialog closed, and the only
 * record was a line in the browser console that nobody in a reporting room is
 * going to open.
 *
 * Keyed per action because `setField` and `mergeField` fire on every keystroke
 * and every insertion: a stale editor left open on a signed report would
 * otherwise replace the message faster than it can be read, and with
 * `TOAST_LIMIT` at 1 the radiologist would watch it flicker instead of seeing
 * one sentence stay put.
 *
 * Returns true when a toast was shown, false when an identical refusal is
 * still on screen.
 */
export function announceSignedMutationRefusal(action: string, now: number = Date.now()): boolean {
  const previous = lastAnnounced.get(action);
  if (previous !== undefined && now - previous < ANNOUNCE_MS) return false;
  lastAnnounced.set(action, now);
  toast({
    title: "Change refused — the report is signed",
    description:
      "Nothing was applied. To correct it, withdraw the signature from Report Hub — only the signer or an administrator can.",
    variant: "destructive",
    duration: ANNOUNCE_MS,
  });
  return true;
}
