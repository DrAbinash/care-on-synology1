import { describe, expect, it } from "vitest";
import {
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

  it("matchAllowsFinalize permits GREEN or APPROVED only", () => {
    expect(matchAllowsFinalize({ matchScore: "GREEN", matchDecision: "PENDING" })).toBe(true);
    expect(matchAllowsFinalize({ matchScore: "RED", matchDecision: "APPROVED" })).toBe(true);
    expect(matchAllowsFinalize({ matchScore: "RED", matchDecision: "PENDING" })).toBe(false);
    expect(matchAllowsFinalize({ matchScore: "YELLOW", matchDecision: "PENDING" })).toBe(false);
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
