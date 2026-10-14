import { describe, it, expect } from "vitest";
import { RULE_CATALOG, runQualityEngine, toQualityReportDTO, type QualityContext } from "@workspace/report-quality";
import {
  composeFinalizeQualityGate,
  computeUnresolvedBlockers,
  describeFinalizeQualityStatus,
  isClinicalContradictionFinding,
  isHardBlockingFinding,
  stampEvaluationId,
  buildWorkspaceQualityRequest,
  type CanonicalQualityFinding,
  type FinalizeQualityGate,
  type QualityOverrideRow,
} from "./reportQualityFinalize";

describe("reportQualityFinalize", () => {
  it("only structured-tier blockers are hard blocking", () => {
    expect(isHardBlockingFinding({ ruleId: "a", severity: "blocker", tier: "structured", message: "x" })).toBe(true);
    expect(isHardBlockingFinding({ ruleId: "b", severity: "blocker", tier: "heuristic", message: "x" })).toBe(false);
    expect(isHardBlockingFinding({ ruleId: "c", severity: "warning", tier: "structured", message: "x" })).toBe(false);
  });

  it("computeUnresolvedBlockers respects override history by ruleId", () => {
    const findings: CanonicalQualityFinding[] = [
      { ruleId: "S1", severity: "blocker", tier: "structured", message: "blocked", evaluationId: 10 },
      { ruleId: "Q001", severity: "warning", tier: "heuristic", message: "warn" },
    ];
    const overrides: QualityOverrideRow[] = [
      { id: 1, evaluationId: 10, ruleId: "S1", reason: "clinically acceptable", action: "override" },
    ];
    expect(computeUnresolvedBlockers(findings, overrides)).toEqual([]);
    expect(computeUnresolvedBlockers(findings, [])).toHaveLength(1);
  });

  it("composeFinalizeQualityGate merges text + structured findings", () => {
    const gate = composeFinalizeQualityGate(
      {
        evaluationId: 1,
        shadowStructuredEvaluationId: 2,
        score: 80,
        blockingCount: 0,
        warningCount: 2,
        infoCount: 0,
        findings: [{ ruleId: "Q001", severity: "warning", tier: "heuristic", message: "missing findings" }],
      },
      [{ ruleId: "M1", severity: "blocker", tier: "structured", message: "measurement missing" }],
      [],
    );
    expect(gate.findings).toHaveLength(2);
    expect(gate.findings[0].evaluationId).toBe(1);
    expect(gate.findings[1].evaluationId).toBe(2);
    expect(gate.unresolvedBlockers).toHaveLength(1);
    expect(gate.advisoryFindings).toHaveLength(1);
  });

  it("buildWorkspaceQualityRequest maps workspace fields", () => {
    const req = buildWorkspaceQualityRequest({
      draftId: 42,
      modality: "MR",
      studyDescription: "MRI BRAIN",
      findings: "Normal",
      impression: "No acute abnormality",
      checklistPercent: 90,
    });
    expect(req.reportDraftId).toBe(42);
    expect(req.source).toBe("workspace-finalize");
    expect(req.text.impression).toEqual(["No acute abnormality"]);
    expect(req.text.checklistPercent).toBe(90);
  });

  it("sends patient sex and age, without which Q109/Q110 cannot fire", () => {
    const req = buildWorkspaceQualityRequest({
      draftId: 42,
      findings: "Prostate normal in size.",
      impression: "No abnormality.",
      sex: "F",
      age: "45 Yrs",
    });
    expect(req.text.sex).toBe("F");
    expect(req.text.age).toBe("45 Yrs");
  });

  it("sends a null sex/age rather than an empty string, so the rules stay notEvaluated", () => {
    const req = buildWorkspaceQualityRequest({
      draftId: 42,
      findings: "Prostate normal in size.",
      impression: "No abnormality.",
      sex: "   ",
      age: undefined,
    });
    expect(req.text.sex).toBeNull();
    expect(req.text.age).toBeNull();
  });

  it("splits the impression into one element per point so Q102 has a pair to compare", () => {
    // Previously the whole field went as ONE element, so the duplicate-
    // impression-line rule could never fire at sign-off.
    const req = buildWorkspaceQualityRequest({
      draftId: 42,
      findings: "Disc herniation at L4-L5.",
      impression: "Moderate canal stenosis.\n\nModerate canal stenosis.\nNo other abnormality.",
    });
    expect(req.text.impression).toEqual([
      "Moderate canal stenosis.",
      "Moderate canal stenosis.",
      "No other abnormality.",
    ]);
  });

  it("sends an empty impression array, not [\"\"], when the field is blank", () => {
    const req = buildWorkspaceQualityRequest({ draftId: 42, findings: "x", impression: "  \n  " });
    expect(req.text.impression).toEqual([]);
  });

  it("stampEvaluationId attaches parent evaluation id", () => {
    const stamped = stampEvaluationId([{ ruleId: "Q1", severity: "warning", message: "x" }], 99);
    expect(stamped[0].evaluationId).toBe(99);
  });
});

