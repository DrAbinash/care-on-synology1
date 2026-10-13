import { describe, expect, it, beforeEach } from "vitest";
import {
  applyChangePlan,
  buildChangePreview,
  detectProtectedConflicts,
} from "./applyChangePlan";
import { provenanceFromText } from "../reportFieldMerge";
import { deterministicCompose } from "../../../../api-server/src/lib/voiceReportComposer/composer";
import { DEFAULT_REPORT_FORMATS } from "../zai-workspace/report-formats-library";
import { useWorkspace } from "../zai-workspace/store";
import { emptyViewerMeasurementsState } from "../structuredViewerMeasurements";
import { buildReportingStudyContext } from "../reportingStudyContext";

const normalLs = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const normalBrain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;

describe("voiceReportComposer applyChangePlan — safety hardening", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: normalLs.technique,
      findingsText: normalLs.findings,
      impressionText: normalLs.impression,
      recommendationText: normalLs.recommendation,
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      lastPatchSnapshot: null,
      isDirty: false,
    });
  });

  it("manual Quick Select edit blocks apply and surfaces conflict in preview", () => {
    const qsSentence = "L4-L5 disc is normal per Quick Select.";
    const prov = { findings: provenanceFromText(qsSentence, "quick-findings") };
    const plan = {
      operation: "report_change_plan" as const,
      observations: [{
        concept: "disc_bulge",
        findingsText: "Diffuse disc bulge at L4-L5.",
        baselineReplaces: "L4-L5 disc is normal",
        anatomicalSection: "disc",
        conflictGroup: "disc",
      }],
      uncertainties: [],
    };
    const narrative = {
      clinicalHistory: "",
      technique: normalLs.technique,
      findings: `${normalLs.findings}\n${qsSentence}`,
      impression: normalLs.impression,
      recommendation: normalLs.recommendation,
    };
    const conflicts = detectProtectedConflicts(plan, narrative.findings, prov.findings);
    expect(conflicts.length).toBeGreaterThan(0);

    const result = applyChangePlan({ narrative, provenance: prov, plan });
    expect(result.ok).toBe(false);
    expect(result.conflicts?.length).toBeGreaterThan(0);

    const preview = buildChangePreview({ narrative, provenance: prov, plan });
    expect(preview.hasConflicts).toBe(true);
    expect(preview.conflicts.length).toBeGreaterThan(0);
  });

  it("multi-level desiccation does not cross-replace levels", () => {
    const plan = deterministicCompose({
      transcript: "Disc desiccation at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/L3-L4/);
    expect(result.narrative!.findings).toMatch(/L4-L5/);
  });

  it("correction update replaces observation not duplicates", () => {
    const prior = [{
      id: "obs1",
      concept: "disc_bulge",
      level: "L4-L5",
      findingsText: "Diffuse disc bulge at L4-L5.",
      operation: "add" as const,
    }];
    const plan = deterministicCompose({
      transcript: "correction L3-4",
      region: "LS Spine",
      findingsText: "Diffuse disc bulge at L4-L5.",
      priorObservations: prior,
    })!;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: "Diffuse disc bulge at L4-5.",
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
      activeObservations: prior,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/L3-4/i);
    expect(result.narrative!.findings.match(/L4-5/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("one Apply with multiple observations = one atomic undo (findings + impression + provenance + voice state)", () => {
    const beforeFindings = useWorkspace.getState().findingsText;
    const beforeImpression = useWorkspace.getState().impressionText;
    const beforeProv = { ...useWorkspace.getState().fieldProvenance };

    const plan = deterministicCompose({
      transcript: "Loss of lumbar lordosis. Disc desiccation at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    plan.impressionUpdate = "Loss of lumbar lordosis with disc desiccation.";

    const status = useWorkspace.getState().applyVoiceComposerPlan(plan, "test transcript");
    expect(status).toBe("applied");
    expect(useWorkspace.getState().findingsText).not.toBe(beforeFindings);
    expect(useWorkspace.getState().voiceComposerObservations.length).toBeGreaterThan(0);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(beforeFindings);
    expect(useWorkspace.getState().impressionText).toBe(beforeImpression);
    expect(useWorkspace.getState().fieldProvenance).toEqual(beforeProv);
    expect(useWorkspace.getState().voiceComposerObservations).toEqual([]);
    expect(useWorkspace.getState().voiceComposerTranscriptHistory).toEqual([]);
  });

  it("brain abnormal finding preserves unrelated normal anatomy", () => {
    const plan = deterministicCompose({
      transcript: "Few punctate white matter hyperintense lesions Fazekas grade 1.",
      region: "Brain",
      findingsText: normalBrain.findings,
    });
    if (!plan) return;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalBrain.technique,
        findings: normalBrain.findings,
        impression: normalBrain.impression,
        recommendation: normalBrain.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/ventric/i);
  });

  it("preview shows untouched unrelated normals", () => {
    const plan = deterministicCompose({
      transcript: "Loss of lumbar lordosis.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    const preview = buildChangePreview({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(preview.untouched.some((u) => /Conus|paraspinal|Sacroiliac/i.test(u))).toBe(true);
    expect(preview.adds.length).toBeGreaterThan(0);
  });
});

/**
 * Dictation's own narrative integrity, at the store door — `applyVoiceComposerPlan`.
 *
 * The plan layer above was already tested for this: "correction update replaces
 * observation not duplicates" proves `applyChangePlan` takes the corrected sentence and
 * leaves one copy. The store then throws that narrative away and re-lays each surviving
 * observation through `applyPathologyOverlay`, retiring the previous dictation in step 1
 * with `stripContribution`. That call can never succeed: `contributionProtected`
 * (observationSlot.ts:596) counts `radiologist-voice` as protected text, and
 * `stampVoiceAuthoredProvenance` stamps every dictated sentence with exactly that source,
 * so the store asks a guard to retire the one authorship the guard exists to defend, and
 * it answers `preserved-manual` every time. Step 2 then deletes the ledger row that owned
 * the text, so the retired sentence stays in the printed exam as prose no observation
 * backs and no later dictation can retire.
 *
 * Measured on this head before the fix, for a cervical report the radiologist corrects:
 *
 *   re-worded C2 fracture  -> "A C2 fracture is seen." AND "There is a transversely
 *                             oriented C2 fracture." both in Findings, one ledger row
 *   wrong level C2 -> C4   -> both levels' findings AND both levels' conclusions in the
 *                             report, one ledger row (a wrong level is a wrong operation)
 *   remove 1 of 2          -> both findings and both conclusions remain, one ledger row
 *
 * So the tests below ask four things of one door: the retired wording leaves, the
 * radiologist's own wording never does, the report says what the ledger says, and the
 * session's Findings -> Impression answer is the answer the reloaded report gives too.
 */
const CORD_FINDINGS =
  "Left paracentral disc herniation at C5-C6 indenting the thecal sac, with resultant compression of the cervical cord at that level and intrinsic T2 hyperintensity consistent with myelomalacia. Canal AP diameter 8 mm. Cervical alignment is maintained.";
const CORD_IMPRESSION =
  "C5-C6 left paracentral disc herniation with cervical cord compression and myelomalacia.";

function resetCervicalWorkspace() {
  useWorkspace.setState({
    studies: [],
    activeStudyId: null,
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
    patchUndoStack: [],
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    impressionBasis: null,
    impressionDependencyReasons: [],
    selectedObservationId: null,
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    activeAnchor: null,
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Cervical Spine",
      regions: ["Cervical Spine"],
      source: "auto",
    }),
  });
  useWorkspace.getState().setField("findings", CORD_FINDINGS, { source: "manual" });
  useWorkspace.getState().setField("impression", CORD_IMPRESSION, { source: "quick-select" });
}

const dictationPlan = (over: Record<string, unknown>) =>
  ({
    operation: "report_change_plan",
    observations: [],
    removeConflictingBaselineConcepts: [],
    impressionCandidates: [],
    uncertainties: [],
    clarificationRequired: null,
    ...over,
  }) as never;

const dictationFinding = "A C2 fracture is seen.";
const dictationReworded = "There is a transversely oriented C2 fracture.";
const dictationCorrectedLevel = "A C4 fracture is seen.";

function dictatedFinding(over: Record<string, unknown> = {}) {
  return {
    concept: "vertebral_lesion",
    level: "C2",
    findingsText: dictationFinding,
    impressionText: "C2 fracture.",
    ...over,
  };
}

function say(tag: string) {
  const s = useWorkspace.getState();
  return `${tag}: findings ${JSON.stringify(s.findingsText)} / impression ${JSON.stringify(s.impressionText)}`;
}

function dictationAnswer() {
  const s = useWorkspace.getState();
  return {
    needsRefresh: s.impressionNeedsRefresh,
    reasons: [...s.impressionDependencyReasons].sort(),
  };
}

/** Save, close, reopen — the way the draft persistence hook does it. */
function reopenDictation() {
  const payload = useWorkspace.getState().serializeObservationLedger();
  const { findingsText, impressionText } = useWorkspace.getState();
  resetCervicalWorkspace();
  useWorkspace.getState().setEditorContent({
    findings: findingsText,
    impression: impressionText,
    recommendation: "",
    technique: "",
    clinicalHistory: "",
  });
  useWorkspace.getState().hydrateObservationLedger(payload);
  return dictationAnswer();
}

describe("dictation retires its own previous narrative and leaves the radiologist's alone", () => {
  beforeEach(() => resetCervicalWorkspace());

  it("1. an explicit update replaces the dictated sentence rather than adding a second one", () => {
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ observations: [dictatedFinding()] }), "a c2 fracture"),
    ).toBe("applied");
    const voiced = useWorkspace.getState().voiceComposerObservations;
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({
          observations: [dictatedFinding({ operation: "update", targetObservationId: voiced[0]!.id, findingsText: dictationReworded })],
        }),
        "correction: transversely oriented",
      ),
    ).toBe("applied");
    const findings = useWorkspace.getState().findingsText;
    expect(findings).toMatch(/transversely oriented C2 fracture/);
    expect(findings, say("after an update")).not.toMatch(/A C2 fracture is seen\./);
  });

  it("2. rewording one dictated finding leaves the other one exactly where it was", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [
          dictatedFinding(),
          {
            concept: "disc_contour",
            level: "C3-C4",
            findingsText: "A C3-C4 disc bulge is seen.",
            impressionText: "C3-C4 disc bulge.",
          },
        ],
      }),
      "a c2 fracture and a c3-c4 disc bulge",
    );
    const linesBefore = useWorkspace.getState().findingsText.split("\n");
    expect(linesBefore).toContain("A C3-C4 disc bulge is seen.");
    const voiced = useWorkspace.getState().voiceComposerObservations;
    const fracture = voiced.find((o) => o.concept === "vertebral_lesion")!;

    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [dictatedFinding({ operation: "update", targetObservationId: fracture.id, findingsText: dictationReworded })],
      }),
      "the fracture is transversely oriented",
    );

    const s = useWorkspace.getState();
    expect(s.findingsText, say("after rewording one of two")).not.toMatch(/A C2 fracture is seen\./);
    expect(s.findingsText).toMatch(/transversely oriented C2 fracture/);
    // Retiring only what the plan drops is what keeps the survivor's wording — and its
    // place — untouched. Strip-everything-then-replay would push it below the new line.
    const lines = s.findingsText.split("\n").filter((l) => l.trim());
    expect(lines.indexOf("A C3-C4 disc bulge is seen."), "the retained finding must not move below the correction")
      .toBeLessThan(lines.indexOf(dictationReworded));
    expect(s.impressionText.match(/C2 fracture\./g)?.length).toBe(1);
  });

  it("3. removing one of two dictated findings takes its finding and its conclusion out", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [
          dictatedFinding(),
          {
            concept: "disc_contour",
            level: "C3-C4",
            findingsText: "A C3-C4 disc bulge is seen.",
            impressionText: "C3-C4 disc bulge.",
          },
        ],
      }),
      "a c2 fracture and a c3-c4 disc bulge",
    );
    const voiced = useWorkspace.getState().voiceComposerObservations;
    const fracture = voiced.find((o) => o.concept === "vertebral_lesion")!;
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({ observations: [{ operation: "remove", concept: "vertebral_lesion", targetObservationId: fracture.id }] }),
        "scratch the fracture",
      ),
    ).toBe("applied");
    const s = useWorkspace.getState();
    expect(s.findingsText, say("after removing one of two")).not.toMatch(/A C2 fracture is seen\./);
    expect(s.impressionText).not.toMatch(/C2 fracture\./);
    // the finding that was NOT retracted survives intact, in place
    expect(s.findingsText).toMatch(/A C3-C4 disc bulge is seen\./);
    expect(s.impressionText).toMatch(/C3-C4 disc bulge\./);
  });

  it("4. correcting the level in dictation retires the wrong level's finding AND its conclusion", () => {
    useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ observations: [dictatedFinding()] }), "a c2 fracture");
    const voiced = useWorkspace.getState().voiceComposerObservations;
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [dictatedFinding({
          operation: "update",
          targetObservationId: voiced[0]!.id,
          level: "C4",
          findingsText: dictationCorrectedLevel,
          impressionText: "C4 fracture.",
        })],
      }),
      "sorry, C4 not C2",
    );
    const s = useWorkspace.getState();
    // A wrong level is a wrong operation: the retracted level must not stay printable.
    expect(s.findingsText, say("after a level correction")).not.toMatch(/C2 fracture/);
    expect(s.impressionText).not.toMatch(/C2 fracture/);
    expect(s.findingsText).toMatch(/A C4 fracture is seen\./);
    expect(s.impressionText).toMatch(/C4 fracture\./);
  });

  it("5. a dictation that corrects Findings and Impression together leaves one conclusion, and the dependency agrees with the reload", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({ observations: [dictatedFinding()] }),
      "a c2 fracture",
    );
    // The summary is dictated alongside the corrected finding.
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [dictatedFinding({ operation: "update", targetObservationId: useWorkspace.getState().voiceComposerObservations[0]!.id, findingsText: dictationReworded, impressionText: dictationReworded })],
      }),
      "correction, and put it in the impression",
    );
    const s = useWorkspace.getState();
    expect(s.findingsText).not.toMatch(/A C2 fracture is seen\./);
    expect(s.impressionText.match(/transversely oriented C2 fracture/g)?.length).toBe(1);
    const live = dictationAnswer();
    expect(reopenDictation(), "the session and the reopened report must answer alike").toEqual(live);
  });

  it("6. wording the radiologist typed by hand is not taken out with the dictation that repeats it", () => {
    // The radiologist writes the sentence first, then dictates a finding that happens to
    // carry the same wording. Retiring the dictated row must leave the typed sentence:
    // lifting the voice authorship to make the retire possible must not lift `manual` too.
    useWorkspace.getState().setField("findings", `${CORD_FINDINGS}\n${dictationFinding}`, { source: "manual" });
    expect(
      useWorkspace.getState().fieldProvenance.findings?.[
        Object.keys(useWorkspace.getState().fieldProvenance.findings ?? {}).find((k) => k.includes("c2 fracture")) ?? ""
      ],
      "the typed sentence must be manually authored",
    ).toContain("manual");

    // The dictation collides with the sentence already there, so this is the "Replace
    // anyway" the composer offers after a protected-conflict warning. Force lets the
    // dictation IN; it must not also let the later retire delete the typed sentence.
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({ observations: [dictatedFinding()] }),
        "a c2 fracture",
        { force: true },
      ),
    ).toBe("applied");
    const dictated = useWorkspace.getState().voiceComposerObservations[0]!;
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({ observations: [{ operation: "remove", concept: "vertebral_lesion", targetObservationId: dictated.id }] }),
        "scratch that dictated finding, I already wrote it",
      ),
    ).toBe("applied");

    const findings = useWorkspace.getState().findingsText;
    expect(
      findings.match(/A C2 fracture is seen\./g)?.length,
      say("after retiring a dictation the radiologist had typed already"),
    ).toBe(1);
  });

  it("7. the same dictation twice does not duplicate, reorder or re-conclude", () => {
    useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ observations: [dictatedFinding()] }), "a c2 fracture");
    const once = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      patches: useWorkspace.getState().appliedPathologyPatches.map((p) => p.id),
    };
    useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ observations: [dictatedFinding()] }), "a c2 fracture");
    const s = useWorkspace.getState();
    expect(s.findingsText, say("after the identical dictation twice")).toBe(once.findings);
    expect(s.impressionText).toBe(once.impression);
    expect(s.findingsText.match(/A C2 fracture is seen\./g)?.length).toBe(1);
    expect(s.appliedPathologyPatches.map((p) => p.id)).toEqual(once.patches);
  });

  it("8. save and reload carry the same clinical content and the same dependency answer", () => {
    useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ observations: [dictatedFinding()] }), "a c2 fracture");
    const voiced = useWorkspace.getState().voiceComposerObservations;
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [dictatedFinding({ operation: "update", targetObservationId: voiced[0]!.id, level: "C4", findingsText: dictationCorrectedLevel, impressionText: "C4 fracture." })],
      }),
      "sorry, C4 not C2",
    );
    const live = dictationAnswer();
    const liveFindings = useWorkspace.getState().findingsText;
    const liveImpression = useWorkspace.getState().impressionText;
    expect(reopenDictation()).toEqual(live);
    // and the reloaded report says the same clinical thing, so nothing re-appears on reopen
    expect(useWorkspace.getState().findingsText).toBe(liveFindings);
    expect(useWorkspace.getState().impressionText).toBe(liveImpression);
    expect(useWorkspace.getState().findingsText).not.toMatch(/C2 fracture/);
  });

  it("9. correcting one finding does not move the other one below prose typed after it", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [
          dictatedFinding(),
          {
            concept: "disc_contour",
            level: "C3-C4",
            findingsText: "A C3-C4 disc bulge is seen.",
            impressionText: "C3-C4 disc bulge.",
          },
        ],
      }),
      "a c2 fracture and a c3-c4 disc bulge",
    );
    const MANUAL_LINE = "No acute intracranial abnormality on these sequences (hand-typed correlation).";
    useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${MANUAL_LINE}`, {
      source: "manual",
    });
    const voiced = useWorkspace.getState().voiceComposerObservations;
    const fracture = voiced.find((o) => o.concept === "vertebral_lesion")!;
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({
          observations: [dictatedFinding({ operation: "update", targetObservationId: fracture.id, findingsText: dictationReworded })],
        }),
        "the fracture is transversely oriented",
      ),
    ).toBe("applied");

    const lines = useWorkspace.getState().findingsText.split("\n").filter((l) => l.trim());
    // Reading order is clinical order. Retiring the retained finding and letting the
    // replay re-append it would drop it below a sentence the radiologist wrote after it.
    expect(
      lines.indexOf("A C3-C4 disc bulge is seen."),
      say("after correcting the other finding"),
    ).toBeLessThan(lines.indexOf(MANUAL_LINE));
    expect(lines).toContain(dictationReworded);
    expect(lines).not.toContain(dictationFinding);
  });

  it("10. correcting one conclusion does not move the other below a line typed after it", () => {
    useWorkspace.getState().applyVoiceComposerPlan(
      dictationPlan({
        observations: [
          dictatedFinding(),
          {
            concept: "disc_contour",
            level: "C3-C4",
            findingsText: "A C3-C4 disc bulge is seen.",
            impressionText: "C3-C4 disc bulge.",
          },
        ],
      }),
      "a c2 fracture and a c3-c4 disc bulge",
    );
    const OWN_LINE = "Cervical cord compression is the dominant finding on this study";
    useWorkspace.getState().setField("impression", `${useWorkspace.getState().impressionText}\n${OWN_LINE}`, {
      source: "manual",
    });
    const voiced = useWorkspace.getState().voiceComposerObservations;
    const fracture = voiced.find((o) => o.concept === "vertebral_lesion")!;
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(
        dictationPlan({
          observations: [dictatedFinding({
            operation: "update",
            targetObservationId: fracture.id,
            findingsText: dictationReworded,
            impressionText: "Transverse C2 fracture.",
          })],
        }),
        "the fracture is transversely oriented",
      ),
    ).toBe("applied");

    const s = useWorkspace.getState();
    const lines = s.impressionText.split("\n").filter((l) => l.trim());
    expect(lines, say("after correcting one conclusion")).toContain("C3-C4 disc bulge.");
    expect(lines.indexOf("C3-C4 disc bulge.")).toBeLessThan(lines.indexOf(OWN_LINE));
    expect(lines).toContain("Transverse C2 fracture.");
    expect(lines).not.toContain("C2 fracture.");
  });

  it("11. re-dictating the same summary after the findings moved re-pairs rather than repeating itself", () => {
    const SUMMARY = "The dominant finding is the C5-C6 disc herniation with cord compression.";
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ impressionUpdate: SUMMARY }), "the dominant finding is the disc herniation"),
    ).toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);

    // The findings then move past that summary.
    useWorkspace.getState().setField("findings", `${CORD_FINDINGS} There is also a C2 fracture.`, { source: "manual" });
    expect(dictationAnswer().reasons).toContain("findings-changed");

    // The radiologist dictates the same words again — the merge has nothing new to write,
    // so only the door's own decision can record the pairing they are re-affirming.
    expect(
      useWorkspace.getState().applyVoiceComposerPlan(dictationPlan({ impressionUpdate: SUMMARY }), "the dominant finding is the disc herniation"),
    ).toBe("applied");
    const live = dictationAnswer();
    expect(live, `a re-dictated summary is a re-read of the same words: ${JSON.stringify(live)}`).toEqual({
      needsRefresh: false,
      reasons: [],
    });
    expect(reopenDictation()).toEqual(live);
  });
});
