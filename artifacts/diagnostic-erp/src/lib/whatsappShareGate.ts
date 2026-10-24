/**
 * whatsappShareGate — the WhatsApp share dialog's blocked-state decisions,
 * mirroring the server's two doors so the dialog can never promise a click
 * the server is guaranteed to refuse:
 *
 *  - POST /patient-reports/:id/share resolves only
 *    pending_verification | verified | delivered (else 404/409);
 *  - POST /patient-reports/:id/verify answers 409 "Sign the report first"
 *    for a draft — so a DRAFT report never offers verify-then-send, only the
 *    finalize-first explanation (#1168).
 */

/** The statuses the share endpoint treats as deliverable. */
export const WHATSAPP_SHARE_DELIVERABLE_STATUSES = [
  "pending_verification",
  "verified",
  "delivered",
] as const;

const FINALIZE_FIRST = "Report is not signed yet. Finalize first, then send on WhatsApp.";
const WILL_VERIFY = "Will verify (countersign) this report, then send on WhatsApp.";

export interface WhatsAppShareGate {
  /** The server's /share gate would accept this report. */
  isDeliverable: boolean;
  /** The report is loaded and NOT deliverable — an explanation is owed. */
  needsVerify: boolean;
  /** The caller may countersign on the way to sending (never for a draft). */
  offerVerifyThenSend: boolean;
  /** The single line the dialog shows for a blocked report (null = nothing owed). */
  blockedMessage: string | null;
}

export function whatsappShareGate(
  status: string | null | undefined,
  canVerify: boolean,
  loaded = true,
): WhatsAppShareGate {
  const s = (status ?? "").trim().toLowerCase();
  const isDeliverable = (WHATSAPP_SHARE_DELIVERABLE_STATUSES as readonly string[]).includes(s);
  // No claim before the report has answered — a blank/absent status is
  // "unknown", not "blocked".
  const needsVerify = loaded && s !== "" && !isDeliverable;
  const draft = s === "draft";
  const offerVerifyThenSend = needsVerify && !draft && canVerify;
  return {
    isDeliverable,
    needsVerify,
    offerVerifyThenSend,
    blockedMessage: needsVerify ? (offerVerifyThenSend ? WILL_VERIFY : FINALIZE_FIRST) : null,
  };
}
