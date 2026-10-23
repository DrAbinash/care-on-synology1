/**
 * Contradiction warnings in the dictation session fold.
 *
 * The server attaches advisory warnings to the compose result; the session
 * is what the radiologist SEES, so the warnings must land on the accepted
 * turn (the review surface) and nowhere else: they create no pending
 * changes, no removals, no impression candidates — reading them is the
 * action, Apply stays the only write.
 */
import { describe, expect, it } from "vitest";
import {
  foldComposeTurn,
  newSmartDictationSession,
  sessionHasPending,
} from "./smartDictationSession";
import type { VoiceChangePlan } from "./types";

function planWithOneFinding(): VoiceChangePlan {
  return {
    operation: "report_change_plan",
    observations: [
      {
        concept: "disc_herniation",
        level: "L4-L5",
        laterality: "left",
        findingsText: "Large left paracentral disc herniation at L4-L5.",
      },
    ],
    removeConflictingBaselineConcepts: [],
    impressionCandidates: [],
    uncertainties: [],
    clarificationRequired: null,
  };
}

describe("contradiction warnings fold onto the accepted turn", () => {
  it("a warned compose lands its warnings on the accepted turn, visible for review", () => {
    const session = newSmartDictationSession();
    const folded = foldComposeTurn(session, "herniation at L4-5", {
      ok: true,
      plan: planWithOneFinding(),
      warnings: [
        {
          code: "impression_negates_finding",
          message: "Impression denies disc herniation but Findings document it — check before Apply.",
        },
      ],
    });

    expect(folded.error).toBeNull();
    const turn = folded.session.turns[0];
    expect(turn.status).toBe("accepted");
    expect(turn.warnings).toHaveLength(1);
    expect(turn.warnings![0].code).toBe("impression_negates_finding");
    expect(turn.warnings![0].message).toContain("herniation");
  });

  it("warnings are inert — no pending changes, no removals, no impression edits", () => {
    const session = newSmartDictationSession();
    const folded = foldComposeTurn(session, "herniation at L4-5", {
      ok: true,
      plan: planWithOneFinding(),
      warnings: [
        { code: "severity_conflict", message: "Severity conflict — canal stenosis: mild vs severe.", concept: "canal_stenosis" },
      ],
    });

    // The plan's own observation is pending; the warning adds nothing.
    expect(folded.session.observations.size).toBe(1);
    expect(folded.session.pendingRemovals.size).toBe(0);
    expect(folded.session.impressionCandidates).toEqual([]);
    expect(sessionHasPending(folded.session)).toBe(true);
  });

  it("a clean compose leaves the turn without warnings — absence means clean", () => {
    const session = newSmartDictationSession();
    const folded = foldComposeTurn(session, "herniation at L4-5", {
      ok: true,
      plan: planWithOneFinding(),
    });
    expect(folded.session.turns[0].warnings).toBeUndefined();
  });

  it("failed turns never carry warnings — there is no plan to check", () => {
    const session = newSmartDictationSession();
    const folded = foldComposeTurn(session, "herniation at L4-5", {
      ok: false,
      error: "Local composer unavailable — dictation preserved",
    });
    expect(folded.session.turns[0].status).toBe("error");
    expect(folded.session.turns[0].warnings).toBeUndefined();
  });

  it("a later clean turn does not inherit an earlier turn's warnings", () => {
    let session = newSmartDictationSession();
    session = foldComposeTurn(session, "herniation at L4-5", {
      ok: true,
      plan: planWithOneFinding(),
      warnings: [{ code: "impression_negates_finding", message: "Impression denies disc herniation but Findings document it." }],
    }).session;
    session = foldComposeTurn(session, "desiccation at L3-4", {
      ok: true,
      plan: {
        operation: "report_change_plan",
        observations: [
          { concept: "disc_desiccation", level: "L3-L4", findingsText: "Disc desiccation at L3-L4." },
        ],
        removeConflictingBaselineConcepts: [],
        impressionCandidates: [],
        uncertainties: [],
        clarificationRequired: null,
      },
    }).session;

    expect(session.turns[0].warnings).toHaveLength(1);
    expect(session.turns[1].warnings).toBeUndefined();
  });
});
