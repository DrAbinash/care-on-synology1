import { describe, expect, it } from "vitest";
import {
  filterSwapCatalogTests,
  formatSwapCatalogLabel,
  type SwapCatalogTest,
} from "./swapTestCatalog";

const catalog: SwapCatalogTest[] = [
  { id: 1, name: "USG Abdomen", code: "USGABD", price: 1200, isActive: true, category: "USG" },
  { id: 2, name: "X-Ray Chest PA", code: "XRCHEST", price: 400, isActive: true, category: "X-RAY" },
  { id: 3, name: "MRI Brain", code: "MRIBRAIN", price: 8500, isActive: false, category: "MRI" },
  { id: 4, name: "CBC", code: "CBC", price: 350, isActive: true, category: "LAB" },
  { id: 5, name: "Folic Acid / Vit B9", code: "FOLIC", price: 1200, isActive: true },
];

describe("filterSwapCatalogTests", () => {
  it("returns every active test sorted by name (full catalog, not a hard-coded subset)", () => {
    const out = filterSwapCatalogTests(catalog);
    expect(out.map((t) => t.id)).toEqual([4, 5, 1, 2]);
    expect(out.find((t) => t.id === 3)).toBeUndefined();
  });

  it("excludes the test currently on the bill line", () => {
    const out = filterSwapCatalogTests(catalog, { excludeTestId: 1 });
    expect(out.map((t) => t.id)).toEqual([4, 5, 2]);
  });

  it("searches by name and code so any catalog test is selectable", () => {
    expect(filterSwapCatalogTests(catalog, { search: "folic" }).map((t) => t.id)).toEqual([5]);
    expect(filterSwapCatalogTests(catalog, { search: "xrchest" }).map((t) => t.id)).toEqual([2]);
    expect(filterSwapCatalogTests(catalog, { search: "abdomen" }).map((t) => t.id)).toEqual([1]);
  });

  it("returns empty when search misses", () => {
    expect(filterSwapCatalogTests(catalog, { search: "zzzz-nope" })).toEqual([]);
  });
});

describe("formatSwapCatalogLabel", () => {
  it("formats name, code, and price", () => {
    expect(formatSwapCatalogLabel(catalog[0]!)).toBe("USG Abdomen (USGABD) — ₹1200.00");
  });
});
