import { describe, expect, test } from "vitest";
import { formatMwlPersonName } from "./mwlWorklistWriter";

describe("formatMwlPersonName (ERP → modality PN)", () => {
  test("converts Given Family to Family^Given", () => {
    expect(formatMwlPersonName("Abinash Singh")).toBe("Singh^Abinash");
    expect(formatMwlPersonName("Rita Kumar Sharma")).toBe("Sharma^Rita Kumar");
  });

  test("leaves existing caret PN alone", () => {
    expect(formatMwlPersonName("SINGH^ABINASH^^^MD")).toBe("SINGH^ABINASH^^^MD");
  });

  test("anonymous fallback", () => {
    expect(formatMwlPersonName("")).toBe("ANONYMOUS");
    expect(formatMwlPersonName(null)).toBe("ANONYMOUS");
  });
});
