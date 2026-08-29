import { describe, expect, it } from "vitest";
import { expenseDrawerOwner } from "./expenseCashAttribution";

describe("expenseDrawerOwner — cash drawer attribution", () => {
  it("prefers approved_by when present", () => {
    expect(expenseDrawerOwner("Alice", "Bob")).toBe("Alice");
    expect(expenseDrawerOwner("  Alice  ", "Bob")).toBe("Alice");
  });

  it("falls back to created_by when approved_by is blank (legacy Expense create)", () => {
    expect(expenseDrawerOwner(null, "Dr Abinash Kumar")).toBe("Dr Abinash Kumar");
    expect(expenseDrawerOwner("", "Dr Abinash Kumar")).toBe("Dr Abinash Kumar");
    expect(expenseDrawerOwner("   ", "Vijay Yadav")).toBe("Vijay Yadav");
  });

  it("returns null when neither side is set", () => {
    expect(expenseDrawerOwner(null, null)).toBe(null);
    expect(expenseDrawerOwner("", "  ")).toBe(null);
  });
});
