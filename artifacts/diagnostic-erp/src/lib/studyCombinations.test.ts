import { describe, it, expect } from "vitest";
import {
  STUDY_COMBINATIONS, findStudyCombination, combinationsForModality,
  matchStudyCombination, buildCombination, combinationInserts,
} from "./studyCombinations";

describe("studyCombinations (MRI PR 4 — Study Combinations)", () => {
  it("every curated combination resolves to >= 2 known base templates", () => {
    for (const c of STUDY_COMBINATIONS) {
      const assembled = buildCombination(c.templateIds);
      expect(assembled, `${c.id} should assemble`).not.toBeNull();
      expect(c.templateIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("buildCombination reuses the assembler: joins titles and orders sections", () => {
    const assembled = buildCombination(["mri-brain-master", "mri-cervical-master"])!;
    expect(assembled.title).toMatch(/ WITH /);
    expect(assembled.findingsSections.length).toBe(2);
    expect(assembled.findingsSections[0].heading).toBe("BRAIN");
    expect(assembled.findingsSections[1].heading).toBe("CERVICAL SPINE");
  });

  it("returns null for a single template (that is not a combination)", () => {
    expect(buildCombination(["mri-brain-master"])).toBeNull();
  });

  it("returns null when template ids are unknown", () => {
    expect(buildCombination(["does-not-exist", "nope"])).toBeNull();
  });

  it("combinationInserts splits the impression into lines and keeps section blocks", () => {
    const inserts = combinationInserts(buildCombination(["mri-cervical-master", "mri-dorsal-master", "mri-ls-master"])!);
    expect(inserts.findingsBlocks.length).toBe(3);
    expect(inserts.impression.length).toBeGreaterThan(0);
    expect(inserts.impression.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("findStudyCombination looks up by id", () => {
    expect(findStudyCombination("combo:whole-spine")?.templateIds).toHaveLength(3);
    expect(findStudyCombination("combo:nope")).toBeUndefined();
  });

  it("combinationsForModality matches MR to the MRI combinations", () => {
    expect(combinationsForModality("MR").length).toBe(STUDY_COMBINATIONS.length);
    expect(combinationsForModality("MRI").length).toBe(STUDY_COMBINATIONS.length);
    expect(combinationsForModality("US")).toEqual([]);
    expect(combinationsForModality(null).length).toBe(STUDY_COMBINATIONS.length);
  });

  it("matchStudyCombination resolves an exact label and a unique keyword", () => {
    expect(matchStudyCombination("MRI Brain + Cervical Spine")?.id).toBe("combo:brain-cervical");
    // "screening" is a keyword unique to the whole-spine combination.
    expect(matchStudyCombination("screening")?.id).toBe("combo:whole-spine");
  });

  it("matchStudyCombination resolves natural voice phrasing via token-AND", () => {
    // "combine brain and cervical" → term "brain and cervical"; "and" is dropped.
    expect(matchStudyCombination("brain and cervical")?.id).toBe("combo:brain-cervical");
  });

  it("matchStudyCombination returns null on no match or ambiguity", () => {
    expect(matchStudyCombination("")).toBeNull();
    expect(matchStudyCombination("thoracic aorta")).toBeNull();
    // "spine" and "whole spine" appear in several combinations → ambiguous → null.
    expect(matchStudyCombination("spine")).toBeNull();
    expect(matchStudyCombination("whole spine")).toBeNull();
  });
});
