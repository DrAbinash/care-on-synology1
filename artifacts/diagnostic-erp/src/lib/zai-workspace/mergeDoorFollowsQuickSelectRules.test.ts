/**
 * Clinical ruling 2 — "a second report format must use the same provenance-aware rules as
 * Quick Select."
 *
 * The two-format merge is reached from the format picker: Ctrl-click two templates, "Merge
 * & preview", review, Apply (`applySelectedFormats` → `confirmOverwriteAndApply` →
 * `mergeTwoFormats` → preview → `applyMergedResult`). It is the third door that opens a
 * whole report, beside the Quick Select click and the Full Normal Format apply, and it was
 * the one still writing from the two templates alone: it never read the report it was
 * merging into.
 *
 * Measured on the shipped catalogue before this, over a clicked L4-L5 herniation whose
 * conclusion was on the page, merging "MRI LS Spine — Normal" with "MRI Whole Spine —
 * Screening" —
 *   - wrote "Normal MRI lumbo-sacral spine." and DELETED his conclusion, while the same
 *     predicate (`reportAssertsAbnormality`) makes the Full Normal Format door withhold it;
 *   - deleted a sentence he had typed by hand from Findings, and deleted the Clinical
 *     History section he had typed, because all five fields were replaced;
 *   - re-stamped every surviving sentence as template-authored, which strips the manual
 *     protection off wording the merge never touched — the protection `patchField` gives a
 *     clicked box is keyed on that provenance;
 *   - marked his observation stale for prose that was still on the page, and the next
 *     ledger rebuild drops a stale row.
 *
 * The corrected door asks the same question the other two ask and uses the same shipped
 * answers: `reportAssertsAbnormality` for the contradiction, `mergeReportFieldContent` for
 * the additive merge that never removes existing text, `statesAbnormalImpressionText` (the
 * classifier the printed surfaces use to decide what to bold) for which merged conclusion
 * sentences may be contributed, and `deriveImpressionDependency` for whether a conclusion
 * is owed. No new vocabulary, no second composition engine.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { mergeTwoFormats, type MergeSentence } from "@/lib/zai-workspace/types";
import { withheldMergedImpression } from "@/lib/zai-workspace/mergeImpressionGuard";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";

const LS_NORMAL = formatNamed("MRI LS Spine — Normal");
const WHOLE_SCREEN = formatNamed("MRI Whole Spine — Screening");
const SLIP = formatNamed("MRI LS Spine — Spondylolisthesis (Grade I)");
const STANDARD_NORMAL = formatNamed("MRI LS Spine — Standard Normal");
const CERVICAL_NORMAL = formatNamed("MRI Cervical Spine — Normal");
const DISC = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;
const HIS_SENTENCE = "Clinical correlation with the L5 dermatome is advised.";
const HIS_CONCLUSION = "Moderate central canal stenosis at L4-L5.";

/** Named lookups, so a renamed or removed shipped format fails the test that cites it. */
function formatNamed(name: string) {
  const found = DEFAULT_REPORT_FORMATS.find((f) => f.name === name);
  if (!found) throw new Error(`the library no longer ships a format named ${name}`);
  return found;
}

function report() {
  const s = useWorkspace.getState();
  return { findings: s.findingsText, impression: s.impressionText, history: s.clinicalHistoryText };
}

function impressionLines() {
  return report().impression.split("\n").map((l) => l.trim()).filter(Boolean);
}

beforeEach(() => {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI LS Spine",
      regions: ["LS Spine"],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [],
    activeStudyId: "study-merge-rules",
    activeStudyInstanceUID: "1.2.840.MERGE.RULES",
    clinicalHistoryText: "",
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    impressionNeedsRefresh: false,
    impressionDependencyReasons: [],
    impressionBasis: null,
    isDirty: false,
    isFinalized: false,
    confirmOverwriteOpen: false,
    pendingFormatIds: [],
    pendingFormatOverwrite: null,
    pendingFormatRegion: null,
    pendingPathologyPatch: null,
    abnormalPatternConfirm: null,
    mergePreviewOpen: false,
    lastMergeResult: null,
    lastMergeFormats: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    voiceComposerObservations: [],
  } as never);
});

