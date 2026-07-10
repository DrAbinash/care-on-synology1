import { describe, it, expect, beforeAll } from "vitest";
import {
  prepareStructuredAmendment,
  deriveAmendmentDocumentId,
  type PrepareStructuredAmendmentInput,
} from "./radiologyD1AmendmentWriter";
import { prepareStructuredFinalReport } from "./radiologyD1FinalWriter";
import { deriveDraftDocumentId, type DraftD1Source } from "./radiologyD1DraftWriter";
import { materializeFindings, CatalogStoreFindingResolver, type MaterializationOutput } from "./radiologyFindingMaterializer";
import { InMemoryCatalogStore } from "./radiologyCatalog/store";
import { DrizzleStructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { verifyContentSha256 } from "./structuredReport/hash";
import { readStructuredReport } from "./radiologyStructuredRead";
import type { StructuredReportDocument } from "./structuredReport/types";

// Ticket D7 — pure amendment preparation. The load-bearing fixture is a REAL
// chain: a D5-signed root, amended once, then amended again — all through the
// real writer/validator/renderer stack against a real in-memory catalog.

async function seedCatalog() {
  const store = new InMemoryCatalogStore(() => new Date("2026-07-10T00:00:00Z"));
  const cat = await store.insert("finding_categories", { key: "spine", label: "Spine" });
  const def = await store.insert("finding_definitions", {
    key: "spine.disc_herniation", categoryId: cat.id, label: "Disc herniation",
    narrative: "There is a disc herniation.", impression: "Disc herniation.",
  });
  await store.insert("finding_aliases", { findingId: def.id, aliasKey: "L4-L5 disc herniation", normalized: "l4-l5 disc herniation", source: "test" });
  await store.insert("finding_severity_bindings", { findingId: def.id, key: "extrusion", label: "Extrusion", rank: 3 });
  await store.insert("finding_locations", { findingId: def.id, key: "l4_l5", label: "L4-L5", laterality: null });
  await store.insert("finding_measurement_bindings", { findingId: def.id, key: "canal_ap_diameter", label: "Canal AP", unit: "mm" });
  await store.insert("finding_recommendations", { findingId: def.id, recommendationText: "Correlate clinically.", priority: "routine" });
  return store;
}

const SELECTION = { findingId: 1, params: { side: "left", severity: "extrusion", level: "L4-L5", value: "8" }, source: "quickselect" };
const DRAFT_LEGACY = {
  rawFindings: "There is a disc herniation.",
  impression: ["Disc herniation."],
  recommendation: "Correlate clinically.",
  clientImpressionText: "Disc herniation.",
};

function source(overrides: Partial<DraftD1Source> = {}): DraftD1Source {
  return {
    draftId: 555, createdBy: "Dr. Rao", createdAtIso: "2026-07-10T09:00:00Z", updatedAtIso: "2026-07-10T09:05:00Z",
    modality: "MRI", bodyRegion: "LS Spine", studyType: "MRI LS Spine", templateId: "MRI_LS_SPINE",
    identifiers: {
      studyInstanceUid: "1.2.840.113619.2.55.3.555", accessionNumber: "ACC-555", patientRefValue: "PAT-555",
      studyDatetimeIso: "2026-07-10T08:55:00Z", referringPhysician: "dr_mehta", performingPhysician: "tech_priya",
    },
    catalogSchemaVersion: "0", contentPackVersions: {}, aiRulesVersions: {}, findingSelections: [SELECTION],
    ...overrides,
  };
}

let catalogPort: DrizzleStructuredReportCatalogPort;
let materialized: MaterializationOutput;
let rootDocument: StructuredReportDocument; // D5-signed root

beforeAll(async () => {
  const store = await seedCatalog();
  const resolver = new CatalogStoreFindingResolver(store, async () => ({ label: "L4-L5 disc herniation" }));
  materialized = await materializeFindings([SELECTION], resolver, { actor: "Dr. Rao", createdAtIso: "2026-07-10T09:00:00Z" });
  catalogPort = new DrizzleStructuredReportCatalogPort(store);
  const prepared = await prepareStructuredFinalReport({
    source: source(), materialized, draftLegacy: DRAFT_LEGACY,
    sign: { signedBy: "Dr. Rao", signedRole: "radiologist", signedById: 7, signedAtIso: "2026-07-10T10:00:00Z", auditLogRef: 100 },
    validationPorts: { catalogPort, auditLogLookup: async () => true, amendsLookup: async () => null },
  });
  if (!prepared.ok) throw new Error("root fixture failed: " + JSON.stringify(prepared));
  rootDocument = prepared.document;
});

function amendmentInput(overrides: Partial<PrepareStructuredAmendmentInput> = {}): PrepareStructuredAmendmentInput {
  return {
    parent: { reportId: 900, patientId: 12, document: JSON.parse(JSON.stringify(rootDocument)), priorAmendmentCount: 0 },
    source: source(),
    materialized,
    draftLegacy: DRAFT_LEGACY,
    sign: { signedBy: "Dr. Sen", signedRole: "radiologist", signedById: 8, signedAtIso: "2026-07-10T12:00:00Z", auditLogRef: 200 },
    reason: "Left/right laterality corrected after clinician query.",
    newReportId: 901,
    draftPatientId: 12,
    validationPorts: {
      catalogPort,
      auditLogLookup: async () => true,
      amendsLookup: async (docId) => (docId === rootDocument.document_id ? { state: "final", alreadyAmendedBy: null } : null),
    },
    ...overrides,
  };
}

describe("deriveAmendmentDocumentId — disjoint id space", () => {
  it("is 26 chars, pattern-valid, 'A'-prefixed, deterministic, unique per row id", () => {
    const a = deriveAmendmentDocumentId(901);
    expect(a).toHaveLength(26);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.startsWith("A")).toBe(true);
    expect(deriveAmendmentDocumentId(901)).toBe(a);
    expect(deriveAmendmentDocumentId(902)).not.toBe(a);
  });
  it("can never collide with a draft-derived document_id (draft ids are 0-prefixed)", () => {
    expect(deriveDraftDocumentId(901).startsWith("0")).toBe(true);
    expect(deriveAmendmentDocumentId(901)).not.toBe(deriveDraftDocumentId(901));
  });
  it("rejects non-positive/non-integer ids", () => {
    expect(() => deriveAmendmentDocumentId(0)).toThrow();
    expect(() => deriveAmendmentDocumentId(-3)).toThrow();
    expect(() => deriveAmendmentDocumentId(1.5)).toThrow();
  });
});