/**
 * C1-D — the sign dialog used to say the same thing about every report.
 *
 * Two badges described the quality gate, and neither could report a clinical
 * contradiction:
 *
 *   <Badge className="bg-emerald-600">Ready to sign</Badge>
 *   {qualityGate.warningCount > 0 && <Badge variant="secondary">{warningCount} advisory</Badge>}
 *
 * The green one was a CONSTANT. Every rule in the catalogue is
 * severity "warning" + tier "heuristic" by settled policy (rules/text/index.ts,
 * pinned by lib/report-quality/src/phase2.test.ts), so
 * `isHardBlockingFinding` is never true, `computeUnresolvedBlockers` always
 * returns [], and nothing reachable from the text tier could ever take that badge
 * off the screen. Measured: Findings "right frontal infarct" against Impression
 * "left frontal infarct" produced score 95, one Q104 finding, zero red-block
 * entries — and rendered green "Ready to sign" beside a grey "1 advisory".
 *
 * The grey one was worse than useless: `warningCount` counts severity, and since
 * every rule is severity "warning" it counted a laterality contradiction and a
 * missing recommendation identically. Three contradictions and four style gaps
 * read as "7 advisory".
 *
 * What replaces them is one badge derived from the same partition the lists below
 * it are rendered from, so the badge cannot describe a report the lists do not
 * show. It is display only: `isHardBlockingFinding`, `computeUnresolvedBlockers`
 * and the dialog's `canConfirm` are untouched, because promoting an advisory rule
 * to a signing blocker is the owner's clinical-policy decision
 * (ARCHITECTURE.md §8.1), not something a visibility fix gets to make.
 */

const heuristic = (ruleId: string, over: Partial<CanonicalQualityFinding> = {}): CanonicalQualityFinding => ({
  ruleId,
  severity: "warning",
  tier: "heuristic",
  message: `${ruleId} message`,
  ...over,
});

const structuredBlocker = (ruleId: string): CanonicalQualityFinding => ({
  ruleId,
  severity: "blocker",
  tier: "structured",
  message: `${ruleId} blocked`,
  evaluationId: 2,
});

/** Builds a gate the way composeFinalizeQualityGate would, from raw findings. */
function gateOf(findings: CanonicalQualityFinding[], overrides: QualityOverrideRow[] = []): FinalizeQualityGate {
  const structuredEvalId = findings.some((f) => f.tier === "structured") ? 2 : null;
  return {
    textEvaluationId: 1,
    structuredEvaluationId: structuredEvalId,
    score: 95,
    blockingCount: findings.filter((f) => f.severity === "blocker").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    findings,
    unresolvedBlockers: computeUnresolvedBlockers(findings, overrides),
    advisoryFindings: findings.filter((f) => !isHardBlockingFinding(f)),
    overrides,
  };
}

const overrideFor = (ruleId: string): QualityOverrideRow => ({
  id: 1,
  evaluationId: 2,
  ruleId,
  reason: "clinically acceptable",
  action: "override",
});

