/**
 * Finding B — a clearly incorrect template must not be signable, and a
 * legitimate one must not become unsignable.
 *
 * The mismatch verdict fed in here is the SHIPPED detector's
 * (`templateRegionMismatch`), not a hand-set boolean, so these cases exercise the
 * same input the workspace banner is painted from. That matters for the second
 * half of the suite: the four arrangements the owner named as legitimate all make
 * the banner fire today, and the point of the rule is that only the ones with no
 * legitimate reading go on to block a signature.
 *
 * There is no browser harness on this machine, so the finalize refusal itself is
 * pinned at source (last describe) rather than clicked through.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { incompatibleTemplateForStudy } from "./templateStudyCompatibility";
import { studyRegionToBodyPart, templateRegionMismatch } from "./pickStructuredTemplate";

/** The input the workspace builds at sign-off, from a real region selection. */
function atSignOff(opts: {
  regions: string[];
  templateName: string;
  templateBodyPart: string;
  studyType?: string | null;
}) {
  return {
    templateMismatch: templateRegionMismatch(opts.regions[0] ?? null, opts.templateBodyPart),
    studyRegions: opts.regions,
    templateBodyPart: opts.templateBodyPart,
    templateName: opts.templateName,
    templateStudyType: opts.studyType ?? null,
  };
}

const bodyPartOf = (region: string) => studyRegionToBodyPart(region) ?? "";

describe("legitimate arrangements still sign", () => {
  it("1. whole-spine screening on an LS booking — the shipped row is named Cervical", () => {
    // The banner fires: body part Cervical against an LS study. Signing must not,
    // because that row's own findings speak for the dorsal and lumbosacral spine.
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "MRI Cervical Spine with Whole Spine Screening",
      templateBodyPart: bodyPartOf("Cervical Spine"),
      studyType: "SCREENING_WHOLE_SPINE",
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).toBeNull();
  });

  it("2. a screening sequence declared only in study_type", () => {
    // Nothing in the row's NAME says whole spine; the declaration is the study
    // type, which is the other place the catalogue records that scope.
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "MRI Spine Screening Protocol",
      templateBodyPart: bodyPartOf("Cervical Spine"),
      studyType: "screening_whole_spine",
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).toBeNull();
  });

  it("3. a combined Cervical + LS study reported on the LS row", () => {
    // The shipped detector reads studyRegions[0] only, so a combined booking
    // reports a mismatch against any row but the first region's. The LS row is
    // one of the two regions actually selected.
    const input = atSignOff({
      regions: ["Cervical Spine", "LS Spine"],
      templateName: "MRI LS Spine",
      templateBodyPart: bodyPartOf("LS Spine"),
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).toBeNull();
  });

  it("4. a multiregion examination reported on the primary region's row", () => {
    const input = atSignOff({
      regions: ["Cervical Spine", "LS Spine"],
      templateName: "MRI Cervical Spine",
      templateBodyPart: bodyPartOf("Cervical Spine"),
    });
    expect(input.templateMismatch).toBe(false);
    expect(incompatibleTemplateForStudy(input)).toBeNull();
  });

  it("5. a matching template on a single-region study", () => {
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "MRI LS Spine",
      templateBodyPart: bodyPartOf("LS Spine"),
    });
    expect(input.templateMismatch).toBe(false);
    expect(incompatibleTemplateForStudy(input)).toBeNull();
  });

  it("6. no region resolved yet — nothing to be incompatible with", () => {
    // An unresolved booking keeps today's behaviour. Refusing on nothing is how a
    // study loses its only report.
    expect(
      incompatibleTemplateForStudy({
        templateMismatch: true,
        studyRegions: [],
        templateBodyPart: bodyPartOf("Cervical Spine"),
        templateName: "MRI Cervical Spine",
        templateStudyType: null,
      }),
    ).toBeNull();
  });
});

describe("a template for anatomy the study does not cover cannot be signed", () => {
  it("7. cervical-only row on an LS study", () => {
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "MRI Cervical Spine",
      templateBodyPart: bodyPartOf("Cervical Spine"),
    });
    expect(input.templateMismatch).toBe(true);
    const verdict = incompatibleTemplateForStudy(input);
    expect(verdict).not.toBeNull();
    expect(verdict?.templateName).toBe("MRI Cervical Spine");
    expect(verdict?.studyRegions).toEqual(["LS Spine"]);
  });

  it("8. a brain row on a spine study", () => {
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "MRI Brain Plain",
      templateBodyPart: bodyPartOf("Brain"),
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).not.toBeNull();
  });

  it("9. a dorsal row on a combined Cervical + LS study", () => {
    // Both selected regions are spine, and neither is the dorsal spine: the row
    // would print normal statements about segments this booking never acquired.
    const input = atSignOff({
      regions: ["Cervical Spine", "LS Spine"],
      templateName: "MRI Dorsal Spine",
      templateBodyPart: bodyPartOf("Dorsal Spine"),
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).not.toBeNull();
  });

  it("10. a row whose name promises screening for a body part it is not", () => {
    // "Screening" alone is not the declaration — `declaresWholeSpineScreening`
    // reads whole-spine / screening_whole_spine / wbv, so an abdominal screening
    // row cannot borrow the spine exemption.
    const input = atSignOff({
      regions: ["LS Spine"],
      templateName: "USG Abdomen Screening",
      templateBodyPart: bodyPartOf("Abdomen"),
      studyType: "SCREENING",
    });
    expect(input.templateMismatch).toBe(true);
    expect(incompatibleTemplateForStudy(input)).not.toBeNull();
  });
});

describe("the refusal is wired into the finalize gauntlet", () => {
  const FINALIZE = readFileSync(
    resolve(__dirname, "../hooks/radiology-workspace/useStudyFinalize.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const CLINICAL_UI = readFileSync(
    resolve(__dirname, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("11. the gauntlet asks, and returns before arming the lifecycle", () => {
    const at = FINALIZE.indexOf("incompatibleTemplateForStudy(");
    expect(at, "the gauntlet never asks the rule").toBeGreaterThanOrEqual(0);
    // A refusal after `startFinalize()` would leave `isFinalizing` armed on a
    // signature that never happened — the exact defect A-01's owner wrapper
    // exists to clear.
    const armed = FINALIZE.indexOf("useWorkspace.getState().startFinalize()");
    expect(armed, "could not find the A-01 arming").toBeGreaterThan(0);
    expect(at).toBeLessThan(armed);

    const refusal = FINALIZE.slice(at, FINALIZE.indexOf("return;", at));
    expect(refusal).toContain("toast({");
    expect(FINALIZE.slice(at, armed)).toContain("if (templateIncompatibility)");
  });

  it("12. the caller feeds it the whole region selection, not just the first", () => {
    // Feeding `studyRegions[0]` would re-create the blunt verdict the rule exists
    // to narrow, and cases 3 and 9 would both be wrong.
    expect(CLINICAL_UI).toContain("getTemplateCompatibility");
    expect(CLINICAL_UI).toContain("studyRegions: studySetup.studyRegions");
    expect(CLINICAL_UI).toContain("templateMismatch: studySetup.templateMismatch");
    expect(CLINICAL_UI).toContain("templateStudyType: studySetup.selectedTemplate.studyType");
  });
});
