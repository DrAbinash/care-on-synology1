import { describe, expect, it } from "vitest";
import { formatBillToScanGap } from "./billToScanGap";

describe("formatBillToScanGap", () => {
  it("describes a bill raised before the study arrived", () => {
    expect(formatBillToScanGap(14)).toBe("bill raised 14 min before scan");
    expect(formatBillToScanGap(0)).toBe("bill raised 0 min before scan");
    expect(formatBillToScanGap(510)).toBe("bill raised 8 h 30 min before scan");
    expect(formatBillToScanGap(2880)).toBe("bill raised 2 days before scan");
  });

  it("says after-scan when the desk raised the bill later", () => {
    expect(formatBillToScanGap(-25)).toBe("bill raised 25 min after scan");
  });

  it("stays silent when timing is unknown", () => {
    expect(formatBillToScanGap(null)).toBeNull();
    expect(formatBillToScanGap(undefined)).toBeNull();
    expect(formatBillToScanGap(Number.NaN)).toBeNull();
  });
});
