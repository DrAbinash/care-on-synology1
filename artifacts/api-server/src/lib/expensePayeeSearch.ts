/**
 * Universal Vendor / Paid To search for Expense Entry.
 * Sources: Vendor Master + distinct historical expense payees.
 * Suggestion-level dedupe only — never merges DB rows.
 */

import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { expensesTable, vendorsTable } from "@workspace/db/schema";

export type PayeeKind = "vendor" | "previous_payee";

export type PayeeSuggestion = {
  kind: PayeeKind;
  name: string;
  normalizedName: string;
  vendorId: number | null;
  phone?: string | null;
  gstin?: string | null;
  lastCategory?: string | null;
  lastDescription?: string | null;
  lastExpenseDate?: string | null;
  lastBillAmount?: number | null;
  lastPaymentMode?: string | null;
  useCount: number;
  matchReason: "exact" | "prefix" | "contains" | "phone" | "gstin" | "description";
  rankScore: number;
};

export type ExpenseWorkMeta = {
  workType?: string | null;
  labourBasis?: "per_day" | "per_job" | "contract" | null;
  days?: number | null;
  ratePerDay?: number | null;
  labourAmount?: number | null;
  materialAmount?: number | null;
};

export type PayeeUsualDetails = {
  name: string;
  vendorId: number | null;
  kind: PayeeKind;
  lastCategory: string | null;
  lastDescription: string | null;
  lastExpenseDate: string | null;
  lastBillAmount: number | null;
  lastPaymentMode: string | null;
  suggestedCategory: string | null;
  suggestedPaymentMode: string | null;
  meta: ExpenseWorkMeta | null;
  recent: Array<{
    expenseId: string;
    expenseDate: string;
    description: string;
    category: string;
    billAmount: number;
  }>;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export function normalizePayeeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function payeeSearchNeedle(raw: string | null | undefined): string {
  return normalizePayeeName(raw);
}

export function scorePayeeMatch(opts: {
  name: string;
  query: string;
  kind: PayeeKind;
  phone?: string | null;
  gstin?: string | null;
  descriptionHit?: boolean;
  useCount?: number;
  recencyDays?: number | null;
}): { matchReason: PayeeSuggestion["matchReason"]; rankScore: number } | null {
  const q = payeeSearchNeedle(opts.query);
  if (!q) return null;
  const name = normalizePayeeName(opts.name);
  if (!name) return null;

  let matchReason: PayeeSuggestion["matchReason"] | null = null;
  let base = 0;
  if (name === q) {
    matchReason = "exact";
    base = 1000;
  } else if (name.startsWith(q)) {
    matchReason = "prefix";
    base = 800;
  } else if (name.includes(q)) {
    matchReason = "contains";
    base = 600;
  } else if (opts.phone && normalizePayeeName(opts.phone).includes(q)) {
    matchReason = "phone";
    base = 500;
  } else if (opts.gstin && normalizePayeeName(opts.gstin).includes(q)) {
    matchReason = "gstin";
    base = 480;
  } else if (opts.descriptionHit) {
    matchReason = "description";
    base = 300;
  } else {
    return null;
  }

  if (opts.kind === "vendor") base += 40;
  base += Math.min(30, opts.useCount ?? 0);
  if (opts.recencyDays != null && opts.recencyDays >= 0) {
    base += Math.max(0, 25 - Math.min(25, Math.floor(opts.recencyDays / 7)));
  }
  return { matchReason, rankScore: base };
}

export function dedupePayeeSuggestions(rows: PayeeSuggestion[]): PayeeSuggestion[] {
  const byNorm = new Map<string, PayeeSuggestion>();
  for (const row of rows) {
    const key = row.normalizedName;
    if (!key) continue;
    const prev = byNorm.get(key);
    if (!prev) {
      byNorm.set(key, row);
      continue;
    }
    const preferNew =
      (row.kind === "vendor" && prev.kind !== "vendor") ||
      (row.kind === prev.kind && row.rankScore > prev.rankScore) ||
      (row.kind === prev.kind && row.rankScore === prev.rankScore && row.useCount > prev.useCount);
    if (preferNew) byNorm.set(key, row);
  }
  return [...byNorm.values()].sort((a, b) => b.rankScore - a.rankScore || a.name.localeCompare(b.name));
}

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export const EXPENSE_META_JSON_MAX_CHARS = 4096;

function nonNegFinite(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseExpenseMetaJson(raw: string | null | undefined): ExpenseWorkMeta | null {
  if (!raw?.trim()) return null;
  if (raw.length > EXPENSE_META_JSON_MAX_CHARS) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const workType =
      typeof o.workType === "string" ? o.workType.trim().slice(0, 80) || null : null;
    return {
      workType,
      labourBasis:
        o.labourBasis === "per_day" || o.labourBasis === "per_job" || o.labourBasis === "contract"
          ? o.labourBasis
          : null,
      days: nonNegFinite(o.days),
      ratePerDay: nonNegFinite(o.ratePerDay),
      labourAmount: nonNegFinite(o.labourAmount),
      materialAmount: nonNegFinite(o.materialAmount),
    };
  } catch {
    return null;
  }
}

/**
 * Strict create-path validator. Rejects malformed JSON, oversized payloads,
 * and negative numeric metadata. Unknown keys are dropped (never drive money).
 */
export function validateExpenseMetaJsonInput(raw: unknown):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "metaJson must be a JSON string" };
  if (raw.length > EXPENSE_META_JSON_MAX_CHARS) {
    return { ok: false, error: `metaJson exceeds ${EXPENSE_META_JSON_MAX_CHARS} characters` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "metaJson is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "metaJson must be a JSON object" };
  }
  const o = parsed as Record<string, unknown>;
  for (const key of ["days", "ratePerDay", "labourAmount", "materialAmount"] as const) {
    if (o[key] === undefined || o[key] === null) continue;
    const n = Number(o[key]);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `${key} must be a non-negative number` };
    }
  }
  if (o.labourBasis != null && o.labourBasis !== "per_day" && o.labourBasis !== "per_job" && o.labourBasis !== "contract") {
    return { ok: false, error: "labourBasis must be per_day, per_job, or contract" };
  }
  const normalized = serializeExpenseMetaJson(parseExpenseMetaJson(JSON.stringify(o)));
  return { ok: true, value: normalized };
}

