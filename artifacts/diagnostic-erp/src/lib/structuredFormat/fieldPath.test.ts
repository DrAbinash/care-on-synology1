import { describe, expect, it } from "vitest";
import { parseFieldPath, serializeFieldPath, fieldPathEquals, isFieldPathKey } from "./fieldPath";

describe("FieldPath utility", () => {
  it("serializes without a group item", () => {
    expect(serializeFieldPath({ sectionId: "discs", fieldId: "morphology" })).toBe("discs::morphology");
  });

  it("serializes with a group item", () => {
    expect(serializeFieldPath({ sectionId: "discs", groupItemId: "l4-5", fieldId: "morphology" }))
      .toBe("discs::l4-5::morphology");
  });

  it("parses both shapes and round-trips", () => {
    const a = { sectionId: "discs", fieldId: "morphology" };
    const b = { sectionId: "discs", groupItemId: "l4-5", fieldId: "morphology" };
    expect(parseFieldPath(serializeFieldPath(a))).toEqual(a);
    expect(parseFieldPath(serializeFieldPath(b))).toEqual(b);
    expect(fieldPathEquals(parseFieldPath("discs::l4-5::morphology"), b)).toBe(true);
  });

  it("rejects raw ad-hoc strings that are not paths", () => {
    expect(isFieldPathKey("discs")).toBe(false);
    expect(isFieldPathKey("")).toBe(false);
    expect(() => parseFieldPath("nope")).toThrow(/Invalid FieldPath/);
  });
});
