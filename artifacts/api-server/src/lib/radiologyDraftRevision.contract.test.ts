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

  it("ignores the applied-format stamp, which this route re-stamps on every save", () => {
    // Measured in the browser, not theorised: two Save clicks with no edit in
    // between produced three different revisions
    // (tmp/evidence/noop-churn-keys.json), and exactly ONE leaf of the 48,855
    // byte envelope differed — careReportFormatIdentity.appliedAt. The client
    // builds it from `new Date()` on every save (normalBootstrap
    // buildCareReportFormatIdentity) and the server substitutes `now()` when the
    // client omits it (structuredJsonColumn). So it is the envelope's own
    // `updated_at`, and the test above already states why that cannot be part of
    // a revision: a value that moves every time this route writes is not
    // evidence that the report changed.
    //
    // What it was while it churned: console B reads the row, console A leaves the
    // study (its pre-leave flush rewrites the envelope for no clinical reason),
    // and B's next honest save is refused with "Another window changed this
    // report" about a report no window changed.
    const stamped = (appliedAt: string): DraftRevisionSource => ({
      ...BASE,
      structuredJson: {
        kind: "care.structured_json_envelope",
        careReportFormatIdentity: {
          kind: "care.report_format_identity.v1",
          name: "LS Spine Normal",
          formatRevision: "ls-spine-normal-r7",
          appliedAt,
        },
        careObservationLedger: { patches: [{ id: "p1" }] },
      },
    });
    expect(draftRevisionOf(stamped("2026-10-30T17:38:47.150Z")))
      .toBe(draftRevisionOf(stamped("2026-10-30T17:38:54.245Z")));
    // And the token must still equal the row's own, so the client that was handed
    // it keeps being allowed to write.
    expect(decideDraftRevision(draftRevisionOf(stamped("2026-10-30T17:38:47.150Z")),
      stamped("2026-10-30T17:38:54.245Z"))).toEqual({ proceed: true, guarded: true });
  });

  it("keeps the format identity itself in the token, stamp stripped or not", () => {
    // Stripping the clock must not strip the fact. A console that rolled the
    // applied format back to another template changed the report and has to be
    // caught, or the guard would let one window's format overwrite another's.
    const identity = (over: Record<string, unknown>): DraftRevisionSource => ({
      ...BASE,
      structuredJson: { careReportFormatIdentity: {
        kind: "care.report_format_identity.v1",
        name: "LS Spine Normal",
        formatRevision: "ls-spine-normal-r7",
        appliedAt: "2026-10-30T17:38:47.150Z",
        ...over,
      } },
    });
    const plain = draftRevisionOf(identity({}));
    expect(draftRevisionOf(identity({ name: "LS Spine Degenerative" }))).not.toBe(plain);
    expect(draftRevisionOf(identity({ formatRevision: "ls-spine-normal-r8" }))).not.toBe(plain);
    expect(draftRevisionOf(identity({ reportTitle: "MRI LUMBAR SPINE" }))).not.toBe(plain);
    // Removing the identity outright is a content change too.
    expect(draftRevisionOf({ ...BASE, structuredJson: { careObservationLedger: { patches: [] } } }))
      .not.toBe(plain);
  });

  it("still sees every other envelope leaf move", () => {
    // The one path that is excluded is named, not guessed at, so an unrelated
    // key that happens to be called appliedAt elsewhere stays in the token.
    const withStamp = (value: string): DraftRevisionSource => ({
      ...BASE,
      structuredJson: {
        careViewerMeasurements: { items: [{ id: "m1", value: 6.1, appliedAt: value }] },
      },
    });
    expect(draftRevisionOf(withStamp("2026-10-30T00:00:00.000Z")))
      .not.toBe(draftRevisionOf(withStamp("2026-10-30T00:00:01.000Z")));
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
