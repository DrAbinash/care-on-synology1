/**
 * Shared CARE financial invariants. Keep money policy in one place so
 * billing, online booking, day-close, GST, and commission cannot drift.
 */
import {
  amountsEqualPaise,
  billBalanceFromParts,
  billTotalFromParts,
  isFiniteMoney,
  isNonNegativeMoney,
  moneyMax0,
  moneyPercent,
  paiseToRupees,
  rupeesToPaise,
  sumRupeesToPaise,
} from "./money";

export const INVALID_COLLECTION_STATUSES = new Set([
  "superseded",
  "void",
  "failed",
  "reversed",
  "cancelled",
  "refund_failed",
]);

export function isCollectiblePayment(row: {
  amount?: unknown;
  settlementStatus?: string | null;
}): boolean {
  const status = String(row.settlementStatus ?? "").trim().toLowerCase();
  if (status && INVALID_COLLECTION_STATUSES.has(status)) return false;
  const paise = rupeesToPaise(row.amount);
  return Number.isFinite(paise) && paise !== 0;
}

export function filterCollectiblePayments<T extends {
  amount?: unknown;
  settlementStatus?: string | null;
}>(rows: T[]): T[] {
  return rows.filter(isCollectiblePayment);
}

export function assertNonNegativePayment(amount: unknown): string | null {
  if (!isFiniteMoney(amount)) return "Payment amount must be a finite number";
  if (rupeesToPaise(amount) <= 0) {
    return "Payment amount must be greater than zero. Use the refund endpoint to process refunds.";
  }
  return null;
}

export function assertPaymentWithinOutstanding(amount: unknown, outstanding: unknown): string | null {
  const pay = rupeesToPaise(amount);
  const due = rupeesToPaise(outstanding);
  if (!Number.isFinite(pay) || !Number.isFinite(due)) return "Payment amount is invalid";
  if (pay > due + 1) {
    return `Payment amount (₹${paiseToRupees(pay).toFixed(2)}) exceeds outstanding balance (₹${paiseToRupees(Math.max(0, due)).toFixed(2)})`;
  }
  return null;
}

export function assertDiscountNotBelowCollected(opts: {
  subtotal: unknown;
  discount: unknown;
  tax?: unknown;
  collectedNet: unknown;
}): string | null {
  if (!isNonNegativeMoney(opts.discount)) return "Discount must be zero or a positive number";
  if (rupeesToPaise(opts.discount) > rupeesToPaise(opts.subtotal) + 1) {
    return `Discount (₹${Number(opts.discount).toFixed(2)}) cannot exceed subtotal (₹${Number(opts.subtotal).toFixed(2)})`;
  }
  const newTotal = billTotalFromParts(opts.subtotal, opts.discount, opts.tax ?? 0);
  const collected = rupeesToPaise(opts.collectedNet);
  if (rupeesToPaise(newTotal) + 1 < collected) {
    return `Discount would make the bill total (₹${newTotal.toFixed(2)}) less than already collected (₹${paiseToRupees(collected).toFixed(2)}). Refund or adjust payment first.`;
  }
  return null;
}

export function gstComponentsReconcile(opts: {
  taxable: unknown;
  cgst?: unknown;
  sgst?: unknown;
  igst?: unknown;
  gst?: unknown;
  total?: unknown;
}): boolean {
  const taxable = rupeesToPaise(opts.taxable);
  const cgst = rupeesToPaise(opts.cgst ?? 0);
  const sgst = rupeesToPaise(opts.sgst ?? 0);
  const igst = rupeesToPaise(opts.igst ?? 0);
  const gst = opts.gst == null ? cgst + sgst + igst : rupeesToPaise(opts.gst);
  if (!Number.isFinite(taxable) || !Number.isFinite(gst)) return false;
  if (Math.abs(cgst + sgst + igst - gst) > 1) return false;
  if (opts.total != null) {
    const total = rupeesToPaise(opts.total);
    if (Math.abs(taxable + gst - total) > 1) return false;
  }
  return true;
}

export function emergencyImportLinesReconcile(opts: {
  lines: Array<{ unitPrice: unknown; quantity?: unknown }>;
  grossAmount: unknown;
  discountAmount?: unknown;
  netAmount: unknown;
  amountReceived: unknown;
  dueAmount: unknown;
}): string | null {
  const linePaise = opts.lines.reduce((s, line) => {
    const qty = Math.max(1, Math.round(Number(line.quantity || 1)));
    const unit = rupeesToPaise(line.unitPrice);
    if (!Number.isFinite(unit) || unit < 0) return NaN;
    return s + unit * qty;
  }, 0);
  if (!Number.isFinite(linePaise)) return "Imported line prices are invalid";
  const gross = rupeesToPaise(opts.grossAmount);
  if (Math.abs(linePaise - gross) > 1) {
    return `Imported line total (₹${paiseToRupees(linePaise).toFixed(2)}) does not match gross (₹${paiseToRupees(gross).toFixed(2)})`;
  }
  const discount = rupeesToPaise(opts.discountAmount ?? 0);
  const net = rupeesToPaise(opts.netAmount);
  if (Math.abs(gross - discount - net) > 1) {
    return `Imported net (₹${paiseToRupees(net).toFixed(2)}) does not match gross − discount`;
  }
  const received = rupeesToPaise(opts.amountReceived);
  const due = rupeesToPaise(opts.dueAmount);
  if (Math.abs(net - received - due) > 1) {
    return `Imported due math mismatch: net ${paiseToRupees(net)} received ${paiseToRupees(received)} due ${paiseToRupees(due)}`;
  }
  return null;
}

