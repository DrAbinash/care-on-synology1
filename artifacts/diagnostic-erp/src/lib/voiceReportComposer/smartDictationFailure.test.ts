/**
 * Smart Dictation — failed-turn preservation contract (Dream-2 follow-up).
 *
 * The owner's rule: a dictation turn that fails — provider down, timeout,
 * or a plan production would refuse — must NEVER silently discard the
 * radiologist's words. The failure half of the compose turn is folded through
 * the SAME session mechanism as success (applyTurnToSession with an error
 * note), so the words stay visible in the conversation thread and nothing
 * else mutates: no observations, no pending removals, no baseline
 * retirements, no transcript-log provenance, and therefore nothing for the
 * Apply button to write into the clinical report.
 *
 * These tests pin the fold every failure shape the production route can
 * answer with (voiceReportComposer.ts /compose):
 *   - provider failure / timeout  -> { ok:false, error, phraseFallbackAvailable: !usePhraseFallback }
 *   - validation refusal          -> { ok:false, error: reason, phraseFallbackAvailable: false }
 *   - network throw / abort (client catch) -> DICTATION_PRESERVED_MSG
 * plus the retry story: the last failed turn is the retry source, a retry
 * that succeeds applies cleanly, and repeated failures accumulate — never
 * overwrite, never lose a dictated line.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  DICTATION_PRESERVED_MSG,
  buildConsolidatedPlan,
  dictationFailureMessage,
  foldComposeTurn,
  lastErrorTurn,
  newSmartDictationSession,
  sessionHasPending,
  sessionObservations,
  type ComposeOutcome,
} from "./smartDictationSession";
import { applyChangePlan } from "./applyChangePlan";
import type { VoiceChangePlan, VoiceObservation } from "./types";
import { useWorkspace } from "../zai-workspace/store";

const desiccation: VoiceObservation = {
  id: "obs_disc_desiccation_L3-L4",
  concept: "disc_desiccation",
  level: "L3-L4",
  findingsText: "Loss of T2 signal (desiccation) of the L3-L4 disc.",
  impressionText: "Disc desiccation at L3-L4.",
  anatomicalSection: "disc",
  conflictGroup: "disc_desiccation_L3-L4",
};

function addPlan(...observations: VoiceObservation[]): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: observations.map((o) => ({ ...o, operation: "add" })),
    uncertainties: [],
    clarificationRequired: null,
  };
}

const BASELINE_FINDINGS =
  "Lumbar vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No significant disc bulge.";

describe("foldComposeTurn — failure preservation", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: "Multiplanar multisequence MRI of the lumbosacral spine.",
      findingsText: BASELINE_FINDINGS,
      impressionText: "Normal MRI lumbar spine.",
      recommendationText: "",
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      lastPatchSnapshot: null,
      isDirty: false,
    });
  });

  it("provider failure: appends an error turn carrying the words verbatim, changes nothing else", () => {
    const words = "Disc desiccation at L3-4 with loss of T2 signal.";
    const s0 = newSmartDictationSession();
    const outcome: ComposeOutcome = {
      ok: false,
      error: "Local AI unavailable",
      phraseFallbackAvailable: true,
    };

    const folded = foldComposeTurn(s0, words, outcome);

    // The words are visible in the thread, verbatim, flagged as an error turn.
    expect(folded.session.turns).toHaveLength(1);
    const turn = folded.session.turns[0];
    expect(turn.transcript).toBe(words);
    expect(turn.status).toBe("error");
    expect(turn.note).toBe("Local AI unavailable");

    // The error surfaces for the banner; phrase retry is offered (route contract).
    expect(folded.error).toBe("Local AI unavailable");
    expect(folded.phraseFallbackAvailable).toBe(true);

    // Zero mutation: nothing pending, nothing for Apply to write.
    expect(folded.session.observations.size).toBe(0);
    expect(folded.session.pendingRemovals.size).toBe(0);
    expect(folded.session.baselineRetirements.size).toBe(0);
    expect(folded.session.impressionCandidates).toEqual([]);
    expect(folded.session.transcriptLog).toEqual([]);
    expect(sessionHasPending(folded.session)).toBe(false);
    expect(lastErrorTurn(folded.session)?.transcript).toBe(words);
  });

  it("validation refusal: same preservation, but NO phrase-catalog retry is offered", () => {
    const words = "Mild canal stenosis at L4-L5 measuring 9.2 mm.";
    const folded = foldComposeTurn(newSmartDictationSession(), words, {
      ok: false,
      error: "Plan validation refused the composer output",
      phraseFallbackAvailable: false, // routes/voiceReportComposer.ts:176
    });

    expect(folded.session.turns[0].status).toBe("error");
    expect(folded.session.turns[0].transcript).toBe(words);
    expect(folded.error).toBe("Plan validation refused the composer output");
    expect(folded.phraseFallbackAvailable).toBe(false);
    expect(folded.session.observations.size).toBe(0);
    expect(sessionHasPending(folded.session)).toBe(false);
  });

  it("timeout / network throw (client catch shape): preserved with the standard message", () => {
    const words = "Ligamentum flavum hypertrophy at L4-L5 causing canal stenosis.";
    const folded = foldComposeTurn(newSmartDictationSession(), words, {
      ok: false,
      error: DICTATION_PRESERVED_MSG,
    });

    expect(folded.session.turns[0].transcript).toBe(words);
    expect(folded.session.turns[0].status).toBe("error");
    expect(folded.session.turns[0].note).toBe(DICTATION_PRESERVED_MSG);
    expect(folded.phraseFallbackAvailable).toBe(false);
    expect(folded.session.transcriptLog).toEqual([]);
  });

  it("ok:true without a plan is a failure, not a silent no-op", () => {
    const words = "Small focal disc protrusion at L5-S1.";
    // Defensive route shape: ok true but plan absent must not be treated as success.
    const folded = foldComposeTurn(newSmartDictationSession(), words, {
      ok: true,
      plan: null as unknown as VoiceChangePlan,
    });

    // The fold cannot invent a turn from nothing: the hook is expected to
    // normalise this shape to a failure outcome BEFORE folding; if it ever
    // passes it through, the session must still not lose the words silently —
    // the session itself files it as "No change plan returned".
    expect(folded.session.turns).toHaveLength(1);
    expect(folded.session.turns[0].status).toBe("error");
    expect(folded.session.turns[0].transcript).toBe(words);
    expect(folded.session.turns[0].note).toBe("No change plan returned — dictation preserved");
    expect(folded.session.observations.size).toBe(0);
  });

  it("repeated failures accumulate — earlier dictations are never overwritten or lost", () => {
    const first = "Disc desiccation at L3-4.";
    const second = "Diffuse disc bulge at L4-L5.";

    let s = newSmartDictationSession();
    s = foldComposeTurn(s, first, { ok: false, error: DICTATION_PRESERVED_MSG }).session;
    s = foldComposeTurn(s, second, { ok: false, error: "Still warming up" }).session;

    expect(s.turns).toHaveLength(2);
    expect(s.turns[0].transcript).toBe(first);
    expect(s.turns[1].transcript).toBe(second);
    expect(s.turns.map((t) => t.status)).toEqual(["error", "error"]);
    // The retry source is the LAST failed turn — but the first line is still
    // right there in the thread, visible and intact.
    expect(lastErrorTurn(s)?.transcript).toBe(second);
    expect(sessionHasPending(s)).toBe(false);
  });

  it("retry that succeeds: accepted turn lands after the error turn, provenance logs ONE copy", () => {
    const words = "Disc desiccation at L3-4.";
    let s = newSmartDictationSession();
    s = foldComposeTurn(s, words, { ok: false, error: DICTATION_PRESERVED_MSG }).session;
    // Radiologist hits Retry — the SAME transcript, not a re-dictation.
    s = foldComposeTurn(s, words, { ok: true, plan: addPlan(desiccation) }).session;

    expect(s.turns).toHaveLength(2);
    expect(s.turns[0].status).toBe("error");
    expect(s.turns[1].status).toBe("accepted");
    expect(s.turns[1].transcript).toBe(words);

    // Only the accepted attempt becomes provenance — one copy, not two.
    expect(s.transcriptLog).toEqual([words]);

    // The consolidated plan carries exactly the accepted observation.
    const plan = buildConsolidatedPlan(s);
    expect(plan.observations).toHaveLength(1);
    expect(plan.observations[0].concept).toBe("disc_desiccation");
    expect(sessionObservations(s)).toHaveLength(1);
  });

  it("retry failing again re-preserves the words — the thread grows, nothing disappears", () => {
    const words = "Mild canal stenosis at L4-L5.";
    let s = newSmartDictationSession();
    s = foldComposeTurn(s, words, { ok: false, error: DICTATION_PRESERVED_MSG }).session;
    s = foldComposeTurn(s, words, { ok: false, error: "Timed out again" }).session;

    expect(s.turns).toHaveLength(2);
    expect(s.turns.every((t) => t.transcript === words)).toBe(true);
    expect(s.turns[1].note).toBe("Timed out again");
    expect(lastErrorTurn(s)?.transcript).toBe(words);
    expect(sessionHasPending(s)).toBe(false);
  });

  it("failure-only session consolidates to an EMPTY plan — the clinical report is untouched", () => {
    let s = newSmartDictationSession();
    s = foldComposeTurn(s, "Disc desiccation at L3-4.", { ok: false, error: DICTATION_PRESERVED_MSG }).session;
    s = foldComposeTurn(s, "Diffuse disc bulge at L4-L5.", { ok: false, error: DICTATION_PRESERVED_MSG }).session;

    const plan = buildConsolidatedPlan(s);
    expect(plan.observations).toEqual([]);
    expect(plan.removeConflictingBaselineConcepts).toEqual([]);
    expect(plan.impressionCandidates).toEqual([]);

    // And through the SAME apply engine the Apply button uses: no change.
    const applied = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: "Multiplanar multisequence MRI of the lumbosacral spine.",
        findings: BASELINE_FINDINGS,
        impression: "Normal MRI lumbar spine.",
        recommendation: "",
      },
      provenance: {},
      plan,
      activeObservations: [],
    });
    expect(applied.ok).toBe(true);
    expect(applied.narrative?.findings).toBe(BASELINE_FINDINGS);
    expect(applied.narrative?.impression).toBe("Normal MRI lumbar spine.");
    expect(applied.replacedBaselines).toEqual([]);
    expect(applied.addedObservations).toEqual([]);
  });

  it("empty transcript folds to a no-op (the hook never sends empty turns)", () => {
    const s0 = newSmartDictationSession();
    const folded = foldComposeTurn(s0, "   ", { ok: false, error: DICTATION_PRESERVED_MSG });
    expect(folded.session).toBe(s0);
    expect(folded.error).toBeNull();
  });
});

describe("lastErrorTurn — retry source", () => {
  it("is null on a fresh session and after a successful turn", () => {
    expect(lastErrorTurn(newSmartDictationSession())).toBeNull();

    const s = foldComposeTurn(newSmartDictationSession(), "Disc desiccation at L3-4.", {
      ok: true,
      plan: addPlan(desiccation),
    }).session;
    expect(lastErrorTurn(s)).toBeNull();
  });

  it("ignores accepted turns that follow a failure — only a TRAILING error is retryable", () => {
    let s = newSmartDictationSession();
    s = foldComposeTurn(s, "First attempt.", { ok: false, error: DICTATION_PRESERVED_MSG }).session;
    s = foldComposeTurn(s, "First attempt.", { ok: true, plan: addPlan(desiccation) }).session;

    // The retry died when a later turn succeeded — retrying would duplicate.
    expect(lastErrorTurn(s)).toBeNull();
  });
});

describe("dictationFailureMessage — reason-code UX", () => {
  // The server answers "Local composer unavailable" for EVERY provider
  // failure; the reason code rides in diagnostics.failureReason. The panel
  // must translate the code into what the single radiologist should DO —
  // without losing the preservation promise ("dictation preserved") that
  // the whole session mechanism guarantees.
  const GENERIC = "Local composer unavailable — dictation preserved";

  it("timeout: says retry will be faster (the model is now warm)", () => {
    const m = dictationFailureMessage(GENERIC, "timeout");
    expect(m).toMatch(/[Rr]etry/);
    expect(m).toMatch(/warm/i);
    expect(m).toMatch(/preserved/i);
    expect(m).not.toContain("Local composer unavailable");
  });

  it("network: names the AI PC / Ollama service as the thing to check", () => {
    const m = dictationFailureMessage(GENERIC, "network");
    expect(m).toMatch(/Ollama|AI PC/);
    expect(m).toMatch(/preserved/i);
  });

  it("model_not_found: names the missing model, keeps the words", () => {
    const m = dictationFailureMessage(GENERIC, "model_not_found");
    expect(m).toMatch(/model/i);
    expect(m).toMatch(/preserved/i);
  });

  it("schema_invalid: a malformed model output is retryable, not the radiologist's fault", () => {
    const m = dictationFailureMessage("Invalid structured response — dictation preserved", "schema_invalid");
    expect(m).toMatch(/malformed|invalid/i);
    expect(m).toMatch(/[Rr]etry/);
    expect(m).toMatch(/preserved/i);
  });

  it("http_5xx: a server error on the Ollama side", () => {
    const m = dictationFailureMessage(GENERIC, "http_500");
    expect(m).toMatch(/server error|Ollama/i);
    expect(m).toMatch(/preserved/i);
  });

  it("server-authored reasons (validation, fidelity) pass through untouched", () => {
    const reason = "Dictated detail dropped: 9.2 mm — dictation preserved for review";
    expect(dictationFailureMessage(reason, "dictated_detail_dropped")).toBe(reason);
    expect(dictationFailureMessage("Some validation reason", undefined)).toBe("Some validation reason");
  });

  it("unknown codes and missing errors fall back to the preservation promise", () => {
    expect(dictationFailureMessage(undefined, undefined)).toBe(DICTATION_PRESERVED_MSG);
    expect(dictationFailureMessage(undefined, "something_new")).toBe(DICTATION_PRESERVED_MSG);
  });
});
