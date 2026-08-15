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
 * Sequence is created/seeded by migrations/zzzz_patient_id_seq.sql. For
 * local `db:push` envs that skip feature migrations, we CREATE IF NOT EXISTS
 * and seed once when the sequence has never been used.
 */
let patientIdSeqEnsured = false;

async function ensurePatientIdSeq(dbHandle: DbOrTx): Promise<void> {
  if (patientIdSeqEnsured) return;
  await dbHandle.execute(sql`CREATE SEQUENCE IF NOT EXISTS patient_id_seq`);
  // Seed only when unused so we never rewind a live sequence.
  await dbHandle.execute(sql`
    DO $$
    DECLARE
      seed bigint := 0;
    BEGIN
      IF (SELECT last_value FROM patient_id_seq) = 1
         AND NOT (SELECT is_called FROM patient_id_seq) THEN
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
        INTO seed
        FROM patients;

        BEGIN
          SELECT GREATEST(seed, COALESCE((SELECT MAX(counter) FROM patient_counter), 0))
            INTO seed;
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END;

        IF seed > 0 THEN
          PERFORM setval('patient_id_seq', seed, true);
        END IF;
      END IF;
    END $$;
  `);
  patientIdSeqEnsured = true;
}

export async function nextPatientId(dbHandle: DbOrTx): Promise<string> {
  await ensurePatientIdSeq(dbHandle);
  const result = await dbHandle.execute(sql`SELECT nextval('patient_id_seq') AS nextval`);
  const n = readNextval(result);
  return `P-${String(n).padStart(5, "0")}`;
}

/** Test-only: allow re-running ensure after dropping the sequence in unit tests. */
export function __resetPatientIdSeqEnsureForTests(): void {
  patientIdSeqEnsured = false;
}
