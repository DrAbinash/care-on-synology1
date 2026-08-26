import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCatalogStore } from "../store";
import { InMemoryCatalogRepository } from "./repository";
import { buildNormalizedGraph } from "./graph";
import { dryRunImport } from "./dryRun";
import { runImport, ImportError } from "./importer";
import { load, loadAll, VALID_PACK, EXTENDS_PACK, COMBO_PACK, mutate } from "./__fixtures__/packs";

let mem: InMemoryCatalogStore;
let repo: InMemoryCatalogRepository;

beforeEach(() => {
  mem = new InMemoryCatalogStore();
  repo = new InMemoryCatalogRepository(mem);
});

describe("K2 dry-run — diff against empty catalog", () => {
  it("classifies everything as insert on a fresh catalog", async () => {
    const g = buildNormalizedGraph([load("v", VALID_PACK)]);
    const plan = await dryRunImport(g, repo.readStore(), { prune: true });
    expect(plan.statistics.insert).toBeGreaterThan(0);
    expect(plan.statistics.update).toBe(0);
    expect(plan.statistics.delete).toBe(0);
    expect(plan.insert.some((i) => i.entity === "finding" && i.key === "shapes.circle")).toBe(true);
  });
});

describe("K3 import — first import writes the catalog", () => {
  it("creates parameter groups, options, categories, findings, bindings, aliases", async () => {
    const res = await runImport([load("v", VALID_PACK)], repo, { prune: true });
    expect(res.ok).toBe(true);
    expect(await mem.count("parameter_groups")).toBe(1);
    expect(await mem.count("parameter_options")).toBe(2);
    expect(await mem.count("finding_categories")).toBe(2);
    expect(await mem.count("finding_definitions")).toBe(1);
    expect(await mem.count("finding_parameter_bindings")).toBe(1);
    expect(await mem.count("finding_severity_bindings")).toBe(1);
    expect(await mem.count("finding_measurement_bindings")).toBe(1);
    expect(await mem.count("finding_aliases")).toBe(3); // 2 aliases + keyboard_alias

    const finding = await mem.findOne("finding_definitions", { key: "shapes.circle" });
    expect(finding?.version).toBe(1);
    const cat = await mem.findOne("finding_categories", { key: "round_shapes" });
    const parent = await mem.findOne("finding_categories", { key: "shapes" });
    expect(cat?.parentId).toBe(parent?.id); // hierarchical parent resolved
  });
});

describe("K3 import — idempotency & immutable IDs", () => {
  it("re-importing identical packs writes nothing and preserves ids + versions", async () => {
    await runImport([load("v", VALID_PACK)], repo, { prune: true });
    const before = await mem.findOne("finding_definitions", { key: "shapes.circle" });

    const res2 = await runImport([load("v", VALID_PACK)], repo, { prune: true });
    expect(res2.ok).toBe(true);
    expect(res2.plan!.statistics.insert).toBe(0);
    expect(res2.plan!.statistics.update).toBe(0);
    expect(res2.plan!.statistics.delete).toBe(0);

    const after = await mem.findOne("finding_definitions", { key: "shapes.circle" });
    expect(after?.id).toBe(before?.id);        // immutable id preserved
    expect(after?.version).toBe(1);            // no spurious version bump
    expect(await mem.count("finding_aliases")).toBe(3); // aliases not duplicated
  });
});

describe("K3 import — updates bump versions", () => {
  it("a changed finding is updated with version+1; unrelated rows untouched", async () => {
    await runImport([load("v", VALID_PACK)], repo, { prune: true });
    const changed = mutate([["impression_fragment: \"Circle noted.\"", "impression_fragment: \"Circle, updated.\""]]);
    const res = await runImport([load("v2", changed)], repo, { prune: true });
    expect(res.ok).toBe(true);
    expect(res.plan!.statistics.update).toBe(1);
    const finding = await mem.findOne("finding_definitions", { key: "shapes.circle" });
    expect(finding?.version).toBe(2);
    expect(finding?.impression).toBe("Circle, updated.");
  });
});

describe("K3 import — retire (soft-delete) + resurrect", () => {
  it("a finding removed from packs is soft-deleted with prune; re-adding resurrects same id", async () => {
    await runImport([load("v", VALID_PACK)], repo, { prune: true });
    const original = await mem.findOne("finding_definitions", { key: "shapes.circle" });

    // remove the finding from the pack (leave everything else) → retire
    const withoutFinding = VALID_PACK.split("findings:")[0] + "findings: []\n";
    const res = await runImport([load("v", withoutFinding)], repo, { prune: true });
    expect(res.ok).toBe(true);
    expect(await mem.findOne("finding_definitions", { key: "shapes.circle" })).toBeNull(); // soft-deleted → not live
    expect(await mem.getById("finding_definitions", original!.id, { includeDeleted: true })).not.toBeNull();

    // re-add → resurrect the SAME surrogate id (immutable)
    await runImport([load("v", VALID_PACK)], repo, { prune: true });
    const resurrected = await mem.findOne("finding_definitions", { key: "shapes.circle" });
    expect(resurrected?.id).toBe(original?.id);
    expect(resurrected?.deletedAt).toBeNull();
  });
});

