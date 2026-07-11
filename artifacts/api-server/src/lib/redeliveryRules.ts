/**
 * redeliveryRules.ts — Ticket BEND-1 Phase 2 (D10 closure), pure.
 *
 * Decision rules for durable amended-report re-delivery obligations.
 * An obligation says: "recipient R received revision X over channel C; the
 * chain now has a newer deliverable revision Y — R is owed Y." The service
 * (redeliveryObligations.ts) persists these; the rules here decide WHAT to
 * create/complete and are unit-tested exhaustively.
 *
 * Privacy: obligations never store the raw recipient — only maskRecipient()
 * output for display plus a sha256 fingerprint for matching. The raw address
 * stays solely in report_shares under the existing permission policy.
 */

import { createHash } from "node:crypto";

// ── Recipient masking / fingerprinting ───────────────────────────────────────

/** Masked recipient string — enough for staff to recognize the destination,
 *  never the full address. (Moved from patient-reports.ts D9 — one copy.) */
export function maskRecipient(recipient: string | null): string | null {
  if (!recipient) return null;
  if (recipient === "public-link") return "public-link";
  if (recipient.includes("@")) {
    const [user, domain] = recipient.split("@");
    return `${user.slice(0, 1)}***@${domain}`;
  }
  const digits = recipient.replace(/\D/g, "");
  if (digits.length >= 4) return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
  return "***";
}

/** Matching key: sha256(channel:normalized-recipient). Phone numbers compare
 *  by digits only (formatting-insensitive); emails case-insensitively. */
export function recipientFingerprint(channel: string, recipient: string): string {
  const normalized = recipient.includes("@")
    ? recipient.trim().toLowerCase()
    : recipient.replace(/\D/g, "") || recipient.trim().toLowerCase();
  return createHash("sha256").update(`${channel.toLowerCase()}:${normalized}`).digest("hex");
}

// ── Obligation state machine ─────────────────────────────────────────────────

export type ObligationStatus =
  | "pending" | "acknowledged" | "dismissed" | "queued" | "sent" | "failed" | "completed";

export const OPEN_OBLIGATION_STATUSES: ReadonlySet<ObligationStatus> =
  new Set(["pending", "acknowledged", "queued", "failed"]);

/** Manual transitions an operator may request; automatic ones (sent,
 *  completed, failed) come from the delivery pipeline itself. */
const MANUAL_TRANSITIONS: Record<string, ReadonlySet<ObligationStatus>> = {
  acknowledge: new Set(["pending", "failed"]),
  dismiss: new Set(["pending", "acknowledged", "failed"]),
  queue: new Set(["pending", "acknowledged", "failed"]),
};

export function canTransitionObligation(
  action: "acknowledge" | "dismiss" | "queue",
  current: ObligationStatus,
): boolean {
  return MANUAL_TRANSITIONS[action]?.has(current) ?? false;
}

export const OBLIGATION_ACTION_STATUS: Record<"acknowledge" | "dismiss" | "queue", ObligationStatus> = {
  acknowledge: "acknowledged",
  dismiss: "dismissed",
  queue: "queued",
};

// ── Creation (idempotent, per amendment) ─────────────────────────────────────

export interface PriorShare {
  id: number;
  reportId: number;
  channel: string;
  recipient: string | null;
}

export interface ObligationSeed {
  reportId: number;          // the amended revision owed
  sequenceNumber: number;
  rootReportId: number;
  channel: string;
  recipientMasked: string;
  recipientFingerprint: string;
  sourceShareId: number;
  sourceReportId: number;
}

/** From the SENT shares of OLDER revisions, derive the obligations owed for
 *  the amended revision — deduped by (channel, recipient fingerprint),
 *  keeping the earliest source share. Shares without a recipient (print) and
 *  public links create no duty (no addressable recipient). */
export function decideObligationsForAmendment(args: {
  amendedReportId: number;
  sequenceNumber: number;
  rootReportId: number;
  priorSentShares: PriorShare[];
}): ObligationSeed[] {
  const seeds = new Map<string, ObligationSeed>();
  for (const share of args.priorSentShares) {
    if (share.reportId === args.amendedReportId) continue; // not "prior"
    if (!share.recipient || share.recipient === "public-link") continue;
    if (share.channel !== "whatsapp" && share.channel !== "email") continue; // addressable channels only
    const fp = recipientFingerprint(share.channel, share.recipient);
    const key = `${share.channel}:${fp}`;
    if (seeds.has(key)) continue;
    seeds.set(key, {
      reportId: args.amendedReportId,
      sequenceNumber: args.sequenceNumber,
      rootReportId: args.rootReportId,
      channel: share.channel,
      recipientMasked: maskRecipient(share.recipient) ?? "***",
      recipientFingerprint: fp,
      sourceShareId: share.id,
      sourceReportId: share.reportId,
    });
  }
  return [...seeds.values()];
}

// ── Completion ───────────────────────────────────────────────────────────────

/** A delivery completes an open obligation ONLY when the delivered row is the
 *  chain's LATEST revision and the channel+recipient match. Delivering an old
 *  revision never completes anything — the recipient still lacks the latest. */
export function deliveryCompletesObligation(args: {
  deliveredReportId: number;
  latestReportId: number;
  deliveredChannel: string;
  deliveredFingerprint: string;
  obligation: { status: ObligationStatus; channel: string; recipientFingerprint: string; rootReportId: number };
  deliveredRootReportId: number;
}): boolean {
  if (args.deliveredReportId !== args.latestReportId) return false;
  if (!OPEN_OBLIGATION_STATUSES.has(args.obligation.status) && args.obligation.status !== "sent") return false;
  if (args.obligation.rootReportId !== args.deliveredRootReportId) return false;
  return (
    args.obligation.channel === args.deliveredChannel &&
    args.obligation.recipientFingerprint === args.deliveredFingerprint
  );
}
