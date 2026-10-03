/**
 * mriBrainCanvasPlacement.test.ts — where the MRI Brain palette renders.
 *
 * The brain catalog is the largest one in the workspace (16 sub-masters,
 * `mriBrainSubMasters.ts`), and it was also the only one that did not appear in
 * the report body. Lumbar, cervical, dorsal and chest each mount their canvas in
 * `ReportCanvas.tsx`; brain mounted only inside the right-hand tools rail, under
 * a "Structured" sub-tab, behind two nested predicates. The result was that a
 * radiologist opening a routine MRI Brain saw a measurements strip and no
 * palette, with nothing on screen to suggest a palette existed. This test is the
 * guard against that configuration returning.
 *
 * There is no DOM render in this repo's test suite, so the contract is enforced
 * as source wiring, the same way the dorsal and dorso-lumbar phases enforce
 * theirs. Say plainly what that can and cannot catch: it proves a component is
 * mounted in one file and not another, and that the mount sits under a named
 * predicate. It does NOT prove the rendered tree — a predicate that is itself
 * wrong, or a canvas that mounts and then returns null, passes here. The
 * behavioural half of that lives in `reportingStudyContext` and
 * `mriBrainSubMasters` tests, which decide which study gets which canvas.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8");

const BODY = "src/components/radiology/workspace/ReportCanvas.tsx";
const RAIL = "src/components/radiology/workspace/ReportingToolsRail.tsx";

/**
 * The source files are CRLF and `core.autocrlf=true`, so a literal "\n" between
 * two statements is not stable across checkout. Newlines are normalised once
 * here rather than sprinkled through every assertion.
 */
const body = read(BODY).replace(/\r\n/g, "\n");
const rail = read(RAIL).replace(/\r\n/g, "\n");

describe("the MRI Brain palette renders in the report body", () => {
  it("mounts MriBrainCanvas in ReportCanvas, not only in the tools rail", () => {
    expect(body).toMatch(/<MriBrainCanvas\b/);
  });

  it("imports it from the shared reporting-canvas barrel, like the spine canvases", () => {
    const importBlock = body.match(/import \{([^}]*)\} from "@\/components\/radiology\/reporting-canvas";/s);
    expect(importBlock).not.toBeNull();
    expect(importBlock![1]).toContain("MriBrainCanvas");
    // Same import list carries the peer canvases — brain is not a special case.
    for (const peer of ["MriLumbarCanvas", "MriCervicalCanvas", "MriDorsalCanvas"]) {
      expect(importBlock![1]).toContain(peer);
    }
  });

  it("keeps the palette inside the same outer gate the measures strip already used", () => {
    // The body used to read: isBrainMeasuresReportingContext(...) && <BrainMeasuresStrip/>.
    // The palette must live in that block so a study that earns the measures strip
    // is the one that earns the palette, and a chest X-ray earns neither.
    const gate = body.indexOf("isBrainMeasuresReportingContext({");
    const canvas = body.indexOf("<MriBrainCanvas");
    const strip = body.indexOf("<BrainMeasuresStrip");
    expect(gate).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(gate);
    expect(strip).toBeGreaterThan(gate);
    // …and before the next unrelated gate, so the three really are one block.
    const nextGate = body.indexOf("isMriLumbarReportingContext({", gate);
    expect(canvas).toBeLessThan(nextGate);
    expect(strip).toBeLessThan(nextGate);
  });

  it("narrows the palette to MRI, so a CT brain gets measures but not MRI tiles", () => {
    // MriBrainCanvas carries MRI-specific sequence and vascular gating; showing it
    // for a CT head would offer tiles that cannot apply to the acquired study.
    const inner = body.indexOf("isMriBrainReportingContext({");
    const canvas = body.indexOf("<MriBrainCanvas");
    expect(inner).toBeGreaterThan(-1);
    expect(inner).toBeLessThan(canvas);
  });

  it("renders the palette above the measures strip", () => {
    // A radiologist reads top-down: pick the findings, then score them.
    expect(body.indexOf("<MriBrainCanvas")).toBeLessThan(body.indexOf("<BrainMeasuresStrip"));
  });
});

describe("the palette is not offered twice", () => {
  it("does not mount MriBrainCanvas in the tools rail", () => {
    // Duplicated mounts would write the same tile twice into the observation
    // ledger through two different surfaces, and the two copies could fall out
    // of step on `disabled`.
    expect(rail).not.toMatch(/<MriBrainCanvas\b/);
  });

  it("does not mount BrainMeasuresStrip in the tools rail either", () => {
    expect(rail).not.toMatch(/<BrainMeasuresStrip\b/);
  });

  it("leaves no dangling brain imports in the rail", () => {
    // A stale import alongside a removed mount is how a duplicate gets re-added:
    // the symbol looks available.
    expect(rail).not.toMatch(/\bMriBrainCanvas\b/);
    expect(rail).not.toMatch(/\bBrainMeasuresStrip\b/);
    expect(rail).not.toMatch(/\bisMriBrainReportingContext\b/);
    expect(rail).not.toMatch(/\bisBrainMeasuresReportingContext\b/);
  });
});

describe("the spine canvases keep their existing placement", () => {
  // The change moved brain, not the others. If any of these fail, something was
  // restructured beyond the stated scope.
  it.each([
    "MriLumbarCanvas",
    "MriCervicalCanvas",
    "MriDorsalCanvas",
  ])("still mounts %s in the report body", (name) => {
    expect(body).toContain(`<${name}`);
  });
});
