/**
 * Q106 — the un-filled placeholder rule.
 *
 * The rule used to test one literal: `text.includes("{value}")`. Measured at
 * `3f044107`, the content CARE actually ships writes its blanks three other ways,
 * and `{value}` is not the commonest of them:
 *
 *   dialect            shipped occurrences                        Q106 saw it?
 *   `{value}`          measurementVars.ts templates               yes
 *   `___`              13 Findings tiles + 1 Recommendation tile  no
 *                      in quick-select-tiles.data.ts, 16 lines in
 *                      report-formats-library.ts, plus
 *                      radiologyMasterTemplates / MeasurementLibrary /
 *                      QuickAddData / ReportAssembler
 *   `[slot]`           "Standard H&P" clinical-history tile, the
 *                      master-template choice groups
 *                      ("[vascular territory]", "[normal/reduced]")           no
 *   bare `X` + unit    mriSpineProse libraries, which already
 *                      carry their own detector
 *                      (`isUnfilledSpineProse`) that this tier
 *                      never called                                        no
 *
 * The consequence, measured through the real store: click four shipped brain
 * tiles and CARE prints "Mass effect with midline shift of ___ mm." into
 * Findings. `evaluateTextTier` scored that report 95/100 with one finding —
 * Q004, missing clinical history. A report with an unmeasured midline shift in
 * it was one advisory short of "ready to sign".
 *
 * This is the same fault PR #868 fixed for the signed-report ratchet: a check
 * that pins ONE spelling of a thing ships blind to the rest.
 *
 * `quickSelectParameterContract.ts` already declined this job on the write side,
 * explicitly: "deliberately not wired into mergeField / setField: text a
 * radiologist types is first-class, braces and all (an unfilled `___` blank or
 * their own shorthand is not this contract's business)." So the blank is this
 * tier's to catch, and it was not.
 */
import { describe, expect, it } from "vitest";
import { evaluateTextTier } from "./evaluate";
import { PLACEHOLDER_DIALECTS, unfilledPlaceholders } from "./placeholders";
import type { TextReportInput } from "../contract";

/** A report that is otherwise complete, so Q106 is the only thing that can fire. */
function report(over: Partial<TextReportInput> = {}): TextReportInput {
  return {
    modality: "MR",
    studyDescription: "MRI BRAIN PLAIN",
    sex: "male",
    age: "54",
    technique: "Multiplanar multisequence MRI of the brain was performed.",
    clinicalHistory: "Sudden onset right-sided weakness since 2 hours.",
    findings:
      "Acute intraparenchymal hemorrhage in the left basal ganglia with intraventricular extension. " +
      "No midline shift. Both kidneys are normal.",
    impression: ["Acute left basal ganglia hemorrhage."],
    recommendation: "Clinical correlation advised.",
    ...over,
  };
}

function q106(input: TextReportInput) {
  return evaluateTextTier(input).findings.filter((f) => f.ruleId === "Q106");
}

