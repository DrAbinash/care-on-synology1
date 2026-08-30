import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Finance-audit gap #1 — PUT /bills/:id audit-actor integrity.
//
// The bill-edit handler audits discount/due-date changes into bill_audits. It
// used to take the audit actor from the client body (`editedBy`) AND gate the
// whole audit block on `if (editedBy && reason)`, so a caller could either
// spoof the actor or skip auditing a financial change entirely by omitting the
// field. This source-contract test pins the hardened wiring: the actor is
// derived from the authenticated session and a real discount change is
// always audited.
//
// Status transitions were removed from UpdateBillBody (P0-1) — cancel/payment/
// refund use dedicated routes. Source-contract style (no DB).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "bills.ts"), "utf8");

/** The body of the PUT /:id handler, from its declaration to the next route. */
function putHandlerRegion(): string {
  const start = src.indexOf('billsRouter.put("/:id"');
  expect(start, "PUT /:id handler must exist").toBeGreaterThan(-1);
  // The next route registered after PUT /:id is the reprint-log POST.
  const end = src.indexOf('billsRouter.post("/:id/reprint-log"', start);
  expect(end, "reprint-log route (region boundary) must exist").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("PUT /bills/:id — audit actor comes from the session, not the client body", () => {
  const region = putHandlerRegion();

  test("audit actor is derived from req.staffSession, not trusted from the body", () => {
    expect(region).toContain("const editActor = req.staffSession?.subjectName?.trim()");
  });

  test("discount audit rows are written under the session-derived actor", () => {
    expect(region).toContain("editedBy: editActor");
    expect(region).toContain("editedBy: editActor,");
  });

  test("the audit block is no longer gated on a client-supplied editedBy", () => {
    expect(region).not.toContain("if (editedBy && reason)");
    expect(region).not.toMatch(/const \{ editedBy, reason \} = req\.body;/);
  });

  test("reason falls back to a default so an audit row is never blocked", () => {
    expect(region).toContain('const editReason = (req.body?.reason as string | undefined)?.trim() || "bill edit";');
  });

  test("P0-1: generic PUT does not write bill status", () => {
    expect(region).not.toMatch(/if \(status !== undefined\) updateData\.status/);
    expect(region).toContain("const { discount, dueDate } = bodyParsed.data");
  });

  test("P0-1: empty update (stripped status-only body) is a no-op, not a 500", () => {
    expect(region).toContain("if (Object.keys(updateData).length === 0)");
    expect(region).toContain("await buildBill(existingBill)");
  });
});

// Finance-audit gap #7 — editing a bill from an already-closed (signed-off) day
// silently rewrites that period's totals. The sibling money-moving routes
// (/:id/cancel, /:id/refund) already surface a closedPeriodWarning; the edit
// route did not. It now reuses the SAME boundary helpers (no duplicated logic),
// stays advisory (never blocks, matching the siblings), and stamps the fact
// into the audit reason so the trail records the post-close edit.
describe("PUT /bills/:id — post-close edits are flagged", () => {
  const region = putHandlerRegion();

  test("reuses the existing closure-boundary helpers rather than new logic", () => {
    expect(region).toContain("await lastOverallClosureBoundary()");
    expect(region).toContain("isBeforeClosureBoundary(new Date(updated.createdAt), boundary)");
  });

  test("the warning is computed when discount or dueDate actually changed", () => {
    expect(region).toContain("if (discountChanged || dueDateChanged) {");
  });

  test("a post-close edit is recorded in the audit reason", () => {
    expect(region).toContain("closedPeriodWarning?.billCreatedBeforeClose");
    expect(region).toContain("post-close edit: period closed at");
    expect(region).toContain("reason: auditReason");
  });

  test("the notice is advisory — it is returned, never thrown or blocking", () => {
    expect(region).toContain("res.json({ ...(await buildBill(updated)), closedPeriodWarning });");
    expect(region).toContain("Closed-period check failed — edit still succeeded, notice omitted");
  });
});
