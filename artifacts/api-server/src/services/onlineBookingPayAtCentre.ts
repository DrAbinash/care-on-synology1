/**
 * Reception/phone "Pay at Centre" is not a gateway settlement.
 * Staff confirm must create an unpaid due bill; cash/UPI/card is collected
 * later at Billing Desk so accounts post the real method — not Online Collections.
 */
export function isReceptionPayAtCentre(booking: {
  source?: string | null;
  status: string;
}): boolean {
  const src = (booking.source || "").toLowerCase();
  return (src === "reception" || src === "phone") && booking.status === "pending_payment";
}
