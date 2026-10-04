import { describe, expect, it } from "vitest";
import { normalizeReportPlainText, parseInlineMarkdown } from "./reportPdfGenerator";

describe("normalizeReportPlainText", () => {
  it("maps unicode slash lookalikes to ASCII /", () => {
    expect(normalizeReportPlainText("s\u2215o")).toBe("s/o");
    expect(normalizeReportPlainText("s\u2044o")).toBe("s/o");
    expect(normalizeReportPlainText("s\uFF0Fo")).toBe("s/o");
  });

  it("preserves existing ASCII s/o", () => {
    expect(normalizeReportPlainText("s/o disc bulge")).toBe("s/o disc bulge");
  });
});

describe("parseInlineMarkdown — the PDF half of the abnormal colour", () => {
  it("draws a plain line in regular weight", () => {
    expect(parseInlineMarkdown("Normal lumbar lordosis.")).toEqual([
      { text: "Normal lumbar lordosis.", bold: false },
    ]);
  });

  it("draws a whole abnormal line bold", () => {
    expect(parseInlineMarkdown("Mild canal stenosis L4-L5.", true)).toEqual([
      { text: "Mild canal stenosis L4-L5.", bold: true },
    ]);
  });

  it("still lets an explicit markdown span carry its own weight", () => {
    expect(parseInlineMarkdown("Disc bulge with **no** canal stenosis.")).toEqual([
      { text: "Disc bulge with ", bold: false },
      { text: "no", bold: true },
      { text: " canal stenosis.", bold: false },
    ]);
  });

  it("does not turn markdown into reportable text", () => {
    // The markers are presentation and must not survive into the drawn glyphs.
    const segs = parseInlineMarkdown("Acute **infarct** seen.");
    expect(segs.map((s) => s.text).join("")).toBe("Acute infarct seen.");
  });
});