describe("isClinicalContradictionFinding — a clinical fact, or the report's prose", () => {
  it("reads the catalogue for a rule the catalogue knows", () => {
    // Q104 laterality: the Impression names a side the Findings do not.
    expect(isClinicalContradictionFinding(heuristic("Q104"))).toBe(true);
    // Q119: one section withdraws a finding the other still reports.
    expect(isClinicalContradictionFinding(heuristic("Q119"))).toBe(true);
    // Q120/Q121: the two sections disagree on the level, or on the grade.
    expect(isClinicalContradictionFinding(heuristic("Q120"))).toBe(true);
    expect(isClinicalContradictionFinding(heuristic("Q121"))).toBe(true);
    // Q001: the Findings section is empty. A gap in the prose, not a contradiction.
    expect(isClinicalContradictionFinding(heuristic("Q001"))).toBe(false);
    // Q005: no recommendation given. §9 forbids forcing one into every report,
    // so this must never be badged as a clinical contradiction.
    expect(isClinicalContradictionFinding(heuristic("Q005"))).toBe(false);
  });

  it("is the axis `category` cannot be — Q115 and Q119 are both category consistency", () => {
    // Q115 is "repeated word — likely dictation". Q119 is "one section withdraws a
    // finding the other still reports". A classification built on `category` would
    // have had to put a dictation artefact in the same box as a withdrawn finding,
    // which is why the catalogue carries `significance` instead.
    expect(RULE_CATALOG.Q115.category).toBe(RULE_CATALOG.Q119.category);
    expect(isClinicalContradictionFinding(heuristic("Q115"))).toBe(false);
    expect(isClinicalContradictionFinding(heuristic("Q119"))).toBe(true);
  });

  it("is not the axis `severity` can be — every catalogue rule is severity warning", () => {
    for (const entry of Object.values(RULE_CATALOG)) {
      expect(entry.defaultSeverity).toBe("warning");
    }
    // So two findings with identical severity and tier land on opposite sides.
    const [a, b] = [heuristic("Q104"), heuristic("Q115")];
    expect(a.severity).toBe(b.severity);
    expect(a.tier).toBe(b.tier);
    expect(isClinicalContradictionFinding(a)).not.toBe(isClinicalContradictionFinding(b));
  });

  it("treats a rule it does not know as needing review, never as prose", () => {
    // Structured-tier ids (care.structured.*) are deliberately not in the text
    // catalogue. An unknown id means nobody declared its significance, and the
    // only honest reading of an undeclared finding is that it is not PROVEN to be
    // prose — so it is surfaced rather than folded into the quiet group.
    expect(isClinicalContradictionFinding(structuredBlocker("care.structured.consistency.study-modality.mr"))).toBe(true);
    // An unknown id that declares itself heuristic is prose by its own account.
    expect(isClinicalContradictionFinding({ ruleId: "Q999", severity: "warning", tier: "heuristic", message: "x" })).toBe(false);
    // No tier at all is not "heuristic".
    expect(isClinicalContradictionFinding({ ruleId: "Q999", severity: "warning", message: "x" })).toBe(true);
  });
});

