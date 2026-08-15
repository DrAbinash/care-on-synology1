import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const billsSrc = readFileSync(join(__dirname, "bills.ts"), "utf8");

describe("billing speed invariants", () => {
  test("GET /api/bills hydrates via buildBillsBatch, not per-row buildBill", () => {
    expect(billsSrc).toContain("async function buildBillsBatch(");
    expect(billsSrc).toContain("await buildBillsBatch(bills, { compact })");
    expect(billsSrc).not.toContain("await Promise.all(bills.map(buildBill))");
  });

  test("fast-mode bill create still fires autoVoucherForPayment", () => {
    const fastIdx = billsSrc.indexOf('const fastMode = req.query.fast === "1"');
    expect(fastIdx).toBeGreaterThan(0);
    const fastBlock = billsSrc.slice(fastIdx, fastIdx + 3500);
    expect(fastBlock).toContain("autoVoucherForPayment({");
    expect(fastBlock).toContain("_fastMode: true");
  });

  test("payment POST does not await post-commit voucher metadata SELECTs", () => {
    const payIdx = billsSrc.indexOf("paymentsRouter.post(\"/\"");
    expect(payIdx).toBeGreaterThan(0);
    const payBlock = billsSrc.slice(payIdx, payIdx + 4500);
    // Metadata is resolved inside the FOR UPDATE transaction…
    expect(payBlock).toContain("Resolve voucher metadata inside the same tx");
    // …and the old post-commit pair of SELECTs is gone.
    expect(payBlock).not.toMatch(
      /\/\/ Auto-generate accounting voucher[\s\S]*await db\s*\.select\(\{\s*billNumber: billsTable\.billNumber/,
    );
  });
});
