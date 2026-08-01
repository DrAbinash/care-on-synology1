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
  name?: string | null;            // catalogue name — used for rule-name fallback
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
  /** What the slab asked for, before the margin cap. Equal to commission when no cap applied. */
  uncappedCommission: number;
  /** True when the margin cap reduced this line's commission. */
  cappedToMargin: boolean;
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

/** Coerce JSON test id lists that may contain strings ("12") or numbers (12). */
export function parseTestIdList(s: string | null | undefined): number[] {
  return safeParseArray<unknown>(s)
    .map((x) => (typeof x === "number" ? x : Number(x)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Normalize rule/test labels for name-based fallback matching. */
export function normalizeCommissionLabel(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/** Map each catalogue test id → every id that shares its normalized name. */
export function buildTestNameAliasIndex(
  tests: { id: number; name: string | null | undefined }[],
): Map<number, number[]> {
  const byName = new Map<string, number[]>();
  for (const t of tests) {
    const k = normalizeCommissionLabel(t.name ?? "");
    if (!k) continue;
    const bucket = byName.get(k);
    if (bucket) bucket.push(t.id);
    else byName.set(k, [t.id]);
  }
  const byId = new Map<number, number[]>();
  for (const t of tests) {
    const k = normalizeCommissionLabel(t.name ?? "");
    byId.set(t.id, k ? (byName.get(k) ?? [t.id]) : [t.id]);
  }
  return byId;
}

export function expandIdsByNameAlias(
  ids: number[],
  aliasIndex: Map<number, number[]> | null | undefined,
): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    const aliases = aliasIndex?.get(id);
    if (aliases && aliases.length > 0) {
      for (const a of aliases) out.add(a);
    } else {
      out.add(id);
    }
  }
  return out;
}

/**
 * Rules that apply when calculating commission for one referring doctor.
 * Doctor-specific slabs come first so findMatchingRule prefers them over
 * clinic-wide (doctorId null) slabs at every precedence rung. That lets a
 * clinic set "MRI BRAIN = ₹1750 for everyone" once, then override one doctor.
 */
export function rulesForDoctor<T extends { doctorId: number | null }>(
  allRules: T[],
  doctorId: number,
): T[] {
  const specific: T[] = [];
  const global: T[] = [];
  for (const r of allRules) {
    if (r.doctorId == null) global.push(r);
    else if (r.doctorId === doctorId) specific.push(r);
  }
  return [...specific, ...global];
}

// Single source of truth for "which rule applies to this test line".
//
// Precedence (must stay in lock-step with every report that displays the matched
// rule's value/type — otherwise the UI shows a rule the calculation never used):
//   1) exclusive test/category rule
//   2) non-exclusive test/category rule (by testId incl. duplicate-name aliases,
//      then by exact rule name ↔ test name)
//   3) catch-all (scope="all") rule
// Returns undefined when nothing matches; the caller then falls back to the
// doctor's profile default.
//
// `category` is the test's category, or null when the test row is unknown — in
// which case category-scoped rules never match.
// `testName` enables a safe fallback when a scope=test slab was named after the
// catalogue test (e.g. "MRI BRAIN") but testIds were left empty or drifted.
// `aliasIndex` expands both the billed test id and each rule's bound ids across
// duplicate catalogue rows that share the same normalized name (common when
// "CT BRAIN" exists twice — picker binds one id, billing uses the other).
export function findMatchingRule(
  testId: number,
  category: string | null,
  rules: CalcRule[],
  isOutsourced = false,
  testName: string | null = null,
  aliasIndex: Map<number, number[]> | null = null,
): CalcRule | undefined {
  const lineIds = expandIdsByNameAlias([testId], aliasIndex);
  const testMatch = (r: CalcRule) => {
    const bound = expandIdsByNameAlias(parseTestIdList(r.testIds), aliasIndex);
    for (const id of lineIds) {
      if (bound.has(id)) return true;
    }
    return false;
  };
  const catNorm = category ? normalizeCommissionLabel(category) : null;
  const catMatch = (r: CalcRule) => {
    if (!catNorm || !r.categories) return false;
    return safeParseArray<string>(r.categories).some(
      (c) => normalizeCommissionLabel(c) === catNorm,
    );
  };
  // Name fallback: only for scope=test slabs whose label exactly equals the
  // catalogue test name after normalization. Never matches amount-labelled
  // names like "CT 800" / "MRI 20%" against unrelated tests.
  const testNameNorm = testName ? normalizeCommissionLabel(testName) : null;
  const nameMatch = (r: CalcRule) => {
    if (!testNameNorm || r.scope !== "test") return false;
    const ruleNorm = normalizeCommissionLabel(r.name || "");
    if (!ruleNorm || ruleNorm.length < 3) return false;
    return ruleNorm === testNameNorm;
  };
  const specific = (r: CalcRule) =>
    (r.scope === "test" && (testMatch(r) || nameMatch(r))) ||
    (r.scope === "category" && catMatch(r));
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
  /** Duplicate catalogue rows sharing a normalized name (see buildTestNameAliasIndex). */
  testAliasIndex?: Map<number, number[]> | null,
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

  // Whichever slab wins, the payout is decided in one place below so the margin
  // cap cannot be applied to some rules and forgotten on others.
  let ruleName: string, ruleType: string, ruleValue: number, ruleScope: RuleScope, raw: number;

  const matched = findMatchingRule(
    ot.testId,
    test ? (test.category ?? "") : null,
    rules,
    isOutsourced,
    test?.name ?? null,
    testAliasIndex ?? null,
  );
  const defType = doctor.defaultCommissionType || "percentage";
  const defVal = Number(doctor.defaultCommission ?? 0);

  if (matched) {
    ruleValue = Number(matched.value);
    ruleName = matched.name;
    ruleType = matched.type;
    // "test" / "category" = an explicit slab was configured for this line.
    // "all" = only the doctor's catch-all caught it, i.e. no slab.
    ruleScope = matched.scope === "test" || matched.scope === "category" ? matched.scope : "all";
    raw = ruleType === "percentage" ? (price * ruleValue) / 100 : ruleValue;
  } else if (defVal > 0) {
    ruleValue = defVal;
    ruleName = "Default";
    ruleType = defType;
    ruleScope = "default";
    raw = defType === "percentage" ? (price * defVal) / 100 : defVal;
  } else {
    ruleValue = 0;
    ruleName = "None";
    ruleType = defType;
    ruleScope = "none";
    raw = 0;
  }

  // A percentage of the margin can never exceed the margin, but a FIXED slab
  // ignores the base entirely — "Rs.150 per test" still pays Rs.150 on a line
  // that only earned the clinic Rs.40. Once the clinic has said it wants to
  // commission the margin, paying out more than that margin is precisely what
  // it asked not to happen, so the payout is capped at the base. (A rate above
  // 100% is caught by the same cap.) Never applies on the price basis, and
  // never to in-house work, which has no lab cost to speak of.
  const capped = isOutsourced && outsourcedBasis === "margin" && raw > commissionBase;
  const commission = capped ? commissionBase : raw;

  return {
    commission,
    ruleName,
    ruleType,
    ruleValue,
    ruleScope,
    isOutsourced,
    outsourceCost,
    commissionBase,
    uncappedCommission: raw,
    cappedToMargin: capped,
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

/**
 * Referral commission reports / ledger / reconcile only consider orders that
 * have a non-cancelled bill. Unbilled duplicate orders must never generate
 * commission rows (they used to appear as held "Not billed" lines and inflate
 * visit counts / revenue / total commission).
 */
export function isCommissionBillEligible(
  bill: { status?: string | null } | null | undefined,
): boolean {
  if (!bill) return false;
  return (bill.status ?? null) !== "cancelled";
}

/**
 * When an order has multiple bill rows, prefer a non-cancelled bill. If every
 * bill is cancelled (or there are none), return null so the order is excluded
 * from commission entirely.
 */
export function pickCommissionBill<T extends { status?: string | null }>(
  bills: T[],
): T | null {
  if (!bills.length) return null;
  return bills.find((b) => (b.status ?? null) !== "cancelled") ?? null;
}

/**
 * Index bills by orderId, keeping only orders with a non-cancelled bill.
 * Later cancelled-only duplicates cannot overwrite an active bill out of the map.
 */
export function indexCommissionBillsByOrderId<
  T extends { orderId: number | null; status?: string | null },
>(bills: T[]): Map<number, T> {
  const grouped = new Map<number, T[]>();
  for (const b of bills) {
    if (b.orderId == null) continue;
    const arr = grouped.get(b.orderId) ?? [];
    arr.push(b);
    grouped.set(b.orderId, arr);
  }
  const out = new Map<number, T>();
  for (const [orderId, list] of grouped) {
    const picked = pickCommissionBill(list);
    if (picked) out.set(orderId, picked);
  }
  return out;
}

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
  // Defence in depth: callers should already skip these via
  // isCommissionBillEligible / indexCommissionBillsByOrderId so they never
  // reach report rows. Hold reasons remain for ledger edge cases / audit.
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
