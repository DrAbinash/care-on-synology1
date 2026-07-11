import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCatalogStore, type CatalogStore } from "./store";
import { CatalogService } from "./service";

/** Assert a service call rejects with a specific CatalogValidationError code. */
async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

let store: CatalogStore;
let svc: CatalogService;

beforeEach(() => {
  store = new InMemoryCatalogStore();
  svc = new CatalogService(store);
});

/** Seed a category + finding and return their ids. */
async function seedFinding(): Promise<{ categoryId: number; findingId: number }> {
  const cat = await svc.createFindingCategory({ key: "liver", label: "Liver" });
  const finding = await svc.createFinding({ key: "liver.cyst", categoryId: cat.id, label: "Simple hepatic cyst" });
  return { categoryId: cat.id, findingId: finding.id };
}

describe("parameter groups — CRUD, duplicate keys, version, soft delete", () => {
  it("creates with immutable store-assigned id and version 1", async () => {
    const g = await svc.createParameterGroup({ key: "echogenicity", label: "Echogenicity" });
    expect(g.id).toBeGreaterThan(0);
    expect(g.version).toBe(1);
    expect(g.status).toBe("draft");
    expect(g.deletedAt).toBeNull();
  });

  it("assigns monotonic store-owned ids (no client-overridden or duplicate IDs)", async () => {
    const g1 = await svc.createParameterGroup({ key: "a", label: "A", ...( { id: 999 } as object) });
    const g2 = await svc.createParameterGroup({ key: "b", label: "B" });
    expect(g1.id).not.toBe(999);
    expect(g2.id).toBe(g1.id + 1);
  });

  it("rejects duplicate live key", async () => {
    await svc.createParameterGroup({ key: "size", label: "Size" });
    await expectCode(svc.createParameterGroup({ key: "size", label: "Size 2" }), "DUPLICATE_KEY");
  });

  it("rejects invalid key and invalid dataType", async () => {
    await expectCode(svc.createParameterGroup({ key: "Bad Key", label: "x" }), "INVALID_KEY");
    await expectCode(svc.createParameterGroup({ key: "ok", label: "x", dataType: "weird" }), "INVALID_FIELD");
  });

  it("update bumps version and enforces optimistic lock", async () => {
    const g = await svc.createParameterGroup({ key: "size", label: "Size" });
    const u = await svc.updateParameterGroup(g.id, { label: "Size (mm)", expectedVersion: 1 });
    expect(u.version).toBe(2);
    expect(u.label).toBe("Size (mm)");
    await expectCode(svc.updateParameterGroup(g.id, { label: "x", expectedVersion: 1 }), "VERSION_CONFLICT");
  });

  it("enforces status transition rules on update", async () => {
    const g = await svc.createParameterGroup({ key: "size", label: "Size" });
    const a = await svc.updateParameterGroup(g.id, { status: "active" });
    expect(a.status).toBe("active");
    await expectCode(svc.updateParameterGroup(g.id, { status: "draft" }), "INVALID_STATUS_TRANSITION");
  });

  it("soft-deletes (row disappears from reads) and frees the key for re-creation", async () => {
    const g = await svc.createParameterGroup({ key: "size", label: "Size" });
    await svc.deleteParameterGroup(g.id);
    expect(await svc.getGroup(g.id)).toBeNull();
    expect(await store.getById("parameter_groups", g.id, { includeDeleted: true })).not.toBeNull();
    // key is free again once soft-deleted
    const g2 = await svc.createParameterGroup({ key: "size", label: "Size again" });
    expect(g2.id).not.toBe(g.id);
  });

  it("re-deleting a versioned entity reports NOT_FOUND (already retired)", async () => {
    const g = await svc.createParameterGroup({ key: "size", label: "Size" });
    await svc.deleteParameterGroup(g.id);
    await expectCode(svc.deleteParameterGroup(g.id), "NOT_FOUND"); // requireLive first → not found
  });
});

describe("parameter options — reference integrity + reuse (never duplicate values)", () => {
  it("requires a live parent group", async () => {
    await expectCode(svc.createParameterOption({ groupId: 999, key: "hyperechoic", label: "Hyperechoic" }), "MISSING_REFERENCE");
  });

  it("dedups (group,key) but the same key can live under a different group", async () => {
    const g1 = await svc.createParameterGroup({ key: "echogenicity", label: "Echogenicity" });
    const g2 = await svc.createParameterGroup({ key: "margin", label: "Margin" });
    await svc.createParameterOption({ groupId: g1.id, key: "smooth", label: "Smooth" });
    await expectCode(svc.createParameterOption({ groupId: g1.id, key: "smooth", label: "dup" }), "DUPLICATE_KEY");
    // same option key under a different group is allowed (reuse across libraries)
    await expect(svc.createParameterOption({ groupId: g2.id, key: "smooth", label: "Smooth" })).resolves.toBeTruthy();
  });

  it("blocks group soft-delete while options reference it (RESTRICT semantics)", async () => {
    const g = await svc.createParameterGroup({ key: "echogenicity", label: "Echogenicity" });
    await svc.createParameterOption({ groupId: g.id, key: "smooth", label: "Smooth" });
    await expectCode(svc.deleteParameterGroup(g.id), "ORPHAN_BINDING");
  });
});

