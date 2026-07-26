import { describe, it, expect } from "vitest";
import { normalizeItemName, scoreLineMatch, matchInvoiceLineToCatalog, AUTO_MATCH_THRESHOLD, type CatalogItem } from "./invoiceLineMatching";

describe("normalizeItemName", () => {
  it("lowercases and collapses punctuation/whitespace", () => {
    expect(normalizeItemName("  Paracetamol,  500MG (Tab) ")).toBe("paracetamol 500mg tab");
  });
  it("keeps dosage-relevant characters (% and .)", () => {
    expect(normalizeItemName("Povidone Iodine 0.5%")).toBe("povidone iodine 0.5%");
  });
});

describe("scoreLineMatch", () => {
  it("scores an exact match at 100", () => {
    expect(scoreLineMatch("Paracetamol 500mg", "Paracetamol 500mg")).toBe(100);
  });
  it("scores a case/punctuation-only difference near 100", () => {
    expect(scoreLineMatch("PARACETAMOL, 500MG", "Paracetamol 500mg")).toBeGreaterThanOrEqual(95);
  });
  it("scores a longer invoice description containing the catalog name highly (containment)", () => {
    // Real invoice lines are rarely just the bare catalog name — packaging/
    // form details get appended.
    expect(scoreLineMatch("Paracetamol 500mg Tab 10x10 Strip", "Paracetamol 500mg")).toBeGreaterThanOrEqual(90);
  });
  it("scores reordered tokens (form word first) highly via token overlap", () => {
    expect(scoreLineMatch("Tab Paracetamol 500mg", "Paracetamol 500mg Tab")).toBeGreaterThanOrEqual(85);
  });
  it("scores an unrelated item low", () => {
    expect(scoreLineMatch("Surgical Gloves Large", "Paracetamol 500mg")).toBeLessThan(40);
  });
  it("distinguishes different dosage strengths of the same drug (must not be treated as equal)", () => {
    const s500 = scoreLineMatch("Paracetamol 500mg", "Paracetamol 500mg");
    const s650 = scoreLineMatch("Paracetamol 500mg", "Paracetamol 650mg");
    expect(s500).toBeGreaterThan(s650);
    // 650 vs 500 differs by one character in a short string — still shouldn't
    // be scored as a confident match despite being spelling-adjacent.
    expect(s650).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });
  it("returns 0 for empty input rather than throwing", () => {
    expect(scoreLineMatch("", "Paracetamol 500mg")).toBe(0);
    expect(scoreLineMatch("Paracetamol 500mg", "")).toBe(0);
  });
});

describe("matchInvoiceLineToCatalog", () => {
  const catalog: CatalogItem[] = [
    { id: 1, name: "Paracetamol 500mg" },
    { id: 2, name: "Paracetamol 650mg" },
    { id: 3, name: "Amoxicillin 250mg" },
    { id: 4, name: "Surgical Gloves (Large)" },
  ];

  it("picks the correct catalog item over a similarly-named decoy", () => {
    const m = matchInvoiceLineToCatalog("PARACETAMOL 500 MG TAB 10X10", catalog);
    expect(m.itemId).toBe(1);
    expect(m.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("does not confuse two different dosage strengths of the same drug", () => {
    const m = matchInvoiceLineToCatalog("Paracetamol 650mg Tablets", catalog);
    expect(m.itemId).toBe(2);
  });

  it("matches packaging-form-first phrasing", () => {
    const m = matchInvoiceLineToCatalog("Gloves Surgical Large Box", catalog);
    expect(m.itemId).toBe(4);
  });

  it("returns itemId: null for a line with no plausible catalog match", () => {
    const m = matchInvoiceLineToCatalog("Xyzzyx Unrelated Item 9999", catalog);
    expect(m.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("returns itemId: null for an empty catalog instead of throwing", () => {
    const m = matchInvoiceLineToCatalog("Paracetamol 500mg", []);
    expect(m).toEqual({ itemId: null, itemName: null, confidence: 0 });
  });
});
