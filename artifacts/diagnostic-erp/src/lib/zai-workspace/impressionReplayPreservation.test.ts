/**
 * The Impression survives its own replay.
 *
 * Every automatic pass rebuilds the report from the observation ledger: `radiologistObservations`
 * takes the live rows and `generateProfessionalReport` replays each one through
 * `applyPathologyOverlay`. A row whose `observation.role` is `"impression"` is not a baseline row
 * (`fullReportBaseline.ts:389`), so it is replayed too — and what the replay did to it is the
 * question this file asks.
 *
 * This is not a hypothetical shape. A census of the clinic's own library on 2026-11-01
 * (`tmp/rig/j59-impression-observation-census.mjs`, evidence `tmp/evidence/j59-impression-census.txt`)
 * found 13 owned baselines with a manifest, every one of them carrying exactly one Impression
 * observation, and EVERY one of those observations states TWO OR THREE SENTENCES — the brain row's
 * "Normal MRI of the brain. No acute intracranial abnormality.", the screening rows' three-sentence
 * conclusion that ends by naming the limited coverage. A combined examination authored as one row
 * per part is the second shape, and it is what a radiologist would write next.
 *
 * The owner's ruling (2026-11-01, release blocker): "No sentence, abnormality, recommendation or
 * manually entered clinical observation may disappear during replay."
 */
import { describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { CLINICAL_RESET_FIELDS } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import type { ReportFormat } from "@/lib/zai-workspace/types";

const BRAIN_SENTENCE_1 = "Normal MRI of the brain.";
const BRAIN_SENTENCE_2 = "No acute intracranial abnormality.";
const SCREENING_SENTENCE_3 = "Screening examination with limited planar and limited sequence coverage.";
const CSPINE_SENTENCE = "No significant cervical disc or canal abnormality on screening.";

const manifest = (
  revision: string,
  rows: Array<{ id: string; field: "findings" | "impression"; region: string; concept: string; text: string }>,
) => ({
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision,
  observations: rows.map((r) => ({
    id: r.id,
    field: r.field,
    concept: r.concept,
    conflictGroup: r.concept,
    anatomicalSection: r.region,
    region: r.region,
    renderedText: r.text,
  })),
});

/** The shipped shape: ONE Impression observation stating two sentences. */
const BRAIN_TWO_SENTENCES = {
  id: "f-brain-two", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
  isCompleteNormal: true,
  findings: "Brain: Normal signal intensity.",
  impression: `${BRAIN_SENTENCE_1} ${BRAIN_SENTENCE_2}`,
  technique: "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences.",
  baselineManifest: manifest("two.sentences.v1", [
    { id: "f-signal", field: "findings", region: "Brain", concept: "signal_intensity", text: "Brain: Normal signal intensity." },
    { id: "i-normal", field: "impression", region: "Brain", concept: "normal_brain", text: `${BRAIN_SENTENCE_1} ${BRAIN_SENTENCE_2}` },
  ]),
} as unknown as ReportFormat;

/** The three-sentence conclusion a clinic screening row actually carries. */
const BRAIN_THREE_SENTENCES = {
  id: "f-brain-three", name: "MRI Brain — Screening Normal", modality: "MR", bodyPart: "Brain",
  isCompleteNormal: true,
  findings: "Brain: Normal signal intensity.",
  impression: `${BRAIN_SENTENCE_1} ${BRAIN_SENTENCE_2} ${SCREENING_SENTENCE_3}`,
  technique: "Limited planar and limited sequence MRI brain screening was performed.",
  baselineManifest: manifest("three.sentences.v1", [
    { id: "f-signal", field: "findings", region: "Brain", concept: "signal_intensity", text: "Brain: Normal signal intensity." },
    {
      id: "i-normal", field: "impression", region: "Brain", concept: "normal_brain_screening",
      text: `${BRAIN_SENTENCE_1} ${BRAIN_SENTENCE_2} ${SCREENING_SENTENCE_3}`,
    },
  ]),
} as unknown as ReportFormat;

/** The combined shape: one Impression observation per examination, in one row's manifest. */
const COMBINED_TWO_ROWS = {
  id: "f-combined-rows", name: "MRI Brain – Screening Cervical Spine Normal",
  modality: "MR", bodyPart: "Brain", isCompleteNormal: true,
  findings: "Brain: Normal signal intensity.\nCervical Spine: Normal alignment.",
  impression: `${BRAIN_SENTENCE_1}\n${CSPINE_SENTENCE}`,
  technique: "MRI brain and cervical spine screening.",
  baselineManifest: manifest("combined.two.rows.v1", [
    { id: "f-signal", field: "findings", region: "Brain", concept: "signal_intensity", text: "Brain: Normal signal intensity." },
    { id: "f-alignment", field: "findings", region: "Cervical Spine", concept: "cervical_alignment", text: "Cervical Spine: Normal alignment." },
    { id: "i-brain", field: "impression", region: "Brain", concept: "normal_brain", text: BRAIN_SENTENCE_1 },
    { id: "i-cspine", field: "impression", region: "Cervical Spine", concept: "normal_cspine", text: CSPINE_SENTENCE },
  ]),
} as unknown as ReportFormat;

const ctxFor = (regions: string[]): ReportingStudyContext => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI BRAIN + CX SCR", regions, source: regions.length > 1 ? "override" : "billed",
});
const asGeneratorCtx = (c: ReportingStudyContext) => ({
  modality: c.modality, region: c.region, regions: c.regions,
  source: c.source, protocolName: c.protocolName, studyDescription: c.studyDescription,
});
const BRAIN = ctxFor(["Brain"]);
const COMBINED_SCOPE = ctxFor(["Brain", "Cervical Spine"]);

