import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Finance-audit gap #2 — expense edit/void ledger + audit integrity.
// V2: DELETE soft-voids (requires reason) and writes an audit row.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "expenses.ts"), "utf8");

function region(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `${startMarker} must exist`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `${endMarker} (region boundary) must exist`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const patchRegion = () => region('router.patch("/:id"', 'router.delete("/:id"');
const deleteRegion = () => region('router.delete("/:id"', "export { router");

describe("expenses gap #2 — no silent double-voucher, edits/voids are audited", () => {
  test("edit no longer fires the '-edit' full-amount double voucher", () => {
    expect(src).not.toContain('"-edit"');
    expect(src).not.toContain('+ "\-edit"');
    expect(patchRegion()).not.toContain("autoVoucherForExpense(");
  });

  test("edit writes a tamper-evident audit row via auditFromRequest", () => {
    const r = patchRegion();
    expect(r).toContain("auditFromRequest(req, {");
    expect(r).toContain('action: "edit"');
    expect(r).toContain('entityType: "expense"');
    expect(r).toContain("req as StaffAuthRequest).staffSession");
    expect(r).toContain("oldValue: JSON.stringify({ amount: before.amount");
    expect(r).toContain("newValue: JSON.stringify({ amount: expense.amount");
  });

  test("delete soft-voids with reason and audits (no hard delete)", () => {
    const r = deleteRegion();
    expect(r).toContain("voidExpense");
    expect(r).toContain("Void reason is required");
    expect(r).toContain("auditFromRequest(req, {");
    expect(r).toContain('action: "delete"');
    expect(r).toContain('entityType: "expense"');
    expect(r).toContain("voucherId: expense.voucherId ?? null");
    expect(r).not.toMatch(/\.delete\(expensesTable\)/);
  });
});
