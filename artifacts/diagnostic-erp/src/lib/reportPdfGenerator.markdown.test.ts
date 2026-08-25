import { describe, expect, it } from "vitest";
import { normalizeReportPlainText } from "./reportPdfGenerator";

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
