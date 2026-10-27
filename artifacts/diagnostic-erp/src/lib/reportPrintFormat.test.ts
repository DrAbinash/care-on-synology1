import { describe, expect, it } from "vitest";
import {
  MAX_PRINT_FORMAT_STEPS,
  NO_PRINT_FORMAT_ADJUSTMENT,
  adjustPrintFormat,
  adjustmentForReport,
  formatReportKey,
  hasPrintFormatAdjustment,
  printFormatQuery,
} from "./reportPrintFormat";

describe("adjustPrintFormat — relative, clamped, one field at a time", () => {
  it("steps from the Settings default, which is zero", () => {
    expect(adjustPrintFormat(NO_PRINT_FORMAT_ADJUSTMENT, "fontSize", -1)).toEqual({
      fontSizeSteps: -1,
      spacingSteps: 0,
    });
  });

  it("does not touch the other field", () => {
    const spaced = adjustPrintFormat(NO_PRINT_FORMAT_ADJUSTMENT, "spacing", 2);
    expect(adjustPrintFormat(spaced, "fontSize", -1)).toEqual({ fontSizeSteps: -1, spacingSteps: 2 });
  });

  it("clamps at the same range the server clamps at", () => {
    let a = NO_PRINT_FORMAT_ADJUSTMENT;
    for (let i = 0; i < 12; i++) a = adjustPrintFormat(a, "fontSize", 1);
    expect(a.fontSizeSteps).toBe(MAX_PRINT_FORMAT_STEPS);
    for (let i = 0; i < 12; i++) a = adjustPrintFormat(a, "fontSize", -1);
    expect(a.fontSizeSteps).toBe(-MAX_PRINT_FORMAT_STEPS);
  });

  it("treats a nonsense delta as no change rather than NaN travelling into a URL", () => {
    expect(adjustPrintFormat(NO_PRINT_FORMAT_ADJUSTMENT, "fontSize", Number.NaN).fontSizeSteps).toBe(0);
  });
});

describe("printFormatQuery — an untouched report is fetched by the URL it always had", () => {
  it("adds nothing when there is no adjustment", () => {
    expect(printFormatQuery(NO_PRINT_FORMAT_ADJUSTMENT)).toBe("");
    expect(printFormatQuery(null)).toBe("");
  });

  it("carries both fields, including the untouched one, once anything is adjusted", () => {
    expect(printFormatQuery({ fontSizeSteps: -2, spacingSteps: 0 })).toBe("&fontSizeSteps=-2&spacingSteps=0");
  });

  it("reports whether anything is adjusted, for the toolbar hint", () => {
    expect(hasPrintFormatAdjustment({ fontSizeSteps: 0, spacingSteps: -1 })).toBe(true);
    expect(hasPrintFormatAdjustment({ fontSizeSteps: 0, spacingSteps: 0 })).toBe(false);
  });
});

describe("adjustmentForReport — the adjustment belongs to one report", () => {
  const stored = { key: "report-77", adjustment: { fontSizeSteps: -2, spacingSteps: 1 } };

  it("applies to the report it was made on", () => {
    expect(adjustmentForReport("report-77", stored)).toEqual({ fontSizeSteps: -2, spacingSteps: 1 });
  });

  it("is no adjustment for any other report — the workspace is reused when the next study opens", () => {
    expect(adjustmentForReport("report-78", stored)).toEqual(NO_PRINT_FORMAT_ADJUSTMENT);
    expect(adjustmentForReport(null, stored)).toEqual(NO_PRINT_FORMAT_ADJUSTMENT);
    expect(adjustmentForReport("report-77", null)).toEqual(NO_PRINT_FORMAT_ADJUSTMENT);
  });
});

describe("formatReportKey", () => {
  it("prefers the signed report row, then the draft, then the study", () => {
    expect(formatReportKey({ linkedReportId: 77, draftId: 5, studyId: 9 })).toBe("report-77");
    expect(formatReportKey({ draftId: 5, studyId: 9 })).toBe("draft-5");
    expect(formatReportKey({ studyId: 9 })).toBe("study-9");
    expect(formatReportKey({})).toBeNull();
  });
});
