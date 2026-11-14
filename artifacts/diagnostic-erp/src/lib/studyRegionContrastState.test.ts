import { describe, it, expect } from "vitest";
import { assertedContrastState } from "./studyRegion";

/**
 * The contrast reader the Study Tab matcher uses. `contrastStateOfField` in
 * `@workspace/report-quality/text/clinicalTerms.ts` is the vocabulary the Quick
 * Select contrast gate, the Technique-contradiction warning and the sign-time
 * conflict check already answer with; this adds only the one reading a Study Tab
 * name needs and that prose does not ("CT Brain Contrast", active tab id 58).
 */
describe("assertedContrastState", () => {
  it("is denial-first, so a name that mentions contrast can still say plain", () => {
    expect(assertedContrastState("MRI BRAIN WITHOUT CONTRAST")).toBe("plain");
    expect(assertedContrastState("CT BRAIN NON CONTRAST")).toBe("plain");
    expect(assertedContrastState("NCCT HEAD")).toBe("plain");
    expect(assertedContrastState("MRI CERVICAL SPINE (PLAIN)")).toBe("plain");
  });

  it("reads the bare qualifier a Study Tab is named with", () => {
    expect(assertedContrastState("CT Brain Contrast")).toBe("contrast");
    expect(assertedContrastState("CECT ABDOMEN")).toBe("contrast");
    expect(assertedContrastState("CT BRAIN WITH CONTRAST")).toBe("contrast");
  });

  it("keeps the two-phase reading, and stays silent when the name is", () => {
    expect(assertedContrastState("CT BRAIN WITH AND WITHOUT CONTRAST")).toBe("both");
    expect(assertedContrastState("CT BRAIN")).toBe("unknown");
    expect(assertedContrastState(null)).toBe("unknown");
  });
});
