import { describe, it, expect } from "vitest";
import { parseInvoiceText, normalizeInvoiceDate } from "./invoiceTextParser";

describe("parseInvoiceText — real Tesseract output", () => {
  // This is the EXACT, verbatim stdout of tesseract.js's recognize() run
  // against a synthetic invoice PNG in a throwaway Node sandbox (local
  // eng.traineddata, no CDN) — not a hand-typed approximation. That run is
  // what caught two real bugs this test guards against: the GST regex
  // originally captured "18" from "(18%)" instead of the actual amount, and
  // a naive strip-all-numbers approach mangled "500mg"/"10x10" out of the
  // line-item descriptions.
  const REAL_TESSERACT_OUTPUT = `Apex Pharma Distributors

123 Industrial Area, Mumbai, MH 400001
GSTIN: 27AAAAA0000A1Z5

TAX INVOICE

Invoice No: INV-2026-0417

Invoice Date: 20-07-2026

Vendor Code: V-1023

Description Qty Rate Amount
Paracetamol 500mg Tab 10x10 50 20.00 1000.00
Amoxicillin 250mg Cap 10x10 35 100.00 3500.00
Subtotal: 4500.00

GST (18%): 810.00
Grand Total: 5310.00`;

  it("extracts every header field correctly", () => {
    const r = parseInvoiceText(REAL_TESSERACT_OUTPUT);
    expect(r.vendor).toBe("Apex Pharma Distributors");
    expect(r.invoiceNumber).toBe("INV-2026-0417");
    expect(r.date).toBe("2026-07-20");
    expect(r.subtotal).toBe(4500);
    expect(r.totalAmount).toBe(5310);
  });

  it("captures the GST amount, not the percentage inside the parenthetical", () => {
    // The bug this guards: "GST (18%): 810.00" naively captured "18".
    const r = parseInvoiceText(REAL_TESSERACT_OUTPUT);
    expect(r.gstAmount).toBe(810);
  });

  it("extracts both line items with clean descriptions (dosage/packaging preserved)", () => {
    // The bug this guards: stripping every digit from the line also erased
    // "500mg" and "10x10" from the description, leaving "Paracetamol mg Tab x".
    const r = parseInvoiceText(REAL_TESSERACT_OUTPUT);
    expect(r.lineItems).toEqual([
      { description: "Paracetamol 500mg Tab 10x10", quantity: 50, unitCost: 20, lineTotal: 1000 },
      { description: "Amoxicillin 250mg Cap 10x10", quantity: 35, unitCost: 100, lineTotal: 3500 },
    ]);
  });
});

describe("parseInvoiceText — additional formats", () => {
  it("handles comma-separated thousands in amounts", () => {
    const text = `Global Distributors\nInvoice No: GD-991\nInvoice Date: 05-01-2026\nGrand Total: 12,450.50`;
    const r = parseInvoiceText(text);
    expect(r.totalAmount).toBe(12450.5);
  });

  it("returns an empty line-item list (not a throw) when no item table is present", () => {
    const text = `Some Vendor\nInvoice No: X-1\nInvoice Date: 01-01-2026\nGrand Total: 500`;
    const r = parseInvoiceText(text);
    expect(r.lineItems).toEqual([]);
  });

  it("falls back to 'Total Payable' wording when there's no 'Grand Total'", () => {
    const text = `Vendor Co\nInvoice No: V-1\nTotal Payable: 999.99`;
    const r = parseInvoiceText(text);
    expect(r.totalAmount).toBe(999.99);
  });

  it("does not mistake 'Subtotal' for a 'Total' match", () => {
    // \btotal\b must not fire on "subtotal" — verified by giving it as the
    // ONLY total-like line and confirming totalAmount stays 0.
    const text = `Vendor Co\nInvoice No: V-1\nSubtotal: 100.00`;
    const r = parseInvoiceText(text);
    expect(r.subtotal).toBe(100);
    expect(r.totalAmount).toBe(0);
  });

  it("handles a 2-column line item (qty + amount, no separate rate) by deriving unit cost", () => {
    const text = `Vendor\nDescription Qty Amount\nGauze Roll 10 250.00\nGrand Total: 250.00`;
    const r = parseInvoiceText(text);
    expect(r.lineItems).toEqual([{ description: "Gauze Roll", quantity: 10, unitCost: 25, lineTotal: 250 }]);
  });

  it("stops collecting line items at the Subtotal row, not past it", () => {
    const text = `Vendor\nDescription Qty Rate Amount\nItem A 1 10.00 10.00\nItem B 2 5.00 10.00\nSubtotal: 20.00\nGrand Total: 20.00`;
    const r = parseInvoiceText(text);
    expect(r.lineItems).toHaveLength(2);
  });

  it("skips the vendor line if OCR put a generic document title first", () => {
    const text = `TAX INVOICE\nReal Vendor Name\nInvoice No: X-1`;
    const r = parseInvoiceText(text);
    expect(r.vendor).toBe("Real Vendor Name");
  });

  it("returns empty fields (not throw) on garbage/unrecognizable input", () => {
    const r = parseInvoiceText("asdf qwer 1234 zxcv");
    expect(r.invoiceNumber).toBe("");
    expect(r.date).toBe("");
    expect(r.totalAmount).toBe(0);
    expect(r.lineItems).toEqual([]);
  });

  it("returns empty fields on a completely empty string", () => {
    const r = parseInvoiceText("");
    expect(r.vendor).toBe("");
    expect(r.lineItems).toEqual([]);
  });
});

describe("normalizeInvoiceDate", () => {
  it("passes through an already-ISO date", () => {
    expect(normalizeInvoiceDate("2026-07-20")).toBe("2026-07-20");
  });
  it("converts DD-MM-YYYY (Indian convention) to YYYY-MM-DD", () => {
    expect(normalizeInvoiceDate("20-07-2026")).toBe("2026-07-20");
  });
  it("converts DD/MM/YYYY with slashes", () => {
    expect(normalizeInvoiceDate("05/01/2026")).toBe("2026-01-05");
  });
  it("expands a 2-digit year to 20YY", () => {
    expect(normalizeInvoiceDate("05-01-26")).toBe("2026-01-05");
  });
  it("rejects an impossible day/month instead of guessing", () => {
    expect(normalizeInvoiceDate("35-13-2026")).toBe("");
  });
  it("returns empty string for unparseable input", () => {
    expect(normalizeInvoiceDate("not a date")).toBe("");
  });
});
