import { describe, expect, it } from "vitest";
import {
  ABSENT_DRAFT_REVISION,
  DRAFT_REVISION_LOCK_CLASS,
  decideDraftRevision,
  draftRevisionOf,
  type DraftRevisionSource,
} from "./radiologyDraftRevision";

/**
 * P0-2 — the pure half of the draft CAS: what a revision is, and when a save may
 * write. The route behaviour is proven against real Postgres in
 * `routes/radiologyDraftRevision.request.test.ts`; these pin the derivation
 * itself, including the properties that only make sense on paper (a token must
 * not move when nothing a save can replace has moved).
 */

const BASE: DraftRevisionSource = {
  templateId: null,
  modality: "MR",
  studyName: "MRI Brain",
  clinicalHistory: "Headache for three weeks.",
  rawFindings: "No acute intracranial abnormality is seen.",
  findingsSections: '{"Technique":"Multiplanar MRI brain without contrast."}',
  impression: '["Normal study."]',
  recommendation: "Please correlate with clinical findings.",
  formattedReportHtml: null,
  formattedReportText: null,
  structuredJson: { careObservationLedger: { patches: [] } },
};

describe("draftRevisionOf", () => {
  it("is a defined token for the study that has no draft row yet", () => {
    expect(draftRevisionOf(null)).toBe(ABSENT_DRAFT_REVISION);
    expect(draftRevisionOf(undefined)).toBe(ABSENT_DRAFT_REVISION);
    // "no report yet" must not be the same value as some content, or a console
    // that read emptily could name a token that matches a row.
    expect(ABSENT_DRAFT_REVISION).not.toBe(draftRevisionOf({ ...BASE, rawFindings: "" }));
  });

  it("ignores updated_at, which this route rewrites itself after the row read", () => {
    // save-draft writes the row, then the A4 cache regeneration, the D3 writer and
    // persistCareStructuredJsonPatch update it again — each one stamping
    // `.$onUpdate(() => new Date())`. A token that moved with those would refuse
    // the same client's very next honest save.
    const withDrift = { ...BASE } as DraftRevisionSource & { updatedAt?: unknown };
    withDrift.updatedAt = new Date("2026-10-30T10:00:00.000Z");
    expect(draftRevisionOf(withDrift)).toBe(draftRevisionOf(BASE));
  });

  it("moves when the prose moves", () => {
    expect(draftRevisionOf({ ...BASE, rawFindings: "A new sentence." }))
      .not.toBe(draftRevisionOf(BASE));
    expect(draftRevisionOf({ ...BASE, impression: JSON.stringify(["A different impression."]) }))
      .not.toBe(draftRevisionOf(BASE));
  });

  it("moves when only the structured envelope moves", () => {
    // The audit's overwrite was prose, but a save also replaces the ledger, the
    // measurements and the spine capture state. Prose-only coverage would let a
    // console roll those back while every sentence still matched.
    const measured = {
      ...BASE,
      structuredJson: { careViewerMeasurements: { items: [{ id: "m1", value: 6.1 }] } },
    };
    expect(draftRevisionOf(measured)).not.toBe(draftRevisionOf(BASE));
    expect(draftRevisionOf({ ...BASE, structuredJson: null })).not.toBe(draftRevisionOf(BASE));
  });

  it("does not collide when a different split of the same characters is stored", () => {
    // Findings "A" + recommendation "B" and findings "AB" + recommendation ""
    // concatenate to the same string, so a token built on a bare join would call
    // them the same report and let one overwrite the other unseen. The unit
    // separator — which cannot occur in report prose — is what keeps them apart,
    // the same reasoning composePersistence.ts records.
    expect(draftRevisionOf({ ...BASE, rawFindings: "A", recommendation: "B" }))
      .not.toBe(draftRevisionOf({ ...BASE, rawFindings: "AB", recommendation: "" }));
  });

  it("leaves lifecycle columns out, so finalizing does not invalidate an open editor", () => {
    const finalized = {
      ...BASE,
      status: "FINAL",
      finalReportId: 512,
    } as DraftRevisionSource & { status: string; finalReportId: number };
    expect(draftRevisionOf(finalized)).toBe(draftRevisionOf(BASE));
  });
});

describe("decideDraftRevision", () => {
  it("does not guard a save that named no revision", () => {
    // Every surface that has never heard of revisions (the legacy generator page,
    // any older client) keeps the behaviour it has always had.
    expect(decideDraftRevision(undefined, BASE)).toEqual({ proceed: true, guarded: false });
    expect(decideDraftRevision(null, BASE)).toEqual({ proceed: true, guarded: false });
  });

  it("proceeds when the row still holds what the client named", () => {
    expect(decideDraftRevision(draftRevisionOf(BASE), BASE)).toEqual({ proceed: true, guarded: true });
  });

  it("refuses with the row's actual token when it moved", () => {
    const moved = { ...BASE, rawFindings: "Another console wrote this." };
    expect(decideDraftRevision(draftRevisionOf(BASE), moved))
      .toEqual({ proceed: false, current: draftRevisionOf(moved) });
  });

  it("refuses a first save that claimed no row when one exists", () => {
    expect(decideDraftRevision(ABSENT_DRAFT_REVISION, BASE).proceed).toBe(false);
    expect(decideDraftRevision(ABSENT_DRAFT_REVISION, null).proceed).toBe(true);
  });
});

describe("the advisory lock is namespaced", () => {
  it("takes a class half, so a study id cannot collide with another subsystem's key", () => {
    // pg_advisory_xact_lock(class, obj) — the two-arg form is what makes the key
    // per-study rather than global.
    expect(Number.isInteger(DRAFT_REVISION_LOCK_CLASS)).toBe(true);
    expect(DRAFT_REVISION_LOCK_CLASS).toBeGreaterThan(0);
    expect(DRAFT_REVISION_LOCK_CLASS).toBeLessThan(2 ** 31);
  });
});
