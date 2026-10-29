/**
 * #D2 — the CT Brain Quick Select boxes the clinic actually clicks must carry the
 * ownership metadata the reporting engine reads.
 *
 * The acceptance failure was not a missing capability: `anatomical_section` decides
 * placement, `concept` drives supersession, and `baseline_replaces` is the curated
 * "this is the normal I contradict" contract. The four `CT Brain Plain` rows seeded
 * by `zzzz_ct_gold_standard_content.sql` simply had all three columns empty, so a
 * documented 6 mm shift printed under "Bone Windows:" with "Midline: / No shift."
 * still standing above it, and the Conclusion stated the distance without the
 * direction.
 *
 * `zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql` fills those columns.
 * The engine's behaviour on that metadata is pinned by the store-level tests in
 * `zai-workspace/quickSelectDeselectLifecycle.test.ts`; THIS file pins the data, so a
 * re-curated catalogue that silently drops a concept, points at a section the template
 * does not write, or invents a concept id cannot pass the suite while printing a
 * contradicted normal in a signed report.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_CONCEPTS } from "./conceptCanon/contentPacks";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MIGRATION = "zzzzzzzzzzzzzzzzzzzzzzz_ct_brain_quickselect_ownership.sql";
const sql = () => readFileSync(join(ROOT, "migrations", MIGRATION), "utf8");
const templateSrc = () => readFileSync(
  join(ROOT, "artifacts/api-server/src/routes/structuredReportTemplates.ts"), "utf8",
);

/** The shipped `CT Brain` preset, from its `templateName` to the next one. */
function ctBrainPreset(): string {
  const parts = templateSrc().split('templateName: "');
  const hit = parts.find((p) => p.startsWith("CT Brain\""));
  expect(hit, "the CT Brain template the workspace bootstraps from").toBeTruthy();
  return hit!;
}

/** One `UPDATE radiology_quick_findings … ;` statement, guards included. */
function statements(text: string): string[] {
  return text.split(/;\s*/).filter((s) => s.includes("UPDATE radiology_quick_findings"));
}

function values(pattern: RegExp, text: string): string[] {
  // An empty capture is a `col IS NULL OR col = ''` guard, not a curated value.
  return [...text.matchAll(pattern)].map((m) => m[1]!.trim()).filter((v) => v !== "");
}

