import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeSectionedFindings,
  ensureSectionedFindings,
  extractLinkedStudyFromStructuredJson,
  findingsSectionBlocks,
  findingsSectionFromStudy,
  formatStudySectionTitle,
  replaceFindingsSectionBody,
  routeChipToFindingsSection,
  type FindingsStudySection,
} from "./multiStudyReport";
import { impressionProvenanceIsRadiologistManual } from "./impressionProvenance";
import {
  canForceReleaseStudyLock,
  canTrialEditSignedReport,
  defaultReadingQueueDatePreset,
  visibleTabRefetchInterval,
} from "./workspaceGuards";
import { readDocumentTabVisible } from "@/hooks/useIsTabVisible";
import { useWorkspace } from "@/lib/zai-workspace/store";

const brain = findingsSectionFromStudy({
  studyId: 1,
  modality: "MR",
  studyDescription: "MRI Brain",
});
const cervical = findingsSectionFromStudy({
  studyId: 2,
  modality: "MR",
  studyDescription: "MRI Cervical Spine",
});

describe("multi-study findings sections", () => {
  it("titles a brain and cervical study as MRI BRAIN and MRI CERVICAL SPINE", () => {
    expect(formatStudySectionTitle("MR", "MRI Brain")).toBe("MRI BRAIN");
    expect(formatStudySectionTitle("MR", "Brain")).toBe("MRI BRAIN");
    expect(formatStudySectionTitle("MR", "MRI Cervical Spine")).toBe("MRI CERVICAL SPINE");
    expect(brain.title).toBe("MRI BRAIN");
    expect(cervical.title).toBe("MRI CERVICAL SPINE");
  });

  it("keeps each study's findings in its own block", () => {
    const text = ensureSectionedFindings("No acute intracranial abnormality.", brain, cervical);
    const withCervical = replaceFindingsSectionBody(
      text,
      [brain, cervical],
      cervical.studyId,
      "Disc protrusion at C5-C6.",
    );
    const blocks = findingsSectionBlocks(withCervical, [brain, cervical]);
    expect(blocks.map((b) => b.title)).toEqual(["MRI BRAIN", "MRI CERVICAL SPINE"]);
    expect(blocks[0]?.body).toContain("intracranial");
    expect(blocks[0]?.body).not.toContain("C5-C6");
    expect(blocks[1]?.body).toContain("C5-C6");
    expect(composeSectionedFindings(blocks)).toBe(withCervical);
  });

  it("routes a chip by study type / anatomical section, then active focus", () => {
    const sections: FindingsStudySection[] = [brain, cervical];
    expect(routeChipToFindingsSection({
      sections,
      activeSectionId: brain.studyId,
      anatomicalSection: "disc",
      region: "Brain",
      studyType: "Cervical Spine",
    })).toBe(cervical.studyId);
    expect(routeChipToFindingsSection({
      sections,
      activeSectionId: cervical.studyId,
      anatomicalSection: "white matter",
      studyType: "Brain",
    })).toBe(brain.studyId);
    expect(routeChipToFindingsSection({
      sections,
      activeSectionId: cervical.studyId,
      anatomicalSection: "",
      region: "",
      studyType: "",
    })).toBe(cervical.studyId);
  });

  it("reads linkedStudyId from a structuredJson envelope", () => {
    const parsed = extractLinkedStudyFromStructuredJson({
      kind: "care.structured_json_envelope",
      linkedStudyId: 2,
      careLinkedStudy: {
        studyId: 2,
        title: "MRI CERVICAL SPINE",
        modality: "MR",
        studyDescription: "MRI Cervical Spine",
      },
    });
    expect(parsed?.studyId).toBe("2");
    expect(parsed?.title).toBe("MRI CERVICAL SPINE");
  });
});

describe("applyPathologyOverlay respects the linked findings sub-section", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      isFinalized: false,
      isDirty: false,
      primaryFindingsSection: null,
      linkedStudy: null,
      activeFindingsSectionId: null,
      confirmOverwriteOpen: false,
      pendingPathologyPatch: null,
    });
  });

  it("writes the cervical chip into the cervical block and still fills impression and recommendation", () => {
    useWorkspace.getState().setField("findings", "No acute intracranial abnormality.", { source: "template" });
    useWorkspace.getState().setLinkedStudies(brain, cervical);
    const status = useWorkspace.getState().applyPathologyOverlay({
      incoming: {
        findings: "Disc protrusion at C5-C6.",
        impression: "Cervical disc protrusion.",
        recommendation: "Clinical correlation is recommended.",
      },
      templates: {
        findings: "Disc protrusion at C5-C6.",
        impression: "Cervical disc protrusion.",
        recommendation: "Clinical correlation is recommended.",
      },
      ownership: { anatomicalSection: "disc", conflictGroup: "disc_protrusion" },
      source: "quick-findings",
      id: "qf-cspine",
      region: "Brain",
      studyType: "Cervical Spine",
      findingsText: "Disc protrusion at C5-C6.",
    });
    expect(status).toBe("applied");
    const state = useWorkspace.getState();
    const blocks = findingsSectionBlocks(state.findingsText, [brain, cervical]);
    expect(blocks[0]?.body).toContain("intracranial");
    expect(blocks[0]?.body).not.toContain("C5-C6");
    expect(blocks[1]?.body).toContain("Disc protrusion at C5-C6.");
    expect(state.impressionText).toContain("Cervical disc protrusion.");
    expect(state.recommendationText).toContain("Clinical correlation is recommended.");
    expect(state.activeFindingsSectionId).toBe(cervical.studyId);
  });
});

describe("workspace usability guards", () => {
  it("auto-refreshes only when impression provenance is not radiologist-manual", () => {
    expect(impressionProvenanceIsRadiologistManual({ "normal study.": ["system"] })).toBe(false);
    expect(impressionProvenanceIsRadiologistManual({ "typed line": ["manual"] })).toBe(true);
    expect(impressionProvenanceIsRadiologistManual({ "typed line": ["radiologist-manual"] })).toBe(true);
    expect(impressionProvenanceIsRadiologistManual(undefined)).toBe(false);
  });

  it("hides signed-report edit and force release from non-admin staff who do not own the lock", () => {
    expect(canTrialEditSignedReport(false, "radiologist")).toBe(false);
    expect(canTrialEditSignedReport(true, "radiologist")).toBe(true);
    expect(canTrialEditSignedReport(false, "admin")).toBe(true);
    expect(canForceReleaseStudyLock(false, "radiologist", 9, 4)).toBe(false);
    expect(canForceReleaseStudyLock(false, "radiologist", 4, 4)).toBe(true);
    expect(canForceReleaseStudyLock(false, "admin", 9, 4)).toBe(true);
  });

  it("defaults a fresh reading queue to today and pauses polling when the tab is hidden", () => {
    expect(defaultReadingQueueDatePreset(null)).toBe("today");
    expect(defaultReadingQueueDatePreset("today-yesterday")).toBe("today-yesterday");
    expect(visibleTabRefetchInterval(true)).toBe(30000);
    expect(visibleTabRefetchInterval(false)).toBe(false);
    expect(readDocumentTabVisible("hidden")).toBe(false);
    expect(readDocumentTabVisible("visible")).toBe(true);
  });
});
