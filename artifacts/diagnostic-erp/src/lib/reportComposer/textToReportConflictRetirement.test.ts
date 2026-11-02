/**
 * Text-to-Report, first requirement: an abnormality must replace ONLY the normal
 * statements it conflicts with.
 *
 * The brief's workflow starts with the radiologist's own words — typed or dictated —
 * and the report that comes back has to be internally consistent. On an MRI brain
 * that is a real collision, because the examination opens by inserting "No acute
 * infarct is seen." and "No restricted diffusion is seen on DWI/ADC." on the page, and
 * a stroke dictation contradicts both.
 *
 * This suite measures which of the three ways CARE actually gets text onto the page
 * performs that replacement, because the answer decides where the composer's input
 * comes from:
 *
 *  1. a Quick Select click — the tile carries `baselineReplaces` and a conflict group;
 *  2. a committed Voice Composer plan — `removeConflictingBaselineConcepts` is the
 *     dictation path's own retirement instruction;
 *  3. typed prose straight into Findings — no row, no concept, nothing that declares
 *     which normal it contradicts.
 *
 * Case 3 is the case the brief is about, and it is the one where nothing can retire
 * the scaffold: the contradiction then reaches the model as input, and PR #1257's
 * prompt rule ("replace only the ones an observation contradicts") asks a 14B local
 * model to do bookkeeping CARE has the data to do itself.
 *
 * Synthetic study, no patient identity.
 */
import { describe, expect, it, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS as FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "@/lib/zai-workspace/quick-select-library";
import { clickedTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { deriveComposeObservations } from "@/lib/reportComposer/composeObservations";
import type { VoiceChangePlan } from "@/lib/voiceReportComposer/types";

const S = () => useWorkspace.getState();

const CONTRADICTED = [
  "No acute infarct is seen.",
  "No restricted diffusion is seen on DWI/ADC.",
];

function brainCtx(): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI Brain Plain",
    regions: ["Brain"],
    source: "auto",
  });
}

function openBrainStudy(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWorkspace.setState({
    reportFormats: FORMATS,
    reportingContext: brainCtx(),
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, voiceComposerObservations: [], patchUndoStack: [], patchRedoStack: [],
    impressionOrderFrozen: false, startingCanvasBaseline: null, selectedFormatIds: [], isFinalized: false,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    canalApProvenance: {},
    regionTransitions: [],
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    linkedStudy: null,
    appliedPatternMarkers: [],
    activeStudyId: null,
    appliedFormatName: null,
    appliedFormatReportTitle: null,
  });
  const decision = S().composeInstantReport(brainCtx(), false);
  expect(decision.action, `Mode A declined to compose: ${JSON.stringify(decision)}`).toBe("compose");
}

function tile(label: string) {
  const found = TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
}

/** What the composer would be handed: the narrative on the page, plus the ledger rows. */
function composerInput() {
  const findings = S().findingsText;
  const rows = deriveComposeObservations(S().appliedPathologyPatches);
  return { findings, rows };
}

describe("an abnormality replaces only the normal statements it conflicts with", () => {
  it("control: opening the study puts both scaffold denials on the page", () => {
    openBrainStudy();
    const { findings } = composerInput();
    for (const sentence of CONTRADICTED) {
      expect(findings, `the normal template should have written: ${sentence}`).toContain(sentence);
    }
  });

  it("1 — a Quick Select infarct click retires the two normals it contradicts", () => {
    openBrainStudy();
    expect(S().applyPathologyOverlay(clickedTilePatch(tile("Acute infarct (DWI)"), "findings", { side: "right" })))
      .toBe("applied");
    const { findings } = composerInput();
    expect(findings).toContain("right");
    for (const sentence of CONTRADICTED) {
      expect(findings, `clicked abnormality must retire: ${sentence}`).not.toContain(sentence);
    }
    // and it must not have taken unrelated normal anatomy with it
    expect(findings).toContain("Brainstem shows normal morphology");
    expect(findings).toContain("Cerebellar hemispheres show normal morphology");
  });

  it("2 — a committed voice plan retires the concepts it names as conflicting", () => {
    openBrainStudy();
    const plan: VoiceChangePlan = {
      operation: "report_change_plan",
      observations: [
        {
          concept: "infarct",
          laterality: "right",
          anatomicalSection: "basal ganglia",
          findingsText:
            "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.",
        },
      ],
      removeConflictingBaselineConcepts: ["infarct", "diffusion"],
      uncertainties: [],
    };
    expect(S().applyVoiceComposerPlan(plan, "right basal ganglia acute infarct")).toBe("applied");
    const { findings } = composerInput();
    expect(findings).toContain("Restricted diffusion in the right basal ganglia");
    for (const sentence of CONTRADICTED) {
      expect(findings, `dictated abnormality must retire: ${sentence}`).not.toContain(sentence);
    }
    expect(findings).toContain("Brainstem shows normal morphology");
  });

  it("3 — typed prose joins the report and leaves the rest of the scaffold alone", () => {
    openBrainStudy();
    const dictated =
      "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";
    S().setField("findings", `${S().findingsText}\n${dictated}`);
    const { findings } = composerInput();
    expect(findings).toContain(dictated);
    expect(findings).toContain("Brainstem shows normal morphology");
  });

  // TYPED-PROSE RETIREMENT (discovered, pinned): free text carries no concept and no
  // conflict group, so nothing on this path retires the two scaffold denials — the page
  // keeps "No acute infarct is seen." beside the sentence that says the opposite, and
  // the contradiction then reaches the model as INPUT. The click path has
  // `baselineReplaces` and the voice path has `removeConflictingBaselineConcepts`;
  // typing has neither. Deleting text the radiologist can see, under his own cursor, is
  // not the answer — the fix belongs at the composer boundary, where the contradicted
  // provisional normals can be withheld from what the model is asked to treat as the
  // examination's clinical truth. Pinned until that exists.
  it.fails("TYPED-PROSE pin: typed prose retires the normals it contradicts", () => {
    openBrainStudy();
    const dictated =
      "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";
    S().setField("findings", `${S().findingsText}\n${dictated}`);
    const { findings } = composerInput();
    for (const sentence of CONTRADICTED) {
      expect(findings, `typed abnormality must retire: ${sentence}`).not.toContain(sentence);
    }
  });
});