export function serializeExpenseMetaJson(meta: ExpenseWorkMeta | null | undefined): string | null {
  if (!meta) return null;
  const clean: ExpenseWorkMeta = {};
  if (meta.workType) clean.workType = String(meta.workType).trim().slice(0, 80);
  if (meta.labourBasis) clean.labourBasis = meta.labourBasis;
  if (meta.days != null && Number.isFinite(meta.days) && meta.days >= 0) clean.days = meta.days;
  if (meta.ratePerDay != null && Number.isFinite(meta.ratePerDay) && meta.ratePerDay >= 0) {
    clean.ratePerDay = meta.ratePerDay;
  }
  if (meta.labourAmount != null && Number.isFinite(meta.labourAmount) && meta.labourAmount >= 0) {
    clean.labourAmount = meta.labourAmount;
  }
  if (meta.materialAmount != null && Number.isFinite(meta.materialAmount) && meta.materialAmount >= 0) {
    clean.materialAmount = meta.materialAmount;
  }
  if (Object.keys(clean).length === 0) return null;
  return JSON.stringify(clean);
}

/** Conservative junk filter for historical free-text payee suggestions only. */
export function isJunkHistoricalPayeeName(raw: string | null | undefined): boolean {
  const n = normalizePayeeName(raw);
  if (!n) return true;
  if (n.length === 1 && !/[A-Z0-9]/.test(n)) return true;
  return (
    n === "-" ||
    n === "--" ||
    n === "NA" ||
    n === "N/A" ||
    n === "N.A." ||
    n === "N.A" ||
    n === "NIL" ||
    n === "NONE" ||
    n === "NULL" ||
    n === "CASH" ||
    n === "SELF" ||
    n === "UNKNOWN" ||
    n === "TEST" ||
    n === "." ||
    n === "*"
  );
}

/**
 * Retry is safe to expose only when posting was attempted and failed,
 * never for silent legacy PENDING (V2 backfill without vouchers).
 */
