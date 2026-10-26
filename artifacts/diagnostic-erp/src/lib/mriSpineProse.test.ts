/**
 * mriSpineProse.test.ts — the contract of the shared spine template engine.
 *
 * This engine was lifted out of `mriLumbarLibrary.ts` by pure refactor, so these
 * tests pin TWO things:
 *
 *   1. Shipped MRI lumbar wording is unchanged. The conus cases below are the
 *      exact sentences current main composes; they are asserted rather than
 *      merely hoped for, because the extraction was reviewed against them.
 *   2. The engine never invents. Anything the caller did not supply stays
 *      visible in the text AND is reported in `unfilled` — a library
 *      placeholder must never be silently guessed into a report, and must never
 *      leak into prose while also being reported as missing.
 *
 * Deliberately pinned, even though it is clinically arguable: when no conus
 * level is supplied but a disc level is, the sentence takes the disc level.
 * That is main's shipped behaviour. Changing it is a clinical-content decision
 * with its own review, not something a refactor PR may slip through.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  fillSpineProse,
  isUnfilledSpineProse,
  LUMBAR_PROSE_DIALECT,
  type SpineProseVars,
} from "@/lib/mriSpineProse";
import {
  LS_ALIGN,
  LS_LIBRARY_PROSE,
  LS_MACRO_LINES,
  fillLsProse,
  isUnfilledProse,
} from "@/lib/mriLumbarLibrary";

const HERE = dirname(fileURLToPath(import.meta.url));

const fill = (template: string, vars: SpineProseVars = {}) =>
  fillSpineProse(template, vars, LUMBAR_PROSE_DIALECT);

/** Every string the lumbar library can hand to the engine. */
function allLibraryStrings(): string[] {
  const out: string[] = [...Object.values(LS_LIBRARY_PROSE)];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node as Record<string, unknown>).forEach(walk);
  };
  walk(LS_MACRO_LINES);
  return [...new Set(out)];
}

const STATE_GRID: Array<SpineProseVars> = [
  {},
  { level: "L4-L5" },
  { level: "L4-L5", level2: "L5-S1" },
  { conusLevel: "L1" },
  { conusLevel: "L1-L2" },
  { conusLevel: "L6 on S1" },
  { conusLevel: "L1", level: "L4-L5" },
  { level: "L6", level2: "S1", vertebra: "L6" },
  { vertebra: "L5", root: "S1", side: "right" },
  { mm: 4, mm2: 7, cm: 3, cm2: 4, pct: 55 },
  { side: "bilateral", direction: "caudally", castellvi: "IIa", endplateFace: "superior" },
];

describe("mriSpineProse — shipped lumbar wording is pinned", () => {
  it("composes the conus sentence exactly as the inline engine did", () => {
    // An explicit conus level wins.
    expect(fill(LS_ALIGN.conusNormal, { conusLevel: "L1" }).text).toBe(
      "Conus medullaris terminates normally at the L1 level.",
    );
    expect(fill(LS_ALIGN.conusNormal, { conusLevel: "L1-L2" }).text).toBe(
      "Conus medullaris terminates normally at the L1-L2 level.",
    );
    // Shipped main behaviour, preserved on purpose: with no conus level the
    // group falls back to the level the tile was captured at.
    expect(fill(LS_ALIGN.conusNormal, { level: "L4-L5" }).text).toBe(
      "Conus medullaris terminates normally at the L4-L5 level.",
    );
    // With nothing at all, the group stays visible and is reported.
    const unconfirmed = fill(LS_ALIGN.conusNormal, {});
    expect(unconfirmed.text).toContain("[L1 / L1-L2]");
    expect(unconfirmed.unfilled.map((u) => u.raw)).toEqual(["[L1 / L1-L2]"]);
    expect(isUnfilledSpineProse(unconfirmed.text)).toBe(true);
  });

  it("renders LSTV levels without renumbering anything", () => {
    expect(fill("The conus terminates at [L1 / L1-L2].", { conusLevel: "L6 on S1" }).text).toBe(
      "The conus terminates at L6 on S1.",
    );
    expect(fill("Listhesis of [L4 on L5].", { level: "L6", level2: "S1" }).text).toBe(
      "Listhesis of L6 on S1.",
    );
    expect(fill("Disc desiccation at [L4-L5 / L5-S1].", { level: "L6-S1" }).text).toBe(
      "Disc desiccation at L6-S1.",
    );
  });

  it("is the same function the lumbar library delegates to", () => {
    for (const text of allLibraryStrings()) {
      for (const vars of STATE_GRID) {
        expect(fill(text, vars)).toEqual(fillLsProse(text, vars));
      }
    }
  });
});

