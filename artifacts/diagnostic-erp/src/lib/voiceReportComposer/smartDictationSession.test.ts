/**
 * Smart Dictation session — frontend regression suite (Task 15, Part E).
 *
 * Pins the ChatGPT-style session contract the owner specified:
 *   - dictate multiple findings naturally → ONE consolidated plan
 *   - corrections fold conversationally ("remove X", "make X moderate on the left")
 *   - Apply writes everything through the SAME applyChangePlan engine
 *   - clinician-owned text, unrelated normals, measurements and identity are
 *     never touched; nothing is invented.
 * Plus the six-exam gate (Brain / LS Spine / Cervical Spine complete + the
 * three screening protocols).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyTurnToSession,
  buildConsolidatedPlan,
  newSmartDictationSession,
  sessionHasPending,
  sessionObservations,
  smartDictationSupportedForStudy,
} from "./smartDictationSession";
import { applyChangePlan } from "./applyChangePlan";
import type { VoiceChangePlan, VoiceObservation } from "./types";
import { useWorkspace } from "../zai-workspace/store";

function addPlan(...observations: VoiceObservation[]): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: observations.map((o) => ({ ...o, operation: "add" })),
    uncertainties: [],
    clarificationRequired: null,
  };
}

function removePlan(target: string, concept: string, findingsText: string): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: [{
      concept,
      findingsText,
      operation: "remove",
      targetObservationId: target,
    }],
    uncertainties: [],
    clarificationRequired: null,
  };
}

const desiccation: VoiceObservation = {
  id: "obs_disc_desiccation_L3-L4",
  concept: "disc_desiccation",
  level: "L3-L4",
  findingsText: "Loss of T2 signal (desiccation) of the L3-L4 disc.",
  impressionText: "Disc desiccation at L3-L4.",
  anatomicalSection: "disc",
  conflictGroup: "disc_desiccation_L3-L4",
};

const lf: VoiceObservation = {
  id: "obs_ligamentum_flavum_hypertrophy_L4-L5",
  concept: "ligamentum_flavum_hypertrophy",
  level: "L4-L5",
  findingsText: "Ligamentum flavum hypertrophy at L4-L5.",
  impressionText: "Ligamentum flavum hypertrophy at L4-L5.",
  anatomicalSection: "ligamentum",
  conflictGroup: "ligamentum_flavum_L4-L5",
};

// The disc family carries the disc baseline — exactly like the Quick Select
// "Disc bulge (pick level)" tile whose wording the dictation reuses.
const bulge: VoiceObservation = {
  id: "obs_disc_bulge_L4-L5",
  concept: "disc_bulge",
  level: "L4-L5",
  findingsText: "Disc bulge at L4-L5 without nerve root compression.",
  impressionText: "Disc bulge at L4-L5 without nerve root compression.",
  anatomicalSection: "disc",
  conflictGroup: "disc bulge",
  baselineReplaces: "No significant disc bulge",
};

describe("smartDictationSession — six-exam gate", () => {
  it("admits the six MRI examinations (complete + screening share regions)", () => {
    expect(smartDictationSupportedForStudy("Brain", "MR")).toBe(true);
    expect(smartDictationSupportedForStudy("LS Spine", "MRI")).toBe(true);
    expect(smartDictationSupportedForStudy("Cervical Spine", "MR")).toBe(true);
    // Screening protocols resolve to the same region names.
    expect(smartDictationSupportedForStudy("LS Spine", "MR")).toBe(true);
    expect(smartDictationSupportedForStudy("Cervical Spine", "MR")).toBe(true);
    expect(smartDictationSupportedForStudy("Whole Spine", "MR")).toBe(true);
  });

  it("refuses USG, CT, X-ray, standalone dorsal and empty regions", () => {
    expect(smartDictationSupportedForStudy("Whole Abdomen", "USG")).toBe(false);
    expect(smartDictationSupportedForStudy("Brain", "USG")).toBe(false);
    expect(smartDictationSupportedForStudy("Chest", "CT")).toBe(false);
    expect(smartDictationSupportedForStudy("Chest", "XR")).toBe(false);
    expect(smartDictationSupportedForStudy("Dorsal Spine", "MR")).toBe(false);
    expect(smartDictationSupportedForStudy(null, "MR")).toBe(false);
    expect(smartDictationSupportedForStudy("Knee", "MR")).toBe(false);
  });
});

describe("smartDictationSession — accumulation", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: "Multiplanar multisequence MRI of the lumbosacral spine.",
      findingsText:
        "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge.",
      impressionText: "Normal MRI lumbar spine.",
      recommendationText: "",
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      lastPatchSnapshot: null,
      isDirty: false,
    });
  });

  it("multiple dictated turns accumulate into ONE consolidated set", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    s = applyTurnToSession(s, "Disc bulge at L4-5.", addPlan(bulge));
    s = applyTurnToSession(s, "Ligamentum flavum hypertrophy at L4-5.", addPlan(lf));

    expect(s.turns).toHaveLength(3);
    expect(s.turns.every((t) => t.status === "accepted")).toBe(true);
    expect(sessionHasPending(s)).toBe(true);
    expect(sessionObservations(s)).toHaveLength(3);

    const consolidated = buildConsolidatedPlan(s);
    expect(consolidated.operation).toBe("report_change_plan");
    expect(consolidated.observations).toHaveLength(3);
    expect(consolidated.observations.every((o) => o.operation === "add")).toBe(true);
    // Baseline retirements ride along once, on apply.
    expect(consolidated.removeConflictingBaselineConcepts).toContain("No significant disc bulge");
  });

  it('conversational correction "remove ligamentum flavum hypertrophy" drops it from the session', () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    s = applyTurnToSession(s, "Ligamentum flavum hypertrophy at L4-5.", addPlan(lf));
    s = applyTurnToSession(
      s,
      "remove ligamentum flavum hypertrophy",
      removePlan("obs_ligamentum_flavum_hypertrophy_L4-L5", "ligamentum_flavum_hypertrophy", "Ligamentum flavum hypertrophy at L4-L5."),
    );

    const turn = s.turns[2];
    expect(turn.status).toBe("accepted");
    expect(turn.summary?.[0]).toMatch(/Removed — Ligamentum flavum/);
    expect(sessionObservations(s).map((o) => o.concept)).toEqual(["disc_desiccation"]);
    // The turn transcript log still carries the correction for provenance.
    expect(s.transcriptLog).toHaveLength(3);
  });

  it("an update turn replaces the accumulated wording (severity correction)", () => {
    const moderateStenosis: VoiceObservation = {
      id: "obs_foraminal_stenosis_L4-L5",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      severity: "moderate",
      laterality: "left",
      findingsText: "Moderate left neural foraminal stenosis at L4-L5.",
      anatomicalSection: "foramina",
      conflictGroup: "foraminal_stenosis_L4-L5",
    };
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Mild foraminal narrowing at L4-5.", addPlan({
      id: "obs_foraminal_stenosis_L4-L5",
      concept: "foraminal_stenosis",
      level: "L4-L5",
      severity: "mild",
      laterality: "bilateral",
      findingsText: "Mild bilateral neural foraminal stenosis at L4-L5.",
      anatomicalSection: "foramina",
      conflictGroup: "foraminal_stenosis_L4-L5",
    }));
    s = applyTurnToSession(
      s,
      "make L4-L5 narrowing moderate on the left",
      {
        operation: "report_change_plan",
        observations: [{ ...moderateStenosis, operation: "update", targetObservationId: "obs_foraminal_stenosis_L4-L5" }],
        uncertainties: [],
        clarificationRequired: null,
      },
    );

    const obs = sessionObservations(s);
    expect(obs).toHaveLength(1);
    expect(obs[0].findingsText).toBe("Moderate left neural foraminal stenosis at L4-L5.");
    expect(obs[0].severity).toBe("moderate");
    expect(obs[0].laterality).toBe("left");
  });

  it("clarification turns change nothing (zero mutation)", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    s = applyTurnToSession(s, "remove something odd", {
      operation: "report_change_plan",
      observations: [],
      uncertainties: [],
      clarificationRequired: "Nothing matching 'something odd' was dictated — nothing removed",
    });

    expect(s.turns[1].status).toBe("clarification");
    expect(s.turns[1].note).toMatch(/nothing matching/i);
    expect(sessionObservations(s)).toHaveLength(1);
    expect(s.transcriptLog).toHaveLength(1); // the clarification never logs as applied
  });

  it("composer errors change nothing and surface as error turns", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "hello", null, { error: "Local composer unavailable — dictation preserved" });
    expect(s.turns[0].status).toBe("error");
    expect(sessionHasPending(s)).toBe(false);
  });
});

describe("smartDictationSession — consolidated apply through the real engine", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: "Multiplanar multisequence MRI of the lumbosacral spine.",
      findingsText:
        "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge.\nManually typed by the radiologist: mild facet pain, correlate clinically.",
      impressionText: "Normal MRI lumbar spine.",
      recommendationText: "",
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      lastPatchSnapshot: null,
      isDirty: false,
    });
  });

  it("Apply-all writes every finding once and retires only the contradicted normal", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    s = applyTurnToSession(s, "Disc bulge at L4-5.", addPlan(bulge));
    s = applyTurnToSession(s, "Ligamentum flavum hypertrophy at L4-5.", addPlan(lf));

    const state = useWorkspace.getState();
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: state.clinicalHistoryText,
        technique: state.techniqueText,
        findings: state.findingsText,
        impression: state.impressionText,
        recommendation: state.recommendationText,
      },
      provenance: state.fieldProvenance,
      plan: buildConsolidatedPlan(s),
      activeObservations: state.voiceComposerObservations,
    });

    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toContain(
      "Loss of T2 signal (desiccation) of the L3-L4 disc.",
    );
    expect(result.narrative!.findings).toContain(
      "Ligamentum flavum hypertrophy at L4-L5.",
    );
    expect(result.narrative!.findings).toContain(
      "Disc bulge at L4-L5 without nerve root compression.",
    );
    // The contradicted normal retired...
    expect(result.narrative!.findings).not.toContain("No significant disc bulge.");
    // ...but the unrelated normals and the clinician's own line survive.
    expect(result.narrative!.findings).toContain("normal alignment and marrow signal");
    expect(result.narrative!.findings).toContain("Manually typed by the radiologist");
    // The ledger carries exactly the accumulated set for later corrections.
    expect(result.activeObservations).toHaveLength(3);
  });

  it("a post-apply correction plan removes exactly its target from the report", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    s = applyTurnToSession(s, "Ligamentum flavum hypertrophy at L4-5.", addPlan(lf));

    const state = useWorkspace.getState();
    const first = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: state.techniqueText,
        findings: "Lumbar vertebrae show normal alignment and marrow signal. No significant disc bulge.",
        impression: "Normal MRI lumbar spine.",
        recommendation: "",
      },
      provenance: {},
      plan: buildConsolidatedPlan(s),
      activeObservations: [],
    });
    expect(first.ok).toBe(true);

    // "remove ligamentum flavum hypertrophy" — a single-turn plan against the ledger.
    const second = applyChangePlan({
      narrative: first.narrative!,
      provenance: first.provenance!,
      plan: removePlan(
        "obs_ligamentum_flavum_hypertrophy_L4-L5",
        "ligamentum_flavum_hypertrophy",
        "Ligamentum flavum hypertrophy at L4-L5.",
      ),
      activeObservations: first.activeObservations!,
    });

    expect(second.ok).toBe(true);
    expect(second.narrative!.findings).not.toContain("Ligamentum flavum hypertrophy at L4-L5.");
    expect(second.narrative!.findings).toContain(
      "Loss of T2 signal (desiccation) of the L3-L4 disc.",
    );
    expect(second.activeObservations!.map((o) => o.concept)).toEqual(["disc_desiccation"]);
  });

  it("measurements and identity fields are never part of a consolidated plan", () => {
    let s = newSmartDictationSession();
    s = applyTurnToSession(s, "Disc desiccation at L3-4.", addPlan(desiccation));
    const plan = buildConsolidatedPlan(s);
    for (const obs of plan.observations) {
      expect(/\d+(\.\d+)?\s*(mm|cm)\b/i.test(obs.findingsText)).toBe(false);
      expect(obs.findingsText).not.toMatch(/patient|uhid|name|age|sex/i);
    }
    // The plan never touches technique/history/recommendation sections.
    expect(JSON.stringify(plan)).not.toMatch(/techniqueText|clinicalHistory|recommendationText/);
  });
});
