import { describe, expect, it } from "vitest";
import { resolveQueueDisplayDepartments } from "../queueDisplayDepartments";

describe("resolveQueueDisplayDepartments — USG TV filter", () => {
  it("usg room with blank departments resolves to USG only", () => {
    expect(resolveQueueDisplayDepartments("usg", "")).toEqual(["USG"]);
  });

  it("usg room with accidental MRI-only list self-heals to USG", () => {
    expect(resolveQueueDisplayDepartments("usg", "MRI,CT")).toEqual(["USG"]);
  });
});

describe("dicomIntakeAutomation — department inference", () => {
  it("ultrasound modality maps to USG department for token lookup", async () => {
    const { isUltrasoundModality } = await import("../usgModality");
    expect(isUltrasoundModality("US")).toBe(true);
    const dept = isUltrasoundModality("US") ? "USG" : "";
    expect(dept).toBe("USG");
  });
});
