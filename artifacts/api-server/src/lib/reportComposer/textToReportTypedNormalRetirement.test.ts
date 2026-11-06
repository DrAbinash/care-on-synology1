/**
 * Normal replacement, the composer half: an abnormality the radiologist typed (not
 * clicked) retires from the composed report ONLY the normal sentences it contradicts.
 *
 * Three ways get text onto CARE's page and only two of them declare what they replace:
 *
 *   a Quick Select box carries `baselineReplaces`, and `retireDeclaredBaselines` applies
 *   it to the drafted prose (`composerGroundingAndBaselineRetirement.test.ts`);
 *   a committed Voice plan carries `removeConflictingBaselineConcepts`, and the workspace
 *   applies it before the ledger is written;
 *   typed prose carries nothing. The sentence is in `snapshot.findings` and behind it the
 *   examination's whole normal template is still live, so the contradiction reaches the
 *   model as INPUT and the drafted answer can carry both statements.
 *
 * PR #1257 established which of those sentences are scaffolding rather than clinical
 * truth (`isProvisionalNormalTemplate`, `scaffoldSentenceSet`), so the composer boundary
 * now has the data to do the bookkeeping itself instead of asking a 14B local model to do
 * it. This is the same retirement `baselineReplaces` already drives, with the same limits
 * — whole normalized sentence, `FULL_REPORT` only, never a hand-typed sentence — and the
 * same refusal to guess:
 *
 *   the abnormality must be the RADIOLOGIST's. A draft that invented the word cannot
 *   retire a denial he supplied, so the DRAFT's prose is not read here at all.
 *   a denial is not an abnormality. "No extra-axial collection is identified." in his own
 *     Findings does not retire the template's denial of the same thing (the self-pairing
 *     the contradiction validators are known for).
 *   a level or a side that does not match is not a contradiction. An L4-L5 herniation
 *     leaves "L5-S1: No significant disc bulge or protrusion is seen." where it is, and a
 *     sentence that names no level at all leaves every level's normal alone.
 *   an inference is not a contradiction. "Restricted diffusion … low ADC" retires the
 *     DWI denial, and does NOT retire "No acute infarct is seen.": an old infarct does not
 *     restrict and restricted diffusion is deliberately not an alias of infarction
 *     (`contentPacks.ts`, the `infarct` concept), so the diagnosis stays his to make.
 *
 * What it cannot judge, it says: a retirement the fences refused to apply stays in the
 * report and is reported by name, which is `unresolvedBaselineContradictions`.
 *
 * The two sentences no shipped template contains — a side-named denial — are added as
 * scaffold rows by hand (`scaffoldRows`), because the fence has to be measured on the
 * scaffold or it is not the fence being tested. Every other sentence here is the live
 * template's own, mirrored from `mriBrainStandardNormal.ts` and the LS spine block.
 *
 * Synthetic content, no patient, no model, no database.
 */
import { describe, expect, it } from "vitest";
import { parseComposerSnapshot, type ComposerInputSnapshot, type ComposeObservation } from "./types";
import { retireDeclaredBaselines, unresolvedBaselineContradictions } from "./baselineRetirement";
import {
  brainStudy,
  draft,
  lsStudy,
  type TextToReportStudy,
} from "../../testSupport/textToReportCases";

const DWI_FINDING =
  "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";

const DWI_NORMAL = "No restricted diffusion is seen on DWI/ADC.";
const INFARCT_NORMAL = "No acute infarct is seen.";
const BRAINSTEM_NORMAL = "Brainstem shows normal morphology and signal intensity.";
const L5S1_DISC_NORMAL = "L5-S1: No significant disc bulge or protrusion is seen.";
const L4L5_DISC_NORMAL = "L4-L5: No significant disc bulge or protrusion is seen.";

/**
 * The examination's own normal template, plus any scaffold sentence this case needs that
 * the shipped templates do not contain. `source`/`role` are set the way PR #1257 sets
 * them, so `isProvisionalNormalTemplate` sees a template row and nothing else.
 */
function scaffoldRows(
  base: TextToReportStudy,
  extra: Array<[string, string]>,
): ComposerInputSnapshot {
  const rows: ComposeObservation[] = extra.map(([concept, findingsText]) => ({
    id: `baseline:synth:${concept}`,
    concept,
    source: "normal-template",
    role: "baseline",
    findingsText,
  }));
  return parseComposerSnapshot({ ...base, observations: [...base.observations, ...rows] });
}

/** The template rows plus the radiologist's dictation, with `findings` as the field text. */
function studyOf(
  base: TextToReportStudy,
  findings: string,
  extra: Array<[string, string]> = [],
  provenance?: ComposerInputSnapshot["fieldProvenanceSummary"],
): ComposerInputSnapshot {
  const snapshot = scaffoldRows({ ...base, findings }, extra);
  return provenance ? { ...snapshot, fieldProvenanceSummary: provenance } : snapshot;
}

