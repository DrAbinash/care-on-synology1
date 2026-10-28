import { describe, it, expect } from "vitest";
import {
  parseQuestions, fillStructuredTemplate, resolveSection, initialValues, missingRequired,
  generateStructuredFinding, parseEditableQuestions, serializeQuestions, type EditableQuestion,
} from "./structuredFindings";

// LS Disc Bulge finding template — one generic finding, level-driven section,
// optional clauses for foramina / canal / nerve root.
const DISC_BULGE = {
  anatomicalSection: "{level}",
  findingText:
    "{type} posterior disc bulge is seen at {level} causing indentation over the anterior thecal sac[ with {foramina} bilateral neural foraminal narrowing][ and impingement upon the traversing {nerve_root} nerve roots].",
  impressionText:
    "{type} posterior disc bulge at {level}[ with {foramina} bilateral neural foraminal narrowing][ and {nerve_root} nerve root impingement].",
  techniqueText: "",
  recommendationText: "",
};

describe("fillStructuredTemplate — optional clauses", () => {
  it("includes clauses whose values are present, matching the spec example", () => {
    const out = fillStructuredTemplate(DISC_BULGE.findingText, {
      type: "Diffuse", level: "L4-L5", foramina: "mild", nerve_root: "L5",
    });
    expect(out).toBe(
      "Diffuse posterior disc bulge is seen at L4-L5 causing indentation over the anterior thecal sac with mild bilateral neural foraminal narrowing and impingement upon the traversing L5 nerve roots.",
    );
  });

  it("drops clauses whose value is null-like (Normal / None)", () => {
    const out = fillStructuredTemplate(DISC_BULGE.findingText, {
      type: "Diffuse", level: "L5-S1", foramina: "Normal", nerve_root: "None",
    });
    expect(out).toBe("Diffuse posterior disc bulge is seen at L5-S1 causing indentation over the anterior thecal sac.");
  });

  it("keeps one clause and drops the other independently", () => {
    const out = fillStructuredTemplate(DISC_BULGE.findingText, {
      type: "Broad-based", level: "L4-L5", foramina: "moderate", nerve_root: "None",
    });
    expect(out).toBe(
      "Broad-based posterior disc bulge is seen at L4-L5 causing indentation over the anterior thecal sac with moderate bilateral neural foraminal narrowing.",
    );
  });

  it("takes an empty answer's label with it, and keeps the label when answered", () => {
    // The shipped CT box, verbatim from `radiology_quick_findings` id 335. The ASPECTS
    // question defaults to "", and the bare word "ASPECTS." on the page reads as a
    // score of nothing — it reached the report inside the box's own ledger sentence,
    // so deselection was also deleting a label the radiologist never wrote.
    const SOURCE = "Loss of grey-white differentiation with hypodensity in the "
      + "{territory} vascular territory, in keeping with an acute infarct. ASPECTS {aspects}.";
    expect(fillStructuredTemplate(SOURCE, { territory: "right MCA", aspects: "" })).toBe(
      "Loss of grey-white differentiation with hypodensity in the right MCA vascular territory, "
      + "in keeping with an acute infarct.",
    );
    expect(fillStructuredTemplate(SOURCE, { territory: "right MCA", aspects: "7" })).toBe(
      "Loss of grey-white differentiation with hypodensity in the right MCA vascular territory, "
      + "in keeping with an acute infarct. ASPECTS 7.",
    );
  });

  it("never leaves an authored blank in the sentence it renders", () => {
    // Shipped USG box id 449, which has no questions at all: nothing could fill it.
    expect(fillStructuredTemplate(
      "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, "
      + "largest measuring ___ mm, suggestive of cholelithiasis.", {},
    )).toBe(
      "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, "
      + "suggestive of cholelithiasis.",
    );
  });
});

describe("generateStructuredFinding — findings + impression together", () => {
  it("produces both the finding and the impression, section resolved from level", () => {
    const r = generateStructuredFinding(DISC_BULGE, { type: "Diffuse", level: "L4-L5", foramina: "mild", nerve_root: "L5" });
    expect(r.section).toBe("L4-L5");
    expect(r.finding).toContain("Diffuse posterior disc bulge is seen at L4-L5");
    expect(r.impression).toBe("Diffuse posterior disc bulge at L4-L5 with mild bilateral neural foraminal narrowing and L5 nerve root impingement.");
  });
});

describe("resolveSection", () => {
  it("resolves a templated section from values", () => {
    expect(resolveSection("{level}", { level: "L4-L5" })).toBe("L4-L5");
  });
  it("returns a static section unchanged", () => {
    expect(resolveSection("White Matter", {})).toBe("White Matter");
  });
  it("empty when the level is unset", () => {
    expect(resolveSection("{level}", { level: "" })).toBe("");
  });
});

