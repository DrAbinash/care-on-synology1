import { describe, it, expect } from "vitest";
import { pickAdoptedDraftId, withDraftId, type RadiologyDraftRow } from "./radiologyDraftId";

// Ticket A3.0 coverage: the two pure decision points extracted from
// useRadiologyDraftId so the draft-identity lifecycle is testable without
// rendering the hook (this repo has no React testing-library/jsdom set up —
// these functions carry the actual logic; the hook itself only wires them
// to useState/useEffect/useQuery, mirroring how RadiologyReportGenerator.tsx
// already proved this exact pattern correct before this ticket centralized
// it).

const FAKE_DRAFT: RadiologyDraftRow = {
  id: 42, studyId: 7, worklistId: null, patientId: 1, templateId: null,
  modality: "MR", studyName: null, clinicalHistory: null, rawFindings: "Findings text",
  findingsSections: null, impression: null, recommendation: null,
  formattedReportHtml: null, formattedReportText: null,
  status: "DRAFT", updatedAt: "2026-07-09T00:00:00.000Z",
};

describe("pickAdoptedDraftId — page reload loads an existing draft", () => {
  it("adopts the loaded draft's id when one exists for this study", () => {
    expect(pickAdoptedDraftId(FAKE_DRAFT)).toBe(42);
  });

  it("returns null (blank draft) when no prior draft exists for this study", () => {
    expect(pickAdoptedDraftId(null)).toBeNull();
  });
});

describe("withDraftId — first save creates, subsequent saves update", () => {
  it("omits id on the first save (draftId null) — server INSERTs, matching save-draft's `if (id) update else insert` branch", () => {
    const body = withDraftId({ rawFindings: "x" }, null);
    expect(body.id).toBeUndefined();
    expect("id" in body ? body.id : undefined).toBeUndefined();
  });

  it("includes the tracked id on every subsequent save — server UPDATEs the same row", () => {
    const body = withDraftId({ rawFindings: "x" }, 42);
    expect(body.id).toBe(42);
  });

  it("save still succeeds after reload: a draftId adopted from an existing draft flows straight into the next save's payload", () => {
    const adopted = pickAdoptedDraftId(FAKE_DRAFT);
    const body = withDraftId({ rawFindings: "updated text" }, adopted);
    expect(body).toMatchObject({ id: 42, rawFindings: "updated text" });
  });

  it("never mutates the caller's body object", () => {
    const original = { rawFindings: "x" };
    const body = withDraftId(original, 42);
    expect(original).not.toHaveProperty("id");
    expect(body).not.toBe(original);
  });
});
