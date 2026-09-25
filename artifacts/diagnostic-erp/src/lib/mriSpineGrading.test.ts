/**
 * Neuro-Spine Grading Engine — unit + ledger integration tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildSpineGradingAtoms,
  composeNeuroSpineFinding,
  CORD_SIGNAL_GRADES,
  FORAMINAL_STENOSIS_GRADES,
  MEYERDING_GRADES,
  MODIC_GRADES,
  PFIRRMANN_GRADES,
  legacyModicFromGrade,
  modicGradeFromLegacy,
  parsePfirrmannFromText,
  spineGradingHasContent,
} from "./mriSpineGrading";
import { buildLumbarLevelApplyBundle, deriveLumbarLevelSelection } from "./mriLumbarLevelState";
import { buildCervicalLevelApplyBundle } from "./mriCervicalLevelState";
import { buildDorsalLevelApplyBundle } from "./mriDorsalLevelState";
import { composeLumbarLevelNarrative } from "./mriLumbarRegions";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

function resetWorkspace(region = "LS Spine") {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: `MRI ${region}`,
      regions: [region],
      source: "auto",
    }),
  });
}

describe("mriSpineGrading — clinical definitions", () => {
  it("defines Pfirrmann I–V, Modic 0–III, Meyerding 0–IV, cord 0–2, foraminal grades", () => {
    expect(PFIRRMANN_GRADES.map((g) => g.id)).toEqual(["I", "II", "III", "IV", "V"]);
    expect(MODIC_GRADES.map((g) => g.id)).toEqual(["0", "I", "II", "III"]);
    expect(MEYERDING_GRADES.map((g) => g.id)).toEqual(["0", "I", "II", "III", "IV"]);
    expect(CORD_SIGNAL_GRADES.map((g) => g.id)).toEqual(["0", "1", "2"]);
    expect(FORAMINAL_STENOSIS_GRADES.map((g) => g.id)).toEqual(["none", "mild", "moderate", "severe"]);
  });

  it("maps legacy Modic ↔ standardized grades", () => {
    expect(modicGradeFromLegacy("type2")).toBe("II");
    expect(legacyModicFromGrade("III")).toBe("type3");
    expect(legacyModicFromGrade("0")).toBe("none");
  });
});

describe("composeNeuroSpineFinding — acceptance sentence", () => {
  it("L4-L5 Pfirrmann IV + severe canal + AP 8mm + moderate bilateral foraminal", () => {
    const { findings, impression } = composeNeuroSpineFinding("L4-L5", {
      pfirrmann: "IV",
      centralCanalSeverity: "severe",
      canalApMm: 8,
      foraminalSeverity: "moderate",
      foraminalLaterality: "bilateral",
    });
    expect(findings).toBe(
      "L4-L5: Pfirrmann IV disc degeneration with severe central canal stenosis (AP: 8mm) and moderate bilateral foraminal narrowing.",
    );
    expect(impression).toMatch(/Pfirrmann IV/i);
    expect(impression).toMatch(/severe canal stenosis/i);
    expect(spineGradingHasContent({
      pfirrmann: "IV",
      centralCanalSeverity: "severe",
      foraminalSeverity: "moderate",
    })).toBe(true);
  });
});

describe("buildLumbarLevelApplyBundle — grading → ledger", () => {
  beforeEach(() => resetWorkspace("LS Spine"));

  it("Apply Pfirrmann IV + severe canal + AP + moderate foraminal emits atoms and findings", () => {
    const { bundleId, observations, composed } = buildLumbarLevelApplyBundle({
      level: "L4-L5",
      region: "LS Spine",
      sel: {
        pfirrmann: "IV",
        canal: "severe",
        canalApMm: 8,
        foraminalSeverity: "moderate",
        foraminalLaterality: "bilateral",
      },
    });

    expect(bundleId).toMatch(/r2-ls-bundle-L4-L5/);
    expect(composed.findings).toContain("Pfirrmann IV disc degeneration");
    expect(composed.findings).toContain("severe central canal stenosis (AP: 8mm)");
    expect(composed.findings).toContain("moderate bilateral foraminal narrowing");

    const concepts = observations.map((o) => o.concept);
    expect(concepts).toContain("pfirrmann");
    expect(concepts).toContain("canal_stenosis");
    expect(concepts).toContain("canal_ap");
    expect(concepts).toContain("foraminal_stenosis");

    const pf = observations.find((o) => o.concept === "pfirrmann");
    expect(pf?.findingsText).toMatch(/Pfirrmann grade IV/i);
    expect(pf?.severity).toBe("IV");

    useWorkspace.getState().applyMacroBundle({ bundleId, observations });
    const patches = useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale);
    expect(patches.some((p) => p.observation?.concept === "pfirrmann")).toBe(true);
    const sel = deriveLumbarLevelSelection(patches, "L4-L5");
    expect(sel.pfirrmann).toBe("IV");
    expect(sel.canal).toBe("severe");
    expect(sel.canalApMm).toBe(8);
    expect(sel.foraminalSeverity).toBe("moderate");
  });

  it("composeLumbarLevelNarrative uses neurosurgical wording when Pfirrmann set", () => {
    const n = composeLumbarLevelNarrative("L4-L5", {
      pfirrmann: "IV",
      canal: "severe",
      canalApMm: 8,
      foraminalSeverity: "moderate",
      foraminalLaterality: "bilateral",
    });
    expect(n.findings).toMatch(/^L4-L5: Pfirrmann IV/);
    expect(n.concept).toBe("pfirrmann");
  });
});

describe("cervical / dorsal grading bundles", () => {
  it("cervical emit Pfirrmann + cord signal atoms", () => {
    const { observations } = buildCervicalLevelApplyBundle({
      level: "C5-C6",
      region: "Cervical Spine",
      sel: {
        pfirrmann: "III",
        cordSignal: "2",
        canal: "stenosis-severe",
      },
    });
    expect(observations.some((o) => o.concept === "pfirrmann")).toBe(true);
    expect(observations.some((o) => o.concept === "cord_signal")).toBe(true);
    expect(observations.find((o) => o.concept === "cord_signal")?.severity).toBe("2");
  });

  it("dorsal emit Meyerding + Modic atoms", () => {
    const { observations } = buildDorsalLevelApplyBundle({
      level: "T8-T9",
      region: "Dorsal Spine",
      sel: {
        meyerding: "II",
        modicGrade: "I",
        pfirrmann: "IV",
      },
    });
    expect(observations.some((o) => o.concept === "spondylolisthesis")).toBe(true);
    expect(observations.some((o) => o.concept === "endplate")).toBe(true);
    expect(observations.some((o) => o.concept === "pfirrmann")).toBe(true);
  });
});

describe("buildSpineGradingAtoms", () => {
  it("skips Modic 0 / Meyerding 0 / cord 0", () => {
    expect(buildSpineGradingAtoms("L3-L4", {
      modicGrade: "0",
      meyerding: "0",
      cordSignal: "0",
    })).toEqual([]);
  });

  it("parsePfirrmannFromText recovers grade", () => {
    expect(parsePfirrmannFromText("At L4-L5, Pfirrmann grade IV disc degeneration is noted.", "IV")).toBe("IV");
    expect(parsePfirrmannFromText("pfirrmann III changes", "")).toBe("III");
  });
});
