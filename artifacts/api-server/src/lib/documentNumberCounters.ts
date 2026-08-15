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

/** Bump bill_number_seq forward to at least MAX(existing bill suffix). Never rewinds. */
export async function syncBillNumberSeqForward(dbHandle: DbOrTx): Promise<void> {
  await dbHandle.execute(sql`CREATE SEQUENCE IF NOT EXISTS bill_number_seq`);
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
            WHEN bill_number ~ '^[0-9]{6}[0-9]+$'
              THEN substring(bill_number from 7)::bigint
            WHEN bill_number ~ '^BILL-[0-9]{6}-[0-9]+$'
              THEN split_part(bill_number, '-', 3)::bigint
            ELSE NULL
          END
        ),
        0
      )
      INTO max_existing
      FROM bills;

      SELECT CASE
               WHEN is_called THEN last_value
               ELSE GREATEST(last_value - 1, 0)
             END
        INTO seq_at
        FROM bill_number_seq;

      target := GREATEST(max_existing, seq_at);
      IF target > 0 THEN
        PERFORM setval('bill_number_seq', target, true);
      END IF;
    END $$;
  `);
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
