/**
 * Plain / contrast compatibility on the Quick Select wall.
 *
 * Measured on the shipped MRI catalogue at f96d92f1: an "MRI Brain Plain" study and an "MRI Brain
 * With Contrast" study were handed the SAME wall, because the only scoping `lookupTilesForContext`
 * applies is modality and region. Box #448 "Glioma recurrence" — "Heterogeneously enhancing area in
 * the right frontal operculum at the post-resection cavity …" — was therefore one click away on a
 * study that never received gadolinium, and the sentence it writes is an observation the study
 * cannot support. Census of the 496 active boxes, run over the real rows:
 *
 *   MRI Brain Plain           pool 48   withheld 1  (#448)
 *   MRI Brain With Contrast   pool 48   withheld 0
 *   MRI Cervical Spine        pool 81   withheld 0  (exam name declares no contrast status)
 *   MRI Dorsal Spine          pool 18   withheld 0
 *   MRI LS Spine              pool 61   withheld 0
 *   MRI Whole Spine          pool 153   withheld 0
 *   CT Brain Plain            pool 34   withheld 0  (the gate is MR-only)
 *   USG Whole Abdomen          pool  9   withheld 0  (#155's "posterior acoustic enhancement" is
 *                                                    not gadolinium, and no US study is "plain")
 *
 * The prose below is quoted from those rows, because the distinction that matters — asserting an
 * enhancement versus recommending a contrast study — only shows up in the actual sentences.
 */
import { describe, expect, it } from "vitest";
import {
  boxNeedsContrast,
  studyContrastStatus,
  withholdContrastOnlyBoxes,
  type ContrastStatus,
} from "./quickSelectContrastGate";
import type { QuickSelectCatalogueBox } from "./quickSelectBoxCatalogue";

const box = (over: Partial<QuickSelectCatalogueBox> & { id: number; label: string }): QuickSelectCatalogueBox => ({
  studyType: "Brain",
  findingText: "",
  impressionText: "",
  techniqueText: "",
  recommendationText: "",
  ...over,
});

// #448 — the enhancement claim this gate exists for.
const GLIOMA_RECURRENCE = box({
  id: 448,
  label: "Glioma recurrence",
  findingText:
    "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, "
    + "measuring approximately {a} x {b} x {c} cm, with surrounding T2/FLAIR hyperintensity "
    + "suggestive of edema. Findings are concerning for tumor recurrence.",
  recommendationText: "Urgent oncology referral. Recommend MRI brain with contrast and perfusion imaging in 6-8 weeks.",
});

// #4 — a mass box whose IMPRESSION recommends contrast. Withholding this one from a plain study
// would remove the only way to record a mass on the study that most needs it recorded.
const TUMOR = box({
  id: 4,
  label: "Tumor",
  findingText: "A well/ill-defined space-occupying lesion is noted with surrounding edema and mass effect.",
  impressionText: "Intracranial space-occupying lesion — suggest contrast-enhanced study / histopathological correlation.",
});

// #470 — assertion in Findings, so it belongs on a contrast study only.
const INTRADURAL_LESION = box({
  id: 470,
  label: "Intradural extramedullary lesion",
  studyType: "Cervical Spine",
  findingText: "An enhancing intradural extramedullary cervical lesion with a dural tail.",
  impressionText: "Cervical intradural extramedullary lesion.",
});

// #429 — the contrast-negative case: susceptibility, not enhancement.
const MICROBLEEDS = box({
  id: 429,
  label: "Microbleeds",
  findingText:
    "Brain parenchyma shows multiple punctate foci of susceptibility on GRE/SWI, consistent with cerebral microbleeds.",
});

// #155 — why the gate must be MR-only: ultrasound "enhancement" is acoustic, not gadolinium.
const HEPATIC_CYST = box({
  id: 155,
  label: "Simple Hepatic Cyst",
  studyType: "Whole Abdomen",
  findingText:
    "A well-defined anechoic cystic lesion with posterior acoustic enhancement is noted in the liver parenchyma.",
});

