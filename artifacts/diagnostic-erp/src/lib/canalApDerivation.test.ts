/**
 * canalApDerivation.test.ts — one AP canal number per level, everywhere.
 *
 * The foundation PR (#872) made `canalApProvenance[level]` the canonical record
 * of a canal AP diameter. This file closes the second half of that promise: every
 * surface that shows or takes the number must DERIVE it from that record, instead
 * of owning a copy of it.
 *
 * The failure mode this exists to catch is not hypothetical — it was the original
 * defect, twice over:
 *
 *   1. A per-level block kept `sel.canalApMm` in its own React state. A number
 *      typed there reached the narrative and never the record, so the canal table,
 *      the printed measurement block and the saved draft disagreed with the prose.
 *   2. A table keyed its rows by the resolver's letters ("T8-T9") while every
 *      writer canonicalises to the record's letters ("D8-D9"). The cell saved
 *      under one key and read back from the other: the number vanished from the
 *      screen as it was typed, and the report block printed nothing.
 *
 * There is no DOM render in this repo's test suite, so (1) is enforced as a
 * source contract with a positive control, and (2) as a behavioural check on the
 * real resolver and the real store writer.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import {
  canalApValueAt,
  canalRows,
  normalizeDiscLevel,
  DORSAL_JUNCTION_LEVEL,
} from "@/lib/spineCanalAp";
import {
  JUNCTION_LEVEL,
  defaultDorsoLumbarState,
  dorsolumbarApLevels,
  dorsolumbarCanalSegment,
} from "@/lib/mriDorsoLumbarCoverage";
import { dorsalApCanalLevels, defaultDorsalNumbering } from "@/lib/mriDorsalNumbering";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG, rel), "utf8");

function reset() {
  useWorkspace.setState({ ...emptyClinicalState() });
}

describe("canalRows — a table's rows are the record's keys", () => {
  it("canonicalises the letters a resolver speaks", () => {
    expect(canalRows(["T8-T9", "T12-L1", "L1-L2"])).toEqual(["D8-D9", "D12-L1", "L1-L2"]);
  });

  it("folds two spellings of one disc into one row", () => {
    expect(canalRows(["T8-T9", "D8-D9", "d8-d9"])).toEqual(["D8-D9"]);
  });

  it("drops what is not a disc level rather than offering an empty row", () => {
    expect(canalRows(["alignment", "Cord", ""])).toEqual([]);
  });

  it("keeps the cervicothoracic junction cervical, not dorsal", () => {
    // The whole reason canonicalisation is not a blanket T→D rewrite.
    expect(canalRows(["C7-T1"])).toEqual(["C7-T1"]);
  });

  it("keeps a transitional lumbar key lumbar", () => {
    expect(canalRows(["L6-S1", "L5-T"])).toEqual(["L6-S1", "L5-T"]);
  });
});

describe("the dorsal and dorso-lumbar tables read back what they write", () => {
  beforeEach(reset);

  it("every dorso-lumbar AP row resolves to the key its own writer stores under", () => {
    const state = defaultDorsoLumbarState({ superior: "T11-T12", inferior: "L2-L3" });
    const rows = canalRows(dorsolumbarApLevels(state));
    // The canvas calls the bridge "T12-L1"; the canal record calls it "D12-L1".
    // A row that kept the resolver's letters would save and read two different
    // keys — see the second test in this block.
    expect(rows).toEqual(["D11-D12", DORSAL_JUNCTION_LEVEL, "L1-L2", "L2-L3"]);

    for (const [idx, row] of rows.entries()) {
      // Written through the surface's own spelling of the level, as the resolver
      // offers it — that is what a table actually does.
      const offered = dorsolumbarApLevels(state)[idx]!;
      const written = useWorkspace.getState().recordCanalApManualValue(offered, `${9 - idx}.5`,
        dorsolumbarCanalSegment(offered));
      expect(written).toBe(row);
      // The row's READ key finds the record its WRITE key created. Before this
      // was fixed the read used `offered` and returned nothing for T-form rows.
      expect(canalApValueAt(useWorkspace.getState().canalApProvenance, row)).toBe(9 - idx + 0.5);
      expect(canalApValueAt(useWorkspace.getState().canalApProvenance, offered)).toBe(9 - idx + 0.5);
    }
  });

  it("the un-canonicalised row key is the defect, and it is not the record key", () => {
    // Positive control for the check above: reading the store with the resolver's
    // own letters must miss, which is exactly why rows go through canalRows.
    const written = useWorkspace.getState().recordCanalApManualValue("T8-T9", "7.5", "dorsal");
    expect(written).toBe("D8-D9");
    expect(useWorkspace.getState().canalApProvenance["T8-T9"]).toBeUndefined();
    expect(useWorkspace.getState().canalApProvenance["D8-D9"]).toBeDefined();
    expect(canalApValueAt(useWorkspace.getState().canalApProvenance, "T8-T9")).toBe(7.5);
  });

  it("a dorsal coverage change narrows the rows the table can offer", () => {
    // The dorsal resolver speaks T-form; the record never does.
    const rows = canalRows(dorsalApCanalLevels(defaultDorsalNumbering()));
    expect(rows[0]).toBe("D1-D2");
    expect(rows).not.toContain("T1-T2");
    expect(rows).not.toContain(JUNCTION_LEVEL);
    expect(normalizeDiscLevel("T1-T2")).toBe("D1-D2");
  });
});

describe("canalApValueAt — what a surface is allowed to show", () => {
  beforeEach(reset);

  it("resolves either lettering to the one record", () => {
    useWorkspace.getState().recordCanalApManualValue("T9-T10", "11", "dorsal");
    const records = useWorkspace.getState().canalApProvenance;
    expect(canalApValueAt(records, "T9-T10")).toBe(11);
    expect(canalApValueAt(records, "D9-D10")).toBe(11);
  });

  it("reports nothing for a conflicted or renumbered record", () => {
    // Two aliases that disagree must not collapse to whichever number the software
    // likes better. The record keeps the conflict and no surface reports a number.
    const conflicted = useWorkspace.getState().hydrateCanalApRecords({
      "T8-T9": { level: "T8-T9", region: "dorsal", measurementType: "CANAL_AP", value: "8", unit: "mm", manualOverride: true },
      "D8-D9": { level: "D8-D9", region: "dorsal", measurementType: "CANAL_AP", value: "9", unit: "mm", manualOverride: true },
    });
    expect(conflicted).toContain("D8-D9");
    expect(canalApValueAt(useWorkspace.getState().canalApProvenance, "T8-T9")).toBeNull();
    expect(canalApValueAt(useWorkspace.getState().canalApProvenance, "D8-D9")).toBeNull();

    // A number measured at a level the study no longer has is not reportable
    // either — keeping it is safe, attributing it is not.
    useWorkspace.getState().hydrateCanalApRecords({
      "L4-L5": { level: "L4-L5", region: "lumbar", measurementType: "CANAL_AP", value: "10", unit: "mm", manualOverride: true },
    });
    const rec = useWorkspace.getState().canalApProvenance["L4-L5"]!;
    useWorkspace.setState({
      canalApProvenance: {
        ...useWorkspace.getState().canalApProvenance,
        "L4-L5": { ...rec, staleReason: "level_renumbered" },
      },
    });
    expect(canalApValueAt(useWorkspace.getState().canalApProvenance, "L4-L5")).toBeNull();
  });

  it("returns null, not a guess, when there is no level or no record", () => {
    expect(canalApValueAt({}, "L4-L5")).toBeNull();
    expect(canalApValueAt(null, "L4-L5")).toBeNull();
    expect(canalApValueAt({}, "")).toBeNull();
    expect(canalApValueAt({}, "alignment")).toBeNull();
  });

  it("a signed report refuses the shared writer, so no surface can edit through it", () => {
    useWorkspace.getState().recordCanalApManualValue("L4-L5", "9", "lumbar");
    useWorkspace.setState({ isFinalized: true, isLocked: true });
    const before = useWorkspace.getState().canalApProvenance["L4-L5"]!.reportValue;
    expect(useWorkspace.getState().recordCanalApManualValue("L4-L5", "3", "lumbar")).toBeNull();
    expect(useWorkspace.getState().canalApProvenance["L4-L5"]!.reportValue).toBe(before);
  });
});

describe("dorsolumbarCanalSegment — one level, one table, agreed by both surfaces", () => {
  it("files thoracic and bridge rows as dorsal, lumbar rows as lumbar", () => {
    expect(dorsolumbarCanalSegment("T8-T9")).toBe("dorsal");
    expect(dorsolumbarCanalSegment("D8-D9")).toBe("dorsal");
    expect(dorsolumbarCanalSegment(JUNCTION_LEVEL)).toBe("dorsal");
    expect(dorsolumbarCanalSegment("T12-L1")).toBe("dorsal");
    expect(dorsolumbarCanalSegment("L4-L5")).toBe("lumbar");
    expect(dorsolumbarCanalSegment("L6-S1")).toBe("lumbar");
    expect(dorsolumbarCanalSegment(null)).toBe("dorsal");
  });
});

/**
 * The source contract: an AP canal input derives from the record.
 *
 * `banned` are the shapes a surface takes when it starts owning the number again —
 * keeping it in local component state. They are checked inside `scope` (one
 * function) rather than the whole file, because the same panels also hold a
 * LESION's anteroposterior dimension, which is a different measurement with its
 * own identity and legitimately stays local. `required` proves the surface reads
 * through the shared cell. Both directions are checked against a fixture, so a
 * pattern that stopped matching anything cannot pass as "no defects found".
 */