describe("describeFinalizeQualityStatus — one badge, and the lists it was counted from", () => {
  it("still says Ready to sign for a report with nothing in it", () => {
    // §1: preserve existing correct behaviour. The green badge was right about a
    // clean report; it was wrong about every other one.
    const s = describeFinalizeQualityStatus(gateOf([]));
    expect(s.kind).toBe("clear");
    expect(s.label).toBe("Ready to sign");
    expect(s.tone).toBe("positive");
  });

  it("counts prose gaps as advisories, one and many", () => {
    expect(describeFinalizeQualityStatus(gateOf([heuristic("Q001")]))).toMatchObject({
      kind: "advisory",
      tone: "neutral",
      label: "1 advisory",
    });
    const s = describeFinalizeQualityStatus(gateOf([heuristic("Q001"), heuristic("Q005"), heuristic("Q115")]));
    expect(s.kind).toBe("advisory");
    expect(s.label).toBe("3 advisories");
    expect(s.advisory.map((f) => f.ruleId)).toEqual(["Q001", "Q005", "Q115"]);
  });

  it("names a contradiction as one, and does not let a style gap dilute it", () => {
    const one = describeFinalizeQualityStatus(gateOf([heuristic("Q104")]));
    expect(one.kind).toBe("contradiction");
    expect(one.tone).toBe("caution");
    expect(one.label).toBe("1 clinical contradiction — review");

    // The old badge read "4 advisory" here: one wrong side and three style gaps,
    // indistinguishable. Now the contradiction names the badge and the prose gaps
    // are listed under it, still counted, still not blocking.
    const mixed = describeFinalizeQualityStatus(
      gateOf([heuristic("Q001"), heuristic("Q104"), heuristic("Q005"), heuristic("Q115")]),
    );
    expect(mixed.kind).toBe("contradiction");
    expect(mixed.label).toBe("1 clinical contradiction — review");
    expect(mixed.clinical.map((f) => f.ruleId)).toEqual(["Q104"]);
    expect(mixed.advisory.map((f) => f.ruleId)).toEqual(["Q001", "Q005", "Q115"]);
  });

  it("pluralises the contradiction count", () => {
    const s = describeFinalizeQualityStatus(gateOf([heuristic("Q104"), heuristic("Q120"), heuristic("Q121")]));
    expect(s.label).toBe("3 clinical contradictions — review");
  });

  it("puts an unresolved blocker above everything, and appends a contradiction rather than hiding it", () => {
    const blockerOnly = describeFinalizeQualityStatus(gateOf([structuredBlocker("care.structured.x")]));
    expect(blockerOnly.kind).toBe("unresolved");
    expect(blockerOnly.tone).toBe("alert");
    expect(blockerOnly.label).toBe("1 unresolved blocker");

    // Precedence names the badge, but a contradiction sitting beside a blocker
    // must not vanish from it.
    const both = describeFinalizeQualityStatus(
      gateOf([structuredBlocker("care.structured.x"), heuristic("Q104")]),
    );
    expect(both.kind).toBe("unresolved");
    expect(both.label).toBe("1 unresolved blocker · 1 contradiction");
    expect(both.clinical.map((f) => f.ruleId)).toEqual(["Q104"]);
  });

  it("treats an overridden finding as dispositioned, not as still asking for review", () => {
    // An override is a named radiologist's recorded decision about this rule for
    // this evaluation. Re-badging it as a contradiction would re-nag a decision
    // that was already made and attributed.
    const s = describeFinalizeQualityStatus(
      gateOf([structuredBlocker("care.structured.x")], [overrideFor("care.structured.x")]),
    );
    expect(s.unresolved).toEqual([]);
    expect(s.kind).not.toBe("unresolved");
    expect(s.advisory.map((f) => f.ruleId)).toEqual(["care.structured.x"]);
  });

  it("partitions every finding into exactly one group, so the badge and the lists cannot disagree", () => {
    const findings = [
      heuristic("Q001"),
      heuristic("Q104"),
      heuristic("Q119"),
      structuredBlocker("care.structured.x"),
      structuredBlocker("care.structured.y"),
    ];
    const s = describeFinalizeQualityStatus(gateOf(findings, [overrideFor("care.structured.y")]));
    const listed = [...s.clinical, ...s.advisory, ...s.unresolved];
    expect(listed).toHaveLength(findings.length);
    // Identity, not rule id: the same rule id can arrive from both tiers.
    for (const f of findings) expect(listed.filter((g) => g === f)).toHaveLength(1);
  });

  it("counts an info-severity finding it lists, which the old severity filter would not have", () => {
    // The dialog filtered its advisory list to severity warning|blocker while the
    // badge counted all of them, so an "info" finding would have been badged and
    // never shown. Nothing emits "info" today (phase2.test.ts pins every catalogue
    // rule to "warning"); this is the guard against it starting.
    const s = describeFinalizeQualityStatus(gateOf([heuristic("Q001", { severity: "info" })]));
    expect(s.label).toBe("1 advisory");
    expect(s.advisory).toHaveLength(1);
  });
});

