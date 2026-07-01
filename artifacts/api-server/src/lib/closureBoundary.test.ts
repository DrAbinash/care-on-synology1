import { describe, expect, test, vi } from "vitest";

// closureBoundary.ts imports `db` from @workspace/db at module top level,
// which throws unconditionally at import time when DATABASE_URL is not set.
// isBeforeClosureBoundary is pure and never touches the database — mocking
// prevents the load-time throw without affecting what is under test. Same
// pattern as day-close.test.ts / usgExtractor.test.ts.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) },
  dayClosuresTable: {},
}));

import { isBeforeClosureBoundary } from "./closureBoundary";

// Approved Fix #6 (Refund Against Closed Period Warning): a refund against
// a bill from an already-closed period is never blocked and never requires
// owner approval — it just carries forward into the next open window
// automatically. This is a pure, informational comparison used to give
// staff a heads-up only.

describe("isBeforeClosureBoundary", () => {
  test("no closure has ever happened (boundary is null) → never 'before close'", () => {
    expect(isBeforeClosureBoundary(new Date("2026-06-01T00:00:00Z"), null)).toBe(false);
  });

  test("bill created strictly before the closure boundary → true (closed period)", () => {
    const boundary = new Date("2026-07-01T12:00:00Z");
    const billCreatedAt = new Date("2026-06-20T09:00:00Z");
    expect(isBeforeClosureBoundary(billCreatedAt, boundary)).toBe(true);
  });

  test("bill created exactly AT the closure boundary → true (inclusive, still part of the closed window)", () => {
    const boundary = new Date("2026-07-01T12:00:00Z");
    expect(isBeforeClosureBoundary(boundary, boundary)).toBe(true);
  });

  test("bill created strictly after the closure boundary → false (belongs to the open window)", () => {
    const boundary = new Date("2026-07-01T12:00:00Z");
    const billCreatedAt = new Date("2026-07-01T12:00:01Z");
    expect(isBeforeClosureBoundary(billCreatedAt, boundary)).toBe(false);
  });

  test("refund on today's own bill (created after the most recent close) never warns", () => {
    const boundary = new Date("2026-06-30T18:00:00Z"); // yesterday's close
    const billCreatedToday = new Date("2026-07-01T10:00:00Z");
    expect(isBeforeClosureBoundary(billCreatedToday, boundary)).toBe(false);
  });
});