export function canShowAccountingRetry(exp: {
  paymentStatus?: string | null;
  accountingStatus?: string | null;
  accountingError?: string | null;
}): boolean {
  if ((exp.paymentStatus || "").toUpperCase() === "VOID") return false;
  const st = (exp.accountingStatus || "").toUpperCase();
  if (st === "FAILED") return true;
  if (st === "PENDING" && (exp.accountingError || "").trim()) return true;
  return false;
}

export function buildExpenseListSearchCondition(search: string) {
  const q = search.trim();
  if (!q) return undefined;
  const like = `%${q}%`;
  return or(
    ilike(expensesTable.description, like),
    ilike(expensesTable.vendorNameSnapshot, like),
    ilike(expensesTable.paidTo, like),
    ilike(expensesTable.invoiceNumber, like),
    sql`EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = ${expensesTable.vendorId}
        AND v.name ILIKE ${like}
    )`,
  );
}

type HistAggRow = {
  payee: string;
  vendor_id: number | null;
  last_category: string | null;
  last_description: string | null;
  last_expense_date: string | null;
  last_bill: string | null;
  last_payment_mode: string | null;
  use_count: string;
  name_hit: boolean;
  desc_hit: boolean;
};

export async function suggestExpensePayees(opts: {
  query: string;
  limit?: number;
}): Promise<PayeeSuggestion[]> {
  const rawQ = (opts.query ?? "").trim().slice(0, 80);
  const q = payeeSearchNeedle(rawQ);
  const limit = Math.min(Math.max(Number(opts.limit) || 12, 1), 30);
  if (q.length < 1) return [];

  const like = `%${q}%`;
  const vendorRows = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
      phone: vendorsTable.phone,
      gstin: vendorsTable.gstin,
    })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.isActive, true),
        or(
          ilike(vendorsTable.name, like),
          ilike(vendorsTable.phone, like),
          ilike(vendorsTable.gstin, like),
          ilike(vendorsTable.code, like),
        ),
      ),
    )
    .limit(40);

  const histResult = await db.execute<HistAggRow>(sql`
    SELECT
      COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) AS payee,
      MAX(vendor_id) FILTER (WHERE vendor_id IS NOT NULL) AS vendor_id,
      (ARRAY_AGG(category ORDER BY expense_date DESC, id DESC))[1] AS last_category,
      (ARRAY_AGG(description ORDER BY expense_date DESC, id DESC))[1] AS last_description,
      MAX(expense_date) AS last_expense_date,
      (ARRAY_AGG(COALESCE(bill_amount, amount) ORDER BY expense_date DESC, id DESC))[1] AS last_bill,
      (ARRAY_AGG(payment_mode ORDER BY expense_date DESC, id DESC))[1] AS last_payment_mode,
      COUNT(*)::text AS use_count,
      BOOL_OR(
        COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) ILIKE ${like}
      ) AS name_hit,
      BOOL_OR(description ILIKE ${like}) AS desc_hit
    FROM expenses
    WHERE payment_status <> 'VOID'
      AND (
        COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) ILIKE ${like}
        OR description ILIKE ${like}
      )
      AND COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) IS NOT NULL
    GROUP BY 1
    ORDER BY MAX(expense_date) DESC
    LIMIT 60
  `);

  const scored: PayeeSuggestion[] = [];

  for (const v of vendorRows) {
    const scoredMatch = scorePayeeMatch({
      name: v.name,
      query: q,
      kind: "vendor",
      phone: v.phone,
      gstin: v.gstin,
    });
    if (!scoredMatch) continue;
    scored.push({
      kind: "vendor",
      name: v.name.trim(),
      normalizedName: normalizePayeeName(v.name),
      vendorId: v.id,
      phone: v.phone,
      gstin: v.gstin,
      useCount: 0,
      matchReason: scoredMatch.matchReason,
      rankScore: scoredMatch.rankScore,
    });
  }

  for (const h of rowsOf<HistAggRow>(histResult)) {
    const name = (h.payee ?? "").trim();
    if (!name) continue;
    // Keep Vendor Master rows even if the historical label was junk; filter free-text only.
    if (!h.vendor_id && isJunkHistoricalPayeeName(name)) continue;
    const scoredMatch = scorePayeeMatch({
      name,
      query: q,
      kind: h.vendor_id ? "vendor" : "previous_payee",
      descriptionHit: Boolean(h.desc_hit) && !h.name_hit,
      useCount: Number(h.use_count) || 0,
      recencyDays: daysSince(h.last_expense_date),
    });
    if (!scoredMatch) continue;
    scored.push({
      kind: h.vendor_id ? "vendor" : "previous_payee",
      name,
      normalizedName: normalizePayeeName(name),
      vendorId: h.vendor_id,
      lastCategory: h.last_category,
      lastDescription: h.last_description,
      lastExpenseDate: h.last_expense_date,
      lastBillAmount: h.last_bill != null ? Number(h.last_bill) : null,
      lastPaymentMode: h.last_payment_mode,
      useCount: Number(h.use_count) || 0,
      matchReason: scoredMatch.matchReason,
      rankScore: scoredMatch.rankScore,
    });
  }

  const vendorIds = [...new Set(scored.map((s) => s.vendorId).filter((id): id is number => id != null))];
  if (vendorIds.length) {
    const lastByVendor = await db.execute<{
      vendor_id: number;
      last_category: string | null;
      last_description: string | null;
      last_expense_date: string | null;
      last_bill: string | null;
      last_payment_mode: string | null;
      use_count: string;
    }>(sql`
      SELECT
        vendor_id,
        (ARRAY_AGG(category ORDER BY expense_date DESC, id DESC))[1] AS last_category,
        (ARRAY_AGG(description ORDER BY expense_date DESC, id DESC))[1] AS last_description,
        MAX(expense_date) AS last_expense_date,
        (ARRAY_AGG(COALESCE(bill_amount, amount) ORDER BY expense_date DESC, id DESC))[1] AS last_bill,
        (ARRAY_AGG(payment_mode ORDER BY expense_date DESC, id DESC))[1] AS last_payment_mode,
        COUNT(*)::text AS use_count
      FROM expenses
      WHERE payment_status <> 'VOID'
        AND vendor_id IN (${sql.join(vendorIds.map((id) => sql`${id}`), sql`, `)})
      GROUP BY vendor_id
    `);
    const map = new Map(rowsOf<typeof lastByVendor extends never ? never : {
      vendor_id: number;
      last_category: string | null;
      last_description: string | null;
      last_expense_date: string | null;
      last_bill: string | null;
      last_payment_mode: string | null;
      use_count: string;
    }>(lastByVendor).map((r) => [r.vendor_id, r]));
    for (const s of scored) {
      if (s.vendorId == null) continue;
      const hit = map.get(s.vendorId);
      if (!hit) continue;
      s.lastCategory = hit.last_category;
      s.lastDescription = hit.last_description;
      s.lastExpenseDate = hit.last_expense_date;
      s.lastBillAmount = hit.last_bill != null ? Number(hit.last_bill) : null;
      s.lastPaymentMode = hit.last_payment_mode;
      s.useCount = Math.max(s.useCount, Number(hit.use_count) || 0);
      s.rankScore += Math.min(30, Number(hit.use_count) || 0);
    }
  }

  return dedupePayeeSuggestions(scored).slice(0, limit);
}

