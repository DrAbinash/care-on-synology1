// ─── Referral commission: the calculation, in one place ───────────────────────
//
// Three different things need to work out what a referral line is worth:
//   1) the Super Admin plugin's commission.ts   (the Referral Report / exports)
//   2) the Super Admin plugin's doctor-ledger.ts (Doctor Due / payouts)
//   3) this server's hourly reconcile cron       (hold/release audit trail)
//
// They used to each carry their own copy. The copies drifted: the (now removed)
// month-end commission email disagreed with the on-screen Referral Report for 9
// of 10 doctors. Everything money-related therefore lives here and nowhere else,
// so a change to the rules cannot reach one screen and miss another.
//
// This module is deliberately pure: no database, no express, no schema import.
// It never reads or exposes commission data — it only does arithmetic on values
// the caller has already fetched, so it does not weaken the rule that commission
// is only readable with the pen drive plugged in.

// Where the rate that produced a line actually came from. A clinic that prices
// by slab (per test / per category) needs to tell an intentional slab apart from
// a line that merely fell through to the catch-all or the profile default — the
// latter two usually mean an unconfigured slab, not a decision.
export type RuleScope = "test" | "category" | "all" | "default" | "none";

// Structural shapes rather than schema types: callers pass their drizzle rows
// straight in, and this file stays dependency-free.
export type CalcRule = {
  name: string;
  type: string;                    // 'percentage' | 'fixed'
  value: string | number;
  scope: string;                   // 'all' | 'category' | 'test'
  categories: string | null;       // JSON array of category names
  testIds: string | null;          // JSON array of test ids
  appliesTo?: string | null;       // 'all' | 'inhouse' | 'outsourced'
  isExclusive: boolean;
  isActive: boolean;
};

export type CalcDoctor = {
  defaultCommission: string | number | null;
  defaultCommissionType?: string | null;
};

export type CalcTest = {
  category: string | null;
  testType?: string | null;        // 'inhouse' | 'outsourced'
};

export type CalcLine = {
  id?: number;
  testId: number;
  price: string | number;
  outsourceCost?: string | null;   // snapshotted onto the order line at order time
};

export type CalcResult = {
  commission: number;
  ruleName: string;
  ruleType: string;
  ruleValue: number;
  ruleScope: RuleScope;
  isOutsourced: boolean;
  outsourceCost: number;
  /** The amount the rate was actually applied to (post-VIP, post-margin). */
  commissionBase: number;
};

export function safeParseArray<T = unknown>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    // A rule with malformed JSON must not take the whole report down — it simply
    // matches nothing. (A bare JSON.parse here is what crashed the old email.)
    return [];
  }
}

// A rule may be restricted to in-house or outsourced work. A rule that does not
// match the line's kind is skipped at every rung of the ladder, so an
// "Outsourced Pathology 20%" slab never pays out on in-house work and vice
// versa. Rules created before this existed carry appliesTo='all' and behave
// exactly as they always did.
export function ruleAppliesToKind(r: CalcRule, isOutsourced: boolean): boolean {
  const a = r.appliesTo ?? "all";
  if (a === "inhouse") return !isOutsourced;
  if (a === "outsourced") return isOutsourced;
  return true;
}

// Single source of truth for "which rule applies to this test line".
//
// Precedence (must stay in lock-step with every report that displays the matched
// rule's value/type — otherwise the UI shows a rule the calculation never used):
//   1) exclusive test/category rule
//   2) non-exclusive test/category rule
//   3) catch-all (scope="all") rule
// Returns undefined when nothing matches; the caller then falls back to the
// doctor's profile default.
//
// `category` is the test's category, or null when the test row is unknown — in
// which case category-scoped rules never match.
export function findMatchingRule(
  testId: number,
  category: string | null,
  rules: CalcRule[],
  isOutsourced = false,
): CalcRule | undefined {
  const testMatch = (r: CalcRule) => !!r.testIds && safeParseArray<number>(r.testIds).includes(testId);
  const catMatch = (r: CalcRule) =>
    category !== null && !!r.categories && safeParseArray<string>(r.categories).includes(category || "");
  const specific = (r: CalcRule) => (r.scope === "test" && testMatch(r)) || (r.scope === "category" && catMatch(r));
  const usable = (r: CalcRule) => r.isActive && ruleAppliesToKind(r, isOutsourced);

  let matched = rules.find(r => usable(r) && r.isExclusive && specific(r));
  if (!matched) matched = rules.find(r => usable(r) && specific(r));
  if (!matched) matched = rules.find(r => usable(r) && r.scope === "all");
  return matched;
}

/**
 * The commission a single order line earns.
 *
 * @param vipOrderTestIds order-test ids carrying a VIP/priority surcharge
 * @param vipPct          the clinic's VIP surcharge percentage
 * @param outsourcedBasis 'price' | 'margin' — see below
 */
