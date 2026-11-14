/**
 * Item 1 (approved 13 Nov 2026) — a Technique change that contradicts the
 * Findings/Impression has to warn while he is reporting, not only in the
 * finalize dialog.
 *
 * The rule was never missing. `reportValidator.validateReport` has read the
 * study's contrast state out of the booked description AND the Technique line
 * since PR #1253, and the sign gauntlet calls it with the full context. The live
 * badge called the same function with two fields — `findings` and `impression` —
 * so every rule keyed on the examination was inert there by construction:
 * `studyContrastState(undefined, undefined)` is `"unknown"`, and `"unknown"` is
 * neither branch. The defect is the argument list, so the tests below are
 * argument-list tests as much as rule tests: each behaviour case is measured
 * TWICE, once with the shape the live call used to have and once with the shape
 * it has now, and the pair must differ. A test that only checked the new shape
 * would stay green if the fields were removed again, because the rule itself was
 * never broken.
 *
 * Deliberately NOT tested here: that the rule is correct radiology. That is
 * `lib/report-quality`'s own suite's job, and duplicating it would give two
 * verdicts on one vocabulary.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateReport } from "./reportValidator";
import { isImpressionContradictionWarning } from "./reportSectionCollapsePrefs";

/** Exactly what the live call passed before this fix — the two prose fields,
 *  and nothing the examination could be recognised in. */
function asReported(report: { findings: string; impression: string[] }): string[] {
  return validateReport({ findings: report.findings, impression: report.impression });
}

/** What it passes now: the same two fields plus the examination they describe. */
function asExamined(report: {
  findings: string;
  impression: string[];
  technique: string;
  studyDescription: string;
  modality: string;
}): string[] {
  return validateReport(report);
}

const ENHANCING = {
  findings: "There is an enhancing mass in the frontal lobe.",
  impression: ["Enhancing frontal mass."],
};

