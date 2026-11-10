/**
 * mriBrainCanvasPlacement.test.ts — where the MRI Brain palette renders.
 *
 * The brain catalog is the largest one in the workspace (16 sub-masters,
 * `mriBrainSubMasters.ts`). History: the brain pair used to mount only inside
 * the tools rail's "Structured" sub-tab; it was then moved into the report
 * body — but that whole body drawer was later retired behind a literal
 * `{false && (...)}` gate, so the pair rendered NOWHERE while this file's
 * source-text predecessor stayed green (audit finding F-01, verified live:
 * an MRI Brain study showed no palettes while an MRI Lumbar study showed its
 * full set). Every other modality canvas had been re-mounted on the live
 * Reporting Tools rail; the brain pair had not.
 *
 * The contract is therefore now the OPPOSITE of the original one: the brain
 * pair mounts on the LIVE rail pane, and the retired body copy must not come
 * back. There is no DOM render in this repo's test suite, so the contract is
 * enforced as source wiring, the same way the dorsal and dorso-lumbar phases
 * enforce theirs. Say plainly what that can and cannot catch: it proves a
 * component is mounted in one file and gated under a named predicate, and —
 * new in this revision — that the mount file contains no `{false &&` dead
 * gate at all, which is exactly the mechanism that hid F-01. It does NOT
 * prove the rendered tree; a predicate that is itself wrong, or a canvas
 * that mounts and then returns null, still passes here. The behavioural half
 * lives in `reportingStudyContext` and `mriBrainSubMasters` tests, which
 * decide which study gets which canvas.
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

describe("the MRI Brain palette renders on the live tools rail", () => {
  it("mounts MriBrainCanvas and BrainMeasuresStrip in the rail", () => {
    expect(rail).toMatch(/<MriBrainCanvas\b/);
    expect(rail).toMatch(/<BrainMeasuresStrip\b/);
  });

  it("imports them from the shared reporting-canvas barrel, like the spine canvases", () => {
    const importBlock = rail.match(/import \{([^}]*)\} from "@\/components\/radiology\/reporting-canvas";/s);
    expect(importBlock).not.toBeNull();
    expect(importBlock![1]).toContain("MriBrainCanvas");
    expect(importBlock![1]).toContain("BrainMeasuresStrip");
    // Same import list carries the peer canvases — brain is not a special case.
    for (const peer of ["MriLumbarCanvas", "MriCervicalCanvas", "MriDorsalCanvas"]) {
      expect(importBlock![1]).toContain(peer);
    }
  });

  it("gates the pair on isBrainMeasuresReportingContext, the gate the retired body copy used", () => {
    const gate = rail.indexOf("isBrainMeasuresReportingContext({");
    const canvas = rail.indexOf("<MriBrainCanvas");
    const strip = rail.indexOf("<BrainMeasuresStrip");
    expect(gate).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(gate);
    expect(strip).toBeGreaterThan(gate);
    // …and before the lumbar gate, so the three really are one block.
    const nextGate = rail.indexOf("isMriLumbarReportingContext({", gate);
    expect(canvas).toBeLessThan(nextGate);
    expect(strip).toBeLessThan(nextGate);
  });

  it("narrows the palette to MRI, so a CT brain gets measures but not MRI tiles", () => {
    // MriBrainCanvas carries MRI-specific sequence and vascular gating; showing it
    // for a CT head would offer tiles that cannot apply to the acquired study.
    const inner = rail.indexOf("isMriBrainReportingContext({");
    const canvas = rail.indexOf("<MriBrainCanvas");
    expect(inner).toBeGreaterThan(-1);
    expect(inner).toBeLessThan(canvas);
  });

  it("keeps the CT-brain exclusion guard and the worklistDetail modality fallback", () => {
    // Verified live during the fix: on a deep-linked study the reading queue may
    // not contain the row (queue defaults to MR), currentRow is null, and both
    // brain predicates would pass on family alone — offering MRI tiles on a CT
    // head. Two hardenings pin that shut: the modality falls back to the
    // worklist detail (useWorkspaceClinicalUi:1267 pattern), and the palette is
    // additionally excluded whenever the CT-brain context matches.
    const guard = rail.indexOf("isCtBrainReportingContext({");
    const canvas = rail.indexOf("<MriBrainCanvas");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(canvas);
    expect(rail).toContain("workflow.currentRow?.modality ?? worklistDetailQ.data?.modality");
  });

  it("renders the palette above the measures strip", () => {
    // A radiologist reads top-down: pick the findings, then score them.
    expect(rail.indexOf("<MriBrainCanvas")).toBeLessThan(rail.indexOf("<BrainMeasuresStrip"));
  });

  it("keeps the rail free of dead `{false &&` gates — the mechanism that hid F-01", () => {
    // A mount that "exists" behind `{false && ...}` never renders, and a
    // source-text test still finds it. Forbid the pattern outright in the
    // one file that carries every structured canvas mount, so no future
    // canvas can be retired invisibly the way the brain pair was. Comments
    // are stripped first: this test (and the rail's own history notes)
    // quote the pattern textually.
    const railWithoutComments = rail
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(railWithoutComments).not.toMatch(/\{\s*false\s*&&/);
  });
});

describe("the retired body copy must not come back", () => {
  // Block comments are stripped before symbol matching: the body keeps a
  // breadcrumb comment that names the retired symbols on purpose.
  const bodyWithoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");

  it("ReportCanvas no longer mounts or imports the brain pair", () => {
    // The body drawer behind `{false && (...)}` is retired; brain mounts
    // there rendered nowhere (audit F-01). Any re-introduction is a second,
    // competing mount source writing the same tiles twice.
    for (const symbol of [
      "MriBrainCanvas",
      "BrainMeasuresStrip",
      "isMriBrainReportingContext",
      "isBrainMeasuresReportingContext",
    ]) {
      expect(bodyWithoutComments).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    }
  });

  it("leaves a breadcrumb where the pair used to live, pointing at the rail", () => {
    // The next reader of that drawer deserves to know why brain is absent
    // from it, and where the live mount is.
    expect(body).toMatch(/audit F-01/i);
  });
});

describe("the spine canvases keep their rail placement", () => {
  // If any of these fail, something was restructured beyond the stated scope.
  it.each([
    "MriLumbarCanvas",
    "MriCervicalCanvas",
    "MriDorsalCanvas",
  ])("still mounts %s on the rail", (name) => {
    expect(rail).toContain(`<${name}`);
  });
});
