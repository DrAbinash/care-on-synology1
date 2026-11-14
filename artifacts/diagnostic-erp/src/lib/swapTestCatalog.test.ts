import { describe, expect, it } from "vitest";
import {
  filterSwapCatalogTests,
  formatSwapCatalogLabel,
  swapStudySyncMessage,
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

describe("swapStudySyncMessage — the desk is told what happened to the examination", () => {
  it("names the modality and department when the booking followed the bill", () => {
    const m = swapStudySyncMessage({
      status: "synced",
      accessionNumber: "ACC-20261113-CR-014",
      modality: "CR",
      department: "X-Ray",
      studyDescriptionOutcome: "synced",
    });
    expect(m.title).toBe("Test and booked examination replaced");
    expect(m.description).toContain("ACC-20261113-CR-014");
    expect(m.description).toContain("CR");
    expect(m.description).toContain("X-Ray");
    expect(m.description).toContain("worklist was re-published");
    expect(m.variant).toBeUndefined();
  });

  it("says so when the typed description was kept instead of overwritten", () => {
    const m = swapStudySyncMessage({
      status: "synced",
      accessionNumber: "ACC-1",
      modality: "CR",
      department: "X-Ray",
      studyDescriptionOutcome: "kept_manual",
    });
    expect(m.description).toContain("Your own description was kept");
  });

  it("announces a study the corrected line never had", () => {
    const m = swapStudySyncMessage({ status: "study_created", accessions: ["ACC-2", "ACC-3"] });
    expect(m.description).toContain("ACC-2, ACC-3");
    expect(m.description).toContain("radiology examination");
  });

  it("warns, in destructive terms, when the machine is still scheduled", () => {
    const m = swapStudySyncMessage({
      status: "booking_stale",
      accessionNumber: "ACC-9",
      bookedAs: "USG Abdomen",
    });
    expect(m.title).toContain("still booked");
    expect(m.description).toContain("USG Abdomen");
    expect(m.description).toContain("Cancel that test");
  });

  it("says so when a study started after the bill was already correct", () => {
    const m = swapStudySyncMessage({ status: "blocked", accessionNumber: "ACC-7", reason: "acquired" });
    expect(m.title).toContain("left alone");
    expect(m.description).toContain("ACC-7");
    expect(m.description).toContain("has already been started or imaged");
    expect(m.description).toContain("refund/adjustment");
    expect(m.variant).toBe("destructive");

    const closed = swapStudySyncMessage({ status: "blocked", accessionNumber: "ACC-8", reason: "terminal" });
    expect(closed.description).toContain("is already closed");
  });

  it("does not report a failed synchronisation as a clean swap", () => {
    const m = swapStudySyncMessage({ status: "failed", error: "relation radiology_studies does not exist" });
    expect(m.variant).toBe("destructive");
    expect(m.description).toContain("relation radiology_studies does not exist");
    expect(m.description).toContain("The invoice is right");
  });

  it("keeps the old wording when there was no examination to move", () => {
    for (const sync of [undefined, null, { status: "not_radiology" }, { status: "no_study" }]) {
      const m = swapStudySyncMessage(sync);
      expect(m.title).toBe("Test replaced");
      expect(m.description).toBe("The test was changed and bill totals recalculated.");
    }
  });
});
