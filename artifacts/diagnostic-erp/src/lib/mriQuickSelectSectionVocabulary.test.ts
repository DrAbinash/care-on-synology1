/**
 * Every MRI box's declared section must be a heading the report actually has.
 *
 * `pathologyPatch.ts` routes a Quick Select sentence into the Findings heading whose label equals
 * the box's `anatomical_section` (`sectionEndSlot`, case-folded equality). The MRI skeletons are
 * authored in `structured_report_templates`, seeded from
 * `artifacts/api-server/src/routes/structuredReportTemplates.ts` as `sections_json.findingsItems[]`.
 * A section that names no heading is not cosmetic: the sentence then falls back to the seat of
 * whatever normal it retired, which is how a finding prints under the wrong heading. Before
 * `zzzzzzzzzzzzzzzzzzzzzzz_mri_quickselect_section_vocabulary.sql` the wall had eight of them —
 * "mca", "basal ganglia" ×2, "{level}" ×4 and "C2-C3 to C6-C7" — and two of those eight also
 * reached the chip bar as a label reading "{level}".
 *
 * This test reads the data the way the patch engine does, from the files CI runs the migration
 * chain against, so a future box that declares a heading no skeleton carries fails here rather
 * than in a signed report.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../../.."); // repo root

const SEED = readFileSync(
  resolve(ROOT, "artifacts/api-server/src/routes/structuredReportTemplates.ts"), "utf8").replace(/\r\n/g, "\n");
const VOCAB = readFileSync(
  resolve(ROOT, "migrations/zzzzzzzzzzzzzzzzzzzzzzz_mri_quickselect_section_vocabulary.sql"), "utf8").replace(/\r\n/g, "\n");

/** `{ label: "Brain Parenchyma", normal: "…" }` inside each template's findingsItems array. */
const headingsOf = (templateName: string): string[] => {
  const start = SEED.indexOf(`templateName: "${templateName}"`);
  expect(start, `${templateName} is no longer a seeded MRI template`).toBeGreaterThan(-1);
  const next = SEED.indexOf('\n    templateName: "', start + 1);
  const block = SEED.slice(start, next < 0 ? SEED.length : next);
  return [...block.matchAll(/\{\s*label:\s*"([^"]+)",\s*normal:/g)].map((m) => m[1]);
};

const MRI_TEMPLATES = [
  "MRI Brain Plain",
  "MRI Brain With Contrast",
  "MRI Stroke Protocol",
  "MRI Cervical Spine",
  "MRI Dorsal Spine",
  "MRI LS Spine",
  "MRI LS Spine with Whole Spine Screening",
  "MRI Cervical Spine with Whole Spine Screening",
];

describe("each MRI skeleton carries its own headings", () => {
  it("every template authors at least one findings heading", () => {
    for (const name of MRI_TEMPLATES) {
      expect(headingsOf(name).length, `${name} seeds no findingsItems heading`).toBeGreaterThan(0);
    }
  });

  it("the spine skeletons name their own segment", () => {
    // Whole Spine screening owns the "Screening — …" headings; a plain segment study must not be
    // the place those boxes are placed into, which is why those rows are named here.
    const ls = headingsOf("MRI LS Spine");
    expect(ls).toContain("L4-L5");
    expect(ls).toContain("Spinal Canal");
    expect(ls.filter((h) => h.startsWith("Screening — "))).toEqual([]);
    const cervicalScreening = headingsOf("MRI Cervical Spine with Whole Spine Screening");
    expect(cervicalScreening.filter((h) => h.startsWith("Screening — ")).length).toBeGreaterThan(0);
    expect(headingsOf("MRI Dorsal Spine")).toContain("T7-T8");
  });
});

describe("the section vocabulary migration only writes headings that exist", () => {
  /** The UPDATEs, read as the engine would: (study_type, label) -> new section. */
  const writes = () => {
    const out: Array<{ study: string; label: string; to: string }> = [];
    for (const stmt of VOCAB.split("UPDATE radiology_quick_findings").slice(1)) {
      const body = stmt.split(";")[0];
      const to = /SET anatomical_section = (?:'([^']*)'|NULL)/.exec(body);
      const study = /AND study_type = '([^']*)'/.exec(body);
      const label = /AND label = '([^']*)'/.exec(body);
      expect(to, "an UPDATE does not set anatomical_section").toBeTruthy();
      expect(study, "an UPDATE does not scope its study type").toBeTruthy();
      expect(label, "an UPDATE does not scope its label").toBeTruthy();
      out.push({ study: study[1], label: label[1], to: to[1] ?? "" });
    }
    return out;
  };

  it("reads every corrected row out of the migration", () => {
    expect(writes().length).toBeGreaterThanOrEqual(5);
  });

  it("rewrites no row the shipped factory seed also writes", () => {
    // CI's migration smoke re-applies the newest factory seed and asserts that nothing churns. A
    // section correction on a seed-owned row therefore cannot live here: the seed would write its
    // own spelling back on every deploy, `updated_at` would move, and the correction would only
    // survive until the next re-apply. Discovered the hard way on #481/#498/#512, whose "basal
    // ganglia"/"mca" slugs `ANATOMY_ALIASES` resolves anyway.
    const seedFile = readdirSync(resolve(ROOT, "migrations"))
      .filter((f) => /^zzzzzzzzzzzzzzzzzzzzz_quick_select_factory_boxes_r\d{3}_[0-9a-f]{12}\.sql$/.test(f))
      .sort((a, b) => Number(/\br(\d{3})_/.exec(a)?.[1]) - Number(/\br(\d{3})_/.exec(b)?.[1]))
      .slice(-1)[0];
    const seed = readFileSync(resolve(ROOT, "migrations", seedFile), "utf8").replace(/\r\n/g, "\n");
    // The seed's own tuple order is (factory_key, study_type, label, field, …).
    const owned = new Set(
      [...seed.matchAll(/^\s*\(\s*'[^']*'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,/gm)].map((m) => `${m[1]}|${m[2]}`),
    );
    expect(owned.size, `${seedFile} was read with no rows in it`).toBeGreaterThan(50);
    for (const w of writes()) {
      expect(owned, `${w.study}/${w.label} is a factory row: correct its spelling in the tile data, not here`)
        .not.toContain(`${w.study}|${w.label}`);
    }
  });

  it("writes only a heading the study's own skeleton carries, or clears the column", () => {
    const HEADINGS: Record<string, string[]> = {
      Brain: [...headingsOf("MRI Brain Plain"), ...headingsOf("MRI Brain With Contrast"), ...headingsOf("MRI Stroke Protocol")],
      "Cervical Spine": [...headingsOf("MRI Cervical Spine"), ...headingsOf("MRI Cervical Spine with Whole Spine Screening")],
      "LS Spine": [...headingsOf("MRI LS Spine"), ...headingsOf("MRI LS Spine with Whole Spine Screening")],
      "Dorsal Spine": headingsOf("MRI Dorsal Spine"),
    };
    for (const w of writes()) {
      const headings = HEADINGS[w.study];
      expect(headings, `${w.study} is not an MRI study type this migration may write`).toBeTruthy();
      if (w.to !== "") {
        expect(headings.map(h => h.toLowerCase()), `"${w.to}" written for #${w.label}`).toContain(w.to.toLowerCase());
      }
    }
  });
});

