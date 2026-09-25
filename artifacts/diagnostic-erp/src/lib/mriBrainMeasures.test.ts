/**
 * Brain / Stroke Measures Engine — unit + ledger integration tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  abc2Volume,
  aneurysmAspectRatio,
  aspectsScore,
  buildBrainMeasureAtoms,
  brainMeasuresHasContent,
  composeAneurysmSentence,
  composeAspectsSentence,
  composeIchSentence,
  composeMidlineSentence,
  severityForAbc2,
  severityForAneurysm,
  severityForAspects,
  severityForMidline,
} from "./mriBrainMeasures";
import {
  isBrainMeasuresReportingContext,
  isCtBrainReportingContext,
  isMriBrainReportingContext,
  buildReportingStudyContext,
} from "./reportingStudyContext";
import { detectCriticalFindings } from "./criticalResults";
import { criticalFindingBlocksFinalize, computeFinalizeSafety } from "./finalizeSafety";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";

function resetWorkspace(region = "Brain") {
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

describe("abc2Volume", () => {
  it("A=5, B=4, C=3 → 30 cc", () => {
    expect(abc2Volume(5, 4, 3)).toBe(30);
  });

  it("rejects non-finite / negative", () => {
    expect(Number.isNaN(abc2Volume(-1, 4, 3))).toBe(true);
    expect(Number.isNaN(abc2Volume(5, Number.NaN, 3))).toBe(true);
  });
});

describe("aspectsScore", () => {
  it("3 affected regions → score 7", () => {
    expect(aspectsScore(["M1", "M2", "L"])).toBe(7);
  });

  it("dedupes and ignores unknown ids", () => {
    expect(aspectsScore(["M1", "M1", "M2"] as never)).toBe(8);
  });

  it("empty → 10", () => {
    expect(aspectsScore([])).toBe(10);
  });
});

describe("sentence composers", () => {
  it("ICH ABC/2 sentence", () => {
    const s = composeIchSentence({
      location: "left basal ganglia",
      a: 5,
      b: 4,
      c: 3,
      volume: 30,
    });
    expect(s).toBe(
      "Intracerebral haemorrhage in the left basal ganglia measuring 5 × 4 × 3 cm, estimated ABC/2 volume 30 cc.",
    );
  });

  it("midline sentence", () => {
    expect(composeMidlineSentence({ mm: 6, side: "right" })).toBe(
      "Midline shift of 6 mm to the right.",
    );
  });

  it("ASPECTS sentence includes acute infarct cue", () => {
    const s = composeAspectsSentence({ score: 7, affectedRegions: ["M1", "M2", "L"] });
    expect(s).toMatch(/ASPECTS 7\/10/);
    expect(s).toMatch(/acute infarct/i);
  });

  it("aneurysm sentence + aspect ratio", () => {
    const { findings, aspectRatio } = composeAneurysmSentence({
      location: "ACom",
      domeMm: 8,
      neckMm: 4,
    });
    expect(aspectRatio).toBe(2);
    expect(aneurysmAspectRatio(8, 4)).toBe(2);
    expect(findings).toMatch(/Saccular cerebral aneurysm at the ACom/);
    expect(findings).toMatch(/8 mm dome × 4 mm neck/);
    expect(findings).toMatch(/aspect ratio 2/);
  });
});

describe("severity thresholds", () => {
  it("ABC/2 ≥ 30 → critical", () => {
    expect(severityForAbc2(30)).toBe("critical");
    expect(severityForAbc2(29.9)).toBe("significant");
  });

  it("midline ≥ 5 mm → critical", () => {
    expect(severityForMidline(6)).toBe("critical");
    expect(severityForMidline(4)).toBe("significant");
  });

  it("ASPECTS ≤ 7 → urgent", () => {
    expect(severityForAspects(7)).toBe("urgent");
    expect(severityForAspects(8)).toBe("significant");
    expect(severityForAspects(10)).toBe("");
  });

  it("aneurysm dome ≥ 7 mm → urgent", () => {
    expect(severityForAneurysm(7)).toBe("urgent");
    expect(severityForAneurysm(6)).toBe("significant");
  });
});

describe("buildBrainMeasureAtoms + ledger", () => {
  beforeEach(() => resetWorkspace("Brain"));

  it("emits well-formed atoms with ownership + severity", () => {
    const { observations } = buildBrainMeasureAtoms({
      region: "Brain",
      ich: { location: "left basal ganglia", a: 5, b: 4, c: 3 },
      midline: { mm: 6, side: "right" },
      aspects: { affectedRegions: ["M1", "M2", "L"] },
      aneurysm: { location: "ACom", domeMm: 8, neckMm: 4 },
    });
    expect(brainMeasuresHasContent({
      ich: { location: "left basal ganglia", a: 5, b: 4, c: 3 },
    })).toBe(true);

    const byConcept = Object.fromEntries(observations.map((o) => [o.concept, o]));
    expect(byConcept.ich_abc2?.severity).toBe("critical");
    expect(byConcept.ich_abc2?.ownership.conflictGroup).toBe("ich_abc2");
    expect(byConcept.ich_abc2?.measurement).toBe("30");
    expect(byConcept.midline_shift?.severity).toBe("critical");
    expect(byConcept.aspects?.severity).toBe("urgent");
    expect(byConcept.aspects?.measurement).toBe("7");
    expect(byConcept.aneurysm?.severity).toBe("urgent");

    useWorkspace.getState().applyMacroBundle({
      bundleId: "test-brain",
      observations,
    });
    const patches = useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale);
    expect(patches.length).toBeGreaterThanOrEqual(4);
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/ABC\/2 volume 30 cc/i);
    expect(findings).toMatch(/Midline shift of 6 mm/i);
    expect(findings).toMatch(/ASPECTS 7\/10/);
    expect(findings).toMatch(/cerebral aneurysm/i);

    // Existing critical path sees ICH + midline (+ acute infarct from ASPECTS)
    const hits = detectCriticalFindings(findings, []);
    expect(hits.some((h) => /midline|haemorrhage|infarct|aneurysm/i.test(h.label))).toBe(true);
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: hits.map((h) => ({ label: h.label })),
        criticalMarked: false,
        criticalCommunicated: false,
      }),
    ).toBe(true);

    // Undo Last Abnormal removes last clinical frame
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
  });

  it("same-slot re-apply replaces ICH volume", () => {
    const first = buildBrainMeasureAtoms({
      ich: { location: "left putamen", a: 5, b: 4, c: 3 },
    });
    useWorkspace.getState().applyMacroBundle(first);
    const second = buildBrainMeasureAtoms({
      ich: { location: "left putamen", a: 4, b: 3, c: 2 },
    });
    useWorkspace.getState().applyMacroBundle(second);
    const ich = useWorkspace.getState().appliedPathologyPatches.filter(
      (p) => !p.stale && p.observation?.concept === "ich_abc2",
    );
    expect(ich).toHaveLength(1);
    expect(ich[0]!.observation?.measurement).toBe("12");
  });
});

describe("brain context guards", () => {
  it("MRI Brain activates MRI brain context", () => {
    expect(isMriBrainReportingContext({
      modality: "MR",
      region: "Brain",
      family: "brain",
    })).toBe(true);
    expect(isMriBrainReportingContext({
      modality: "MR",
      region: "LS Spine",
      family: "spine",
    })).toBe(false);
  });

  it("CT Brain / stroke activates CT brain context", () => {
    expect(isCtBrainReportingContext({
      modality: "CT",
      region: "Brain",
      family: "brain",
    })).toBe(true);
    expect(isCtBrainReportingContext({
      modality: "CT",
      studyDescription: "CT head stroke protocol",
    })).toBe(true);
    expect(isBrainMeasuresReportingContext({
      modality: "CT",
      region: "Brain",
    })).toBe(true);
  });
});

describe("finalizeSafety sees brain measure findings", () => {
  it("unacknowledged ICH blocks finalize", () => {
    const findings = composeIchSentence({
      location: "right thalamus",
      a: 5,
      b: 4,
      c: 3,
      volume: 30,
    });
    const hits = detectCriticalFindings(findings, []);
    expect(hits.length).toBeGreaterThan(0);
    const issues = computeFinalizeSafety({
      checklistActive: false,
      checklistPercent: 100,
      criticalHits: hits.map((h) => ({ label: h.label })),
      criticalMarked: false,
      criticalCommunicated: false,
    });
    expect(issues.some((i) => i.id === "critical-unflagged")).toBe(true);
  });
});