/**
 * Online booking is full-payment-only (product policy).
 * Reception/phone "pay at centre" is a desk workflow, not online settlement.
 */
export function assertOnlineBookingFullPayment(opts: {
  frozenAmount: unknown;
  capturedAmount: unknown;
  payAtCentre?: boolean;
}): string | null {
  if (opts.payAtCentre) return null;
  const frozen = rupeesToPaise(opts.frozenAmount);
  const captured = rupeesToPaise(opts.capturedAmount);
  if (!Number.isFinite(frozen) || frozen <= 0) return "Authoritative booking amount is missing";
  if (!Number.isFinite(captured) || captured <= 0) return "Online booking requires full payment";
  if (captured < frozen) {
    return `Online booking requires full payment of ₹${paiseToRupees(frozen).toFixed(2)}; received ₹${paiseToRupees(captured).toFixed(2)}`;
  }
  if (captured > frozen + 1) {
    return `Captured payment ₹${paiseToRupees(captured).toFixed(2)} does not match booking amount ₹${paiseToRupees(frozen).toFixed(2)}`;
  }
  return null;
}

export function packageEffectivePrice(pkg: {
  price: unknown;
  discountPct?: unknown;
  discountAmount?: unknown;
}): number {
  const base = rupeesToPaise(pkg.price);
  const afterPct = base - rupeesToPaise(moneyPercent(pkg.price, pkg.discountPct ?? 0));
  return moneyMax0(paiseToRupees(afterPct - rupeesToPaise(pkg.discountAmount ?? 0)));
}

export function allocatePackageLinePrices(
  tests: Array<{ testId: number; catalogPrice: unknown; discountPct?: unknown; discountAmount?: unknown }>,
  packageEffectiveRupees: unknown,
): Array<{ testId: number; price: number }> {
  if (tests.length === 0) return [];
  const anyOverride = tests.some(
    (t) => rupeesToPaise(t.discountPct ?? 0) > 0 || rupeesToPaise(t.discountAmount ?? 0) > 0,
  );
  if (anyOverride) {
    return tests.map((t) => {
      const base = rupeesToPaise(t.catalogPrice);
      const afterPct = base - rupeesToPaise(moneyPercent(t.catalogPrice, t.discountPct ?? 0));
      const price = moneyMax0(paiseToRupees(afterPct - rupeesToPaise(t.discountAmount ?? 0)));
      return { testId: t.testId, price };
    });
  }
  const weights = tests.map((t) => Math.max(1, rupeesToPaise(t.catalogPrice)));
  const target = rupeesToPaise(packageEffectiveRupees);
  const sumW = weights.reduce((s, w) => s + w, 0) || tests.length;
  const scaled = weights.map((w) => Math.round((w * target) / sumW));
  const drift = target - scaled.reduce((s, p) => s + p, 0);
  if (scaled.length) scaled[scaled.length - 1] += drift;
  return tests.map((t, i) => ({ testId: t.testId, price: paiseToRupees(Math.max(0, scaled[i] ?? 0)) }));
}

export function applyVipMultiplier(price: unknown, isVip: boolean, vipPercent: unknown): number {
  if (!isVip) return paiseToRupees(rupeesToPaise(price));
  return moneyMax0(paiseToRupees(rupeesToPaise(price) + rupeesToPaise(moneyPercent(price, vipPercent))));
}

/**
 * Desk line-price policy (reception / billing staff):
 * - Admin/super_admin may set any non-negative price.
 * - Non-admin may bill at or below catalog (+ VIP ceiling when isVip).
 * - Non-admin markup above the ceiling is rejected (PRICE_CEILING → HTTP 403).
 *
 * Package component splits often land below catalog; that undercharge must be
 * allowed. Online/public booking must NOT use this path for trust — those
 * flows freeze amounts from catalog/packages separately.
 */
