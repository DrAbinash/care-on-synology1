/**
 * Item 10's last line: what the model is told must be what the signed report
 * prints — proved on the rendered table, not on the fold it is built from.
 *
 * `canalAp.composerContext.test.ts` already pins the projection against
 * `canalApLevelsFromCanonicalRecord` (the data the print paths consume). That is
 * one step short of the claim a radiologist cares about: the signed report carries
 * `renderCanalApTable`'s output, and a table that prints `—` beside a level the
 * prompt called 6.4 mm is two canal diameters for one disc, whichever function is
 * right. These cases read the rendered cells.
 *
 * The last case states a boundary rather than a behaviour: the projection is
 * canonical-only, so a study measured solely through the legacy `spinal_measurements`
 * store prints a number the Composer was never told. That is deliberate (one store
 * the grid writes, one reader) and is recorded here so it cannot be mistaken for an
 * oversight later.
 */
import { describe, it, expect, vi } from "vitest";

// `spinalCanalApTable` imports `@workspace/db` at module scope, which throws
// without DATABASE_URL; `renderCanalApTable` itself queries nothing. Stubbed so
// this file runs DB-less like the rest of the composer suite.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
  radiologyReportDraftsTable: {},
  spinalMeasurementsTable: {},
}));
vi.mock("@workspace/crypto", () => ({
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => s,
}));

import {
  canalApLevelsFromCanonicalRecord,
  mergeCanalApLevels,
} from "@workspace/measurements";
import { STRUCTURED_JSON_ENVELOPE_KIND } from "../structuredJsonColumn";
import { renderCanalApTable } from "../spinalCanalApTable";
import { canalApFromStructuredJson } from "./canonicalCanalAp";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const rec = (over: Record<string, unknown> = {}) => ({
  measurementId: "CANAL_AP",
  unit: "mm",
  viewerValue: null,
  reportValue: null,
  manualOverride: false,
  staleReason: null,
  aliasConflict: false,
  ...over,
});

const CASES: Array<[string, Record<string, unknown>]> = [
  [
    "MRI LS Spine",
    {
      "L1-L2": rec({ viewerValue: 12.6 }),
      "L3-L4": rec({ viewerValue: 11.6 }),
      "L4-L5": rec({ viewerValue: 9.4, reportValue: 6.4, manualOverride: true }),
    },
  ],
  [
    "MRI Cervical Spine",
    {
      "C2-C3": rec({ viewerValue: 11.2 }),
      "C5-C6": rec({ viewerValue: 8.9, reportValue: 7.6, manualOverride: true }),
    },
  ],
  [
    "MRI Dorso-Lumbar Spine",
    {
      "T8-T9": rec({ viewerValue: 10.1 }),
      "D11-D12": rec({ viewerValue: 10.7 }),
      "L1-L2": rec({ viewerValue: 12.0 }),
      "L4-L5": rec({ viewerValue: 9.8 }),
    },
  ],
  [
    "Transitional vertebrae",
    {
      "L4-L5": rec({ viewerValue: 10.2 }),
      "L5-T": rec({ viewerValue: 8.4 }),
    },
  ],
];

const column = (provenance: Record<string, unknown>) => ({
  kind: STRUCTURED_JSON_ENVELOPE_KIND,
  careCanalApProvenance: provenance,
});

/** The rendered cells as printed: `[[level, value], …]` in table order.
 *  The markup is one header row (`LEVEL`, then the levels) and one value row
 *  (`AP (mm)`, then the numbers), so the cell list splits in half. */
function printedCells(provenance: Record<string, unknown>): [string, string][] {
  // The print path this mirrors: the canonical fold merged over the legacy store.
  // A synthetic grid-measured draft has no legacy rows, so the record decides every
  // cell exactly as it does for a study whose `spinal_measurements` are empty.
  const table = renderCanalApTable(
    mergeCanalApLevels(new Map<string, string>(), canalApLevelsFromCanonicalRecord(provenance)),
  );
  if (!table) throw new Error("no table rendered");
  const cells = (table.html.match(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g) ?? [])
    .map((r) => String(r.match(/>([^<]*)</)?.[1] ?? "").trim());
  const half = cells.length / 2;
  const levels = cells.slice(1, half);
  const values = cells.slice(half + 1);
  return levels.map((l, i) => [l, values[i]] as [string, string]);
}