describe("K3 import — transaction rollback on failure", () => {
  it("rolls back ALL writes if the transaction throws mid-import", async () => {
    // Seed a valid catalog first.
    await runImport([load("v", VALID_PACK)], repo, { prune: true });
    const countsBefore = {
      groups: await mem.count("parameter_groups"),
      findings: await mem.count("finding_definitions"),
    };

    // Monkeypatch the store used inside the transaction to throw on the Nth insert.
    const realInsert = mem.insert.bind(mem);
    let calls = 0;
    (mem as unknown as { insert: typeof mem.insert }).insert = (async (t: never, v: never) => {
      calls++;
      if (calls === 1) throw new Error("boom (simulated mid-transaction failure)");
      return realInsert(t, v);
    }) as typeof mem.insert;

    // A pack that adds NEW content (so inserts happen and one will throw).
    const bigger = VALID_PACK + `
  - id_key: shapes.square
    display_name: Square
    category: round_shapes
    default_sentence: "A square."
    impression_fragment: "Square."
`;
    const res = await runImport([load("v2", bigger)], repo, { prune: false });
    (mem as unknown as { insert: typeof mem.insert }).insert = realInsert; // restore

    expect(res.ok).toBe(false);
    expect(res.phase).toBe("applied");
    // catalog is unchanged — rollback restored the pre-transaction snapshot
    expect(await mem.count("parameter_groups")).toBe(countsBefore.groups);
    expect(await mem.count("finding_definitions")).toBe(countsBefore.findings);
    expect(await mem.findOne("finding_definitions", { key: "shapes.square" })).toBeNull();
  });
});

describe("K3 import — validation gate (no partial success)", () => {
  it("refuses to import when validation fails; catalog untouched", async () => {
    const bad = mutate([["ref: param.shade", "ref: param.nope"]]);
    const res = await runImport([load("bad", bad)], repo, { prune: true });
    expect(res.ok).toBe(false);
    expect(res.phase).toBe("validate");
    expect(await mem.count("finding_definitions")).toBe(0);
  });
});

describe("K3 import — extends & combo end to end", () => {
  it("imports an extends pack with inherited bindings", async () => {
    const res = await runImport([load("e", EXTENDS_PACK)], repo, { prune: true });
    expect(res.ok).toBe(true);
    const child = await mem.findOne("finding_definitions", { key: "child.shape" });
    const bindings = await mem.list("finding_parameter_bindings", { where: { findingId: child!.id } });
    expect(bindings.length).toBe(1); // inherited shade param
  });
  it("imports a combo pack (all findings present)", async () => {
    const res = await runImport([load("c", COMBO_PACK)], repo, { prune: true });
    expect(res.ok).toBe(true);
    expect(await mem.count("finding_definitions")).toBe(3);
  });
});

describe("K3 import — conflict_group maps onto quickFindingRows", () => {
  it("round-trip lands conflict_group on the mapped ownership row", async () => {
    const pack = `
schema_version: "1.0.0"
pack: { id: test.own, version: "1.0.0", modality: MR }
categories:
  - { key: critical, display_name: Critical }
findings:
  - id_key: brain.hemorrhage
    display_name: Hemorrhage
    category: critical
    default_sentence: "Acute intraparenchymal hemorrhage in the right basal ganglia."
    impression_fragment: "Acute hemorrhage."
    conflict_group: hemorrhage
    anatomical_section: basal ganglia
    study_type: Brain
`;
    const res = await runImport([load("own", pack)], repo, { prune: true });
    expect(res.ok).toBe(true);
    const row = res.quickFindingRows?.find((r) => r.label === "Hemorrhage");
    expect(row?.conflictGroup).toBe("hemorrhage");
    expect(row?.anatomicalSection).toBe("basal ganglia");
    expect(row?.studyType).toBe("Brain");
  });
});

describe("performance sanity — large catalog import", () => {
  it("dry-run + import of ~500 findings stays under budget and is idempotent", async () => {
    const findings = Array.from({ length: 500 }, (_, i) =>
      `  - { id_key: perf.f${i}, display_name: "F ${i}", category: c, default_sentence: "s", impression_fragment: "i" }`).join("\n");
    const bigPack = `
schema_version: "1.0.0"
pack: { id: perf, version: "1.0.0" }
categories: [ { key: c, display_name: C } ]
findings:
${findings}
`;
    const t0 = Date.now();
    const res = await runImport([load("perf", bigPack)], repo, { prune: true });
    const importMs = Date.now() - t0;
    expect(res.ok).toBe(true);
    expect(await mem.count("finding_definitions")).toBe(500);

    const t1 = Date.now();
    const res2 = await runImport([load("perf", bigPack)], repo, { prune: true }); // idempotent re-run
    const reimportMs = Date.now() - t1;
    expect(res2.plan!.statistics.insert + res2.plan!.statistics.update + res2.plan!.statistics.delete).toBe(0);
    expect(importMs).toBeLessThan(8000);
    expect(reimportMs).toBeLessThan(8000);
  }, 30000);
});
