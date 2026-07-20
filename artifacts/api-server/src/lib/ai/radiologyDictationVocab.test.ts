import { describe, it, expect } from "vitest";
import { normalizeDictation, isPolishSafe } from "./radiologyDictationVocab";

describe("normalizeDictation", () => {
  it("canonicalises radiology acronym casing on word boundaries", () => {
    expect(normalizeDictation("t2w and flair hyperintense signal")).toBe("T2W and FLAIR hyperintense signal");
    expect(normalizeDictation("efw is on the ac and bpd")).toBe("EFW is on the AC and BPD");
  });

  it("does not touch acronym letters embedded inside ordinary words", () => {
    // "ct" only converts as a standalone token, not inside "octopus"/"reference".
    expect(normalizeDictation("reference octopus")).toBe("reference octopus");
  });

  it("normalises spoken units, decimals and dimensions", () => {
    expect(normalizeDictation("lesion measures 3 point 5 millimeters")).toBe("lesion measures 3.5 mm");
    expect(normalizeDictation("cyst 3 by 4 centimeters")).toBe("cyst 3 x 4 cm");
  });

  it("fixes split compound terms without altering meaning", () => {
    expect(normalizeDictation("hyper intense and hypo echoic")).toBe("hyperintense and hypoechoic");
  });

  it("leaves ordinary 'by' usage alone (only number-by-number becomes x)", () => {
    expect(normalizeDictation("increased by contrast")).toBe("increased by contrast");
  });
});

describe("isPolishSafe (clinical safety gate)", () => {
  const base = "no focal lesion in the left lobe measuring 3.5 cm";

  it("accepts pure punctuation/casing changes", () => {
    expect(isPolishSafe(base, "No focal lesion in the left lobe, measuring 3.5 cm.")).toBe(true);
  });

  it("rejects any change to a measurement", () => {
    expect(isPolishSafe(base, "No focal lesion in the left lobe measuring 3.6 cm.")).toBe(false);
    expect(isPolishSafe(base, "No focal lesion in the left lobe measuring 35 cm.")).toBe(false);
  });

  it("rejects a flipped laterality", () => {
    expect(isPolishSafe(base, "No focal lesion in the right lobe measuring 3.5 cm.")).toBe(false);
  });

  it("rejects a dropped negation", () => {
    expect(isPolishSafe(base, "Focal lesion in the left lobe measuring 3.5 cm.")).toBe(false);
  });

  it("rejects empty output and wholesale rewrites", () => {
    expect(isPolishSafe(base, "")).toBe(false);
    expect(isPolishSafe(base, "no")).toBe(false);
  });
});
