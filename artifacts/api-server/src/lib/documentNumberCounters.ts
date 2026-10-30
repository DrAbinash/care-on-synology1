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

/**
 * Next bill number for ONE book.
 *
 * `bucket` is the ledger id. Each book has its own sequence
 * (`bill_number_seq_l<ledger>`, created on demand and seeded forward from that
 * book's highest already-printed number by next_bill_number_seq), so a book can
 * genuinely start again at 0001 without reissuing a number another book is
 * using. See migrations/zzzzzz_bill_numbering_per_ledger.sql.
 *
 * `report` is the third shape: `bucket` is the `YYYYMMDD` the number carries, and
 * `next_report_number_seq` (migrations/zzzz_report_number_sequence.sql) creates
 * that day's sequence on demand, seeded forward from the highest suffix already
 * stored for the day. Reports were previously allocated by COUNT(*) of today's
 * rows, which reissues a deleted report's number.
 */
export async function nextDocumentCounter(
  dbHandle: DbOrTx,
  kind: "bill" | "order" | "report",
  bucket: string,
): Promise<number> {
  if (kind === "bill") {
    const ledger = Number(bucket);
    if (!Number.isInteger(ledger) || ledger < 1) {
      throw new Error(`nextDocumentCounter: bill numbering needs a positive ledger id, got ${bucket}`);
    }
    const result = await dbHandle.execute(
      sql`SELECT next_bill_number_seq(${ledger}) AS nextval`,
    );
    return readNextval(result);
  }
  if (kind === "report") {
    // bucket = YYYYMMDD — creates that day's sequence, seeded from the day's
    // highest stored suffix, then nextvals. Never returns a number already on a
    // stored report, and never returns the same value twice.
    const result = await dbHandle.execute(
      sql`SELECT next_report_number_seq(${bucket}) AS nextval`,
    );
    return readNextval(result);
  }
  // bucket = YYYYMM — function creates the monthly sequence on demand
  const result = await dbHandle.execute(
    sql`SELECT next_order_number_seq(${bucket}) AS nextval`,
  );
  return readNextval(result);
}

/**
 * Bump ONE book's sequence forward to at least MAX(its own bill suffix).
 * Never rewinds, so it can only ever move a book past numbers it has already
 * printed. Called after a (ledger_id, bill_number) unique violation.
 */
export async function syncBillNumberSeqForward(
  dbHandle: DbOrTx,
  ledgerId: number,
): Promise<void> {
  if (!Number.isInteger(ledgerId) || ledgerId < 1) {
    throw new Error(`syncBillNumberSeqForward: invalid ledger id ${ledgerId}`);
  }
  await dbHandle.execute(sql`SELECT sync_bill_number_seq(${ledgerId})`);
}

/**
 * Restart ONE book at 0001 (the next number it issues is exactly 1).
 *
 * The book has to be empty first — this rewinds, and rewinding past live rows
 * would reissue numbers that are already on paper. `reset_bill_number_seq`
 * enforces that in SQL rather than trusting the caller.
 */
export async function resetBillNumberSeq(
  dbHandle: DbOrTx,
  ledgerId: number,
): Promise<void> {
  if (!Number.isInteger(ledgerId) || ledgerId < 1) {
    throw new Error(`resetBillNumberSeq: invalid ledger id ${ledgerId}`);
  }
  await dbHandle.execute(sql`SELECT reset_bill_number_seq(${ledgerId})`);
}

/**
 * Bump order_number_seq_YYYYMM forward to MAX(ORD-YYYYMM-####) for that month.
 * Never rewinds. Mirrors syncBillNumberSeqForward for monthly order sequences.
 */
