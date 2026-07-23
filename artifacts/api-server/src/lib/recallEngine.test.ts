import { describe, expect, test } from "vitest";
import { computeDueDate, matchRule, isRecallDue, composeRecallMessage, istDateOnly } from "./recallEngine";

describe("computeDueDate", () => {
  test("adds interval days and returns IST YYYY-MM-DD", () => {
    // 2026-01-01T00:00:00Z + 30d → 2026-01-31 (IST)
    expect(computeDueDate("2026-01-01T00:00:00Z", 30)).toBe("2026-01-31");
  });
  test("interval 0 → same IST day", () => {
    expect(computeDueDate("2026-03-10T06:00:00Z", 0)).toBe("2026-03-10");
  });
  test("negative interval clamps to 0", () => {
    expect(computeDueDate("2026-03-10T06:00:00Z", -5)).toBe("2026-03-10");
  });
});

describe("matchRule", () => {
  test("'all' matches any report", () => {
    expect(matchRule({ testName: "anything" }, { matchType: "all", matchValue: null })).toBe(true);
    expect(matchRule({ testName: null }, { matchType: "all", matchValue: null })).toBe(true);
  });
  test("'test' matches by case-insensitive substring of the title", () => {
    expect(matchRule({ testName: "USG Whole Abdomen" }, { matchType: "test", matchValue: "usg" })).toBe(true);
    expect(matchRule({ testName: "CBC" }, { matchType: "test", matchValue: "usg" })).toBe(false);
  });
  test("'test' with empty matchValue never matches", () => {
    expect(matchRule({ testName: "USG" }, { matchType: "test", matchValue: "" })).toBe(false);
  });
  test("unknown matchType never matches", () => {
    expect(matchRule({ testName: "USG" }, { matchType: "category", matchValue: "x" })).toBe(false);
  });
});

describe("isRecallDue", () => {
  test("due when dueDate <= today", () => {
    expect(isRecallDue("2026-01-01", "2026-01-01")).toBe(true);
    expect(isRecallDue("2025-12-31", "2026-01-01")).toBe(true);
    expect(isRecallDue("2026-01-02", "2026-01-01")).toBe(false);
  });
});

describe("composeRecallMessage", () => {
  test("substitutes placeholders", () => {
    expect(composeRecallMessage("Hi {{name}}, {{testName}} in {{days}}d", { name: "Asha", testName: "USG", days: 180 }))
      .toBe("Hi Asha, USG in 180d");
  });
  test("falls back to a default when template blank", () => {
    const msg = composeRecallMessage("", { name: "Asha", testName: "USG", days: 180 });
    expect(msg).toContain("Asha");
    expect(msg).toContain("USG");
  });
});

describe("istDateOnly", () => {
  test("formats an ISO string to an IST calendar date", () => {
    // 2026-01-01T20:00:00Z is 2026-01-02 01:30 IST → 2026-01-02
    expect(istDateOnly("2026-01-01T20:00:00Z")).toBe("2026-01-02");
  });
});
