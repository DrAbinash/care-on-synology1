import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const billsSrc = readFileSync(join(__dirname, "bills.ts"), "utf8");

describe("bills createBillHandler — remaining Save & Print hardens", () => {
  test("post-commit fan-out uses billingFanoutGate", () => {
    expect(billsSrc).toContain('from "../lib/billingFanoutGate"');
    expect(billsSrc).toContain("enqueueBillingFanout");
    expect(billsSrc).toMatch(/enqueueBillingFanout\(\(\) =>\s*\n?\s*generateStudiesForOrder/);
  });

  test("active order_id unique violation returns existing bill", () => {
    expect(billsSrc).toContain("isActiveOrderBillUniqueViolation");
    expect(billsSrc).toContain("returnExistingActiveBillForOrder");
    expect(billsSrc).toContain("bills_order_id_active_uidx");
  });

  test("cancel clears clientRef", () => {
    expect(billsSrc).toContain('status: "cancelled"');
    expect(billsSrc).toContain("clientRef: null");
    expect(billsSrc).toContain("Free client_ref so cancel+rebill");
  });
});
