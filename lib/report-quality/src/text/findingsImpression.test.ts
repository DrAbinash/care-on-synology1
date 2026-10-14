/**
 * The Findings↔Impression contract (Q119-Q123).
 *
 * These are the checks both authoring paths share: the canonical text tier the
 * server persists and the live badge on the workstation call this module and
 * nothing else, so a contradiction here is a contradiction on both. The cases are
 * the ones the product owner named, plus the reports that must stay quiet — a rule
 * that marks up a correct report trains the clinic to click through the badge, and
 * a clicked-through badge is how a real level mismatch gets signed.
 *
 * Every case is synthetic prose. None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { findingsImpressionContradictions, sectionsContradict } from "./findingsImpression";
import { evaluateTextTier } from "./evaluate";
import type { TextReportInput } from "../contract";

function messages(findings: string, impression: string): string[] {
  return findingsImpressionContradictions(findings, impression).map((c) => c.message);
}

function ruleIds(findings: string, impression: string): string[] {
  return findingsImpressionContradictions(findings, impression).map((c) => c.ruleId);
}

function report(over: Partial<TextReportInput> & Pick<TextReportInput, "findings" | "impression">): TextReportInput {
  return {
    technique: "Examination performed per protocol.",
    clinicalHistory: "For the purpose of this case.",
    recommendation: "Clinical correlation advised.",
    ...over,
  };
}

const ONE = (findings: string, impression: string): string => {
  const got = messages(findings, impression);
  expect(got).toHaveLength(1);
  return got[0]!;
};

describe("the three shapes the owner named", () => {
  it("Ex2 — a focal denial in Findings against a focal assertion in Impression", () => {
    expect(
      ONE(
        "Degenerative changes are noted. No significant spinal canal stenosis.",
        "Severe spinal canal stenosis at L4-L5.",
      ),
    ).toBe('Findings/Impression contradiction: the Findings deny "stenosis" but the Impression reports it.');
  });

  it("Ex3 — the same finding placed at two different lumbar levels", () => {
    expect(ONE("Disc bulge at L4-L5 with a preserved disc height.", "Disc bulge at L5-S1.")).toBe(
      'Possible level mismatch: the Findings place "disc bulge" at L4-L5 but the Impression places it at L5-S1.',
    );
  });

  it("Ex3 — and the same move in the cervical spine", () => {
    expect(ONE("C5-C6 disc herniation indenting the thecal sac.", "C6-C7 disc herniation.")).toBe(
      'Possible level mismatch: the Findings place "herniation" at C5-C6 but the Impression places it at C6-C7.',
    );
  });

  it("Ex1 — laterality is Q104's, and this contract stays quiet rather than saying it twice", () => {
    const findings = "There is an acute infarct in the right frontal lobe with restricted diffusion.";
    const impression = "Acute left frontal lobe infarct.";
    expect(messages(findings, impression)).toEqual([]);
    // Not a gap: the canonical engine does flag this report, through the rule that
    // already owned laterality. Two wordings of one fact is how a badge gets
    // clicked through, so the newer contract deliberately does not repeat it.
    const ids = evaluateTextTier(report({ findings, impression: [impression] })).findings.map((f) => f.ruleId);
    expect(ids).toContain("Q104");
  });
});

describe("quiet on reports that are correct", () => {
  const QUIET: [string, string, string][] = [
    [
      "a spine report that agrees with itself",
      "L4-L5 disc bulge indenting the thecal sac. No significant spinal canal stenosis.",
      "L4-L5 disc bulge without significant spinal canal stenosis.",
    ],
    [
      "gallstones with a clear duct — the commonest MRCP result there is",
      "The common bile duct measures 5 mm and is normal in calibre. No filling defect to suggest a ductal stone. " +
        "The gallbladder contains multiple stones without wall thickening.",
      "No MRCP evidence of a common bile duct stone or biliary obstruction. Cholelithiasis without cholecystitis.",
    ],
    [
      "an acuity difference is two facts, not a disagreement about one",
      "No acute infarct. Chronic lacunar infarct in the left basal ganglion.",
      "Chronic lacunar infarct. No acute territorial infarction.",
    ],
    [
      "an Impression may summarise the worst of several described levels",
      "Disc bulge at L3-L4 and L4-L5. Mild facet arthropathy.",
      "L4-L5 disc bulge.",
    ],
    [
      "the same finding asserted in both sections",
      "Chronic lacunar infarct in the right basal ganglia.",
      "Old right basal ganglia infarct.",
    ],
    [
      "a denial qualified by a level the assertion does not share",
      "No nerve root compression at L3-L4.",
      "Thecal sac indentation at L4-L5.",
    ],
    [
      "two different abnormalities at two different single vertebrae",
      "Vertebral body sclerosis at T8.",
      "Vertebral body lytic lesion at L1.",
    ],
    [
      "chronic infarct with negative diffusion — DWI is negative in chronic stroke",
      "There is no restricted diffusion on the DWI sequence.",
      "Chronic lacunar infarct in the left basal ganglion.",
    ],
  ];
  for (const [name, findings, impression] of QUIET) {
    it(name, () => {
      expect(messages(findings, impression)).toEqual([]);
    });
  }
});

describe("Q119 — one section withdraws what the other still reports", () => {
  it("reads the Impression against the Findings as well as the other way round", () => {
    expect(ONE("The common bile duct contains a 9 mm calculus.", "No common bile duct stone is identified.")).toBe(
      'Findings/Impression contradiction: the Impression denies "stone" but the Findings report it.',
    );
  });

  it("needs the denial to be the whole of what that section says about the finding", () => {
    // The Findings both deny an acute bleed and assert a chronic one, so the
    // Impression's chronic collection agrees with something the Findings stand
    // behind. Only a section that says nothing but the denial is contradicted.
    expect(
      messages(
        "No acute intracranial haemorrhage. Chronic subdural collection on the left.",
        "Chronic left subdural collection.",
      ),
    ).toEqual([]);
  });

  it("is not a substring rule — both spellings of haemorrhage read as one fact", () => {
    expect(ruleIds("No intracranial hemorrhage.", "Acute intracranial haemorrhage in the right frontal lobe.")).toContain(
      "Q119",
    );
  });
});

describe("Q120 — the two sections place a finding at different levels", () => {
  it("sees the move when the finding changed name between the sections", () => {
    expect(
      ONE(
        "Disc bulge at L3-L4 without nerve root compression.",
        "Disc herniation at L4-L5 causing thecal sac indentation.",
      ),
    ).toBe(
      'Possible level mismatch: the Findings place "intervertebral disc" at L3-L4 but the Impression places it at L4-L5.',
    );
  });

  it("ignores a level the Findings withdrew", () => {
    // The corpus's lumbar wrong-level defect: L5-S1 IS named in the Findings, but
    // only inside "without disc herniation". A section-wide comparison of levels
    // agrees here and misses the move that decides which level gets operated on.
    expect(
      ruleIds(
        "L4-L5 disc extrusion with left L5 nerve root contact. Early desiccation change at L5-S1 without disc herniation.",
        "L5-S1 disc extrusion with left S1 nerve root contact.",
      ),
    ).toContain("Q120");
  });

  it("says one wrong level once, not once per finding it moved", () => {
    const moved = messages(
      "L4-L5 disc herniation with severe spinal canal stenosis and left L5 nerve root contact.",
      "L5-S1 disc herniation with severe spinal canal stenosis and left S1 nerve root contact.",
    );
    expect(moved.filter((m) => m.includes("level mismatch"))).toHaveLength(1);
  });
});

describe("Q121 — the two sections grade the same finding differently", () => {
  it("reports a re-graded stenosis", () => {
    expect(ONE("Mild central canal stenosis at L3-L4.", "Severe central canal stenosis at L3-L4.")).toBe(
      'Possible severity mismatch: the Findings grade "stenosis" as mild but the Impression grades it as severe.',
    );
  });

  it("is quiet where one grade is shared", () => {
    expect(
      messages(
        "Mild disc bulge at L3-L4. Severe spinal canal stenosis at L4-L5.",
        "Severe spinal canal stenosis at L4-L5.",
      ),
    ).toEqual([]);
  });
});

describe("Q122 / Q123 — two sentences that cancel each other out", () => {
  it("the basal ganglia cleared and bled into", () => {
    expect(ONE("The basal ganglia appear normal in signal.", "Acute haemorrhage in the left basal ganglia.")).toBe(
      "Possible contradiction: the basal ganglia are described as normal and as a haemorrhage.",
    );
  });

  it("diffusion denied and an acute infarct concluded", () => {
    expect(
      ONE("There is no restricted diffusion on the DWI sequence.", "Acute infarct in the right MCA territory."),
    ).toBe("Possible contradiction: the report denies restricted diffusion and also describes an acute infarct.");
  });

  it("reads the pair, not one section — a merge is what puts them together", () => {
    // Neither half alone is a contradiction; only Findings and Impression read
    // together are, which is why this rule lives in the shared contract.
    expect(messages("The basal ganglia appear normal in signal.", "")).toEqual([]);
    expect(messages("", "Acute haemorrhage in the left basal ganglia.")).toEqual([]);
  });
});

describe("the two shapes this contract deliberately leaves to another rule", () => {
  // Both are real defects and both are caught — by the rule that already owned
  // them. Recorded so that a later attempt to widen Q119 to anatomical sites
  // (which would mark up "no focal hepatic lesion" beside "hepatic steatosis", a
  // correct report) has to answer for the duplication it would create.
  const OWNED_ELSEWHERE: [string, TextReportInput, string][] = [
    [
      "a liver cleared of focal lesion beside a hepatic metastasis",
      report({
        findings: "The liver shows no focal lesion. Both kidneys are unremarkable. The spleen and pancreas are normal.",
        impression: ["Hepatic metastasis in segment VI."],
      }),
      "Q117",
    ],
    [
      "a suspicious mass downgraded to BI-RADS 2",
      report({
        findings:
          "A 12 mm spiculated hyperdense mass in the left upper outer quadrant with grouped microcalcification.",
        impression: ["Left BI-RADS category 2 — benign. Routine follow-up."],
      }),
      "Q116",
    ],
  ];
  for (const [name, input, owner] of OWNED_ELSEWHERE) {
    it(`${name} is ${owner}'s`, () => {
      expect(messages(input.findings, input.impression.join("\n"))).toEqual([]);
      expect(evaluateTextTier(input).findings.map((f) => f.ruleId)).toContain(owner);
    });
  }
});

describe("sectionsContradict", () => {
  it("agrees with the message list in both directions", () => {
    const contradicting: [string, string][] = [
      ["No significant spinal canal stenosis.", "Severe spinal canal stenosis at L4-L5."],
      ["Disc bulge at L4-L5.", "Disc bulge at L5-S1."],
      ["Mild central canal stenosis at L3-L4.", "Severe central canal stenosis at L3-L4."],
    ];
    for (const [f, i] of contradicting) {
      expect(sectionsContradict(f, i), `${f} / ${i}`).toBe(true);
      expect(findingsImpressionContradictions(f, i).length).toBeGreaterThan(0);
    }
    for (const [f, i] of [["L4-L5 disc bulge.", "L4-L5 disc bulge."], ["", ""]]) {
      expect(sectionsContradict(f, i), `${f} / ${i}`).toBe(false);
    }
  });

  it("does not invent a contradiction out of missing sections", () => {
    expect(messages("", "")).toEqual([]);
    expect(messages("Severe spinal canal stenosis at L4-L5.", "")).toEqual([]);
  });
});
