/**
 * The AI Composer reads the canal AP diameters a radiologist recorded in the
 * measurement grid — not the ones a sentence happened to repeat.
 *
 * RIS-013 gap 3 measured the old state: `buildRadiologistDraftContext` scraped
 * numbers out of prose, so a study with five grid measurements and a Findings
 * sentence that named none of them reached the model with no canal data at all,
 * while the signed report's table printed five numbers the AI had never seen.
 * These tests pin the replacement: one read-only projection of the canonical
 * record (`structured_json.careCanalApProvenance`), the same authority
 * `canalApValue` answers through for print, handed to Generate and to Refine,
 * and checked against the draft independently of prose.
 *
 * What is deliberately NOT here: a second store, a write path, or a table in the
 * draft text. The record belongs to the workspace grid; the Composer is a reader.
 */
import { describe, it, expect } from "vitest";
import {
  canalApLevelsFromCanonicalRecord,
  canalPrintPlan,
  printCanalApValue,
} from "@workspace/measurements";
import { STRUCTURED_JSON_ENVELOPE_KIND } from "../structuredJsonColumn";
import { canalApFromStructuredJson, canalApPromptFields } from "./canonicalCanalAp";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import { validateComposerOutput } from "./validateOutput";
import {
  ComposerDraftOutputSchema,
  ComposerInputSnapshotSchema,
  parseComposerSnapshot,
  type ComposerDraftOutput,
  type ComposerInputSnapshot,
} from "./types";

/** The persisted shape: level keys → record fields, wrapped in the envelope. */
function column(provenance: Record<string, unknown>): unknown {
  return { kind: STRUCTURED_JSON_ENVELOPE_KIND, careCanalApProvenance: provenance };
}

const LS_SPINE: Record<string, unknown> = {
  "L1-L2": { viewerValue: 12.6 },
  "L3-L4": { viewerValue: 11.6 },
  "L4-L5": { viewerValue: 9.4, reportValue: 6.4, manualOverride: true },
};

const CERVICAL: Record<string, unknown> = {
  "C2-C3": { viewerValue: 11.2 },
  "C5-C6": { viewerValue: 8.9, reportValue: 7.6, manualOverride: true },
};

const DORSO_LUMBAR: Record<string, unknown> = {
  "D6-D7": { viewerValue: 11.1 },
  "T8-T9": { viewerValue: 10.1 },
  "L1-L2": { viewerValue: 12 },
  "L4-L5": { viewerValue: 6.4 },
};

const TRANSITIONAL: Record<string, unknown> = {
  "L4-L5": { viewerValue: 11.3 },
  "L5-T": { viewerValue: 10.7 },
  "L6-S1": { viewerValue: 9.2 },
};

const WITH_DECLINED: Record<string, unknown> = {
  "D6-D7": { viewerValue: 11.1 },
  "D8-D9": {
    viewerValue: 10.1,
    aliasConflict: { aliasKeys: ["D8-D9", "T8-T9"], values: [10.1, 9.6] },
  },
  "L5-S1": { viewerValue: 8, staleReason: "level_renumbered" },
};

function snap(findings = ""): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    spineSegment: "lumbar",
    reportTitle: "MRI LS SPINE",
    clinicalHistory: "Low back pain.",
    technique: "Multiplanar MRI lumbar spine.",
    findings,
    impression: "",
    recommendation: "",
    observations: [],
    jobKindHint: "FULL_REPORT",
  });
}

function draft(findings: string): ComposerDraftOutput {
  return ComposerDraftOutputSchema.parse({ findings });
}

function generatePrompt(provenance: Record<string, unknown> | null, findings = ""): string {
  const canalAp = canalApFromStructuredJson(
    provenance === null ? null : column(provenance),
  );
  return renderRadiologistDraftContextPrompt(
    buildRadiologistDraftContext(snap(findings), canalAp),
    "FULL_REPORT",
  );
}

/** The canonical block only — so assertions cannot pass on a coincidental match
 *  somewhere else in the prompt (the observation lines also carry numbers). */