/** The radiologist's own clicked observation, through the shipped tile and the real door. */
function clickDiscHerniation() {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: DISC.sentence, impression: DISC.impressionSentence },
    templates: { findings: DISC.sentence, impression: DISC.impressionSentence },
    ownership: {
      anatomicalSection: DISC.anatomicalSection,
      conflictGroup: DISC.conflictGroup,
      baselineReplaces: DISC.baselineReplaces,
    },
    source: "quick-select",
    id: "qs-disc-l45",
    region: DISC.scopeBodyPart,
    label: DISC.label,
    findingsText: DISC.sentence,
  });
}

/** The real picker sequence, ending after Apply. Returns the preview it was armed with. */
function mergeTheFormats(formats: Array<typeof LS_NORMAL>) {
  for (const f of formats) useWorkspace.getState().toggleFormatSelection(f.id);
  useWorkspace.getState().applySelectedFormats();
  if (useWorkspace.getState().confirmOverwriteOpen) useWorkspace.getState().confirmOverwriteAndApply();
  const preview = useWorkspace.getState().lastMergeResult;
  expect(preview, "the picker must have armed a merge preview").not.toBeNull();
  useWorkspace.getState().applyMergedResult();
  return preview!;
}

describe("Ruling 2 · the merged second format answers to the report it joins", () => {
  it("withholds the merged whole-study normal over the conclusion he pressed onto the page", () => {
    clickDiscHerniation();
    const hisConclusion = report().impression;
    expect(hisConclusion, "the clicked box writes its approved conclusion").not.toBe("");

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    expect(impressionLines(), "his conclusion is still the Impression").toContain(hisConclusion);
    expect(
      impressionLines().some((l) => /normal mri/i.test(l)),
      `the merged normal must not land above it — got ${JSON.stringify(impressionLines())}`,
    ).toBe(false);
  });

  it("still writes what the second format genuinely adds: its own abnormal conclusion", () => {
    useWorkspace.getState().setField("impression", HIS_CONCLUSION, { source: "manual" });
    expect(report().impression).toBe(HIS_CONCLUSION);

    mergeTheFormats([LS_NORMAL, SLIP]);

    const lines = impressionLines();
    expect(
      lines.some((l) => /anterolisthesis of L5 over S1/i.test(l)),
      `the slip's conclusion should have been contributed — got ${JSON.stringify(lines)}`,
    ).toBe(true);
    expect(lines, "the line he wrote is not displaced").toContain(HIS_CONCLUSION);
    expect(
      lines.some((l) => /^normal mri/i.test(l)),
      "and the normal from the other format is still withheld",
    ).toBe(false);
  });

  it("keeps a sentence he typed by hand, and keeps his authorship on it", () => {
    useWorkspace.getState().setField("findings", HIS_SENTENCE, { source: "manual" });

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    expect(report().findings, "never silently delete manual text").toContain(HIS_SENTENCE);
    expect(
      useWorkspace.getState().fieldProvenance.findings[normalizeForDedupe(HIS_SENTENCE)],
      "and it is still his, so the next click has to ask before overwriting it",
    ).toContain("manual");
  });

  it("keeps Format A and Format B attribution on the merged prose", () => {
    useWorkspace.getState().setField("findings", HIS_SENTENCE, { source: "manual" });

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    const prov = useWorkspace.getState().fieldProvenance.findings;
    const sources = Object.values(prov).flat();
    expect(sources, "the editor still colours the two formats apart").toContain("template-a");
    expect(sources, "and the differential colour is not lost to a blanket re-stamp").toContain("template-b");
  });

  it("appends the merged clinical history instead of replacing what was there", () => {
    // Two formats that BOTH carry their own history line. The pair merged above has none,
    // so a test on this section with them would pass without anything being written —
    // measured: replacing his history wholesale still passed it.
    useWorkspace.getState().setField("clinicalHistory", "44F, L5 radiculopathy.", { source: "manual" });

    mergeTheFormats([STANDARD_NORMAL, CERVICAL_NORMAL]);

    const history = report().history;
    expect(history, "his history line survives").toContain("44F, L5 radiculopathy.");
    expect(history, "and the merged phrase is added to it, not swapped for it")
      .toContain("MRI lumbosacral spine requested.");
  });

  it("leaves the observation live when the merge preserved the prose it owns", () => {
    clickDiscHerniation();

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.stale, "its sentence is on the page, so it is not stale").toBeFalsy();
    expect(report().findings).toContain(DISC.sentence.split("\n")[0]!.trim().slice(0, 40));
  });

  it("still marks a contribution stale — never deleted — when its prose really is gone", () => {
    clickDiscHerniation();
    // He cleared both sections by hand before merging, so nothing of the row remains.
    useWorkspace.getState().setField("findings", "", { source: "manual" });
    useWorkspace.getState().setField("impression", "", { source: "manual" });

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches, "stale is not deleted: the row is still in the ledger").toHaveLength(1);
    expect(patches[0]!.stale).toBe(true);
  });

  it("replaces machine-authored Technique with the format's own statement, and prints one account", () => {
    // Found in review, not by the tests that shipped with the change: the setup half of
    // Start Report writes the Study Tab's or protocol's acquisition sentence, so a purely
    // additive merge printed it beside the format's approved statement — two accounts of one
    // examination. The scaffold door already has `mayReplaceMachineTechniqueWithApproved` for
    // exactly this, and the merge door now asks it too.
    const MACHINE = "MRI lumbo-sacral spine was performed on the configured scanner using the routine protocol.";
    useWorkspace.getState().setField("technique", MACHINE, { source: "protocol" });

    const preview = mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    const s = useWorkspace.getState();
    expect(s.techniqueText, "the machine sentence is gone").not.toContain("configured scanner");
    expect(s.techniqueText, "the examination is described once").toBe(preview.technique);
    expect(
      Object.keys(s.fieldProvenance.technique).some((k) => k.includes("configured scanner")),
      "and no provenance key is left claiming prose that is no longer on the page",
    ).toBe(false);
  });

  it("keeps Technique he wrote himself and adds the merged statement to it", () => {
    const HIS_TECHNIQUE = "MRI performed on the retired 1.5T unit with an ad-hoc lumbar protocol.";
    useWorkspace.getState().setField("technique", HIS_TECHNIQUE, { source: "manual" });

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    const s = useWorkspace.getState();
    expect(s.techniqueText, "his account of the acquisition survives").toContain(HIS_TECHNIQUE);
    expect(
      s.fieldProvenance.technique[normalizeForDedupe(HIS_TECHNIQUE)],
      "and stays his",
    ).toContain("manual");
  });

  it("flags that a conclusion is owed when the merged normal was withheld", () => {
    useWorkspace.getState().setField("findings", HIS_CONCLUSION, { source: "manual" });

    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);

    expect(report().impression, "the withheld normal left no conclusion").toBe("");
    expect(
      useWorkspace.getState().impressionNeedsRefresh,
      "and the surface says a conclusion is owed, as the Full Normal Format door does",
    ).toBe(true);
    expect(useWorkspace.getState().impressionBasis?.recordedBy, "the flag travels to the next reload")
      .toBe("unreconciled");
  });

  it("re-bases the dependency when it did write the conclusion, and merges an empty report unchanged", () => {
    const preview = mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);
    const s = useWorkspace.getState();

    expect(s.findingsText, "an empty report takes the previewed narrative verbatim")
      .toBe(preview.findings);
    expect(s.impressionText).toBe(preview.impression);
    expect(s.techniqueText).toBe(preview.technique);
    expect(
      s.impressionText.split("\n").length,
      "a conclusion authored as one statement is not re-split into numbered items",
    ).toBe(preview.impression.split("\n").length);
    expect(s.impressionNeedsRefresh, "nothing is owed: the door wrote both sides").toBe(false);
  });

  it("keeps the withheld normal off the page across an automatic pass and a save/reload", () => {
    clickDiscHerniation();
    mergeTheFormats([LS_NORMAL, WHOLE_SCREEN]);
    const hisConclusion = report().impression;

    useWorkspace.getState().composeInstantReport(
      buildReportingStudyContext({ modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto" }),
      false,
    );
    expect(report().impression, "the automatic pass does not reinstate the normal").toBe(hisConclusion);

    const state = useWorkspace.getState();
    const narrative = {
      findings: state.findingsText, impression: state.impressionText, recommendation: state.recommendationText,
      technique: state.techniqueText, clinicalHistory: state.clinicalHistoryText,
    };
    const saved = JSON.parse(JSON.stringify(state.serializeObservationLedger()));
    useWorkspace.setState({
      findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
      clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
      impressionNeedsRefresh: false, impressionBasis: null, impressionDependencyReasons: [],
    } as never);
    useWorkspace.getState().setEditorContent(narrative);
    const res = useWorkspace.getState().hydrateObservationLedger(saved);

    expect(res.ok, res.warning ?? "").toBe(true);
    expect(res.mode).toBe("restored");
    expect(report().impression, "the reopened report still carries his conclusion").toBe(hisConclusion);
    expect(
      useWorkspace.getState().appliedPathologyPatches.some((p) => p.stale),
      "and his observation comes back live, not stale",
    ).toBe(false);
  });
});

