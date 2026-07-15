/**
 * paymentQrBroadcast.ts
 *
 * Tiny in-process pub/sub + ephemeral state store for the customer-facing
 * payment QR display — mirrors queueBroadcast.ts's SSE pattern exactly.
 *
 * WHY: Bill Desk's gateway-payment QR previously only reached a customer
 * display via window.open()'d onto a second monitor cable-connected to the
 * SAME staff PC (see PaymentQrDisplay.tsx's old query-param design). That
 * meant a separate networked device (Android tablet, standalone customer
 * monitor) could never show it on its own. This module lets Bill Desk PUSH
 * the current payment QR/status per "counter" (a clinic may have more than
 * one billing counter, each with its own customer-facing screen), and lets
 * any networked device SUBSCRIBE to just its counter's feed by browsing to
 * a durable URL — same architecture as Queue Display's :roomKey.
 *
 * State is intentionally NOT persisted to the database: a payment QR is a
 * short-lived (minutes), single-use artifact already fully owned by
 * bills.ts / IciciPaymentProvider.ts (untouched by this file). This module
 * only relays what Bill Desk already knows to whichever screen is watching.
 * A server restart simply clears any in-flight display state — harmless,
 * since Bill Desk re-pushes on the next payment attempt.
 *
 * ARCHITECTURE: Single-process (Docker, single-instance Synology NAS), same
 * as queueBroadcast.ts. If this ever scales horizontally, replace with a
 * Redis pub/sub channel — the SSE endpoint shape doesn't need to change.
 */

import EventEmitter from "node:events";

export type PaymentQrStatus = "pending" | "success" | "failed" | "expired";

export interface PaymentQrState {
  active: boolean;
  qrData?: string;
  amount?: number;
  txnRef?: string;
  patientName?: string;
  billNumber?: string;
  expiryTime?: string;
  status?: PaymentQrStatus;
  updatedAt: number;
}

const INACTIVE: PaymentQrState = { active: false, updatedAt: 0 };

class PaymentQrBroadcaster extends EventEmitter {
  private states = new Map<string, PaymentQrState>();

  getState(counterKey: string): PaymentQrState {
    return this.states.get(counterKey) ?? INACTIVE;
  }

  /** Called by Bill Desk once a gateway payment QR is ready to display. */
  show(counterKey: string, data: Omit<PaymentQrState, "active" | "status" | "updatedAt">): void {
    this.states.set(counterKey, { ...data, active: true, status: "pending", updatedAt: Date.now() });
    this.emit("payment-qr-update", counterKey);
  }

  /** Called by Bill Desk when its own status poll resolves. No-op if nothing is active for this counter. */
  setStatus(counterKey: string, status: PaymentQrStatus): void {
    const existing = this.states.get(counterKey);
    if (!existing?.active) return;
    this.states.set(counterKey, { ...existing, status, updatedAt: Date.now() });
    this.emit("payment-qr-update", counterKey);
  }

  /** Called when the Bill Desk gateway-payment dialog closes — returns the display to idle. */
  clear(counterKey: string): void {
    this.states.set(counterKey, INACTIVE);
    this.emit("payment-qr-update", counterKey);
  }
}

export const paymentQrBroadcaster = new PaymentQrBroadcaster();

// Allow many concurrent customer-display connections (default Node limit is
// 10). Comfortably more than any clinic will have billing counters.
paymentQrBroadcaster.setMaxListeners(500);
