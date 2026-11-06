/**
 * The receipt-repair half of a reminder resend. A FAILED receipt that is
 * successfully re-sent from the tracking screen must return to "sent" —
 * the newest send is in flight — because the webhook's delivered/read
 * updates exclude "failed" rows, so without the repair the tracking table
 * shows "Failed" forever after a retry that worked (#1168).
 *
 * Mocked-db harness (same pattern as reportDeliveryReceipts.test.ts).
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: (setVal: Record<string, unknown>) => {
        const rec = { set: setVal, where: null as unknown };
        h.updates.push(rec);
        return { where: (w: unknown) => { rec.where = w; return Promise.resolve(); } };
      },
    })),
  },
}));
vi.mock("@workspace/db/schema", () => ({ reportDeliveryReceiptsTable: { id: "t.id", status: "t.status" } }));
// Tag the drizzle combinators so the WHERE clause can be asserted structurally.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...parts: unknown[]) => ({ op: "and", parts }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
  lt: (a: unknown, b: unknown) => ({ op: "lt", a, b }),
  notInArray: (a: unknown, b: unknown) => ({ op: "notInArray", a, b }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: "sql", strings, vals }),
}));

import { repairFailedReceiptAfterRemind } from "./reportDeliveryReceipts";

describe("repairFailedReceiptAfterRemind", () => {
  test("resets a failed receipt to sent, clearing the failure record", async () => {
    h.updates.length = 0;
    await repairFailedReceiptAfterRemind(7);
    expect(h.updates).toHaveLength(1);
    const { set, where } = h.updates[0]!;
    expect(set.status).toBe("sent");
    expect(set.failedAt).toBeNull();
    expect(set.lastError).toBeNull();
    // Repair is restricted: only THIS receipt, and only while it is failed —
    // a delivered receipt must never be downgraded to sent.
    const w = where as { op: string; parts: Array<{ op: string; a: unknown; b: unknown }> };
    expect(w.op).toBe("and");
    const eqs = w.parts.filter((p) => p.op === "eq");
    expect(eqs.some((p) => p.b === 7)).toBe(true);
    expect(eqs.some((p) => p.b === "failed")).toBe(true);
  });

  test("repairs to the state the sender can actually claim (§3)", async () => {
    h.updates.length = 0;
    // A reminder the outbox only QUEUED must not lift a failed receipt to "sent":
    // the provider has not taken it. It repairs to "queued", which says what is
    // known — Care holds it — and still clears the stale failure.
    await repairFailedReceiptAfterRemind(11, "queued");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.set.status).toBe("queued");
    expect(h.updates[0]!.set.failedAt).toBeNull();

    // A reminder that failed again writes nothing: the row's "failed" is the truth.
    h.updates.length = 0;
    await repairFailedReceiptAfterRemind(12, "failed");
    expect(h.updates, "a failed reminder must not repair anything").toHaveLength(0);

    // And the default stays "sent" for a caller that already holds a wamid.
    h.updates.length = 0;
    await repairFailedReceiptAfterRemind(13);
    expect(h.updates[0]!.set.status).toBe("sent");
  });

  test("never throws when the update fails (non-fatal, like the rest of the lib)", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(repairFailedReceiptAfterRemind(9)).resolves.toBeUndefined();
  });
});

describe("source contract — the /remind route repairs on evidence (§3)", () => {
  test("a reminder is repaired to its verdict, and a failed one is not repaired", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "routes", "reportDeliveryTracking.ts"),
      "utf8",
    );
    expect(src).toContain("repairFailedReceiptAfterRemind");
    // Gated on the verdict, after markReminded stamps any provider message id the
    // send actually returned.
    expect(src).toMatch(
      /if \(verdict !== "failed"\) \{\s*await repairFailedReceiptAfterRemind\(id\.data, verdict\);/,
    );
    expect(src, "the flag-only gate this replaced claimed a queue INSERT was a send")
      .not.toMatch(/if \(send\.ok\) \{\s*await repairFailedReceiptAfterRemind/);
  });
});
