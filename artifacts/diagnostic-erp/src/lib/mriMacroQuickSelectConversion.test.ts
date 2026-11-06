/**
 * The MRI macro conversion, held to account.
 *
 * `structured_report_templates.macros_json` holds 22 sentences the radiologist-owner wrote and
 * approved; `migrations/zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r001.sql` turns 10 of them
 * into Quick Select boxes. Both halves of that claim are checkable from source, and this file checks
 * them, because the failure mode of a conversion is silent: a bracket slot left in the prose prints a
 * hole in a signed report, a defaulted side prints an invented laterality, a paragraph re-worded on
 * the way in stops being the owner's clinical language, and a macro quietly left out of the file
 * leaves the reporting desk without the sentence the owner believes she shipped.
 *
 * What is asserted is the SHAPE of the conversion, not its opinions: every box must be the owner's
 * own sentence with only her own brackets replaced, every parameter must be asked for rather than
 * assumed, and every one of the 22 macros must be either converted or named as excluded with a reason.
 *
 * Source-contract style, because this repo has no component-render harness and the migration is the
 * deploy contract.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../.."); // artifacts/diagnostic-erp
const repoRoot = resolve(pkgRoot, "../..");
const MIGRATION = resolve(repoRoot, "migrations/zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r001.sql");
const AUTHORED_MIGRATION = resolve(repoRoot, "migrations/zzzzzzzzzzzzzzzzzzzzzzz_mri_macro_quick_select_r002.sql");
const PRESETS = resolve(repoRoot, "artifacts/api-server/src/routes/structuredReportTemplates.ts");

const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
const authoredSql = readFileSync(AUTHORED_MIGRATION, "utf8").replace(/\r\n/g, "\n");

/** The columns in the file's own order, so a row is read as a record rather than as text. */
const COLUMNS = [
  "study_type", "label", "field", "scope_modality", "category", "concept", "conflict_group",
  "anatomical_section", "baseline_replaces", "properties", "questions_json",
  "finding_text", "impression_text", "technique_text", "recommendation_text",
  "sort_order", "is_active", "factory_key",
] as const;

/** Split one `('a', 'b', …)` tuple on top-level commas, honouring `''` escapes. */
function splitTuple(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === "'") {
        if (body[i + 1] === "'") { cur += "'"; i += 1; continue; }
        inString = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

type Box = Record<(typeof COLUMNS)[number], string>;

function readBoxes(text: string): Box[] {
  const start = text.indexOf("FROM (VALUES");
  const end = text.indexOf(") AS s(", start);
  expect(start, "the conversion has no VALUES block").toBeGreaterThan(-1);
  expect(end, "the conversion's VALUES block does not close where this test reads it").toBeGreaterThan(start);
  const block = text.slice(start + "FROM (VALUES".length, end);
  const rows: Box[] = [];
  // Each tuple starts at a `(` at line indent and ends at the `)` before its trailing comma.
  for (const line of block.split("\n")) {
    // One tuple per line; every one but the last carries its trailing comma.
    const trimmed = line.trim().replace(/,+$/, "");
    if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) continue;
    const parts = splitTuple(trimmed.slice(1, -1));
    expect(parts, `a row has ${parts.length} fields, not ${COLUMNS.length}: ${trimmed.slice(0, 60)}`)
      .toHaveLength(COLUMNS.length);
    rows.push(Object.fromEntries(COLUMNS.map((c, i) => [c, parts[i]])) as Box);
  }
  return rows;
}

const boxes = readBoxes(sql);
const authoredBoxes = readBoxes(authoredSql);
const allBoxes = [...boxes, ...authoredBoxes];

/**
 * The owner's macros as authored in the repo — the same JSON the route seeds into
 * `structured_report_templates.macros_json`, read out of the source that seeds it.
 */