export async function syncOrderNumberSeqForward(
  dbHandle: DbOrTx,
  yyyymm: string,
): Promise<void> {
  if (!/^\d{6}$/.test(yyyymm)) {
    throw new Error(`syncOrderNumberSeqForward: invalid yyyymm ${yyyymm}`);
  }
  // DO blocks cannot take bind params — yyyymm is digit-validated above.
  await dbHandle.execute(sql.raw(`
    DO $$
    DECLARE
      yyyymm text := '${yyyymm}';
      seq_name text := 'order_number_seq_' || yyyymm;
      max_existing bigint := 0;
      seq_at bigint := 0;
      target bigint := 0;
    BEGIN
      SELECT COALESCE(
        MAX(
          CASE
            WHEN split_part(order_number, '-', 3) ~ '^[0-9]+$'
              THEN split_part(order_number, '-', 3)::bigint
            ELSE NULL
          END
        ),
        0
      )
      INTO max_existing
      FROM orders
      WHERE order_number LIKE 'ORD-' || yyyymm || '-%';

      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);

      BEGIN
        EXECUTE format(
          'SELECT CASE WHEN is_called THEN last_value ELSE GREATEST(last_value - 1, 0) END FROM %I',
          seq_name
        ) INTO seq_at;
      EXCEPTION WHEN undefined_table THEN
        seq_at := 0;
      END;

      target := GREATEST(max_existing, seq_at);
      IF target > 0 THEN
        EXECUTE format('SELECT setval(%L, %s, true)', seq_name, target);
      END IF;
    END $$;
  `));
}

/** Asia/Kolkata YYYYMM — matches migrations/zzzz_document_number_counters.sql seed. */
export function istYearMonth(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}${m}`;
}

/**
 * Next patient UHID as `P-#####` via SEQUENCE nextval.
 * Safe on pooled connections — no session advisory lock.
 *
 * Seeding / forward-sync happens in:
 *   - migrations/zzzz_patient_id_seq.sql (create)
 *   - migrations/zzzz_patient_id_seq_reseed.sql (bump to MAX on deploy)
 *   - nextPatientIdAfterConflict() after a unique collision
 *
 * Boot path intentionally does NOT scan patients (that MAX was adding
 * multi-second latency on first Register after API restart).
 */
let patientIdSeqEnsured = false;

/** Bump patient_id_seq forward to at least MAX(existing P-#####). Never rewinds. */
export async function syncPatientIdSeqForward(dbHandle: DbOrTx): Promise<void> {
  await dbHandle.execute(sql`CREATE SEQUENCE IF NOT EXISTS patient_id_seq`);
  await dbHandle.execute(sql`
    DO $$
    DECLARE
      max_existing bigint := 0;
      seq_at bigint := 0;
      target bigint := 0;
    BEGIN
      SELECT COALESCE(
        MAX(
          CASE
            WHEN patient_id ~ '^P-?[0-9]+$'
              THEN regexp_replace(patient_id, '^P-?', '')::bigint
            ELSE NULL
          END
        ),
        0
      )
      INTO max_existing
      FROM patients;

      BEGIN
        SELECT GREATEST(max_existing, COALESCE((SELECT MAX(counter) FROM patient_counter), 0))
          INTO max_existing;
      EXCEPTION WHEN undefined_table THEN
        NULL;
      END;

      SELECT CASE
               WHEN is_called THEN last_value
               ELSE GREATEST(last_value - 1, 0)
             END
        INTO seq_at
        FROM patient_id_seq;

      target := GREATEST(max_existing, seq_at);

      IF target > 0 THEN
        PERFORM setval('patient_id_seq', target, true);
      END IF;
    END $$;
  `);
}

async function ensurePatientIdSeq(dbHandle: DbOrTx): Promise<void> {
  if (patientIdSeqEnsured) return;
  // Cheap: do not full-scan patients on every API boot / first Register.
  await dbHandle.execute(sql`CREATE SEQUENCE IF NOT EXISTS patient_id_seq`);
  patientIdSeqEnsured = true;
}

export async function nextPatientId(dbHandle: DbOrTx): Promise<string> {
  await ensurePatientIdSeq(dbHandle);
  const result = await dbHandle.execute(sql`SELECT nextval('patient_id_seq') AS nextval`);
  const n = readNextval(result);
  return `P-${String(n).padStart(5, "0")}`;
}

/** After a unique collision, resync from MAX and allocate again. */
export async function nextPatientIdAfterConflict(dbHandle: DbOrTx): Promise<string> {
  patientIdSeqEnsured = false;
  await syncPatientIdSeqForward(dbHandle);
  patientIdSeqEnsured = true;
  const result = await dbHandle.execute(sql`SELECT nextval('patient_id_seq') AS nextval`);
  const n = readNextval(result);
  return `P-${String(n).padStart(5, "0")}`;
}

/** Test-only: allow re-running ensure after dropping the sequence in unit tests. */
export function __resetPatientIdSeqEnsureForTests(): void {
  patientIdSeqEnsured = false;
}
