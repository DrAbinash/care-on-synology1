import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QUICK_SELECT_GRID_CLASS,
  QUICK_SELECT_SLOT_COUNT,
  parseQuickSelectIds,
} from "./quickSelectSlots";

describe("quickSelectSlots", () => {
  it("pads legacy 8-slot layouts to 12 (three rows of four)", () => {
    const ids = parseQuickSelectIds(JSON.stringify([1, 2, null, null, null, null, null, null]));
    expect(ids).toHaveLength(QUICK_SELECT_SLOT_COUNT);
    expect(ids.slice(0, 2)).toEqual([1, 2]);
    expect(ids.slice(8)).toEqual([null, null, null, null]);
  });

  it("uses a 4-column grid class so 12 slots render as three rows", () => {
    expect(QUICK_SELECT_GRID_CLASS).toContain("sm:grid-cols-4");
    expect(QUICK_SELECT_SLOT_COUNT).toBe(12);
  });
});

describe("NewOnlineBookingDialog quick-select UI contract", () => {
  const src = readFileSync(
    resolve(__dirname, "../pages/NewOnlineBookingDialog.tsx"),
    "utf8",
  );

  it("renders editable 12-slot grids with pencil editors for doctors and investigations", () => {
    expect(src).toContain('data-testid="booking-quick-doctors"');
    expect(src).toContain('data-testid="booking-quick-tests"');
    expect(src).toContain("QUICK_SELECT_GRID_CLASS");
    expect(src).toContain("<Pencil");
    expect(src).toContain("assignQuickDoctorSlot");
    expect(src).toContain("assignQuickTestSlot");
    expect(src).toContain("/api/my/quick-doctors");
    expect(src).toContain("quickTestIds");
  });
});
