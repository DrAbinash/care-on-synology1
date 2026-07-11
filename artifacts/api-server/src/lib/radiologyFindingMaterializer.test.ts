import { describe, it, expect, beforeEach } from "vitest";
import {
  materializeFindings,
  CatalogStoreFindingResolver,
  normalizeCatalogToken,
  type FindingSelection,
  type FindingCatalogResolver,
  type CatalogResolvedFinding,
} from "./radiologyFindingMaterializer";
import { InMemoryCatalogStore } from "./radiologyCatalog/store";

// Ticket D3.5 — pure materializer + catalog resolver. No DB, no clock.

const CTX = { actor: "dr_test", createdAtIso: "2026-07-10T09:00:00Z" };

// A catalog seeded with one fully-bound finding + its Quick-Select alias.
async function seedCatalog() {
  const store = new InMemoryCatalogStore(() => new Date("2026-07-10T00:00:00Z"));
  const cat = await store.insert("finding_categories", { key: "spine", label: "Spine" });
  const def = await store.insert("finding_definitions", {
    key: "spine.disc_herniation", categoryId: cat.id, label: "Disc herniation",
    narrative: "There is a disc herniation.", impression: "Disc herniation.",
  });
  await store.insert("finding_aliases", {
    findingId: def.id, aliasKey: "L4-L5 disc herniation", normalized: "l4-l5 disc herniation", source: "legacy_quick_select",
  });
  await store.insert("finding_severity_bindings", { findingId: def.id, key: "extrusion", label: "Extrusion", rank: 3 });
  await store.insert("finding_locations", { findingId: def.id, key: "l4_l5", label: "L4-L5", laterality: null });
  await store.insert("finding_measurement_bindings", { findingId: def.id, key: "canal_ap_diameter", label: "Canal AP", unit: "mm" });
  await store.insert("finding_recommendations", { findingId: def.id, recommendationText: "Correlate clinically.", priority: "routine" });
  return store;
}

const QUICK_LABELS: Record<number, string> = { 1: "L4-L5 disc herniation" };
const lookup = async (id: number) => (QUICK_LABELS[id] ? { label: QUICK_LABELS[id] } : null);

let resolver: FindingCatalogResolver;
beforeEach(async () => {
  resolver = new CatalogStoreFindingResolver(await seedCatalog(), lookup);
});

const fullSelection: FindingSelection = {
  findingId: 1,
  params: { side: "left", severity: "extrusion", chronicity: "chronic", level: "L4-L5", value: "8" },
  source: "quickselect",
};

describe("normalizeCatalogToken", () => {
  it("lowercases and maps spaces/hyphens to underscore", () => {
    expect(normalizeCatalogToken("L4-L5")).toBe("l4_l5");
    expect(normalizeCatalogToken("  Right Lobe ")).toBe("right_lobe");
  });
});