export function calcTestCommission(
  ot: CalcLine,
  test: CalcTest | undefined,
  rules: CalcRule[],
  doctor: CalcDoctor,
  vipOrderTestIds?: Set<number>,
  vipPct?: number,
  outsourcedBasis: string = "price",
): CalcResult {
  // A line is outsourced when the catalogue says so, or when it carries a lab
  // cost snapshotted at order time. The snapshot is authoritative for the money:
  // the catalogue entry can change after the order was placed.
  const outsourceCost = Number(ot.outsourceCost ?? 0);
  const isOutsourced = test?.testType === "outsourced" || outsourceCost > 0;

  let price = Number(ot.price);
  // The VIP surcharge is the clinic's fee for priority handling, not clinical
  // revenue, so it is stripped out before any rate is applied.
  if (ot.id && vipOrderTestIds?.has(ot.id) && vipPct) {
    price = price / (1 + vipPct / 100);
  }
  // On outsourced work the clinic only keeps price − lab cost. A percentage of
  // the full price can exceed that margin entirely (₹1,000 test costing ₹700
  // from the lab pays ₹500 at 50% — a ₹200 loss), so a clinic may choose to
  // commission the margin instead. Floored at zero: a loss-making line earns no
  // commission rather than a negative one.
  if (isOutsourced && outsourcedBasis === "margin") {
    price = Math.max(0, price - outsourceCost);
  }
  const commissionBase = price;

  const matched = findMatchingRule(ot.testId, test ? (test.category ?? "") : null, rules, isOutsourced);
  if (matched) {
    const val = Number(matched.value);
    return {
      commission: matched.type === "percentage" ? (price * val) / 100 : val,
      ruleName: matched.name,
      ruleType: matched.type,
      ruleValue: val,
      // "test" / "category" = an explicit slab was configured for this line.
      // "all" = only the doctor's catch-all caught it, i.e. no slab.
      ruleScope: matched.scope === "test" || matched.scope === "category" ? matched.scope : "all",
      isOutsourced,
      outsourceCost,
      commissionBase,
    };
  }

  const defVal = Number(doctor.defaultCommission ?? 0);
  const defType = doctor.defaultCommissionType || "percentage";
  if (defVal > 0) {
    return {
      commission: defType === "percentage" ? (price * defVal) / 100 : defVal,
      ruleName: "Default",
      ruleType: defType,
      ruleValue: defVal,
      ruleScope: "default",
      isOutsourced,
      outsourceCost,
      commissionBase,
    };
  }

  return {
    commission: 0,
    ruleName: "None",
    ruleType: defType,
    ruleValue: 0,
    ruleScope: "none",
    isOutsourced,
    outsourceCost,
    commissionBase,
  };
}

// ── Commission discount deduction ─────────────────────────────────────────────
// Applies the clinic-level commissionDiscountMode to an order's raw commission
// and the bill discount for that order.
//   "none"            → no change
//   "deduct"          → commission − discount, floored at 0
//   "deduct_rollover" → commission − discount, may go negative
export function applyDiscountDeduction(
  rawCommission: number,
  billDiscount: number,
  mode: string,
): { net: number; deducted: number } {
  if (mode === "deduct") {
    const net = Math.max(0, rawCommission - billDiscount);
    return { net, deducted: rawCommission - net };
  }
  if (mode === "deduct_rollover") {
    const net = rawCommission - billDiscount;
    return { net, deducted: billDiscount };
  }
  return { net: rawCommission, deducted: 0 };
}

// ── Commission eligibility (payment / report-aware hold) ──────────────────────
// Decides whether an order's commission is payable yet, or held until its
// condition is met. A cancelled bill is never payable.
export type EligibilityConfig = { policy: string; minAmount: number };

export const NEEDS_REPORT_STATUS = (policy: string) =>
  policy === "report_finalized" || policy === "report_delivered";

export function computeCommissionHold(opts: {
  cfg: EligibilityConfig;
  hasBill: boolean;
  billStatus: string | null;
  paidAmount: number;
  balanceAmount: number;
  reportFinalized: boolean;
  reportDelivered: boolean;
  commissionAmount: number;
}): { held: boolean; reason: string | null } {
  const rs = (n: number) => `Rs.${Math.round(n).toLocaleString("en-IN")}`;
  if (opts.billStatus === "cancelled") return { held: true, reason: "Bill cancelled" };
  if (!opts.hasBill) return { held: true, reason: "Not billed" };
  switch (opts.cfg.policy) {
    case "report_finalized":
      return opts.reportFinalized ? { held: false, reason: null } : { held: true, reason: "Report not finalized" };
    case "report_delivered":
      return opts.reportDelivered ? { held: false, reason: null } : { held: true, reason: "Report not delivered" };
    case "min_amount_collected":
      return opts.paidAmount + 0.005 >= opts.cfg.minAmount
        ? { held: false, reason: null }
        : { held: true, reason: `Collected ${rs(opts.paidAmount)} < min ${rs(opts.cfg.minAmount)}` };
    case "full_payment_collected":
      return opts.balanceAmount <= 0.005
        ? { held: false, reason: null }
        : { held: true, reason: `Outstanding dues ${rs(opts.balanceAmount)}` };
    case "collected_ge_commission":
      return opts.paidAmount + 0.005 >= opts.commissionAmount
        ? { held: false, reason: null }
        : { held: true, reason: `Collected ${rs(opts.paidAmount)} < commission ${rs(opts.commissionAmount)}` };
    case "bill_created":
    default:
      return { held: false, reason: null };
  }
}
