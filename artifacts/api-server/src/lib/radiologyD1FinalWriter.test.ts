import { describe, it, expect, beforeAll } from "vitest";
import {
  canStructuredSign,
  compareAgainstDraft,
  normalizeClinicalLines,
  prepareStructuredFinalReport,
  buildFinalD1Source,
  parseDraftImpression,
  D5_FINAL_REVISION,
  type PrepareStructuredFinalInput,
  type SignerSession,
} from "./radiologyD1FinalWriter";
import { materializeFindings, CatalogStoreFindingResolver } from "./radiologyFindingMaterializer";
import { InMemoryCatalogStore } from "./radiologyCatalog/store";
import { DrizzleStructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { verifyContentSha256 } from "./structuredReport/hash";
import { renderStructuredReport } from "./structuredReport/renderer";
import type { DraftD1Source } from "./radiologyD1DraftWriter";
import type { MaterializationOutput } from "./radiologyFindingMaterializer";

// Ticket D5 — pure finalize preparation. No DB, no clock, no flags.

// ── Sign authority ────────────────────────────────────────────────────────────

function session(overrides: Partial<SignerSession> = {}): SignerSession {
  return { subjectId: 7, subjectName: "Dr. Rao", role: "radiologist", permissions: ["/reports", "/reports:sign"], ...overrides };
}

describe("canStructuredSign — Phase 5 authority rules", () => {
  it("allows an explicit /reports:sign grant", () => {
    expect(canStructuredSign(session()).allowed).toBe(true);
  });
  it("allows admin / super_admin without the explicit grant", () => {
    expect(canStructuredSign(session({ role: "admin", permissions: [] })).allowed).toBe(true);
    expect(canStructuredSign(session({ role: "super_admin", permissions: [] })).allowed).toBe(true);
  });
  it("denies a bare /reports module permission (module access is not sign authority)", () => {
    const r = canStructuredSign(session({ permissions: ["/reports"] }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("missing_sign_permission");
  });
  it("denies a typist even WITH the :sign grant (hard deny-list)", () => {
    const r = canStructuredSign(session({ role: "typist", permissions: ["/reports:sign"] }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("typist");
  });
  it("denies ai/system/bot identities (AI cannot sign)", () => {
    for (const role of ["ai", "system", "bot"]) {
      expect(canStructuredSign(session({ role, permissions: ["/reports:sign"] })).allowed).toBe(false);
    }
  });
  it("denies a missing/nameless session", () => {
    expect(canStructuredSign(null).allowed).toBe(false);
    expect(canStructuredSign(session({ subjectName: "  " })).allowed).toBe(false);
  });
});

// ── Equivalence policy ───────────────────────────────────────────────────────

describe("normalizeClinicalLines — approved formatting normalizations only", () => {
  it("strips numbering, trims, collapses whitespace, drops blanks", () => {
    expect(normalizeClinicalLines("1. First   line.\n\n 2) Second line. \n")).toEqual(["First line.", "Second line."]);
  });
  it("does NOT normalize wording, case of words, or punctuation", () => {
    expect(normalizeClinicalLines("Severe stenosis.")).not.toEqual(normalizeClinicalLines("Mild stenosis."));
    expect(normalizeClinicalLines("severe stenosis.")).not.toEqual(normalizeClinicalLines("Severe stenosis."));
  });
});

// ── Full preparation (catalog-backed happy path) ─────────────────────────────

async function seedCatalog() {
  const store = new InMemoryCatalogStore(() => new Date("2026-07-10T00:00:00Z"));
  const cat = await store.insert("finding_categories", { key: "spine", label: "Spine" });
  const def = await store.insert("finding_definitions", {
    key: "spine.disc_herniation", categoryId: cat.id, label: "Disc herniation",
    narrative: "There is a disc herniation.", impression: "Disc herniation.",
  });
  await store.insert("finding_aliases", { findingId: def.id, aliasKey: "L4-L5 disc herniation", normalized: "l4-l5 disc herniation", source: "legacy_quick_select" });
  await store.insert("finding_severity_bindings", { findingId: def.id, key: "extrusion", label: "Extrusion", rank: 3 });
  await store.insert("finding_locations", { findingId: def.id, key: "l4_l5", label: "L4-L5", laterality: null });
  await store.insert("finding_measurement_bindings", { findingId: def.id, key: "canal_ap_diameter", label: "Canal AP", unit: "mm" });
  await store.insert("finding_recommendations", { findingId: def.id, recommendationText: "Correlate clinically.", priority: "routine" });
  return store;
}

function completeSource(overrides: Partial<DraftD1Source> = {}): DraftD1Source {
  return {
    draftId: 555,
    createdBy: "Dr. Rao",
    createdAtIso: "2026-07-10T09:00:00Z",
    updatedAtIso: "2026-07-10T09:05:00Z",
    modality: "MRI",
    bodyRegion: "LS Spine",
    studyType: "MRI LS Spine",
    templateId: "MRI_LS_SPINE",
    identifiers: {
      studyInstanceUid: "1.2.840.113619.2.55.3.555",
      accessionNumber: "ACC-555",
      patientRefValue: "PAT-555",
      studyDatetimeIso: "2026-07-10T08:55:00Z",
      referringPhysician: "dr_mehta",
      performingPhysician: "tech_priya",
    },
    catalogSchemaVersion: "0",
    contentPackVersions: {},
    aiRulesVersions: {},
    findingSelections: [],
    ...overrides,
  };
}

const SELECTION = { findingId: 1, params: { side: "left", severity: "extrusion", level: "L4-L5", value: "8" }, source: "quickselect" };
const CTX = { actor: "Dr. Rao", createdAtIso: "2026-07-10T09:00:00Z" };

let store: InMemoryCatalogStore;
let materialized: MaterializationOutput;
let catalogPort: DrizzleStructuredReportCatalogPort;

beforeAll(async () => {
  store = await seedCatalog();
  const resolver = new CatalogStoreFindingResolver(store, async () => ({ label: "L4-L5 disc herniation" }));
  materialized = await materializeFindings([SELECTION], resolver, CTX);
  catalogPort = new DrizzleStructuredReportCatalogPort(store);
});

/** Draft legacy fields exactly matching the catalog output (pure Quick-Select,
 *  unedited) — the scenario where structured signing is permitted. */
function matchingDraftLegacy() {
  return {
    rawFindings: "There is a disc herniation.",
    impression: ["Disc herniation."],
    recommendation: "Correlate clinically.",
    clientImpressionText: "Disc herniation.",
  };
}

function prepareInput(overrides: Partial<PrepareStructuredFinalInput> = {}): PrepareStructuredFinalInput {
  return {
    source: completeSource({ findingSelections: [SELECTION] }),
    materialized,
    draftLegacy: matchingDraftLegacy(),
    sign: {
      signedBy: "Dr. Rao",
      signedRole: "radiologist",
      signedById: 7,
      signedAtIso: "2026-07-10T10:00:00Z",
      auditLogRef: 4242,
    },
    validationPorts: {
      catalogPort,
      auditLogLookup: async () => true,
      amendsLookup: async () => null,
    },
    ...overrides,
  };
}

describe("prepareStructuredFinalReport — happy path (equivalent, signed)", () => {
  it("produces a VALID final document with full signature fields and verified hash", async () => {
    const r = await prepareStructuredFinalReport(prepareInput());
    expect(r.ok, JSON.stringify(!r.ok ? r : "", null, 2)).toBe(true);
    if (!r.ok) return;

    // final signature fields (only in final mode)
    const sig = r.document.audit.signature;
    expect(sig.state).toBe("final");
    expect(sig.signed_by).toBe("Dr. Rao");     // server session identity only
    expect(sig.signed_role).toBe("radiologist");
    expect(sig.signed_at).toBe("2026-07-10T10:00:00Z");
    expect(sig.signed_content_sha256).toBe(r.contentSha256);
    expect(r.document.audit.content_sha256).toBe(r.contentSha256);
    expect(r.document.audit.audit_log_ref).toBe(4242);

    // revision correctness (draft=1 → final=2, both counters reconciled)
    expect(r.document.audit.revision).toBe(D5_FINAL_REVISION);
    expect(r.document.provenance.revision).toBe(D5_FINAL_REVISION);
    expect(r.document.audit.revisions.map((x) => x.action)).toEqual(["created", "finalized"]);

    // validation passed in finalize mode; hash verifies
    expect(r.validation.ok).toBe(true);
    expect(verifyContentSha256(r.document).ok).toBe(true);

    // rendered body comes from D4 and matches an independent render
    expect(r.renderedBody).toBe(renderStructuredReport(r.document).body);
    expect(r.renderedBody).toContain("FINDINGS:");
    expect(r.renderedBody).toContain("IMPRESSION:");
    expect(r.renderedBody).toContain("There is a disc herniation.");

    // equivalence verdict
    expect(r.equivalence.verdict).toBe("equivalent");
  });

  it("R14b is enforced for real: a failing auditLogLookup blocks the sign", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      validationPorts: { catalogPort, auditLogLookup: async () => false, amendsLookup: async () => null },
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("validation_failed");
    expect(r.validationErrors!.some((e) => e.rule === "R14b")).toBe(true);
  });

  it("is deterministic: identical input → identical content hash and body", async () => {
    const a = await prepareStructuredFinalReport(prepareInput());
    const b = await prepareStructuredFinalReport(prepareInput());
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.contentSha256).toBe(b.contentSha256);
    expect(a.renderedBody).toBe(b.renderedBody);
  });

  it("approved formatting differences (numbering/whitespace) still count as equivalent", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      draftLegacy: {
        rawFindings: "  There is a disc   herniation. ",
        impression: ["1. Disc herniation."],
        recommendation: "1) Correlate clinically.",
        clientImpressionText: " 1.  Disc herniation. ",
      },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.equivalence.verdict).toBe("equivalent");
  });
});

describe("prepareStructuredFinalReport — divergence & failure paths", () => {
  it("an unapproved clinical-text difference is reported as clinical_divergence with per-section diagnostics", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      draftLegacy: {
        rawFindings: "There is a LARGE disc herniation with caudal migration.", // radiologist edited
        impression: ["Disc herniation."],
        recommendation: "Correlate clinically.",
        clientImpressionText: "Disc herniation.",
      },
    }));
    expect(r.ok).toBe(true); // preparation succeeds; the POLICY decision is the route's
    if (!r.ok) return;
    expect(r.equivalence.verdict).toBe("clinical_divergence");
    expect(r.equivalence.differences.some((d) => d.section === "findings")).toBe(true);
  });

  it("a stale draft (client impression ≠ draft impression) is clinical_divergence", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      draftLegacy: { ...matchingDraftLegacy(), clientImpressionText: "Something newer the draft never saved." },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.equivalence.verdict).toBe("clinical_divergence");
    expect(r.equivalence.staleDraft).toBe(true);
  });

  it("adapter skip (missing identifiers) → adapter_skip with reasons", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      source: completeSource({ identifiers: null, findingSelections: [SELECTION] }),
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("adapter_skip");
    expect(r.skipReasons!.length).toBeGreaterThan(0);
  });

  it("no materialized findings → empty D4 body → render_empty (an envelope can never be a signed body)", async () => {
    const empty: MaterializationOutput = { findings: [], measurements: [], recommendations: [], skipped: [] };
    const r = await prepareStructuredFinalReport(prepareInput({ materialized: empty }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("render_empty");
  });

  it("missing signer identity → adapter_skip (authorship can never be defaulted)", async () => {
    const r = await prepareStructuredFinalReport(prepareInput({
      sign: { signedBy: "", signedRole: "radiologist", signedById: 7, signedAtIso: "2026-07-10T10:00:00Z", auditLogRef: 1 },
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("adapter_skip");
  });
});

describe("buildFinalD1Source / parseDraftImpression — row assembly helpers", () => {
  it("maps draft + worklist + instance rows to the truthful source shape", () => {
    const src = buildFinalD1Source(
      {
        id: 555, worklistId: 9, patientId: 12, templateId: "MRI_LS_SPINE", modality: "MRI",
        studyName: "MRI LS Spine", rawFindings: "x", impression: '["a"]', recommendation: "r",
        createdBy: "Dr. Rao", createdAt: new Date("2026-07-10T09:00:00Z"), updatedAt: new Date("2026-07-10T09:05:00Z"),
      },
      {
        patientId: 12, studyInstanceUID: "1.2.3", accessionNumber: "ACC-1", studyDate: "20260710",
        studyDescription: "LS Spine", referringDoctor: "dr_mehta", assignedRadiologist: "Dr. Rao",
      },
      [{ findingId: 1, structuredJson: { side: "left" }, source: "quickselect" }],
    );
    expect(src.draftId).toBe(555);
    expect(src.identifiers?.studyDatetimeIso).toBe("2026-07-10T00:00:00Z"); // DICOM date converted
    expect(src.findingSelections).toEqual([{ findingId: 1, params: { side: "left" }, source: "quickselect" }]);
  });

  it("parseDraftImpression tolerates null/garbage and non-arrays", () => {
    expect(parseDraftImpression(null)).toEqual([]);
    expect(parseDraftImpression("not json")).toEqual([]);
    expect(parseDraftImpression('{"a":1}')).toEqual([]);
    expect(parseDraftImpression('["one","two"]')).toEqual(["one", "two"]);
  });
});
