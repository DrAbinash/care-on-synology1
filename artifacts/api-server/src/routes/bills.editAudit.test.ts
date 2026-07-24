import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Finance-audit gap #1 — PUT /bills/:id audit-actor integrity.
//
// The bill-edit handler audits status/discount changes into bill_audits. It
// used to take the audit actor from the client body (`editedBy`) AND gate the
// whole audit block on `if (editedBy && reason)`, so a caller could either
// spoof the actor or skip auditing a financial change entirely by omitting the
// field. This source-contract test pins the hardened wiring: the actor is
// derived from the authenticated session and a real status/discount change is
// always audited.
//
// Source-contract style (no DB): asserts against the handler source region so a
// regression that re-introduces client-trusted / skippable auditing fails CI.

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

  test("status/discount audit rows are written under the session-derived actor", () => {
    // Both audited change types must stamp editActor.
    const stamped = region.match(/editedBy: editActor/g) ?? [];
    expect(stamped.length).toBeGreaterThanOrEqual(2);
    // The bill-edit email notification also reports the session actor.
    expect(region).toContain("editedBy: editActor,");
  });

  test("the audit block is no longer gated on a client-supplied editedBy", () => {
    // The old, skippable gate must be gone: omitting editedBy must not be able
    // to suppress the audit of a real financial change.
    expect(region).not.toContain("if (editedBy && reason)");
    expect(region).not.toMatch(/const \{ editedBy, reason \} = req\.body;/);
  });

  test("reason falls back to a default so an audit row is never blocked", () => {
    expect(region).toContain('const editReason = (req.body?.reason as string | undefined)?.trim() || "bill edit";');
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

  test("the warning is computed only when status/discount actually changed", () => {
    expect(region).toContain("if (statusChanged || discountChanged) {");
  });

  test("a post-close edit is recorded in the audit reason", () => {
    expect(region).toContain("closedPeriodWarning?.billCreatedBeforeClose");
    expect(region).toContain("post-close edit: period closed at");
    // Audit rows carry the annotated reason.
    expect(region).toContain("reason: auditReason");
  });

  test("the notice is advisory — it is returned, never thrown or blocking", () => {
    expect(region).toContain("res.json({ ...(await buildBill(updated)), closedPeriodWarning });");
    // The closure lookup must not be able to fail the edit.
    expect(region).toContain("Closed-period check failed — edit still succeeded, notice omitted");
  });
});
