/**
 * Billing Desk payment math helpers.
 *
 * Selecting mode "online" only *intends* a gateway payment — the desk must not
 * treat that amount as collected until the gateway confirms (or staff records
 * cash/UPI/card via POST /api/payments).
 */

export type PaymentAmountRow = {
  mode?: string;
  method?: string;
  amount?: string | number | null;
};

function rowMethod(p: PaymentAmountRow): string {
  return String(p.mode ?? p.method ?? "")
    .toLowerCase()
    .trim();
}

/** Confirmed tender only — excludes unconfirmed gateway "online" rows. */
export function confirmedPaymentTotal(payments: PaymentAmountRow[]): number {
  return payments.reduce((sum, p) => {
    if (rowMethod(p) === "online") return sum;
    return sum + (Number(p.amount) || 0);
  }, 0);
}

/** Sum of gateway-intent "online" rows (not yet money in hand). */
export function onlinePaymentTotal(payments: PaymentAmountRow[]): number {
  return payments.reduce((sum, p) => {
    if (rowMethod(p) !== "online") return sum;
    return sum + (Number(p.amount) || 0);
  }, 0);
}
