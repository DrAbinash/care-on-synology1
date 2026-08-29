import { describe, expect, test } from "vitest";
import {
  DEFAULT_QUICK_SELECT_IDS,
  isValidQuickSelectIds,
  normalizeQuickSelectIdsJson,
  QUICK_SELECT_SLOT_COUNT,
} from "./quickSelectSlots";

describe("quickSelectSlots (API)", () => {
  test("accepts legacy 8 and new 12 slot payloads", () => {
    expect(isValidQuickSelectIds(JSON.stringify(Array(8).fill(null)))).toBe(true);
    expect(isValidQuickSelectIds(JSON.stringify(Array(12).fill(null)))).toBe(true);
    expect(isValidQuickSelectIds(JSON.stringify(Array(2).fill(1)))).toBe(false);
  });

  test("normalizes 8 → 12 so clients always get three rows", () => {
    const normalized = normalizeQuickSelectIdsJson(
      JSON.stringify([7, null, null, null, null, null, null, null]),
    );
    const parsed = JSON.parse(normalized);
    expect(parsed).toHaveLength(QUICK_SELECT_SLOT_COUNT);
    expect(parsed[0]).toBe(7);
    expect(parsed[11]).toBeNull();
  });

  test("default is twelve nulls", () => {
    expect(JSON.parse(DEFAULT_QUICK_SELECT_IDS)).toHaveLength(12);
  });
});
