import { describe, expect, test } from "vitest";
import { classifyModality } from "./referralModality";

describe("classifyModality", () => {
  test("maps common radiology categories", () => {
    expect(classifyModality("Ultrasound", "USG WHOLE ABDOMEN")).toBe("USG");
    expect(classifyModality("MRI", "MRI BRAIN")).toBe("MRI");
    expect(classifyModality("CT Scan", "CECT ABDOMEN")).toBe("CT");
    expect(classifyModality("X-Ray", "CHEST PA")).toBe("X-Ray");
    expect(classifyModality("Pathology", "LFT")).toBe("Other");
  });
});