describe("studyContrastStatus — what the study itself declares", () => {
  it("reads contrast from the examination name before the technique", () => {
    expect(studyContrastStatus({ examName: "MRI Brain With Contrast" })).toBe("given");
    expect(studyContrastStatus({ examName: "MRI Brain Plain", techniqueText: "Multiplanar T1, T2, FLAIR." })).toBe("not-given");
    expect(studyContrastStatus({ examName: "CE-MRI brain" })).toBe("given");
  });

  it("falls back to the technique when the name says nothing", () => {
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "Contrast administered. Post-contrast T1 sequences obtained." })).toBe("given");
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "MRI of the brain was performed without contrast." })).toBe("not-given");
    // The shipped Brain technique line names sequences and never mentions contrast either way.
    expect(studyContrastStatus({ examName: "MRI Brain", techniqueText: "Multiplanar multisequence MRI of the brain was performed including T1, T2, FLAIR, DWI, and GRE sequences." })).toBe("unknown");
  });

  it("stays unknown rather than guessing", () => {
    expect(studyContrastStatus({ examName: "MRI Cervical Spine", techniqueText: "" })).toBe("unknown");
    expect(studyContrastStatus({})).toBe("unknown");
  });
});

describe("boxNeedsContrast — assertion, not advice", () => {
  it("flags a box that asserts enhancement in Findings", () => {
    expect(boxNeedsContrast(GLIOMA_RECURRENCE)).toBe(true);
    expect(boxNeedsContrast(INTRADURAL_LESION)).toBe(true);
  });

  it("does not flag a box that only recommends a contrast study", () => {
    // The recommendation column mentions contrast and must not decide anything …
    expect(boxNeedsContrast(TUMOR)).toBe(false);
    // … and "suggestive of edema" must not be read as the verb "suggest".
    expect(GLIOMA_RECURRENCE.findingText).toMatch(/suggestive of edema/);
    expect(boxNeedsContrast(GLIOMA_RECURRENCE)).toBe(true);
  });

  it("does not flag a box that says nothing about contrast", () => {
    expect(boxNeedsContrast(MICROBLEEDS)).toBe(false);
  });
});

describe("withholdContrastOnlyBoxes — MR only, and never on an unknown study", () => {
  // The wall an MRI study is actually handed. #155 is not on it: a US box cannot reach an MR strip,
  // because its own `scope_modality` scores it out first — and "posterior acoustic enhancement" is
  // not gadolinium, which is why the modality guard, not the sentence, is what protects it.
  const all = [GLIOMA_RECURRENCE, TUMOR, INTRADURAL_LESION, MICROBLEEDS];
  const ids = (list: readonly QuickSelectCatalogueBox[]) => list.map((b) => b.id).sort();

  it("withholds the assertion from a study reported without contrast", () => {
    const r = withholdContrastOnlyBoxes(all, { modality: "MR", status: "not-given" as ContrastStatus });
    expect(ids(r.withheld)).toEqual([448, 470]);
    expect(ids(r.offered)).toEqual([4, 429]);
  });

  it("offers everything on a contrast study", () => {
    const r = withholdContrastOnlyBoxes(all, { modality: "MR", status: "given" });
    expect(r.withheld).toEqual([]);
    expect(r.offered).toHaveLength(all.length);
  });

  it("changes nothing when the study never declared its contrast status", () => {
    const r = withholdContrastOnlyBoxes(all, { modality: "MR", status: "unknown" });
    expect(r.withheld).toEqual([]);
    expect(r.offered).toHaveLength(all.length);
  });

  it("leaves every other modality alone", () => {
    for (const modality of ["CT", "US", "XR", "MG", undefined, null]) {
      const r = withholdContrastOnlyBoxes([...all, HEPATIC_CYST], { modality, status: "not-given" });
      expect(r.withheld, `${String(modality)} must not be gated on contrast`).toEqual([]);
      expect(r.offered).toHaveLength(all.length + 1);
    }
  });

  it("withholds nothing from the wall and reports the count it took", () => {
    // The strip prints this count; a silent removal is the same complaint the anatomy chip had.
    const r = withholdContrastOnlyBoxes([GLIOMA_RECURRENCE, TUMOR], { modality: "MR", status: "not-given" });
    expect(r.withheld.map((b) => b.label)).toEqual(["Glioma recurrence"]);
  });
});