describe("finding categories — hierarchy + cycles + soft delete", () => {
  it("rejects a missing parent and a cycle", async () => {
    await expectCode(svc.createFindingCategory({ key: "sub", label: "Sub", parentId: 999 }), "MISSING_REFERENCE");
    const root = await svc.createFindingCategory({ key: "abd", label: "Abdomen" });
    const child = await svc.createFindingCategory({ key: "liver", label: "Liver", parentId: root.id });
    // making the root a child of its own descendant is a cycle
    await expectCode(svc.updateFindingCategory(root.id, { parentId: child.id }), "CYCLE");
  });

  it("blocks category soft-delete while child categories or findings reference it", async () => {
    const root = await svc.createFindingCategory({ key: "abd", label: "Abdomen" });
    await svc.createFindingCategory({ key: "liver", label: "Liver", parentId: root.id });
    await expectCode(svc.deleteFindingCategory(root.id), "ORPHAN_BINDING");
  });
});

describe("findings — CRUD + reference integrity", () => {
  it("requires a live category and unique key", async () => {
    await expectCode(svc.createFinding({ key: "x", categoryId: 999, label: "x" }), "MISSING_REFERENCE");
    const { categoryId } = await seedFinding();
    await expectCode(svc.createFinding({ key: "liver.cyst", categoryId, label: "dup" }), "DUPLICATE_KEY");
  });

  it("blocks finding soft-delete while edges reference it", async () => {
    const { findingId } = await seedFinding();
    await svc.addSynonym({ findingId, synonym: "hepatic cyst" });
    await expectCode(svc.deleteFinding(findingId), "ORPHAN_BINDING");
  });
});

describe("edges — bindings, synonyms, aliases, locations, severities, measurements", () => {
  it("parameter binding validates refs, dedups, and enforces option∈group", async () => {
    const { findingId } = await seedFinding();
    const g = await svc.createParameterGroup({ key: "echogenicity", label: "Echogenicity" });
    const other = await svc.createParameterGroup({ key: "margin", label: "Margin" });
    const optOther = await svc.createParameterOption({ groupId: other.id, key: "smooth", label: "Smooth" });

    await expectCode(svc.addParameterBinding({ findingId: 999, parameterGroupId: g.id }), "MISSING_REFERENCE");
    await expectCode(svc.addParameterBinding({ findingId, parameterGroupId: 999 }), "MISSING_REFERENCE");
    // default option belongs to a different group
    await expectCode(svc.addParameterBinding({ findingId, parameterGroupId: g.id, defaultOptionId: optOther.id }), "MISSING_REFERENCE");

    const b = await svc.addParameterBinding({ findingId, parameterGroupId: g.id, required: true });
    expect(b.required).toBe(true);
    await expectCode(svc.addParameterBinding({ findingId, parameterGroupId: g.id }), "DUPLICATE_KEY");
  });

  it("synonyms dedup per finding (normalized)", async () => {
    const { findingId } = await seedFinding();
    await svc.addSynonym({ findingId, synonym: "Hepatic Cyst" });
    await expectCode(svc.addSynonym({ findingId, synonym: "  hepatic   cyst " }), "DUPLICATE_KEY");
  });

  it("aliases are GLOBALLY unique across findings (no duplicate aliases)", async () => {
    const a = await seedFinding();
    const catB = await svc.createFindingCategory({ key: "kidney", label: "Kidney" });
    const findingB = await svc.createFinding({ key: "kidney.cyst", categoryId: catB.id, label: "Renal cyst" });
    await svc.addAlias({ findingId: a.findingId, aliasKey: "CYST" });
    // same normalized alias on a DIFFERENT finding must collide
    await expectCode(svc.addAlias({ findingId: findingB.id, aliasKey: "cyst" }), "DUPLICATE_ALIAS");
  });

  it("locations validate laterality + dedup key; measurements validate min≤max", async () => {
    const { findingId } = await seedFinding();
    await svc.addLocation({ findingId, key: "right_lobe", label: "Right lobe", laterality: "right" });
    await expectCode(svc.addLocation({ findingId, key: "right_lobe", label: "dup" }), "DUPLICATE_KEY");
    await expectCode(svc.addLocation({ findingId, key: "x", label: "x", laterality: "sideways" }), "INVALID_FIELD");
    await expectCode(svc.addMeasurement({ findingId, key: "d", label: "Diameter", minValue: 10, maxValue: 2 }), "INVALID_FIELD");
    const m = await svc.addMeasurement({ findingId, key: "d", label: "Diameter", unit: "mm", minValue: 0, maxValue: 100 });
    expect(m.unit).toBe("mm");
  });

  it("edges can be soft-removed, unblocking finding deletion; re-removing is ALREADY_DELETED", async () => {
    const { findingId } = await seedFinding();
    const s = await svc.addSynonym({ findingId, synonym: "hepatic cyst" });
    await svc.removeEdge("finding_synonyms", s.id);
    await expectCode(svc.removeEdge("finding_synonyms", s.id), "ALREADY_DELETED");
    await expect(svc.deleteFinding(findingId)).resolves.toBeTruthy();
  });
});

