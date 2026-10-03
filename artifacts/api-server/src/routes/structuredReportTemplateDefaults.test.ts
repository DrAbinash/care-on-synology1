/**
 * structuredReportTemplateDefaults.test.ts — the per-region default format.
 *
 * `preferRegionDefault` on the ERP side resolves a group as
 * `defaults[0] ?? first-v2-row ?? rows[0]`. With no preset declaring isDefault,
 * every region took the last clause, so "which format does a brain MRI open on"
 * was decided by template_name ordering. Production data confirmed it: all 29
 * rows had is_default = false.
 *
 * PRESETS is module-private and this file imports `@workspace/db` at module
 * scope, so importing it here would make the test collect-only-where-a-database
 * exists. These are structure checks over the source instead, which run anywhere.
 * The behavioural half — that a declared default actually beats sort order — is
 * pinned in the ERP's pickStructuredTemplate.test.ts, against the real resolver.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "structuredReportTemplates.ts"), "utf8").replace(/\r\n/g, "\n");

/** Split PRESETS into one record per object literal, keyed off templateName. */
type PresetShape = {
  templateName: string;
  modality: string;
  bodyPart: string;
  isDefault: boolean;
};

function parsePresets(): PresetShape[] {
  const start = src.indexOf("const PRESETS = [");
  expect(start, "PRESETS array not found").toBeGreaterThan(-1);
  const tail = src.slice(start);

  const marks = [...tail.matchAll(/^ {4}templateName: "([^"]+)",$/gm)];
  return marks.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index! : tail.length;
    const body = tail.slice(from, to);
    const grab = (key: string) => body.match(new RegExp(`^ {4}${key}: "([^"]*)",$`, "m"))?.[1] ?? "";
    return {
      templateName: m[1],
      modality: grab("modality"),
      bodyPart: grab("bodyPart"),
      isDefault: /^ {4}isDefault: true,$/m.test(body),
    };
  });
}

describe("preset-declared default formats", () => {
  const presets = parsePresets();

  it("parses every preset, so a shape change fails loudly rather than silently", () => {
    expect(presets.length).toBe(16);
    expect(presets.every((p) => p.templateName && p.modality && p.bodyPart)).toBe(true);
  });

  it("declares at most one default per modality + body part", () => {
    // Two defaults in a group makes preferRegionDefault pick defaults[0] — an
    // order-dependent choice with a console.warn only outside production. A fresh
    // install would never see that warning.
    const groups = new Map<string, string[]>();
    for (const p of presets.filter((x) => x.isDefault)) {
      const key = `${p.modality}/${p.bodyPart}`;
      groups.set(key, [...(groups.get(key) ?? []), p.templateName]);
    }
    const duplicated = [...groups.entries()].filter(([, names]) => names.length > 1);
    expect(duplicated).toEqual([]);
  });

  it("opens a routine MRI Brain on the plain format, not contrast or stroke", () => {
    const brain = presets.filter((p) => p.modality === "MRI" && p.bodyPart === "BRAIN");
    expect(brain.map((p) => p.templateName).sort()).toEqual([
      "MRI Brain Plain",
      "MRI Brain With Contrast",
      "MRI Stroke Protocol",
    ]);
    expect(brain.filter((p) => p.isDefault).map((p) => p.templateName)).toEqual(["MRI Brain Plain"]);
  });

  it("claims a default for every PRESETS group that holds more than one format", () => {
    // The rule is one-directional. A group with several formats must state which
    // one opens, because rows[0] there is a real coin-flip. A group with one
    // format may declare a default anyway — it is redundant but honest, and it
    // stops being redundant the day a second format is added to that region.
    const counts = new Map<string, number>();
    const defaulted = new Set<string>();
    for (const p of presets) {
      const key = `${p.modality}/${p.bodyPart}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (p.isDefault) defaulted.add(key);
    }
    const ambiguous = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
    const undeclared = ambiguous.filter((k) => !defaulted.has(k));
    expect(undeclared).toEqual([]);

    // The four that actually were coin-flips in production, pinned by name so a
    // future edit cannot quietly satisfy the generic rule above some other way.
    expect(ambiguous).toEqual(["CT/BRAIN", "MRI/BRAIN", "MRI/SPINE_CERVICAL", "MRI/SPINE_LS"]);
  });

  it("does not cover the ultrasound presets, and says so rather than implying it does", () => {
    // USG_STRUCTURED_TEMPLATE_PRESETS is a second array built by mapping over a
    // different source, and it contributes the rows that share a body part in
    // production ("USG Abdomen" + "Whole Abdomen", three obstetric scans, the two
    // pelvic and two limb-doppler pairs). None of those are defaulted here.
    // Asserting only over PRESETS keeps this test honest about its own reach.
    expect(src).toContain("USG_STRUCTURED_TEMPLATE_PRESETS");
    expect(src).toMatch(/const allPresets = \[\.\.\.PRESETS, \.\.\.USG_STRUCTURED_TEMPLATE_PRESETS\]/);
  });

  it("leaves the ultrasound groups without an invented preference", () => {
    // "USG Abdomen" vs "Whole Abdomen", three obstetric scans, two pelvic and two
    // limb-doppler rows are clinical choices this file has no authority to make.
    expect(presets.filter((p) => p.modality === "USG" && p.isDefault)).toEqual([]);
  });
});

describe("how the flag reaches rows that already exist", () => {
  it("has a dedicated sync, because neither existing path can carry it", () => {
    expect(src).toMatch(/async function syncPresetDefaultFlags\(\)/);
    expect(src).toMatch(/const defaultsApplied = await syncPresetDefaultFlags\(\);/);
  });

  it("is wired into the sync the templates list calls on every load", () => {
    const body = src.slice(
      src.indexOf("export async function syncStructuredReportPresets"),
      src.indexOf("structuredReportTemplatesRouter.get(\"/\""),
    );
    expect(body).toContain("ensurePresetTemplatesSeeded()");
    expect(body).toContain("syncPresetDefaultFlags()");
  });

  it("never clears a default it did not set", () => {
    // The one-way rule: an administrator's chosen format, or a default another
    // preset already owns, must survive. A group reduced to zero defaults would
    // silently fall back to sort order — the exact state this change removes.
    const fn = src.slice(
      src.indexOf("async function syncPresetDefaultFlags"),
      src.indexOf("export async function syncStructuredReportPresets"),
    );
    expect(fn).toMatch(/if \(!row \|\| row\.isDefault\) continue;/);
    expect(fn).toMatch(/if \(alreadyOwned\) continue;/);
    expect(fn).toMatch(/\.set\(\{\s*\n\s*isDefault: true,/);
    expect(fn).not.toMatch(/isDefault: false/);
  });
});