function cleanCanvas(formats: ReportFormat[]) {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: "",
    fieldProvenance: {}, appliedPathologyPatches: [], patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, mergePreviewOpen: false, pendingPathologyPatch: null,
    pendingFormatIds: [], pendingFormatOverwrite: null, pendingNormalReplacement: null,
    isFinalized: false, isFinalizing: false, isDirty: false, impressionOrderFrozen: false,
    regionTransitions: [], reportingContext: BRAIN,
    reportFormats: formats, reportFormatPickerOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    normalLinesRemovedByRadiologist: [], impressionNeedsRefresh: false,
  });
}

const sentences = (t: string) => t.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);

/** The ledger rows a pass replays: every live row that is not a baseline scaffold. */
function replayedImpressionRows() {
  return useWorkspace.getState().appliedPathologyPatches.filter(
    (p) => !p.stale && p.observation?.role === "impression",
  );
}

describe("a pass the radiologist never pressed replays the Impression without rewriting it", () => {
  it("builds the fixture the way the product does — one Impression row, two sentences", () => {
    cleanCanvas([BRAIN_TWO_SENTENCES]);
    expect(useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN)).status)
      .toBe("generated");
    const rows = replayedImpressionRows();
    expect(rows.length, "the fixture must reach the replay path the defect lives in").toBe(1);
    expect(rows[0].templates.impression).toBe(`${BRAIN_SENTENCE_1} ${BRAIN_SENTENCE_2}`);
  });

  it("keeps every sentence of a two-sentence Impression through the replay", () => {
    cleanCanvas([BRAIN_TWO_SENTENCES]);
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN));
    const afterPress = useWorkspace.getState().impressionText;
    expect(sentences(afterPress)).toHaveLength(2);

    expect(useWorkspace.getState()
      .generateProfessionalReport(asGeneratorCtx(BRAIN), { automatic: true, requireOwnedApprovedNormal: true })
      .status).toBe("generated");
    const afterPass = useWorkspace.getState().impressionText;
    for (const s of sentences(afterPress)) {
      expect(afterPass, `the replay dropped "${s}"`).toContain(s);
    }
  });

  it("keeps the third sentence a screening row uses to state its own limitation", () => {
    cleanCanvas([BRAIN_THREE_SENTENCES]);
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN));
    expect(useWorkspace.getState()
      .generateProfessionalReport(asGeneratorCtx(BRAIN), { automatic: true, requireOwnedApprovedNormal: true })
      .status).toBe("generated");
    const after = useWorkspace.getState().impressionText;
    expect(after).toContain(BRAIN_SENTENCE_1);
    expect(after).toContain(BRAIN_SENTENCE_2);
    // The coverage statement is a safety claim, not decoration: a report that stops saying the
    // examination was limited presents a screening study as a diagnostic one.
    expect(after).toContain(SCREENING_SENTENCE_3);
  });

  it("keeps BOTH examinations when one normal states its conclusion in one row per part", () => {
    cleanCanvas([COMBINED_TWO_ROWS]);
    expect(useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(COMBINED_SCOPE)).status)
      .toBe("generated");
    expect(replayedImpressionRows().length).toBe(2);
    const afterPress = useWorkspace.getState().impressionText;

    expect(useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(COMBINED_SCOPE), {
      automatic: true, requireOwnedApprovedNormal: true,
    }).status).toBe("generated");
    const after = useWorkspace.getState().impressionText;
    expect(after, "the brain conclusion vanished behind the cervical one").toContain(BRAIN_SENTENCE_1);
    expect(after).toContain(CSPINE_SENTENCE);
    expect(sentences(after)).toHaveLength(sentences(afterPress).length);
  });

  it("leaves a report alone that already says everything it has to say", () => {
    cleanCanvas([BRAIN_TWO_SENTENCES]);
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN));
    const first = {
      impression: useWorkspace.getState().impressionText,
      findings: useWorkspace.getState().findingsText,
    };
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN), {
      automatic: true, requireOwnedApprovedNormal: true,
    });
    const s = useWorkspace.getState();
    expect(s.impressionText).toBe(first.impression);
    expect(s.findingsText).toBe(first.findings);
  });
});

describe("what a replay is allowed to touch", () => {
  it("never drops a sentence the radiologist entered by hand", () => {
    cleanCanvas([BRAIN_TWO_SENTENCES]);
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN));
    const typed = "Clinical: headache for three weeks, no focal deficit.";
    useWorkspace.getState().setField("impression", `${useWorkspace.getState().impressionText}\n${typed}`, "manual");
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN), {
      automatic: true, requireOwnedApprovedNormal: true,
    });
    const after = useWorkspace.getState().impressionText;
    expect(after).toContain(typed);
    expect(after).toContain(BRAIN_SENTENCE_1);
    expect(after).toContain(BRAIN_SENTENCE_2);
  });

  it("carries the recommendation through too", () => {
    cleanCanvas([BRAIN_TWO_SENTENCES]);
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN));
    const advice = "Correlate with the clinical examination.";
    useWorkspace.getState().setField("recommendation", advice, "manual");
    useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BRAIN), {
      automatic: true, requireOwnedApprovedNormal: true,
    });
    expect(useWorkspace.getState().recommendationText).toContain(advice);
  });

  it("is reset with the rest of the clinical state, so no replay crosses between studies", () => {
    expect(CLINICAL_RESET_FIELDS).toContain("appliedPathologyPatches");
  });
});
