import { describe, it, expect, beforeAll } from "vitest";
import { validateStructuredReport, type ValidationContext } from "./validator";
import { DrizzleStructuredReportCatalogPort } from "./catalogAccess";
import { UnavailableAiRulesRegistryPort } from "./aiRulesRegistry";
import { seedGoldenCatalog } from "./__fixtures__/seedGoldenCatalog";
import { loadExample } from "./__fixtures__/loadExample";
import type { InMemoryCatalogStore } from "../radiologyCatalog/store";

// D1 §19 item 1: "the five examples in §17 must pass" the golden-fixture corpus.
// This test is the load-bearing proof that ./schema/structured-report-v1.schema.json
// and ./validator.ts are actually consistent with the frozen spec's own canonical
// examples, seeded against a real (in-memory) B1/B2 catalog — not just asserted
// consistent by inspection.

describe("D1 §17 golden examples — draft mode (R14/R14b/R14c/R13-signed_by are finalize-only, skipped)", () => {
  let store: InMemoryCatalogStore;
  let ctx: ValidationContext;

  beforeAll(async () => {
    store = await seedGoldenCatalog();
    ctx = {
      catalog: new DrizzleStructuredReportCatalogPort(store),
      aiRules: new UnavailableAiRulesRegistryPort(),
      mode: "draft",
    };
  });

  const examples = [
    ["example1MriBrain.json", "MRI Brain — normal survey + small-vessel ischemia (AI-assisted impression)"],
    ["example2MriLsSpine.json", "MRI LS Spine — L4-L5 disc herniation with canal measurement"],
    ["example3MriCervicalSpine.json", "MRI Cervical Spine — C5-C6 cord compression (critical)"],
    ["example4UsgAbdomen.json", "USG Abdomen — normal biometry + incidental hepatic cyst"],
    ["example5DopplerCarotid.json", "Doppler (carotid) — right ICA stenosis with velocity indices"],
  ] as const;

  for (const [file, label] of examples) {
    it(`${file} (${label}) validates clean in draft mode`, async () => {
      const doc = loadExample(file);
      const result = await validateStructuredReport(doc, ctx);
      expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
      expect(result.ok).toBe(true);
      // R15/R16 degrade to a warning (no live AI rules registry — honest gap, see
      // aiRulesRegistry.ts), one per finding; every other warning would indicate a
      // real spec/fixture drift.
      const unexpectedWarnings = result.warnings.filter((w) => w.rule !== "R15" && w.rule !== "R16");
      expect(unexpectedWarnings, JSON.stringify(unexpectedWarnings, null, 2)).toEqual([]);
    });
  }
});

describe("D1 §17.3 golden example — finalize mode (the one worked example with signature.state=final)", () => {
  let store: InMemoryCatalogStore;
  let ctx: ValidationContext;

  beforeAll(async () => {
    store = await seedGoldenCatalog();
    ctx = {
      catalog: new DrizzleStructuredReportCatalogPort(store),
      aiRules: new UnavailableAiRulesRegistryPort(),
      mode: "finalize",
      auditLogLookup: async () => true, // honest-gap port; a real audit_logs row is out of this fixture's scope
      amendsLookup: async () => null,
    };
  });

  it("example3MriCervicalSpine.json validates clean in finalize mode", async () => {
    const doc = loadExample("example3MriCervicalSpine.json");
    const result = await validateStructuredReport(doc, ctx);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("the other four draft-state examples correctly REJECT under finalize mode (R14: signature.state must be final)", async () => {
    for (const file of ["example1MriBrain.json", "example2MriLsSpine.json", "example4UsgAbdomen.json", "example5DopplerCarotid.json"]) {
      const doc = loadExample(file);
      const result = await validateStructuredReport(doc, ctx);
      expect(result.ok, `${file} should reject at finalize (still signature.state="draft")`).toBe(false);
      expect(result.errors.some((e) => e.rule === "R14")).toBe(true);
    }
  });
});