describe("prepareStructuredAmendment — happy path (single amendment)", () => {
  it("produces a NEW valid signed document chained to the parent, parent untouched", async () => {
    const input = amendmentInput();
    const parentSnapshot = JSON.stringify(input.parent.document);
    const r = await prepareStructuredAmendment(input);
    expect(r.ok, JSON.stringify(!r.ok ? r : "")).toBe(true);
    if (!r.ok) return;

    // NEW document, NEW id, chained to the parent
    expect(r.document.document_id).toBe(deriveAmendmentDocumentId(901));
    expect(r.document.document_id).not.toBe(rootDocument.document_id);
    expect(r.document.audit.signature.amends_document_id).toBe(rootDocument.document_id);
    expect(r.document.audit.signature.state).toBe("final");
    expect(r.document.audit.signature.signed_by).toBe("Dr. Sen"); // session-derived

    // revision increments over the parent; milestone log appends
    expect(r.document.audit.revision).toBe(rootDocument.audit.revision + 1);
    expect(r.document.provenance.revision).toBe(r.document.audit.revision);
    expect(r.document.audit.revisions.map((x) => x.action)).toEqual(["created", "finalized", "amended"]);

    // chain metadata (root preserved, mandatory reason, sequence)
    expect(r.amendment).toMatchObject({
      amendsDocumentId: rootDocument.document_id,
      amendsReportId: 900,
      rootDocumentId: rootDocument.document_id,
      rootReportId: 900,
      sequenceNumber: 1,
      revision: rootDocument.audit.revision + 1,
    });
    const ext = r.document.extensions?.x_care_amendment as Record<string, unknown>;
    expect(ext.amendment_reason).toBe("Left/right laterality corrected after clinician query.");
    expect(ext.root_document_id).toBe(rootDocument.document_id);

    // hash verifies; renders through D4
    expect(verifyContentSha256(r.document).ok).toBe(true);
    expect(r.renderedBody).toContain("FINDINGS:");
    expect(r.equivalence.verdict).toBe("equivalent");

    // parent document byte-untouched
    expect(JSON.stringify(input.parent.document)).toBe(parentSnapshot);
  });

  it("is deterministic: identical input → identical document hash", async () => {
    const a = await prepareStructuredAmendment(amendmentInput());
    const b = await prepareStructuredAmendment(amendmentInput());
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.contentSha256).toBe(b.contentSha256);
  });
});

