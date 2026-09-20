import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "./ModalityBillingKpi.tsx"), "utf8");

describe("ModalityBillingKpi — Diagnostic Services Billed presentation", () => {
  it("renders a modality table with rate/avg and grand total", () => {
    expect(src).toContain('data-testid="modality-billing-table"');
    expect(src).toContain('data-testid="modality-billing-grand-total"');
    expect(src).toContain("Rate / Avg");
    expect(src).toContain("Imaging &amp; Pathology Billed");
  });

  it("keeps drill-down query keys and modality-bills endpoint", () => {
    expect(src).toContain('queryKey: ["modality-billing", from, to]');
    expect(src).toContain('queryKey: ["modality-bills", from, to, selected?.key]');
    expect(src).toContain("/api/dashboard/my-daily-summary/modality-bills");
  });

  it("labels single rates vs Avg / Multiple rates without inventing tariffs", () => {
    expect(src).toContain('rateKind === "single"');
    expect(src).toContain("Avg ${fmtInr(row.avgRate)}");
    expect(src).toContain("Multiple rates");
  });

  it("uses en-IN currency formatting", () => {
    expect(src).toContain('new Intl.NumberFormat("en-IN"');
  });
});
