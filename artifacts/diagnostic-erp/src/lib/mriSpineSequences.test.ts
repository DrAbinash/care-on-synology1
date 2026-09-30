import { describe, expect, it } from "vitest";

import {
  SPINE_SEQUENCE_KEYS,
  SPINE_STATEMENT_RULES,
  defaultSpineSequences,
  deriveSpineSequencesAvailable,
  levelPrecisionAllowed,
  missingSpineSequenceLabels,
  screeningAxialDetailAllowed,
  spineLimitationSentence,
  spineSequencesAllow,
  spineSequencesSummary,
} from "./mriSpineSequences";

describe("spine sequence awareness (spec §12, §32, §35)", () => {
  it("assumes nothing until the study or the radiologist says so", () => {
    const none = defaultSpineSequences();
    expect(SPINE_SEQUENCE_KEYS.every((k) => none[k] === false)).toBe(true);
    expect(spineSequencesSummary(none)).toEqual([]);
  });

  it("derives sequences named in the technique field", () => {
    const a = deriveSpineSequencesAvailable({
      techniqueText: "Sagittal T1, T2, axial T2 and STIR.",
    });
    expect(a.t1).toBe(true);
    expect(a.t2).toBe(true);
    expect(a.axial).toBe(true);
    expect(a.stir).toBe(true);
    expect(a.contrast).toBe(false);
    expect(a.dwi).toBe(false);
    expect(a.dynamic).toBe(false);
  });

  it("does not mistake a plain study for a contrast study", () => {
    expect(deriveSpineSequencesAvailable({ techniqueText: "Non-contrast MRI of the lumbar spine." }).contrast).toBe(false);
    expect(deriveSpineSequencesAvailable({ techniqueText: "MRI LS spine plain." }).contrast).toBe(false);
    expect(deriveSpineSequencesAvailable({ techniqueText: "Post-contrast T1-weighted images." }).contrast).toBe(true);
  });

  it("recognises dynamic and whole-spine coverage only when stated", () => {
    expect(deriveSpineSequencesAvailable({ techniqueText: "Supine routine lumbar MRI." }).dynamic).toBe(false);
    expect(deriveSpineSequencesAvailable({ techniqueText: "Flexion and extension views." }).dynamic).toBe(true);
    expect(levelPrecisionAllowed(deriveSpineSequencesAvailable({ techniqueText: "Sagittal localizer for level counting." }))).toBe(true);
    expect(levelPrecisionAllowed(deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1/T2." }))).toBe(false);
  });

  it("derives screening coverage per region from the study title", () => {
    const a = deriveSpineSequencesAvailable({
      reportTitle: "MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING",
    });
    expect(a.cervicalScreening).toBe(true);
    expect(a.dorsalScreening).toBe(true);
    expect(a.lsScreening).toBe(true);
  });

  it("lets the radiologist override in both directions", () => {
    const derived = deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2 and STIR." });
    expect(derived.stir).toBe(true);
    const overridden = deriveSpineSequencesAvailable(
      { techniqueText: "Sagittal T1, T2 and STIR." },
      { stir: false, dwi: true },
    );
    expect(overridden.stir).toBe(false);
    expect(overridden.dwi).toBe(true);
  });

  it("gates a statement on every sequence it needs", () => {
    const a = deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1, T2. No contrast." });
    expect(spineSequencesAllow(a, ["stir"])).toBe(false);
    expect(spineSequencesAllow(a, [])).toBe(true);
    expect(missingSpineSequenceLabels(a, ["contrast", "stir"])).toHaveLength(2);
  });

  it("keeps marrow-edema and enhancement statements tied to their acquisitions", () => {
    const stirRule = SPINE_STATEMENT_RULES.find((r) => r.keys.includes("stir"));
    const contrastRule = SPINE_STATEMENT_RULES.find((r) => r.keys.includes("contrast"));
    expect(stirRule?.re.test("Modic type 1 changes with bone marrow edema.")).toBe(true);
    expect(contrastRule?.re.test("The lesion shows no enhancement.")).toBe(true);
    expect(contrastRule?.re.test("L4-L5 disc bulge.")).toBe(false);
  });

  it("emits limitation wording instead of a negative finding", () => {
    const text = spineLimitationSentence(["stir"], "marrow edema");
    expect(text).toContain("This examination did not include");
    expect(text).toContain("marrow edema cannot be assessed");
    expect(spineLimitationSentence([], "marrow edema")).toBe("");
  });

  it("treats sagittal-only screening as unable to support axial detail", () => {
    const sagittalOnly = deriveSpineSequencesAvailable({ techniqueText: "Sagittal T1/T2 screening of the cervical spine." });
    expect(sagittalOnly.cervicalScreening).toBe(true);
    expect(screeningAxialDetailAllowed(sagittalOnly)).toBe(false);
    expect(screeningAxialDetailAllowed(deriveSpineSequencesAvailable({ techniqueText: "Sagittal and axial T2." }))).toBe(true);
  });
});