describe("search, lookup, and graph assembly", () => {
  it("searchFindings matches label, synonym, and alias", async () => {
    const { findingId } = await seedFinding();
    await svc.addSynonym({ findingId, synonym: "hepatic cyst" });
    await svc.addAlias({ findingId, aliasKey: "HCST" });
    expect((await svc.searchFindings("hepatic")).map((r) => r.id)).toContain(findingId); // label
    expect((await svc.searchFindings("cyst")).map((r) => r.id)).toContain(findingId);    // label+synonym
    expect((await svc.searchFindings("hcst")).map((r) => r.id)).toContain(findingId);    // alias
    expect(await svc.searchFindings("")).toEqual([]);
  });

  it("lookupByAlias resolves the finding, case-insensitively", async () => {
    const { findingId } = await seedFinding();
    await svc.addAlias({ findingId, aliasKey: "LiverCyst" });
    const f = await svc.lookupByAlias("livercyst");
    expect(f?.id).toBe(findingId);
    expect(await svc.lookupByAlias("nope")).toBeNull();
  });

  it("getFindingGraph assembles the full canonical graph", async () => {
    const { categoryId, findingId } = await seedFinding();
    const g = await svc.createParameterGroup({ key: "echogenicity", label: "Echogenicity" });
    await svc.createParameterOption({ groupId: g.id, key: "anechoic", label: "Anechoic" });
    await svc.addParameterBinding({ findingId, parameterGroupId: g.id, required: true });
    await svc.addSynonym({ findingId, synonym: "hepatic cyst" });
    await svc.addSeverity({ findingId, key: "mild", label: "Mild", rank: 1 });
    await svc.addMeasurement({ findingId, key: "d", label: "Diameter", unit: "mm" });

    const graph = await svc.getFindingGraph(findingId);
    expect(graph.finding.id).toBe(findingId);
    expect(graph.category?.id).toBe(categoryId);
    expect(graph.parameters).toHaveLength(1);
    expect(graph.parameters[0].group?.key).toBe("echogenicity");
    expect(graph.parameters[0].options.map((o) => o.key)).toContain("anechoic");
    expect(graph.synonyms).toHaveLength(1);
    expect(graph.severities).toHaveLength(1);
    expect(graph.measurements).toHaveLength(1);
  });
});

describe("performance sanity (no DB, in-process)", () => {
  it("creating 1,000 findings + searching stays well under budget", async () => {
    const cat = await svc.createFindingCategory({ key: "perf", label: "Perf" });
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await svc.createFinding({ key: `perf.f${i}`, categoryId: cat.id, label: `Finding number ${i}` });
    }
    const created = Date.now() - start;
    const sStart = Date.now();
    const hits = await svc.searchFindings("number 500", 10);
    const searched = Date.now() - sStart;
    expect(hits.length).toBeGreaterThan(0);
    expect(created).toBeLessThan(4000);
    expect(searched).toBeLessThan(500);
  }, 20000);

  it("cycle detection on a 2,000-deep category chain is fast", async () => {
    // build a deep chain 1←2←…, then verify a cycle check from the tail is quick
    let parentId: number | null = null;
    const ids: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const c: { id: number } = await svc.createFindingCategory({ key: `chain.${i}`, label: `c${i}`, parentId });
      parentId = c.id;
      ids.push(c.id);
    }
    const start = Date.now();
    // pointing the root at the deepest node must be detected as a cycle
    await expectCode(svc.updateFindingCategory(ids[0], { parentId: ids[ids.length - 1] }), "CYCLE");
    expect(Date.now() - start).toBeLessThan(1000);
  }, 20000);
});
