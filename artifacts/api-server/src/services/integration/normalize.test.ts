import { describe, it, expect } from "vitest";
import { normalizeName, normalizePhone, normalizeTestName, splitName, approximateDobFromAge } from "./normalize";

describe("normalizeName", () => {
  it("lowercases, strips honorifics and collapses whitespace", () => {
    expect(normalizeName("Dr. Rajesh  Kumar")).toBe("rajesh kumar");
    expect(normalizeName("MRS. Sunita Devi")).toBe("sunita devi");
    expect(normalizeName("  Master  Aarav ")).toBe("aarav");
  });
  it("is stable across punctuation", () => {
    expect(normalizeName("Rajesh-Kumar")).toBe(normalizeName("Rajesh Kumar"));
  });
  it("handles empty/nullish", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("normalizePhone", () => {
  it("reduces to the 10-digit core", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("098765-43210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });
  it("treats +91 and bare numbers as the same identity", () => {
    expect(normalizePhone("+919876543210")).toBe(normalizePhone("9876543210"));
  });
  it("handles empty/nullish", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("normalizeTestName", () => {
  it("normalizes punctuation and case for catalogue matching", () => {
    expect(normalizeTestName("USG - Whole Abdomen")).toBe("usg whole abdomen");
    expect(normalizeTestName("CBC (Complete Blood Count)")).toBe("cbc complete blood count");
    expect(normalizeTestName("LFT")).toBe("lft");
  });
});

describe("splitName", () => {
  it("splits into first/last on the first space", () => {
    expect(splitName("Rajesh Kumar")).toEqual({ firstName: "Rajesh", lastName: "Kumar" });
    expect(splitName("Sunita Devi Sharma")).toEqual({ firstName: "Sunita", lastName: "Devi Sharma" });
  });
  it("drops a leading honorific", () => {
    expect(splitName("Dr. Rajesh Kumar")).toEqual({ firstName: "Rajesh", lastName: "Kumar" });
  });
  it("single token → lastName empty", () => {
    expect(splitName("Aarav")).toEqual({ firstName: "Aarav", lastName: "" });
  });
  it("blank → Unknown", () => {
    expect(splitName("")).toEqual({ firstName: "Unknown", lastName: "" });
  });
});

describe("approximateDobFromAge", () => {
  const now = new Date("2026-07-22T00:00:00Z");
  it("derives Jan-1 of the birth year from a years age", () => {
    expect(approximateDobFromAge(34, "years", now)).toBe("1992-01-01");
  });
  it("handles months and days units", () => {
    expect(approximateDobFromAge(24, "months", now)).toBe("2024-01-01");
    expect(approximateDobFromAge(400, "days", now)).toBe("2025-01-01");
  });
  it("returns a clear sentinel for unknown age", () => {
    expect(approximateDobFromAge(null, "years", now)).toBe("1900-01-01");
    expect(approximateDobFromAge(-3, "years", now)).toBe("1900-01-01");
  });
});