function brain(
  findings: string,
  extra: Array<[string, string]> = [],
  provenance?: ComposerInputSnapshot["fieldProvenanceSummary"],
) {
  return studyOf(brainStudy([], { withScaffold: true }), findings, extra, provenance);
}

function lumbar(findings: string) {
  return studyOf(lsStudy([]), findings);
}

/** Compose the draft that carries the input's own prose, then retire from it. */
function retireFindings(snapshot: ComposerInputSnapshot, kind = "FULL_REPORT") {
  return retireDeclaredBaselines(
    draft({ findings: snapshot.findings, impression: snapshot.impression }),
    snapshot,
    kind,
  ).findings;
}

describe("a typed abnormality retires the normals it contradicts, and no others", () => {
  it("control: with nothing typed, the drafted normals all survive", () => {
    const only = `${DWI_NORMAL} ${INFARCT_NORMAL} ${BRAINSTEM_NORMAL}`;
    const retired = retireFindings(brain(only));
    expect(retired).toContain(DWI_NORMAL);
    expect(retired).toContain(INFARCT_NORMAL);
    expect(retired).toContain(BRAINSTEM_NORMAL);
  });

  it("retires the DWI denial the typed sentence names, and keeps unrelated anatomy", () => {
    const retired = retireFindings(brain(`${DWI_NORMAL} ${INFARCT_NORMAL} ${BRAINSTEM_NORMAL} ${DWI_FINDING}`));
    expect(retired, "the contradicted normal must not be composed into the report")
      .not.toContain(DWI_NORMAL);
    // …and the retirement stops there: none of these is contradicted by what he typed.
    expect(retired).toContain(INFARCT_NORMAL);
    expect(retired).toContain(BRAINSTEM_NORMAL);
  });

  it("retires the infarct denial when he supplies the diagnosis himself", () => {
    const typed = "Acute infarction in the right basal ganglia with restricted diffusion.";
    const retired = retireFindings(brain(`${INFARCT_NORMAL} ${DWI_NORMAL} ${typed}`));
    expect(retired).not.toContain(INFARCT_NORMAL);
    // "restricted diffusion" is in his own sentence, so the DWI denial is contradicted too.
    expect(retired).not.toContain(DWI_NORMAL);
  });

  it("a chronic infarct does not retire the denial of an acute one", () => {
    const typed = "Chronic infarct in the left middle cerebral artery territory, encephalomalacia and gliosis.";
    const retired = retireFindings(brain(`${INFARCT_NORMAL} ${typed}`));
    expect(retired, "an old infarct is exactly what “No ACUTE infarct is seen.” is compatible with")
      .toContain(INFARCT_NORMAL);
  });

  it("his own denial is not an abnormality: the template is not retired by a matching negative", () => {
    const typed = "No restricted diffusion is seen on DWI or ADC sequences.";
    const retired = retireFindings(brain(`${DWI_NORMAL} ${typed}`));
    expect(retired, "two denials of one thing are a report agreeing with itself, not a contradiction")
      .toContain(DWI_NORMAL);
  });

  it("an L4-L5 disc finding retires that level's normal and leaves the level it says nothing about", () => {
    // The shipped spine normal reads "L4-L5: No significant disc bulge or protrusion is
    // seen." — the level comes first and the denial cue second, which is the shape a
    // head-anchored denial test misses entirely.
    const typed = "L4-L5: Disc bulge with protrusion contacting the traversing L5 nerve root.";
    const retired = retireFindings(lumbar(`${L5S1_DISC_NORMAL} ${L4L5_DISC_NORMAL} ${typed}`));
    expect(retired, "the same words at the same level are a contradiction").not.toContain(L4L5_DISC_NORMAL);
    expect(retired, "an L4-L5 protrusion is not a statement about L5-S1").toContain(L5S1_DISC_NORMAL);
  });

  it("a finding that names no level retires no level's normal", () => {
    // The refusal the level fence exists for. "Diffuse posterior disc bulge" is a real
    // sentence in this clinic's vocabulary and it says nothing about which level; taking
    // it as a statement about all five would delete five normals on one unlocalised word.
    const typed = "Diffuse posterior disc bulge with protrusion contacting the traversing nerve root.";
    const retired = retireFindings(lumbar(`${L5S1_DISC_NORMAL} ${L4L5_DISC_NORMAL} ${typed}`));
    expect(retired).toContain(L5S1_DISC_NORMAL);
    expect(retired).toContain(L4L5_DISC_NORMAL);
  });

  it("a finding on the other side leaves the side it says nothing about", () => {
    // One sentence, two template normals, opposite verdicts — the pair that shows the side
    // fence decides and does not merely over-retain. The scaffold's unlocalised denial is
    // answered by a collection on either side; the right-sided one is not answered by a
    // left frontal collection, and deleting it would put a normal out of the report that
    // the examination never contradicted.
    const RIGHT_NORMAL = "No right-sided extra-axial collection is identified.";
    const ANY_NORMAL = "No extra-axial collection is identified.";
    const typed = "Extra-axial collection over the left frontal convexity, 9 mm.";
    const retired = retireFindings(brain(`${ANY_NORMAL} ${RIGHT_NORMAL} ${typed}`, [["extra_axial_right", RIGHT_NORMAL]]));
    expect(retired, "a left collection is not a contradiction of a denial about the right")
      .toContain(RIGHT_NORMAL);
    expect(retired, "it is a contradiction of the denial that named no side")
      .not.toContain(ANY_NORMAL);
  });

  it("a bilateral finding does retire the side-named denial, because it includes that side", () => {
    // Why laterality is not a claim word: matched on content alone, this sentence never
    // contains the word "right", so the denial of the right side would survive a statement
    // that unambiguously contradicts it.
    const RIGHT_NORMAL = "No right-sided extra-axial collection is identified.";
    const typed = "Extra-axial collection is present bilaterally, on the right and the left.";
    const retired = retireFindings(brain(`${RIGHT_NORMAL} ${typed}`, [["extra_axial_right", RIGHT_NORMAL]]));
    expect(retired).not.toContain(RIGHT_NORMAL);
  });

  it("a sentence he typed himself is never taken, and is named instead", () => {
    const snapshot = brain(`${DWI_NORMAL} ${DWI_FINDING}`, [], {
      findings: { "no restricted diffusion is seen on dwi adc": ["manual"] },
    });
    const retired = retireFindings(snapshot);
    expect(retired, "his wording is his to keep, whatever a tile or a finding implies")
      .toContain(DWI_NORMAL);
    expect(unresolvedBaselineContradictions(
      draft({ findings: retired, impression: "" }), snapshot, "FULL_REPORT").join(" "))
      .toContain(DWI_NORMAL);
  });

  it("nothing is retired outside FULL_REPORT, where the task is to rewrite his prose", () => {
    const retired = retireFindings(brain(`${DWI_NORMAL} ${DWI_FINDING}`), "SELECTION_EDIT");
    expect(retired).toContain(DWI_NORMAL);
  });

  it("is idempotent: a second pass over the retired prose changes nothing", () => {
    const snapshot = brain(`${DWI_NORMAL} ${INFARCT_NORMAL} ${DWI_FINDING}`);
    const once = retireFindings(snapshot);
    expect(once).not.toContain(DWI_NORMAL);
    expect(retireFindings({ ...snapshot, findings: once })).toBe(once);
  });
});