function promptCanalBlock(provenance: Record<string, unknown>): string {
  const snapshot = parseComposerSnapshot({
    worklistId: 1,
    modality: "MRI",
    findings: "Canal AP diameters were recorded in the measurement grid.",
    observations: [],
  }) as ComposerInputSnapshot;
  const ctx = buildRadiologistDraftContext(snapshot, canalApFromStructuredJson(column(provenance)));
  const prompt = renderRadiologistDraftContextPrompt(ctx, "FULL_REPORT");
  const start = prompt.indexOf("CANAL AP DIAMETERS");
  if (start < 0) return "";
  return prompt.slice(start, prompt.indexOf("\n\n", start));
}

describe("the rendered canal table and the Composer prompt are the same numbers", () => {
  for (const [name, provenance] of CASES) {
    it(`${name}: every projected reading is a printed cell with the same number`, () => {
      const out = canalApFromStructuredJson(column(provenance));
      const cells = printedCells(provenance);
      expect(out.readings.length).toBeGreaterThan(0);
      for (const r of out.readings) {
        const cell = cells.find(([level]) => level === r.level);
        expect(cell, `${r.level} is absent from the rendered table`).toBeDefined();
        expect(cell?.[1]).toBe(r.valueMm);
      }
      // The other half of the invariant, and the one that matters clinically: the
      // table prints the segment's whole level list, so an unmeasured disc prints
      // a blank cell — never a number the record did not give. A non-`—` here is a
      // canal diameter in the signed report that the model was told nothing about.
      const measured = new Set(out.readings.map((r) => r.level));
      for (const [level, value] of cells) {
        if (measured.has(level)) continue;
        expect(value, `${level} prints a number no measurement supports`).toBe("—");
      }
    });

    it(`${name}: the prompt lists the same levels, in the same order`, () => {
      const out = canalApFromStructuredJson(column(provenance));
      const block = promptCanalBlock(provenance);
      const promptLevels = [...block.matchAll(/^- ([^:]+):/gm)].map((m) => m[1]);
      expect(promptLevels).toEqual(out.readings.map((r) => r.level));
      for (const r of out.readings) {
        expect(block).toContain(`${r.level}: ${r.valueMm} mm`);
      }
    });
  }

  it("a Dorso-Lumbar study is one combined table, not the most-filled segment", () => {
    // Owner DECISION 1 of 2026-10-17. The Composer reads levels, so the same
    // ruling has to hold on both sides or a dorsal disc measured in a D-L study
    // would print and never be mentioned.
    const dl = CASES.find(([n]) => n === "MRI Dorso-Lumbar Spine")?.[1] ?? {};
    const cells = printedCells(dl).map(([l]) => l);
    expect(cells).toContain("D8-D9");
    expect(cells).toContain("L4-L5");
    expect(promptCanalBlock(dl)).toContain("D8-D9");
  });

  it("a declined level prints a blank cell and is never given a number in the prompt", () => {
    const declined = {
      "L1-L2": rec({ viewerValue: 12.6 }),
      "L3-L4": rec({
        viewerValue: 11.6,
        aliasConflict: { aliasKeys: ["L3-L4", "L3-L4"], values: [11.6, 10.2] },
      }),
    };
    const out = canalApFromStructuredJson(column(declined));
    expect(out.declinedLevels).toEqual(["L3-L4"]);
    const cells = printedCells(declined);
    expect(cells.find(([l]) => l === "L3-L4")?.[1]).toBe("—");
    const block = promptCanalBlock(declined);
    // Neither candidate reaches the model, so neither can be quoted.
    expect(block).not.toContain("11.6");
    expect(block).not.toContain("10.2");
    expect(block).toContain("L3-L4");
  });

  it("a measurement held only in the legacy store prints without reaching the Composer", () => {
    // The documented boundary. `spinal_measurements` still has a live writer (the
    // legacy generator page and the AI-tab box), so print folds it and the signed
    // report keeps every number it ever printed; the projection deliberately reads
    // only the record the grid writes and answers nothing for a level it cannot see.
    const provenance = { "L1-L2": rec({ viewerValue: 12.6 }) };
    const legacy = new Map([["L2-L3", "11.9"]]);
    const out = canalApFromStructuredJson(column(provenance));
    expect(out.readings.map((r) => r.level)).toEqual(["L1-L2"]);

    const table = renderCanalApTable(
      // `mergeCanalApLevels(legacy, canonical)` — the record decides, and a level
      // only the legacy store knows about still prints.
      mergeCanalApLevels(legacy, canalApLevelsFromCanonicalRecord(provenance)),
    );
    expect(table?.text).toContain("L2-L3: 11.9");
    expect(promptCanalBlock(provenance)).not.toContain("L2-L3");
  });
});