const LEVEL_DETAIL_FORM = "DorsalLevelDetailForm";

/**
 * Bound on syntactic markers, not a line or character budget: a longer comment
 * above the form would silently empty a fixed-size slice and make every
 * assertion inside it vacuously true.
 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} must still exist`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nfunction ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const SURFACES: Array<{
  file: string;
  label: string;
  banned: RegExp[];
  scope?: string;
}> = [
  {
    file: "src/components/radiology/reporting-canvas/MriLumbarLevelBlock.tsx",
    label: "lumbar level block",
    banned: [/setSel\(\(s\) => \(\{ \.\.\.s, canalApMm/, /canalApMm: v === ""/, /Use \{canalApMm\} mm/],
  },
  {
    file: "src/components/radiology/reporting-canvas/MriCervicalLevelBlock.tsx",
    label: "cervical level block",
    banned: [/setSel\(\(s\) => \(\{ \.\.\.s, canalApMm/, /canalApMm: v === ""/, /Use \{canalApMm\} mm/],
  },
  {
    file: "src/components/radiology/reporting-canvas/MriDorsalSubMasterPanel.tsx",
    label: "dorsal level detail form",
    scope: LEVEL_DETAIL_FORM,
    banned: [/patch\(\{ apMm:/],
  },
  {
    file: "src/components/radiology/reporting-canvas/MriDorsoLumbarSubMasterPanel.tsx",
    label: "dorso-lumbar level entry form",
    banned: [/const \[apMm, setApMm\] = useState/, /setApMm\(/],
  },
];

describe("no surface owns an AP canal number of its own", () => {
  for (const surface of SURFACES) {
    it(`${surface.label} reads and writes the canonical record`, () => {
      const src = read(surface.file);
      expect(src, `${surface.label} must take its AP cell from the shared hook`)
        .toMatch(/useCanalApCell\(\{/);
      expect(src, `${surface.label} must display the cell, not its own state`)
        .toMatch(/value=\{apCell\.value\}/);
      const scope = surface.scope ? functionBody(src, surface.scope) : src;
      for (const banned of surface.banned) {
        expect(scope, `${surface.label} must not keep the canal number in local state (${banned})`)
          .not.toMatch(banned);
      }
    });
  }

  it("the checks would fail on the code they replaced (positive control)", () => {
    // Verbatim fragments of the pre-fix implementations. If a guard pattern stops
    // matching anything, this test goes red instead of certifying a clean sweep.
    const oldLumbarBlock = `setSel((s) => ({ ...s, canalApMm }));  Use {canalApMm} mm`;
    const oldDorsalForm = `onChange={(e) => patch({ apMm: num(e.target.value) ?? null })}`;
    const oldDorsoLumbarForm = `const [apMm, setApMm] = useState(""); onChange={(e) => setApMm(e.target.value)}`;
    expect(oldLumbarBlock).toMatch(/setSel\(\(s\) => \(\{ \.\.\.s, canalApMm/);
    expect(oldLumbarBlock).toMatch(/Use \{canalApMm\} mm/);
    expect(oldDorsalForm).toMatch(/patch\(\{ apMm:/);
    expect(oldDorsoLumbarForm).toMatch(/const \[apMm, setApMm\] = useState/);
    expect(oldDorsoLumbarForm).toMatch(/setApMm\(/);
    expect(oldLumbarBlock).not.toMatch(/useCanalApCell\(\{/);
  });

  it("the dorsal slice is the level form, and the lesion form is still local", () => {
    // The scope is not cosmetic: the same file keeps a lesion's AP dimension, and
    // the ban must reach only the canal number. If `functionBody` returned the
    // whole file this assertion inverts, which is the point.
    const src = read("src/components/radiology/reporting-canvas/MriDorsalSubMasterPanel.tsx");
    const levelForm = functionBody(src, LEVEL_DETAIL_FORM);
    expect(levelForm).toMatch(/useCanalApCell\(\{/);
    expect(levelForm).not.toMatch(/patch\(\{ apMm:/);
    expect(src).toMatch(/patch\(\{ apMm: num\(e\.target\.value\)\s*\}\)/);
  });

  it("both canal tables key their rows through canalRows", () => {
    for (const file of [
      "src/components/radiology/reporting-canvas/SpineApCanalMeasurements.tsx",
      "src/components/radiology/reporting-canvas/DorsoLumbarApCanalMeasurements.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} must canonicalise its rows`).toMatch(/canalRows\(/);
      expect(src, `${file} must render the shared row`)
        .toMatch(/<CanalApRow[\s\S]*?level=\{level\}/);
      // a table that reads the record with the resolver's own letters re-opens the
      // key-mismatch defect: it saves under D8-D9 and displays nothing
      expect(src).not.toMatch(/canalApProvenance\[[a-zA-Z]+\]\)/);
    }
    // positive control: the shape the last check forbids
    expect(`const shown = canalApValue(canalApProvenance[level]);`).toMatch(/canalApProvenance\[[a-zA-Z]+\]\)/);
  });
});