export function resolveStaffLinePrice(opts: {
  catalogPrice: unknown;
  requestedPrice: unknown;
  isAdmin: boolean;
  isVip: boolean;
  vipPercent: unknown;
}): { price: number; error?: string; code?: "PRICE_CEILING" | "INVALID_PRICE" } {
  const catalog = rupeesToPaise(opts.catalogPrice);
  if (!Number.isFinite(catalog) || catalog < 0) {
    return { price: 0, error: "Catalog price is invalid", code: "INVALID_PRICE" };
  }
  const ceiling = rupeesToPaise(applyVipMultiplier(opts.catalogPrice, opts.isVip, opts.vipPercent));
  const requested = rupeesToPaise(opts.requestedPrice);
  if (!Number.isFinite(requested) || requested < 0) {
    return {
      price: 0,
      error: opts.isAdmin
        ? "Override price must be a non-negative number"
        : "Line price must be a non-negative number",
      code: "INVALID_PRICE",
    };
  }
  if (opts.isAdmin) {
    return { price: paiseToRupees(requested) };
  }
  // 1 paise tolerance matches legacy `requested - maxAllowed > 0.01`.
  if (requested > ceiling + 1) {
    return {
      price: 0,
      error:
        "Only admin/super-admin may bill a test above its catalog price" +
        (opts.isVip ? ` (VIP ceiling)` : ""),
      code: "PRICE_CEILING",
    };
  }
  return { price: paiseToRupees(requested) };
}

export function recomputedBillBalance(opts: {
  subtotal: unknown;
  discount: unknown;
  tax?: unknown;
  paid: unknown;
  refund?: unknown;
}): { total: number; balance: number } {
  const total = billTotalFromParts(opts.subtotal, opts.discount, opts.tax ?? 0);
  const balance = billBalanceFromParts(total, opts.paid, opts.refund ?? 0);
  return { total, balance };
}

export function parsePackageIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * Server-authoritative line prices for a diagnostic order.
 * Package groups are allocated from package configuration (client line
 * prices for those members are ignored). Leftover / unpackaged tests use
 * resolveStaffLinePrice: non-admin may undercharge up to the VIP/catalog
 * ceiling; markup above the ceiling is rejected.
 */
export function resolveOrderLinePrices(opts: {
  tests: Array<{ testId: number; requestedPrice: unknown }>;
  catalogByTestId: Map<number, unknown>;
  packageGroups: Array<{
    testIds: number[];
    effectivePrice: number;
    componentDiscounts?: Map<number, { discountPct?: unknown; discountAmount?: unknown }>;
  }>;
  isAdmin: boolean;
  isVip: boolean;
  vipPercent: unknown;
}): {
  lines: Array<{ testId: number; price: number }>;
  error?: string;
  code?: "PRICE_CEILING" | "INVALID_PRICE";
} {
  const allocated = new Set<number>();
  const out: Array<{ testId: number; price: number }> = [];

  for (const group of opts.packageGroups) {
    const members = group.testIds.filter((id) => opts.catalogByTestId.has(id) && !allocated.has(id));
    if (members.length === 0) continue;
    const alloc = allocatePackageLinePrices(
      members.map((testId) => ({
        testId,
        catalogPrice: opts.catalogByTestId.get(testId),
        discountPct: group.componentDiscounts?.get(testId)?.discountPct,
        discountAmount: group.componentDiscounts?.get(testId)?.discountAmount,
      })),
      applyVipMultiplier(group.effectivePrice, opts.isVip, opts.vipPercent),
    );
    for (const row of alloc) {
      allocated.add(row.testId);
      out.push(row);
    }
  }

  for (const t of opts.tests) {
    if (allocated.has(t.testId)) continue;
    const resolved = resolveStaffLinePrice({
      catalogPrice: opts.catalogByTestId.get(t.testId),
      requestedPrice: t.requestedPrice,
      isAdmin: opts.isAdmin,
      isVip: opts.isVip,
      vipPercent: opts.vipPercent,
    });
    if (resolved.error) return { lines: [], error: resolved.error, code: resolved.code };
    allocated.add(t.testId);
    out.push({ testId: t.testId, price: resolved.price });
  }

  if (out.length === 0) {
    return { lines: [], error: "No billable tests on this order", code: "INVALID_PRICE" };
  }
  return { lines: out };
}

/**
 * Public/kiosk/website online booking may be confirmed only after a verified
 * full payment (status already "paid") or when reception/phone pay-at-centre
 * applies.
 *
 * Staff QR/manual confirm of a *pending* public booking is allowed only when
 * the caller asserts an independently collected amount that equals the frozen
 * total (desk/UPI full collection). A partial staffCollectedAmount cannot
 * confirm. Auto/webhook paths cannot use the staff-assertion branch.
 */
export function canConfirmOnlineBooking(opts: {
  source?: string | null;
  status: string;
  frozenAmount: unknown;
  payAtCentre: boolean;
  autoConfirm: boolean;
  /** Desk/staff full collection asserted for pending public bookings. Must equal frozen. */
  staffCollectedAmount?: unknown;
}): string | null {
  if (opts.status === "confirmed") return null;
  if (opts.payAtCentre) return null;
  if (opts.status === "paid") {
    return assertOnlineBookingFullPayment({
      frozenAmount: opts.frozenAmount,
      capturedAmount: opts.frozenAmount,
    });
  }
  if (!opts.autoConfirm && opts.staffCollectedAmount != null) {
    return assertOnlineBookingFullPayment({
      frozenAmount: opts.frozenAmount,
      capturedAmount: opts.staffCollectedAmount,
    });
  }
  return "Online booking requires verified full payment before confirmation";
}

export { amountsEqualPaise, rupeesToPaise, paiseToRupees, sumRupeesToPaise };
