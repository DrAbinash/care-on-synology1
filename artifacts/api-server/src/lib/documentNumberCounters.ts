/**
 * documentNumberCounters.ts — atomic next-number allocation via SEQUENCE.
 *
 * Replaces MAX(...)+1 under a process-wide advisory lock. PostgreSQL nextval()
 * is concurrent and does not hold a row lock until commit, so concurrent
 * billing-desk saves no longer serialize on number allocation for the whole
 * bill/order insert transaction. Gaps on rollback are expected (same as any
 * SEQUENCE-backed document number).
 */
import { sql } from "drizzle-orm";

type DbOrTx = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function readNextval(result: unknown): number {
  const row = rowsOf(result)[0] ?? {};
  // drizzle / node-pg may key as nextval or the function alias
  const raw = row.nextval ?? row.next_order_number_seq ?? Object.values(row)[0];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`document number sequence returned invalid value: ${String(raw)}`);
  }
  return n;
}

/** Next global bill sequence value (same connection / txn is fine). */
export async function nextDocumentCounter(
  dbHandle: DbOrTx,
  kind: "bill" | "order",
  bucket: string,
): Promise<number> {
  if (kind === "bill") {
    const result = await dbHandle.execute(sql`SELECT nextval('bill_number_seq') AS nextval`);
    return readNextval(result);
  }
  // bucket = YYYYMM — function creates the monthly sequence on demand
  const result = await dbHandle.execute(
    sql`SELECT next_order_number_seq(${bucket}) AS nextval`,
  );
  return readNextval(result);
}