describe("materializeFindings — a fully-resolvable selection", () => {
  it("produces a truthful canonical D1 finding + measurement + recommendation", async () => {
    const out = await materializeFindings([fullSelection], resolver, CTX);
    expect(out.skipped).toEqual([]);
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.definition_ref).toBe("finding.spine.disc_herniation");
    expect(f.presence).toBe("present");
    expect(f.certainty).toBe("definite");
    expect(f.laterality).toBe("lat.left");
    expect(f.severity).toBe("sev.extrusion");
    expect(f.locations).toEqual(["loc.l4_l5"]);
    expect(f.sentence).toBe("There is a disc herniation."); // catalog narrative verbatim
    expect(f.impression_fragment).toBe("Disc herniation.");
    expect(f.sentence_source).toBe("content_pack_default");
    expect(f.parameters).toEqual([]);
    expect(f.measurement_refs).toEqual(["m1"]);
    expect(f.provenance.origin).toBe("quick_select"); // normalized from "quickselect"

    expect(out.measurements).toHaveLength(1);
    const m = out.measurements[0];
    expect(m.measurement_ref).toBe("meas.canal_ap_diameter");
    expect(m.finding_ref).toBe("f1");
    expect(m.value).toBe(8);
    expect(m.unit).toBe("mm");
    expect(m.value_kind).toBe("scalar");
    expect(m.display).toBe("8 mm");

    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0].text).toBe("Correlate clinically.");
    expect(out.recommendations[0].priority).toBe("routine");
    expect(out.recommendations[0].finding_refs).toEqual(["f1"]);
    expect(out.recommendations[0].recommendation_ref).toBeNull();
  });

  it("is deterministic (same input → structurally identical output)", async () => {
    const a = await materializeFindings([fullSelection], resolver, CTX);
    const b = await materializeFindings([fullSelection], resolver, CTX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("materializeFindings — truthful omission of unmapped params (never fabricates)", () => {
  it("omits severity/location/laterality/measurement that do not resolve, keeps the finding", async () => {
    const out = await materializeFindings(
      [{ findingId: 1, params: { side: "", severity: "moderate", level: "T12-L1", value: "abc" }, source: "quickselect" }],
      resolver, CTX,
    );
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.laterality).toBeNull();          // side ""
    expect(f.severity).toBeNull();            // "moderate" not a binding of this finding
    expect(f.locations).toEqual([]);          // "T12-L1" not a location binding
    expect(f.measurement_refs).toEqual([]);   // "abc" is not numeric
    expect(out.measurements).toEqual([]);
  });

  it("only emits a measurement when there is exactly ONE binding (unambiguous)", async () => {
    // Resolver stub reporting TWO measurement bindings — ambiguous, so no measurement.
    const ambiguous: FindingCatalogResolver = {
      async resolve(): Promise<CatalogResolvedFinding> {
        return {
          definitionKey: "x.y", narrative: "n", impression: "i",
          severityKeys: [], locationKeys: [],
          measurementBindings: [{ key: "a", unit: "mm" }, { key: "b", unit: "mm" }],
          recommendations: [],
        };
      },
    };
    const out = await materializeFindings([{ findingId: 1, params: { value: "5" }, source: "quickselect" }], ambiguous, CTX);
    expect(out.findings).toHaveLength(1);
    expect(out.measurements).toEqual([]); // ambiguous → dropped, not guessed
    expect(out.findings[0].measurement_refs).toEqual([]);
  });
});

describe("materializeFindings — skips (preserved for the caller to store in extensions)", () => {
  it("skips a selection the catalog cannot resolve", async () => {
    const out = await materializeFindings([{ findingId: 999, params: {}, source: "quickselect" }], resolver, CTX);
    expect(out.findings).toEqual([]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({ finding_id: 999, reason: "catalog_unresolved" });
  });

  it("skips a resolvable finding that has no stored narrative/impression (no prose to copy)", async () => {
    const noProse: FindingCatalogResolver = {
      async resolve(): Promise<CatalogResolvedFinding> {
        return { definitionKey: "x.y", narrative: null, impression: "i", severityKeys: [], locationKeys: [], measurementBindings: [], recommendations: [] };
      },
    };
    const out = await materializeFindings([{ findingId: 1, params: {}, source: "quickselect" }], noProse, CTX);
    expect(out.findings).toEqual([]);
    expect(out.skipped[0].reason).toBe("no_catalog_narrative");
  });

  it("materializes the resolvable ones and skips the rest (mixed batch)", async () => {
    const out = await materializeFindings(
      [fullSelection, { findingId: 999, params: {}, source: "quickselect" }],
      resolver, CTX,
    );
    expect(out.findings).toHaveLength(1);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].finding_id).toBe(999);
  });
});

describe("CatalogStoreFindingResolver — resolution hops", () => {
  it("returns null when the quick-finding label is unknown", async () => {
    expect(await resolver.resolve(12345)).toBeNull();
  });

  it("returns null when no alias maps the label to a canonical finding", async () => {
    const store = await seedCatalog();
    const r = new CatalogStoreFindingResolver(store, async () => ({ label: "unaliased label" }));
    expect(await r.resolve(1)).toBeNull();
  });

  it("resolves the full finding + bindings for an aliased label", async () => {
    const resolved = await resolver.resolve(1);
    expect(resolved?.definitionKey).toBe("spine.disc_herniation");
    expect(resolved?.narrative).toBe("There is a disc herniation.");
    expect(resolved?.severityKeys).toEqual(["extrusion"]);
    expect(resolved?.measurementBindings).toEqual([{ key: "canal_ap_diameter", unit: "mm" }]);
  });
});