/**
 * The one pure function both the door and the Merge Preview read. Tested directly because
 * the guarantee it carries is that the two surfaces cannot disagree: a preview that shows a
 * sentence this returns as withheld would be promising a conclusion Apply refuses to write.
 */
describe("Ruling 2 · the shared withhold decision", () => {
  const mergedImpression = (format: typeof LS_NORMAL): MergeSentence[] =>
    mergeTwoFormats(format, WHOLE_SCREEN).impressionMerged.sentences;

  it("withholds nothing when the report asserts no abnormality", () => {
    const decision = withheldMergedImpression(mergedImpression(LS_NORMAL), [], {
      findings: "Lumbar vertebrae show normal alignment and marrow signal.",
      impression: "",
    });

    expect(decision.withheld, "a normal report merges normally").toEqual([]);
    expect(decision.contributed.map((s) => s.text).join(" ")).toContain("Normal MRI lumbo-sacral spine.");
  });

  it("withholds the normal and the denial, and contributes the abnormal, over an abnormality", () => {
    clickDiscHerniation();

    const decision = withheldMergedImpression(mergedImpression(LS_NORMAL), useWorkspace.getState().appliedPathologyPatches, {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
    });
    const withheld = decision.withheld.map((s) => s.text).join(" ");

    expect(withheld, "the whole-study normal is withheld").toContain("Normal MRI lumbo-sacral spine.");
    expect(withheld, "and so is the denial that contradicts his herniation").toContain("No acute bony or disc abnormality");
    expect(decision.contributed, "nothing of that conclusion survives to be written").toEqual([]);

    const withSlip = withheldMergedImpression(
      mergedImpression(SLIP),
      useWorkspace.getState().appliedPathologyPatches,
      { findings: useWorkspace.getState().findingsText, impression: useWorkspace.getState().impressionText },
    );
    expect(
      withSlip.contributed.map((s) => s.text).join(" "),
      "the second format's own abnormal conclusion is contributed, not withheld with them",
    ).toContain("Grade I anterolisthesis of L5 over S1");
  });
});
