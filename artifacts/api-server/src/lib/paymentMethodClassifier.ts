/**
 * Shared payment-method classifier.
 *
 * SINGLE SOURCE OF TRUTH for "is this payment physical cash, digital, or
 * unrecognized" across every reconciliation surface: my-daily-summary.ts,
 * daily-summary.ts, day-close.ts, and any future report.
 *
 * Background (see DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §4.5 /
 * "Non-Negotiable Business Rules" #5-6):
 *   - Only literal "cash" is physical cash. Nothing else, ever.
 *   - Gateway/online payments are stored with provider-qualified strings
 *     such as "Online (ICICI Orange Pay)", "Online (Razorpay)",
 *     "Online (PhonePe)", "Online (BharatPe)", "Online (HDFC SmartGateway)"
 *     — NOT the bare string "online". A naive `=== "online"` or
 *     `.includes("online")` exact-match check fails on these and silently
 *     drops real gateway money into the cash bucket. This module fixes
 *     that by prefix-matching "online" (case-insensitive) after known
 *     exact tokens are checked.
 *   - A payment method that isn't recognized must NEVER default to cash.
 *     It is classified as "unknown" and the caller is responsible for
 *     routing it to an exception/suspense bucket, not into any total.
 *
 * Canonical method values seen in production (see api-zod generated
 * schemas + gateway-webhooks.ts):
 *   cash, card, upi, insurance, cheque,
 *   "Online (<Provider Name>)" (ICICI/HDFC/Razorpay/PhonePe/BharatPe/...),
 *   bank, neft, rtgs (legacy/manual entries),
 *   "Web booking (<Provider Name>)" (legacy public-booking label).
 */

export type PaymentMethodCategory =
  | "cash"
  | "upi"
  | "card"
  | "online" // gateway / bank transfer / NEFT / RTGS / web-booking settlement
  | "cheque"
  | "insurance"
  | "unknown"; // exception/suspense — classification failed, must not be

// silently treated as cash or as digital.

export interface ClassifiedPaymentMethod {
  /** Original, unmodified method string as stored on the row. */
  raw: string;
  /** Normalized category. */
  category: PaymentMethodCategory;
  /** True only when category === "cash". The ONLY thing that may reduce/increase physical drawer cash. */
  isCash: boolean;
  /** True when the method was recognized (cash included). False => route to exception/suspense bucket. */
  isKnown: boolean;
}

// Exact-match table for single-word canonical tokens. Compared against the
// lower-cased, trimmed raw method string.
const EXACT_CATEGORY: Readonly<Record<string, PaymentMethodCategory>> = {
  cash: "cash",
  upi: "upi",
  card: "card",
  cheque: "cheque",
  insurance: "insurance",
  // Legacy/manual bank-transfer style tokens — all settle digitally, never
  // touch the physical drawer.
  bank: "online",
  neft: "online",
  rtgs: "online",
  online: "online",
};

/**
 * Classify a raw payment method string into a category, plus the two
 * booleans every reconciliation call site actually needs (isCash, isKnown).
 *
 * Never throws. Never defaults an unrecognized value to "cash".
 */
export function classifyPaymentMethod(rawMethod: string | null | undefined): ClassifiedPaymentMethod {
  const raw = (rawMethod ?? "").toString().trim();
  const lower = raw.toLowerCase();

  if (!lower) {
    return { raw, category: "unknown", isCash: false, isKnown: false };
  }

  const exact = EXACT_CATEGORY[lower];
  if (exact) {
    return { raw, category: exact, isCash: exact === "cash", isKnown: true };
  }

  // Gateway-qualified strings: "Online (ICICI Orange Pay)", "Online (Razorpay)",
  // "Online (PhonePe)", "Online (BharatPe)", "Online (HDFC SmartGateway)", etc.
  // This is a PREFIX match, not exact — the exact "online" case is already
  // handled above via EXACT_CATEGORY, but real gateway rows always carry a
  // provider suffix so they only reach this branch.
  if (lower.startsWith("online")) {
    return { raw, category: "online", isCash: false, isKnown: true };
  }

  // Legacy public-booking label: "Web booking (<provider>)".
  if (lower.startsWith("web booking")) {
    return { raw, category: "online", isCash: false, isKnown: true };
  }

  // Anything else — typo, new gateway not yet mapped, blank-ish garbage —
  // is NOT recognized. It must never silently become cash or digital.
  return { raw, category: "unknown", isCash: false, isKnown: false };
}

/** True only when the payment method is literal "cash". */
export function isPhysicalCash(rawMethod: string | null | undefined): boolean {
  return classifyPaymentMethod(rawMethod).isCash;
}

/** True when the method was recognized (regardless of category). False => exception/suspense. */
export function isKnownPaymentMethod(rawMethod: string | null | undefined): boolean {
  return classifyPaymentMethod(rawMethod).isKnown;
}

/**
 * True for any RECOGNIZED non-cash settlement (upi/card/online/cheque/insurance).
 * Used for "digital collection" style aggregates. Deliberately excludes
 * unknown methods — an unrecognized string is not "digital", it is an
 * exception that must be reported separately (see suspense bucket).
 */
export function isDigitalSettlement(rawMethod: string | null | undefined): boolean {
  const c = classifyPaymentMethod(rawMethod);
  return c.isKnown && !c.isCash;
}

/** Human-readable label for a category, for suspense/exception UI. */
export const PAYMENT_METHOD_CATEGORY_LABEL: Readonly<Record<PaymentMethodCategory, string>> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  online: "Online / Gateway",
  cheque: "Cheque",
  insurance: "Insurance",
  unknown: "Unknown (needs review)",
};
