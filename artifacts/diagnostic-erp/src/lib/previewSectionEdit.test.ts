import { describe, expect, it } from "vitest";
import { previewHeadingToSection } from "./previewSectionEdit";

describe("previewHeadingToSection", () => {
  it("maps preview headings to editor sections", () => {
    expect(previewHeadingToSection("Clinical History")).toBe("history");
    expect(previewHeadingToSection("TECHNIQUE")).toBe("technique");
    expect(previewHeadingToSection("Findings / Observation")).toBe("findings");
    expect(previewHeadingToSection("Impression")).toBe("impression");
    expect(previewHeadingToSection("Recommendation")).toBe("recommendation");
  });

  it("returns null for unknown headings", () => {
    expect(previewHeadingToSection("Key Images")).toBeNull();
    expect(previewHeadingToSection("")).toBeNull();
  });
});
