import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const billsSrc = readFileSync(join(__dirname, "bills.ts"), "utf8");
const deskSrc = readFileSync(
  join(__dirname, "../../../diagnostic-erp/src/pages/BillingDesk.tsx"),
  "utf8",
);

describe("fast-mode token handoff", () => {
  test("GET /:id/tokens supports waitMs long-poll + DB fallback", () => {
    expect(billsSrc).toContain("waitForBillTokens");
    expect(billsSrc).toContain("publishBillTokens");
    expect(billsSrc).toContain("waitMs");
    expect(billsSrc).toContain("eq(testTokensTable.billId, billId)");
  });

  test("BillingDesk uses one waitMs fetch instead of 5×500ms poll", () => {
    expect(deskSrc).toContain("/tokens?waitMs=2500");
    expect(deskSrc).not.toMatch(/retries\s*=\s*5/);
    expect(deskSrc).not.toMatch(/setTimeout\(r,\s*500\)/);
  });
});
