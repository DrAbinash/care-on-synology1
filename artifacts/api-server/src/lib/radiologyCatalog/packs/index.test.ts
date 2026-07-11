import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { loadPacksFromDir } from "./loader";
import { validateContentPacks, dryRunContentImport, importContentPacks, FeatureDisabledError } from "./index";
import { InMemoryCatalogRepository } from "./repository";
import { load, VALID_PACK } from "./__fixtures__/packs";

const FIX_DIR = join(__dirname, "__fixtures__");
const ORIG = process.env.FF_RADIOLOGY_CATALOG;
afterEach(() => { process.env.FF_RADIOLOGY_CATALOG = ORIG; });

describe("loader — reads YAML files, captures syntax errors without throwing", () => {
  it("loads valid.yaml and captures broken.yaml's parse error", () => {
    const packs = loadPacksFromDir(FIX_DIR);
    const byName = Object.fromEntries(packs.map((p) => [p.source, p]));
    expect(byName["valid.yaml"].parsed).not.toBeNull();
    expect(byName["broken.yaml"].parsed).toBeNull();
    expect(byName["broken.yaml"].parseError).toBeTruthy();
  });
});

describe("feature flag — nothing executes unless ff_radiology_catalog == true", () => {
  beforeEach(() => { delete process.env.FF_RADIOLOGY_CATALOG; });

  it("gated entry points throw FeatureDisabledError when the flag is off", async () => {
    const repo = new InMemoryCatalogRepository();
    await expect(validateContentPacks([load("v", VALID_PACK)])).rejects.toBeInstanceOf(FeatureDisabledError);
    await expect(dryRunContentImport([load("v", VALID_PACK)], repo)).rejects.toBeInstanceOf(FeatureDisabledError);
    await expect(importContentPacks([load("v", VALID_PACK)], repo)).rejects.toBeInstanceOf(FeatureDisabledError);
  });

  it("gated entry points run when the flag is on", async () => {
    process.env.FF_RADIOLOGY_CATALOG = "true";
    const repo = new InMemoryCatalogRepository();
    const v = await validateContentPacks([load("v", VALID_PACK)]);
    expect(v.ok).toBe(true);
    const dry = await dryRunContentImport([load("v", VALID_PACK)], repo);
    expect(dry.plan?.statistics.insert).toBeGreaterThan(0);
    const imp = await importContentPacks([load("v", VALID_PACK)], repo);
    expect(imp.ok).toBe(true);
  });
});