function canalBlock(prompt: string): string {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.startsWith("CANAL AP DIAMETERS"));
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i += 1) out.push(lines[i]);
  return out.join("\n");
}

describe("item 1 — the canonical record is read from the draft's own column", () => {
  it("reads the envelope the draft stores, not a re-derived copy", () => {
    const out = canalApFromStructuredJson(column(LS_SPINE));
    expect(out.readings.map((r) => [r.level, r.valueMm])).toEqual([
      ["L1-L2", "12.6"],
      ["L3-L4", "11.6"],
      ["L4-L5", "6.4"],
    ]);
  });

  it("reads the bare shape too, because both are persisted", () => {
    expect(canalApFromStructuredJson({ careCanalApProvenance: LS_SPINE }).readings).toHaveLength(3);
  });

  it("carries nothing for a study with no canal record", () => {
    for (const raw of [null, undefined, {}, { kind: "care.something_else" }, "junk", []]) {
      const out = canalApFromStructuredJson(raw);
      expect(out.readings).toEqual([]);
      expect(out.isEmpty).toBe(true);
    }
  });

  it("keeps the unit, the level and the provenance on every reading", () => {
    const out = canalApFromStructuredJson(column(LS_SPINE));
    expect(out.readings.every((r) => r.unit === "mm")).toBe(true);
    expect(out.readings.every((r) => r.segment === "lumbar")).toBe(true);
    expect(out.readings.map((r) => r.source)).toEqual([
      "viewer-caliper",
      "viewer-caliper",
      "radiologist-entered",
    ]);
  });
});

describe("item 4 + 9 — Generate is handed the record, prose is untouched", () => {
  it("renders a canal section naming each measured level with its millimetres", () => {
    const block = canalBlock(generatePrompt(LS_SPINE));
    expect(block).toContain("CANAL AP DIAMETERS");
    expect(block).toContain("L1-L2: 12.6 mm");
    expect(block).toContain("L3-L4: 11.6 mm");
    expect(block).toContain("L4-L5: 6.4 mm");
  });

  it("reaches the model even when the Findings prose states no number at all", () => {
    // The exact case the old prose scrape was blind to.
    const prompt = generatePrompt(LS_SPINE, "The thecal sac is patent throughout.");
    expect(canalBlock(prompt)).toContain("6.4 mm");
    // The prose-derived list still carries nothing, so the canal block is the
    // only route these numbers take — that is what makes the check independent.
    expect(prompt).toContain("(none extracted)");
  });

  it("leaves the radiologist's own Findings text byte-identical", () => {
    const findings = "There is no spondylolisthesis. The conus ends at L1-L2.";
    const ctx = buildRadiologistDraftContext(snap(findings), canalApFromStructuredJson(column(LS_SPINE)));
    expect(ctx.protectedManualText.findings).toBe(findings);
    expect(renderRadiologistDraftContextPrompt(ctx, "FULL_REPORT")).toContain(findings);
  });

  it("renders nothing extra for a study that has no canal record", () => {
    const withNull = renderRadiologistDraftContextPrompt(
      buildRadiologistDraftContext(snap(), canalApFromStructuredJson(null)),
      "FULL_REPORT",
    );
    const withoutArg = renderRadiologistDraftContextPrompt(
      buildRadiologistDraftContext(snap()),
      "FULL_REPORT",
    );
    expect(withNull).not.toContain("CANAL AP DIAMETERS");
    expect(withNull).toBe(withoutArg);
  });

  it("covers MRI Cervical Spine levels without inventing C1-C2", () => {
    const block = canalBlock(generatePrompt(CERVICAL));
    expect(block).toContain("C2-C3: 11.2 mm");
    expect(block).toContain("C5-C6: 7.6 mm");
    expect(block).not.toContain("C1-C2");
    // The caliper read 8.9 mm; the radiologist's 7.6 mm is the only number offered.
    expect(block).not.toContain("8.9");
  });

  it("covers MRI Dorso-Lumbar as one head-to-tail list, dorsal first", () => {
    const block = canalBlock(generatePrompt(DORSO_LUMBAR));
    const levels = [...block.matchAll(/\b([CDLS]\d{1,2}(?:-[CDLS]?\d{1,2})?):\s/g)].map((m) => m[1]);
    expect(levels).toEqual(["D6-D7", "D8-D9", "L1-L2", "L4-L5"]);
  });

  it("covers transitional vertebrae with their own numbering", () => {
    const block = canalBlock(generatePrompt(TRANSITIONAL));
    expect(block).toContain("L5-T: 10.7 mm");
    expect(block).toContain("L6-S1: 9.2 mm");
    expect(block).toContain("L4-L5: 11.3 mm");
  });
});