function readMacros(): Map<string, { template: string; key: string; text: string }> {
  const src = readFileSync(PRESETS, "utf8").replace(/\r\n/g, "\n");
  const out = new Map<string, { template: string; key: string; text: string }>();
  let template = "";
  let insideMacros = false;
  for (const line of src.split("\n")) {
    const named = line.match(/templateName:\s*"([^"]+)"/);
    if (named) { template = named[1]; insideMacros = false; continue; }
    if (/macrosJson:/.test(line)) { insideMacros = true; continue; }
    if (!insideMacros) continue;
    if (/^\s*\]\)/.test(line)) { insideMacros = false; continue; }
    const m = line.match(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*text:\s*"((?:[^"\\]|\\.)*)"\s*\}/);
    if (m && template) out.set(`${template}/${m[1]}`, { template, key: m[1], text: m[3] });
  }
  return out;
}

const macros = readMacros();
const mriMacros = new Map(
  [...macros].filter(([, v]) => v.template.startsWith("MRI ")),
);

/** The exclusions the file names in its own header, as `<template>/<key>`. */
const excluded = new Set(
  [...sql.matchAll(/^--\s{3}\*\s+(MRI [^/]+) \/ ([a-z_]+):/gm)].map((m) => `${m[1]}/${m[2]}`),
);