describe("the examination-context rules the live badge could not reach", () => {
  it("1. a plain study whose prose claims enhancement warns only once the Technique line is read", () => {
    const report = {
      ...ENHANCING,
      technique: "MRI brain performed without intravenous contrast.",
      studyDescription: "MRI BRAIN (PLAIN)",
      modality: "MR",
    };
    // The control: the old argument list says nothing at all about contrast.
    expect(asReported(report).filter((w) => /^Contrast contradiction:/.test(w))).toEqual([]);

    const now = asExamined(report).filter((w) => /^Contrast contradiction:/.test(w));
    expect(now).toHaveLength(1);
    expect(now[0]).toContain("without contrast");
    expect(now[0]).toContain("describes enhancement");
  });

  it("2. it is the Technique line that arms it, not only the booked title", () => {
    // This clinic's worklist writes "MRI CERVICAL SPINE (PLAIN)" and keeps the
    // contrast decision in the protocol sentence, which is why the rule reads
    // both fields. Title alone is enough for CONTRAST_STUDY to stay silent:
    const fromTitle = validateReport({
      ...ENHANCING,
      studyDescription: "MRI BRAIN (PLAIN)",
    });
    expect(fromTitle.some((w) => /^Contrast contradiction:/.test(w))).toBe(true);

    const fromTechnique = validateReport({
      ...ENHANCING,
      technique: "Axial T1, T2, FLAIR and DWI without contrast.",
    });
    expect(fromTechnique.some((w) => /^Contrast contradiction:/.test(w))).toBe(true);
  });

  it("3. an enhanced study is not a contradiction, so the badge stays quiet", () => {
    const warnings = asExamined({
      ...ENHANCING,
      technique: "MRI brain with gadolinium.",
      studyDescription: "MRI BRAIN WITH CONTRAST",
      modality: "MR",
    });
    expect(warnings.filter((w) => /^Contrast contradiction:/.test(w))).toEqual([]);
  });

  it("4. CT wording rules need the modality the live call never passed", () => {
    const report = {
      findings: "The lesion shows high signal intensity at the grey-white junction.",
      impression: ["Space-occupying lesion."],
      technique: "CT thorax, arterial phase.",
      studyDescription: "CT CHEST",
      modality: "CT",
    };
    expect(asReported(report).filter((w) => /^Modality terminology mismatch:/.test(w))).toEqual([]);

    const now = asExamined(report).filter((w) => /^Modality terminology mismatch:/.test(w));
    expect(now).toHaveLength(1);
    expect(now[0]).toContain("inside a CT report");
  });

  it("5. the side the study was booked on reaches the badge the same way", () => {
    const report = {
      findings: "The medial meniscus of the right knee shows a horizontal tear.",
      impression: ["Meniscal tear."],
      technique: "MRI knee, routine sequences.",
      studyDescription: "MRI LEFT KNEE",
      modality: "MR",
    };
    expect(asReported(report).filter((w) => /^Laterality contradiction:/.test(w))).toEqual([]);

    const now = asExamined(report).filter((w) => /^Laterality contradiction:/.test(w));
    expect(now).toHaveLength(1);
    expect(now[0]).toContain("LEFT");
    expect(now[0]).toContain("RIGHT");
  });

  it("6. every warning those rules add survives the banner's filter", () => {
    // The widened inputs must not merely produce strings — they have to produce
    // strings the existing filter lets through, or the fix is invisible. This is
    // the arrival leg, and it fails on its own if a message is reworded away
    // from `isImpressionContradictionWarning`'s vocabulary.
    const reports: Array<{ findings: string; impression: string[]; technique: string; studyDescription: string; modality: string }> = [
      { ...ENHANCING, technique: "MRI brain without contrast.", studyDescription: "MRI BRAIN", modality: "MR" },
      {
        findings: "High signal intensity lesion.",
        impression: ["Lesion."],
        technique: "CT head.",
        studyDescription: "CT HEAD",
        modality: "CT",
      },
      {
        findings: "Right knee medial meniscus tear.",
        impression: ["Meniscal tear."],
        technique: "MRI knee.",
        studyDescription: "MRI LEFT KNEE",
        modality: "MR",
      },
    ];
    for (const report of reports) {
      const added = asExamined(report).filter((w) => !asReported(report).includes(w));
      expect(added.length, `nothing new for ${report.studyDescription}`).toBeGreaterThan(0);
      for (const warning of added) {
        expect(isImpressionContradictionWarning(warning), warning).toBe(true);
      }
    }
  });

  it("7. supplying the examination changes nothing about the prose-only rules", () => {
    // No unrelated behaviour change: a Findings-vs-Impression contradiction is
    // the same warning before and after, so the only movement in the badge is
    // the three rules above.
    const report = {
      findings: "The gallbladder is normal. No calculus is seen in it.",
      impression: ["A 4 mm stone in the gallbladder."],
      technique: "US abdomen, grayscale, real-time.",
      studyDescription: "USG ABDOMEN",
      modality: "US",
    };
    const before = validateReport({ findings: report.findings, impression: report.impression });
    const withExam = validateReport(report);
    expect(before.some((w) => /^Findings\/Impression contradiction:/.test(w))).toBe(true);
    expect(withExam.filter((w) => !isExamContext(w))).toEqual(before);
  });
});

function isExamContext(w: string): boolean {
  return /^(?:Contrast contradiction|Modality terminology mismatch|Laterality contradiction):/.test(w);
}

