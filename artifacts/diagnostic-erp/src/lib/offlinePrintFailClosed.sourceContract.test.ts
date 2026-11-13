/**
 * The desk may print a provisional receipt only when the bill is durably queued.
 *
 * Measured before this existed: `writeQueue()` swallowed every localStorage
 * failure — quota full, private mode, storage disabled for the origin — and its
 * own comment claimed the bill was "still printed/queued in memory for this
 * session". There is no in-memory queue, so that sentence described a protection
 * that does not exist. The caller could not tell, printed the receipt, and the
 * bill was simply gone: no order row, no bill row, no queue entry, nothing for
 * the witness announcement to report. The clinic's only record was the patient's
 * copy of the paper.
 *
 * These are grep guards on purpose, in the same style as
 * billPrintAuditCoverage.test.ts: the fault they prevent is "the page prints on
 * a door that skips the durability check", which is a property of which throw
 * follows which call in the save path — not something reachable without a
 * browser. The behaviour itself (stored:true / stored:false, and the
 * announcement that carries the witness) is executed in
 * offlineBillingQueue.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BILLING_DESK = readFileSync(
  resolve(__dirname, "../pages/BillingDesk.tsx"),
  "utf8",
);

describe("the offline print path fails closed", () => {
  it("checks that the write landed BEFORE it claims the bill is queued", () => {
    expect(BILLING_DESK).toMatch(
      /const queued = enqueueBill\(\{[\s\S]*?\}\);\s*[\s\S]*?if \(!queued\.stored\) throw new BillNotQueuedError\(\);\s*throw new QueuedForSyncError\(snapshot\);/,
    );
  });

  // QueuedForSyncError is the desk's licence to print; handing it the same
  // shape would have made the worst of the two states look like the mildest.
  it("names the two states with two different error classes", () => {
    expect(BILLING_DESK).toContain("BillNotQueuedError");
    expect(BILLING_DESK).toMatch(
      /if \(err instanceof BillNotQueuedError\) \{[\s\S]*?variant: "destructive",\s*\}\);/,
    );
  });

  // The recoverable branch resets the desk because the bill is safe. An
  // unqueued bill must leave the cashier's screen exactly as it was.
  it("does not clear the desk when nothing was queued", () => {
    const branch = BILLING_DESK.match(
      /if \(err instanceof BillNotQueuedError\) \{[\s\S]*?\n      \} else \{/,
    );
    expect(branch, "the BillNotQueuedError branch is missing").toBeTruthy();
    expect(branch![0]).not.toContain("resetAll");
    expect(BILLING_DESK).toMatch(
      /if \(err instanceof QueuedForSyncError\) \{[\s\S]*?resetAll\(\);\s*return;\s*\}/,
    );
  });

  it("sends the witness with the bill, so the totals are not re-derived later", () => {
    expect(BILLING_DESK).toMatch(
      /witness: \{\s*patientId: selectedPatient\.id,\s*testCount: selectedTests\.length,\s*totalAmount: total,/,
    );
  });
});
