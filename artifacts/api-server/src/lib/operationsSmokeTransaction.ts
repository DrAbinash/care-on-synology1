/**
 * operationsSmokeTransaction.ts — Phase 4 optional deeper smoke test.
 *
 * Exercises the create → read → update path on real tables INSIDE a database
 * transaction that is ALWAYS rolled back, so nothing is ever committed:
 *   • a synthetic patient (reserved prefix SMOKE-TEST-<epoch>),
 *   • a report draft for it,
 *   • read-back + update verification,
 *   • forced rollback, then a belt-and-braces cleanup check.
 *
 * It NEVER creates a finalized report, never touches billing/payment/WhatsApp/
 * DICOM/notification paths, and guarantees cleanup (rollback + post-verify).
 * Only runs when explicitly requested (CLI --transactional / smoke-run body).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { safeError, type OpsCheck } from "./operationsHealth";

export const SMOKE_PREFIX = "SMOKE-TEST-";

const ROLLBACK = { __smokeRollback: true } as const;

export async function runTransactionalSmoke(now: Date): Promise<OpsCheck[]> {
  const steps: OpsCheck[] = [];
  const marker = `${SMOKE_PREFIX}${now.getTime()}`;
  const add = (id: string, name: string, status: OpsCheck["status"], message: string, ms = 0) =>
    steps.push({ id, name, category: "core_erp", required: false, status, message, checkedAt: now.toISOString(), durationMs: ms });

  const t0 = Date.now();
  try {
    await db.transaction(async (tx) => {
      const ins = await tx.execute(sql`
        INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, phone)
        VALUES (${marker}, 'Smoke', 'Test', '1990-01-01', 'male', '0000000000') RETURNING id`);
      const pid = Number((ins.rows[0] as { id: number }).id);
      add("smoke.tx.create_patient", "Tx: create synthetic patient", "PASS", `created synthetic patient (${marker})`);

      const rb = await tx.execute(sql`SELECT id FROM patients WHERE id = ${pid}`);
      if (rb.rows.length !== 1) throw new Error("read-back returned no row");
      add("smoke.tx.read_patient", "Tx: read back synthetic patient", "PASS", "read-back OK");

      const d = await tx.execute(sql`
        INSERT INTO radiology_report_drafts (patient_id, raw_findings, status)
        VALUES (${pid}, 'SMOKE TEST draft — rolled back', 'DRAFT') RETURNING id`);
      add("smoke.tx.create_draft", "Tx: create synthetic draft", "PASS", `created synthetic draft id=${Number((d.rows[0] as { id: number }).id)}`);

      await tx.execute(sql`UPDATE patients SET phone = '1111111111' WHERE id = ${pid}`);
      const upd = await tx.execute(sql`SELECT phone FROM patients WHERE id = ${pid}`);
      if ((upd.rows[0] as { phone: string }).phone !== "1111111111") throw new Error("update not visible in transaction");
      add("smoke.tx.update", "Tx: update + verify", "PASS", "update visible inside the transaction");

      // Force rollback — nothing above is ever committed.
      throw ROLLBACK;
    });
  } catch (e) {
    if (!(e && typeof e === "object" && "__smokeRollback" in e)) {
      add("smoke.tx.write_probe", "Tx: rollback-isolated write probe", "FAIL", safeError(e), Date.now() - t0);
      // Best-effort cleanup in case a partial commit somehow occurred.
      try { await db.execute(sql`DELETE FROM patients WHERE patient_id = ${marker}`); } catch { /* ignore */ }
      return steps;
    }
  }

  add("smoke.tx.rollback", "Tx: rolled back (nothing persisted)", "PASS", "transaction rolled back", Date.now() - t0);

  // Belt-and-braces: prove no synthetic record survived the rollback.
  try {
    const check = await db.execute(sql`SELECT count(*)::int AS c FROM patients WHERE patient_id = ${marker}`);
    const leaked = Number((check.rows[0] as { c: number }).c);
    if (leaked > 0) {
      await db.execute(sql`DELETE FROM patients WHERE patient_id = ${marker}`);
      add("smoke.tx.cleanup", "Tx: cleanup verification", "WARNING", `${leaked} synthetic record(s) had persisted; deleted them`);
    } else {
      add("smoke.tx.cleanup", "Tx: cleanup verification", "PASS", "confirmed no synthetic records persisted");
    }
  } catch (e) {
    add("smoke.tx.cleanup", "Tx: cleanup verification", "UNKNOWN", safeError(e));
  }
  return steps;
}
