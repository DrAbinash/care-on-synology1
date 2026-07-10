import { describe, it, expect } from "vitest";
import {
  deriveDraftDocumentId,
  buildDraftD1WriterInput,
  buildAndValidateDraftD1Document,
  DRAFT_DOCUMENT_ID_PATTERN,
  D3_DRAFT_REVISION,
  type DraftD1Source,
} from "./radiologyD1DraftWriter";
import { verifyContentSha256 } from "./structuredReport/hash";

// Ticket D3 — pure adapter + build/validate. No DB, no feature flag, no clock:
// the whole point is that this is a pure, deterministic function of its input.

function completeSource(overrides: Partial<DraftD1Source> = {}): DraftD1Source {
  return {
    draftId: 101,
    createdBy: "dr_test",
    createdAtIso: "2026-07-10T09:00:00Z",
    updatedAtIso: "2026-07-10T09:05:00Z",
    modality: "MRI",
    bodyRegion: "brain",
    studyType: "MRI Brain Plain",
    templateId: "MRI_BRAIN_PLAIN",
    identifiers: {
      studyInstanceUid: "1.2.840.113619.2.55.3.1",
      accessionNumber: "ACC-20260710-1",
      patientRefValue: "PAT-000112",
      studyDatetimeIso: "2026-07-10T08:55:00Z",
      referringPhysician: "dr_mehta",
      performingPhysician: "tech_priya",
    },
    catalogSchemaVersion: "0",
    contentPackVersions: {},
    aiRulesVersions: {},
    findingSelections: [
      { findingId: 10, params: { side: "left", severity: "mild", chronicity: "", level: "", value: "" }, source: "quickselect" },
    ],
    ...overrides,
  };
}

describe("deriveDraftDocumentId", () => {
  it("matches the D1 ULID character pattern (R18) and is 26 chars", () => {
    for (const id of [0, 1, 42, 101, 999999, 2_000_000_000]) {
      const docId = deriveDraftDocumentId(id);
      expect(docId).toHaveLength(26);
      expect(docId).toMatch(DRAFT_DOCUMENT_ID_PATTERN);
    }
  });

  it("is deterministic and unique per draft id", () => {
    expect(deriveDraftDocumentId(101)).toBe(deriveDraftDocumentId(101));
    expect(deriveDraftDocumentId(101)).not.toBe(deriveDraftDocumentId(102));
  });

  it("rejects a non-integer/negative id", () => {
    expect(() => deriveDraftDocumentId(-1)).toThrow();
    expect(() => deriveDraftDocumentId(1.5)).toThrow();
  });
});