describe("item 2 — what is preserved", () => {
  it("keeps the manual override and does not offer the superseded caliper number", () => {
    const block = canalBlock(generatePrompt(LS_SPINE));
    expect(block).toContain("L4-L5: 6.4 mm");
    expect(block).not.toContain("9.4");
    expect(block.toLowerCase()).toContain("radiologist");
  });

  it("keeps a decimal exactly as recorded (12.6, not 13)", () => {
    expect(canalBlock(generatePrompt(LS_SPINE))).toContain("12.6 mm");
  });

  it("keeps the transitional and junction keys the grid saved", () => {
    const out = canalApFromStructuredJson(
      column({ "D12-L1": { viewerValue: 9.8 }, "L5-T": { viewerValue: 10.7 } }),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["D12-L1", "L5-T"]);
  });
});

describe("item 3 — what is excluded, and named so the model stays silent", () => {
  it("a level whose aliases disagree is declined and its number never appears", () => {
    const prompt = generatePrompt(WITH_DECLINED);
    const block = canalBlock(prompt);
    expect(block).toContain("D6-D7: 11.1 mm");
    expect(block).toContain("D8-D9");
    expect(block).not.toMatch(/D8-D9:\s*[\d.]+\s*mm/);
    // Neither candidate value reaches the model, so neither can be quoted.
    expect(prompt).not.toContain("10.1 mm");
    expect(prompt).not.toContain("9.6 mm");
  });

  it("a level whose vertebra moved under it is declined", () => {
    const out = canalApFromStructuredJson(column(WITH_DECLINED));
    expect(out.declinedLevels).toEqual(["D8-D9", "L5-S1"]);
    expect(out.readings.map((r) => r.level)).toEqual(["D6-D7"]);
    expect(canalBlock(generatePrompt(WITH_DECLINED))).not.toContain("8 mm");
  });

  it("a stale caliper drift keeps the recorded number and says the caliper moved", () => {
    const out = canalApFromStructuredJson(
      column({
        "L4-L5": {
          viewerValue: 9.9,
          reportValue: 6.4,
          manualOverride: true,
          staleReason: "measurement_changed",
        },
      }),
    );
    // The signed table prints 6.4, so a draft that contradicts it is the fault,
    // not the number. Excluding it would make the AI disagree with the report.
    expect(out.readings.map((r) => r.valueMm)).toEqual(["6.4"]);
    expect(out.readings[0]?.staleReason).toBe("measurement_changed");
  });

  it("a level key nobody can canonicalise is withheld rather than guessed", () => {
    const out = canalApFromStructuredJson(
      column({ L4: { viewerValue: 7.7 }, "L4-L5": { viewerValue: 6.4 } }),
    );
    expect(out.ambiguousLevels).toEqual(["L4"]);
    expect(out.readings.map((r) => r.level)).toEqual(["L4-L5"]);
    expect(canalBlock(generatePrompt({ L4: { viewerValue: 7.7 }, "L4-L5": { viewerValue: 6.4 } }))).not.toContain("7.7");
  });
});