export async function recentExpensePayees(limit = 8): Promise<PayeeSuggestion[]> {
  const lim = Math.min(Math.max(limit, 1), 20);
  const result = await db.execute<{
    payee: string;
    vendor_id: number | null;
    last_category: string | null;
    last_description: string | null;
    last_expense_date: string | null;
    last_bill: string | null;
    last_payment_mode: string | null;
    use_count: string;
  }>(sql`
    SELECT
      COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) AS payee,
      MAX(vendor_id) FILTER (WHERE vendor_id IS NOT NULL) AS vendor_id,
      (ARRAY_AGG(category ORDER BY expense_date DESC, id DESC))[1] AS last_category,
      (ARRAY_AGG(description ORDER BY expense_date DESC, id DESC))[1] AS last_description,
      MAX(expense_date) AS last_expense_date,
      (ARRAY_AGG(COALESCE(bill_amount, amount) ORDER BY expense_date DESC, id DESC))[1] AS last_bill,
      (ARRAY_AGG(payment_mode ORDER BY expense_date DESC, id DESC))[1] AS last_payment_mode,
      COUNT(*)::text AS use_count
    FROM expenses
    WHERE payment_status <> 'VOID'
      AND COALESCE(NULLIF(TRIM(vendor_name_snapshot), ''), NULLIF(TRIM(paid_to), '')) IS NOT NULL
    GROUP BY 1
    ORDER BY MAX(expense_date) DESC, COUNT(*) DESC
    LIMIT ${lim}
  `);

  const out: PayeeSuggestion[] = [];
  for (const h of rowsOf<typeof result extends never ? never : {
    payee: string;
    vendor_id: number | null;
    last_category: string | null;
    last_description: string | null;
    last_expense_date: string | null;
    last_bill: string | null;
    last_payment_mode: string | null;
    use_count: string;
  }>(result)) {
    const name = (h.payee ?? "").trim();
    if (!name) continue;
    if (!h.vendor_id && isJunkHistoricalPayeeName(name)) continue;
    out.push({
      kind: h.vendor_id ? "vendor" : "previous_payee",
      name,
      normalizedName: normalizePayeeName(name),
      vendorId: h.vendor_id,
      lastCategory: h.last_category,
      lastDescription: h.last_description,
      lastExpenseDate: h.last_expense_date,
      lastBillAmount: h.last_bill != null ? Number(h.last_bill) : null,
      lastPaymentMode: h.last_payment_mode,
      useCount: Number(h.use_count) || 0,
      matchReason: "exact",
      rankScore: Number(h.use_count) || 0,
    });
  }
  return dedupePayeeSuggestions(out).slice(0, lim);
}

