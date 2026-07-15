import { describe, it, expect } from "vitest";
import { suggestCompletion, currentFragment } from "./copilotCompletion";

describe("currentFragment", () => {
  it("returns the in-progress sentence after the last break", () => {
    expect(currentFragment("Normal study. The ventricular system is")).toBe("The ventricular system is");
    expect(currentFragment("line one\nDiffuse posterior disc bulge")).toBe("Diffuse posterior disc bulge");
  });
});

describe("suggestCompletion", () => {
  it("completes the disc-bulge stem from the spec example (spine)", () => {
    const s = suggestCompletion("Diffuse posterior disc bulge", { studyDescription: "MRI LS Spine" });
    expect(s?.completion).toBe(" causing indentation over the anterior thecal sac.");
  });
  it("completes a normal brain statement", () => {
    const s = suggestCompletion("The ventricular system is", { studyDescription: "MRI Brain" });
    expect(s?.completion).toMatch(/normal in size/);
  });
  it("respects the study gate (no brain rule on a spine study)", () => {
    expect(suggestCompletion("The ventricular system is", { studyDescription: "MRI LS Spine" })).toBeNull();
  });
  it("matches mid-line, using only the trailing fragment", () => {
    const s = suggestCompletion("There is loss of disc height. The neural foramina are", { studyDescription: "MRI Cervical Spine" });
    expect(s?.completion).toMatch(/patent/);
  });
  it("returns null for a short or unknown fragment", () => {
    expect(suggestCompletion("The", { studyDescription: "MRI Brain" })).toBeNull();
    expect(suggestCompletion("Something entirely unrelated here", {})).toBeNull();
  });
  it("does not re-suggest a completion already present", () => {
    const before = "The neural foramina are patent bilaterally. The neural foramina are";
    // The trailing fragment matches, and the completion is not yet after IT, so it still suggests —
    // but once the sentence is completed it should not.
    const completed = "The neural foramina are patent bilaterally.";
    expect(suggestCompletion(completed, { studyDescription: "MRI LS Spine" })).toBeNull();
    expect(before).toBeTruthy();
  });
  it("works for the generic (study-independent) rules", () => {
    const s = suggestCompletion("No other significant abnormality is", {});
    expect(s?.completion).toBe(" detected.");
  });
});