describe("mriSpineProse — it never invents, and never hides a gap", () => {
  it("reports every bracketed placeholder that survives into the prose", () => {
    for (const text of allLibraryStrings()) {
      for (const vars of STATE_GRID) {
        const out = fill(text, vars);
        for (const slot of out.unfilled) expect(out.text, text).toContain(slot.raw);
        // A bracket group may only stay visible if it was reported.
        const leftVisible = /\[[^\]]+\]/.test(out.text);
        if (leftVisible) expect(out.unfilled.length, `${text} @ ${JSON.stringify(vars)}`).toBeGreaterThan(0);
      }
    }
  });

  it("leaves an unsupplied bare macro measurement visible, as main does", () => {
    // Library macros write some measurements as bare `X mm` / `X%` with no
    // brackets. The engine substitutes them in order per unit and, when the
    // caller supplied nothing, leaves the `X` standing so the unfilled detector
    // still flags the sentence — it never guesses a number.
    const bare = "Broad-based posterior disc-osteophyte complex (AP diameter X mm).";
    const out = fill(bare, {});
    expect(out.text).toBe(bare);
    // This asserted `toEqual([])` while the line below insisted the same text reads
    // as unfilled, and while `fillSpineProse`'s own doc comment promised unsupplied
    // placeholders are "reported in `unfilled`". A bare measurement was left visible
    // but never reported, so nothing downstream could gate it and a printed page said
    // "measuring X mm" beside an empty fill-in list.
    expect(out.unfilled.map((s) => s.raw)).toEqual(["X mm"]);
    expect(isUnfilledSpineProse(out.text)).toBe(true);
    expect(fill(bare, { mm: 4 }).text).toBe("Broad-based posterior disc-osteophyte complex (AP diameter 4 mm).");
  });

  it("keeps a filled sentence idempotent", () => {
    for (const text of allLibraryStrings()) {
      const filled = fill(text, STATE_GRID[STATE_GRID.length - 1]).text;
      if (isUnfilledSpineProse(filled)) continue;
      expect(fill(filled, {}).text).toBe(filled);
    }
  });

  it("accepts an exemplary level that differs from the library's example", () => {
    expect(fill("Disc desiccation at [L4-L5 / L5-S1].", { level: "L2-L3" }).text).toBe(
      "Disc desiccation at L2-L3.",
    );
  });

  it("refuses a value outside a true enumeration", () => {
    expect(fill("The [left/right] nerve root.", { side: "central" }).unfilled.length).toBe(1);
    expect(fill("Migration [superiorly/inferiorly].", { direction: "laterally" }).unfilled.length).toBe(1);
    expect(fill("Castellvi grade [I/II/III/IV].", { castellvi: "V" }).unfilled.length).toBe(1);
  });

  it("accepts a Castellvi subtype of a listed grade", () => {
    expect(fill("Castellvi grade [I/II/III/IV].", { castellvi: "IIa" }).text).toBe(
      "Castellvi grade IIa.",
    );
  });

  it("consumes measurements in order per unit", () => {
    expect(fill("AP [X] mm with transverse [X] mm.", { mm: 4, mm2: 7 }).text).toBe(
      "AP 4 mm with transverse 7 mm.",
    );
    // The library's own idiom is one trailing unit for a paired dimension.
    expect(fill("Lesion [X] x [X] cm.", { cm: 3, cm2: 4 }).text).toBe("Lesion 3 x 4 cm.");
    expect(fill("Height loss of [X] %.", { pct: 55 }).text).toBe("Height loss of 55 %.");
    expect(fill("Bone loss X mm.", { mm: 6 }).text).toBe("Bone loss 6 mm.");
  });

  it("fills a side-and-vertebra group from both fields", () => {
    expect(fill("Foraminal narrowing at [left L5].", { side: "right", root: "S1" }).text).toBe(
      "Foraminal narrowing at right S1.",
    );
  });

  it("joins a two-level group only when both levels are present", () => {
    expect(fill("Modic change at [L4-L5 and L5-S1].", { level: "L4-L5", level2: "L5-S1" }).text).toBe(
      "Modic change at L4-L5 and L5-S1.",
    );
    expect(fill("Modic change at [L4-L5 and L5-S1].", { level: "L4-L5" }).unfilled.length).toBe(1);
  });

  it("agrees with the lumbar unfilled detector", () => {
    for (const probe of ["[L1 / L1-L2]", "no placeholders here", "AP X mm", "AP 4 mm", ""]) {
      expect(isUnfilledSpineProse(probe)).toBe(isUnfilledProse(probe));
    }
  });
});

describe("mriSpineProse — one engine, no second copy", () => {
  it("leaves the engine internals out of the lumbar library", () => {
    const src = readFileSync(resolve(HERE, "mriLumbarLibrary.ts"), "utf8");
    expect(src).toContain('from "./mriSpineProse"');
    for (const internalName of [
      "function classifyGroup",
      "function resolveGroup",
      "function fillBareMeasurements",
      "const CHOICE_GROUP",
    ]) {
      expect(src, `the engine must not be re-forked into the library: ${internalName}`).not.toContain(internalName);
    }
  });
});

/**
 * The doc comment on `fillSpineProse` promises that an unsupplied placeholder "stays
 * exactly as the library wrote it and is reported in `unfilled`, so the UI renders it
 * as a required fill-in". A bracketed group kept that promise; a bare macro measurement
 * did not — it was returned verbatim with `unfilled` empty, so a sentence reading
 * "measuring X mm in thickness" reached the printed page carrying no signal at all.
 */
describe("bare macro measurements report themselves (audit P1-c)", () => {
  const template =
    "Subdural/epidural soft tissue component extending from T9 to T10 measuring X mm in thickness.";

  it("names the measurement it could not fill", () => {
    const result = fillLsProse(template);
    expect(result.text).toContain("X mm");
    expect(result.unfilled.map((s) => s.raw)).toContain("X mm");
  });

  it("reports nothing when the measurement was supplied", () => {
    const result = fillLsProse(template, { mm: 6 });
    expect(result.text).toContain("6 mm");
    expect(result.text).not.toContain("X mm");
    expect(result.unfilled).toEqual([]);
  });

  it("agrees with isUnfilledSpineProse, which is what every downstream gate tests", () => {
    for (const vars of [{}, { mm: 6 }] satisfies SpineProseVars[]) {
      const result = fillLsProse(template, vars);
      expect(result.unfilled.length > 0).toBe(isUnfilledSpineProse(result.text));
    }
  });

  it("treats a chained dimension as one unfilled group", () => {
    const result = fillLsProse("A mass measuring X mm (AP) x X mm (transverse).", { mm: 4 });
    // One value supplied for two: the whole group must stay, not fill half.
    expect(result.text).toContain("X mm");
    expect(result.unfilled.length).toBeGreaterThan(0);
  });
});
