/**
 * A combined examination must report as ONE combined examination.
 *
 * Filed from production on 2026-11-01: `MRI BRAIN + CX SCR` opened with only
 * `MRI Brain — Standard Normal` on the STARTING CANVAS. The cervical component was
 * not missing from the catalogue and was not ambiguous — it was never looked at.
 * `matchStudyRegion()` truncates the name at the first `+`/`with`/`and` and only
 * reads the remainder if the primary clause matched nothing, and it returns a
 * single string; `useReportingStudySetup` then wraps that one string in a
 * one-element array. `CX SCR` additionally resolves to nothing, because the study
 * tab is named `Cervical Spine` and the synonym table carried only lumbar/ls.
 *
 * The policy this has to respect is RIS-001 (#1039): the PRIMARY examination
 * chooses the report format, and a screening sequence must not change it. So
 * widening coverage must never cost the radiologist the normal they get today —
 * the last test pins exactly that, because `resolveNormalBootstrapFormat` answers
 * `ambiguous` (no auto-apply at all) when two complete normals survive the region
 * filter, which is what a naive multi-region change would have done to every
 * combined brain+spine study in the clinic.
 */
import { describe, expect, it } from "vitest";
import { matchStudyRegion, resolveAutoStudyRegion } from "./studyRegion";
import { resolveNormalBootstrapFormat } from "./zai-workspace/normalBootstrap";

// The MRI tabs this clinic actually carries, in the order the workspace reads them.
const REGIONS = ["Brain", "Cervical Spine", "LS Spine", "Whole Spine", "Knee"];

describe("combined examination names resolve to every region they cover", () => {
  it("MRI BRAIN + CX SCR still resolves the primary as Brain", () => {
    expect(matchStudyRegion("MRI BRAIN + CX SCR", REGIONS)).toBe("Brain");
  });

  it("the cervical half of the name is not dropped", () => {
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: "MRI BRAIN + CX SCR",
      orderedRegionNames: REGIONS,
    });
    expect(m.region).toBe("Brain");
    expect(m.regions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("the abbreviation is understood in either order, and `with` counts as a join", () => {
    // Written order, not primary-first: `resolveAutoStudyRegion` answers "Brain" as
    // the format owner for this name too, and the coverage list now leads with that
    // owner, so the two agree whatever order the order-entry wrote the name in.
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI CX SCR + BRAIN", orderedRegionNames: REGIONS,
    }).region).toBe("Brain");
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI CX SCR + BRAIN", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain", "Cervical Spine"]);
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI Brain with Cervical Spine Screening", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain", "Cervical Spine"]);
  });

  it("a single-region name resolves exactly one region — nothing widens", () => {
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI BRAIN", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain"]);
    // The synonym table must keep working on its own: LS SPINE is the tab, the
    // order says lumbar.
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI LUMBAR SPINE", orderedRegionNames: REGIONS,
    }).regions).toEqual(["LS Spine"]);
  });

  it("a region is never counted twice because it appears in both clauses", () => {
    expect(resolveAutoStudyRegion({
      modality: "MR", studyDescription: "MRI BRAIN + BRAIN W/O CONTRAST", orderedRegionNames: REGIONS,
    }).regions).toEqual(["Brain"]);
  });

  it("widening coverage does not take the starting normal away — the primary's normal still auto-applies", () => {
    const brainNormal = {
      id: "f-brain", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
      isCompleteNormal: true, findings: "No acute intracranial abnormality.", impression: "Normal MRI brain.",
    };
    const cervicalNormal = {
      id: "f-c-spine", name: "MRI Cervical Spine — Normal", modality: "MR", bodyPart: "Cervical Spine",
      isCompleteNormal: true, findings: "No cord compression.", impression: "Normal MRI cervical spine.",
    };
    const ctx = {
      modality: "MR",
      region: "Brain",
      regions: ["Brain", "Cervical Spine"],
      studyDescription: "MRI BRAIN + CX SCR",
      source: "auto" as const,
    };

    const decision = resolveNormalBootstrapFormat({ ctx, formats: [brainNormal, cervicalNormal] as never });

    expect(decision, "a combined examination must not fall to `ambiguous` and lose its normal").not.toBeNull();
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.id).toBe("f-brain");
    }
  });

  it("coverage never moves the region that owns the report format", () => {
    // Study Tab names are owner-editable, and this clinic's catalogue carries both
    // spellings of the cervical examination in live use. The raw matcher reads the
    // billed name as one tab and the abbreviation reading as the other, so
    // coverage can disagree with the format owner — and every consumer takes
    // `regions[0]` as the primary. Widening coverage must never cost the
    // radiologist the format of the examination they actually ordered.
    const both = ["C Spine", "Cervical Spine", "Brain"];
    const m = resolveAutoStudyRegion({
      modality: "MR",
      studyDescription: null,
      billedTestName: "MRI C SPINE",
      orderedRegionNames: both,
    });
    expect(m.region).toBe("C Spine");
    expect(m.regions[0], "the coverage list must lead with the format owner").toBe(m.region);
    expect(m.regions, "coverage still records the other spelling of the same examination").toContain("Cervical Spine");
  });
});
