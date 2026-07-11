import { describe, it, expect, beforeAll } from "vitest";
import {
  readStructuredReport,
  compareStoredVsRendered,
  normalizeBodyLines,
  type StructuredReadRow,
} from "./radiologyStructuredRead";
import { prepareStructuredFinalReport } from "./radiologyD1FinalWriter";
import { materializeFindings, CatalogStoreFindingResolver } from "./radiologyFindingMaterializer";
import { InMemoryCatalogStore } from "./radiologyCatalog/store";
import { DrizzleStructuredReportCatalogPort } from "./structuredReport/catalogAccess";
import type { StructuredReportDocument } from "./structuredReport/types";

// Ticket D6 — pure read pipeline. The load-bearing scenario uses a REAL
// D5-signed document (built by the real prepare + materializer + catalog),
// not a hand-mocked doc, so the read path is proven against exactly what the
// write path persists.

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

let signedDocument: StructuredReportDocument;
let signedBody: string;
let catalogPort: DrizzleStructuredReportCatalogPort;
const auditLookupTrue = async () => true;

beforeAll(async () => {
  const store = await seedCatalog();
  const resolver = new CatalogStoreFindingResolver(store, async () => ({ label: "L4-L5 disc herniation" }));
  const selection = { findingId: 1, params: { side: "left", severity: "extrusion", level: "L4-L5", value: "8" }, source: "quickselect" };
  const materialized = await materializeFindings([selection], resolver, { actor: "Dr. Rao", createdAtIso: "2026-07-10T09:00:00Z" });
  catalogPort = new DrizzleStructuredReportCatalogPort(store);
  const prepared = await prepareStructuredFinalReport({
    source: {
      draftId: 555, createdBy: "Dr. Rao", createdAtIso: "2026-07-10T09:00:00Z", updatedAtIso: "2026-07-10T09:05:00Z",
      modality: "MRI", bodyRegion: "LS Spine", studyType: "MRI LS Spine", templateId: "MRI_LS_SPINE",
      identifiers: {
        studyInstanceUid: "1.2.840.113619.2.55.3.555", accessionNumber: "ACC-555", patientRefValue: "PAT-555",
        studyDatetimeIso: "2026-07-10T08:55:00Z", referringPhysician: "dr_mehta", performingPhysician: "tech_priya",
      },
      catalogSchemaVersion: "0", contentPackVersions: {}, aiRulesVersions: {}, findingSelections: [selection],
    },
    materialized,
    draftLegacy: { rawFindings: "There is a disc herniation.", impression: ["Disc herniation."], recommendation: "Correlate clinically.", clientImpressionText: "Disc herniation." },
    sign: { signedBy: "Dr. Rao", signedRole: "radiologist", signedById: 7, signedAtIso: "2026-07-10T10:00:00Z", auditLogRef: 4242 },
    validationPorts: { catalogPort, auditLogLookup: auditLookupTrue, amendsLookup: async () => null },
  });
  if (!prepared.ok) throw new Error("fixture prepare failed: " + JSON.stringify(prepared));
  signedDocument = prepared.document;
  signedBody = prepared.renderedBody;
});

function signedRow(overrides: Partial<StructuredReadRow> = {}): StructuredReadRow {
  return {
    body: signedBody,
    structuredJson: JSON.parse(JSON.stringify(signedDocument)), // jsonb-like copy
    renderEngineVersion: "d4-structured-1.0.0",
    catalogVersion: "0",
    ...overrides,
  };
}

const PORTS = { get catalogPort() { return catalogPort; }, auditLogLookup: auditLookupTrue };

// ── compareStoredVsRendered (Phase 3) ────────────────────────────────────────

