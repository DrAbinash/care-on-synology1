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

/**
 * Next patient UHID as `P-#####` via SEQUENCE nextval.
 * Safe on pooled connections — no session advisory lock (unlike the old
 * pg_advisory_lock path that could hang Billing Desk registration forever
 * when unlock ran on a different pool connection).
 *
 * Sequence is created/seeded by migrations/zzzz_patient_id_seq.sql and
 * forward-synced by zzzz_patient_id_seq_reseed.sql. On each process boot we
 * also bump the sequence forward to MAX(existing UHID) so a stale sequence
 * (seeded while the old MAX+1 allocator was still minting IDs) cannot collide.
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
  await syncPatientIdSeqForward(dbHandle);
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