describe("items 6 + 8 — read-only, and no second table", () => {
  it("does not modify the record it was handed", () => {
    const input = column({ ...LS_SPINE });
    const before = JSON.stringify(input);
    canalApFromStructuredJson(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("tells the model not to restate the measurements as a table", () => {
    const block = canalBlock(generatePrompt(LS_SPINE)).toLowerCase();
    expect(block).toContain("do not");
    expect(/table|duplicate/i.test(block)).toBe(true);
  });

  it("declares the block read-only so no draft can claim to change it", () => {
    expect(canalBlock(generatePrompt(LS_SPINE))).toContain("READ-ONLY");
  });

  it("is not a field the client can fill in, because the snapshot has none", () => {
    // Item 7: no second store. The record is read from the server's own draft row;
    // a workstation that sent a `careCanalApProvenance` of its own would be a
    // second, unfed authority over what the AI is told about a patient's canal.
    const parsed = ComposerInputSnapshotSchema.parse({
      modality: "MR",
      findings: "",
      impression: "",
      recommendation: "",
      observations: [],
      careCanalApProvenance: { "L4-L5": { viewerValue: 99 } },
    });
    expect(parsed).not.toHaveProperty("careCanalApProvenance");
  });
});

// Item 4's Refine cases are in `canalAp.refinePrompt.test.ts`: `buildUserPrompt`
// lives in the module that pulls in the provider layer and therefore the
// database, so it needs a mocked `@workspace/db` to run DB-less.

describe("item 4 — the payload a Refine job is given", () => {
  it("carries level + millimetres + unit + provenance for every measured disc", () => {
    expect(canalApPromptFields(canalApFromStructuredJson(column(LS_SPINE)))).toMatchObject({
      canalApDiametersMm: [
        { level: "L1-L2", mm: "12.6", unit: "mm", source: "viewer-caliper" },
        { level: "L3-L4", mm: "11.6", unit: "mm", source: "viewer-caliper" },
        { level: "L4-L5", mm: "6.4", unit: "mm", source: "radiologist-entered", manualOverride: true },
      ],
    });
  });

  it("names declined levels and carries no number for them", () => {
    const fields = canalApPromptFields(canalApFromStructuredJson(column(WITH_DECLINED)));
    expect(fields.canalApDeclinedLevels).toEqual(["D8-D9", "L5-S1"]);
    const readings = fields.canalApDiametersMm as Array<Record<string, unknown>>;
    expect(readings.map((r) => r.level)).toEqual(["D6-D7"]);
    expect(JSON.stringify(fields)).not.toContain("9.6");
  });

  it("says the record is read-only and must not be restated as a table", () => {
    const rule = String(
      canalApPromptFields(canalApFromStructuredJson(column(LS_SPINE))).canalApRule ?? "",
    );
    expect(rule).toMatch(/READ-ONLY/i);
    expect(rule.toLowerCase()).toContain("table");
  });

  it("adds no keys for a study with no canal record", () => {
    expect(canalApPromptFields(canalApFromStructuredJson(null))).toEqual({});
    expect(canalApPromptFields(null)).toEqual({});
    expect(canalApPromptFields(undefined)).toEqual({});
  });
});

describe("item 5 — the draft is checked against the record, not against prose", () => {
  const record = canalApFromStructuredJson(column(LS_SPINE));

  it("fails a draft that restates a canonical diameter with a different number", () => {
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("The AP canal diameter at L4-L5 is 9.4 mm."),
      { kind: "FULL_REPORT", canalAp: record },
    );
    expect(out.errors).toContain("canal_measurement_mutation");
    expect(out.ok).toBe(false);
  });

  it("does not blame the AI for copying a number the radiologist dictated", () => {
    // The prose and the record already disagreed BEFORE this job ran; the table
    // wins, and refusing an honest rewrite is not the radiologist's problem.
    const out = validateComposerOutput(
      snap("The AP canal diameter at L4-L5 is 9.4 mm."),
      draft("The AP canal diameter at L4-L5 is 9.4 mm."),
      { kind: "PROFESSIONALIZE", canalAp: record },
    );
    expect(out.errors).not.toContain("canal_measurement_mutation");
  });

  it("passes a draft that quotes the canonical number", () => {
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("The AP canal diameter at L4-L5 is 6.4 mm."),
      { kind: "FULL_REPORT", canalAp: record },
    );
    expect(out.errors).not.toContain("canal_measurement_mutation");
  });

  it("matches a trailing zero against the same number (6.40 mm is 6.4 mm)", () => {
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("The AP canal diameter at L4-L5 measures 6.40 mm."),
      { kind: "FULL_REPORT", canalAp: record },
    );
    expect(out.errors).not.toContain("canal_measurement_mutation");
  });

  it("refuses to guess when a sentence does not attribute one number to one level", () => {
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("The AP canal diameters at L1-L2 and L3-L4 are 11.6 mm."),
      { kind: "FULL_REPORT", canalAp: record },
    );
    expect(out.errors).not.toContain("canal_measurement_mutation");
  });

  it("fails a draft that reports a diameter at a level the record declined", () => {
    const declined = canalApFromStructuredJson(column(WITH_DECLINED));
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("The AP canal diameter at D8-D9 is 10.2 mm."),
      { kind: "FULL_REPORT", canalAp: declined },
    );
    expect(out.errors).toContain("canal_measurement_invented");
  });

  it("warns without blocking when a canonical diameter goes unmentioned", () => {
    // Generate is told not to restate every level, so silence is not a fault —
    // but it must stop being invisible, which is what prose-only checking was.
    const out = validateComposerOutput(
      snap("The thecal sac is patent."),
      draft("Lumbar lordosis is maintained. The study is technically adequate."),
      { kind: "FULL_REPORT", canalAp: record },
    );
    expect(out.ok).toBe(true);
    expect(out.warnings.join("\n")).toContain("L4-L5");
  });

  it("is inert for every caller that passes no record", () => {
    const s = snap("The thecal sac is patent.");
    const d = draft("The AP canal diameter at L4-L5 is 9.4 mm.");
    expect(validateComposerOutput(s, d, { kind: "FULL_REPORT" }).errors).not.toContain(
      "canal_measurement_mutation",
    );
    expect(validateComposerOutput(s, d, { kind: "FULL_REPORT", canalAp: null })).toEqual(
      validateComposerOutput(s, d, { kind: "FULL_REPORT" }),
    );
  });
});

