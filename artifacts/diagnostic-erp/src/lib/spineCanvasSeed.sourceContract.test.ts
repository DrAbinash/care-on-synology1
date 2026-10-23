/**
 * Source contracts — the seed button on each MRI spine canvas actually uses
 * the plan, goes through the canvas' OWN onApplyLevel prop (the ReportCanvas
 * handler that builds the per-level bundle and writes the canonical ledger),
 * and can never touch a level that is not empty.
 *
 * The unit contracts in spineCanvasSeed.test.ts pin the plan; these pins
 * guard the wiring on all three canvases (lumbar / cervical / dorsal).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const LUMBAR = "components/radiology/reporting-canvas/MriLumbarCanvas.tsx";
const CERVICAL = "components/radiology/reporting-canvas/MriCervicalCanvas.tsx";
const DORSAL = "components/radiology/reporting-canvas/MriDorsalCanvas.tsx";

const CANVASES = [
  { name: "lumbar", file: LUMBAR, testid: "mri-lumbar-seed-normals", derive: "deriveLevelBlockDisplay" },
  { name: "cervical", file: CERVICAL, testid: "mri-cervical-seed-normals", derive: "deriveCervicalLevelBlockDisplay" },
  { name: "dorsal", file: DORSAL, testid: "mri-dorsal-seed-normals", derive: "deriveDorsalLevelBlockDisplay" },
] as const;

function seedBlock(src: string): string {
  const start = src.indexOf("const seedPlan = useMemo");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("const focusIndex");
  return src.slice(start, end > start ? end : undefined);
}

describe("MRI spine canvas normal-seed — wiring on all three canvases", () => {
  for (const c of CANVASES) {
    describe(`${c.name} canvas`, () => {
      const src = read(c.file);

      it(`1. imports the shared plan helper and derives the plan from patches + findingsText`, () => {
        expect(src).toContain('planSpineNormalSeed } from "@/lib/spineCanvasSeed"');
        const block = seedBlock(src);
        // The plan reads the SAME ledger inputs the level blocks read —
        // patches and the live findings text — so a level whose narrative
        // the radiologist already typed is never seeded over.
        expect(block).toContain("planSpineNormalSeed(");
        expect(block).toContain(c.derive);
        expect(block).toContain("patches");
        expect(block).toContain("findingsText");
        // Only disc levels are seed candidates — never the region cards.
        expect(block).toContain('"disc-level"');
      });

      it(`2. the seed applies through onApplyLevel with a NORMAL morphology — the canvas' own canonical path`, () => {
        const testidAt = src.indexOf(`data-testid="${c.testid}"`);
        expect(testidAt).toBeGreaterThan(-1);
        const button = src.slice(testidAt - 1100, testidAt + 1400);
        expect(button).toContain("seedPlan.seeds");
        expect(button).toContain("onApplyLevel(");
        expect(button).toContain('morphology: "normal"');
        // One apply per seeded level — same provenance as a manual apply.
        expect(button).toContain("for (const seed of seedPlan.seeds)");
      });

      it(`3. the button hides when there is nothing empty, and obeys disabled`, () => {
        const testidAt = src.indexOf(`data-testid="${c.testid}"`);
        const button = src.slice(testidAt - 1100, testidAt + 1400);
        expect(button).toContain("seedPlan.seeds.length > 0");
        expect(button).toContain("!disabled");
        // The count is honest — it names how many levels will be seeded.
        expect(button).toContain("seedPlan.seeds.length");
      });

      it(`4. the canvas never writes the store directly for seeding (no second write path)`, () => {
        const testidAt = src.indexOf(`data-testid="${c.testid}"`);
        const button = src.slice(testidAt - 1100, testidAt + 1400);
        expect(button).not.toContain("useWorkspace.getState()");
        expect(button).not.toContain("applyMacroBundle");
        expect(button).not.toContain("applyPathologyOverlay");
      });
    });
  }
});

describe("MRI spine canvas normal-seed — the plan helper stays one rule", () => {
  it("5. ONE plan helper, shared; each canvas derives emptiness with its own display function", () => {
    const lib = read("lib/spineCanvasSeed.ts");
    expect(lib).toContain("export function planSpineNormalSeed");
    // Deterministic and pure: no clock, no randomness, no I/O.
    expect(lib).not.toContain("Date.now");
    expect(lib).not.toContain("Math.random");
    // The only display kind that seeds.
    expect(lib).toContain('"empty"');
  });

  it("6. ReportCanvas is untouched by the seed — the canvases' existing onApplyLevel handlers ARE the path", () => {
    const rc = read("components/radiology/workspace/ReportCanvas.tsx");
    expect(rc).not.toContain("planSpineNormalSeed");
    expect(rc).not.toContain("spineCanvasSeed");
    // The three handlers still route through the per-segment bundle builders.
    expect(rc).toContain("buildLumbarLevelApplyBundle");
    expect(rc).toContain("buildCervicalLevelApplyBundle");
    expect(rc).toContain("buildDorsalLevelApplyBundle");
  });

  it("7. the dorsal canvas plans over the coverage-limited level list, not the static full list", () => {
    const src = read(DORSAL);
    const block = seedBlock(src);
    // Dorsal rows come from the dorsalNumbering-limited regions memo —
    // a study that never reached T12-L1 must not offer to seed it.
    expect(block).toContain("regions");
    expect(block).not.toContain("MRI_DORSAL_ALL_REGIONS");
  });
});