describe("placeholder dialects — the vocabulary is named, not guessed", () => {
  it("covers exactly the four dialects shipped content emits", () => {
    expect(PLACEHOLDER_DIALECTS.map((d) => d.kind)).toEqual([
      "template-token",
      "blank",
      "bracket-slot",
      "bare-measurement",
    ]);
  });

  it("sees every {token} fillTemplate can leave behind, not just {value}", () => {
    // abnormalityEngine.fillTemplate understands five tokens. Its own cleanup
    // only strips the grammatical chunk for {level}/{value}/{side}, and the
    // write-side contract only refuses on {side}/{severity} — so {chronicity}
    // and {level} can reach the page as literal braces with nothing else seeing
    // them.
    for (const token of ["side", "severity", "chronicity", "level", "value"]) {
      expect(unfilledPlaceholders(`Acute {${token}} infarct.`).map((h) => h.raw), `{${token}}`)
        .toEqual([`{${token}}`]);
    }
  });

  it("does not read an arbitrary brace as a placeholder", () => {
    expect(unfilledPlaceholders("A {BIRADS} category of 3.")).toEqual([]);
    expect(unfilledPlaceholders("Set notation {a, b}.")).toEqual([]);
  });

  it("sees a run of three or more underscores, and not two", () => {
    expect(unfilledPlaceholders("Mass effect with midline shift of ___ mm.").map((h) => h.raw))
      .toEqual(["___"]);
    expect(unfilledPlaceholders("Measures ___ × ___ × ___ cm.").length).toBe(3);
    expect(unfilledPlaceholders("Signed __ on the line.")).toEqual([]);
  });

  it("sees a bracketed fill-in slot", () => {
    expect(unfilledPlaceholders("Patient presents with [symptom] for [duration].").map((h) => h.raw))
      .toEqual(["[symptom]", "[duration]"]);
    expect(unfilledPlaceholders("Acute infarct in the [vascular territory] territory.").length).toBe(1);
    expect(unfilledPlaceholders("Disc space is [normal/reduced].").length).toBe(1);
  });

  it("sees a bare X standing in for a measurement, with its unit", () => {
    expect(unfilledPlaceholders("Disc desiccation with bulge, X mm.").map((h) => h.raw)).toEqual(["X"]);
    // A dimension is written as one group; the whole group is the unfilled slot,
    // not three of them.
    expect(unfilledPlaceholders("Lesion measures X x X cm.").map((h) => h.raw)).toEqual(["X x X"]);
    expect(unfilledPlaceholders("Lesion measures X × X × X cm.").map((h) => h.raw)).toEqual(["X × X × X"]);
    expect(unfilledPlaceholders("Percentage stenosis is X%.") .map((h) => h.raw)).toEqual(["X"]);
    expect(unfilledPlaceholders("The X-ray shows no fracture.")).toEqual([]);
    expect(unfilledPlaceholders("Cervical spine X ray is unremarkable.")).toEqual([]);
    expect(unfilledPlaceholders("The left lateral recess is patent.")).toEqual([]);
  });

  it("reports the dialect with each hit so a caller can say why", () => {
    const hits = unfilledPlaceholders("At L___-___: [Findings]. Measures {value} mm, i.e. X mm.");
    expect(hits.map((h) => h.kind)).toEqual([
      "blank", "blank", "bracket-slot", "template-token", "bare-measurement",
    ]);
  });
});

describe("Q106 through the canonical text tier", () => {
  it("still fires on {value} — the one spelling it already saw", () => {
    const hits = q106(report({ findings: "Common bile duct measures {value} mm." }));
    expect(hits.length).toBe(1);
  });

  it("fires on the midline blank CARE itself prints from a shipped tile", () => {
    const hits = q106(report({
      findings:
        "Acute intraparenchymal hemorrhage in the left basal ganglia with intraventricular extension. " +
        "Mass effect with midline shift of ___ mm.",
    }));
    expect(hits.length, "the report ships with an unmeasured midline shift").toBe(1);
    expect(hits[0]!.message).toContain("___");
    expect(hits[0]!.deduct).toBe(5);
  });

  it("names the offending placeholder in the message", () => {
    const [hit] = q106(report({ findings: "Acute infarct in the [vascular territory] territory." }));
    expect(hit!.message).toContain("[vascular territory]");
  });

  it("fires once for the whole report, however many blanks it holds", () => {
    const hits = q106(report({
      findings: "Lesion measures ___ × ___ × ___ cm at L4-L5. Canal AP ___ mm.",
    }));
    expect(hits.length).toBe(1);
  });

  it("reads Technique, Recommendation and Clinical history too, not only Findings", () => {
    expect(q106(report({ technique: "MRI performed, slice thickness ___ mm." })).length).toBe(1);
    expect(q106(report({ recommendation: "Repeat imaging in ___ weeks." })).length).toBe(1);
    expect(q106(report({ clinicalHistory: "Pain since [duration]." })).length).toBe(1);
    expect(q106(report({ impression: ["Lesion measuring ___ cm."] })).length).toBe(1);
  });

  it("stays quiet on a filled report", () => {
    expect(q106(report({
      findings: "Acute infarct in the left MCA territory measuring 22 × 18 mm. No midline shift.",
    }))).toEqual([]);
  });

  it("stays quiet on prose that merely looks like a placeholder", () => {
    expect(q106(report({
      findings:
        "The X-ray projection was adequate. Assessment category BI-RADS 3. " +
        "Signal intensity is reduced, graded 2 of 5.",
    }))).toEqual([]);
  });
});
