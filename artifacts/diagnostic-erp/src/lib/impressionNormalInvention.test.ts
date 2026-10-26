/**
 * P0-1a from the 20-case rendered audit (2026-10-26) — the Impression button
 * wrote a whole-report normal onto a critical study.
 *
 * Mechanism, measured on main by the audit's D3 case (spondylodiscitis +
 * epidural collection + cord compression printing "No significant abnormality
 * detected."): both PRESSED surfaces — `refreshImpressionFromLedger` with no
 * `automatic` flag and its read-only twin `previewImpressionFromLedger` —
 * derive their candidate lines from `unexplainedFindingLines`, which is by
 * construction the residue nobody owns: every abnormal sentence a patch
 * explains has just been subtracted. When that residue happens to read normal,
 * `generateLocalImpression` takes its all-normal branch and INVENTS
 * "No significant abnormality detected." — an assertion of normality with no
 * attributable owner, arriving under a Conclusion whose own Findings assert
 * the opposite. The automatic arm already refuses this invention
 * (`cuedAbnormalSentences` has no all-normal branch, and its doc comment is
 * the ruling: a whole-report normal needs an owner). The pressed arm and the
 * preview are the two doors the ruling never reached.
 *
 * The guard is the one the whole-report doors already share:
 * `reportAssertsAbnormality` — true when the ledger owns an impressionworthy
 * abnormal OR any Findings/Impression sentence positively states one. When it
 * answers true, the invented normal must not be written; when it answers
 * false (a genuinely normal report), the invention is the correct conclusion
 * and must keep flowing.
 *
 * Environment honesty: store boundary only (no browser in this container),
 * same controlled-synthetic harness as quickSelectRetirementPreview.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";

const STUDY = "syn-impression-invention-1";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();

const WHOLE_REPORT_NORMAL = "No significant abnormality detected.";

/** Unowned normal prose — nothing in the ledger speaks for these lines. */
const UNOWNED_NORMAL_PROSE = [
  "Vertebral body heights and marrow signal intensities are maintained.",
  "No focal marrow infiltrative process is seen.",
].join("\n");

const cervicalCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Cervical Spine Plain", regions: ["Cervical Spine"], source: "auto",
});

function openSyntheticStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: cervicalCtx(),
    studies: [{
      id: STUDY,
      patient: { name: "SYNTHETIC PATIENT", sex: "M" },
      modality: "MR",
    }],
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

/** True when the Impression carries the invented whole-report normal. */
function impressionHasInventedNormal(): boolean {
  return splitToSentences(S().impressionText)
    .some((s) => normalizeForDedupe(s) === normalizeForDedupe(WHOLE_REPORT_NORMAL));
}

/**
 * The D3 shape, minimally: a clicked box whose concept the registry does not
 * flag and whose tile authors no impression sentence (Facet arthropathy,
 * cervical strip) owns the abnormal Findings line; the rest of the Findings is
 * unowned normal residue. `reportAssertsAbnormality` answers true on exactly
 * this state via the Findings sentence arm — the same arm D3 travelled.
 */
function openAbnormalResidueStudy() {
  openSyntheticStudy();
  useWorkspace.setState({
    findingsText: UNOWNED_NORMAL_PROSE,
    impressionText: "",
  } as never);
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy"), "findings"));
  if (outcome !== "applied") throw new Error(`Facet arthropathy click was ${outcome}`);
}

/** The control: the same residue with no abnormality anywhere. */
function openNormalResidueStudy() {
  openSyntheticStudy();
  useWorkspace.setState({
    findingsText: UNOWNED_NORMAL_PROSE,
    impressionText: "",
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("pressed impression paths may not invent a whole-report normal over an abnormal report", () => {
  it("the abnormal-residue state really asserts abnormality (harness control)", () => {
    openAbnormalResidueStudy();
    expect(S().findingsText).toContain("facet joint arthropathy");
    expect(S().appliedPathologyPatches.length).toBeGreaterThan(0);
  });

  it("previewImpressionFromLedger must not propose the invented normal when the report asserts abnormality", () => {
    openAbnormalResidueStudy();
    const { next, refused } = S().previewImpressionFromLedger();
    expect(refused).toBeNull();
    expect(
      splitToSentences(next).some((s) => normalizeForDedupe(s) === normalizeForDedupe(WHOLE_REPORT_NORMAL)),
      `preview proposed "${WHOLE_REPORT_NORMAL}" under:\n${next}`,
    ).toBe(false);
  });

  it("previewImpressionFromLedger still proposes the normal for a genuinely normal report", () => {
    openNormalResidueStudy();
    const { next } = S().previewImpressionFromLedger();
    expect(next.trim()).toContain(WHOLE_REPORT_NORMAL);
  });

  it("a pressed refresh must not write the invented normal when the report asserts abnormality", () => {
    openAbnormalResidueStudy();
    S().refreshImpressionFromLedger();
    expect(impressionHasInventedNormal()).toBe(false);
  });

  it("a pressed refresh still writes the normal for a genuinely normal report", () => {
    openNormalResidueStudy();
    S().refreshImpressionFromLedger();
    expect(impressionHasInventedNormal()).toBe(true);
  });

  it("a pressed refresh that refuses the normal rebuilds the Conclusion to what the ledger owns — even to nothing (A5 ruling)", () => {
    openAbnormalResidueStudy();
    // A Conclusion the machine wrote earlier (the composed normal), with no
    // manual contribution: the pressed refresh is the radiologist's command to
    // rebuild from the ledger (the A5 ruling in instantReport.test.ts), and the
    // ledger owns no conclusion for the facet arthropathy — so the press must
    // NOT keep the stale machine normal, and must NOT replace it with the
    // invented whole-report normal either. The Conclusion rebuilds to nothing,
    // which is what forces the radiologist to write one.
    useWorkspace.setState({ impressionText: "Normal MRI of the cervical spine." } as never);
    S().refreshImpressionFromLedger();
    expect(impressionHasInventedNormal()).toBe(false);
    expect(S().impressionText.trim()).toBe("");
  });
});
