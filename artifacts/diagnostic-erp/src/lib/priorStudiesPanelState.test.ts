import { describe, expect, it } from "vitest";
import { buildPriorStudiesPath, derivePriorPanelState } from "./priorStudiesPanelState";

// PR1-B frontend coverage: the prior-studies panels' four user-visible states.
// A failed request must surface as "error" (with retry), never collapse into
// "empty" — that silent collapse is how the dead endpoint went unnoticed.

describe("derivePriorPanelState", () => {
  it("no patient context → no-patient", () => {
    expect(derivePriorPanelState({ patientId: undefined, isLoading: false, isError: false, studyCount: 0 })).toBe("no-patient");
    expect(derivePriorPanelState({ patientId: null, isLoading: true, isError: true, studyCount: 3 })).toBe("no-patient");
  });

  it("loading state wins while the request is in flight", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: true, isError: false, studyCount: 0 })).toBe("loading");
  });

  it("a failed request is an error state — NEVER shown as 'no prior studies'", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: true, studyCount: 0 })).toBe("error");
  });

  it("zero studies with a successful request → empty", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: false, studyCount: 0 })).toBe("empty");
  });

  it("studies present → populated", () => {
    expect(derivePriorPanelState({ patientId: 12, isLoading: false, isError: false, studyCount: 4 })).toBe("populated");
  });
});

describe("buildPriorStudiesPath", () => {
  it("targets the canonical /api path with patientId and limit", () => {
    expect(buildPriorStudiesPath({ patientId: 42 }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=20");
  });

  it("includes excludeStudyId so a study never compares against itself", () => {
    expect(buildPriorStudiesPath({ patientId: 42, limit: 20, excludeStudyId: 7 }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=20&excludeStudyId=7");
  });

  it("omits excludeStudyId when absent", () => {
    expect(buildPriorStudiesPath({ patientId: 42, limit: 10, excludeStudyId: null }))
      .toBe("/api/radiology-copilot/prior-studies?patientId=42&limit=10");
  });
});