describe("the draft's own words never drive a retirement", () => {
  it("a diagnosis the model synthesised does not delete the radiologist's denial", () => {
    // The licence to say "infarction" from DWI/ADC evidence is real (the KB §58 inference,
    // `supportedSynthesis.ts`), and the drafted Findings will contain the word. That word
    // came from CARE's model, not from the clinician, so it cannot be what retires the
    // sentence "No acute infarct is seen." out of his report.
    const snapshot = brain(`${INFARCT_NORMAL} ${DWI_FINDING}`);
    const drafted = `${INFARCT_NORMAL} Acute infarction in the right basal ganglia. ${DWI_FINDING}`;
    const retired = retireDeclaredBaselines(
      draft({ findings: drafted, impression: "" }),
      snapshot,
      "FULL_REPORT",
    ).findings;
    expect(retired).toContain(INFARCT_NORMAL);
    expect(retired).not.toContain(DWI_NORMAL);
  });
});

describe("provenance and reporting survive the derivation", () => {
  it("reports the derived contradiction in the words a clinician reads", () => {
    const snapshot = brain(`${DWI_NORMAL} ${DWI_FINDING}`);
    const warnings = unresolvedBaselineContradictions(
      draft({ findings: snapshot.findings, impression: "" }),
      snapshot,
      "FULL_REPORT",
    );
    expect(warnings.length, JSON.stringify(warnings)).toBe(1);
    expect(warnings[0]).toContain(DWI_NORMAL);
    expect(warnings[0]).not.toMatch(/baselineReplaces|observation|snapshot/i);
  });

  it("leaves an uncontradicted template entirely alone, normal study included", () => {
    const all = [
      "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
      INFARCT_NORMAL,
      "No intracranial hemorrhage is seen.",
      DWI_NORMAL,
      "No midline shift is seen.",
    ].join(" ");
    const snapshot = brain(all);
    expect(retireFindings(snapshot)).toBe(all);
    expect(unresolvedBaselineContradictions(
      draft({ findings: all, impression: "" }), snapshot, "FULL_REPORT")).toEqual([]);
  });
});
