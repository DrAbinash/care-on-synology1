/**
 * billByNumber.ts — the one way to go from a printed bill number to a bill row.
 *
 * Bill numbers are unique per BOOK, not across the installation
 * (migrations/zzzzzz_bill_numbering_per_ledger.sql), so after a register is
 * restarted the same number legitimately exists in two books. Anything that
 * only READS can show a list; anything that WRITES money, patient details or a
 * statutory Form F must not guess which register the operator meant — an
 * `ambiguous` result is a reason to refuse the request, not to pick a row.
 */
import { db, billsTable, type Bill } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";

export type BillByNumber =
  | { status: "found"; bill: Bill }
  | { status: "not_found" }
  | { status: "ambiguous"; bills: Bill[] };

export async function findBillByNumber(
  billNumber: string,
  opts: { caseInsensitive?: boolean } = {},
): Promise<BillByNumber> {
  const trimmed = billNumber.trim();
  if (!trimmed) return { status: "not_found" };

  // Two rows is enough to know the number is not usable as an identifier.
  const rows = await db
    .select()
    .from(billsTable)
    .where(
      opts.caseInsensitive
        ? ilike(billsTable.billNumber, trimmed)
        : eq(billsTable.billNumber, trimmed),
    )
    .limit(2);

  if (rows.length === 0) return { status: "not_found" };
  if (rows.length > 1) return { status: "ambiguous", bills: rows };
  return { status: "found", bill: rows[0]! };
}

/** Shared wording so every surface explains the same refusal the same way. */
export function ambiguousBillNumberMessage(billNumber: string): string {
  return `Bill number ${billNumber} was issued by more than one book. Open the bill from its book and try again.`;
}