describe("wired into the live badge", () => {
  // Normalized to \n before any slicing: the dependency-array pin below is
  // anchored at the end of a line, and an un-normalized checkout on Windows
  // would put a \r between the comma and the newline — a red test that has
  // nothing to do with the code it claims to read.
  const read = (rel: string) =>
    readFileSync(path.resolve(__dirname, rel), "utf8").replace(/\r\n/g, "\n");
  const UI = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
  const FINALIZE = read("../hooks/radiology-workspace/useStudyFinalize.ts");

  /** The `validateReport` spread inside `impressionContradictionWarnings`. */
  function liveCall(): { args: string; deps: string } {
    const at = UI.indexOf("    ...validateReport({");
    expect(at, "the live badge no longer calls validateReport").toBeGreaterThan(-1);
    const argsEnd = UI.indexOf("  ], [", at);
    expect(argsEnd, "the memo's argument list is unbounded").toBeGreaterThan(at);
    const depsEnd = UI.indexOf("  ]);", argsEnd);
    expect(depsEnd, "the memo's dependency array is unbounded").toBeGreaterThan(argsEnd);
    return { args: UI.slice(at, argsEnd), deps: UI.slice(argsEnd, depsEnd) };
  }

  it("8. the live validator is told what the examination was", () => {
    const { args } = liveCall();
    expect(args).toContain("technique: techniqueText");
    expect(args).toContain("studyDescription: reportIdentity?.studyDescription");
    expect(args).toContain("modality: reportIdentity?.modality");
  });

  it("9. every field it reads is in the dependency array, so the warning cannot go stale", () => {
    // A technique change must re-run the read. Missing deps are how a live badge
    // ends up reporting the previous protocol.
    const { deps } = liveCall();
    expect(deps).toContain("techniqueText");
    // An entry of the array, not the word anywhere inside it: the deps window
    // carries prose comments, and a `toContain("reportIdentity")` was satisfied
    // by one of them while the dependency itself had been deleted.
    expect(deps, "reportIdentity is not a dependency of the memo").toMatch(/\n\s+reportIdentity,$/m);
  });

  it("10. warn-only: the widened read writes nothing and refuses nothing", () => {
    const { args } = liveCall();
    expect(args).not.toContain("setState(");
    expect(args).not.toContain("setField(");
    expect(args).not.toContain("applySideToIncoming");
    expect(args).not.toContain("relateralizePatches");
    expect(args).not.toContain("return;");
    expect(args).not.toContain('variant: "destructive"');
  });

  it("11. the live badge and the sign gauntlet read the same three fields", () => {
    // The point of the fix is one report, one reading. If the gauntlet stops
    // passing them, the badge is ahead of the dialog and the parity breaks.
    const at = FINALIZE.indexOf("const textIssues = validateReport({");
    expect(at, "the sign gauntlet no longer calls validateReport").toBeGreaterThan(-1);
    const block = FINALIZE.slice(at, FINALIZE.indexOf("});", at));
    expect(block).toContain("technique: live.techniqueText");
    expect(block).toContain("studyDescription: openIdentity.studyDescription");
    expect(block).toContain("modality: openIdentity.modality");
  });

  it("11b. the two names the badge and the gauntlet use are one object", () => {
    // Tests 8 and 11 pin the two call sites to two different identifiers, which
    // only says "the same three fields" if those identifiers are the same value.
    // They are: `useStudyFinalize` is handed `reportIdentity` under the parameter
    // name `openIdentity`, and nothing else is passed for it. #1363 moved the
    // gauntlet onto that by-id read while the badge kept `workflow.currentRow`,
    // and the pair silently split — a study opened by link has no queue row, so
    // its badge read `null/null` (contrast, modality and laterality rules inert)
    // while its finalize dialog armed them.
    const at = UI.indexOf("    openIdentity: reportIdentity,");
    expect(at, "the gauntlet is no longer fed reportIdentity").toBeGreaterThan(-1);
    // Each site still must not consult the filtered queue row for these fields.
    expect(liveCall().args).not.toMatch(/(?:studyDescription|modality): workflow\.currentRow/);
  });

  it("12. the array it feeds is the one on the page", () => {
    const canvas = readFileSync(
      path.resolve(__dirname, "../components/radiology/workspace/ReportCanvas.tsx"),
      "utf8",
    );
    expect(canvas).toContain("warnings={impressionContradictionWarnings}");
    expect(canvas).toContain("impressionContradictionWarnings,");
  });
});