describe("parseQuestions / initialValues / missingRequired", () => {
  const json = JSON.stringify([
    { key: "level", label: "Level", options: ["L3-L4", "L4-L5", "L5-S1"], default: "L4-L5", required: true, sortOrder: 1 },
    { key: "type", label: "Type", options: ["Diffuse", "Focal"], default: "Diffuse", sortOrder: 2 },
    { key: "foramina", label: "Foramina", options: ["Normal", "mild", "moderate", "severe"], sortOrder: 3 },
  ]);
  it("parses and orders questions", () => {
    const qs = parseQuestions(json);
    expect(qs.map((q) => q.key)).toEqual(["level", "type", "foramina"]);
    expect(qs[0].required).toBe(true);
  });
  it("initialValues prefers session memory, then default, then first option", () => {
    const qs = parseQuestions(json);
    expect(initialValues(qs, { type: "Focal", level: "L5-S1" }))
      .toEqual({ level: "L5-S1", type: "Focal", foramina: "Normal" });
  });

  /**
   * The rule this re-authoring records (audit finding C).
   *
   * `level` above is `required: true, default: "L4-L5"` — the same shape the
   * shipped renal boxes use for `side` (`default: "right", required: true`).
   * Pre-filling it opened the dialog already-answered: the "Required: Level" gate
   * could not fire, Enter applied, and the report stated a spinal level (a kidney
   * side) nobody chose. An OPTIONAL question keeps the pre-fill — "foramina"
   * below still opens on "Normal", and "type" still opens on its default.
   */
  it("opens a required choice unanswered, whatever its authored default says", () => {
    const qs = parseQuestions(json);
    const fresh = initialValues(qs, {});
    expect(fresh.level).toBe("");            // required: no level invented
    expect(fresh.type).toBe("Diffuse");      // optional: authored default kept
    expect(fresh.foramina).toBe("Normal");   // optional: first option kept
    expect(missingRequired(qs, fresh)).toEqual(["Level"]);
  });

  it("still remembers what the radiologist answered for this study", () => {
    const qs = parseQuestions(json);
    expect(initialValues(qs, { level: "L3-L4" }).level).toBe("L3-L4");
    expect(missingRequired(qs, initialValues(qs, { level: "L3-L4" }))).toEqual([]);
  });
  it("missingRequired flags an unanswered required question", () => {
    const qs = parseQuestions(json);
    expect(missingRequired(qs, { level: "", type: "Diffuse", foramina: "Normal" })).toEqual(["Level"]);
    expect(missingRequired(qs, { level: "L4-L5", type: "Diffuse", foramina: "Normal" })).toEqual([]);
  });
  it("returns [] for empty / invalid json", () => {
    expect(parseQuestions("")).toEqual([]);
    expect(parseQuestions("not json")).toEqual([]);
  });
});

describe("Settings editor model — parseEditableQuestions / serializeQuestions", () => {
  it("parses the engine shape into editable rows (options joined for the text field)", () => {
    const json = JSON.stringify([
      { key: "level", label: "Level", type: "select", options: ["L4-L5", "L5-S1"], default: "L4-L5", required: true, sortOrder: 1 },
      { key: "size", label: "Size", type: "text", options: [], default: "", sortOrder: 2 },
    ]);
    expect(parseEditableQuestions(json)).toEqual([
      { key: "level", label: "Level", type: "select", options: "L4-L5, L5-S1", default: "L4-L5", required: true },
      { key: "size", label: "Size", type: "text", options: "", default: "", required: false },
    ]);
  });

  it("tolerates malformed / non-array JSON without throwing", () => {
    expect(parseEditableQuestions("")).toEqual([]);
    expect(parseEditableQuestions("not json")).toEqual([]);
    expect(parseEditableQuestions('{"key":"x"}')).toEqual([]);
  });

  it("serializes rows back, numbering by display order, trimming options, key-fallback label", () => {
    const rows: EditableQuestion[] = [
      { key: "type", label: "Type", type: "select", options: "Diffuse, Focal", default: "Diffuse", required: false },
      { key: "level", label: "", type: "select", options: " L4-L5 , L5-S1 ,", default: "L4-L5", required: true },
    ];
    expect(parseQuestions(serializeQuestions(rows))).toEqual([
      { key: "type", label: "Type", type: "select", options: ["Diffuse", "Focal"], default: "Diffuse", required: false, sortOrder: 1 },
      { key: "level", label: "level", type: "select", options: ["L4-L5", "L5-S1"], default: "L4-L5", required: true, sortOrder: 2 },
    ]);
  });

  it("drops options for free-text questions", () => {
    const rows: EditableQuestion[] = [
      { key: "size", label: "Size", type: "text", options: "ignored, values", default: "", required: false },
    ];
    expect(JSON.parse(serializeQuestions(rows))[0].options).toEqual([]);
  });

  it("round-trips engine → editable → engine for a realistic finding", () => {
    const original = JSON.stringify([
      { key: "level", label: "Level", type: "select", options: ["L1-L2", "L4-L5"], default: "L4-L5", required: true, sortOrder: 1 },
      { key: "canal", label: "Canal Stenosis", type: "select", options: ["Normal", "mild", "severe"], default: "Normal", required: false, sortOrder: 2 },
    ]);
    expect(parseQuestions(serializeQuestions(parseEditableQuestions(original)))).toEqual(parseQuestions(original));
  });
});
