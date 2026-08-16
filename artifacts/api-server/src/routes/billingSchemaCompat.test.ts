import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");

describe("post-deploy billing schema compatibility (source)", () => {
  test("ensure-emergency_patient_resolutions migration is present and idempotent", () => {
    const path = join(
      repoRoot,
      "migrations/zzzzzzzzzzzzz_ensure_emergency_patient_resolutions.sql",
    );
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS emergency_patient_resolutions");
    expect(sql).toContain("emergency_patient_resolutions_uuid_uq");
  });

  test("billing_save_harden does not invent a gross_billing column", () => {
    const sql = readFileSync(
      join(repoRoot, "migrations/zzzzzzzzzzzz_billing_save_harden.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/gross_billing/i);
    expect(sql).toContain("bills_order_id_active_uidx");
    expect(sql).toContain("bills_client_ref_uidx");
  });

  test("referral index migration skips when referred_by_id is absent", () => {
    const sql = readFileSync(
      join(repoRoot, "migrations/zzzz_schema_drift_fix_indexes.sql"),
      "utf8",
    );
    expect(sql).toContain("bills.referred_by_id does not exist — skipping");
    expect(sql).toContain("orders.referred_by_id does not exist — skipping");
    expect(sql).toContain("idx_bills_referred_by_created");
  });

  test("core billing tables use doctor_id on orders, not bills.referred_by_id", () => {
    const bills = readFileSync(join(repoRoot, "lib/db/src/schema/bills.ts"), "utf8");
    const orders = readFileSync(join(repoRoot, "lib/db/src/schema/orders.ts"), "utf8");
    expect(bills).not.toMatch(/referredById|referred_by_id/);
    expect(orders).toContain('doctorId: integer("doctor_id")');
    expect(orders).not.toMatch(/referredById|referred_by_id/);
  });
});
