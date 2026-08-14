/**
 * Map Gemini bill-OCR vocabulary onto the Expenses ledger option lists.
 * Unrecognized values fall back to miscellaneous / cash — never invent a
 * category or payment mode the form cannot save.
 */

export const LEDGER_EXPENSE_CATEGORIES = [
  "rent",
  "salaries",
  "utilities",
  "supplies",
  "maintenance",
  "equipment",
  "marketing",
  "travel",
  "miscellaneous",
] as const;

export const LEDGER_PAYMENT_MODES = [
  "cash",
  "bank-transfer",
  "cheque",
  "upi",
  "card",
] as const;

const CATEGORY_MAP: Record<string, (typeof LEDGER_EXPENSE_CATEGORIES)[number]> = {
  salaries: "salaries",
  rent: "rent",
  utilities: "utilities",
  supplies: "supplies",
  "office supplies": "supplies",
  "medical supplies": "supplies",
  "lab reagents": "supplies",
  equipment: "equipment",
  maintenance: "maintenance",
  travel: "travel",
  food: "miscellaneous",
  marketing: "marketing",
  "professional fees": "miscellaneous",
  taxes: "miscellaneous",
  insurance: "miscellaneous",
  miscellaneous: "miscellaneous",
};

const PAYMENT_MAP: Record<string, (typeof LEDGER_PAYMENT_MODES)[number]> = {
  cash: "cash",
  card: "card",
  upi: "upi",
  cheque: "cheque",
  check: "cheque",
  other: "bank-transfer",
  bank: "bank-transfer",
  "bank-transfer": "bank-transfer",
  "bank transfer": "bank-transfer",
  neft: "bank-transfer",
  rtgs: "bank-transfer",
  imps: "bank-transfer",
};

function norm(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
}

export function mapExpenseCategory(raw: string | null | undefined): (typeof LEDGER_EXPENSE_CATEGORIES)[number] {
  const key = norm(raw);
  if ((LEDGER_EXPENSE_CATEGORIES as readonly string[]).includes(key)) {
    return key as (typeof LEDGER_EXPENSE_CATEGORIES)[number];
  }
  return CATEGORY_MAP[key] ?? "miscellaneous";
}

export function mapExpensePaymentMode(raw: string | null | undefined): (typeof LEDGER_PAYMENT_MODES)[number] {
  const key = norm(raw);
  if ((LEDGER_PAYMENT_MODES as readonly string[]).includes(key)) {
    return key as (typeof LEDGER_PAYMENT_MODES)[number];
  }
  return PAYMENT_MAP[key] ?? "cash";
}