describe("compareStoredVsRendered", () => {
  it("byte-equal → IDENTICAL", () => {
    expect(compareStoredVsRendered("A\nB", "A\nB").class).toBe("IDENTICAL");
  });
  it("numbering / whitespace / blank lines / heading case → APPROVED_FORMATTING_ONLY", () => {
    const stored = "Impression:\n1. Disc herniation.\n\n  Correlate   clinically.";
    const rendered = "IMPRESSION:\nDisc herniation.\nCorrelate clinically.";
    expect(compareStoredVsRendered(stored, rendered).class).toBe("APPROVED_FORMATTING_ONLY");
  });
  it("a single changed clinical word → CLINICAL_DIFFERENCE with divergent line context", () => {
    const cmp = compareStoredVsRendered("Severe stenosis.", "Mild stenosis.");
    expect(cmp.class).toBe("CLINICAL_DIFFERENCE");
    expect(cmp.divergentLines[0]).toEqual({ stored: "Severe stenosis.", rendered: "Mild stenosis." });
  });
  it("an extra line on either side → CLINICAL_DIFFERENCE (never silently dropped)", () => {
    expect(compareStoredVsRendered("A.\nB.", "A.").class).toBe("CLINICAL_DIFFERENCE");
    expect(compareStoredVsRendered("A.", "A.\nB.").class).toBe("CLINICAL_DIFFERENCE");
  });
  it("normalizeBodyLines uppercases ONLY the renderer's finite heading set", () => {
    expect(normalizeBodyLines("Impression:\nno acute lesion.")).toEqual(["IMPRESSION:", "no acute lesion."]);
    // clinical colon-terminated lines are NOT headings — case must be preserved
    expect(normalizeBodyLines("L4-L5 level:")).toEqual(["L4-L5 level:"]);
    expect(normalizeBodyLines("Comparison:")).toEqual(["Comparison:"]); // not a D4 section label
  });

  it("case-only drift on a clinical (non-heading) line is CLINICAL_DIFFERENCE", () => {
    expect(compareStoredVsRendered("severe stenosis noted:", "Severe stenosis noted:").class).toBe("CLINICAL_DIFFERENCE");
  });

  it("empty/whitespace-only bodies normalize to [] and never match a non-empty render", () => {
    expect(normalizeBodyLines("")).toEqual([]);
    expect(normalizeBodyLines("  \n\t\n")).toEqual([]);
    const cmp = compareStoredVsRendered("", "FINDINGS:\nSomething.");
    expect(cmp.class).toBe("CLINICAL_DIFFERENCE");
    expect(cmp.divergentLines[0].stored).toBeNull();
  });
});

// ── readStructuredReport (Phase 2) ───────────────────────────────────────────

describe("readStructuredReport — legacy / missing / malformed rows", () => {
  it("legacy row (no structured_json) → NO_STRUCTURED_JSON, stored body unchanged", async () => {
    const r = await readStructuredReport({ body: "OLD SIGNED PROSE", structuredJson: null });
    expect(r.comparisonClass).toBe("NO_STRUCTURED_JSON");
    expect(r.usedStructured).toBe(false);
    expect(r.body).toBe("OLD SIGNED PROSE");
    expect(r.diagnostics.hashVerified).toBeNull();
  });

  it("foreign-shaped JSON (A4-cache-like array / wrong kind) → INVALID_STRUCTURED_JSON, legacy body", async () => {
    for (const bad of [[{ findingId: 1 }], { some: "object" }, { kind: "something.else" }, "text", 42]) {
      const r = await readStructuredReport({ body: "LEGACY", structuredJson: bad });
      expect(r.comparisonClass).toBe("INVALID_STRUCTURED_JSON");
      expect(r.body).toBe("LEGACY");
    }
  });

  it("a draft-state document in patient_reports → INVALID (only signed-final documents render)", async () => {
    const draftDoc = JSON.parse(JSON.stringify(signedDocument));
    draftDoc.audit.signature.state = "draft";
    const r = await readStructuredReport({ body: "LEGACY", structuredJson: draftDoc });
    expect(r.comparisonClass).toBe("INVALID_STRUCTURED_JSON");
    expect(r.diagnostics.fallbackReason).toContain("draft");
  });
});