export async function getPayeeUsualDetails(opts: {
  vendorId?: number | null;
  payeeName?: string | null;
  limit?: number;
}): Promise<PayeeUsualDetails | null> {
  const lim = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const name = (opts.payeeName ?? "").trim();
  const norm = normalizePayeeName(name);
  const vendorId = opts.vendorId && Number.isFinite(opts.vendorId) ? Number(opts.vendorId) : null;
  if (!vendorId && !norm) return null;

  const conditions = [
    ne(expensesTable.paymentStatus, "VOID"),
    vendorId
      ? eq(expensesTable.vendorId, vendorId)
      : sql`UPPER(REGEXP_REPLACE(TRIM(COALESCE(${expensesTable.vendorNameSnapshot}, ${expensesTable.paidTo}, '')), '\\s+', ' ', 'g')) = ${norm}`,
  ];

  const list = await db
    .select({
      expenseId: expensesTable.expenseId,
      expenseDate: expensesTable.expenseDate,
      description: expensesTable.description,
      category: expensesTable.category,
      billAmount: expensesTable.billAmount,
      amount: expensesTable.amount,
      paymentMode: expensesTable.paymentMode,
      vendorId: expensesTable.vendorId,
      vendorNameSnapshot: expensesTable.vendorNameSnapshot,
      paidTo: expensesTable.paidTo,
      metaJson: expensesTable.metaJson,
    })
    .from(expensesTable)
    .where(and(...conditions))
    .orderBy(desc(expensesTable.expenseDate), desc(expensesTable.id))
    .limit(lim);

  if (!list.length) {
    return {
      name: name || "—",
      vendorId,
      kind: vendorId ? "vendor" : "previous_payee",
      lastCategory: null,
      lastDescription: null,
      lastExpenseDate: null,
      lastBillAmount: null,
      lastPaymentMode: null,
      suggestedCategory: null,
      suggestedPaymentMode: null,
      meta: null,
      recent: [],
    };
  }

  const first = list[0]!;
  const displayName = (first.vendorNameSnapshot || first.paidTo || name).trim() || name;
  return {
    name: displayName,
    vendorId: first.vendorId ?? vendorId,
    kind: first.vendorId || vendorId ? "vendor" : "previous_payee",
    lastCategory: first.category,
    lastDescription: first.description,
    lastExpenseDate: first.expenseDate,
    lastBillAmount: Number(first.billAmount ?? first.amount ?? 0),
    lastPaymentMode: first.paymentMode,
    suggestedCategory: first.category,
    suggestedPaymentMode: first.paymentMode,
    meta: parseExpenseMetaJson(first.metaJson),
    recent: list.map((r) => ({
      expenseId: r.expenseId,
      expenseDate: r.expenseDate,
      description: r.description,
      category: r.category,
      billAmount: Number(r.billAmount ?? r.amount ?? 0),
    })),
  };
}
