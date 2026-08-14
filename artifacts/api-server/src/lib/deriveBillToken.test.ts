import { describe, expect, test } from "vitest";
import { deriveBillTokenFromTestTokens } from "./deriveBillToken";

describe("deriveBillTokenFromTestTokens", () => {
  test("returns null for empty list", () => {
    expect(deriveBillTokenFromTestTokens([])).toBeNull();
  });

  test("uses minimum token number across departments", () => {
    const result = deriveBillTokenFromTestTokens([
      { tokenNo: 12 },
      { tokenNo: 3 },
      { tokenNo: 8 },
    ], "2026-08-13");
    expect(result).toEqual({ tokenNo: 3, tokenDate: "2026-08-13" });
  });

  test("defaults tokenDate to today when omitted", () => {
    const result = deriveBillTokenFromTestTokens([{ tokenNo: 5 }]);
    expect(result?.tokenNo).toBe(5);
    expect(result?.tokenDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
