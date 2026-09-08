import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("swap-test single-item + excess-only refund contract", () => {
  it("does not refund from raw priceDiff and UI exposes Change test on last line", () => {
    const api = readFileSync(join(__dirname, "bills.ts"), "utf8");
    const start = api.indexOf('billsRouter.post("/:id/swap-test"');
    const end = api.indexOf("// ─── ICICI Billing Desk", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = api.slice(start, end);
    expect(region).toContain("excessPaise");
    expect(region).toContain("test swap excess");
    expect(region).not.toContain("Extra charge for test swap");
    // Must not auto-refund the full line price drop (unpaid cheaper swap bug).
    expect(region).not.toMatch(/if \(rupeesToPaise\(priceDiff\) < -1\)/);

    const ui = readFileSync(
      join(__dirname, "../../../diagnostic-erp/src/pages/BillDetail.tsx"),
      "utf8",
    );
    expect(ui).toContain('data-testid="change-test"');
    expect(ui).toContain("Change test");
    expect(ui).toContain("Change / Replace Test");
    expect(ui).toMatch(/Only one test on this bill/);
  });
});
