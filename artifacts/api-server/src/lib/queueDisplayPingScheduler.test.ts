import { describe, expect, it } from "vitest";
import { buildPingMessage, selectTopNPerDepartment } from "./queueDisplayPingScheduler";

// The wording here is shared between the real "you're almost up" sweep and
// the settings UI's "send test ping" action (routes/queueDisplaySettings.ts)
// specifically so the two can never drift apart into different copy.

describe("buildPingMessage", () => {
  it("greets by first name when known", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "42", firstName: "Asha" }))
      .toBe("Hi, Asha! You're almost up at USG ROOM — token #42. Please make your way to the waiting area.");
  });

  it("omits the name entirely when unknown", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "42", firstName: null }))
      .toBe("Hi! You're almost up at USG ROOM — token #42. Please make your way to the waiting area.");
  });

  it("falls back to roomKey when roomTitle is unset", () => {
    expect(buildPingMessage({ roomTitle: null, roomKey: "xray", tokenLabel: "7" }))
      .toContain("almost up at xray —");
  });

  it("falls back to roomKey when roomTitle is an empty string", () => {
    expect(buildPingMessage({ roomTitle: "", roomKey: "reception", tokenLabel: "3" }))
      .toContain("almost up at reception —");
  });

  it("accepts a non-numeric token label (used by the test-ping action)", () => {
    expect(buildPingMessage({ roomTitle: "USG ROOM", roomKey: "usg", tokenLabel: "TEST" }))
      .toContain("token #TEST");
  });
});

// Token numbers are sequenced PER DEPARTMENT (its own independent counter,
// its own "now serving" slot — see test-tokens.ts's generateTestToken/​call).
// A room covering more than one department (or none, meaning "every
// department") must rank "almost up" separately per department, not by
// slicing the top N of a list merged and sorted by tokenNo across all of
// them — department A's token #5 and department B's token #2 aren't
// comparable just because 2 < 5.
type Row = { id: number; tokenNo: number; department: string };
const row = (id: number, tokenNo: number, department: string): Row => ({ id, tokenNo, department });

describe("selectTopNPerDepartment", () => {
  it("takes the top N within a single department", () => {
    const waiting = [row(1, 1, "USG"), row(2, 2, "USG"), row(3, 3, "USG")];
    expect(selectTopNPerDepartment(waiting, 2).map((r) => r.id)).toEqual([1, 2]);
  });

  it("BUG SCENARIO: a merged multi-department list ranks each department independently, not by global tokenNo", () => {
    // Department A has 5 waiting patients (tokens 1-5), department B has 2
    // (tokens 1-2) — created in an order where the merged, tokenNo-sorted
    // list interleaves them. The old code took the global top 2 of this
    // list; the fix must return A's [1,2] AND B's [1,2] (4 total), never a
    // merged top-2 that could hide department B's own next-in-line entirely.
    const waiting = [
      row(101, 1, "A"), row(201, 1, "B"),
      row(102, 2, "A"), row(202, 2, "B"),
      row(103, 3, "A"), row(104, 4, "A"), row(105, 5, "A"),
    ];
    const top2 = selectTopNPerDepartment(waiting, 2);
    expect(top2.filter((r) => r.department === "A").map((r) => r.tokenNo)).toEqual([1, 2]);
    expect(top2.filter((r) => r.department === "B").map((r) => r.tokenNo)).toEqual([1, 2]);
    expect(top2).toHaveLength(4);
  });

  it("a department with fewer waiting patients than N returns all of them, no padding", () => {
    const waiting = [row(1, 1, "USG"), row(2, 1, "XRAY"), row(3, 2, "XRAY"), row(4, 3, "XRAY")];
    const top5 = selectTopNPerDepartment(waiting, 5);
    expect(top5.filter((r) => r.department === "USG")).toHaveLength(1);
    expect(top5.filter((r) => r.department === "XRAY")).toHaveLength(3);
  });

  it("preserves each department's relative order from the already-sorted input", () => {
    const waiting = [row(1, 1, "A"), row(2, 1, "B"), row(3, 2, "A"), row(4, 2, "B"), row(5, 3, "A")];
    const top2 = selectTopNPerDepartment(waiting, 2);
    expect(top2.filter((r) => r.department === "A").map((r) => r.id)).toEqual([1, 3]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectTopNPerDepartment([], 2)).toEqual([]);
  });

  it("clamps a non-positive N up to 1 (mirrors the route's own Math.max(1, ...) validation)", () => {
    const waiting = [row(1, 1, "USG"), row(2, 2, "USG")];
    expect(selectTopNPerDepartment(waiting, 0)).toHaveLength(1);
    expect(selectTopNPerDepartment(waiting, -5)).toHaveLength(1);
  });
});