describe("item 10 — the numbers handed over are the numbers the table prints", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["MRI LS Spine", LS_SPINE],
    ["MRI Cervical Spine", CERVICAL],
    ["MRI Dorso-Lumbar Spine", DORSO_LUMBAR],
    ["Transitional vertebrae", TRANSITIONAL],
  ];

  for (const [name, provenance] of cases) {
    it(`${name}: every reading equals the printed fold, in the printed order`, () => {
      const out = canalApFromStructuredJson(column(provenance));
      // The print fold is `canalApLevelsFromCanonicalRecord` + `canalPrintPlan`;
      // the Composer must agree with it at every level it names, or a report would
      // carry two canal diameters for one disc.
      const printed = canalApLevelsFromCanonicalRecord(provenance);
      for (const r of out.readings) {
        expect(printed.get(r.level)).toBe(r.valueMm);
        expect(printCanalApValue(r.valueMm)).toBe(r.valueMm);
      }
      const plan = canalPrintPlan(out.readings.map((r) => r.level));
      expect(plan?.levels.filter((l) => out.readings.some((r) => r.level === l))).toEqual(
        out.readings.map((r) => r.level),
      );
    });
  }

  it("a declined level is absent from the printed fold too, not merely withheld", () => {
    const printed = canalApLevelsFromCanonicalRecord(WITH_DECLINED);
    const out = canalApFromStructuredJson(column(WITH_DECLINED));
    for (const level of out.declinedLevels) {
      // `null` from the fold means "the record refuses", which is what print
      // renders as a blank cell. The model must be told nothing instead.
      expect(printed.get(level)).toBeNull();
    }
  });
});
