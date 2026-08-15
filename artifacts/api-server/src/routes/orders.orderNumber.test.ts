import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Source contract: order numbers allocate via SEQUENCE nextval (not MAX+advisory
// lock, and never text MAX(SUBSTRING(...)) which sticks on pad-width duplicates).

const SRC = join(dirname(fileURLToPath(import.meta.url)), "orders.ts");
const src = readFileSync(SRC, "utf8");
const careOrder = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../services/integration/careOrder.ts"),
  "utf8",
);
const counters = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/documentNumberCounters.ts"),
  "utf8",
);

describe("order number allocation", () => {
  it("uses SEQUENCE nextval via next_order_number_seq (not MAX+advisory lock)", () => {
    expect(src).toContain("nextDocumentCounter");
    expect(src).toContain('nextDocumentCounter(dbHandle, "order"');
    expect(counters).toContain("next_order_number_seq");
    expect(counters).toContain("nextval('bill_number_seq')");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("care_erp_order_number");
    expect(codeOnly).not.toMatch(/pg_advisory_xact_lock/);
    expect(codeOnly).not.toMatch(/substring\s*\(\s*order_number\s+from/i);
    expect(codeOnly).not.toMatch(/MAX\s*\(\s*SUBSTRING\s*\(\s*order_number/i);
  });

  it("retries unique violations instead of surfacing a raw 500 once", () => {
    expect(src).toContain("isUniqueViolation");
    expect(src).toMatch(/attempt < 5|attempt = 0; attempt < 5/);
  });

  it("Hope careOrder reuses the same allocator (no count(*)+1, no advisory lock)", () => {
    expect(careOrder).toContain('from "../../routes/orders"');
    expect(careOrder).toContain("generateOrderNumber");
    expect(careOrder).not.toMatch(/select\(\{\s*count:\s*sql/);
    expect(careOrder).not.toMatch(/Number\(count\[0/);
    const codeOnly = careOrder.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("care_erp_order_number");
    expect(codeOnly).not.toMatch(/pg_advisory_xact_lock/);
  });
});
