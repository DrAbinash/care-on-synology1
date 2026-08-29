/**
 * Exact rupee arithmetic for CARE billing.
 *
 * PostgreSQL stores money as numeric(10,2). JavaScript Number is binary float.
 * All money math in this module converts to integer paise (₹1 = 100 paise),
 * computes, then converts back. API responses stay ordinary rupee numbers.
 */

export const PAISE_PER_RUPEE = 100;
/** Inclusive tolerance for gateway/legacy float equality (1 paise). */
export const MONEY_EPS_PAISE = 1;

export function rupeesToPaise(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  if (!Number.isFinite(paise)) return NaN;
  return Math.round(paise) / PAISE_PER_RUPEE;
}

export function rupeesToFixed(value: unknown): string {
  const p = rupeesToPaise(value);
  if (!Number.isFinite(p)) return "0.00";
  return paiseToRupees(p).toFixed(2);
}

export function isFiniteMoney(value: unknown): boolean {
  const p = rupeesToPaise(value);
  return Number.isFinite(p);
}

export function isNonNegativeMoney(value: unknown): boolean {
  const p = rupeesToPaise(value);
  return Number.isFinite(p) && p >= 0;
}

export function addPaise(...parts: number[]): number {
  return parts.reduce((s, p) => s + (Number.isFinite(p) ? Math.round(p) : 0), 0);
}

export function sumRupeesToPaise(values: unknown[]): number {
  return values.reduce<number>((s, v) => {
    const p = rupeesToPaise(v);
    return s + (Number.isFinite(p) ? p : 0);
  }, 0);
}

export function amountsEqualPaise(a: unknown, b: unknown, epsPaise = MONEY_EPS_PAISE): boolean {
  const pa = rupeesToPaise(a);
  const pb = rupeesToPaise(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return false;
  return Math.abs(pa - pb) <= epsPaise;
}

export function moneyAdd(...rupees: unknown[]): number {
  return paiseToRupees(sumRupeesToPaise(rupees));
}

export function moneySub(a: unknown, b: unknown): number {
  return paiseToRupees(rupeesToPaise(a) - rupeesToPaise(b));
}

export function moneyMulQty(rate: unknown, qty: number): number {
  const q = Number.isFinite(qty) ? Math.round(qty) : 0;
  return paiseToRupees(rupeesToPaise(rate) * q);
}

/** percent is a human percent (18 → 18%), not a fraction. */
export function moneyPercent(base: unknown, percent: unknown): number {
  const baseP = rupeesToPaise(base);
  const pct = Number(percent);
  if (!Number.isFinite(baseP) || !Number.isFinite(pct)) return NaN;
  return paiseToRupees(Math.round((baseP * pct) / 100));
}

export function moneyMax0(value: unknown): number {
  const p = rupeesToPaise(value);
  if (!Number.isFinite(p)) return 0;
  return paiseToRupees(Math.max(0, p));
}

export function billTotalFromParts(subtotal: unknown, discount: unknown, tax: unknown): number {
  return paiseToRupees(rupeesToPaise(subtotal) - rupeesToPaise(discount) + rupeesToPaise(tax));
}

export function billBalanceFromParts(total: unknown, paid: unknown, refund: unknown): number {
  return moneyMax0(paiseToRupees(rupeesToPaise(total) - rupeesToPaise(paid) - rupeesToPaise(refund)));
}

/** Scale line prices so they sum to target rupees. Last line absorbs remainder. */
export function scaleLinePaiseToTotal(linePaise: number[], targetRupees: unknown): number[] {
  const target = rupeesToPaise(targetRupees);
  if (!Number.isFinite(target) || linePaise.length === 0) {
    return linePaise.map((p) => Math.max(0, Math.round(p)));
  }
  const cleaned = linePaise.map((p) => Math.max(0, Math.round(p)));
  const sum = cleaned.reduce((s, p) => s + p, 0);
  if (sum <= 0) {
    const out = cleaned.map(() => 0);
    out[out.length - 1] = Math.max(0, target);
    return out;
  }
  const scaled = cleaned.map((p) => Math.round((p * target) / sum));
  const drift = target - scaled.reduce((s, p) => s + p, 0);
  scaled[scaled.length - 1] += drift;
  return scaled.map((p) => Math.max(0, p));
}