describe("readStructuredReport — real signed document (end-to-end with the D5 writer output)", () => {
  it("valid + hash-verified + IDENTICAL body → serves the D4 render", async () => {
    const r = await readStructuredReport(signedRow(), PORTS);
    expect(r.comparisonClass).toBe("IDENTICAL");
    expect(r.usedStructured).toBe(true);
    expect(r.body).toBe(signedBody);
    expect(r.diagnostics.hashVerified).toBe(true);
    expect(r.diagnostics.validationErrors).toEqual([]);
    expect(r.diagnostics.renderMs).toBeGreaterThanOrEqual(0);
    expect(r.diagnostics.currentRendererVersion).toBe("d4-structured-1.0.0");
    expect(r.diagnostics.catalogVersion).toBe("0");
  });

  it("stored body with formatting-only drift → APPROVED_FORMATTING_ONLY, render served", async () => {
    const reformatted = signedBody
      .replace("IMPRESSION:", "Impression:")                       // heading case
      .replace("1. Disc herniation.", "1)   Disc herniation.")     // numbering style + spacing
      .replace("\n\nRECOMMENDATION:", "\n\n\nRECOMMENDATION:");    // extra blank line
    const r = await readStructuredReport(signedRow({ body: reformatted }), PORTS);
    expect(r.comparisonClass).toBe("APPROVED_FORMATTING_ONLY");
    expect(r.usedStructured).toBe(true);
    expect(r.body).toBe(signedBody); // the canonical render, not the drifted text
  });

  it("body edited after signing (clinical difference) → stored body wins, divergence surfaced", async () => {
    const edited = signedBody.replace("There is a disc herniation.", "There is a LARGE disc herniation with caudal migration.");
    const r = await readStructuredReport(signedRow({ body: edited }), PORTS);
    expect(r.comparisonClass).toBe("CLINICAL_DIFFERENCE");
    expect(r.usedStructured).toBe(false);
    expect(r.body).toBe(edited); // the radiologist's edit is what displays
    expect(r.diagnostics.divergentLines.length).toBeGreaterThan(0);
    expect(r.diagnostics.fallbackReason).toContain("stored body wins");
  });

  it("tampered document (finding sentence altered after signing) → hash fails → INVALID, legacy body", async () => {
    const tampered = JSON.parse(JSON.stringify(signedDocument));
    tampered.findings[0].sentence = "No abnormality whatsoever."; // the attack D1 §10 exists to catch
    const r = await readStructuredReport(signedRow({ structuredJson: tampered }), PORTS);
    expect(r.comparisonClass).toBe("INVALID_STRUCTURED_JSON");
    expect(r.diagnostics.hashVerified).toBe(false);
    expect(r.usedStructured).toBe(false);
    expect(r.body).toBe(signedBody); // stored body, never the tampered render
    expect(r.diagnostics.fallbackReason).toContain("content_sha256_mismatch");
  });

  it("validation failure (no catalog port for a findings-bearing doc) → INVALID, legacy body (safe fallback direction)", async () => {
    const r = await readStructuredReport(signedRow(), { auditLogLookup: auditLookupTrue }); // no catalogPort → R1 rejects
    expect(r.comparisonClass).toBe("INVALID_STRUCTURED_JSON");
    expect(r.usedStructured).toBe(false);
    expect(r.body).toBe(signedBody);
    expect(r.diagnostics.validationErrors.some((e) => e.rule === "R1")).toBe(true);
  });

  it("never mutates the row or the stored document (deep-frozen input)", async () => {
    const row = signedRow();
    deepFreeze(row);
    await expect(readStructuredReport(row, PORTS)).resolves.toBeTruthy();
  });

  it("is deterministic in its output body", async () => {
    const a = await readStructuredReport(signedRow(), PORTS);
    const b = await readStructuredReport(signedRow(), PORTS);
    expect(a.body).toBe(b.body);
    expect(a.comparisonClass).toBe(b.comparisonClass);
  });
});

describe("readStructuredReport — boundary rows", () => {
  it("stored body emptied after signing → CLINICAL_DIFFERENCE, serves the (empty) stored body, never the render", async () => {
    const r = await readStructuredReport(signedRow({ body: "" }), PORTS);
    expect(r.comparisonClass).toBe("CLINICAL_DIFFERENCE");
    expect(r.usedStructured).toBe(false);
    expect(r.body).toBe(""); // the stored artifact wins even when empty
    expect(r.diagnostics.divergentLines[0].stored).toBeNull();
  });
});

describe("readStructuredReport — mixed database (per-row independence)", () => {
  it("each row classifies independently: legacy, signed, tampered, corrupt", async () => {
    const tampered = JSON.parse(JSON.stringify(signedDocument));
    tampered.findings[0].sentence = "tampered";
    const rows: Array<[StructuredReadRow, string]> = [
      [{ body: "OLD PROSE", structuredJson: null }, "NO_STRUCTURED_JSON"],
      [signedRow(), "IDENTICAL"],
      [signedRow({ structuredJson: tampered }), "INVALID_STRUCTURED_JSON"],
      [{ body: "X", structuredJson: { garbage: true } }, "INVALID_STRUCTURED_JSON"],
    ];
    for (const [row, expected] of rows) {
      const r = await readStructuredReport(row, PORTS);
      expect(r.comparisonClass).toBe(expected);
      expect(typeof r.body).toBe("string");
      expect(r.body.length).toBeGreaterThan(0);
    }
  });
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
