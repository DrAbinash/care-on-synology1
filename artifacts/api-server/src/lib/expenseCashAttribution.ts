/**
 * Expense → cash-drawer attribution.
 *
 * Business rule: cash expenses reduce the drawer of whoever paid them out.
 * `approved_by` is the intended field, but historically it was optional free
 * text and often left blank while `created_by` (session actor) was always set.
 * My Daily Summary / day-close filtered ONLY on `approved_by`, so blank
 * approver rows appeared in Expense Management (lists by expense_date, no
 * staff filter) but showed ₹0 Cash Expenses on the creator's daily recon.
 *
 * Canonical owner = COALESCE(NULLIF(TRIM(approved_by),''), NULLIF(TRIM(created_by),'')).
 * Keep `created_at` as the reconciliation posting clock (not expense_date).
 */

import { sql, type SQL } from "drizzle-orm";

/** JS: resolve drawer owner from expense row fields. */
export function expenseDrawerOwner(
  approvedBy: string | null | undefined,
  createdBy: string | null | undefined,
): string | null {
  const a = (approvedBy ?? "").trim();
  if (a) return a;
  const c = (createdBy ?? "").trim();
  return c || null;
}

/**
 * SQL expression for the drawer owner (same COALESCE rule as expenseDrawerOwner).
 * Use in SELECT / GROUP BY / filters so my-daily-summary, day-close, and
 * advanced-dashboard stay in lockstep.
 */
export function expenseDrawerOwnerSql(): SQL {
  return sql`COALESCE(NULLIF(TRIM(approved_by), ''), NULLIF(TRIM(created_by), ''))`;
}

/** SQL AND-fragment: restrict to one staff's drawer (exact name match). */
export function expenseDrawerOwnerEquals(staffName: string): SQL {
  return sql`AND ${expenseDrawerOwnerSql()} = ${staffName}`;
}
