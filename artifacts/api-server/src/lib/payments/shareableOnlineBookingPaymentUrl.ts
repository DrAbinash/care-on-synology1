import { buildIciciOrangePayQrUrl } from "./initiateIciciOrangePayment";

/**
 * URL staff should copy / WhatsApp for an online-booking payment link.
 * ICICI & HDFC must use the caredeoghar bridge (not raw HPP) so phones don't
 * hit Domain Validation Fail — Billing Desk QR already follows this rule.
 */
export function shareableOnlineBookingPaymentUrl(
  gateway: string,
  bookingRef: string,
  redirectUrl: string,
): string {
  if (gateway === "icici" || gateway === "hdfc") {
    return buildIciciOrangePayQrUrl(bookingRef);
  }
  return redirectUrl;
}
