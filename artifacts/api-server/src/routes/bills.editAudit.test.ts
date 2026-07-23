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
