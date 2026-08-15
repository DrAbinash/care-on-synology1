import { describe, expect, test } from "vitest";
import { buildFormFPrintHtml } from "./formFPrintHtml";

describe("buildFormFPrintHtml", () => {
  test("uses full A4 portrait @page (210×297 mm)", () => {
    const html = buildFormFPrintHtml('<div id="formf-print">FORM F</div>');
    expect(html).toContain("@page { size: 210mm 297mm; margin: 0; }");
    expect(html).toContain("height: 297mm");
    expect(html).not.toContain("height: 148mm");
    expect(html).toContain('id="formf-print"');
    expect(html).toContain("FORM F");
  });

  test("locks body and form root to full A4 width", () => {
    const html = buildFormFPrintHtml("<div></div>");
    expect(html).toContain("width: 210mm");
    expect(html).toContain("max-width: 210mm");
    expect(html).toContain("min-height: 297mm");
  });
});
