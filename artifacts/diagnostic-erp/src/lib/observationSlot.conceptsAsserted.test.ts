/**
 * `conceptsAssertedIn` decides which of the scaffold's normals a compound finding
 * is allowed to retire. It is now load-bearing for clinical correctness in both
 * directions — too narrow and a basal ganglia hemorrhage leaves "basal ganglia
 * are normal" in the signed report; too wide and one aneurysm deletes its
 * siblings or a chest word reaches into a brain report.
 *
 * Each rule therefore gets its own failing case here rather than being inferred
 * from a report-level outcome, so a mutant of any single rule dies visibly.
 */
import { describe, expect, it } from "vitest";
import { conceptsAssertedIn } from "@/lib/observationSlot";

describe("conceptsAssertedIn — what a statement is allowed to claim", () => {
  it("names every anatomy a compound finding actually asserts", () => {
    const got = conceptsAssertedIn(
      "Acute intraparenchymal hemorrhage in the right basal ganglia with midline shift of 6 mm.",
      "hemorrhage",
    );
    expect(got).toContain("hemorrhage");
    expect(got).toContain("basal_ganglia");
    expect(got).toContain("midline");
  });

  it("refuses a broad anatomy word embedded inside another word", () => {
    // "intraparenchymal" contains the parenchyma alias, and parenchyma is broad
    // anatomy: accepting it would let any focal lesion erase the whole
    // parenchymal normal.
    expect(conceptsAssertedIn(
      "Acute intraparenchymal hemorrhage in the right basal ganglia.",
      "hemorrhage",
    )).not.toContain("brain_parenchyma");
    // "periventricular" is a location, not a ventricular abnormality, and
    // "intraventricular extension" is not a statement about ventricular size.
    expect(conceptsAssertedIn(
      "Brain parenchyma shows few punctate periventricular T2/FLAIR hyperintense lesions, Fazekas grade 1.",
      "fazekas",
    )).not.toContain("ventricles");
  });

  it("claims the parenchyma when the sentence actually names it", () => {
    expect(conceptsAssertedIn(
      "Brain parenchyma shows confluent T2/FLAIR hyperintense lesions, Fazekas grade 2.",
      "fazekas",
    )).toContain("brain_parenchyma");
  });

  it("treats a denial as agreement, not as a claim", () => {
    // "No midline shift" must never retire "No midline shift is seen." — that
    // would delete a true negative and leave the report silent.
    expect(conceptsAssertedIn(
      "The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",
      "ventricles",
    )).not.toContain("midline");
  });

  it("will not reach outside the examination's own region", () => {
    // The chest pack names "mass" and "cavitation"; a brain box must not inherit
    // them from a shared word.
    const brain = conceptsAssertedIn(
      "Saccular aneurysm of the right MCA M1 measuring maximum dome height 8 mm.",
      "mra_aneurysm_mca_m1",
    );
    expect(brain).not.toContain("mass_like_opacity");
    expect(brain).not.toContain("cavitation");
    // With no host to bound by, the same words are found — which is exactly why
    // the caller always passes the tile's own concept.
    const unbounded = conceptsAssertedIn(
      "Right lung mass with cavitation and volume loss.",
    );
    expect(unbounded).toContain("mass_like_opacity");
  });

  it("fails closed when the host concept is not in the content pack", () => {
    expect(conceptsAssertedIn("Brain parenchyma shows an unusual pattern.", "not_a_real_concept")).toEqual([]);
  });

  it("returns nothing for text that asserts nothing", () => {
    expect(conceptsAssertedIn("No acute infarct is seen.", "infarct")).toEqual([]);
    expect(conceptsAssertedIn("", "infarct")).toEqual([]);
  });
});
