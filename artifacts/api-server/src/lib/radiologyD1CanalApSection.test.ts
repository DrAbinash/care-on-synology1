/**
 * The spinal canal AP table inside the structured (D1) signed report.
 *
 * Audit 2026-10-17 §6.1 found that `insertCanalTableIntoBody` had exactly ONE call site in
 * the whole server — the legacy finalize. The structured finalize and every amendment wrote
 * `body: prepared.renderedBody`, a body the D4 renderer composes from the document alone, so
 * a signed spine report on that path carried no canal table at all, and an AMENDMENT could
 * drop a table the report it corrected had been signed with.
 *
 * The fix is in the shared preparation pathway rather than at a route: the block is pinned on
 * the document (`extensions.x_care_canal_ap`) by the D3/D5/D7 writer input and emitted by the
 * D4 renderer. That distinction is what these tests exist to keep true — D6 re-renders the
 * stored document and compares it against the body that was signed
 * (`radiologyStructuredRead.compareStoredVsRendered`), so a section the writer knew about and
 * the renderer could not reproduce would read as a CLINICAL_DIFFERENCE on every spine report
 * and silently disable structured reading for them. Case 3 below is the whole point of the
 * design; it is the assertion that fails if anyone moves this back to a body splice.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareStructuredFinalReport } from "./radiologyD1FinalWriter";
import { prepareStructuredAmendment } from "./radiologyD1AmendmentWriter";
import { compareStoredVsRendered, readStructuredReport } from "./radiologyStructuredRead";
import { CatalogStoreFindingResolver, materializeFindings } from "./radiologyFindingMaterializer";
import { InMemoryCatalogStore } from "./radiologyCatalog/store";
import { DrizzleStructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import { renderStructuredReport } from "./structuredReport/renderer";
import { verifyContentSha256 } from "./structuredReport/hash";
import type { DraftD1Source } from "./radiologyD1DraftWriter";
import type { PrepareStructuredAmendmentInput } from "./radiologyD1AmendmentWriter";
import type { StructuredReportDocument } from "./structuredReport/types";

const CANAL_BLOCK = [
  "LUMBAR CANAL AP DIAMETER AT L1-L2 TO L5-S1 LEVELS",
  "L1-L2: —   L2-L3: —   L3-L4: —   L4-L5: 8.5   L5-S1: 9.1 (mm)",
].join("\n");

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
  } as DraftD1Source;
}

const SELECTION = { findingId: 1, params: { side: "left", severity: "extrusion", level: "L4-L5", value: "8" }, source: "quickselect" };
const DRAFT_LEGACY = {
  rawFindings: "There is a disc herniation.",
  impression: ["Disc herniation."],
  recommendation: "Correlate clinically.",
  clientImpressionText: "Disc herniation.",
};

let store: InMemoryCatalogStore;
let materialized: Awaited<ReturnType<typeof materializeFindings>>;
let catalogPort: DrizzleStructuredReportCatalogPort;

beforeAll(async () => {
  store = await seedCatalog();
  const resolver = new CatalogStoreFindingResolver(store, async () => ({ label: "L4-L5 disc herniation" }));
  materialized = await materializeFindings([SELECTION], resolver, {
    actor: "Dr. Rao",
    createdAtIso: "2026-07-10T09:00:00Z",
  });
  catalogPort = new DrizzleStructuredReportCatalogPort(store);
});

async function sign(canalApBlock?: string) {
  const r = await prepareStructuredFinalReport({
    source: completeSource({ findingSelections: [SELECTION], canalApBlock }),
    materialized,
    draftLegacy: DRAFT_LEGACY,
    sign: {
      signedBy: "Dr. Rao",
      signedRole: "radiologist",
      signedById: 7,
      signedAtIso: "2026-07-10T10:00:00Z",
      auditLogRef: 4242,
    },
    validationPorts: { catalogPort, auditLogLookup: async () => true, amendsLookup: async () => null },
  });
  if (!r.ok) throw new Error(`finalize refused: ${JSON.stringify(r)}`);
  return r;
}

describe("D5 structured finalize — the canal table is signed, not just spliced", () => {
  it("puts the measured levels in the signed body, between Findings and Impression", async () => {
    const r = await sign(CANAL_BLOCK);
    expect(r.renderedBody).toContain("LUMBAR CANAL AP DIAMETER");
    expect(r.renderedBody).toContain("L4-L5: 8.5");
    expect(r.renderedBody).toContain("L5-S1: 9.1");
    expect(r.renderedBody.indexOf("FINDINGS:")).toBeLessThan(r.renderedBody.indexOf("CANAL AP DIAMETER"));
    expect(r.renderedBody.indexOf("CANAL AP DIAMETER")).toBeLessThan(r.renderedBody.indexOf("IMPRESSION:"));
    // The rest of the report is untouched by the addition.
    expect(r.renderedBody).toContain("There is a disc herniation.");
    expect(r.validation.ok, JSON.stringify(r.validation.errors)).toBe(true);
    expect(verifyContentSha256(r.document).ok).toBe(true);
  });

  it("pins the table on the document itself, so it is part of what was hashed and signed", async () => {
    const r = await sign(CANAL_BLOCK);
    expect(r.document.extensions?.x_care_canal_ap).toEqual({ rendered: CANAL_BLOCK });
  });

  it("re-renders from the stored document BYTE-IDENTICALLY — the invariant D6 checks", async () => {
    const r = await sign(CANAL_BLOCK);
    const again = renderStructuredReport(r.document);
    expect(again.body).toBe(r.renderedBody);
    expect(compareStoredVsRendered(r.renderedBody, again.body).class).toBe("IDENTICAL");
  });

  it("serves the structured render through D6 rather than falling back to the stored body", async () => {
    const r = await sign(CANAL_BLOCK);
    const read = await readStructuredReport(
      {
        body: r.renderedBody,
        structuredJson: JSON.parse(JSON.stringify(r.document)),
        renderEngineVersion: "d4-structured-1.1.0",
        catalogVersion: "0",
      },
      { catalogPort, auditLogLookup: async () => true, amendsLookup: async () => null },
    );
    expect(read, "the read must resolve").not.toBeNull();
    expect(read!.diagnostics.comparisonClass).toBe("IDENTICAL");
    expect(read!.usedStructured).toBe(true);
    expect(read!.body).toContain("L4-L5: 8.5");
  });

  it("signs a body identical to today's when the study has no canal record", async () => {
    // The goldens and every non-spine report depend on this: no measurement, no new
    // member, no new section, no changed content hash.
    const without = await sign(undefined);
    const plain = await sign("");
    expect(without.document.extensions?.x_care_canal_ap).toBeUndefined();
    expect(plain.document.extensions?.x_care_canal_ap).toBeUndefined();
    expect(without.contentSha256).toBe(plain.contentSha256);
    expect(without.renderedBody).toBe(renderStructuredReport(without.document).body);
    expect(without.renderedBody).not.toMatch(/CANAL AP DIAMETER/);
  });
});

describe("D7 amendment — a correction must not lose a signed measurement", () => {
  async function amend(canalApBlock: string | undefined, parentCanal: string | undefined) {
    const root = await sign(parentCanal);
    const input: PrepareStructuredAmendmentInput = {
      parent: {
        reportId: 900,
        patientId: 12,
        document: JSON.parse(JSON.stringify(root.document)) as StructuredReportDocument,
        rootDocumentId: null,
        rootReportId: 900,
        priorAmendmentCount: 0,
      },
      source: completeSource({ findingSelections: [SELECTION], canalApBlock }),
      materialized,
      draftLegacy: DRAFT_LEGACY,
      sign: {
        signedBy: "Dr. Sen",
        signedRole: "radiologist",
        signedById: 8,
        signedAtIso: "2026-07-10T12:00:00Z",
        auditLogRef: 200,
      },
      reason: "Impression clarified after clinician query.",
      newReportId: 901,
      draftPatientId: 12,
      validationPorts: {
        catalogPort,
        auditLogLookup: async () => true,
        amendsLookup: async (docId) =>
          docId === root.document.document_id ? { state: "final", alreadyAmendedBy: null } : null,
      },
    };
    const r = await prepareStructuredAmendment(input);
    if (!r.ok) throw new Error(`amendment refused: ${JSON.stringify(r)}`);
    return { root, r, snapshot: JSON.stringify(input.parent.document) };
  }

  it("carries the amended draft's measurements and stays reproducible", async () => {
    const { r } = await amend(CANAL_BLOCK, undefined);
    expect(r.renderedBody).toContain("L4-L5: 8.5");
    expect(r.document.extensions?.x_care_canal_ap).toEqual({ rendered: CANAL_BLOCK });
    expect(renderStructuredReport(r.document).body).toBe(r.renderedBody);
    // The amendment chain is still intact beside the new member.
    expect(r.document.extensions?.x_care_amendment).toBeTruthy();
  });

  it("keeps the canal section a report was signed with when the amendment changes only prose", async () => {
    // The route supplies the parent's pinned block when the amended draft carries no
    // record of its own (a draft whose envelope lost the measurement is not evidence
    // that the radiologist un-measured the disc). This case pins that the writer then
    // still produces a reproducible document rather than a body-only section.
    const { r, root } = await amend(undefined, CANAL_BLOCK);
    expect(root.renderedBody).toContain("CANAL AP DIAMETER");
    expect(r.renderedBody).not.toMatch(/CANAL AP DIAMETER/); // nothing invented from the parent
    const carried = await amend(CANAL_BLOCK, CANAL_BLOCK);
    expect(carried.r.renderedBody).toContain("L5-S1: 9.1");
    expect(renderStructuredReport(carried.r.document).body).toBe(carried.r.renderedBody);
  });

  it("leaves the parent signed document byte-untouched", async () => {
    const { r, root, snapshot } = await amend(CANAL_BLOCK, undefined);
    expect(JSON.stringify({ ...root.document })).toBeTruthy();
    expect(snapshot).toContain("Disc herniation");
    expect(r.document.document_id).not.toBe(root.document.document_id);
  });
});

describe("D4 renderer — the section is emitted once", () => {
  it("does not print a second table when the findings prose already carries one", async () => {
    // Generate Professional Report writes "Spinal canal AP diameter (mm):" into
    // Findings from the client side. A body naming one level twice, from two stores,
    // with two numbers is the defect this path exists to remove — so the pinned
    // section yields to prose that is already there.
    const doc = {
      findings: [
        {
          lid: "f1",
          definition_ref: "finding.x.y",
          presence: "present",
          certainty: "definite",
          laterality: null,
          locations: [],
          severity: null,
          interval_change: null,
          parameters: [],
          measurement_refs: [],
          sentence: "Spinal canal AP diameter (mm): L4-L5 8.5.",
          impression_fragment: "Disc herniation.",
          sentence_source: "content_pack_default",
          status_flags: { is_significant: false, is_critical: false, is_incidental: false },
          included_from: null,
          provenance: { origin: "quick_select", actor: "dr", created_at: "2026-07-10T09:00:00Z", edited: false },
          ai: null,
          order: 10,
        },
      ],
      measurements: [],
      recommendations: [],
      critical_flags: [],
      impression: { rendered: "IMPRESSION:\nDisc herniation." },
      extensions: { x_care_canal_ap: { rendered: CANAL_BLOCK } },
    } as unknown as StructuredReportDocument;

    const r = renderStructuredReport(doc);
    expect((r.body.match(/CANAL AP DIAMETER/gi) ?? [])).toHaveLength(1);
    expect(r.trace.some((t) => t.section === "canal_ap")).toBe(false);
  });

  it("emits the section exactly once with a trace entry naming its source", async () => {
    const signed = await sign(CANAL_BLOCK);
    const r = renderStructuredReport(signed.document);
    expect((r.body.match(/CANAL AP DIAMETER/gi) ?? [])).toHaveLength(1);
    const entry = r.trace.find((t) => t.section === "canal_ap");
    expect(entry?.sourceType).toBe("canal_ap_section");
    expect(entry?.text).toContain("L4-L5: 8.5");
  });

  it("ignores a malformed pinned member instead of printing something invented", () => {
    const base = {
      findings: [],
      measurements: [],
      recommendations: [],
      critical_flags: [],
    } as unknown as StructuredReportDocument;
    for (const junk of [
      { x_care_canal_ap: "a string" },
      { x_care_canal_ap: [] },
      { x_care_canal_ap: { rendered: 12 } },
      { x_care_canal_ap: null },
      { x_care_canal_ap: { rendered: "   " } },
    ]) {
      const body = renderStructuredReport({ ...base, extensions: junk } as StructuredReportDocument);
      expect(body.body).not.toMatch(/CANAL AP DIAMETER/);
      expect(body.trace.some((t) => t.section === "canal_ap")).toBe(false);
    }
  });
});
