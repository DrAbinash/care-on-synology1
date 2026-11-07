/**
 * Priority 2, owner's browser finding 2026-11-07: picking a DIFFERENT whole-report normal for
 * the SAME examination joined the two normals instead of replacing one with the other.
 *
 * The journey is the one the Format control offers, on the shipped catalogue: open an MRI Brain
 * on "MRI Brain — Standard Normal", then choose "MRI Brain — Epilepsy Protocol (Normal)" and
 * press Apply. Both rows are complete examinations — findings, conclusion, acquisition — for one
 * region, and the clinic authors four of them for Brain precisely because a referral asks for a
 * different protocol. Only one can be this patient's report.
 *
 * What the code does instead is decided by `confirmOverwriteAndApply`, which asks whether the
 * report asserts an abnormality and, on yes, MERGES the incoming normal underneath what is
 * already on the page. That rule exists for a real case — a clicked L4-L5 herniation must not be
 * buried under a normal Conclusion — but a report whose only content is the first normal is not
 * that case, and here the merge prints one examination as normal twice, in two different words,
 * with two acquisition statements above it.
 *
 * So the requirements are, in the owner's words: replace the previous normal baseline, preserve
 * genuine manual edits, and obtain explicit confirmation before a destructive replacement.
 * Replacement is computed from the superseded format's own prose, which is why a dictated or
 * typed sentence survives whichever way the question is answered — the same mechanism
 * `normalReplacement.ts` already uses for the widened-scope case, reached by a rule that covers
 * the second way one normal can stop being this report's normal.
 *
 * Store boundary, controlled synthetic data, no browser in this file: `data-report` names and
 * sentences come from the shipped catalogue so a fixture can never disagree with what the clinic
 * actually has.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { MRI_BRAIN_STANDARD_NORMAL_NAME } from "./zai-workspace/baselines/mriBrainStandardNormal";
import { MRI_BRAIN_EPILEPSY_NORMAL_NAME } from "./zai-workspace/baselines/mriBrainEpilepsyNormal";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";

const STUDY = "syn-normal-swap-1";
const S = () => useWorkspace.getState();

const format = (name: string) => {
  const found = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
  if (!found) throw new Error(`the shipped catalogue has no format named ${name}`);
  return found;
};

const brainCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI BRAIN", regions: ["Brain"], source: "auto",
});

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

function openBrainStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: brainCtx(),
    studies: [{ id: STUDY, patient: { name: "SYNTHETIC PATIENT", sex: "M" }, modality: "MR" }],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
}

/** The Apply button on the Format control, plus the answer to the confirmation it owes. */
function apply(name: string) {
  S().applyFormatById(format(name).id);
  if (S().confirmOverwriteOpen) S().confirmOverwriteAndApply();
  if (S().pendingNormalReplacement) S().confirmNormalReplacement();
  return S();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openBrainStudy();
});

describe("a second whole-report normal for the same examination replaces the first", () => {
  it("the catalogue really holds two complete normals for one region", () => {
    // The premise, not assumed: if either row stopped being a whole-report baseline this file
    // would be testing a case the clinic cannot reach.
    for (const name of [MRI_BRAIN_STANDARD_NORMAL_NAME, MRI_BRAIN_EPILEPSY_NORMAL_NAME]) {
      const f = format(name);
      expect(f.baselineManifest?.kind, name).toBe("care.full_report_baseline.v1");
      expect(f.findings.trim(), name).not.toBe("");
      expect(f.impression.trim(), name).not.toBe("");
    }
    expect(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).bodyPart)
      .toBe(format(MRI_BRAIN_STANDARD_NORMAL_NAME).bodyPart);
  });

  it("opening on the standard normal writes exactly that normal", () => {
    const after = apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    expect(lines(after.findingsText).length).toBeGreaterThan(3);
    expect(after.appliedFormatName).toBe(MRI_BRAIN_STANDARD_NORMAL_NAME);
  });

  it("applying the epilepsy-protocol normal leaves one normal, not two", () => {
    const first = apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const firstOnly = lines(first.findingsText)
      .filter((l) => !lines(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).findings ?? "").includes(l));
    expect(firstOnly.length, "the two rows must differ, or this measures nothing").toBeGreaterThan(0);

    const after = apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);

    for (const dropped of firstOnly) {
      expect(after.findingsText, `the superseded normal still says: ${dropped}`).not.toContain(dropped);
    }
    for (const kept of lines(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).findings ?? "")) {
      expect(after.findingsText, `the chosen normal did not arrive: ${kept}`).toContain(kept);
    }
    expect(after.findingsText.split("\n").filter(Boolean).length,
      `Findings: ${after.findingsText}`)
      .toBeLessThanOrEqual(lines(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).findings ?? "").length);
  });

  it("states the conclusion once", () => {
    apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const after = apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    const impression = after.impressionText.trim();
    expect(impression).not.toBe("");
    expect(impression, `Impression: ${impression}`)
      .not.toContain(format(MRI_BRAIN_STANDARD_NORMAL_NAME).impression.trim());
    expect(impression).toContain(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).impression.trim());
  });

  it("carries one acquisition statement, and stamps the format the report is now on", () => {
    apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const after = apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    expect(after.techniqueText.trim())
      .not.toContain(format(MRI_BRAIN_STANDARD_NORMAL_NAME).technique.trim().slice(0, 40));
    expect(after.appliedFormatName).toBe(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    expect(after.appliedFormatReportTitle).toBe(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).reportTitle ?? null);
  });

  it("asks before it takes the first normal away", () => {
    apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const held = {
      findings: S().findingsText,
      impression: S().impressionText,
      technique: S().techniqueText,
      format: S().appliedFormatName,
    };
    S().applyFormatById(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).id);

    const asked = S().confirmOverwriteOpen || !!S().pendingNormalReplacement;
    expect(asked, "a destructive replacement was performed with no question on the screen").toBe(true);
    expect(S().findingsText, "the press wrote before it asked").toBe(held.findings);
    expect(S().impressionText).toBe(held.impression);
    expect(S().techniqueText).toBe(held.technique);
    expect(S().appliedFormatName).toBe(held.format);
  });

  it("keeps every sentence the radiologist wrote himself", () => {
    const first = apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const dictated = "Clinic: three-month history of intermittent vertigo.";
    const typed = "Right hippocampal volume is mildly reduced on visual assessment.";
    S().setField("findings", `${first.findingsText}\n${dictated}\n${typed}`, { source: "manual" });
    S().setField("impression", `${first.impressionText}\n${typed}`, { source: "manual" });

    const after = apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    expect(after.findingsText).toContain(dictated);
    expect(after.findingsText).toContain(typed);
    expect(after.impressionText).toContain(typed);
  });

  it("applying the same format twice stays a no-op — no question, no duplicated section", () => {
    const once = apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    const findings = once.findingsText;
    S().applyFormatById(format(MRI_BRAIN_STANDARD_NORMAL_NAME).id);
    if (S().confirmOverwriteOpen) S().confirmOverwriteAndApply();
    if (S().pendingNormalReplacement) S().confirmNormalReplacement();
    expect(S().findingsText).toBe(findings);
    expect(S().appliedFormatName).toBe(MRI_BRAIN_STANDARD_NORMAL_NAME);
  });
});