describe("the CT Brain Quick Select ownership migration", () => {
  it("runs after the rows it curates exist", () => {
    const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const at = files.indexOf(MIGRATION);
    expect(at, "the file is in migrations/").toBeGreaterThan(-1);
    // Seeds the four boxes; must be applied first or this UPDATE matches nothing.
    expect(files.indexOf("zzzz_ct_gold_standard_content.sql"))
      .toBeLessThan(at);
  });

  it("touches only untouched factory rows of one study type", () => {
    const all = statements(sql());
    expect(all.length, "every curated column has its own guarded statement").toBe(11);
    const fills = all.filter((s) => !s.includes("SET impression_text"));
    expect(fills, "ten column fills and one guarded prose rewrite").toHaveLength(10);
    for (const s of fills) {
      expect(s, `factory rows only: ${s.slice(0, 60)}`).toContain("factory_key = ''");
      expect(s, `never a desk-customised box: ${s.slice(0, 60)}`).toContain("customized_at IS NULL");
      expect(s, `CT Brain Plain only: ${s.slice(0, 60)}`).toContain("study_type = 'CT Brain Plain'");
      expect(s, "only a column that is still empty gets filled").toMatch(/IS NULL OR/);
    }
    for (const forbidden of ["DELETE FROM", "DROP TABLE", "ALTER TABLE", "INSERT INTO", "TRUNCATE"]) {
      expect(sql(), `no ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("curates all four boxes with a concept, a section and the normal it contradicts", () => {
    const text = sql();
    expect(values(/SET\s+concept\s*=\s*'([^']+)'/g, text).sort())
      .toEqual(["hemorrhage", "infarct", "midline", "ventricles"]);
    expect(values(/anatomical_section\s*=\s*'([^']+)'/g, text).sort())
      .toEqual(["Midline", "Parenchyma", "Parenchyma", "Ventricles"]);
    const INFARCT_CLAIM
      = "No focal hypo- or hyperdensity.\\nNo haemorrhage or infarct.\\nGrey-White Differentiation: Maintained.";
    /** label → the sentences that box declares it contradicts, in file order. */
    const claims = new Map<string, string[]>();
    for (const s of statements(text)) {
      const label = /label = '([^']+)'/.exec(s)?.[1];
      const claim = /baseline_replaces\s*=\s*E?'([^']*)'/.exec(s)?.[1];
      if (!label || !claim) continue;
      claims.set(label, [...(claims.get(label) ?? []), ...claim.split("\\n")]);
    }
    expect([...claims.keys()].sort()).toEqual([
      "Acute Infarct", "Acute MCA infarct", "Hydrocephalus", "ICH", "Intracranial Hemorrhage",
      "Midline Shift",
    ]);
    expect(claims.get("Intracranial Hemorrhage")).toEqual(["No haemorrhage or infarct."]);
    expect(claims.get("ICH"), "the stroke-pack box on the same strip retires the same denial")
      .toEqual(["No haemorrhage or infarct."]);
    expect(claims.get("Acute MCA infarct"), "and the second infarct wording falsifies all three")
      .toEqual(INFARCT_CLAIM.split("\\n"));
    expect(claims.get("Acute Infarct")).toEqual(INFARCT_CLAIM.split("\\n"));
    expect(claims.get("Midline Shift")).toEqual(["No shift."]);
    expect(claims.get("Hydrocephalus")).toEqual(["Normal in size and configuration."]);
    // A claim without a concept is the deliberate minimum for those two: it retires
    // the contradicted normal without binding the box into its twin's ownership slot.
    for (const s of statements(text)) {
      if (!/label = 'ICH'|label = 'Acute MCA infarct'/.test(s)) continue;
      expect(s).not.toMatch(/SET\s+concept/);
    }
    expect(/label = 'No acute infarct'/.test(text), "the box that ASSERTS normality is left alone")
      .toBe(false);
  });

  it("uses only concept ids the content packs register", () => {
    for (const concept of values(/SET\s+concept\s*=\s*'([^']+)'/g, sql())) {
      expect(CANONICAL_CONCEPTS.has(concept), `${concept} is not a canonical concept`)
        .toBe(true);
    }
  });

  it("is listed in the server guard that reads the migrated rows", () => {
    /**
     * `radiologyQuickSelectAbdominalOwnership.test.ts` asks a live database whether
     * every clinic-owned concept is one a content pack registers, and it does that
     * against a hand-authored union of the slugs migrations write. `midline` is in
     * contentPacks.ts, so the migration was right and the list was short — and the
     * gap only surfaced in CI, after the whole migration chain had run, because the
     * unit test above reads the .sql file and the server test reads the table.
     *
     * Linking the two here means the next concept this migration gains fails in the
     * suite nearest the data, with the file to edit named, instead of arriving as a
     * red CI run.
     */
    const GUARD = "artifacts/api-server/src/lib/radiologyQuickSelectAbdominalOwnership.test.ts";
    const guard = readFileSync(join(ROOT, GUARD), "utf8");
    const block = /const KNOWN_PACK_CONCEPTS = new Set\(\[([\s\S]*?)\]\);/.exec(guard);
    expect(block, `${GUARD} still declares KNOWN_PACK_CONCEPTS as a literal set`).toBeTruthy();
    const listed = new Set([...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    expect(listed.size, "the guard list is readable").toBeGreaterThan(0);
    const written = new Set(values(/SET\s+concept\s*=\s*'([^']+)'/g, sql()));
    expect([...written].sort(), "this migration writes concepts at all").not.toEqual([]);
    for (const concept of written) {
      expect(listed.has(concept),
        `'${concept}' is written by ${MIGRATION} but absent from KNOWN_PACK_CONCEPTS in ${GUARD}`)
        .toBe(true);
    }
  });

  it("claims baseline sentences the shipped template really writes", () => {
    const preset = ctBrainPreset();
    const claims = values(/baseline_replaces\s*=\s*E?'([^']*)'/g, sql())
      .flatMap((c) => c.split("\\n"));
    for (const claim of claims) {
      // A heading-qualified claim ("Grey-White Differentiation: Maintained.") names
      // the section the sentence sits in, which the template stores as a `label`.
      const hit = /^([A-Za-z& \-]+):\s*(.+)$/.exec(claim);
      const label = hit?.[1] ?? "";
      const sentence = hit?.[2] ?? claim;
      expect(preset, `the template writes "${sentence}"`).toContain(sentence);
      if (label) expect(preset, `"${sentence}" sits under "${label}"`).toContain(`"${label}"`);
    }
  });

  it("states the shift direction in the Conclusion, guarded on the shipped wording", () => {
    const statement = statements(sql()).find((s) => s.includes("impression_text ="));
    expect(statement, "the Midline Shift conclusion is rewritten").toBeTruthy();
    expect(statement!, "magnitude AND side — which way the brain is displaced is the question")
      .toContain("'Midline shift of {shift} mm to the {side}.'");
    expect(statement!, "only the row nobody reworded is touched")
      .toContain("impression_text = 'Midline shift of {shift} mm.'");
  });
});
