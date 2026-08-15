import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("BillingPeakMonitor UI", () => {
  const src = readFileSync(new URL("./BillingPeakMonitor.tsx", import.meta.url), "utf8");

  test("polls slowly and offers PHI-free copy snapshot", () => {
    expect(src).toContain("refetchInterval: 45_000");
    expect(src).toContain('data-testid="billing-peak-monitor"');
    expect(src).toContain("Copy Performance Snapshot");
    expect(src).toContain("/api/admin/billing-performance");
    expect(src).not.toMatch(/patientName|studyInstanceUID|phone/);
  });
});
