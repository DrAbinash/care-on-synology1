import { describe, expect, it } from "vitest";
import {
  classifyFinalizeMatch,
  matchAllowsFinalize,
  pickUniqueRow,
} from "./radiologyIdentity";
import { selectUniqueAutoLinkCandidate } from "./pacs/worklistBillingLink";
import { pickExactHopeReferralOrderId } from "../services/integration/emitReportToHope";

describe("radiology identity helpers", () => {
  it("pickUniqueRow distinguishes none / unique / ambiguous", () => {
    expect(pickUniqueRow([]).status).toBe("none");
    expect(pickUniqueRow([{ id: 1 }])).toEqual({ status: "unique", row: { id: 1 } });
    expect(pickUniqueRow([{ id: 1 }, { id: 2 }])).toEqual({ status: "ambiguous", count: 2 });
  });

  it("matchAllowsFinalize permits GREEN, YELLOW or APPROVED (owner policy A3)", () => {
    expect(matchAllowsFinalize({ matchScore: "GREEN", matchDecision: "PENDING" })).toBe(true);
    expect(matchAllowsFinalize({ matchScore: "RED", matchDecision: "APPROVED" })).toBe(true);
    // A3: YELLOW is a consistent-but-incomplete association (typically
    // accessionless USG with a slight name-spelling difference). No identity
    // contradiction is present, so it must not block finalize.
    expect(matchAllowsFinalize({ matchScore: "YELLOW", matchDecision: "PENDING" })).toBe(true);
    expect(matchAllowsFinalize({ matchScore: "RED", matchDecision: "PENDING" })).toBe(false);
  });

  it("classifyFinalizeMatch refuses a REJECTED decision even on a high score", () => {
    expect(classifyFinalizeMatch({ matchScore: "GREEN", matchDecision: "REJECTED" })).toBe("REFUSED");
    expect(classifyFinalizeMatch({ matchScore: "GREEN", matchDecision: "APPROVED" })).toBe("ALLOWED");
  });

  it("classifyFinalizeMatch allows YELLOW but refuses RED", () => {
    expect(classifyFinalizeMatch({ matchScore: "YELLOW", matchDecision: "PENDING" })).toBe("ALLOWED");
    expect(classifyFinalizeMatch({ matchScore: "RED", matchDecision: "PENDING" })).toBe("REFUSED");
  });

  it("classifyFinalizeMatch fails closed for partial shapes (no CONFIRM_UNLINKED escape)", () => {
    // Tests and partial callers pass only matchScore/matchDecision — they must
    // never reach the unlinked confirmation path, exactly like the old gate.
    expect(classifyFinalizeMatch({ matchScore: "NO_LINKED_STUDY", matchDecision: "PENDING" })).toBe("REFUSED");
    expect(matchAllowsFinalize({ matchScore: "NO_LINKED_STUDY", matchDecision: "PENDING" })).toBe(false);
  });

  it("classifyFinalizeMatch classifies an unlinked row without contradiction as CONFIRM_UNLINKED", () => {
    expect(
      classifyFinalizeMatch({
        matchScore: "NO_LINKED_STUDY",
        matchDecision: "PENDING",
        matchWarnings: ["NO_LINKED_STUDY"],
        hasLinkedStudy: false,
      }),
    ).toBe("CONFIRM_UNLINKED");
    // No explicit confirm → boolean gate still blocks.
    expect(
      matchAllowsFinalize({
        matchScore: "NO_LINKED_STUDY",
        matchDecision: "PENDING",
        matchWarnings: ["NO_LINKED_STUDY"],
        hasLinkedStudy: false,
      }),
    ).toBe(false);
  });

  it("classifyFinalizeMatch refuses an unlinked row carrying a contradictory warning", () => {
    expect(
      classifyFinalizeMatch({
        matchScore: "RED",
        matchDecision: "PENDING",
        matchWarnings: ["MODALITY_MISMATCH", "NO_LINKED_STUDY"],
        hasLinkedStudy: false,
      }),
    ).toBe("REFUSED");
    expect(
      classifyFinalizeMatch({
        matchScore: "NO_LINKED_STUDY",
        matchDecision: "PENDING",
        matchWarnings: JSON.stringify(["NAME_MISMATCH"]),
        hasLinkedStudy: false,
      }),
    ).toBe("REFUSED");
  });
});

describe("fuzzy billed-study auto-link", () => {
  it("links a single eligible candidate", () => {
    expect(selectUniqueAutoLinkCandidate([{ studyId: 9, points: 50, score: "GREEN" }])?.studyId).toBe(9);
  });

  it("does not guess when two same-patient studies are close", () => {
    expect(
      selectUniqueAutoLinkCandidate([
        { studyId: 1, points: 60, score: "GREEN" },
        { studyId: 2, points: 55, score: "YELLOW" },
      ]),
    ).toBeNull();
  });

  it("links a unique GREEN winner with a >=20 point gap", () => {
    expect(
      selectUniqueAutoLinkCandidate([
        { studyId: 1, points: 80, score: "GREEN" },
        { studyId: 2, points: 50, score: "YELLOW" },
      ])?.studyId,
    ).toBe(1);
  });
});

describe("HOPE referral order binding", () => {
  it("prefers the report order over a billed-study order", () => {
    expect(pickExactHopeReferralOrderId({ reportOrderId: 11, billedStudyOrderId: 22 })).toBe(11);
  });

  it("uses the billed study order when the report has none", () => {
    expect(pickExactHopeReferralOrderId({ reportOrderId: null, billedStudyOrderId: 22 })).toBe(22);
  });

  it("fails closed when no exact order exists (no patient-level guess)", () => {
    expect(pickExactHopeReferralOrderId({ reportOrderId: null, billedStudyOrderId: null })).toBeNull();
  });

  it("does not invent an order from patient-level context", () => {
    // Contract: only exact CARE order ids are accepted — never a patient id.
    expect(pickExactHopeReferralOrderId({ reportOrderId: 0, billedStudyOrderId: -1 })).toBeNull();
  });
});