/**
 * Where the append actually comes from, measured in the browser on the shipped page
 * (`tmp/bs2-p2-swap.cjs`, evidence `tmp/bs2-journey/p2-swap-5.txt`): the apply door replaces
 * correctly and stamps correctly — at t+0 the badge read "Applied: MRI Brain — Screening
 * Normal". 1.2 seconds later it read "Applied: MRI Brain — Standard Normal" again, with no
 * network call in between, and one press of Generate then put fifteen Standard sentences back
 * underneath the six Screening ones: one report, two complete normals. Ablating Mode A
 * (`localStorage "care.instantReport.modeA.enabled" = "0"`) makes both halves disappear, which
 * names the writer: the automatic whole-report pass resolves the region's default normal and
 * re-declares it as THIS report's baseline, over a choice the radiologist made one click ago.
 *
 * The identity, not the prose, is what the rest of the reporting engine reads
 * (`startingCanvasBaseline.formatRevision` keys the rows a later replacement retires), so a
 * restamp is not a cosmetic badge bug: it is the report forgetting which examination it is.
 */
describe("the report stays on the whole-report normal the radiologist chose", () => {
  const ctx = () => {
    const c = brainCtx();
    return { modality: c.modality, region: c.region, regions: c.regions, source: c.source, protocolName: c.protocolName, studyDescription: c.studyDescription };
  };

  it("an automatic pass does not move the report back onto the default normal", () => {
    apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    expect(S().appliedFormatName).toBe(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    const chosenLines = lines(S().findingsText);
    const standardOnly = lines(format(MRI_BRAIN_STANDARD_NORMAL_NAME).findings ?? "")
      .filter((l) => !chosenLines.includes(l)
        && !lines(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).findings ?? "").includes(l));
    expect(standardOnly.length, "the two rows share every sentence, so this measures nothing").toBeGreaterThan(0);

    const outcome = S().generateProfessionalReport(ctx() as never, {
      automatic: true, requireOwnedApprovedNormal: true,
    });

    expect(outcome.status, JSON.stringify(outcome)).not.toBe("refused");
    expect(S().appliedFormatName, "the automatic pass restamped the report").toBe(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    for (const line of standardOnly) {
      expect(S().findingsText, `the superseded normal returned: ${line}`).not.toContain(line);
    }
    expect(lines(S().findingsText).length, `Findings after the pass: ${S().findingsText}`)
      .toBe(chosenLines.length);
  });

  it("a press after the swap does not merge the superseded normal back in", () => {
    apply(MRI_BRAIN_STANDARD_NORMAL_NAME);
    apply(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    const chosenLines = lines(S().findingsText);
    const standardOnly = lines(format(MRI_BRAIN_STANDARD_NORMAL_NAME).findings ?? "")
      .filter((l) => !chosenLines.includes(l)
        && !lines(format(MRI_BRAIN_EPILEPSY_NORMAL_NAME).findings ?? "").includes(l));

    S().generateProfessionalReport(ctx() as never);

    expect(lines(S().findingsText).length, `Findings: ${S().findingsText}`).toBe(chosenLines.length);
    expect(S().appliedFormatName).toBe(MRI_BRAIN_EPILEPSY_NORMAL_NAME);
    for (const line of standardOnly) {
      expect(S().findingsText, `the superseded normal returned: ${line}`).not.toContain(line);
    }
  });
});