describe("buildDraftD1WriterInput — success shape", () => {
  it("produces findings:[] and carries the raw selection in extensions.x_care_draft (no fabrication)", () => {
    const result = buildDraftD1WriterInput(completeSource());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input = result.input;
    expect(input.findings).toEqual([]);
    expect(input.measurements).toEqual([]);
    expect(input.recommendations).toEqual([]);
    expect(input.critical_flags).toEqual([]);
    const ext = input.extensions?.x_care_draft as any;
    expect(ext.source).toBe("radiology_report_drafts");
    expect(ext.draft_id).toBe(101);
    expect(ext.quick_select_findings).toEqual([
      { finding_id: 10, params: { side: "left", severity: "mild", chronicity: "", level: "", value: "" }, source: "quickselect" },
    ]);
  });

  it("does NOT populate final signature-only fields (draft)", () => {
    const result = buildDraftD1WriterInput(completeSource());
    if (!result.ok) throw new Error("expected ok");
    expect(result.input.audit.signature.state).toBe("draft");
    expect(result.input.audit.signature.signed_by).toBeNull();
    expect(result.input.audit.signature.signed_role).toBeNull();
    expect(result.input.audit.signature.signed_at).toBeNull();
    expect(result.input.audit.audit_log_ref).toBeNull();
    expect(result.input.audit.revision).toBe(D3_DRAFT_REVISION);
    expect(result.input.provenance.revision).toBe(D3_DRAFT_REVISION);
  });

  it("accepts a draft with zero selected findings (extensions carries an empty list)", () => {
    const result = buildDraftD1WriterInput(completeSource({ findingSelections: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.input.extensions?.x_care_draft as any).quick_select_findings).toEqual([]);
    expect(result.input.provenance.input_methods).toEqual([]);
  });
});

describe("buildDraftD1WriterInput — skip when a required field can't be truthfully produced", () => {
  const cases: Array<[string, Partial<DraftD1Source>, string]> = [
    ["missing modality", { modality: null }, "study_context.modality"],
    ["missing body_region", { bodyRegion: "" }, "study_context.body_region"],
    ["missing study_type", { studyType: null }, "study_context.study_type"],
    ["missing templateId", { templateId: null }, "template_ref"],
    ["missing createdBy", { createdBy: null }, "provenance.created_by"],
    ["missing identifiers entirely", { identifiers: null }, "study_context.identifiers unavailable"],
    ["bad study_datetime", { identifiers: { ...completeSource().identifiers!, studyDatetimeIso: "not-a-date" } }, "study_datetime"],
    ["missing referring physician", { identifiers: { ...completeSource().identifiers!, referringPhysician: "" } }, "referring_physician"],
  ];
  for (const [label, override, expectedReasonFragment] of cases) {
    it(`skips: ${label}`, () => {
      const result = buildDraftD1WriterInput(completeSource(override));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.skipReasons.some((r) => r.includes(expectedReasonFragment))).toBe(true);
    });
  }
});

describe("buildAndValidateDraftD1Document — produces a D1-VALID document", () => {
  it("valid source → ok, validates clean, hash verifies", async () => {
    const result = await buildAndValidateDraftD1Document(completeSource());
    expect(result.ok, JSON.stringify((result as any).validationErrors ?? (result as any).skipReasons)).toBe(true);
    if (!result.ok) return;
    expect(result.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // the persisted hash verifies against the stored document
    expect(verifyContentSha256(result.document).ok).toBe(true);
    expect(result.document.audit.content_sha256).toBe(result.contentSha256);
    // draft: no final signature fields
    expect(result.document.audit.signature.state).toBe("draft");
    expect(result.document.audit.signature.signed_content_sha256).toBeNull();
    expect(result.document.audit.signature.signed_by).toBeNull();
    // findings:[]
    expect(result.document.findings).toEqual([]);
  });

  it("is deterministic: identical source → identical hash", async () => {
    const a = await buildAndValidateDraftD1Document(completeSource());
    const b = await buildAndValidateDraftD1Document(completeSource());
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.contentSha256).toBe(b.contentSha256);
  });

  it("a changed finding param changes the hash", async () => {
    const base = await buildAndValidateDraftD1Document(completeSource());
    const changed = await buildAndValidateDraftD1Document(
      completeSource({
        findingSelections: [
          { findingId: 10, params: { side: "right", severity: "severe", chronicity: "", level: "", value: "" }, source: "quickselect" },
        ],
      }),
    );
    if (!base.ok || !changed.ok) throw new Error("expected ok");
    expect(changed.contentSha256).not.toBe(base.contentSha256);
  });

  it("adding a finding selection changes the hash", async () => {
    const base = await buildAndValidateDraftD1Document(completeSource());
    const more = await buildAndValidateDraftD1Document(
      completeSource({
        findingSelections: [
          ...completeSource().findingSelections,
          { findingId: 20, params: { side: "", severity: "", chronicity: "chronic", level: "L4-L5", value: "8" }, source: "quickselect" },
        ],
      }),
    );
    if (!base.ok || !more.ok) throw new Error("expected ok");
    expect(more.contentSha256).not.toBe(base.contentSha256);
  });

  it("incomplete source → skip (not ok), never throws", async () => {
    const result = await buildAndValidateDraftD1Document(completeSource({ identifiers: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skipReasons.length).toBeGreaterThan(0);
  });
});