describe("prepareStructuredAmendment — deep chain (amend the amendment)", () => {
  it("second amendment chains to the first, carries the ROOT forward, revision + sequence increment", async () => {
    const first = await prepareStructuredAmendment(amendmentInput());
    if (!first.ok) throw new Error("first amendment failed");

    const second = await prepareStructuredAmendment(amendmentInput({
      parent: {
        reportId: 901, patientId: 12, document: first.document,
        rootDocumentId: first.amendment.rootDocumentId, rootReportId: first.amendment.rootReportId,
        priorAmendmentCount: 1,
      },
      sign: { signedBy: "Dr. Rao", signedRole: "radiologist", signedById: 7, signedAtIso: "2026-07-11T09:00:00Z", auditLogRef: 300 },
      reason: "Measurement transcription corrected.",
      newReportId: 902,
      validationPorts: {
        catalogPort, auditLogLookup: async () => true,
        amendsLookup: async (docId) => (docId === first.document.document_id ? { state: "final", alreadyAmendedBy: null } : null),
      },
    }));
    expect(second.ok, JSON.stringify(!second.ok ? second : "")).toBe(true);
    if (!second.ok) return;

    expect(second.document.audit.signature.amends_document_id).toBe(first.document.document_id);
    expect(second.amendment.rootDocumentId).toBe(rootDocument.document_id); // root preserved through the chain
    expect(second.amendment.rootReportId).toBe(900);
    expect(second.amendment.sequenceNumber).toBe(2);
    expect(second.document.audit.revision).toBe(rootDocument.audit.revision + 2); // monotonic
    expect(second.document.audit.revisions.map((x) => x.action)).toEqual(["created", "finalized", "amended", "amended"]);
    expect(verifyContentSha256(second.document).ok).toBe(true);
  });
});

describe("prepareStructuredAmendment — guards (Phase 5)", () => {
  it("missing/blank reason is rejected", async () => {
    for (const reason of ["", "   "]) {
      const r = await prepareStructuredAmendment(amendmentInput({ reason }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.stage).toBe("reason_required");
    }
  });

  it("cross-patient amendment is rejected", async () => {
    const r = await prepareStructuredAmendment(amendmentInput({ draftPatientId: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("cross_patient");
  });

  it("non-monotonic timestamp is rejected (amendment must be signed after the parent)", async () => {
    const r = await prepareStructuredAmendment(amendmentInput({
      sign: { signedBy: "Dr. Sen", signedRole: "radiologist", signedById: 8, signedAtIso: "2026-07-10T09:59:00Z", auditLogRef: 200 },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("timestamp_not_monotonic");
  });

  it("a tampered parent is never amended (hash gate)", async () => {
    const tampered = JSON.parse(JSON.stringify(rootDocument));
    tampered.findings[0].sentence = "tampered";
    const r = await prepareStructuredAmendment(amendmentInput({
      parent: { reportId: 900, patientId: 12, document: tampered },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("invalid_parent");
      expect(r.detail).toContain("tampered");
    }
  });

  it("a non-final or non-document parent is rejected (missing parent semantics)", async () => {
    const draftState = JSON.parse(JSON.stringify(rootDocument));
    draftState.audit.signature.state = "draft";
    for (const parentDoc of [null, {}, { kind: "other" }, draftState]) {
      const r = await prepareStructuredAmendment(amendmentInput({
        parent: { reportId: 900, patientId: 12, document: parentDoc },
      }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.stage).toBe("invalid_parent");
    }
  });

  it("R14c enforces the linear chain: an already-amended parent is rejected by the validator", async () => {
    const r = await prepareStructuredAmendment(amendmentInput({
      validationPorts: {
        catalogPort, auditLogLookup: async () => true,
        amendsLookup: async () => ({ state: "final", alreadyAmendedBy: deriveAmendmentDocumentId(950) }),
      },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("validation_failed");
      expect(r.validationErrors!.some((e) => e.rule === "R14c")).toBe(true);
    }
  });

  it("R14c rejects an amends target that resolves to nothing (missing prior document)", async () => {
    const r = await prepareStructuredAmendment(amendmentInput({
      validationPorts: { catalogPort, auditLogLookup: async () => true, amendsLookup: async () => null },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.validationErrors!.some((e) => e.rule === "R14c")).toBe(true);
  });
});

describe("D7 → D6 integration: the amendment document reads back cleanly", () => {
  it("readStructuredReport serves an amendment row as IDENTICAL with hash verified", async () => {
    const first = await prepareStructuredAmendment(amendmentInput());
    if (!first.ok) throw new Error("expected ok");
    const jsonbRoundTrip = JSON.parse(JSON.stringify(first.document));
    const r = await readStructuredReport(
      { body: first.renderedBody, structuredJson: jsonbRoundTrip, renderEngineVersion: "d4-structured-1.0.0", catalogVersion: "0" },
      {
        catalogPort,
        auditLogLookup: async () => true,
        amendsLookup: async (docId) => (docId === rootDocument.document_id ? { state: "final", alreadyAmendedBy: null } : null),
      },
    );
    expect(r.comparisonClass).toBe("IDENTICAL");
    expect(r.usedStructured).toBe(true);
    expect(r.diagnostics.hashVerified).toBe(true);
  });
});