/** Sentences an app baseline module renders, so a retirement string can be checked against one. */
function baselineSentences(): Set<string> {
  const dir = resolve(pkgRoot, "src/lib/zai-workspace/baselines");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
    const src = readFileSync(resolve(dir, f), "utf8").replace(/\r\n/g, "\n");
    for (const m of src.matchAll(/renderedText:\s*"([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

/**
 * The owner's sentence, with her bracket slots and this file's parameter tokens folded to one marker.
 * Comparing through this is what proves the conversion changed NOTHING but the slots: wording,
 * measurements, sequence names, qualifications and differentials all have to survive byte-for-byte.
 */
function canonical(sentence: string): string {
  return sentence
    .replace(/\[[^\]]*\]\s*(?:mm|cm|%)?/g, "[SLOT]")
    .replace(/\{[a-z_]+\}\s*(?:mm|cm|%)?/g, "[SLOT]")
    .replace(/\s+/g, " ")
    .trim();
}

const CHIP_TOKENS = new Set(["side", "severity", "level"]);

describe("every MRI macro is either converted or excluded with a reason", () => {
  it("reads the owner's macros out of the source that seeds them", () => {
    expect(mriMacros.size, "the MRI macro presets are not where this test reads them").toBe(22);
  });

  it("ships exactly the conversions the file claims", () => {
    expect(boxes.length).toBe(10);
    expect(authoredBoxes.length).toBe(14);
    expect(sql).toContain("This file converts 10 of those macros");
    expect(authoredSql).toContain("14 boxes are therefore NEWLY AUTHORED by this change");
  });

  it("accounts for all 22 macros, with none in both lists", () => {
    const shipped = new Set(boxes.map((b) => b.factory_key.replace(/^'|'$/g, "").replace(/^macro:/, "")));
    for (const key of mriMacros.keys()) {
      expect(
        shipped.has(key) || excluded.has(key),
        `${key} is neither converted nor named as excluded — the desk would silently not have it`,
      ).toBe(true);
    }
    for (const key of shipped) expect(mriMacros.has(key), `${key} is not a macro in the source`).toBe(true);
    for (const key of shipped) expect(excluded.has(key), `${key} is both shipped and excluded`).toBe(false);
    expect(excluded.size).toBe(mriMacros.size - shipped.size);
  });
});

describe("a converted box is the owner's sentence, unchanged", () => {
  it("keeps her wording byte-for-byte around the slots", () => {
    for (const box of boxes) {
      const key = box.factory_key.replace(/^'|'$/g, "").slice("macro:".length);
      const macro = mriMacros.get(key);
      expect(macro, `${key} names no macro`).toBeDefined();
      expect(canonical(box.finding_text), `finding text drifted from ${key}`)
        .toBe(canonical(macro!.text));
    }
  });

  it("claims no authored box as the owner's macro", () => {
    // `factory_key` arrives unquoted from the tuple reader, and its prefix is the provenance: the two
    // namespaces share nothing, so the clinic can retire this change's own content without touching a
    // single converted macro box — and no macro box can be mistaken for one the owner never wrote.
    for (const box of authoredBoxes) {
      expect(box.factory_key.startsWith("authored:")).toBe(true);
      const props = JSON.parse(box.properties) as { newlyAuthored?: boolean; reason?: string; source?: string };
      expect(props.newlyAuthored, `${box.label} must be visibly authored, not implied`).toBe(true);
      expect(props.source).toBe("newly-authored");
      expect((props.reason ?? "").length, `${box.label} ships with no stated reason`).toBeGreaterThan(20);
    }
    expect(boxes.every((b) => b.factory_key.startsWith("macro:"))).toBe(true);
    expect(boxes.every((b) => !b.factory_key.startsWith("authored:"))).toBe(true);
    expect(authoredBoxes.every((b) => !b.factory_key.includes("macro:"))).toBe(true);
  });

  it("leaves no square-bracket slot in any sentence it writes", () => {
    for (const box of allBoxes) {
      for (const [column, value] of Object.entries(box)) {
        if (column === "properties" || column === "questions_json") continue;
        expect(value, `${box.factory_key} still carries a bracket in ${column}`).not.toMatch(/\[[A-Za-z0-9/ ]{1,60}\]/);
      }
    }
  });

  it("strips the enhancement prose's own commas and cases from nothing", () => {
    // A guard against the other direction too: a conversion that "tidied" the owner's sentence.
    const withSlot = boxes.filter((b) => /\{[a-z_]+\}/.test(b.finding_text));
    expect(withSlot.length).toBeGreaterThan(0);
    for (const box of withSlot) {
      expect(box.finding_text).toMatch(/[a-z]/);
      expect(box.finding_text.endsWith(".")).toBe(true);
    }
  });
});

describe("a parameter is asked for, never assumed", () => {
  it("declares every token it writes", () => {
    for (const box of allBoxes) {
      const questions = JSON.parse(box.questions_json) as { key: string; required: boolean; default: string; options: string[] }[];
      const tokens = new Set(
        [...`${box.finding_text} ${box.impression_text}`.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]),
      );
      const asked = new Set(questions.map((x) => x.key));
      for (const token of tokens) {
        const byChips = CHIP_TOKENS.has(token) && questions.length === 0;
        expect(asked.has(token) || byChips,
          `${box.label} writes {${token}} that nothing asks for and no chip fills`).toBe(true);
      }
      for (const q of questions) {
        expect(q.required, `${box.label} asks an optional ${q.key}`).toBe(true);
        expect(q.default, `${box.label} pre-answers ${q.key} — that is an invented value`).toBe("");
        if (q.type === "select") expect(q.options.length, `${box.label} offers no answer for ${q.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the unit attached to the measurement it measures", () => {
    // `{measurement}` alone is the hole `unansweredStructuredMeasurements` cannot see; ` mm` is what
    // makes an empty answer a refusal instead of a sentence about a shift of no length.
    for (const box of allBoxes) {
      for (const [name, unit] of [["measurement", "mm"], ["size", "cm"], ["height_loss", "%"]] as const) {
        if (!box.finding_text.includes(`{${name}}`)) continue;
        expect(new RegExp(`\\{${name}\\}\\s?${unit}`).test(box.finding_text),
          `${box.label} lost its ${unit} on the way in`).toBe(true);
        if (box.impression_text.includes(`{${name}}`)) {
          expect(new RegExp(`\\{${name}\\}\\s?${unit}`).test(box.impression_text),
            `${box.label} impression lost its ${unit}`).toBe(true);
        }
      }
    }
  });

  it("offers a segment only its own levels", () => {
    const vocab = [
      ["LS Spine", /^(?:L[1-5]|S1)(?:-(?:L[1-5]|S1))?$/],
      ["Dorsal Spine", /^T(?:[1-9]|1[0-2])(?:-T?(?:[1-9]|1[0-2]))?$/],
      ["Cervical Spine", /^C[1-7](?:-(?:C[1-7]|T1))?$/],
    ] as const;
    for (const box of allBoxes) {
      const allowed = vocab.find(([region]) => region === box.study_type)?.[1];
      if (!allowed) continue;
      for (const q of JSON.parse(box.questions_json) as { key: string; options: string[] }[]) {
        if (!/^(level|level_below)$/.test(q.key)) continue;
        for (const option of q.options) {
          expect(allowed.test(option), `${box.label} offers ${option} to a ${box.study_type} study`).toBe(true);
        }
        expect(q.options.length, `${box.label} offers no level at all`).toBeGreaterThan(0);
      }
    }
    // The two vocabularies are not the same list: a vertebra is not a disc space.
    const listhesis = boxes.find((b) => /listhesis/.test(b.factory_key));
    expect(listhesis, "the spondylolisthesis conversion is gone").toBeDefined();
    const questions = JSON.parse(listhesis!.questions_json) as { key: string; options: string[] }[];
    expect(questions.find((q) => q.key === "level")?.options).toEqual(["L1", "L2", "L3", "L4", "L5", "S1"]);
    const disc = boxes.find((b) => /disc_prolapse/.test(b.factory_key));
    const discLevel = JSON.parse(disc!.questions_json)
      .find((q: { key: string }) => q.key === "level");
    expect(discLevel?.options).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
  });

  it("asks a side instead of picking one", () => {
    for (const box of allBoxes) {
      if (!/\{side\}/.test(box.finding_text)) continue;
      const asked = JSON.parse(box.questions_json) as { key: string; default: string }[];
      const q = asked.find((x) => x.key === "side");
      if (q) expect(q.default, `${box.label} defaults a laterality`).toBe("");
      expect(box.finding_text, `${box.label} bakes a side into the sentence`).not.toMatch(/\b(?:right|left|bilateral)\b/i);
    }
  });
});

describe("boxes reach the examination they belong to", () => {
  it("is MR-scoped, findings-field and active", () => {
    for (const box of allBoxes) {
      expect(box.scope_modality, `${box.label} would be offered to another modality`).toBe("MR");
      expect(box.field).toBe("findings");
      expect(box.is_active).toBe("TRUE");
      expect(box.category).toBe("abnormal");
    }
  });

  it("names a region the ledger actually has", () => {
    const regions = new Set(["Brain", "Cervical Spine", "LS Spine", "Dorsal Spine", "Whole Spine"]);
    for (const box of allBoxes) expect(regions.has(box.study_type), `${box.label}: ${box.study_type}`).toBe(true);
  });

  it("gives the dorsal spine boxes of its own", () => {
    // Before this file the dorsal wall had no MR-scoped findings box at all: only cross-modality
    // "Spine" rows, which an X-ray request could also be offered.
    const dorsal = boxes.filter((b) => b.study_type === "Dorsal Spine");
    expect(dorsal.length).toBeGreaterThanOrEqual(2);
    expect(dorsal.some((b) => /cord/i.test(b.finding_text)), "dorsal boxes do not mention the cord").toBe(true);
    expect(dorsal.some((b) => /lumbar|cauda/i.test(b.finding_text)), "a lumbar sentence was relabelled dorsal").toBe(false);
  });

  it("carries no anatomical section, because no MRI report has headings to seat one in", () => {
    // Measured on the rig's MRI reports (studies 264 / 265 / 268): Findings is a flat run of
    // sentences, so `sectionEndSlot` finds no heading and a section would be inert at best.
    for (const box of allBoxes) expect(box.anatomical_section, `${box.label}`).toBe("");
  });

  it("retires only a sentence a baseline module renders", () => {
    const rendered = baselineSentences();
    for (const box of allBoxes) {
      if (box.baseline_replaces === "") continue;
      expect(rendered.has(box.baseline_replaces), `${box.label} retires a sentence no baseline owns`).toBe(true);
    }
    const shift = boxes.find((b) => /midline_shift/.test(b.factory_key));
    expect(shift?.baseline_replaces, "the shift box must retire \"no midline shift\"").toContain("No midline shift");
  });
});

describe("contrast prose is declared, not only detected", () => {
  it("stamps every enhancement box with requiresContrast", () => {
    const enhancement = allBoxes.filter((b) => /enhanc\w+|gadolin|post-?contrast/i.test(`${b.finding_text} ${b.impression_text}`));
    expect(enhancement.length, "the conversion shipped no enhancement box").toBeGreaterThan(0);
    for (const box of enhancement) {
      const props = JSON.parse(box.properties) as { requiresContrast?: boolean };
      expect(props.requiresContrast, `${box.label} asserts enhancement without declaring it`).toBe(true);
    }
  });

  it("keeps a plain-MRI box unmarked", () => {
    const plain = boxes.find((b) => /white_matter_lesions/.test(b.factory_key));
    const props = JSON.parse(plain!.properties) as { requiresContrast?: boolean };
    expect(props.requiresContrast).toBeUndefined();
  });

  it("says which macro each converted box came from", () => {
    for (const box of boxes) {
      const props = JSON.parse(box.properties) as { source?: string; template?: string; macro?: string };
      expect(props.source).toBe("structured_report_templates.macros_json");
      expect(props.template).toBeTruthy();
      expect(props.macro).toBeTruthy();
    }
  });
});

describe("the authored additions close the named gaps without inventing findings", () => {
  it("gives the dorsal spine a catalogue of its own, item by item", () => {
    // The owner's list for the Dorsal examination, matched against what the two files actually ship:
    // a relabelled lumbar sentence would satisfy a count and fail this.
    const dorsal = allBoxes.filter((b) => b.study_type === "Dorsal Spine");
    expect(dorsal.length, "the dorsal catalogue is smaller than the named requirement").toBeGreaterThanOrEqual(10);
    const named = [
      ["disc", /disc/i],
      ["canal stenosis", /canal stenosis/i],
      ["cord compression", /cord compression/i],
      ["cord signal change", /cord .*signal|myelopathic/i],
      ["compression fracture", /compression fracture/i],
      ["marrow oedema", /marrow oedema/i],
      ["focal vertebral lesion", /marrow-replacing|focal .*lesion/i],
      ["hemangioma", /hemangioma/i],
      ["infective or inflammatory", /discitis|infective/i],
      ["spondylotic change", /spondylotic|spondylosis/i],
    ] as const;
    for (const [what, re] of named) {
      expect(dorsal.some((b) => re.test(`${b.label} ${b.finding_text}`)), `dorsal catalogue is missing: ${what}`).toBe(true);
    }
  });

  it("closes the two Brain checklist topics nothing on the wall stated", () => {
    // The owner's 26-item Brain list asks for a subacute infarct and for cerebellar atrophy. Before
    // this change the wall offered acute (#48/#512), chronic (#489/#49), lacunar (#504) and CEREBRAL
    // atrophy (#6/#50) — the posterior fossa and the subacute stage had no box, and no owner macro
    // covers either, so these two are authored and stamped as such.
    const brain = allBoxes.filter((b) => b.study_type === "Brain");

    const subacute = brain.filter((b) => /subacute/i.test(`${b.label} ${b.finding_text} ${b.impression_text}`));
    expect(subacute, "a subacute infarct box was not shipped").toHaveLength(1);
    expect(subacute[0].factory_key.replace(/^'|'$/g, "")).toBe("authored:Brain/subacute_infart");
    const asked = JSON.parse(subacute[0].questions_json) as { key: string; required?: boolean }[];
    expect(asked.map((q) => q.key).sort(), "the stage box must ask for both side and territory")
      .toEqual(["side", "territory"]);
    expect(asked.every((q) => q.required === true)).toBe(true);

    const cerebellar = brain.filter((b) => /cerebellar atroph/i.test(`${b.label} ${b.finding_text}`));
    expect(cerebellar, "a cerebellar atrophy box was not shipped").toHaveLength(1);
    // Declared retirement, in the box's own words, of the one normal it contradicts — and only that
    // one. Without it the click would append a second opinion about the cerebellum beside the
    // baseline's "normal morphology and signal intensity" and print both.
    expect(cerebellar[0].baseline_replaces)
      .toBe("Cerebellar hemispheres show normal morphology and signal intensity.");
    expect(baselineSentences().has(cerebellar[0].baseline_replaces),
      "the sentence it retires must be one a baseline module actually renders").toBe(true);

    // The new stage box is not a second acute or chronic box wearing a different label: it owns a
    // concept of its own, so it cannot take the acute (#512) or chronic (#489) row's mutex slot.
    expect(subacute[0].concept).not.toBe("infarct");
  });

  it("never relabels a lumbar sentence as dorsal", () => {
    for (const box of allBoxes.filter((b) => b.study_type === "Dorsal Spine")) {
      expect(box.finding_text, `${box.label} keeps lumbar wording`).not.toMatch(/lumbar|lumbosacral|cauda equina/i);
      expect(box.finding_text, `${box.label} offers lumbar levels`).not.toMatch(/\bL[1-5]\b/);
    }
  });

  it("states no measurement it was not given", () => {
    // An authored sentence must not contain a number that reads as this patient's finding.
    for (const box of authoredBoxes) {
      const text = `${box.finding_text} ${box.impression_text}`;
      expect(text, `${box.label} asserts a measurement`).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:mm|cm|cc|ml|%)\b/i);
      // Degrees, sequence weights and named anatomy (T2, L5-S1 as a token answer) are not measurements;
      // the only digits allowed are sequence names.
      const digits = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
      for (const d of digits) expect(["1", "2", "10", "11", "12", "3", "4"], `${box.label}: ${d}`).toContain(d);
    }
  });

  it("asks for every level and side it names", () => {
    for (const box of authoredBoxes) {
      const text = `${box.finding_text} ${box.impression_text}`;
      expect(text, `${box.label} bakes a level into the sentence`).not.toMatch(/\b[LCST]\d\s*-\s*[LCST]?\d\b/);
      // A single vertebra is the case the range pattern cannot see, and "T1/T2" as a SEQUENCE name is
      // indistinguishable from a level by digits alone — so anchor on the preposition that puts an
      // anatomy in the sentence, which is where an invented level would have to sit.
      expect(text, `${box.label} states a level where it should ask for one`)
        .not.toMatch(/\b(?:at|in|of|through)\s+(?:the\s+)?[LCST]\d+\b/i);
      expect(text, `${box.label} bakes a side into the sentence`).not.toMatch(/\b(?:right|left|bilateral)\b/i);
    }
  });

  it("does not double up a label the other file already ships", () => {
    const seen = new Map<string, string>();
    for (const box of allBoxes) {
      const key = `${box.study_type}|${box.label.toLowerCase()}`;
      expect(seen.has(key), `${box.label} is shipped twice`).toBe(false);
      seen.set(key, box.factory_key);
    }
  });
});

describe("the file guards its own deploy", () => {
  for (const [name, text, list] of [
    ["macro conversion", sql, boxes],
    ["authored additions", authoredSql, authoredBoxes],
  ] as const) {
    it(`${name}: inserts by factory_key and by label, and updates nothing`, () => {
      expect(text.match(/NOT EXISTS/g)).toHaveLength(2);
      expect(text).toMatch(/q\.factory_key = s\.factory_key/);
      expect(text).toMatch(/lower\(trim\(q\.label\)\)\s+= lower\(trim\(s\.label\)\)/);
      expect(text).not.toMatch(/\bUPDATE\s+radiology_quick_findings\b/i);
      expect(text).not.toMatch(/\bDELETE\s+FROM\s+radiology_quick_findings\b/i);
    });

    it(`${name}: stamps the ledger tab by name`, () => {
      expect(text).toContain("(select min(t.id) from radiology_study_tabs t where t.name = s.study_type)");
    });

    it(`${name}: fails the deploy when a box was excluded by a guard`, () => {
      const expected = Number(text.match(/expected int := (\d+)/)?.[1]);
      expect(expected, `${name} has no count check`).toBe(list.length);
      expect(text.match(/raise exception/g)).toHaveLength(1);
    });

    it(`${name}: is one transaction`, () => {
      expect(text).toContain("BEGIN;");
      expect(text.lastIndexOf("COMMIT;")).toBeGreaterThan(text.indexOf("INSERT INTO"));
    });
  }
});

describe("the shipped boxes stay editable through the existing admin editor", () => {
  // §3 asks for the catalogue to be editable, and the write API has always taken `field`, `concept`
  // and `scope_modality`; only this page never showed them. A converted box whose concept cannot be
  // re-curated is a box the clinic cannot correct without SQL, so the editor is measured against the
  // columns the migration actually ships rather than against a screenshot.
  const SETTINGS_PAGE = resolve(pkgRoot, "src/pages/RadiologyQuickSelectSettings.tsx");
  const ROUTE = resolve(repoRoot, "artifacts/api-server/src/routes/radiologyQuickFindings.ts");
  const editor = readFileSync(SETTINGS_PAGE, "utf8").replace(/\r\n/g, "\n");
  const route = readFileSync(ROUTE, "utf8").replace(/\r\n/g, "\n");
  const declared = (name: string) => {
    const m = new RegExp("const " + name + ": [^=]+ = \\[([^\\]]*)\\]").exec(editor);
    expect(m, `${name} is not declared in the editor`).not.toBeNull();
    return [...m![1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  };
  const fields = declared("FIELD_CHOICES");
  const modalities = declared("MODALITY_CHOICES");

  it("gives a control to each of the three columns, and writes it back to the form", () => {
    for (const col of ["field", "concept", "scopeModality"]) {
      expect(editor, `${col} is not bound to the form`).toContain(`value={editingFinding.${col}}`);
      expect(editor, `${col} cannot be edited`).toContain(`setEditingFinding({ ...editingFinding, ${col}: e.target.value })`);
    }
  });

  it("carries them when a saved row is opened, so editing one box cannot blank another's", () => {
    // The pencil button spreads the row. A column missing from that coercion comes back as undefined
    // and the write API keeps the old value, which reads to the clinic as "my edit did nothing".
    expect(editor).toContain('field: f.field || "findings"');
    expect(editor).toContain('concept: f.concept ?? ""');
    expect(editor).toContain('scopeModality: f.scopeModality ?? ""');
  });

  it("offers exactly the sections the server accepts", () => {
    const rule = /field must be one of ([a-zA-Z, ]+)/.exec(route);
    expect(rule, "the route no longer states which fields a box may write").not.toBeNull();
    const accepted = rule![1].split(",").map((x) => x.trim());
    expect([...fields].sort()).toEqual([...accepted].sort());
  });

  it("ships no box value the editor cannot re-enter", () => {
    for (const b of allBoxes) {
      if (b.field) expect(fields, `${b.label} writes a section the editor cannot name`).toContain(b.field);
      if (b.scope_modality) {
        expect(b.scope_modality, `${b.label} is scoped with a code that is not a spelling the strip uses`)
          .toMatch(/^[A-Z_]+$/);
        expect(modalities, `${b.label} is scoped to a modality the editor cannot offer`).toContain(b.scope_modality);
      }
    }
    expect(modalities, "blank has to stay: a box scoped to nothing is offered to every study").toContain("");
  });

  it("the server takes all three, so the controls are not a facade over a route that ignores them", () => {
    expect(route).toMatch(/updates\.concept = req\.body\.concept/);
    expect(route).toMatch(/updates\.scopeModality = req\.body\.scopeModality/);
    expect(route).toMatch(/updates\.field = f/);
    expect(route).toMatch(/field: normalizeBoxField\(req\.body\?\.field\)/);
  });
});