describe("C1-D end to end — the three reports the brief names reach signing as contradictions", () => {
  /** Runs the REAL engine and the REAL gate composition, not a hand-built gate. */
  function gateFromEngine(text: Partial<QualityContext["text"]>, modality: string, studyDescription: string) {
    const report = runQualityEngine({
      modality,
      studyDescription,
      text: { findings: "", impression: [], ...text } as QualityContext["text"],
    });
    const dto = toQualityReportDTO(report, { source: "workspace-finalize" });
    return composeFinalizeQualityGate(
      {
        evaluationId: 1,
        shadowStructuredEvaluationId: null,
        score: dto.score,
        blockingCount: dto.blockingCount,
        warningCount: dto.warningCount,
        infoCount: dto.infoCount,
        findings: dto.findings as unknown as CanonicalQualityFinding[],
      },
      [],
      [],
    );
  }

  // Each of these measured score=95, blockingCount=0, warningCount=1 and
  // unresolvedBlockers=[] on the branch, i.e. exactly the shape the constant green
  // badge was written for. One clinical finding each: Q104, Q120, Q121.
  const WORKED_EXAMPLES: Array<[string, QualityContext["text"], string]> = [
    [
      "laterality moved between the sections",
      {
        findings: "Acute infarct in the right frontal lobe. No haemorrhage.",
        impression: ["Acute left frontal lobe infarct."],
        technique: "MRI brain with DWI and ADC sequences.",
        clinicalHistory: "Sudden onset weakness.",
        recommendation: "Correlate clinically.",
      },
      "Q104",
    ],
    [
      "the spinal level moved between the sections",
      {
        findings: "Disc bulge at L4-L5. No significant spinal canal stenosis.",
        impression: ["Disc bulge at L5-S1."],
        technique: "MRI lumbar spine, T1 and T2 sagittal and axial sequences.",
        clinicalHistory: "Low back pain.",
        recommendation: "Conservative management.",
      },
      "Q120",
    ],
    [
      "the severity grade moved between the sections",
      {
        findings: "Mild central canal stenosis at L3-L4.",
        impression: ["Severe central canal stenosis at L3-L4."],
        technique: "MRI lumbar spine, T1 and T2 sagittal and axial sequences.",
        clinicalHistory: "Low back pain.",
        recommendation: "Surgical opinion.",
      },
      "Q121",
    ],
  ];

  for (const [name, text, expectedRule] of WORKED_EXAMPLES) {
    it(`${name} → the badge is a contradiction, not "Ready to sign"`, () => {
      const gate = gateFromEngine(text, "MR", /spine/i.test(text.technique ?? "") ? "MRI Lumbar Spine" : "MRI Brain");
      const s = describeFinalizeQualityStatus(gate);
      expect(s.clinical.map((f) => f.ruleId)).toContain(expectedRule);
      expect(s.kind).toBe("contradiction");
      expect(s.label).not.toBe("Ready to sign");
      expect(s.tone).toBe("caution");
      // Still not a gate. The classification describes; it does not refuse.
      expect(gate.unresolvedBlockers).toEqual([]);
      expect(s.unresolved).toEqual([]);
    });
  }

  it("a report with only a missing recommendation is NOT called a contradiction", () => {
    // The control. Q005 ("No recommendation/advice given") fires on this report.
    // §9: do not force a recommendation into every report — so a gap in the prose
    // must never be badged in the same colour as a wrong side. Measured: clinical
    // is empty and the badge reads "1 advisory".
    const gate = gateFromEngine(
      {
        findings: "No acute intracranial abnormality. No haemorrhage or infarct.",
        impression: ["No acute intracranial abnormality."],
        technique: "MRI brain with DWI and ADC sequences.",
        clinicalHistory: "Headache.",
        recommendation: "",
      },
      "MR",
      "MRI Brain",
    );
    const s = describeFinalizeQualityStatus(gate);
    expect(s.clinical).toEqual([]);
    expect(s.kind).not.toBe("contradiction");
    expect(s.label).toBe("1 advisory");
    expect(s.advisory.map((f) => f.ruleId)).toEqual(["Q005"]);
  });
});
