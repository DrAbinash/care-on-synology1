/**
 * Pure unit tests for incremental reporting-studio worklist helpers.
 * Style matches orthancPurge.test.ts (no Express / DB).
 */
import { describe, expect, test } from "vitest";
import {
  WORKLIST_INCREMENTAL_DEFAULT_LIMIT,
  WORKLIST_INCREMENTAL_MAX_LIMIT,
  buildIncrementalResponse,
  isAfterSince,
  isReportingWorklistIncrementalEnabled,
  pageIncrementalRows,
  parseIncrementalQuery,
  parseSinceWatermark,
  parseWorklistCursor,
  parseWorklistLimit,
  rowChangeAt,
  type IncrementalPageResult,
} from "./reportingStudioWorklistIncremental";

describe("isReportingWorklistIncrementalEnabled", () => {
  test("defaults ON when unset", () => {
    expect(isReportingWorklistIncrementalEnabled({})).toBe(true);
  });

  test("off values", () => {
    expect(isReportingWorklistIncrementalEnabled({ REPORTING_WORKLIST_INCREMENTAL: "0" })).toBe(false);
    expect(isReportingWorklistIncrementalEnabled({ REPORTING_WORKLIST_INCREMENTAL: "false" })).toBe(false);
    expect(isReportingWorklistIncrementalEnabled({ REPORTING_WORKLIST_INCREMENTAL: "OFF" })).toBe(false);
  });

  test("on values", () => {
    expect(isReportingWorklistIncrementalEnabled({ REPORTING_WORKLIST_INCREMENTAL: "1" })).toBe(true);
    expect(isReportingWorklistIncrementalEnabled({ REPORTING_WORKLIST_INCREMENTAL: "true" })).toBe(true);
  });
});

describe("parseSinceWatermark", () => {
  test("parses ISO", () => {
    const d = parseSinceWatermark("2026-09-22T12:00:00.000Z");
    expect(d?.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });

  test("parses epoch ms", () => {
    const ms = Date.parse("2026-09-22T12:00:00.000Z");
    expect(parseSinceWatermark(String(ms))?.getTime()).toBe(ms);
  });

  test("parses epoch seconds (10 digits)", () => {
    const sec = Math.floor(Date.parse("2026-09-22T12:00:00.000Z") / 1000);
    expect(parseSinceWatermark(String(sec))?.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });

  test("rejects empty / invalid", () => {
    expect(parseSinceWatermark("")).toBeNull();
    expect(parseSinceWatermark("not-a-date")).toBeNull();
  });
});

describe("parseWorklistLimit / cursor", () => {
  test("default and max clamp", () => {
    expect(parseWorklistLimit(null)).toBe(WORKLIST_INCREMENTAL_DEFAULT_LIMIT);
    expect(parseWorklistLimit("9999")).toBe(WORKLIST_INCREMENTAL_MAX_LIMIT);
    expect(parseWorklistLimit("50")).toBe(50);
  });

  test("cursor must be positive int", () => {
    expect(parseWorklistCursor("12")).toBe(12);
    expect(parseWorklistCursor("0")).toBeNull();
    expect(parseWorklistCursor("abc")).toBeNull();
  });
});

describe("parseIncrementalQuery", () => {
  test("no params → not requested (legacy shape path)", () => {
    const q = parseIncrementalQuery({});
    expect(q.requested).toBe(false);
  });

  test("since alone requests incremental envelope", () => {
    const q = parseIncrementalQuery({ since: "2026-09-22T00:00:00.000Z" });
    expect(q.requested).toBe(true);
    expect(q.since?.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(q.limit).toBe(WORKLIST_INCREMENTAL_DEFAULT_LIMIT);
  });
});

describe("isAfterSince / rowChangeAt", () => {
  const since = new Date("2026-09-22T12:00:00.000Z");

  test("exclusive boundary — equal changeAt excluded", () => {
    expect(
      isAfterSince(
        { updatedAt: new Date("2026-09-22T12:00:00.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
        since,
      ),
    ).toBe(false);
  });

  test("newer updatedAt included", () => {
    expect(
      isAfterSince(
        { updatedAt: new Date("2026-09-22T12:00:00.001Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
        since,
      ),
    ).toBe(true);
  });

  test("falls back to createdAt when updatedAt null", () => {
    expect(rowChangeAt({ updatedAt: null, createdAt: "2026-09-22T13:00:00.000Z" }).toISOString()).toBe(
      "2026-09-22T13:00:00.000Z",
    );
    expect(
      isAfterSince({ updatedAt: null, createdAt: "2026-09-22T13:00:00.000Z" }, since),
    ).toBe(true);
  });
});

describe("pageIncrementalRows", () => {
  test("since returns only rows newer than watermark (boundary excluded)", () => {
    const since = new Date("2026-09-22T12:00:00.000Z");
    const rows = [
      { id: 1, updatedAt: new Date("2026-09-22T11:59:59.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
      { id: 2, updatedAt: new Date("2026-09-22T12:00:00.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
      { id: 3, updatedAt: new Date("2026-09-22T12:00:01.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
      { id: 4, updatedAt: null, createdAt: new Date("2026-09-22T14:00:00.000Z") },
    ];
    const { page } = pageIncrementalRows(rows, { since, cursor: null, limit: 50 });
    expect(page.map((r) => r.id)).toEqual([3, 4]);
  });

  test("cursor pages through >limit rows with no duplicates and no gaps", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      updatedAt: new Date("2026-09-22T15:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    }));
    const since = new Date("2026-09-22T00:00:00.000Z");
    const seen = new Set<number>();
    let cursor: number | null = null;
    let pages = 0;
    for (;;) {
      // Explicit result type breaks TS7022 circular inference through `cursor` ↔ `nextCursor`.
      const { page, nextCursor, truncated }: IncrementalPageResult<(typeof rows)[number]> =
        pageIncrementalRows(rows, {
          since,
          cursor,
          limit: 7,
        });
      pages += 1;
      for (const r of page) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      if (!truncated) {
        expect(nextCursor).toBeNull();
        break;
      }
      expect(nextCursor).toBe(String(page[page.length - 1]!.id));
      cursor = Number(nextCursor);
    }
    expect(pages).toBe(4); // 7+7+7+4
    expect([...seen].sort((a, b) => a - b)).toEqual(rows.map((r) => r.id));
  });

  test("seeded 2,000-row fixture: since+limit path resolves < 500ms", () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      id: i + 1,
      updatedAt: new Date(base + i * 60_000),
      createdAt: new Date(base),
    }));
    // Mid watermark — exclusive, so row id 1001 (i=1000) is excluded; first is 1002.
    const since = new Date(base + 1000 * 60_000);
    const t0 = performance.now();
    const { page, truncated, nextCursor } = pageIncrementalRows(rows, {
      since,
      cursor: null,
      limit: 200,
    });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500);
    expect(page).toHaveLength(200);
    expect(truncated).toBe(true);
    expect(nextCursor).toBe(String(page[page.length - 1]!.id));
    expect(page[0]!.id).toBe(1002);
  });
});

describe("buildIncrementalResponse", () => {
  test("shape", () => {
    const body = buildIncrementalResponse([{ worklistId: "1" }], "9", true, 1_700_000_000_000);
    expect(body).toEqual({
      orders: [{ worklistId: "1" }],
      nextCursor: "9",
      serverTime: 1_700_000_000_000,
      truncated: true,
    });
  });
});
