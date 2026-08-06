import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Source contract: order numbers must use numeric MAX + advisory lock, never
// text MAX(SUBSTRING(...)) which sticks on duplicates when pad widths differ
// (prod: ORD-202608-0013 unique_violation → POST /api/orders 500 storm).

const SRC = join(dirname(fileURLToPath(import.meta.url)), "orders.ts");
const src = readFileSync(SRC, "utf8");
const careOrder = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../services/integration/careOrder.ts"),
  "utf8",
);

describe("order number allocation", () => {
  it("uses split_part + ::int MAX (never bound substring-from, which is regex in PG)", () => {
    expect(src).toContain("split_part(order_number, '-', 3)");
    expect(src).toContain("::int");
    // Bound `substring(… from ${n})` is interpreted as regex substring in Postgres
    // and stuck prod on ORD-202608-0013 even after the first numeric-MAX fix.
    expect(src).not.toMatch(/substring\(order_number from \$\{/);
    expect(src).not.toMatch(/MAX\(SUBSTRING\(order_number FROM/);
  });

  it("serializes allocation with the care_erp_order_number advisory lock", () => {
    expect(src).toContain("care_erp_order_number");
    expect(src).toContain("pg_advisory_xact_lock");
  });

  it("retries unique violations instead of surfacing a raw 500 once", () => {
    expect(src).toContain("isUniqueViolation");
    expect(src).toMatch(/attempt < 5|attempt = 0; attempt < 5/);
  });

  it("Hope careOrder reuses the same allocator (no count(*)+1)", () => {
    expect(careOrder).toContain('from "../../routes/orders"');
    expect(careOrder).toContain("generateOrderNumber");
    expect(careOrder).not.toMatch(/select\(\{\s*count:\s*sql/);
    expect(careOrder).not.toMatch(/Number\(count\[0/);
  });
});
