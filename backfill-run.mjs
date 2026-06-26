/**
 * backfill-run.mjs
 * One-shot backfill script — restores original_total on refunded bills.
 * Run this on the machine WHERE THE APP IS DEPLOYED (i.e., Synology),
 * or from any machine that has direct DB access.
 *
 * Usage:
 *   DATABASE_URL="postgres://erp:changeme@localhost:5432/diagnostic_erp" node backfill-run.mjs
 *
 * On Synology Docker shell:
 *   docker exec -it care-api sh -c "node /app/backfill-run.mjs"
 */

import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USER || "erp"}:${process.env.DB_PASSWORD || "changeme"}@db:5432/${process.env.DB_NAME || "diagnostic_erp"}`;

const pool = new Pool({ connectionString: DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("=== CARE DIAGNOSTICS ERP — Refund Backfill ===");
    console.log("Connected to:", DATABASE_URL.replace(/:([^:@]+)@/, ":***@"));

    // ── Step 1: Dry run preview ───────────────────────────────────────────────
    const preview = await client.query(`
      SELECT
        id,
        bill_number,
        total_amount::numeric        AS current_total,
        original_total::numeric      AS original_total,
        refund_amount::numeric       AS refund_amount,
        paid_amount::numeric         AS paid_amount,
        balance_amount::numeric      AS balance_amount,
        status,
        ROUND((original_total::numeric - total_amount::numeric)::numeric, 2) AS drift
      FROM bills
      WHERE refund_amount::numeric > 0
        AND ABS(total_amount::numeric - original_total::numeric) > 0.01
      ORDER BY id
    `);

    console.log(`\nDRY RUN: Found ${preview.rows.length} bill(s) where total_amount was mutated by a refund.`);

    if (preview.rows.length === 0) {
      console.log("✅ Nothing to fix — all refunded bills already have correct total_amount.");
      return;
    }

    console.log("\nBills that will be corrected:");
    console.table(
      preview.rows.map((r) => ({
        id: r.id,
        bill: r.bill_number,
        currentTotal: `₹${r.current_total}`,
        originalTotal: `₹${r.original_total}`,
        refund: `₹${r.refund_amount}`,
        drift: `₹${r.drift}`,
        status: r.status,
      }))
    );

    const totalDrift = preview.rows.reduce((s, r) => s + parseFloat(r.drift), 0);
    console.log(`\nTotal revenue drift to be corrected: ₹${totalDrift.toFixed(2)}`);

    // ── Step 2: Apply fix in a transaction ────────────────────────────────────
    console.log("\nApplying backfill in a transaction...");
    await client.query("BEGIN");

    const result = await client.query(`
      UPDATE bills
      SET
        total_amount    = original_total,
        balance_amount  = GREATEST(0, original_total::numeric - paid_amount::numeric - refund_amount::numeric)
      WHERE
        refund_amount::numeric > 0
        AND ABS(total_amount::numeric - original_total::numeric) > 0.01
      RETURNING id, bill_number, total_amount, balance_amount, status
    `);

    console.log(`\nUpdated ${result.rowCount} bill(s):`);
    console.table(result.rows.map((r) => ({
      id: r.id,
      bill: r.bill_number,
      newTotal: `₹${r.total_amount}`,
      newBalance: `₹${r.balance_amount}`,
      status: r.status,
    })));

    // ── Step 3: Verify zero drift after fix ───────────────────────────────────
    const verify = await client.query(`
      SELECT COUNT(*) AS remaining_drift
      FROM bills
      WHERE refund_amount::numeric > 0
        AND ABS(total_amount::numeric - original_total::numeric) > 0.01
    `);

    const remaining = parseInt(verify.rows[0].remaining_drift, 10);
    if (remaining === 0) {
      await client.query("COMMIT");
      console.log("\n✅ COMMIT — All bills corrected. Zero remaining drift.");
    } else {
      await client.query("ROLLBACK");
      console.error(`\n❌ ROLLBACK — ${remaining} bills still have drift after update. Something went wrong.`);
      process.exit(1);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n❌ ROLLBACK due to error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
