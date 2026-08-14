import type { EmergencyPaymentSplit, EmergencyTransaction, ReconciliationSummary } from "./types";

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function totalsFromPayments(payments: EmergencyPaymentSplit[]): {
  collected: number;
  cash: number;
  upi: number;
  card: number;
} {
  let cash = 0;
  let upi = 0;
  let card = 0;
  for (const p of payments) {
    if (p.method === "upi") upi += p.amount;
    else if (p.method === "card") card += p.amount;
    else cash += p.amount;
  }
  return {
    collected: roundMoney(cash + upi + card),
    cash: roundMoney(cash),
    upi: roundMoney(upi),
    card: roundMoney(card),
  };
}

export function summarizeTransactions(txns: EmergencyTransaction[]): Omit<
  ReconciliationSummary,
  "exactMatches" | "newPatients" | "needsReview" | "conflicts" | "alreadyImported" | "safeToImport" | "sessionUuid" | "sessionStartedAt" | "sessionEndedAt"
> & { bills: number } {
  const live = txns.filter((t) => t.status !== "VOID");
  let gross = 0;
  let discount = 0;
  let net = 0;
  let collected = 0;
  let due = 0;
  let cash = 0;
  let upi = 0;
  let card = 0;
  for (const t of live) {
    gross += t.grossAmount;
    discount += t.discountAmount;
    net += t.netAmount;
    collected += t.amountReceived;
    due += t.dueAmount;
    const pay = totalsFromPayments(t.payments);
    cash += pay.cash;
    upi += pay.upi;
    card += pay.card;
  }
  return {
    bills: live.length,
    gross: roundMoney(gross),
    discount: roundMoney(discount),
    net: roundMoney(net),
    collected: roundMoney(collected),
    due: roundMoney(due),
    cash: roundMoney(cash),
    upi: roundMoney(upi),
    card: roundMoney(card),
  };
}

export function duePreserved(t: EmergencyTransaction): boolean {
  return roundMoney(t.netAmount - t.amountReceived) === roundMoney(t.dueAmount);
}
