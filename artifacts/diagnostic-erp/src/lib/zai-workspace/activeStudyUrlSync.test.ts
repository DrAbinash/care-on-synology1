import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "./store";

/**
 * Reproduces the Orient → Full Report Formats "Select a study" stuck state:
 * URL study is open (editor works via fullQueue currentRow) but zustand
 * activeStudyId still points at a prior study that fell out of the scoped queue.
 */
describe("workspace activeStudyId URL sync (format picker visibility)", () => {
  beforeEach(() => {
    useWorkspace.setState({
      studies: [],
      activeStudyId: null,
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
    });
  });

  it("bindActiveStudy keeps picker study when current row is merged into scoped queue", () => {
    const brain = {
      id: 101,
      patientId: 1,
      patientName: "AARAV",
      accessionNumber: "A101",
      modality: "MR",
      studyDescription: "MRI Brain Plain",
      bodyPart: "Brain",
      status: "received",
      priority: "routine",
    };
    const spine = {
      id: 202,
      patientId: 2,
      patientName: "BASANTI",
      accessionNumber: "A202",
      modality: "MR",
      studyDescription: "MRI LS Spine",
      bodyPart: "LS Spine",
      status: "received",
      priority: "routine",
    };

    // Previously reporting a brain study
    useWorkspace.getState().setStudies([brain]);
    useWorkspace.setState({ activeStudyId: "101" });
    expect(useWorkspace.getState().studies.find((s) => s.id === useWorkspace.getState().activeStudyId)?.patient.name).toBe("AARAV");

    // Scoped queue now only has spine; open study is spine (from fullQueue) —
    // must merge current into setStudies and rebind activeStudyId without wipe.
    useWorkspace.getState().setStudies([spine]);
    useWorkspace.setState({ activeStudyId: "202", railStage: "orient" });

    const study = useWorkspace.getState().studies.find((s) => s.id === useWorkspace.getState().activeStudyId);
    expect(study?.id).toBe("202");
    expect(study?.patient.name).toBe("BASANTI");
    expect(study?.bodyPart).toBe("LS Spine");
  });

  it("setStudies does not clear a sticky activeStudyId by itself (caller must rebind)", () => {
    useWorkspace.getState().setStudies([
      { id: 1, patientName: "A", accessionNumber: "X", modality: "MR", bodyPart: "Brain" },
    ]);
    useWorkspace.setState({ activeStudyId: "1" });
    useWorkspace.getState().setStudies([
      { id: 2, patientName: "B", accessionNumber: "Y", modality: "MR", bodyPart: "Brain" },
    ]);
    // Stale id remains until URL sync effect rebinds — documents the bug class.
    expect(useWorkspace.getState().activeStudyId).toBe("1");
    expect(useWorkspace.getState().studies.find((s) => s.id === "1")).toBeUndefined();
  });
});