/**
 * The assertion that actually bites: the two spellings the migration fixes must not be reintroduced
 * by a future factory revision, and no box the migration writes may be a template placeholder.
 */
describe("the vocabulary this migration leaves behind", () => {
  it("sets a cleared section to the empty string, never NULL", () => {
    // `anatomical_section` is NOT NULL with default '' on radiology_quick_findings, so NULL in a
    // migration is a deploy-time crash for the whole clinic, not a data nit.
    expect(VOCAB).not.toMatch(/anatomical_section = NULL/);
    expect(VOCAB).toMatch(/SET anatomical_section = ''/);
  });

  it("leaves no placeholder or lower-case slug in the values it writes", () => {
    const written = [...VOCAB.matchAll(/SET anatomical_section = '([^']*)'/g)].map((m) => m[1]).filter(v => v !== "");
    expect(written.length).toBeGreaterThan(0);
    for (const v of written) {
      expect(v, `a section must not be a template placeholder`).not.toMatch(/[{}]/);
      expect(v[0], `${v} must start upper-case like the heading it matches`).toBe(v[0].toUpperCase());
    }
  });

  it("names the headings the MRI skeletons carry", () => {
    const written = [...new Set([...VOCAB.matchAll(/SET anatomical_section = '([^']*)'/g)].map((m) => m[1]).filter(Boolean))];
    const all = new Set(Object.values({
      Brain: [...headingsOf("MRI Brain Plain"), ...headingsOf("MRI Brain With Contrast"), ...headingsOf("MRI Stroke Protocol")],
      "Cervical Spine": [...headingsOf("MRI Cervical Spine"), ...headingsOf("MRI Cervical Spine with Whole Spine Screening")],
      "LS Spine": [...headingsOf("MRI LS Spine"), ...headingsOf("MRI LS Spine with Whole Spine Screening")],
      "Dorsal Spine": headingsOf("MRI Dorsal Spine"),
    }).flat());
    for (const w of written) expect(all.has(w), `"${w}" is not a heading any MRI skeleton carries`).toBe(true);
  });

  it("guards each UPDATE by the value it replaces, so a curated box is never rewritten", () => {
    const updates = VOCAB.split("UPDATE radiology_quick_findings").length - 1;
    const guards = (VOCAB.match(/AND anatomical_section = '[^']*'/g) || []).length;
    expect(guards, "every section UPDATE must be guarded by its current value").toBe(updates);
  });
});
