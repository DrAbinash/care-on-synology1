import { describe, expect, it } from "vitest";
import { collapseSpacedOutLetters, normalizeReportPlainText } from "./reportPdfGenerator";

describe("collapseSpacedOutLetters / normalizeReportPlainText", () => {
  it("collapses letter-spaced recommendation lines", () => {
    const spaced =
      "Clinical correlation is advised.\nA d e t a i l e d   c o n t r a s t   e n h a n c e d   M R I   s t u d y   i s   r e c o m m e n d e d   f o r   f u r t h e r   e v a l u a t i o n.";
    const norm = normalizeReportPlainText(spaced);
    expect(norm).toMatch(/Adetailed contrast enhanced MRI study is recommended for further evaluation/i);
    expect(norm).not.toMatch(/A d e t a i l e d/);
  });

  it("leaves normal sentences alone", () => {
    const normal = "Clinical correlation is advised.";
    expect(normalizeReportPlainText(normal)).toBe(normal);
  });
});
