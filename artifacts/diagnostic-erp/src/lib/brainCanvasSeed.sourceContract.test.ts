/**
 * Source contracts — the "seed unmentioned systems normal" button on the MRI
 * Brain canvas uses the shared plan, applies through the canvas' OWN canonical
 * path (applyMacroBundle — the same call every tile and preset on this canvas
 * makes), and can never touch a system an observation already documents.
 *
 * The unit contracts in brainCanvasSeed.test.ts pin the plan itself; these
 * pins guard the wiring on the one canvas that has it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const CANVAS = "components/radiology/reporting-canvas/MriBrainCanvas.tsx";

function seedPlanBlock(src: string): string {
  const start = src.indexOf("const activeConcepts = useMemo");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("const toggleVascularNormal");
  return src.slice(start, end > start ? end : undefined);
}

describe("MRI Brain canvas normal-seed — wiring", () => {
  const src = read(CANVAS);

  it("1. imports the shared plan helper and the protocol-aware normal atoms", () => {
    expect(src).toContain('planBrainNormalSeed } from "@/lib/brainCanvasSeed"');
    expect(src).toContain('buildBrainNormalAtoms } from "@/lib/mriBrainNormalAtoms"');
  });

  it("2. derives the plan from the built normal set × the ledger's non-stale concepts", () => {
    const block = seedPlanBlock(src);
    // The candidates are the protocol-aware normal atoms — never a second
    // sentence list re-declared in the canvas.
    expect(block).toContain("buildBrainNormalAtoms({");
    expect(block).toContain("planBrainNormalSeed(");
    // Active systems are read from the same patches the canvas' own
    // activeBundles/vascularNormals memos read — non-stale observations only.
    expect(block).toContain("p.stale");
    expect(block).toContain("p.observation?.concept");
    // Only the planned systems survive into the bundle.
    expect(block).toContain("concepts.has(o.concept ?? \"\")");
  });

  it("3. the button exists, hides when nothing may be seeded, and obeys disabled", () => {
    const testidAt = src.indexOf('data-testid="mri-brain-seed-normals"');
    expect(testidAt).toBeGreaterThan(-1);
    const button = src.slice(testidAt - 1300, testidAt + 1600);
    expect(button).toContain("seedPlan.count > 0");
    expect(button).toContain("disabled={disabled}");
    // The count is honest — it names how many systems will be seeded.
    expect(button).toContain("Seed unmentioned systems normal");
    expect(button).toContain("seedPlan.count");
  });

  it("4. the seed applies through the canvas' own applyMacroBundle path, as ONE bundle", () => {
    const testidAt = src.indexOf('data-testid="mri-brain-seed-normals"');
    const button = src.slice(testidAt - 1300, testidAt + 1600);
    expect(button).toContain("applyMacroBundle(");
    expect(button).toContain('brainBundleId("normal", "seed")');
    expect(button).toContain("observations: seedPlan.observations");
  });

  it("5. a full seed also offers the system normal impression — the store's own guard decides", () => {
    const testidAt = src.indexOf('data-testid="mri-brain-seed-normals"');
    const button = src.slice(testidAt - 1300, testidAt + 1600);
    // Same follow-up call the ★ Completely-Normal preset makes; the store
    // refuses when an abnormal is present, so a partial seed never gets a
    // whole-study normal conclusion.
    expect(button).toContain("seedSystemNormalImpression()");
  });

  it("6. no second write path — nothing beyond applyMacroBundle + the impression offer", () => {
    const testidAt = src.indexOf('data-testid="mri-brain-seed-normals"');
    const button = src.slice(testidAt - 1300, testidAt + 1600);
    expect(button).not.toContain("removeMacroBundle");
    expect(button).not.toContain("applyPathologyOverlay");
    expect(button).not.toContain("setField");
    expect(button).not.toContain("removeObservation");
  });
});

describe("MRI Brain canvas normal-seed — the plan helper stays one rule", () => {
  it("7. ONE planner, pure: no clock, no randomness, no I/O, no store import", () => {
    const lib = read("lib/brainCanvasSeed.ts");
    expect(lib).toContain("export function planBrainNormalSeed");
    expect(lib).not.toContain("Date.now");
    expect(lib).not.toContain("Math.random");
    expect(lib).not.toContain("zai-workspace/store");
  });
});
