import { describe, it, expect } from "vitest";
import {
  acknowledgedDraftRow, pickAdoptedDraftId, withDraftId, type RadiologyDraftRow,
} from "./radiologyDraftId";

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

const ACK_SENT = {
  clinicalHistoryText: "Headache for three weeks.",
  techniqueText: "Multiplanar MRI brain without contrast.",
  findingsText: "No acute intracranial abnormality is seen.",
  impressionText: "Normal MRI brain.",
  recommendationText: "Please correlate with clinical findings.",
};

describe("acknowledgedDraftRow — what a save response actually proves", () => {
  it("restates the narrative from the request rather than from a response row that predates it", () => {
    const row = acknowledgedDraftRow({
      studyId: 7,
      draftId: 42,
      patientId: 1,
      sent: { ...ACK_SENT, findingsText: "Newest sentence typed before the save landed." },
      sentSections: undefined,
      responseDraft: { updatedAt: "2026-07-09T00:00:01.000Z", status: "DRAFT" },
      revision: "dr1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previous: { ...FAKE_DRAFT, rawFindings: "The findings as they were when the study opened." },
    });
    expect(row).toMatchObject({
      id: 42,
      studyId: 7,
      worklistId: 7,
      patientId: 1,
      rawFindings: "Newest sentence typed before the save landed.",
      clinicalHistory: ACK_SENT.clinicalHistoryText,
      recommendation: ACK_SENT.recommendationText,
      // save-draft stores JSON.stringify(rest.impression), and the workspace
      // sends [impressionText], so the column is the JSON array — not the bare
      // sentence a fixture might suggest.
      impression: JSON.stringify([ACK_SENT.impressionText]),
      updatedAt: "2026-07-09T00:00:01.000Z",
      status: "DRAFT",
      // P0-2 — the token for the row as it now stands, taken from the response.
      revision: "dr1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("folds Technique into findings_sections the way save-draft does, and stores null when nothing remains", () => {
    const withSections = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: 1, sent: ACK_SENT,
      sentSections: { Findings: "section body" },
      responseDraft: null, revision: null, previous: FAKE_DRAFT,
    });
    expect(JSON.parse(withSections.findingsSections as string))
      .toEqual({ Findings: "section body", Technique: ACK_SENT.techniqueText });

    const blankTechnique = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: 1,
      sent: { ...ACK_SENT, techniqueText: "   " },
      sentSections: undefined,
      responseDraft: null, revision: null, previous: FAKE_DRAFT,
    });
    expect(blankTechnique.findingsSections).toBeNull();
  });

  it("keeps the previously-read structured envelope instead of the response's", () => {
    const row = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: 1, sent: ACK_SENT, sentSections: undefined,
      // The response DOES carry structured_json; it is the column as it stood
      // before this save's envelope patch, so believing it would put unconfirmed
      // measurements into the row the editor reopens from.
      responseDraft: { structuredJson: { spineReporting: { screening: "one save behind" } } },
      revision: "dr1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      previous: { ...FAKE_DRAFT, structuredJson: { spineReporting: { screening: "last read from the server" } } },
    });
    expect(row.structuredJson).toEqual({ spineReporting: { screening: "last read from the server" } });
  });

  it("records a null Findings column when the saving surface sent none, instead of inventing empty text", () => {    // RadiologyReportGenerator writes Findings as sections and has no Technique
    // field, so its save leaves both columns null on the server.
    const row = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: null,
      sent: { ...ACK_SENT, findingsText: null, techniqueText: null },
      sentSections: { Findings: "section body" },
      responseDraft: null, revision: null,
      previous: null,
    });
    expect(row.rawFindings).toBeNull();
    expect(row.findingsSections).toBe(JSON.stringify({ Findings: "section body" }));
    expect(row.patientId).toBeNull();
    expect(row.status).toBe("draft");
  });
});

describe("acknowledgedDraftRow — the revision this save earned", () => {
  it("records the token the response reported, not the one this save replaced", () => {
    const saved = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: 1, sent: ACK_SENT, sentSections: undefined,
      responseDraft: { updatedAt: "2026-07-09T00:00:02.000Z" },
      revision: "dr1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      previous: { ...FAKE_DRAFT, revision: "dr1:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    });
    expect(saved.revision).toBe("dr1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    // A surface that reports no token leaves it UNKNOWN, not stale: unknown means
    // the next save goes unguarded exactly as it did before this guard existed,
    // while reusing the replaced token would guarantee a refusal the
    // radiologist cannot explain or escape.
    const unknown = acknowledgedDraftRow({
      studyId: 7, draftId: 42, patientId: 1, sent: ACK_SENT, sentSections: undefined,
      responseDraft: null,
      revision: null,
      previous: { ...FAKE_DRAFT, revision: "dr1:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    });
    expect(unknown.revision).toBeNull();
  });
});
