import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Finance-audit gap #2 — expense edit/delete ledger + audit integrity.
//
// Before: editing an expense's amount fired a SECOND full-amount payment
// voucher (`expenseId + "-edit"`) while the original PV stayed, double-counting
// the expense in the ledger; deleting an expense hard-deleted the row with no
// audit and left its voucher orphaned in the books.
//
// This source-contract test (no DB) pins the shipped subset: the silent
// double-post is gone and both edit and delete now write a tamper-evident audit
// row via auditFromRequest. (The ledger reversal/delta voucher is a separate,
// tracked follow-up because it needs a reversing-voucher path against the
// locked vouchers table.)

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "expenses.ts"), "utf8");

function region(startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `${startMarker} must exist`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `${endMarker} (region boundary) must exist`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const patchRegion = () => region('router.patch("/:id"', 'router.post("/scan-bill"');
const deleteRegion = () => region('router.delete("/:id"', "export { router");

describe("expenses gap #2 — no silent double-voucher, edits/deletes are audited", () => {
  test("edit no longer fires the '-edit' full-amount double voucher", () => {
    // The old double-post is gone everywhere in the file.
    expect(src).not.toContain('"-edit"');
    expect(src).not.toContain("+ \"-edit\"");
    // ...and specifically not inside the edit handler.
    expect(patchRegion()).not.toContain("autoVoucherForExpense");
  });

  test("edit writes a tamper-evident audit row via auditFromRequest", () => {
    const r = patchRegion();
    expect(r).toContain("auditFromRequest(req, {");
    expect(r).toContain('action: "edit"');
    expect(r).toContain('entityType: "expense"');
    // Actor comes from the authenticated session, not the body.
    expect(r).toContain("req as StaffAuthRequest).staffSession");
    // Old and new amount/mode are both captured for the trail.
    expect(r).toContain("oldValue: JSON.stringify({ amount: before.amount");
    expect(r).toContain("newValue: JSON.stringify({ amount: expense.amount");
  });

  test("delete writes an audit row capturing the orphaned voucherId", () => {
    const r = deleteRegion();
    expect(r).toContain("auditFromRequest(req, {");
    expect(r).toContain('action: "delete"');
    expect(r).toContain('entityType: "expense"');
    expect(r).toContain("voucherId: expense.voucherId ?? null");
  });
});
